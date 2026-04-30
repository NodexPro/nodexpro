-- Remove deprecated expense types רכב / דלק from client expense selections (handled in vehicles / elsewhere).
delete from public.client_accounting_expense_items
where expense_type_code in ('fuel', 'vehicle');
