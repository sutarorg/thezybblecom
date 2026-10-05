# Zybble

Zybble is a production SaaS application for **AI-powered business lead discovery**: describe the businesses you need in plain language, DeepSeek V3.2 (via OpenRouter's API, through Zybble's own backend) structures the request, SerpApi collects public business data from Google Maps, Zybble normalizes, deduplicates, and organizes it into exportable lead lists — behind real auth, plan entitlements, team workspaces, and Paddle-billed subscriptions.

```
Browser (Vite + React SPA, clean URLs via BrowserRouter)
   │
   ├── Supabase Auth (email/password, sessions, reset)
   ├── Supabase PostgREST (RLS-guarded reads/writes)
   ├── Vercel Function /api/search-run
   │     └── validated filters → SerpApi → normalize → dedupe → enrich →
   │         apply refinements → persist
   │         (user JWT + RLS + atomic quota reservation on every run)
   │
   ├── Vercel Function /api/ai-interpret
   │     └── authorization + usage gate (session, workspace, plan, ai_requests)
   │         + DeepSeek V3.2 interpretation via server-side OpenRouter →
   │         validated, clamped filters — never a search
   │
   ├── Vercel Function /api/ai-analyze
   │     └── DeepSeek V3.2 lead intelligence via server-side OpenRouter,
   │         cached per lead (Edge Function fallback)
   │
   ├── Vercel Function /api/ai-chat
   │     └── streamed DeepSeek V3.2 chat for the Ask Zybble landing-page
   │         assistant, grounded in src/assistant/knowledge.ts
   │         (anonymous-friendly: per-IP rate limit, capped conversations)
   │
   └── Vercel Function /api/health (liveness probe for uptime monitors)

   ├── Vercel Function /api/billing        → Paddle checkout preparation /
   │     │                                   upgrades (server-side price
   │     │                                   resolution + PATCH of the existing
   │     │                                   subscription), sync, cancel
   │     └── Vercel Function /api/paddle-webhook → Paddle-Signature-verified
   │           (HMAC-SHA256 over the RAW body), idempotent subscription sync
   │
   └── Supabase Edge Functions
         ├── search-run       → fallback for local/non-Vercel deployments
         ├── ai-interpret     → same gate + interpretation (never runs a search)
         ├── ai-analyze       → DeepSeek V3.2 lead intelligence
         ├── export-run       → server-side CSV generation
         ├── team-invite      → seats + Resend invitations
         ├── billing          → Paddle checkout / upgrade / sync / cancel
         └── paddle-webhook   → signature-verified, idempotent subscription sync

   └── Billing browser runtime: Paddle.js with the PUBLIC client-side token
       (VITE_PADDLE_CLIENT_TOKEN). The Paddle API key, the webhook secret and
       the price-id → plan mapping are server-only; the browser only opens
       the price the server resolved for the plan being purchased, and a
       completed checkout is granted only after the server re-reads the
       transaction/subscription from Paddle (webhook or sync).

   └── No browser AI runtime: the browser never holds an AI credential —
       every AI call is proxied by the same-origin backend
       (src/lib/openrouter-ai.ts is a thin SSE/HTTP client of /api/ai-chat),
       so visitors are never shown a third-party sign-in.
```
                ▼
         Supabase PostgreSQL (RLS, triggers, atomic usage reservation)
