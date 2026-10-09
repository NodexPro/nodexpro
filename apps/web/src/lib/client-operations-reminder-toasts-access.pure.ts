/** Client Operations module code in session `enabledModules`. */
export const CLIENT_OPERATIONS_MODULE_CODE = 'client-operations' as const;

/** Permission required by GET /m/client-operations/reminders/due. */
export const CLIENT_OPERATIONS_REMINDERS_VIEW_PERMISSION = 'client_operations.view' as const;

/**
 * Gate for global ReminderToasts — must match backend:
 * requireModuleActive('client-operations') + requirePermission('client_operations.view').
 */
export function isClientOperationsReminderToastsEnabled(params: {
  enabledModules: readonly string[] | null | undefined;
  permissions: readonly string[] | null | undefined;
}): boolean {
  const enabledModules = params.enabledModules ?? [];
  const permissions = params.permissions ?? [];
  return (
    enabledModules.includes(CLIENT_OPERATIONS_MODULE_CODE) &&
    permissions.includes(CLIENT_OPERATIONS_REMINDERS_VIEW_PERMISSION)
  );
}
