/** Mirrors `ClientDocumentsTabResponse` from API — single source for the מסמכים tab read model inside the client case aggregate. */

export type ClientDocumentsBrandVariant = 'primary' | 'secondary' | 'neutral';

export type ClientDocumentsTabFolderCardDto = {
  folder_id: string;
  name_he: string;
  document_count: number;
  last_updated_at: string | null;
  last_updated_display_he: string;
  is_system: boolean;
  brand_variant: ClientDocumentsBrandVariant;
  actions: {
    can_open: boolean;
    can_rename: boolean;
    can_archive_or_delete: boolean;
  };
};

export type ClientDocumentsTabDocumentRowDto = {
  document_id: string;
  file_asset_id: string | null;
  file_name_he: string | null;
  display_label_he: string | null;
  uploaded_display_he: string;
  file_open_allowed: boolean;
  actions: { can_view: boolean; can_delete: boolean };
};

export type ClientDocumentsTabModel = {
  tab_key: 'client_documents';
  read_model_version: number;
  permissions: { can_view: boolean; can_edit: boolean };
  ui: {
    add_folder_label_he: string;
    add_document_label_he: string;
    empty_folders_state_he: string;
    empty_documents_state_he: string;
    tab_title_he: string;
  };
  folders_grid: {
    columns_per_row: 3;
    folders: ClientDocumentsTabFolderCardDto[];
  };
  open_folder: null | {
    folder_id: string;
    folder_name_he: string;
    documents: ClientDocumentsTabDocumentRowDto[];
  };
  file_open_path_template: string;
};
