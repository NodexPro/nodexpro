import { useEffect, useState, type CSSProperties } from 'react';
import { apiJson } from '../api/client';
import { moduleClientOperationsAccountingGeneral, moduleClientOperationsAccountingVehicles } from '../api/endpoints';

export type VehicleKind = 'business' | 'private';
export type EngineType = 'diesel' | 'gasoline' | 'electric';

export type ClientAccountingVehiclePublic = {
  id: string;
  sort_order: number;
  vehicle_kind: VehicleKind;
  license_plate: string | null;
  manufacture_year: number | null;
  engine_type: EngineType;
  compulsory_insurance_from: string | null;
  compulsory_insurance_to: string | null;
  comprehensive_insurance_from: string | null;
  comprehensive_insurance_to: string | null;
  recognized_vat_percent: number | null;
  recognized_expense_percent: number | null;
};

export type ClientAccountingBundle = {
  settings: {
    occupation_field: string | null;
    business_opened_on: string | null;
    business_closed_on: string | null;
    has_vehicles: boolean;
    profession_vehicle_vat_rule: {
      profession_name: string;
      vehicle_vat_percent_default: number;
      applies_automatic_default: boolean;
    } | null;
  };
  vehicles: ClientAccountingVehiclePublic[];
  profession_rule_names: string[];
};

function isoToDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const fieldStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  boxShadow: 'none',
  padding: 0,
  width: '100%',
  outline: 'none',
  font: 'inherit',
};

const selectStyle: CSSProperties = {
  ...fieldStyle,
  appearance: 'none',
};

function emptyVehicleRow(sortOrder: number, bundle: ClientAccountingBundle): ClientAccountingVehiclePublic {
  const r = bundle.settings.profession_vehicle_vat_rule;
  const vatFromRule =
    r?.applies_automatic_default ? Number(r.vehicle_vat_percent_default) : null;
  return {
    id: `temp-${sortOrder}-${Date.now()}`,
    sort_order: sortOrder,
    vehicle_kind: 'business',
    license_plate: null,
    manufacture_year: null,
    engine_type: 'gasoline',
    compulsory_insurance_from: null,
    compulsory_insurance_to: null,
    comprehensive_insurance_from: null,
    comprehensive_insurance_to: null,
    recognized_vat_percent: vatFromRule,
    recognized_expense_percent: null,
  };
}

