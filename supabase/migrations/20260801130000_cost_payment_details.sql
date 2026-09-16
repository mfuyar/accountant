alter table public.cost_versions
  add column if not exists payment_fee_percentage numeric(5,2),
  add column if not exists payment_date date;

alter table public.cost_versions
  drop constraint if exists cost_versions_payment_fee_percentage_check;
alter table public.cost_versions
  add constraint cost_versions_payment_fee_percentage_check
  check (payment_fee_percentage is null or payment_fee_percentage between 0 and 100);

create or replace function public.create_cost_version_v6(
  p_project_id bigint,
  p_cost_id uuid,
  p_parent_cost_id uuid,
  p_owner_id bigint,
  p_name text,
  p_amount numeric,
  p_phase text,
  p_category text,
  p_lot_allocations jsonb,
  p_cost_date date,
  p_attachments jsonb default '[]'::jsonb,
  p_deleted boolean default false,
  p_details text default null,
  p_construction_draft_id uuid default null,
  p_payment_method text default null,
  p_payment_fee_percentage numeric default null,
  p_payment_date date default null
)
returns public.cost_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_version integer;
  allocation_total numeric;
  result public.cost_versions;
begin
  if not private.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to manage this project';
  end if;

  if p_payment_fee_percentage is not null and (p_payment_fee_percentage < 0 or p_payment_fee_percentage > 100) then
    raise exception 'Payment fee percentage must be between 0 and 100';
  end if;

  if p_construction_draft_id is not null and not exists (
    select 1 from public.construction_cost_drafts draft
    where draft.id = p_construction_draft_id and draft.project_id = p_project_id
  ) then
    raise exception 'The construction job does not exist in this project';
  end if;

  if jsonb_typeof(coalesce(p_lot_allocations, '[]'::jsonb)) <> 'array' then
    raise exception 'Lot allocations must be an array';
  end if;

  select coalesce(sum((item->>'amount')::numeric), 0)
    into allocation_total
  from jsonb_array_elements(coalesce(p_lot_allocations, '[]'::jsonb)) item;

  if jsonb_array_length(coalesce(p_lot_allocations, '[]'::jsonb)) > 0
     and abs(allocation_total - p_amount) > 0.009 then
    raise exception 'Lot allocations must equal the cost amount';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_lot_allocations, '[]'::jsonb)) item
    where coalesce(item->>'lot', '') = '' or coalesce((item->>'amount')::numeric, 0) <= 0
  ) then
    raise exception 'Each lot allocation requires a lot and a positive amount';
  end if;

  if p_parent_cost_id is not null and not exists (
    select 1 from public.cost_versions parent
    where parent.project_id = p_project_id and parent.cost_id = p_parent_cost_id
  ) then
    raise exception 'The parent cost does not exist in this project';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cost_id::text, 0));
  select coalesce(max(version), 0) + 1 into next_version
  from public.cost_versions where cost_id = p_cost_id and project_id = p_project_id;

  insert into public.cost_versions (
    cost_id, parent_cost_id, project_id, owner_id, version, name, details,
    construction_draft_id, payment_method, payment_fee_percentage, payment_date,
    amount, phase, category, lot_allocations, cost_date, attachments, deleted_at
  ) values (
    p_cost_id, p_parent_cost_id, p_project_id, p_owner_id, next_version,
    trim(p_name), nullif(trim(p_details), ''), p_construction_draft_id,
    nullif(trim(p_payment_method), ''), p_payment_fee_percentage, p_payment_date,
    p_amount, p_phase, nullif(trim(p_category), ''),
    coalesce(p_lot_allocations, '[]'::jsonb), p_cost_date,
    coalesce(p_attachments, '[]'::jsonb), case when p_deleted then now() else null end
  ) returning * into result;
  return result;
end;
$$;

grant execute on function public.create_cost_version_v6(bigint, uuid, uuid, bigint, text, numeric, text, text, jsonb, date, jsonb, boolean, text, uuid, text, numeric, date)
  to authenticated;
revoke all on function public.create_cost_version_v6(bigint, uuid, uuid, bigint, text, numeric, text, text, jsonb, date, jsonb, boolean, text, uuid, text, numeric, date)
  from public, anon;
