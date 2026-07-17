alter function public.assign_project_admin(bigint, text) security invoker;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;
