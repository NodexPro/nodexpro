/**
 * Income wizard — official Bank of Israel representative exchange rates.
 *
 * Primary: BOI SDMX REST API (EXR, DATA_TYPE=OF00, RER_{CCY}_ILS).
 * Fallback when SDMX unavailable for "today": BOI PublicApi GetExchangeRates.
 * Cache: in-memory by currency + requested document date (6h TTL).
 *
 * Not Accounting Base financial truth — draft preview only.
 */
import { badRequest } from '../../shared/errors.js';
import { addDaysIso, boiSourceLabel, formatBoiRateDisplay, normalizeIsoDate, parseBoiPublicApiRates, parseBoiSdmxCsv, parseBoiSdmxJsonObservations, pickBoiRateForDate, publicApiRateForCurrency, } from './income-boi-exchange-rate.pure.js';
const BOI_SDMX_BASE = 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0';
const BOI_PUBLIC_API = 'https://www.boi.org.il/PublicApi/GetExchangeRates?asXml=false';
const BOI_SERIES_KEY = {
    USD: 'RER_USD_ILS',
    EUR: 'RER_EUR_ILS',
    GBP: 'RER_GBP_ILS',
};
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const officialRateCache = new Map();
let fetchImpl = (url, init) => fetch(url, init);
/** Test hook — inject mock fetch. */
export function setIncomeExchangeRateFetchForTests(impl) {
    fetchImpl = impl ?? ((url, init) => fetch(url, init));
}
export function clearIncomeExchangeRateCacheForTests() {
    officialRateCache.clear();
}
function cacheKey(currency, documentDate) {
    return `${currency}:${normalizeIsoDate(documentDate)}`;
}
function readCache(key) {
    const hit = officialRateCache.get(key);
    if (!hit)
        return null;
    if (Date.now() > hit.expiresAt) {
        officialRateCache.delete(key);
        return null;
    }
    return hit.rate;
}
function writeCache(key, rate) {
    officialRateCache.set(key, { rate, expiresAt: Date.now() + CACHE_TTL_MS });
}
async function fetchWithTimeout(url, accept) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetchImpl(url, {
            signal: controller.signal,
            headers: {
                Accept: accept,
                'User-Agent': 'NodexPro-Income-Wizard/1.0',
            },
        });
    }
    finally {
        clearTimeout(timer);
    }
}
function buildSdmxUrl(currency, documentDate) {
    const series = BOI_SERIES_KEY[currency];
    const end = normalizeIsoDate(documentDate);
    const start = addDaysIso(end, -120);
    const params = new URLSearchParams({
        'c[DATA_TYPE]': 'OF00',
        startperiod: start,
        endperiod: end,
    });
    const qs = params.toString();
    return {
        jsonUrl: `${BOI_SDMX_BASE}/${series}?${qs}&format=sdmx-json`,
        csvUrl: `${BOI_SDMX_BASE}/${series}?${qs}&format=csv`,
    };
}
async function loadObservationsFromSdmx(currency, documentDate) {
    const { jsonUrl, csvUrl } = buildSdmxUrl(currency, documentDate);
    try {
        const res = await fetchWithTimeout(jsonUrl, 'application/json');
        if (res.ok) {
            const payload = await res.json();
            const parsed = parseBoiSdmxJsonObservations(payload);
            if (parsed.length > 0)
                return parsed;
        }
    }
    catch {
        /* try CSV */
    }
    try {
        const res = await fetchWithTimeout(csvUrl, 'text/csv');
        if (res.ok) {
            const text = await res.text();
            const parsed = parseBoiSdmxCsv(text);
            if (parsed.length > 0)
                return parsed;
        }
    }
    catch {
        /* fall through */
    }
    return [];
}
async function loadFromPublicApi(currency) {
    try {
        const res = await fetchWithTimeout(BOI_PUBLIC_API, 'application/json');
        if (!res.ok)
            return null;
        const payload = await res.json();
        const rows = parseBoiPublicApiRates(payload);
        const obs = publicApiRateForCurrency(rows, currency);
        if (!obs)
            return null;
        return {
            currency,
            rate_to_ils: obs.rate,
            rate_display: formatBoiRateDisplay(obs.rate),
            rate_date: obs.date,
            requested_date: obs.date,
            exact_date_match: true,
            source: 'boi_public_api',
        };
    }
    catch {
        return null;
    }
}
export async function resolveOfficialBoiExchangeRate(currency, documentDate) {
    const requested = normalizeIsoDate(documentDate);
    const key = cacheKey(currency, requested);
    const cached = readCache(key);
    if (cached)
        return cached;
    const observations = await loadObservationsFromSdmx(currency, requested);
    const pick = pickBoiRateForDate(observations, requested);
    if (pick.observation) {
        const rate = {
            currency,
            rate_to_ils: pick.observation.rate,
            rate_display: formatBoiRateDisplay(pick.observation.rate),
            rate_date: pick.observation.date,
            requested_date: requested,
            exact_date_match: pick.exact_date_match,
            source: 'boi_sdmx',
        };
        writeCache(key, rate);
        return rate;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (requested >= today) {
        const live = await loadFromPublicApi(currency);
        if (live) {
            const adjusted = {
                ...live,
                requested_date: requested,
                exact_date_match: live.rate_date === requested,
            };
            writeCache(key, adjusted);
            return adjusted;
        }
    }
    throw badRequest(`לא נמצא שער יציג מבנק ישראל עבור ${currency} בתאריך ${requested}`);
}
export async function resolveOfficialBoiRatesForCurrencies(currencies, documentDate) {
    const unique = [...new Set(currencies.filter((c) => c !== 'ILS'))];
    const map = new Map();
    await Promise.all(unique.map(async (currency) => {
        try {
            const rate = await resolveOfficialBoiExchangeRate(currency, documentDate);
            map.set(currency, rate);
        }
        catch {
            /* row-level field_errors when rate missing */
        }
    }));
    return map;
}
export function officialRateSourceLabel(rate) {
    return boiSourceLabel(rate.exact_date_match, rate.rate_date, rate.requested_date);
}
