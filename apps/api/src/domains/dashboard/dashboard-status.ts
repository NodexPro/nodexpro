/**
 * Shared dashboard status model used by all dashboard providers.
 * Keep this in one place so providers don't invent ad-hoc local status strings.
 */
export type DashboardStatus = 'ready' | 'empty' | 'coming_soon' | 'unavailable';

