/**
 * Users & Roles — presentation locale (language + text direction) and the screen text.
 *
 * The locale is decided by the backend from the organization's canonical country
 * (`organizations.country_code`). It is NOT inferred from the browser and NOT stored a second time.
 * The frontend renders `ui.text[...]`, `ui.direction` and `ui.locale` exactly as returned.
 *
 * TEMPORARY_COUNTRY_PACK_PENDING: the country → presentation mapping is a minimal table here until the
 * Country Pack framework owns presentation locale. Keep it additive and easy to migrate.
 */

export type UsersRolesLocale = 'en' | 'he';
export type UsersRolesDirection = 'ltr' | 'rtl';

export type UsersRolesPresentation = { locale: UsersRolesLocale; direction: UsersRolesDirection };

/** Countries whose Users & Roles screen is Hebrew + RTL. Every other country stays English + LTR. */
const COUNTRY_PRESENTATION: Readonly<Record<string, UsersRolesPresentation>> = {
  IL: { locale: 'he', direction: 'rtl' },
};

const DEFAULT_PRESENTATION: UsersRolesPresentation = { locale: 'en', direction: 'ltr' };

export function resolveUsersRolesPresentation(countryCode: string | null | undefined): UsersRolesPresentation {
  const code = String(countryCode ?? '').trim().toUpperCase().slice(0, 2);
  return COUNTRY_PRESENTATION[code] ?? DEFAULT_PRESENTATION;
}

export type UsersRolesText = Record<string, string>;

const EN: UsersRolesText = {
  // page
  title: 'Users & Roles',
  lead: 'Your office team: who they are, which clients and areas they can open.',
  invite_member: 'Invite member',
  select_organization: 'Select an organization.',
  loading: 'Loading…',
  something_went_wrong: 'Something went wrong. Please try again.',
  // table
  name: 'Name',
  role: 'Role',
  clients: 'Clients',
  modules: 'Modules',
  start_date: 'Start date',
  status: 'Status',
  you: 'You',
  no_members: 'No team members yet.',
  // row actions
  edit_details: 'Edit details',
  manage_clients: 'Clients',
  manage_modules: 'Modules',
  close_access: 'Close access',
  // invitations
  invitations: 'Invitations',
  email: 'Email',
  send_invitation: 'Send invitation',
  sending: 'Sending…',
  cancel: 'Cancel',
  resend: 'Resend',
  no_invitations: 'No pending invitations.',
  // edit details modal
  first_name: 'First name',
  last_name: 'Last name',
  phone: 'Phone',
  save: 'Save',
  saving: 'Saving…',
  close: 'Close',
  // clients modal
  client_access_label: 'Client access',
  all_clients: 'All clients',
  all_clients_hint: 'Every current client and every client you add later.',
  selected_clients: 'Selected clients',
  selected_clients_hint: 'Only the clients you tick below. New clients are not added automatically.',
  search_placeholder: 'Search by name or ID',
  selected_count: '{count} selected',
  clients_list_label: 'Clients',
  no_clients_found: 'No clients found.',
  catalog_truncated: 'Showing the first clients only. Use search to narrow the list.',
  // modules modal
  modules_intro: 'Choose which areas of the system this employee can open.',
  modules_list_label: 'Modules',
  no_modules_available: 'No modules are available for employees yet.',
  // close access modal
  close_access_intro:
    'This employee will no longer be able to sign in to the office. Their history, documents and past work stay exactly as they are.',
  closing: 'Closing…',
};

const HE: UsersRolesText = {
  title: 'משתמשים והרשאות',
  lead: 'צוות המשרד שלכם: מי הם, ולאילו לקוחות ואזורים במערכת יש להם גישה.',
  invite_member: 'הזמנת משתמש',
  select_organization: 'יש לבחור ארגון.',
  loading: 'טוען…',
  something_went_wrong: 'משהו השתבש. נסו שוב.',
  name: 'שם',
  role: 'תפקיד',
  clients: 'לקוחות',
  modules: 'מודולים',
  start_date: 'תאריך התחלה',
  status: 'סטטוס',
  you: 'את/ה',
  no_members: 'עדיין אין חברי צוות.',
  edit_details: 'עריכת פרטים',
  manage_clients: 'לקוחות',
  manage_modules: 'מודולים',
  close_access: 'סגירת גישה',
  invitations: 'הזמנות',
  email: 'אימייל',
  send_invitation: 'שליחת הזמנה',
  sending: 'שולח…',
  cancel: 'ביטול',
  resend: 'שליחה מחדש',
  no_invitations: 'אין הזמנות ממתינות.',
  first_name: 'שם פרטי',
  last_name: 'שם משפחה',
  phone: 'טלפון',
  save: 'שמירה',
  saving: 'שומר…',
  close: 'סגירה',
  client_access_label: 'גישה ללקוחות',
  all_clients: 'כל הלקוחות',
  all_clients_hint: 'כל הלקוחות הקיימים וכל לקוח שתוסיפו בהמשך.',
  selected_clients: 'לקוחות נבחרים',
  selected_clients_hint: 'רק הלקוחות שסימנתם למטה. לקוחות חדשים אינם נוספים אוטומטית.',
  search_placeholder: 'חיפוש לפי שם או מספר מזהה',
  selected_count: '{count} נבחרו',
  clients_list_label: 'לקוחות',
  no_clients_found: 'לא נמצאו לקוחות.',
  catalog_truncated: 'מוצגים הלקוחות הראשונים בלבד. השתמשו בחיפוש כדי לצמצם את הרשימה.',
  modules_intro: 'בחרו לאילו אזורים במערכת העובד יכול להיכנס.',
  modules_list_label: 'מודולים',
  no_modules_available: 'עדיין אין מודולים זמינים לעובדים.',
  close_access_intro:
    'העובד לא יוכל יותר להיכנס למשרד. ההיסטוריה, המסמכים והעבודה הקודמת נשארים בדיוק כפי שהם.',
  closing: 'סוגר…',
};

