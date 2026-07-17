insert into public.admin_allowlist (email)
values ('mfuyar@gmail.com')
on conflict (email) do nothing;

-- Backfill accounts that existed before the profile trigger was installed.
insert into public.profiles (id, email, full_name, is_global_admin)
select
  users.id,
  lower(users.email),
  coalesce(users.raw_user_meta_data ->> 'full_name', split_part(users.email, '@', 1)),
  exists (
    select 1
    from public.admin_allowlist allowed
    where allowed.email = lower(users.email)
  )
from auth.users users
where users.email is not null
on conflict (id) do update
set email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    is_global_admin = public.profiles.is_global_admin or excluded.is_global_admin;

insert into public.project_members (project_id, user_id, role)
select projects.id, profiles.id, 'project_admin'
from public.profiles profiles
cross join public.projects projects
where profiles.is_global_admin
on conflict (project_id, user_id) do update set role = excluded.role;

insert into public.project_members (project_id, user_id, role)
select invitations.project_id, profiles.id, invitations.role
from public.project_invitations invitations
join public.profiles profiles on lower(profiles.email) = lower(invitations.email)
where invitations.accepted_at is null
on conflict (project_id, user_id) do update set role = excluded.role;

update public.project_invitations invitations
set accepted_at = now()
where invitations.accepted_at is null
  and exists (
    select 1
    from public.profiles profiles
    where lower(profiles.email) = lower(invitations.email)
  );

create or replace function public.ensure_my_access_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  signed_in_user auth.users%rowtype;
  global_access boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in before creating an access profile';
  end if;

  select users.* into signed_in_user
  from auth.users users
  where users.id = auth.uid();

  if not found or signed_in_user.email is null then
    raise exception 'The signed-in account does not have an email address';
  end if;

  global_access := exists (
    select 1
    from public.admin_allowlist allowed
    where allowed.email = lower(signed_in_user.email)
  );

  insert into public.profiles (id, email, full_name, is_global_admin)
  values (
    signed_in_user.id,
    lower(signed_in_user.email),
    coalesce(signed_in_user.raw_user_meta_data ->> 'full_name', split_part(signed_in_user.email, '@', 1)),
    global_access
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      is_global_admin = public.profiles.is_global_admin or excluded.is_global_admin;

  if (select profiles.is_global_admin from public.profiles profiles where profiles.id = signed_in_user.id) then
    insert into public.project_members (project_id, user_id, role)
    select projects.id, signed_in_user.id, 'project_admin'
    from public.projects projects
    on conflict (project_id, user_id) do update set role = excluded.role;
  end if;

  insert into public.project_members (project_id, user_id, role)
  select invitations.project_id, signed_in_user.id, invitations.role
  from public.project_invitations invitations
  where lower(invitations.email) = lower(signed_in_user.email)
    and invitations.accepted_at is null
  on conflict (project_id, user_id) do update set role = excluded.role;

  update public.project_invitations invitations
  set accepted_at = now()
  where lower(invitations.email) = lower(signed_in_user.email)
    and invitations.accepted_at is null;
end;
$$;

revoke all on function public.ensure_my_access_profile() from public, anon;
grant execute on function public.ensure_my_access_profile() to authenticated;
