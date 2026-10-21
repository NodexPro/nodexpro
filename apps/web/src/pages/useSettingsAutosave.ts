import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { apiJson } from '../api/client';
import { AUTH, orgSettings } from '../api/endpoints';
import {
  SETTINGS_AUTOSAVE_DEBOUNCE_MS,
  bankPatchFromForm,
  documentPatchFromForm,
  domainKeys,
  fieldDomain,
  hasPendingAutosaveWork,
  isStaleAutosaveGeneration,
  isWebsiteReadyToPersist,
  localizationCommandFromForm,
  mergeFormKeepingDirty,
  nextAutosaveGeneration,
  payloadsEqual,
  profilePatchFromForm,
  signaturePatchFromForm,
  type SettingsAutosaveDomain,
  type SettingsAutosaveStatus,
} from './settings-autosave.pure';

type LocForm = {
  language_code: string;
  timezone: string;
  date_format: string;
  display_currency_code: string;
};

const DOMAINS: SettingsAutosaveDomain[] = ['profile', 'document', 'bank', 'signature', 'localization'];

const IDLE_STATUSES: Record<SettingsAutosaveDomain, SettingsAutosaveStatus> = {
  profile: 'idle',
  document: 'idle',
  bank: 'idle',
  signature: 'idle',
  localization: 'idle',
};

