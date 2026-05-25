/**
 * Bank of Israel representative (שער יציג) rate parsing — pure helpers.
 * Data source: BOI SDMX API (EXR / DATA_TYPE=OF00).
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function normalizeIsoDate(raw) {
    const trimmed = raw.trim().slice(0, 10);
    return DATE_RE.test(trimmed) ? trimmed : new Date().toISOString().slice(0, 10);
}
export function addDaysIso(date, deltaDays) {
    const d = new Date(`${date}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
}
/** Pick exact date or latest observation on/before requested date. */
export function pickBoiRateForDate(observations, requestedDate) {
    const target = normalizeIsoDate(requestedDate);
    const sorted = observations
        .filter((o) => DATE_RE.test(o.date) && Number.isFinite(o.rate) && o.rate > 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (sorted.length === 0)
        return { observation: null, exact_date_match: false };
    const exact = sorted.find((o) => o.date === target);
    if (exact)
        return { observation: exact, exact_date_match: true };
    let best = null;
    for (const o of sorted) {
        if (o.date <= target)
            best = o;
        else
            break;
    }
    if (best)
        return { observation: best, exact_date_match: false };
    return { observation: sorted[0], exact_date_match: false };
}
export function formatBoiRateDisplay(rate) {
    return rate.toFixed(4);
}
export function boiSourceLabel(exact, rateDate, requestedDate) {
    if (exact && rateDate === requestedDate) {
        return `שער יציג ל-${rateDate}`;
    }
    return 'שער יציג אחרון זמין';
}
/** Parse BOI SDMX-JSON representative rate series (EXR / OF00). */
export function parseBoiSdmxJsonObservations(payload) {
    if (!payload || typeof payload !== 'object')
        return [];
    const data = payload.data;
    if (!data || typeof data !== 'object')
        return [];
    const dataObj = data;
    const structuresRaw = dataObj.structures ?? dataObj.structure;
    const structureList = Array.isArray(structuresRaw)
        ? structuresRaw
        : structuresRaw
            ? [structuresRaw]
            : [];
    const timeByIndex = [];
    for (const st of structureList) {
        if (!st || typeof st !== 'object')
            continue;
        const dims = st.dimensions;
        if (!dims || typeof dims !== 'object')
            continue;
        const observation = dims.observation;
        if (!Array.isArray(observation))
            continue;
        for (const dim of observation) {
            if (!dim || typeof dim !== 'object')
                continue;
            const d = dim;
            const id = String(d.id ?? '');
            const role = String(d.role ?? '');
            if (id !== 'TIME_PERIOD' && role !== 'time')
                continue;
            const values = d.values;
            if (!Array.isArray(values))
                continue;
            for (const v of values) {
                if (!v || typeof v !== 'object')
                    continue;
                const val = v;
                const date = String(val.id ?? val.name ?? '').slice(0, 10);
                if (DATE_RE.test(date))
                    timeByIndex.push(date);
            }
        }
    }
    const out = [];
    const dataSets = dataObj.dataSets;
    if (!Array.isArray(dataSets))
        return out;
    for (const ds of dataSets) {
        if (!ds || typeof ds !== 'object')
            continue;
        const series = ds.series;
        if (!series || typeof series !== 'object')
            continue;
        for (const seriesKey of Object.keys(series)) {
            const seriesObj = series[seriesKey];
            if (!seriesObj || typeof seriesObj !== 'object')
                continue;
            const observations = seriesObj.observations;
            if (!observations || typeof observations !== 'object')
                continue;
            for (const obsIndex of Object.keys(observations)) {
                const rawVal = observations[obsIndex];
                const rate = Array.isArray(rawVal) ? Number(rawVal[0]) : Number(rawVal);
                const idx = Number(obsIndex);
                const date = timeByIndex[idx] ?? timeByIndex[0];
                if (!date || !Number.isFinite(rate) || rate <= 0)
                    continue;
                out.push({ date, rate });
            }
        }
    }
    return out;
}
/** Parse BOI SDMX CSV (TIME_PERIOD + rate column). */
export function parseBoiSdmxCsv(text) {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    if (lines.length < 2)
        return [];
    const header = lines[0].split(',').map((h) => h.trim());
    const dateIdx = header.findIndex((h) => h === 'TIME_PERIOD' || h.toLowerCase().includes('time'));
    const rateIdx = header.findIndex((h) => h.startsWith('RER_') || h.toLowerCase().includes('rate'));
    if (dateIdx < 0 || rateIdx < 0)
        return [];
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const date = String(cols[dateIdx] ?? '').trim().slice(0, 10);
        const rate = Number(String(cols[rateIdx] ?? '').trim());
        if (!DATE_RE.test(date) || !Number.isFinite(rate) || rate <= 0)
            continue;
        out.push({ date, rate });
    }
    return out;
}
export function parseBoiPublicApiRates(payload) {
    if (!payload || typeof payload !== 'object')
        return [];
    const rates = payload.exchangeRates;
    if (!Array.isArray(rates))
        return [];
    const out = [];
    for (const row of rates) {
        if (!row || typeof row !== 'object')
            continue;
        const o = row;
        const key = String(o.key ?? '').trim().toUpperCase();
        const rate = Number(o.currentExchangeRate);
        const unit = Number(o.unit ?? 1);
        const lastUpdate = String(o.lastUpdate ?? '');
        if (!key || !Number.isFinite(rate) || rate <= 0)
            continue;
        const perUnit = unit > 0 ? rate / unit : rate;
        out.push({ key, currentExchangeRate: perUnit, unit: 1, lastUpdate });
    }
    return out;
}
export function publicApiRateForCurrency(rows, currency) {
    const row = rows.find((r) => r.key === currency.toUpperCase());
    if (!row)
        return null;
    const date = row.lastUpdate ? normalizeIsoDate(row.lastUpdate) : new Date().toISOString().slice(0, 10);
    return { date, rate: row.currentExchangeRate };
}
