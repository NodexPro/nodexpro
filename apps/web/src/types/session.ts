export type UiLanguageCode = 'en' | 'he';

export type ShellProfile = 'income_only' | 'full_platform' | 'worker' | 'closed';

export interface SessionNavItemDto {
  path: string;
  label: string;
  order: number;
}

export type SidebarAccountBlockModel = {
  organization_name: string | null;
  user_display_name: string;
  user_email: string;
  organization_switcher: {
    visible: boolean;
    label: string;
    organizations: Array<{ organization_id: string; name: string; selected: boolean }>;
  };
  language_selector: {
    /** Backend-owned. Anything other than 	rue hides the control (capability stays in the system). */
    visible?: boolean;
    label: string;
    current_value: UiLanguageCode;
    options: Array<{ value: UiLanguageCode; label: string }>;
  };
  logout_action: {
    /** false for employees (sign-out is not shown in the sidebar). */
    visible?: boolean;
    label: string;
    command_key: 'logout';
  };
  /** Employee-only office identity block. */
  office_context?: { visible: boolean; label: string; name: string | null };
  /** Employee workspace top line (backend-composed: first name + locale). */
  workspace_greeting?: { text: string; direction: 'ltr' | 'rtl' } | null;
};
