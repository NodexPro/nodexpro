export type UiLanguageCode = 'en' | 'he';

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
    label: string;
    current_value: UiLanguageCode;
    options: Array<{ value: UiLanguageCode; label: string }>;
  };
  logout_action: {
    label: string;
    command_key: 'logout';
  };
};
