-- Client Operations VAT: file (and optionally attest paid_in_full) in one DB transaction.
-- Filing truth stays on client_obligations. Payment truth stays on Accounting Base
-- accounting_tax_obligation_payment_facts. Do not invent statutory due dates.
-- Depends on 213 for NULL due_date. Idempotent create-or-replace.
-- Execute granted to service_role only (API supabaseAdmin).

create or replace function public.file_client_operations_period_vat_obligation(
  p_organization_id uuid,
  p_client_id uuid,
  p_actor_user_id uuid,
  p_period_key text,
  p_operational_period_key text,
  p_due_date date,
  p_obligation_id uuid,
  p_report_date date,
  p_now timestamptz,
  p_pay boolean,
  p_canonical_id text,
  p_payment_classification text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_report_date date := coalesce(p_report_date, (timezone('Asia/Jerusalem', v_now))::date);
  v_period_key text := btrim(coalesce(p_period_key, ''));
  v_operational_period_key text := btrim(coalesce(p_operational_period_key, ''));
  v_canonical_id text := btrim(coalesce(p_canonical_id, ''));
  v_pay boolean := coalesce(p_pay, false);
  v_row public.client_obligations%rowtype;
  v_has_obligation boolean := false;
  v_pay_class text;
  v_status text;
  v_due date;
  v_next_status text;
  v_created boolean := false;
  v_filed boolean := false;
  v_paid boolean := false;
  v_previous_status text;
  v_previous_is_active boolean;
  v_previous_last_reported_at timestamptz;
  v_confirmable boolean;
  v_submitted boolean;
  v_not_applicable boolean;
begin
  if p_organization_id is null
     or p_client_id is null
     or p_actor_user_id is null
     or v_period_key = ''
     or v_operational_period_key = ''
  then
    raise exception 'VAT_FILE_INVALID_ARGS';
  end if;

  if not exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.organization_id = p_organization_id
  ) then
    raise exception 'VAT_FILE_INVALID_ARGS';
  end if;

  if v_pay then
    if v_canonical_id = '' then
      raise exception 'VAT_FILE_INVALID_ARGS';
    end if;
    if btrim(coalesce(p_payment_classification, '')) is distinct from 'paid_in_full' then
      raise exception 'VAT_FILE_PAY_REQUIRES_CLASSIFICATION';
    end if;
  end if;

  if p_obligation_id is not null then
    select *
      into v_row
    from public.client_obligations
    where organization_id = p_organization_id
      and client_id = p_client_id
      and obligation_type = 'vat_report'
      and id = p_obligation_id
    for update;
    if not found then
      raise exception 'VAT_FILE_NOT_FOUND';
    end if;
    if v_row.period_key is distinct from v_period_key then
      raise exception 'VAT_FILE_PERIOD_MISMATCH';
    end if;
    v_has_obligation := true;
  else
    select *
      into v_row
    from public.client_obligations
    where organization_id = p_organization_id
      and client_id = p_client_id
      and obligation_type = 'vat_report'
      and period_key = v_period_key
    for update;
    v_has_obligation := found;
  end if;

  if v_pay then
    select payment_classification
      into v_pay_class
    from public.accounting_tax_obligation_payment_facts
    where organization_id = p_organization_id
      and client_id = p_client_id
      and obligation_canonical_id = v_canonical_id
    for update;
    if found and v_pay_class = 'paid_in_full' then
      raise exception 'VAT_FILE_PAYMENT_ALREADY_CONFIRMED';
    end if;
  end if;

  if v_has_obligation then
    v_status := coalesce(v_row.status, '');
    v_previous_status := v_row.status;
    v_previous_is_active := v_row.is_active;
    v_previous_last_reported_at := v_row.last_reported_at;
    v_submitted := v_status in (
      'reported',
      'reported_late',
      'reported_and_paid',
      'paid_on_time',
      'paid_late'
    );
    v_not_applicable := v_status = 'not_relevant';
    v_confirmable := v_status = '' or v_status in (
      'ready_to_report',
      'ready_to_process',
      'missing_data',
      'waiting_for_material',
      'waiting_for_income_data',
      'waiting_client_response',
      'not_reported'
    );

    if v_not_applicable then
      raise exception 'VAT_FILE_NOT_READY';
    end if;

    if not v_submitted then
      if not v_confirmable then
        raise exception 'VAT_FILE_NOT_READY';
      end if;
      v_due := coalesce(v_row.due_date, p_due_date);
      v_next_status := case
        when v_due is not null and v_report_date > v_due then 'reported_late'
        else 'reported'
      end;
      update public.client_obligations
      set
        status = v_next_status,
        last_reported_at = v_now,
        is_active = true,
        updated_at = v_now
      where id = v_row.id
        and organization_id = p_organization_id
        and client_id = p_client_id
        and status is not distinct from v_row.status;
      if not found then
        raise exception 'VAT_FILE_NOT_READY';
      end if;
      v_filed := true;
    end if;
  else
    v_next_status := case
      when p_due_date is not null and v_report_date > p_due_date then 'reported_late'
      else 'reported'
    end;
    begin
      insert into public.client_obligations (
        organization_id,
        client_id,
        obligation_type,
        period_key,
        due_date,
        status,
        blocking_reason,
        docflow_message_sent_at,
        last_reported_at,
        related_module,
        is_active,
        closed_at,
        updated_at
      ) values (
        p_organization_id,
        p_client_id,
        'vat_report',
        v_period_key,
        p_due_date,
        v_next_status,
        null,
        null,
        v_now,
        'vat',
        true,
        null,
        v_now
      )
      returning * into v_row;
      v_created := true;
      v_filed := true;
      v_previous_status := null;
      v_previous_is_active := null;
      v_previous_last_reported_at := null;
    exception
      when unique_violation then
        select *
          into v_row
        from public.client_obligations
        where organization_id = p_organization_id
          and client_id = p_client_id
          and obligation_type = 'vat_report'
          and period_key = v_period_key
        for update;
        if not found then
          raise;
        end if;
        v_status := coalesce(v_row.status, '');
        v_previous_status := v_row.status;
        v_previous_is_active := v_row.is_active;
        v_previous_last_reported_at := v_row.last_reported_at;
        v_submitted := v_status in (
          'reported',
          'reported_late',
          'reported_and_paid',
          'paid_on_time',
          'paid_late'
        );
        v_not_applicable := v_status = 'not_relevant';
        v_confirmable := v_status = '' or v_status in (
          'ready_to_report',
          'ready_to_process',
          'missing_data',
          'waiting_for_material',
          'waiting_for_income_data',
          'waiting_client_response',
          'not_reported'
        );
        if v_not_applicable or (not v_submitted and not v_confirmable) then
          raise exception 'VAT_FILE_NOT_READY';
        end if;
        if not v_submitted then
          v_due := coalesce(v_row.due_date, p_due_date);
          v_next_status := case
            when v_due is not null and v_report_date > v_due then 'reported_late'
            else 'reported'
          end;
          update public.client_obligations
          set
            status = v_next_status,
            last_reported_at = v_now,
            is_active = true,
            updated_at = v_now
          where id = v_row.id
            and organization_id = p_organization_id
            and client_id = p_client_id;
          v_filed := true;
        end if;
    end;
  end if;

  if v_pay then
    insert into public.accounting_tax_obligation_payment_facts (
      organization_id,
      client_id,
      obligation_canonical_id,
      obligation_kind,
      operational_period_key,
      obligation_period_key,
      source_obligation_id,
      payment_classification,
      provenance,
      bank_verified,
      amount_paid,
      amount_remaining,
      payment_due_date,
      attested_by,
      attested_at,
      updated_at
    ) values (
      p_organization_id,
      p_client_id,
      v_canonical_id,
      'vat',
      v_operational_period_key,
      v_period_key,
      v_row.id,
      'paid_in_full',
      'user_attested',
      false,
      null,
      null,
      null,
      p_actor_user_id,
      v_now,
      v_now
    )
    on conflict (organization_id, client_id, obligation_canonical_id)
    do update set
      payment_classification = excluded.payment_classification,
      obligation_kind = excluded.obligation_kind,
      operational_period_key = excluded.operational_period_key,
      obligation_period_key = excluded.obligation_period_key,
      source_obligation_id = excluded.source_obligation_id,
      attested_by = excluded.attested_by,
      attested_at = excluded.attested_at,
      updated_at = excluded.updated_at,
      provenance = 'user_attested',
      bank_verified = false,
      amount_paid = null,
      amount_remaining = null;
    v_paid := true;
  end if;

  return jsonb_build_object(
    'obligation_id', v_row.id,
    'period_key', v_period_key,
    'created', v_created,
    'filed', v_filed,
    'paid', v_paid,
    'previous_status', v_previous_status,
    'previous_is_active', v_previous_is_active,
    'previous_last_reported_at', v_previous_last_reported_at
  );
end;
$$;

comment on function public.file_client_operations_period_vat_obligation(
  uuid, uuid, uuid, text, text, date, uuid, date, timestamptz, boolean, text, text
) is
  'Atomic Client Operations VAT file, with optional paid_in_full attestation. due_date is calendar-or-null; never invented.';

revoke all on function public.file_client_operations_period_vat_obligation(
  uuid, uuid, uuid, text, text, date, uuid, date, timestamptz, boolean, text, text
) from public;

grant execute on function public.file_client_operations_period_vat_obligation(
  uuid, uuid, uuid, text, text, date, uuid, date, timestamptz, boolean, text, text
) to service_role;
