import { useState } from 'react';

type UnknownRecord = Record<string, unknown>;

function text(v: unknown): string {
  return v == null || v === '' ? '—' : String(v);
}

function termsOf(seats: UnknownRecord | null, key: 'current_terms' | 'scheduled_terms'): UnknownRecord | null {
  const value = seats?.[key];
  return value && typeof value === 'object' ? (value as UnknownRecord) : null;
}

export function StaffSeatTermsModal(props: {
  orgName: string;
  organizationId: string;
  seats: UnknownRecord | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (payload: {
    organization_id: string;
    effective_from: string;
    additional_seat_quantity: number;
    unit_price_amount: number | null;
    currency: string | null;
    discount_percent: number;
  }) => void;
}) {
  const current = termsOf(props.seats, 'current_terms');
  const scheduled = termsOf(props.seats, 'scheduled_terms');
  const blocked = (props.seats?.blocked_scheduled_reduction as UnknownRecord | null) ?? null;
  const blockedTerms =
    blocked?.terms && typeof blocked.terms === 'object' ? (blocked.terms as UnknownRecord) : null;
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [quantity, setQuantity] = useState(
    current?.additional_seat_quantity == null ? '0' : String(current.additional_seat_quantity),
  );
  const [unitPrice, setUnitPrice] = useState(current?.unit_price == null ? '' : String(current.unit_price));
  const [currency, setCurrency] = useState(current?.currency ? String(current.currency) : 'ILS');
  const [discount, setDiscount] = useState(
    current?.discount_percent == null ? '0' : String(current.discount_percent),
  );

  return (
    <div className="nx-owner-modal-overlay" role="presentation" onClick={props.onClose}>
      <div
        className="nx-owner-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-staff-seat-terms-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640 }}
      >
        <div className="nx-owner-modal__header">
          <h2 id="nx-staff-seat-terms-title" className="nx-owner-modal__title">
            Staff Seats — {props.orgName}
          </h2>
          <button type="button" className="nx-owner-btn" disabled={props.busy} onClick={props.onClose}>
            Cancel
          </button>
        </div>
        {props.error ? <div className="nx-owner-modal__error">{props.error}</div> : null}
        <div className="nx-owner-modal__meta">
          <div>
            <div className="nx-owner-modal__label">Included seats</div>
            <div className="nx-owner-modal__value">{text(props.seats?.included_staff_seats)}</div>
          </div>
          <div>
            <div className="nx-owner-modal__label">Grandfathered seats</div>
            <div className="nx-owner-modal__value">{text(props.seats?.grandfathered_staff_seats)}</div>
          </div>
          <div>
            <div className="nx-owner-modal__label">Used seats</div>
            <div className="nx-owner-modal__value">{text(props.seats?.used_staff_seats)}</div>
          </div>
          <div>
            <div className="nx-owner-modal__label">Available seats</div>
            <div className="nx-owner-modal__value">{text(props.seats?.available_staff_seats)}</div>
          </div>
        </div>
        <section style={{ marginTop: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Current terms</h3>
          <div className="nx-owner-modal__meta">
            <div>
              <div className="nx-owner-modal__label">Effective from</div>
              <div className="nx-owner-modal__value">{text(current?.effective_from)}</div>
            </div>
            <div>
              <div className="nx-owner-modal__label">Additional seats</div>
              <div className="nx-owner-modal__value">{text(current?.additional_seat_quantity)}</div>
            </div>
            <div>
              <div className="nx-owner-modal__label">Unit price</div>
              <div className="nx-owner-modal__value">{text(current?.unit_price)}</div>
            </div>
            <div>
              <div className="nx-owner-modal__label">Discount %</div>
              <div className="nx-owner-modal__value">{text(current?.discount_percent)}</div>
            </div>
            <div>
              <div className="nx-owner-modal__label">Final recurring charge</div>
              <div className="nx-owner-modal__value">{text(props.seats?.seat_charge_label)}</div>
            </div>
            <div>
              <div className="nx-owner-modal__label">Billing cadence</div>
              <div className="nx-owner-modal__value">{text(current?.billing_cadence)}</div>
            </div>
          </div>
        </section>
        {scheduled || blocked ? (
          <section style={{ marginTop: 16 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Scheduled terms</h3>
            {blocked ? (
              <p style={{ color: '#92400e', fontSize: 13, marginTop: 0 }}>{text(blocked.status_label)}</p>
            ) : null}
            {blockedTerms ? (
              <p style={{ fontSize: 13, margin: '0 0 8px' }}>
                Blocked from {text(blockedTerms.effective_from)}: {text(blockedTerms.additional_seat_quantity)} additional
                seats, charge {text(blockedTerms.seat_charge_label)}.
              </p>
            ) : null}
            {scheduled ? (
              <p style={{ fontSize: 13, margin: 0 }}>
                From {text(scheduled.effective_from)}: {text(scheduled.additional_seat_quantity)} additional seats, unit
                price {text(scheduled.unit_price)}, discount {text(scheduled.discount_percent)}%, charge{' '}
                {text(scheduled.seat_charge_label)}.
              </p>
            ) : null}
          </section>
        ) : null}
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          <label className="nx-owner-modal__field">
            Effective from
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} disabled={props.busy} />
          </label>
          <label className="nx-owner-modal__field">
            Additional seats
            <input type="number" min={0} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={props.busy} />
          </label>
          <label className="nx-owner-modal__field">
            Unit price
            <input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} disabled={props.busy} />
          </label>
          <label className="nx-owner-modal__field">
            Currency
            <input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} disabled={props.busy} />
          </label>
          <label className="nx-owner-modal__field">
            Discount %
            <input type="number" min={0} max={100} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={props.busy} />
          </label>
          <div className="nx-owner-modal__meta">
            <div>
              <div className="nx-owner-modal__label">Effective unit price</div>
              <div className="nx-owner-modal__value">{text(current?.effective_unit_price_label)}</div>
            </div>
            <div>
              <div className="nx-owner-modal__label">Final recurring charge</div>
              <div className="nx-owner-modal__value">{text(props.seats?.seat_charge_label)}</div>
            </div>
            <div>
              <div className="nx-owner-modal__label">Billing cadence</div>
              <div className="nx-owner-modal__value">{text(current?.billing_cadence)}</div>
            </div>
          </div>
        </div>
        <div className="nx-owner-modal__footer">
          <button type="button" className="nx-owner-btn" disabled={props.busy} onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="nx-owner-btn nx-owner-btn--primary"
            disabled={props.busy}
            onClick={() =>
              props.onSave({
                organization_id: props.organizationId,
                effective_from: effectiveFrom,
                additional_seat_quantity: Number(quantity),
                unit_price_amount: unitPrice.trim() === '' ? null : Number(unitPrice),
                currency: unitPrice.trim() === '' ? null : currency.trim() || null,
                discount_percent: discount.trim() === '' ? 0 : Number(discount),
              })
            }
          >
            Save seat terms
          </button>
        </div>
      </div>
    </div>
  );
}