export const USERS_ROLES_TEXT: Readonly<Record<UsersRolesLocale, UsersRolesText>> = { en: EN, he: HE };

export type UsersRolesUi = UsersRolesPresentation & { text: UsersRolesText };

export function buildUsersRolesUi(countryCode: string | null | undefined): UsersRolesUi {
  const presentation = resolveUsersRolesPresentation(countryCode);
  return { ...presentation, text: { ...USERS_ROLES_TEXT[presentation.locale] } };
}

/* ------------------------- Row / status labels (backend-owned) ------------------------- */

export function roleLabelFor(roleCode: string, locale: UsersRolesLocale): string {
  const code = String(roleCode ?? '').trim().toLowerCase();
  const he = locale === 'he';
  switch (code) {
    case 'owner':
      return he ? 'בעלים' : 'Owner';
    case 'admin':
      return he ? 'מנהל' : 'Admin';
    case 'staff':
      return he ? 'עובד' : 'Employee';
    case 'viewer':
      return he ? 'צופה' : 'Viewer';
    default:
      return he ? 'חבר צוות' : 'Member';
  }
}

export function memberStatusLabelFor(code: 'active' | 'invited' | 'access_closed', locale: UsersRolesLocale): string {
  const he = locale === 'he';
  if (code === 'active') return he ? 'פעיל' : 'Active';
  if (code === 'invited') return he ? 'הוזמן' : 'Invited';
  return he ? 'גישה סגורה' : 'Access closed';
}

export function invitationStatusLabelFor(code: 'invited' | 'accepted' | 'expired' | 'cancelled', locale: UsersRolesLocale): string {
  const he = locale === 'he';
  if (code === 'invited') return he ? 'הוזמן' : 'Invited';
  if (code === 'accepted') return he ? 'התקבלה' : 'Accepted';
  if (code === 'expired') return he ? 'פג תוקף' : 'Expired';
  return he ? 'בוטלה' : 'Cancelled';
}

export function allClientsSummaryFor(locale: UsersRolesLocale): string {
  return locale === 'he' ? 'כל הלקוחות' : 'All clients';
}

export function selectedClientsSummaryFor(count: number, locale: UsersRolesLocale): string {
  return locale === 'he' ? `לקוחות נבחרים · ${count}` : `Selected clients · ${count}`;
}

export function noAccessSummaryFor(locale: UsersRolesLocale): string {
  return locale === 'he' ? 'אין גישה' : 'No access';
}

export function allOfficeModulesSummaryFor(locale: UsersRolesLocale): string {
  return locale === 'he' ? 'כל מודולי המשרד' : 'All office modules';
}

export function noModulesSummaryFor(locale: UsersRolesLocale): string {
  return locale === 'he' ? 'אין מודולים' : 'No modules';
}

/** "Sent 2026-10-01 · 3×" — composed by the backend so the screen only renders it. */
export function invitationSentSummaryFor(
  params: { lastSentDate: string | null; sendCount: number },
  locale: UsersRolesLocale,
): string {
  const head = params.lastSentDate ? (locale === 'he' ? `נשלח ${params.lastSentDate}` : `Sent ${params.lastSentDate}`) : '';
  const tail = params.sendCount > 1 ? ` · ${params.sendCount}×` : '';
  return `${head}${tail}`;
}

export function cancelInvitationConfirmFor(email: string, locale: UsersRolesLocale): string {
  return locale === 'he' ? `לבטל את ההזמנה עבור ${email}?` : `Cancel the invitation for ${email}?`;
}

/** Close-access blocker sentence. Counts come from the backend close-access blockers. */
export function closeAccessBlockedMessageFor(
  blockers: { handler_client_count: number; open_todo_count: number },
  locale: UsersRolesLocale,
): string | null {
  const clients = blockers.handler_client_count;
  const todos = blockers.open_todo_count;
  if (clients <= 0 && todos <= 0) return null;
  if (locale === 'he') {
    const parts: string[] = [];
    if (clients > 0) parts.push(clients === 1 ? 'לקוח אחד באחריות העובד' : `${clients} לקוחות באחריות העובד`);
    if (todos > 0) parts.push(todos === 1 ? 'משימה פתוחה אחת המשויכת לעובד' : `${todos} משימות פתוחות המשויכות לעובד`);
    return `לעובד עדיין יש ${parts.join(' ו')}. יש להעביר אותם לאחריות אחרת ואז לסגור את הגישה.`;
  }
  const parts: string[] = [];
  if (clients > 0) parts.push(`${clients} ${clients === 1 ? 'client' : 'clients'} handled by this employee`);
  if (todos > 0) parts.push(`${todos} open ${todos === 1 ? 'task' : 'tasks'} assigned to this employee`);
  return `This employee still has ${parts.join(' and ')}. Reassign them first, then close access.`;
}