```

### Routing

The app uses **real paths** — `/login`, `/find`, `/leads/:id` — with no hash fragments
anywhere. Deep links and refreshes work because `vercel.json` rewrites every path to
`index.html`. On any other host, add the same SPA fallback rewrite.

Paths under `/api/*` are deliberately excluded from that rewrite so they reach the
Vercel Functions in `api/*.ts` instead of the SPA. Requesting an `/api/*` path that has
no matching function (e.g. `/api/foo`) therefore returns Vercel's `404 NOT_FOUND` rather
than the app — `GET /api/health` is the supported liveness check for uptime monitors.

### No demo data

There is no mock/demo data source in the application. A newly registered user gets a
personal workspace and genuinely empty Leads, Lists, Searches, Exports, Usage, and
Billing views, each with its own empty state. Without the two `VITE_` variables the app
cannot authenticate and shows a clear "backend not configured" notice rather than
fabricated records. (The public landing page still contains clearly-labelled
illustrative product screenshots — those are marketing imagery, not account data.)

### Zybble AI on /find

The manual filter panel is the source of truth. Zybble AI reads a plain-language
request, shows four interpretation stages, and **populates the filters** — it never
executes a search. The user reviews the filters and presses **Find leads**.

---

## Prerequisites

Create accounts/tools before configuring anything:

| Tool | What you need |
| --- | --- |
| GitHub | Repository access |
| Node.js 20+ | `npm` (repo uses npm lockfile) |
| Supabase | 1 project (free tier is fine) |
| SerpApi | 1 **freshly rotated** API key |
| OpenRouter | 1 **API key** (openrouter.ai → Keys → Create key) — powers all AI surfaces server-side (DeepSeek V3.2): interpretation, per-lead analysis, and the Ask Zybble assistant |
| Paddle | A Paddle Billing account (sandbox for testing, live for production) |
| Resend | 1 verified sending domain |
| Vercel | Optional — any static host works |

---

## 1 · Supabase setup

1. Go to **app.supabase.com** → **New project** → pick org, name (`zybble`), a strong DB password, region closest to your users → **Create project**.
2. Wait for provisioning (~2 min).
3. Open **Project Settings → API Keys** (older dashboards: **Settings → API**).
4. If you see **Create new API keys**, click it — you want the **publishable** (`sb_publishable_…`) and **secret** (`sb_secret_…`) pair. Legacy `anon`/`service_role` keys keep working but migrate per current guidance.
5. Copy the **Project URL** and the **publishable key** → these go into `.env.local` (browser-safe).
6. **Auth → Providers**: enable **Email**. Recommended settings:
   - *Confirm email*: **ON** for production.
   - *Site URL*: `https://your-domain.com`
   - *Additional redirect URLs* (clean paths — no `#`):
     `https://your-domain.com/overview`, `https://your-domain.com/reset?step=update`,
     `http://localhost:5173/overview`, `http://localhost:5173/reset?step=update`
7. **SQL Editor → New query**: paste the entire contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**.
8. **Run the remaining migrations in order** (`0002` through `0009`, one
   query each). They are all idempotent and additive — existing deployments
   apply only the new ones. Highlights:
   - `0002`–`0004`: Zybble AI on Free, workspace recovery, the `profiles`
     RLS recursion fix, and the production repair (columns, usage RPC
     behavior, tag validation, session/preference tables).
   - `0006`–`0007`: team/workspace repair (authorized RPCs,
     `effective_plan_for_user`, billing tables) and membership/invitation
     security.
   - `0008`: the admin console (audit logs, indexes, service-role-only
     reporting functions).
   - `0009`: **Paddle Billing** — provider-neutral billing columns
     (`billing_provider`, `provider_*` ids) with partial unique indexes, the
     legacy Razorpay columns retained for history, `plans.currency` → USD,
     the `lead_quota_state` RPC behind the `monthly_lead_limit_reached`
     error, and provider-neutral admin reporting. Existing Razorpay
     subscribers keep their recorded entitlement until the paid period ends;
     no Razorpay API call is ever made again.
9. Verify: **Table Editor** should list `plans, profiles, workspaces, workspace_members, workspace_invitations, subscriptions, payments, invoices, lead_searches, lead_search_jobs, leads, lead_lists, lead_list_members, exports, usage_counters, activity_logs, ai_requests, ai_insights, webhook_events, user_preferences, app_sessions`. Every table shows **RLS Enabled**. In `plans`, the `free` row should show `has_ai = true`.
10. (CLI alternative) `supabase login && supabase link --project-ref <ref> && supabase db push`.

### Deploy the Edge Functions

Install the Supabase CLI (`brew install supabase/tap/supabase` or `npm i -g supabase`), then:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Provider secrets — server-side only, never in git
supabase secrets set \
  SERPAPI_API_KEY=your_rotated_key \
  OPENROUTER_API_KEY=sk-or-your_openrouter_api_key \
  OPENROUTER_MODEL=deepseek/deepseek-v3.2 \
  PADDLE_API_KEY=pdl_srbx_live_xxx \
  PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxx \
  PADDLE_ENVIRONMENT=production \
  PADDLE_PRICE_GROWTH_ID=pri_xxx \
  PADDLE_PRICE_AGENCY_ID=pri_xxx \
  PADDLE_PRICE_SCALE_ID=pri_xxx \
  RESEND_API_KEY=re_xxx \
  RESEND_FROM_EMAIL="Zybble <hello@your-domain.com>" \
  APP_URL="https://your-domain.com"

supabase functions deploy search-run ai-interpret ai-analyze export-run team-invite billing paddle-webhook
```

`paddle-webhook` is deployed with `verify_jwt = false` (see `supabase/config.toml`) — its Paddle signature **is** the security boundary. All other functions demand the user's JWT.

---

## 2 · SerpApi setup

1. Log in to **serpapi.com** → **Dashboard → API Key**.
2. Treat any previously shared/pasted key as compromised → **regenerate it** in account settings.
3. Copy the new key → set `SERPAPI_API_KEY` as a **server-only Vercel environment variable** for Production and Preview, then redeploy. Do not prefix it with `VITE_`; that would expose it to the browser bundle.
4. If you run the app outside Vercel, also set it as a Supabase Edge Function secret (`supabase secrets set SERPAPI_API_KEY=...`) so the documented `search-run` fallback can run.
5. Test: in SerpApi Playground run `engine=google_maps`, `q=coffee`, `ll=@40.7455,-74.0083,14z` — confirm `local_results` appear.
6. Watch your monthly search credit; the engine caps at 12 pages (240 leads) per request and stops when a page returns fewer than 20 results.
7. Local development: `npm run dev` now executes `api/search-run.ts` inside Vite, so put `SERPAPI_API_KEY` (plus `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`) in `.env.local` and searches run against the real Vercel code path.

**How the Google Maps engine is called** (matches [serpapi.com/google-maps-api](https://serpapi.com/google-maps-api)):

- `engine=google_maps&type=search&q=<category> in <location>&google_domain=google.com&hl=en`
- Pagination uses `start=0,20,40,…`, and SerpApi **requires `ll`** (`@lat,lng,zoom`) for every page after the first. Zybble derives `ll` from the GPS coordinates returned on page 1 and reuses it for the rest of the run.
- A `200` response carrying `error: "Google Maps hasn't returned any results…"` means the result set is exhausted — it is treated as the end of pagination, not as a provider outage.
- On Vercel, `vercel.json` must exclude `/api/*` from the SPA rewrite, otherwise `/api/search-run` is served `index.html` and every search fails.

## 3 · AI setup

Every AI surface runs server-side through one provider: **OpenRouter**
(OpenAI-compatible `https://openrouter.ai/api/v1`) with the model
`deepseek/deepseek-v3.2`.

1. Create an account at **openrouter.ai**, add credits, then go to
   **Keys → Create key**.
2. Copy the key to the server-only secret `OPENROUTER_API_KEY`
   (`sk-or-…`). Set it in Vercel for the `/api/*` routes **and** as a
   Supabase Edge Function secret for the non-Vercel fallback.
3. Optional overrides, both server-only: `OPENROUTER_MODEL`
   (defaults to `deepseek/deepseek-v3.2`), `OPENROUTER_HTTP_REFERER`
   (defaults to `https://zybble.com`) and `OPENROUTER_X_TITLE`
   (defaults to `Zybble`) — the last two are the attribution headers
   OpenRouter reports back to model providers.
4. Never prefix any of these with `VITE_`; all are server-only. Requests use
   the OpenAI-compatible chat-completions format, with retries for transient
   provider failures (genuine rate limits, timeouts, 5xx) and clear,
   secret-free errors otherwise — credit exhaustion (402) and authentication
   failures fail fast and are never mislabeled as rate limits.

The three AI surfaces: `/api/ai-interpret` (request → filters on `/find`,
authorized session → workspace → plan before the model runs),
`/api/ai-analyze` (per-lead analysis on `/leads/:id`, cached per lead), and
`/api/ai-chat` (streamed Ask Zybble landing-page assistant). The browser
helper `src/lib/openrouter-ai.ts` only talks to the same-origin
`/api/ai-chat` — it holds no key and never calls OpenRouter directly.

## 4 · Paddle Billing setup

Zybble bills through **Paddle Billing** (the current Paddle platform, not Paddle
Classic). Subscriptions start ONLY from a customer completing a Paddle Checkout
opened by Paddle.js on the site; upgrades PATCH the existing subscription
server-side. Nothing is ever granted from a browser claim alone — the webhook
and a server-side provider read are the only sources of entitlement.

Paddle gives every account two isolated environments. **Sandbox and live
credentials must never be mixed**: a `test_` client token with a live API key,
or a sandbox `pri_` price id in production, will refuse to work (checkout
errors out rather than charging the wrong environment). Do the whole walkthrough
below in **sandbox** first, then repeat it in live and update the environment
variables.

### 4a · Create the product and prices

1. Log in at **vendors.paddle.com** (live) or **sandbox-vendors.paddle.com**
   (sandbox). New accounts start in sandbox automatically.
2. **Catalog → Products → Add product**. Name it `Zybble`, add a description
   (this shows on the checkout). Save.
3. Open the Zybble product → **Prices → Add price**, once per plan:

   | Zybble plan | Amount | Billing period | Variable name it goes into |
   | --- | --- | --- | --- |
   | Growth | $49 | monthly | `PADDLE_PRICE_GROWTH_ID` |
   | Agency | $99 | monthly | `PADDLE_PRICE_AGENCY_ID` |
   | Scale | $199 | monthly | `PADDLE_PRICE_SCALE_ID` |

4. On each price row, click the price and copy its **price id** — it starts
   with `pri_` (for example `pri_01gsz8x8sawmvhz1pv30nge1ke`). Product ids
   start with `pro_`; those are NOT what you want.
5. These three `pri_…` values become the server-only environment variables
   `PADDLE_PRICE_GROWTH_ID` / `PADDLE_PRICE_AGENCY_ID` / `PADDLE_PRICE_SCALE_ID`.
   The browser never receives them — the `/api/billing` checkout action maps a
   requested plan to its price id server-side and returns exactly one public
   price id per checkout.

### 4b · Create the client-side token (browser)

1. In the Paddle dashboard: **Developer tools → Authentication → Client-side
   tokens → Generate client-side token**.
2. Copy the token. Sandbox tokens start with `test_`, live tokens with
   `live_`.
3. It goes into `VITE_PADDLE_CLIENT_TOKEN`. This value is **intentionally
   public** — it can only open checkouts for your account's prices; it cannot
   read or change subscriptions. Never put the API key here.
4. Also set `VITE_PADDLE_ENVIRONMENT` to `sandbox` (or `production` for live).
   If you omit it, the app derives it from the token prefix (`test_` →
   sandbox, `live_` → production). If the browser environment ever disagrees
   with the server's `PADDLE_ENVIRONMENT`, checkout refuses to open with a
   clear message instead of mixing environments.

### 4c · Create the API key (server)

1. **Developer tools → Authentication → API keys → Generate API key**.
   Give it a name like `zybble-server`.
2. Copy it immediately (Paddle shows it once). Sandbox keys start
   `pdl_srbx_sandbox_…`, live keys `pdl_srbx_live_…`.
3. It goes into `PADDLE_API_KEY` — **server-only** (Vercel environment
   variable / Supabase secret). Never prefix it with `VITE_`. Zybble uses it
   to read subscriptions/transactions and to PATCH subscriptions for
   upgrades; it can move real money, so treat it like a password.
4. Set `PADDLE_ENVIRONMENT` to `sandbox` or `production` to match the key.
   Anything other than `sandbox` is treated as production, and the server
   talks to `sandbox-api.paddle.com` vs `api.paddle.com` accordingly — the two
   can never be crossed by mistake.

### 4d · Create the webhook destination

1. **Developer tools → Notifications → New destination → Webhook**.
2. URL: `https://your-domain.com/api/paddle-webhook` (the Vercel function).
   For local testing Paddle cannot reach `localhost` — test locally by
   deploying a preview to Vercel, or point the destination at a tunnel.
3. Select **Paddle Billing** as the API version (not Classic).
4. Subscribe to these events:
   - `subscription.created`, `subscription.updated`, `subscription.past_due`,
     `subscription.paused`, `subscription.resumed`, `subscription.canceled`
   - `transaction.paid`, `transaction.completed`,
     `transaction.payment_failed`, `transaction.canceled`
5. Save the destination, then open it → **Signature verification** → copy the
   **Webhook secret** (format `pdl_ntfset_…`) into `PADDLE_WEBHOOK_SECRET`
   (server-only, on Vercel and as a Supabase secret if you deploy the Edge
   fallback).
6. Zybble verifies every delivery: `Paddle-Signature: ts=…;h1=…` is an
   HMAC-SHA256 of `${ts}:${rawBody}` keyed with that secret, compared in
   constant time over the RAW request bytes, with a 5-minute replay window.
   Invalid signatures are rejected with 401 and nothing is applied. Duplicate
   deliveries (Paddle retries) return 200 and are deduplicated on the Paddle
   `event_id` via the `webhook_events` table.
7. If you also run the Supabase Edge fallback, add a second destination (or
   edit this one) pointing at
   `https://YOUR_PROJECT.supabase.co/functions/v1/paddle-webhook`.

### 4e · Test in sandbox before going live

1. Set every Paddle variable to the **sandbox** values
   (`VITE_PADDLE_ENVIRONMENT=sandbox`, `PADDLE_ENVIRONMENT=sandbox`,
   `test_…` token, `pdl_srbx_sandbox_…` key, sandbox `pri_…` ids).
2. In the app: sign up → **Billing → Upgrade to Growth**. A Paddle Checkout
   overlay opens on the page.
3. Pay with the sandbox test card **4242 4242 4242 4242**, any future expiry,
   any CVC.
4. Back in the app, the plan flips to Growth after the server verifies the
   payment (usually instant via sync; the webhook is the durable path).
5. Test an upgrade (Growth → Agency) — the difference is prorated onto the
   current bill; if the immediate payment fails, the plan is left unchanged
   (`on_payment_failure: prevent_change`).
6. Test cancellation — access is kept until the end of the paid period, then
   the plan becomes Free automatically.
7. Check **Developer tools → Notifications → (destination) → History** to see
   the delivered events, and the admin console → Webhooks to see them
   recorded in `webhook_events`.
8. Only then repeat 4a–4d in the live dashboard and switch every environment
   variable to the live values, then redeploy.

### Where each Paddle value lives

| Variable | Where it goes | Public? |
| --- | --- | --- |
| `VITE_PADDLE_CLIENT_TOKEN` | Vercel env (browser build) | Yes — intentionally public |
| `VITE_PADDLE_ENVIRONMENT` | Vercel env (browser build) | Yes (`sandbox`/`production`) |
| `PADDLE_API_KEY` | Vercel env (server) + `supabase secrets set` | **No** |
| `PADDLE_WEBHOOK_SECRET` | Vercel env (server) + `supabase secrets set` | **No** |
| `PADDLE_ENVIRONMENT` | Vercel env (server) + `supabase secrets set` | Value is not secret, but keep it server-side so it stays authoritative |
| `PADDLE_PRICE_GROWTH_ID` | Vercel env (server) + `supabase secrets set` | **No** (the plan→price mapping is server-authoritative) |
| `PADDLE_PRICE_AGENCY_ID` | Vercel env (server) + `supabase secrets set` | **No** |
| `PADDLE_PRICE_SCALE_ID` | Vercel env (server) + `supabase secrets set` | **No** |

## 5 · Resend setup

1. **resend.com** → **Domains → Add Domain** → enter your sending domain.
2. Add the DNS records shown (SPF/DKIM/MX) at your DNS host → **Verify**.
3. **API Keys → Create** → copy `RESEND_API_KEY` → Edge secrets.
4. Set `RESEND_FROM_EMAIL` to an address on the verified domain.
5. Send a test email from the Resend dashboard → confirm inbox delivery.

## 6 · Run locally

```bash
git clone <your-repo-url> && cd zybble
npm install
cp .env.example .env.local   # fill both browser VITE_ values and server SUPABASE_ values
npm run dev
```

- Visit `http://localhost:5173` — marketing site.
- `/login` / `/signup` — real auth; `/overview` — protected dashboard. Legacy hash links (for example, `/overview#/find`) are automatically replaced with the canonical `/find` path.
- Without `VITE_` vars the app shows an explicit backend-not-configured state; it does not run with mock data.

## 7 · Deploy to Vercel

1. Push the repo to GitHub.
2. Vercel → **Add New Project → Import Git Repository**.
3. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output `dist`.
   The production handlers are the only deployable files at the root of `api/`.
   API tests live in `api/_tests/`; Vercel ignores underscore-prefixed paths, so
   those tests do not deploy as functions.
4. **Environment Variables** — set for **Production, Preview, and Development**:
   - `VITE_SUPABASE_URL` — browser build value (inlined by Vite)
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — browser build value (inlined by Vite)
   - `SUPABASE_URL` — **server-side** copy of the project URL used by the Vercel Functions in `api/`
   - `SUPABASE_PUBLISHABLE_KEY` — **server-side** publishable key used by the user-scoped Vercel Functions (`SUPABASE_ANON_KEY` works as a legacy fallback). Never a service-role/secret key here — those routes reject it so RLS is never bypassed.
   - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) — **server-only**, used only by `/api/billing` after it authenticates the caller. Never prefix with `VITE_` and never paste it into `SUPABASE_PUBLISHABLE_KEY`.
   - `SERPAPI_API_KEY` — server-only; used by `/api/search-run` and never included in the Vite bundle
   - `OPENROUTER_API_KEY` and optional `OPENROUTER_MODEL` (default `deepseek/deepseek-v3.2`), `OPENROUTER_HTTP_REFERER`, `OPENROUTER_X_TITLE` — server-only; used by `/api/ai-chat`, `/api/ai-interpret`, and `/api/ai-analyze`. Also set the key and model as Supabase Edge Function secrets when using the non-Vercel fallback. Never prefix with `VITE_`.
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL` — server-only; used by `/api/team-invite` (emails/links) and checkout return links.
   - `VITE_PADDLE_CLIENT_TOKEN` — browser build value (inlined by Vite). The
     PUBLIC Paddle client-side token (`test_…` sandbox / `live_…` live).
   - `VITE_PADDLE_ENVIRONMENT` — browser build value, `sandbox` or
     `production`; must match `PADDLE_ENVIRONMENT` or checkout refuses to open.
   - `PADDLE_API_KEY` — **server-only**; used by `/api/billing` and the
     Supabase Edge billing fallback. Never prefix with `VITE_`.
   - `PADDLE_WEBHOOK_SECRET` — **server-only**; used by `/api/paddle-webhook`
     and the `paddle-webhook` Edge Function to verify the `Paddle-Signature`
     header over the raw request body.
   - `PADDLE_ENVIRONMENT` — server-only; `sandbox` or `production`.
   - `PADDLE_PRICE_GROWTH_ID`, `PADDLE_PRICE_AGENCY_ID`, `PADDLE_PRICE_SCALE_ID` —
     **server-only** Paddle price ids (`pri_…`) for the monthly plans; the
     server resolves plan → price so the browser can never pick a price.
     Keep sandbox keys with sandbox price ids and live keys with live price
     ids — the environments are never interchangeable.

   **A `VITE_` prefix never satisfies a server-side lookup.** `VITE_SUPABASE_URL` is inlined into the browser bundle at build time; the Node runtime of `/api/search-run` and `/api/billing` reads `process.env.SUPABASE_URL`. Both sets must be configured — they are separate variables by design so a missing server configuration fails with a clear, actionable error instead of silently degrading.
5. **Redeploy after adding or changing an environment variable** — existing deployments do not receive new values retroactively — then test the preview URL end-to-end.
6. Add your custom domain → then go back and:
   - Supabase **Auth → URL Configuration**: add the domain as Site URL + allowed redirect URLs.
   - Confirm the Paddle webhook destination URL points at the production
     domain (`https://your-domain.com/api/paddle-webhook`) and that the live
     `PADDLE_WEBHOOK_SECRET` is set everywhere the webhook runs.
7. Every merge to `main` redeploys automatically.

### Troubleshooting the search configuration

| Error from `/api/search-run` | Meaning | Fix |
| --- | --- | --- |
| `Missing server environment variable(s): SUPABASE_URL and/or SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)` | The Vercel Function's Node runtime has no server-side Supabase config. `VITE_*` values do not count. | Add `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` in Vercel for **all three environments**, then redeploy. |
| `SUPABASE_URL isn't a valid URL` | The value was pasted without the scheme/host. | Update `SUPABASE_URL` to the full project URL, then redeploy. |
| `… is a server secret key, which would bypass row-level security` | A service-role/secret key was placed where the publishable key belongs. | Replace it with the project's publishable key so user-scoped RLS stays enforced. |
| `Missing server environment variable: SERPAPI_API_KEY` | The search provider key is absent on the server. | Add `SERPAPI_API_KEY` in Vercel (server-only), then redeploy. |

All of these return HTTP 500 with a `code` of `supabase_config`/`serpapi_config`; the frontend surfaces the message directly and does **not** retry through the Supabase Edge Function, so the real backend problem is never masked.

### Troubleshooting billing ("Billing is temporarily unavailable")

Billing (`checkout` / `sync` / `cancel`) now prefers the same-origin Vercel
Function at `/api/billing`. That avoids the previous browser → Supabase Edge
cross-origin failure mode that produced:

> Billing is temporarily unavailable. Your plan and payment details are unaffected…

If `/api/billing` is not present on an older/non-Vercel deployment, the frontend
still falls back to the Supabase Edge Function named `billing` with the same
request contract. Both paths keep the Paddle API key, the webhook secret and
the Supabase write key on the server only.

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `The billing server isn't connected to Supabase with write access… SUPABASE_SERVICE_ROLE_KEY…` | `/api/billing` deployed, but Vercel is missing the server-only Supabase service-role/secret key. | Add `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) in Vercel for Production/Preview/Development, then redeploy. Do **not** put this value in any `VITE_` variable or in `SUPABASE_PUBLISHABLE_KEY`. |
| `…must be the Supabase service-role/secret key, not the publishable/anon key` | The billing route received the public key where it needs the server write key. | Replace only `SUPABASE_SERVICE_ROLE_KEY` with the Supabase secret/service-role key; keep `SUPABASE_PUBLISHABLE_KEY` as the public publishable key. |
| `Paddle isn't configured on the billing server. Missing server environment variable: PADDLE_API_KEY` | `/api/billing` deployed, but the Paddle API key is missing in Vercel. | Add `PADDLE_API_KEY` in Vercel (and as a Supabase secret for the Edge fallback), then redeploy. Add `PADDLE_WEBHOOK_SECRET` wherever the webhook runs. |
| `The growth/agency/scale plan isn't wired up for payments yet… PADDLE_PRICE_*_ID` | The matching `PADDLE_PRICE_*` variable is absent or was set in the wrong environment. | Set the missing `pri_…` price id in Vercel and, if using Edge fallback, in Supabase secrets too. Sandbox keys require sandbox price ids; live keys require live price ids. |
| Checkout opens but errors with an environment message | The browser (`VITE_PADDLE_ENVIRONMENT` / token prefix) and the server (`PADDLE_ENVIRONMENT`) point at different Paddle environments. | Make the token, `VITE_PADDLE_ENVIRONMENT` and `PADDLE_ENVIRONMENT` agree (both sandbox or both live), rebuild the frontend, and redeploy. |
| Payment succeeded but the plan didn't change | The webhook hasn't landed yet, or the webhook secret/URL is wrong so deliveries fail signature verification. | Reload the Billing page (sync re-reads Paddle). Check Paddle → Notifications → destination → History for delivery errors, confirm the URL is `…/api/paddle-webhook`, and that `PADDLE_WEBHOOK_SECRET` matches the destination's secret. A 401 in the function logs means the secret is wrong. |
| Webhook returns 401 in the logs | Signature verification failed — wrong secret, or the request never reached this deployment (proxy re-encoding). | Re-copy the webhook secret from the Paddle destination into `PADDLE_WEBHOOK_SECRET` and redeploy. Never put a proxy between Paddle and the function that rewrites the body. |
| `Upgrade one step at a time…` | Zybble only allows the immediate next plan (Free → Growth → Agency → Scale). | That is by design: no skipped steps, no downgrades. Cancel at period end instead. |
| The old plain-language banner still appears after redeploy | Both `/api/billing` and the Edge fallback were unreachable, or the browser is still on an old deployment. | Confirm `/api/billing` exists on the Vercel deployment, confirm the new env vars are set in the same Vercel environment you are testing, then redeploy. If you rely on Edge fallback, also deploy `billing` with `supabase functions deploy billing`. |

For the Supabase Edge fallback/webhook path, also set the same Paddle values as
Edge secrets and deploy the functions:

```bash
supabase secrets set \
  PADDLE_API_KEY=pdl_srbx_live_xxx \
  PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxx \
  PADDLE_ENVIRONMENT=production \
  PADDLE_PRICE_GROWTH_ID=pri_xxx \
  PADDLE_PRICE_AGENCY_ID=pri_xxx \
  PADDLE_PRICE_SCALE_ID=pri_xxx \
  APP_URL="https://your-domain.com"

supabase functions deploy billing paddle-webhook
```

To confirm Edge deployment status: **Supabase Dashboard → Edge Functions** should
list `billing` and `paddle-webhook` with recent deployments, and **Edge
Functions → billing → Secrets** should show every `PADDLE_*` key name (values
are never shown back). The `paddle-webhook` function is deployed with
`verify_jwt = false` — the Paddle signature is its security boundary.

### Writing imports inside `api/`

Vercel compiles each traced `api/**/*.ts` file to `.js` **without rewriting import
specifiers**, and this repo is ESM (`"type": "module"`), so Node resolves whatever
specifier is in the source literally at cold start:

| Source specifier | Deployed result |
| --- | --- |
| `"./_lib/search-core.ts"` | ❌ `ERR_MODULE_NOT_FOUND` — the deployed file is `search-core.js` |
| `"./_lib/search-core"` | ❌ `ERR_MODULE_NOT_FOUND` — ESM requires an explicit extension |
| `"./_lib/search-core.js"` | ✅ resolves (TypeScript maps `.js` back to the `.ts` source) |

A bad specifier throws while the function module is loading — before any handler
code runs — so Vercel returns an opaque `500 FUNCTION_INVOCATION_FAILED` with no
JSON body and nothing but the import error in `vercel logs`. Always write relative
imports under `api/` with the emitted `.js` extension;
`api/_tests/module-resolution.test.ts` enforces it, and
`allowImportingTsExtensions` is deliberately `false` in `tsconfig.json`.
(Supabase Edge Functions in `supabase/functions/` are Deno and keep their `.ts`
specifiers — that directory is outside the Vercel build.)

## Git workflow

```text
feature branch → pull request → merge to main → auto-deploy
```

Never commit: `.env`, `.env.local`, any key material. `.gitignore` already excludes them.

## Architecture notes

- **Secrets**: only `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` reach the browser; the publishable key is safe because every table is RLS-guarded. `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (server-side runtime config), `SERPAPI_API_KEY`, `OPENROUTER_API_KEY`, `RESEND_API_KEY`, and `APP_URL` are read only by user-scoped server functions (Vercel and the Edge fallback) via `api/_lib/supabase-server.ts` and `api/_lib/openrouter.ts`, and never inlined into the Vite bundle. `/api/billing` is the sole Vercel route allowed to read `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY`, because it must persist payment-provider subscription state after authenticating the caller; all other Vercel routes reject service-role keys so requests keep running with the caller's JWT under RLS. Paddle credentials split by audience: the client-side token is public and browser-only; the API key, webhook secret and price-id map remain server-only in Vercel and, when the Edge fallback/webhook is deployed, Supabase Edge secrets. All AI runs server-side through OpenRouter (DeepSeek V3.2) — no AI provider credential exists in the browser.
- **AI flow**: `/find` interpretation is authorized and interpreted server-side (session → workspace → plan → `ai_requests` usage row) by `/api/ai-interpret` (Edge fallback twin with the same contract). Interpretation only fills the filter form; it never runs a search. The landing-page assistant streams through `/api/ai-chat` via the shared browser helper `src/lib/openrouter-ai.ts` and answers from the reviewed knowledge base in `src/assistant/` (flattened into its system prompt), with streamed replies and conversation history. Per-lead analysis runs through `/api/ai-analyze` and is cached in `ai_insights`.
- **Usage enforcement**: `reserve_leads()` is a security-definer RPC doing an atomic check-and-increment — concurrent searches can't overrun an allowance; unused reservations are refunded after each run.
- **Limits**: one-list (Free), seat counts, and client-workspace gating are enforced by **database triggers**, not the UI.
- **Idempotency**: `webhook_events` stores provider event IDs; duplicates return `200` without re-processing.
- **Deduplication**: deterministic `dedupe_key` (place_id → data_id → data_cid → domain → phone → name+address fallback) + `unique(workspace_id, dedupe_key)` upsert — searches are re-runnable without ever doubling leads.
- **AI honesty**: Zybble AI is instructed never to fabricate data; missing fields (e.g. email) are explicitly unavailable.

