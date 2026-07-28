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

Deploy both `extract-invoice` and `send-project-invite` with JWT verification enabled.
The functions also validate the user and project membership themselves.

```sh
npm install
npm run dev
```

## Verification

```sh
npm test
npm run lint
npm run build
npm audit
```
