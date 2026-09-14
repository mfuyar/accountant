# Scheduled database check

The GitHub Actions workflow reads at most one project ID every three calendar
days at 13:17 UTC (days 1, 4, 7, and so on; the interval can be shorter at month
boundaries). Row-level security remains in effect; an empty result is valid.
No accounting data is changed or logged. Failed requests retry twice and then
fail the workflow. This tests anonymous database access, not signed-in permissions.

## Activate

1. In the repository's Settings → Secrets and variables → Actions, add repository
   secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`, using the corresponding
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values from your local `.env`.
   Use the browser-safe key, not a service-role key.
2. Push `scripts/check-db.mjs` and `.github/workflows/database-check.yml` to the
   repository's default branch.
3. Under Actions → Database connection check, select Run workflow to verify setup.
   Enable GitHub Actions failure notifications in your GitHub notification settings.

For a local check with Node 20.6 or newer:

```sh
node --env-file=.env scripts/check-db.mjs
```

Supabase evaluates sufficient database activity over seven days, but does not
publish a guaranteed keep-alive threshold. This check provides periodic database
activity and availability monitoring; it cannot guarantee prevention of pausing.
For guaranteed exemption from inactivity pausing, use a paid plan.
See [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

GitHub schedules can be delayed, and public repository schedules are disabled
after 60 days without repository activity. Monitor workflow execution; a paused
Supabase project must be restored from the dashboard.
See [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