## Blog + SEO architecture

- **Content model**: articles live as typed data in `src/blog/posts/*` (one file per article) and are registered in `src/blog/index.ts`. Reading time, tables of contents, related links, sitemap entries, and structured data are all derived from that one registry — adding an article is one file + one registry line.
- **Prerendering**: `npm run build` runs `vite build`, then an SSR build of `src/entry-prerender.tsx`, then `scripts/prerender.mjs`, which renders every public route (`/`, `/blog`, each `/blog/<slug>`, `/contact`, `/privacy`, `/terms`) to static HTML in `dist/` with its unique title, meta description, canonical URL, Open Graph/Twitter tags, and JSON-LD already in the `<head>`. Crawlers never depend on client-side JavaScript; the browser boots the unchanged SPA on top.
- **Head metadata**: one registry, `src/seo/meta.ts`, feeds the prerenderer, the runtime `usePageSeo` hook (for client-side navigations), and the generated `dist/sitemap.xml`.
- **SPA fallback**: non-prerendered routes (the authenticated app, auth screens, unknown URLs) are rewritten to `dist/app.html`, a `noindex` shell (see `vercel.json`), and the private routes additionally send `X-Robots-Tag: noindex`.
- **Lead capture**: the landing-page assistant offers an *optional* email follow-up at most once per session, only after the visitor's second turn with clear intent (or sustained engagement), never in the first answer, and never again after a decline (`src/assistant/lead.ts`). Accepted emails post to `/api/ai-lead`, which validates, rate-limits, dedupes, and forwards to Web3Forms server-side using `WEB3FORMS_ACCESS_KEY` (falls back to the public contact-form key). The conversation transcript is never stored or forwarded.

