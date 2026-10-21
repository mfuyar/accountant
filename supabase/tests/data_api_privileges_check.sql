-- Run after applying the setup SQL and all migrations. Read-only assertions.
do $$
declare
  relation_name text;
  sequence_name text;
begin
  foreach relation_name in array array[
    'admin_allowlist', 'bank_connections', 'bank_transactions', 'companies',
    'construction_cost_drafts', 'cost_categories', 'cost_subcategories',
    'cost_versions', 'documents', 'funding_sources', 'incomes', 'invoices',
    'ledger_audit_logs', 'loans', 'owners', 'payments', 'profiles',
    'project_checks', 'project_financing_transactions', 'project_invitations',
    'project_lot_commitments', 'project_members', 'projects', 'properties',
    'review_items', 'transaction_allocations', 'transactions', 'vendors'
  ] loop
    if not has_table_privilege('service_role', 'public.' || relation_name, 'SELECT')
      or not has_table_privilege('service_role', 'public.' || relation_name, 'INSERT')
      or not has_table_privilege('service_role', 'public.' || relation_name, 'UPDATE')
      or not has_table_privilege('service_role', 'public.' || relation_name, 'DELETE') then
      raise exception 'Missing backend privileges on %', relation_name;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || relation_name)::regclass) then
      raise exception 'RLS disabled on %', relation_name;
    end if;
    if relation_name <> 'bank_connections'
      and not has_table_privilege('authenticated', 'public.' || relation_name, 'SELECT') then
      raise exception 'Missing signed-in read access on %', relation_name;
    end if;
    sequence_name := null;
    if exists (select 1 from pg_attribute
      where attrelid = ('public.' || relation_name)::regclass
        and attname = 'id' and not attisdropped) then
      sequence_name := pg_get_serial_sequence('public.' || relation_name, 'id');
    end if;
    if sequence_name is not null
      and not has_sequence_privilege('service_role', sequence_name, 'USAGE') then
      raise exception 'Missing backend sequence access on %', sequence_name;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.bank_connections', 'SELECT')
    or has_table_privilege('anon', 'public.bank_connections', 'SELECT') then
    raise exception 'Bank connection secrets must remain backend-only';
  end if;
  if has_table_privilege('authenticated', 'public.cost_versions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.cost_versions', 'DELETE') then
    raise exception 'Cost history must remain append-only';
  end if;
  if not has_table_privilege('service_role', 'public.active_costs', 'SELECT') then
    raise exception 'Missing backend access to active_costs';
  end if;
end;
$$;
