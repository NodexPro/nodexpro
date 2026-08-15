-- Accounting Base first-class customer credit + atomic tax-invoice credit consume.
-- Does not refund money, reverse payments, or mutate issued invoices.
-- Migration 161 is left unchanged (lineage/control tables).

create table if not exists public.accounting_customer_credits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  issuer_business_id uuid not null,
  represented_client_id uuid,
  income_customer_id uuid,
  source_invoice_id uuid not null references public.income_documents (id) on delete restrict,
  source_credit_document_id uuid not null references public.income_documents (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  currency char(3) not null,
  status text not null default 'open'
    check (status in ('open', 'applied', 'refunded', 'reversed')),
  lineage_json jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounting_customer_credits_org_credit_doc_unique
    unique (organization_id, source_credit_document_id),
  constraint accounting_customer_credits_org_idempotency_unique
    unique (organization_id, idempotency_key)
);

create index if not exists idx_accounting_customer_credits_org_customer_open
  on public.accounting_customer_credits (
    organization_id,
    income_customer_id,
    status
  );

create index if not exists idx_accounting_customer_credits_org_invoice
  on public.accounting_customer_credits (organization_id, source_invoice_id, status);

alter table public.accounting_customer_credits enable row level security;

drop policy if exists accounting_customer_credits_select_org_member on public.accounting_customer_credits;
create policy accounting_customer_credits_select_org_member
  on public.accounting_customer_credits for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- Consume remaining-creditable + line controls + optional customer credit in one transaction.
