import {
  CLIENT_OPERATIONS_HEADER_SEARCH_SLOT_TEST_ID,
  CLIENT_OPERATIONS_HEADER_WORKSPACE_SLOT_TEST_ID,
} from '../../../components/client-operations/ClientOperationsHeaderSearchSlot';
import { useI18n } from '../../../i18n/I18nProvider';

/** Route label key for /m/client-operations — module chrome, not aggregate data. */
export const CLIENT_OPERATIONS_HEADER_TITLE_KEY = 'clientOperations.moduleTitle';

/**
 * Client Operations route header (presentation only, CO route scoped).
 *
 * Replaces the generic AppHeader ONLY under /m/client-operations:
 *  - no duplicated account / language chrome (already owned by the sidebar account block)
 *  - module title follows the platform locale direction
 *  - centre slot that receives the registry KPI cards via portal
 *  - end slot for backend-owned workspace selector (Owner/Admin only when visible)
 *
 * Other modules keep the generic AppHeader untouched.
 */
export function ClientOperationsAppHeader({
  searchSlotRef,
  workspaceSlotRef,
  greetingText = null,
}: {
  searchSlotRef: (el: HTMLDivElement | null) => void;
  workspaceSlotRef: (el: HTMLDivElement | null) => void;
  /** Employee workspace top line (backend-composed, e.g. "היי, <first name>"). Falls back to the module title. */
  greetingText?: string | null;
}) {
  const { t } = useI18n();
  const moduleTitle = t(CLIENT_OPERATIONS_HEADER_TITLE_KEY);
  return (
    <header className="nx-co-app-header" data-testid="client-operations-app-header">
      <div className="nx-co-app-header__title-wrap">
        <span className="nx-co-app-header__title-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <rect x="3" y="4" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 9h18" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 13h8M8 16.5h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        {greetingText ? (
          <div className="nx-co-app-header__title-stack">
            <h1 className="nx-co-app-header__title" data-testid="client-operations-greeting">
              {greetingText}
            </h1>
            <p className="nx-co-app-header__module-title" data-testid="client-operations-module-title">
              {moduleTitle}
            </p>
          </div>
        ) : (
          <h1 className="nx-co-app-header__title">{moduleTitle}</h1>
        )}
      </div>
      <div
        ref={searchSlotRef}
        className="nx-co-app-header__search-slot"
        data-testid={CLIENT_OPERATIONS_HEADER_SEARCH_SLOT_TEST_ID}
      />
      <div
        ref={workspaceSlotRef}
        className="nx-co-app-header__end"
        data-testid={CLIENT_OPERATIONS_HEADER_WORKSPACE_SLOT_TEST_ID}
      />
    </header>
  );
}
