import { Component, type ErrorInfo, type ReactNode } from 'react';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

/** Render only backend warning strings. Do not invent legal/commercial text. */
export function ownerLegalControlWarningTexts(panel: unknown): string[] {
  const warnings = asRecord(asRecord(panel)?.warnings);
  const combined = warnings?.combined;
  if (!Array.isArray(combined)) return [];
  return combined.flatMap((item) => {
    if (typeof item === 'string') return [item];
    const rec = asRecord(item);
    if (!rec) return [];
    if (typeof rec.message === 'string') return [rec.message];
    if (typeof rec.code === 'string') return [rec.code];
    return [];
  });
}

export function stringifyAggregateJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '—';
  }
}

/** `{ label }` badge objects must never be React children. */
export function ownerLegalControlObjectLabel(badge: unknown, fallback: unknown = ''): string {
  const rec = asRecord(badge);
  if (typeof rec?.label === 'string' && rec.label.trim()) return rec.label;
  if (typeof fallback === 'string') return fallback;
  return stringifyAggregateJson(badge ?? fallback);
}

/** Backend status_badge is `{ code, label, tone }`. Never render the object as a React child. */
export function ownerLegalControlStatusBadgeLabel(row: unknown): string {
  const rec = asRecord(row);
  if (!rec) return '';
  return ownerLegalControlObjectLabel(rec.status_badge, rec.status);
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * A successful Legal Control GET must not unmount the route into a blank page.
 * Shows the render exception; does not replace the aggregate with empty legal data.
 */
export class OwnerLegalControlRenderBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    void error;
    void _info;
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, maxWidth: 720 }}>
          <h1>Owner Legal Control Panel</h1>
          <p>The Legal Control aggregate loaded, but the page could not render it. Backend data was not replaced.</p>
          <p style={{ color: '#a94442', marginTop: 10 }}>{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