create or replace function public.accounting_base_consume_income_tax_invoice_credit(
  p_organization_id uuid,
  p_draft_id uuid,
  p_issued_document_id uuid,
  p_requested_amount numeric,
  p_lines jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_control record;
  v_line record;
  v_req record;
  v_allocated numeric(14, 2);
  v_next_credited numeric(14, 2);
  v_remaining numeric(14, 2);
  v_net numeric(14, 2);
  v_customer_credit numeric(14, 2);
  v_credit_id uuid;
  v_invoice record;
begin
  if p_organization_id is null or p_draft_id is null or p_issued_document_id is null then
    raise exception 'CREDIT_CONSUME_ARGS_REQUIRED' using errcode = '22023';
  end if;
  if p_requested_amount is null or p_requested_amount <= 0 then
    raise exception 'CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE' using errcode = 'P0001';
  end if;

  select *
    into v_link
  from public.income_document_credit_links
  where organization_id = p_organization_id
    and credit_draft_id = p_draft_id
  for update;

  if v_link.id is null then
    raise exception 'CREDIT_LINEAGE_INCOMPLETE' using errcode = 'P0002';
  end if;

  if v_link.status = 'issued' and v_link.credit_document_id = p_issued_document_id then
    select c.id, c.amount
      into v_credit_id, v_customer_credit
    from public.accounting_customer_credits c
    where c.organization_id = p_organization_id
      and c.source_credit_document_id = p_issued_document_id
      and c.status = 'open'
    limit 1;

    select original_amount_reference, credited_amount_reference
      into v_control
    from public.income_invoice_credit_control
    where organization_id = p_organization_id
      and source_invoice_id = v_link.source_invoice_id;

    v_remaining := greatest(0, round(coalesce(v_control.original_amount_reference, 0) - coalesce(v_control.credited_amount_reference, 0), 2));

    return jsonb_build_object(
      'replay', true,
      'source_invoice_id', v_link.source_invoice_id,
      'credited_amount_reference', round(p_requested_amount::numeric, 2),
      'remaining_creditable_amount', v_remaining,
      'remaining_receivable', null,
      'customer_credit_amount', coalesce(v_customer_credit, 0),
      'customer_credit_id', v_credit_id
    );
  end if;

  if v_link.status = 'issued' then
    raise exception 'CREDIT_LINK_ALREADY_ISSUED' using errcode = '23505';
  end if;

  select *
    into v_control
  from public.income_invoice_credit_control
  where organization_id = p_organization_id
    and source_invoice_id = v_link.source_invoice_id
  for update;

  if v_control.source_invoice_id is null then
    raise exception 'CREDIT_CONTROL_MISSING' using errcode = 'P0002';
  end if;

  v_remaining := round(v_control.original_amount_reference - v_control.credited_amount_reference, 2);
  if round(p_requested_amount::numeric, 2) - v_remaining > 0.005 then
    raise exception 'CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE' using errcode = 'P0001';
  end if;

  v_next_credited := round(v_control.credited_amount_reference + p_requested_amount, 2);

  update public.income_invoice_credit_control
    set credited_amount_reference = v_next_credited,
        updated_at = now()
  where organization_id = p_organization_id
    and source_invoice_id = v_link.source_invoice_id;

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for v_req in
      select
        coalesce(nullif(btrim(x->>'source_line_identity'), ''), '') as source_line_identity,
        coalesce((x->>'quantity')::numeric, 0) as quantity,
        coalesce((x->>'amount')::numeric, 0) as amount
      from jsonb_array_elements(p_lines) as x
    loop
      if v_req.source_line_identity = '' then
        raise exception 'CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE' using errcode = 'P0001';
      end if;

      select *
        into v_line
      from public.income_invoice_credit_line_control
      where organization_id = p_organization_id
        and source_invoice_id = v_link.source_invoice_id
        and source_line_identity = v_req.source_line_identity
      for update;

      if v_line.source_line_identity is null then
        raise exception 'CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE' using errcode = 'P0001';
      end if;

      if v_req.quantity - (v_line.original_quantity - v_line.credited_quantity) > 0.0009
         or v_req.amount - (v_line.original_amount_reference - v_line.credited_amount_reference) > 0.005 then
        raise exception 'CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE' using errcode = 'P0001';
      end if;

      update public.income_invoice_credit_line_control
        set credited_quantity = v_line.credited_quantity + v_req.quantity,
            credited_amount_reference = round(v_line.credited_amount_reference + v_req.amount, 2),
            updated_at = now()
      where organization_id = p_organization_id
        and source_invoice_id = v_link.source_invoice_id
        and source_line_identity = v_req.source_line_identity;
    end loop;
  end if;

  update public.income_document_credit_links
    set credit_document_id = p_issued_document_id,
        status = 'issued',
        credited_amount_reference = round(p_requested_amount::numeric, 2),
        issued_at = now()
  where id = v_link.id
    and organization_id = p_organization_id
    and status = 'draft';

  select
    d.issuer_business_id,
    d.represented_client_id,
    d.income_customer_id,
    coalesce(nullif(btrim(d.currency), ''), 'ILS') as currency
    into v_invoice
  from public.income_documents d
  where d.organization_id = p_organization_id
    and d.id = v_link.source_invoice_id;

  select coalesce(sum(a.allocated_amount), 0)
    into v_allocated
  from public.accounting_payment_allocations a
  where a.organization_id = p_organization_id
    and a.source_module = 'income'
    and a.source_entity_id = v_link.source_invoice_id
    and a.status = 'posted'
    and a.reversal_of_allocation_id is null;

  v_net := greatest(0, round(v_control.original_amount_reference - v_next_credited, 2));
  v_customer_credit := greatest(0, round(v_allocated - v_net, 2));
  v_remaining := greatest(0, round(v_control.original_amount_reference - v_next_credited, 2));

  if v_customer_credit > 0.005 then
    insert into public.accounting_customer_credits (
      organization_id,
      issuer_business_id,
      represented_client_id,
      income_customer_id,
      source_invoice_id,
      source_credit_document_id,
      amount,
      currency,
      status,
      lineage_json,
      idempotency_key,
      created_by
    ) values (
      p_organization_id,
      v_invoice.issuer_business_id,
      v_invoice.represented_client_id,
      v_invoice.income_customer_id,
      v_link.source_invoice_id,
      p_issued_document_id,
      v_customer_credit,
      v_invoice.currency,
      'open',
      jsonb_build_object(
        'source_invoice_id', v_link.source_invoice_id,
        'source_credit_document_id', p_issued_document_id,
        'credit_draft_id', p_draft_id,
        'allocated_payments', v_allocated,
        'net_invoice_amount', v_net
      ),
      'credit-note:' || p_issued_document_id::text,
      p_created_by
    )
    on conflict (organization_id, source_credit_document_id) do update
      set amount = excluded.amount,
          status = 'open',
          updated_at = now()
    returning id into v_credit_id;
  end if;

  return jsonb_build_object(
    'replay', false,
    'source_invoice_id', v_link.source_invoice_id,
    'credited_amount_reference', round(p_requested_amount::numeric, 2),
    'remaining_creditable_amount', v_remaining,
    'remaining_receivable', greatest(0, round(v_net - v_allocated, 2)),
    'customer_credit_amount', v_customer_credit,
    'customer_credit_id', v_credit_id
  );
end;
$$;

create or replace function public.accounting_base_reverse_income_tax_invoice_credit_consume(
  p_organization_id uuid,
  p_draft_id uuid,
  p_issued_document_id uuid,
  p_requested_amount numeric,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_control record;
  v_req record;
  v_line record;
begin
  select *
    into v_link
  from public.income_document_credit_links
  where organization_id = p_organization_id
    and credit_draft_id = p_draft_id
  for update;

  if v_link.id is null then
    return jsonb_build_object('reversed', false);
  end if;

  select *
    into v_control
  from public.income_invoice_credit_control
  where organization_id = p_organization_id
    and source_invoice_id = v_link.source_invoice_id
  for update;

  if v_control.source_invoice_id is not null then
    update public.income_invoice_credit_control
      set credited_amount_reference = greatest(0, round(v_control.credited_amount_reference - coalesce(p_requested_amount, 0), 2)),
          updated_at = now()
    where organization_id = p_organization_id
      and source_invoice_id = v_link.source_invoice_id;
  end if;

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for v_req in
      select
        coalesce(nullif(btrim(x->>'source_line_identity'), ''), '') as source_line_identity,
        coalesce((x->>'quantity')::numeric, 0) as quantity,
        coalesce((x->>'amount')::numeric, 0) as amount
      from jsonb_array_elements(p_lines) as x
    loop
      if v_req.source_line_identity = '' then
        continue;
      end if;
      select *
        into v_line
      from public.income_invoice_credit_line_control
      where organization_id = p_organization_id
        and source_invoice_id = v_link.source_invoice_id
        and source_line_identity = v_req.source_line_identity
      for update;
      if v_line.source_line_identity is null then
        continue;
      end if;
      update public.income_invoice_credit_line_control
        set credited_quantity = greatest(0, v_line.credited_quantity - v_req.quantity),
            credited_amount_reference = greatest(0, round(v_line.credited_amount_reference - v_req.amount, 2)),
            updated_at = now()
      where organization_id = p_organization_id
        and source_invoice_id = v_link.source_invoice_id
        and source_line_identity = v_req.source_line_identity;
    end loop;
  end if;

  update public.income_document_credit_links
    set credit_document_id = null,
        status = 'draft',
        credited_amount_reference = null,
        issued_at = null
  where id = v_link.id
    and organization_id = p_organization_id;

  if p_issued_document_id is not null then
    update public.accounting_customer_credits
      set status = 'reversed',
          updated_at = now()
    where organization_id = p_organization_id
      and source_credit_document_id = p_issued_document_id
      and status = 'open';
  end if;

  return jsonb_build_object('reversed', true);
end;
$$;

grant execute on function public.accounting_base_consume_income_tax_invoice_credit(
  uuid, uuid, uuid, numeric, jsonb, uuid
) to service_role;

grant execute on function public.accounting_base_reverse_income_tax_invoice_credit_consume(
  uuid, uuid, uuid, numeric, jsonb
) to service_role;
