/** Use in .tsx files — `Record<…>` is misparsed as JSX in TSX. */
export type UnknownRecord = Record<string, unknown>;
export type StringFieldMap = Record<string, string>;

export type OwnerCommandResponse = {
  ok: true;
  command: string;
  refreshed: {
    aggregate_key: 'owner_legal_control_panel_aggregate' | 'organization_country_settings_aggregate';
    aggregate: UnknownRecord;
  };
};
