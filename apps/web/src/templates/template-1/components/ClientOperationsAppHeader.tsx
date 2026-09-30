import { CLIENT_OPERATIONS_HEADER_SEARCH_SLOT_TEST_ID } from '../../../components/client-operations/ClientOperationsHeaderSearchSlot';

/** Route label for /m/client-operations — module chrome, not aggregate data. */
export const CLIENT_OPERATIONS_HEADER_TITLE_HE = 'ניהול לקוחות';

/**
 * Client Operations route header (presentation only, CO route scoped).
 *
 * Replaces the generic AppHeader ONLY under /m/client-operations:
 *  - no duplicated account / language chrome (already owned by the sidebar account block)
 *  - module title on the RIGHT (RTL)
 *  - centre slot that receives the registry view's existing search field via portal
 *
 * Other modules keep the generic AppHeader untouched.
 */
export function ClientOperationsAppHeader({
  searchSlotRef,
}: {
  searchSlotRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <header className="nx-co-app-header" dir="rtl" data-testid="client-operations-app-header">
      <div className="nx-co-app-header__title-wrap">
        <span className="nx-co-app-header__title-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <rect x="3" y="4" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 9h18" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 13h8M8 16.5h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <h1 className="nx-co-app-header__title">{CLIENT_OPERATIONS_HEADER_TITLE_HE}</h1>
      </div>
      <div
        ref={searchSlotRef}
        className="nx-co-app-header__search-slot"
        data-testid={CLIENT_OPERATIONS_HEADER_SEARCH_SLOT_TEST_ID}
      />
      <div className="nx-co-app-header__end" aria-hidden="true" />
    </header>
  );
}
