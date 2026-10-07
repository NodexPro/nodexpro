import { createContext, useContext } from 'react';

/**
 * Client Operations — header search slot (presentation only).
 *
 * The route header (TemplateLayout → ClientOperationsAppHeader) exposes an empty
 * DOM slot in its centre. The registry view portals its EXISTING search field
 * into that slot, so the search keeps one owner: the same `searchDraft` state,
 * debounce, clear and aggregate `onQueryChange` path. No second search state.
 *
 * `null` = no slot available (route without the CO header, or fullscreen sheet
 * covering the header) → the view renders the same field inline in its toolbar.
 */
export const ClientOperationsHeaderSearchSlotContext = createContext<HTMLElement | null>(null);

export function useClientOperationsHeaderSearchSlot(): HTMLElement | null {
  return useContext(ClientOperationsHeaderSearchSlotContext);
}

export const CLIENT_OPERATIONS_HEADER_SEARCH_SLOT_TEST_ID = 'client-operations-header-search-slot';

/**
 * Client Operations — header workspace selector slot (presentation only).
 * Registry portals the backend-owned workspace `<select>` into the header end area.
 */
export const ClientOperationsHeaderWorkspaceSlotContext = createContext<HTMLElement | null>(null);

export function useClientOperationsHeaderWorkspaceSlot(): HTMLElement | null {
  return useContext(ClientOperationsHeaderWorkspaceSlotContext);
}

export const CLIENT_OPERATIONS_HEADER_WORKSPACE_SLOT_TEST_ID =
  'client-operations-header-workspace-slot';
