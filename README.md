# Greenfort Accountant

React/Vite accounting workspace backed by Supabase.

## Local setup

Copy `.env.example` to `.env` and configure only the browser-safe Supabase URL and
anonymous/publishable key as `VITE_` variables. Never put service-role or third-party
API secrets in a `VITE_` variable; Vite embeds those values in the public browser bundle.

Configure these server-side secrets on the Supabase Edge Functions:

- `GEMINI_API_KEY`
- `GEMINI_MODEL` (optional)
- `ALLOWED_REDIRECT_ORIGINS` — comma-separated trusted application origins, such as
  `https://accounting.example.com,http://localhost:5173`
- `RESEND_API_KEY` and `REMINDER_EMAIL_FROM` — required to send the initiating
  administrator a confirmation copy of admin reminder emails. The From value must use
  a verified sending domain, for example `Greenfort Accountant <access@example.com>`.
- `PLAID_CLIENT_ID` and `PLAID_SECRET` — Plaid server credentials for the read-only
  Bank of America connection.
- `PLAID_ENV` — `sandbox`, `development`, or `production`. Start with `sandbox` and
  use `production` only after Plaid approves production access and Bank of America OAuth.
- `PLAID_TOKEN_ENCRYPTION_KEY` — a private random value of at least 32 characters used
  to encrypt Plaid access tokens before database storage. Rotating it requires a planned
  re-encryption or reconnection of existing bank connections.
- `PLAID_REDIRECT_URI` — the exact HTTPS OAuth redirect registered in the Plaid Dashboard.
  For local Sandbox testing this may be omitted; Bank of America production OAuth needs it.

Apply the database migrations, then deploy `extract-invoice`, `send-project-invite`, and
`plaid-bank` with JWT verification enabled.
The functions also validate the user and project membership themselves.
Redeploy an Edge Function after changing its source; publishing the web app alone
does not update server-side function code.

```sh
npm install
npm run dev
```

Use Node.js 22.13 or newer for the current PDF viewer dependency. Keep `.env`
private (`chmod 600 .env` on macOS/Linux) and never commit it. Before deploying,
verify that the Supabase Storage bucket stays private, database row level security
is enabled, and Edge Functions require JWTs. Only the Supabase URL and publishable
key belong in the browser build.

## Verification

```sh
npm test
npm run lint
npm run build
npm audit
```
