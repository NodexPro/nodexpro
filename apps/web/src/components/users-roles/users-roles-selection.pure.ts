/**
 * Users & Roles — purely visual helpers for modal drafts.
 * No authorization, no role logic, no ACL calculation: the backend decides what is allowed and
 * validates every command. These helpers only filter a list the backend already authorized and
 * keep the checkbox draft the user is editing.
 */

export type CatalogClient = { client_id: string; display_name: string; tax_id: string | null };

/** Case-insensitive search over the backend-authorized client list (visual filter only). */
export function filterCatalogClients<T extends CatalogClient>(clients: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...clients];
  return clients.filter(
    (c) => c.display_name.toLowerCase().includes(needle) || String(c.tax_id ?? '').toLowerCase().includes(needle),
  );
}

export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Command payload for set_member_client_access. SELECTED with nothing ticked is valid (zero clients). */
export function buildClientAccessPayload(mode: 'all' | 'selected', selected: ReadonlySet<string>) {
  return {
    access_mode: mode,
    selected_client_ids: mode === 'selected' ? [...selected] : [],
  };
}

/** Only the ids the backend marked `member_assignable` and the user ticked. */
export function buildModuleAccessPayload(
  modules: ReadonlyArray<{ module_id: string; member_assignable: boolean }>,
  checked: ReadonlySet<string>,
): string[] {
  return modules.filter((m) => m.member_assignable && checked.has(m.module_id)).map((m) => m.module_id);
}

export function initialModuleDraft(
  modules: ReadonlyArray<{ module_id: string; member_assignable: boolean; member_enabled: boolean }>,
): Set<string> {
  return new Set(modules.filter((m) => m.member_assignable && m.member_enabled).map((m) => m.module_id));
}

/** Screen text delivered by the backend aggregate (`ui`). Language and direction are never decided here. */
export type UsersRolesUi = {
  locale: 'en' | 'he';
  direction: 'ltr' | 'rtl';
  text: Record<string, string>;
};

export function uiText(ui: UsersRolesUi, key: string): string {
  return ui.text[key] ?? key;
}

/** Fills the `{count}` slot of a backend text with the draft count the user is looking at (display only). */
export function fillCount(template: string, count: number): string {
  return template.replace('{count}', String(count));
}