export function useSettingsAutosave<TSettings>(options: {
  orgId: string | null;
  canEdit: boolean;
  countryOptions: ReadonlyArray<{ code: string }>;
  form: Record<string, unknown>;
  locForm: LocForm;
  setForm: Dispatch<SetStateAction<Record<string, unknown>>>;
  setLocForm: Dispatch<SetStateAction<LocForm>>;
  setData: (data: TSettings) => void;
  formFromSettings: (data: TSettings) => Record<string, unknown>;
  setLang: (lang: 'en' | 'he') => void;
}) {
  const [statuses, setStatuses] = useState(IDLE_STATUSES);
  const dirtyRef = useRef(new Set<string>());
  const locDirtyRef = useRef(false);
  const gensRef = useRef<Record<SettingsAutosaveDomain, number>>({
    profile: 0,
    document: 0,
    bank: 0,
    signature: 0,
    localization: 0,
  });
  const inflightRef = useRef<Record<SettingsAutosaveDomain, boolean>>({
    profile: false,
    document: false,
    bank: false,
    signature: false,
    localization: false,
  });
  const pendingRef = useRef<Record<SettingsAutosaveDomain, boolean>>({
    profile: false,
    document: false,
    bank: false,
    signature: false,
    localization: false,
  });
  const timersRef = useRef<Record<SettingsAutosaveDomain, ReturnType<typeof setTimeout> | null>>({
    profile: null,
    document: null,
    bank: null,
    signature: null,
    localization: null,
  });
  const lastPayloadRef = useRef<Record<SettingsAutosaveDomain, Record<string, unknown> | null>>({
    profile: null,
    document: null,
    bank: null,
    signature: null,
    localization: null,
  });
  const formRef = useRef(options.form);
  const locRef = useRef(options.locForm);
  const orgIdRef = useRef(options.orgId);
  const canEditRef = useRef(options.canEdit);
  const countryOptionsRef = useRef(options.countryOptions);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  formRef.current = options.form;
  locRef.current = options.locForm;
  orgIdRef.current = options.orgId;
  canEditRef.current = options.canEdit;
  countryOptionsRef.current = options.countryOptions;
  optionsRef.current = options;

  const setStatus = useCallback((domain: SettingsAutosaveDomain, status: SettingsAutosaveStatus) => {
    if (!mountedRef.current) return;
    setStatuses((prev) => (prev[domain] === status ? prev : { ...prev, [domain]: status }));
  }, []);

  const buildPayload = useCallback((domain: SettingsAutosaveDomain, phase: 'debounce' | 'blur') => {
    if (domain === 'localization') {
      return localizationCommandFromForm(locRef.current);
    }
    if (domain === 'document') return documentPatchFromForm(formRef.current);
    if (domain === 'bank') return bankPatchFromForm(formRef.current);
    if (domain === 'signature') return signaturePatchFromForm(formRef.current);
    const websiteDirty = dirtyRef.current.has('website');
    const persistWebsite = !websiteDirty || isWebsiteReadyToPersist(String(formRef.current.website ?? ''), phase);
    return profilePatchFromForm(formRef.current, {
      countryOptions: countryOptionsRef.current,
      includeCountry: dirtyRef.current.has('country'),
      persistWebsite,
      websitePhase: phase,
    });
  }, []);

  const flushDomain = useCallback(async (domain: SettingsAutosaveDomain, generation: number, phase: 'debounce' | 'blur' = 'blur'): Promise<boolean> => {
    if (isStaleAutosaveGeneration(generation, gensRef.current[domain])) return true;
    if (domain !== 'localization') {
      const dirty = domainKeys(domain).some((key) => dirtyRef.current.has(key));
      if (!dirty) return true;
      if (!canEditRef.current) return true;
    } else if (!locDirtyRef.current) {
      return true;
    }
    if (inflightRef.current[domain]) {
      pendingRef.current[domain] = true;
      return false;
    }

    const snapshotForm = { ...formRef.current };
    const snapshotLoc = { ...locRef.current };
    const payload = buildPayload(domain, phase);
    if (!payload) return true;
    if (domain === 'profile') {
      const persistableDirty = domainKeys('profile').filter(
        (key) => dirtyRef.current.has(key) && Object.prototype.hasOwnProperty.call(payload, key),
      );
      if (persistableDirty.length === 0) return true;
    }
    if (payloadsEqual(payload, lastPayloadRef.current[domain])) {
      if (domain === 'localization') locDirtyRef.current = false;
      else {
        for (const key of Object.keys(payload)) dirtyRef.current.delete(key);
      }
      return true;
    }

    inflightRef.current[domain] = true;
    setStatus(domain, 'saving');
    try {
      if (domain === 'localization') {
        const me = await apiJson<{ localization?: { language?: { current?: string } } }>(
          AUTH.setLocalizationPreferences,
          { method: 'POST', body: JSON.stringify(payload) },
        );
        lastPayloadRef.current.localization = payload;
        if (
          snapshotLoc.language_code === locRef.current.language_code &&
          snapshotLoc.timezone === locRef.current.timezone &&
          snapshotLoc.date_format === locRef.current.date_format &&
          snapshotLoc.display_currency_code === locRef.current.display_currency_code
        ) {
          locDirtyRef.current = false;
        }
        const nextLang = me.localization?.language?.current;
        if (nextLang === 'en' || nextLang === 'he') optionsRef.current.setLang(nextLang);
        setStatus(domain, 'saved');
        return true;
      }

      const orgId = orgIdRef.current;
      if (!orgId) return true;
      const updated = await apiJson<TSettings>(orgSettings(orgId), {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      lastPayloadRef.current[domain] = payload;
      for (const key of Object.keys(payload)) {
        if (snapshotForm[key] === formRef.current[key]) dirtyRef.current.delete(key);
      }
      if (mountedRef.current) {
        optionsRef.current.setData(updated);
        optionsRef.current.setForm((prev) =>
          mergeFormKeepingDirty(optionsRef.current.formFromSettings(updated), prev, dirtyRef.current),
        );
      }
      setStatus(domain, 'saved');
      return true;
    } catch {
      setStatus(domain, 'error');
      return false;
    } finally {
      inflightRef.current[domain] = false;
      if (pendingRef.current[domain]) {
        pendingRef.current[domain] = false;
        void flushDomain(domain, gensRef.current[domain], 'blur');
      }
    }
  }, [buildPayload, setStatus]);

  const schedule = useCallback((domain: SettingsAutosaveDomain, immediate: boolean) => {
    gensRef.current[domain] = nextAutosaveGeneration(gensRef.current[domain]);
    const generation = gensRef.current[domain];
    if (timersRef.current[domain] != null) {
      clearTimeout(timersRef.current[domain] as ReturnType<typeof setTimeout>);
      timersRef.current[domain] = null;
    }
    const delay = immediate ? 0 : SETTINGS_AUTOSAVE_DEBOUNCE_MS;
    timersRef.current[domain] = setTimeout(() => {
      timersRef.current[domain] = null;
      void flushDomain(domain, generation, immediate ? 'blur' : 'debounce');
    }, delay);
  }, [flushDomain]);

  const changeField = useCallback((field: string, value: unknown, kind: 'text' | 'select' | 'checkbox') => {
    optionsRef.current.setForm((prev) => ({ ...prev, [field]: value }));
    const domain = fieldDomain(field);
    if (!domain || !canEditRef.current) return;
    dirtyRef.current.add(field);
    schedule(domain, kind !== 'text');
  }, [schedule]);

  const blurField = useCallback((field: string) => {
    const domain = fieldDomain(field);
    if (!domain || !dirtyRef.current.has(field) || !canEditRef.current) return;
    schedule(domain, true);
  }, [schedule]);

  const changeLoc = useCallback((field: keyof LocForm, value: string) => {
    optionsRef.current.setLocForm((prev) => ({ ...prev, [field]: value }));
    locDirtyRef.current = true;
    schedule('localization', true);
  }, [schedule]);

  const retry = useCallback((domain: SettingsAutosaveDomain) => {
    gensRef.current[domain] = nextAutosaveGeneration(gensRef.current[domain]);
    void flushDomain(domain, gensRef.current[domain], 'blur');
  }, [flushDomain]);

  const flushAll = useCallback(async () => {
    const results = await Promise.all(
      DOMAINS.map((domain) => {
        gensRef.current[domain] = nextAutosaveGeneration(gensRef.current[domain]);
        return flushDomain(domain, gensRef.current[domain], 'blur');
      }),
    );
    return results.every(Boolean);
  }, [flushDomain]);

  const isLocDirty = useCallback(() => locDirtyRef.current, []);

  const applyLoadedForm = useCallback((serverForm: Record<string, unknown>) => {
    optionsRef.current.setForm((prev) => {
      if (dirtyRef.current.size === 0) return serverForm;
      return mergeFormKeepingDirty(serverForm, prev, dirtyRef.current);
    });
  }, []);

  const flushAllRef = useRef(flushAll);
  flushAllRef.current = flushAll;
  const pending = hasPendingAutosaveWork({
    statuses,
    dirtyCount: dirtyRef.current.size + (locDirtyRef.current ? 1 : 0),
  });

  useEffect(() => {
    mountedRef.current = true;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        dirtyRef.current.size > 0 ||
        locDirtyRef.current ||
        Object.values(inflightRef.current).some(Boolean)
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      mountedRef.current = false;
      for (const domain of DOMAINS) {
        if (timersRef.current[domain] != null) {
          clearTimeout(timersRef.current[domain] as ReturnType<typeof setTimeout>);
          timersRef.current[domain] = null;
        }
      }
      if (dirtyRef.current.size > 0 || locDirtyRef.current) {
        void flushAllRef.current();
      }
    };
  }, []);

  return {
    statuses,
    pending,
    changeField,
    blurField,
    changeLoc,
    retry,
    flushAll,
    isLocDirty,
    applyLoadedForm,
  };
}