export function ClientAccountingTab({
  clientId,
  accounting,
  onAccountingUpdated,
}: {
  clientId: string;
  accounting: ClientAccountingBundle;
  onAccountingUpdated: (next: ClientAccountingBundle) => void;
}) {
  const [generalDraft, setGeneralDraft] = useState({
    occupation_field: accounting.settings.occupation_field ?? '',
    business_opened_on: isoToDateInputValue(accounting.settings.business_opened_on),
    business_closed_on: isoToDateInputValue(accounting.settings.business_closed_on),
    has_vehicles: accounting.settings.has_vehicles,
  });
  const [vehiclesDraft, setVehiclesDraft] = useState<ClientAccountingVehiclePublic[]>(() =>
    accounting.vehicles.map((v) => ({ ...v }))
  );

  const [genSaving, setGenSaving] = useState(false);
  const [genError, setGenError] = useState('');
  const [genSuccess, setGenSuccess] = useState('');
  const [vehSaving, setVehSaving] = useState(false);
  const [vehError, setVehError] = useState('');
  const [vehSuccess, setVehSuccess] = useState('');

  const vatRuleApplies = Boolean(accounting.settings.profession_vehicle_vat_rule?.applies_automatic_default);

  useEffect(() => {
    setGeneralDraft({
      occupation_field: accounting.settings.occupation_field ?? '',
      business_opened_on: isoToDateInputValue(accounting.settings.business_opened_on),
      business_closed_on: isoToDateInputValue(accounting.settings.business_closed_on),
      has_vehicles: accounting.settings.has_vehicles,
    });
    setVehiclesDraft(accounting.vehicles.map((v) => ({ ...v })));
    setGenError('');
    setGenSuccess('');
    setVehError('');
    setVehSuccess('');
  }, [accounting]);

  const handleCancelGeneral = () => {
    setGeneralDraft({
      occupation_field: accounting.settings.occupation_field ?? '',
      business_opened_on: isoToDateInputValue(accounting.settings.business_opened_on),
      business_closed_on: isoToDateInputValue(accounting.settings.business_closed_on),
      has_vehicles: accounting.settings.has_vehicles,
    });
    setGenError('');
    setGenSuccess('');
  };

  const handleSaveGeneral = async () => {
    setGenError('');
    setGenSuccess('');
    setGenSaving(true);
    try {
      const bundle = await apiJson<ClientAccountingBundle>(moduleClientOperationsAccountingGeneral(clientId), {
        method: 'POST',
        body: JSON.stringify({
          occupation_field: generalDraft.occupation_field.trim() ? generalDraft.occupation_field.trim() : null,
          business_opened_on: generalDraft.business_opened_on ? generalDraft.business_opened_on : null,
          business_closed_on: generalDraft.business_closed_on ? generalDraft.business_closed_on : null,
          has_vehicles: generalDraft.has_vehicles,
        }),
      });
      onAccountingUpdated(bundle);
      setGenSuccess('נשמר בהצלחה');
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'שגיאת שמירה');
    } finally {
      setGenSaving(false);
    }
  };

  const handleCancelVehicles = () => {
    setVehiclesDraft(accounting.vehicles.map((v) => ({ ...v })));
    setVehError('');
    setVehSuccess('');
  };

  const buildVehiclesPayload = () => {
    return vehiclesDraft.map((v) => ({
      vehicle_kind: v.vehicle_kind,
      license_plate: v.license_plate,
      manufacture_year: v.manufacture_year,
      engine_type: v.engine_type,
      compulsory_insurance_from: v.compulsory_insurance_from,
      compulsory_insurance_to: v.compulsory_insurance_to,
      comprehensive_insurance_from: v.comprehensive_insurance_from,
      comprehensive_insurance_to: v.comprehensive_insurance_to,
      recognized_vat_percent: vatRuleApplies ? null : v.recognized_vat_percent,
      recognized_expense_percent: v.recognized_expense_percent,
    }));
  };

  const handleSaveVehicles = async () => {
    setVehError('');
    setVehSuccess('');
    setVehSaving(true);
    try {
      const bundle = await apiJson<ClientAccountingBundle>(moduleClientOperationsAccountingVehicles(clientId), {
        method: 'POST',
        body: JSON.stringify({ vehicles: buildVehiclesPayload() }),
      });
      onAccountingUpdated(bundle);
      setVehSuccess('נשמר בהצלחה');
    } catch (e) {
      setVehError(e instanceof Error ? e.message : 'שגיאת שמירה');
    } finally {
      setVehSaving(false);
    }
  };

  const addVehicle = () => {
    if (vehiclesDraft.length >= 10) return;
    setVehiclesDraft((rows) => [...rows, emptyVehicleRow(rows.length, accounting)]);
  };

  const removeVehicle = (index: number) => {
    setVehiclesDraft((rows) => rows.filter((_, i) => i !== index));
  };

  const updateVehicle = (index: number, patch: Partial<ClientAccountingVehiclePublic>) => {
    setVehiclesDraft((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const datalistId = 'nx-accounting-profession-suggestions';

  return (
    <div className="client-profile-card" style={{ maxWidth: '100%' }}>
      <datalist id={datalistId}>
        {accounting.profession_rule_names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <h3 className="nx-accounting-section-title" style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>
        פרטי הנה״ח כלליים
      </h3>

      <div className="client-profile-grid">
        <div className="client-field client-field-full">
          <div className="client-field-label">תחום עיסוק</div>
          <div className="client-field-box">
            <input
              value={generalDraft.occupation_field}
              onChange={(e) => setGeneralDraft((s) => ({ ...s, occupation_field: e.target.value }))}
              list={datalistId}
              aria-label="תחום עיסוק"
              autoComplete="off"
              style={fieldStyle}
            />
          </div>
        </div>

        <div className="client-field">
          <div className="client-field-label">פתיחת עסק</div>
          <div className="client-field-box">
            <input
              type="date"
              value={generalDraft.business_opened_on}
              onChange={(e) => setGeneralDraft((s) => ({ ...s, business_opened_on: e.target.value }))}
              aria-label="פתיחת עסק"
              style={fieldStyle}
            />
          </div>
        </div>

        <div className="client-field">
          <div className="client-field-label">סגירת עסק</div>
          <div className="client-field-box">
            <input
              type="date"
              value={generalDraft.business_closed_on}
              onChange={(e) => setGeneralDraft((s) => ({ ...s, business_closed_on: e.target.value }))}
              aria-label="סגירת עסק"
              style={fieldStyle}
            />
          </div>
        </div>

        <div className="client-field client-field-full">
          <div className="client-field-label">יש רכבים בעסק?</div>
          <div className="client-field-box" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="nx-has-vehicles"
                checked={generalDraft.has_vehicles === true}
                onChange={() => setGeneralDraft((s) => ({ ...s, has_vehicles: true }))}
              />
              כן
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="nx-has-vehicles"
                checked={generalDraft.has_vehicles === false}
                onChange={() => setGeneralDraft((s) => ({ ...s, has_vehicles: false }))}
              />
              לא
            </label>
          </div>
        </div>
      </div>

      <div
        className="nx-modal-footer nx-workspace-client-footer nx-taxes-tab-footer"
        style={{ marginTop: 16, justifyContent: 'flex-start', flexWrap: 'wrap', gap: 8 }}
      >
        {genSuccess ? (
          <span className="nx-workspace-save-success" role="status" aria-live="polite">
            {genSuccess}
          </span>
        ) : null}
        <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" onClick={() => void handleSaveGeneral()} disabled={genSaving}>
          {genSaving ? 'שומר…' : 'שמירת פרטים כלליים'}
        </button>
        <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" onClick={handleCancelGeneral} disabled={genSaving}>
          ביטול שינויי מקטע זה
        </button>
      </div>
      {genError ? <p style={{ color: '#b91c1c', fontWeight: 700, margin: '8px 0 0', fontSize: 14 }}>{genError}</p> : null}

      {generalDraft.has_vehicles ? (
        <>
          <h3
            className="nx-accounting-section-title"
            style={{ margin: '24px 0 12px', fontSize: 16, fontWeight: 700, borderTop: '1px solid #e5e7eb', paddingTop: 20 }}
          >
            רכבים בעסק
          </h3>

          {vehiclesDraft.map((row, idx) => (
            <div
              key={row.id || `row-${idx}`}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 12,
                marginBottom: 12,
                background: '#fafafa',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>{`רכב ${idx + 1}`}</span>
                <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" onClick={() => removeVehicle(idx)}>
                  הסרה
                </button>
              </div>
              <div className="client-profile-grid">
                <div className="client-field">
                  <div className="client-field-label">סוג רכב</div>
                  <div className="client-field-box">
                    <select
                      value={row.vehicle_kind}
                      onChange={(e) => updateVehicle(idx, { vehicle_kind: e.target.value as VehicleKind })}
                      aria-label="סוג רכב"
                      style={selectStyle}
                    >
                      <option value="business">רכב עסקי</option>
                      <option value="private">רכב פרטי</option>
                    </select>
                  </div>
                </div>
                <div className="client-field">
                  <div className="client-field-label">מספר רישוי</div>
                  <div className="client-field-box">
                    <input
                      value={row.license_plate ?? ''}
                      onChange={(e) => updateVehicle(idx, { license_plate: e.target.value || null })}
                      aria-label="מספר רישוי"
                      style={fieldStyle}
                    />
                  </div>
                </div>
                <div className="client-field">
                  <div className="client-field-label">שנת ייצור</div>
                  <div className="client-field-box">
                    <input
                      type="number"
                      min={1900}
                      max={2100}
                      value={row.manufacture_year ?? ''}
                      onChange={(e) => {
                        const t = e.target.value;
                        if (t === '') {
                          updateVehicle(idx, { manufacture_year: null });
                          return;
                        }
                        const n = Number.parseInt(t, 10);
                        updateVehicle(idx, { manufacture_year: Number.isNaN(n) ? null : n });
                      }}
                      aria-label="שנת ייצור"
                      style={fieldStyle}
                    />
                  </div>
                </div>
                <div className="client-field">
                  <div className="client-field-label">סוג הנעה</div>
                  <div className="client-field-box">
                    <select
                      value={row.engine_type}
                      onChange={(e) => updateVehicle(idx, { engine_type: e.target.value as EngineType })}
                      aria-label="סוג הנעה"
                      style={selectStyle}
                    >
                      <option value="diesel">דיזל</option>
                      <option value="gasoline">בנזין</option>
                      <option value="electric">חשמלי</option>
                    </select>
                  </div>
                </div>
                <div className="client-field">
                  <div className="client-field-label">ביטוח חובה מתאריך</div>
                  <div className="client-field-box">
                    <input
                      type="date"
                      value={isoToDateInputValue(row.compulsory_insurance_from)}
                      onChange={(e) =>
                        updateVehicle(idx, { compulsory_insurance_from: e.target.value ? e.target.value : null })
                      }
                      aria-label="ביטוח חובה מתאריך"
                      style={fieldStyle}
                    />
                  </div>
                </div>
                <div className="client-field">
                  <div className="client-field-label">ביטוח חובה עד תאריך</div>
                  <div className="client-field-box">
                    <input
                      type="date"
                      value={isoToDateInputValue(row.compulsory_insurance_to)}
                      onChange={(e) =>
                        updateVehicle(idx, { compulsory_insurance_to: e.target.value ? e.target.value : null })
                      }
                      aria-label="ביטוח חובה עד תאריך"
                      style={fieldStyle}
                    />
                  </div>
                </div>
                <div className="client-field">
                  <div className="client-field-label">ביטוח מקיף מתאריך</div>
                  <div className="client-field-box">
                    <input
                      type="date"
                      value={isoToDateInputValue(row.comprehensive_insurance_from)}
                      onChange={(e) =>
                        updateVehicle(idx, { comprehensive_insurance_from: e.target.value ? e.target.value : null })
                      }
                      aria-label="ביטוח מקיף מתאריך"
                      style={fieldStyle}
                    />
                  </div>
                </div>
                <div className="client-field">
                  <div className="client-field-label">ביטוח מקיף עד תאריך</div>
                  <div className="client-field-box">
                    <input
                      type="date"
                      value={isoToDateInputValue(row.comprehensive_insurance_to)}
                      onChange={(e) =>
                        updateVehicle(idx, { comprehensive_insurance_to: e.target.value ? e.target.value : null })
                      }
                      aria-label="ביטוח מקיף עד תאריך"
                      style={fieldStyle}
                    />
                  </div>
                </div>
                <div className="client-field">
                  <div className="client-field-label">אחוז מע״מ מוכר לרכב</div>
                  <div className="client-field-box">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      disabled={vatRuleApplies}
                      value={row.recognized_vat_percent ?? ''}
                      onChange={(e) => {
                        const t = e.target.value;
                        updateVehicle(idx, {
                          recognized_vat_percent: t === '' ? null : Number(t),
                        });
                      }}
                      aria-label="אחוז מע״מ מוכר לרכב"
                      style={{ ...fieldStyle, opacity: vatRuleApplies ? 0.85 : 1 }}
                    />
                  </div>
                </div>
                <div className="client-field">
                  <div className="client-field-label">אחוז הוצאה מוכרת לרכב</div>
                  <div className="client-field-box">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={row.recognized_expense_percent ?? ''}
                      onChange={(e) => {
                        const t = e.target.value;
                        updateVehicle(idx, {
                          recognized_expense_percent: t === '' ? null : Number(t),
                        });
                      }}
                      aria-label="אחוז הוצאה מוכרת לרכב"
                      style={fieldStyle}
                    />
                  </div>
                </div>
              </div>
              {vatRuleApplies ? (
                <p style={{ margin: '8px 0 0', fontSize: 12, color: '#4b5563' }}>
                  אחוז מע״מ מוכר: נקבע לפי תחום העיסוק (מהשרת, לא ניתן לעריכה כאן).
                </p>
              ) : null}
            </div>
          ))}

          <button
            type="button"
            className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
            onClick={addVehicle}
            disabled={vehiclesDraft.length >= 10}
            style={{ marginBottom: 12 }}
          >
            הוספת רכב
          </button>

          <div className="nx-modal-footer nx-workspace-client-footer nx-taxes-tab-footer" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
            {vehSuccess ? (
              <span className="nx-workspace-save-success" role="status" aria-live="polite">
                {vehSuccess}
              </span>
            ) : null}
            <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" onClick={() => void handleSaveVehicles()} disabled={vehSaving}>
              {vehSaving ? 'שומר…' : 'שמירת רכבים'}
            </button>
            <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" onClick={handleCancelVehicles} disabled={vehSaving}>
              ביטול שינויי רכבים
            </button>
          </div>
          {vehError ? <p style={{ color: '#b91c1c', fontWeight: 700, margin: '8px 0 0', fontSize: 14 }}>{vehError}</p> : null}
        </>
      ) : null}
    </div>
  );
}