## Demo data

There is none. The app ships without any mock/demo data source — every screen renders
from real Supabase rows or an explicit empty/error state. If the backend is unreachable,
users see an actionable error, never fictional leads or fake workspaces.

---

## Production Launch Checklist

- [ ] Supabase configured
- [ ] Database migrations applied
- [ ] RLS verified (Table Editor shows RLS on every table)
- [ ] Auth tested (signup, email confirm, login, reset flow)
- [ ] Edge Functions deployed
- [ ] Edge secrets configured (SerpApi, OpenRouter, Paddle, Resend)
- [ ] SerpApi configured (rotated key, quota visible)
- [ ] OpenRouter configured (credits funded, key set on Vercel and as an Edge secret)
- [ ] Ask Zybble assistant streams in production (server-side OpenRouter key working)
- [ ] Paddle configured (product + $49/$99/$199 monthly prices created in BOTH sandbox and live)
- [ ] Paddle client token, API key, webhook secret and price ids set (matching environments)
- [ ] Paddle webhook destination configured + signature verified
- [ ] Sandbox checkout + upgrade + cancel tested with the 4242 test card
- [ ] Resend configured
- [ ] Email domain verified (SPF/DKIM passing)
- [ ] Vercel configured
- [ ] Production environment variables configured
- [ ] Custom domain configured
- [ ] Supabase production redirect URLs configured
- [ ] Payment flow tested (test subscription → webhook → entitlement flip)
- [ ] Lead search tested (interpret → fetch → dedupe → persist)
- [ ] CSV export tested
- [ ] Usage limits tested (quota block + refund)
- [ ] Team permissions tested (seats, roles)
- [ ] Workspace isolation tested (two users, zero cross-visible data)
- [ ] Security review completed
- [ ] Production build passed (`npm run build`)
- [ ] GitHub repository clean
- [ ] No secrets committed
