# Zybble

Zybble is a production SaaS application for **AI-powered business lead discovery**: describe the businesses you need in plain language, DeepSeek V3.2 (via OpenRouter's API, through Zybble's own backend) structures the request, SerpApi collects public business data from Google Maps, Zybble normalizes, deduplicates, and organizes it into exportable lead lists — behind real auth, plan entitlements, team workspaces, and Razorpay-billed subscriptions.

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

   └── Supabase Edge Functions
         ├── search-run       → fallback for local/non-Vercel deployments
         ├── ai-interpret     → same gate + interpretation (never runs a search)
         ├── ai-analyze       → DeepSeek V3.2 lead intelligence
         ├── export-run       → server-side CSV generation
         ├── team-invite      → seats + Resend invitations
         ├── billing          → Razorpay checkout / sync / cancel
         └── razorpay-webhook → HMAC-verified, idempotent subscription sync

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
| Razorpay | Account with international/USD + subscriptions enabled |
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
8. **Run the remaining migrations in order**: first [`supabase/migrations/0002_free_ai_and_workspace_recovery.sql`](supabase/migrations/0002_free_ai_and_workspace_recovery.sql), then [`supabase/migrations/0003_fix_profile_rls_recursion.sql`](supabase/migrations/0003_fix_profile_rls_recursion.sql). `0002` enables Zybble AI on Free and adds idempotent workspace recovery. `0003` replaces the recursive `profiles` admin policy (which otherwise breaks authenticated workspace reads with “infinite recursion detected”) and prevents profile-role escalation. Both are safe to run on an existing database.
9. Apply the production repair migration [`supabase/migrations/0004_production_repair.sql`](supabase/migrations/0004_production_repair.sql) after `0003`. It adds the columns, usage RPC behavior, tag validation, and session/preference tables used by the production request paths.
10. Verify: **Table Editor** should list `plans, profiles, workspaces, workspace_members, workspace_invitations, subscriptions, payments, invoices, lead_searches, lead_search_jobs, leads, lead_lists, lead_list_members, exports, usage_counters, activity_logs, ai_requests, ai_insights, webhook_events, user_preferences, app_sessions`. Every table shows **RLS Enabled**. In `plans`, the `free` row should show `has_ai = true`.
11. (CLI alternative) `supabase login && supabase link --project-ref <ref> && supabase db push`.

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
  RAZORPAY_KEY_ID=rzp_live_xxx \
  RAZORPAY_KEY_SECRET=xxx \
  RAZORPAY_WEBHOOK_SECRET=xxx \
  RAZORPAY_PLAN_GROWTH_ID=plan_xxx \
  RAZORPAY_PLAN_AGENCY_ID=plan_xxx \
  RAZORPAY_PLAN_SCALE_ID=plan_xxx \
  RESEND_API_KEY=re_xxx \
  RESEND_FROM_EMAIL="Zybble <hello@your-domain.com>" \
  APP_URL="https://your-domain.com"

supabase functions deploy search-run ai-interpret ai-analyze export-run team-invite billing razorpay-webhook
```

`razorpay-webhook` is deployed with `verify_jwt = false` (see `supabase/config.toml`) — its HMAC signature **is** the security boundary. All other functions demand the user's JWT.

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

## 4 · Razorpay setup

1. Log in → complete KYC/onboarding (**Test Mode** first).
2. Settings → **API Keys** → Generate key pair — note `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
3. Ensure **international collections / USD currency** is enabled for your account (Razorpay Dashboard → Settings → Configuration, or talk to support — international + subscriptions are eligibility-gated features).
4. Dashboard → **Subscriptions → Plans → Create plan** for each:
   | Zybble plan | Currency | Amount | Period |
   | --- | --- | --- | --- |
   | Growth | USD | $49 | monthly |
   | Agency | USD | $99 | monthly |
   | Scale | USD | $199 | monthly |
5. Copy each `plan_xxx` ID into the Edge secrets.
6. Settings → **Webhooks → Add webhook**:
   - URL: `https://YOUR_PROJECT.supabase.co/functions/v1/razorpay-webhook`
   - Secret: strong random string → `RAZORPAY_WEBHOOK_SECRET`
   - Events: `subscription.activated · subscription.updated · subscription.resumed · subscription.completed · subscription.cancelled · subscription.halted · subscription.paused · payment.captured · payment.failed`
7. Test the full subscription lifecycle (`billing` → checkout short_url) in Test Mode before flipping to **live** keys — test and live credentials are never interchangeable.

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
   The six production handlers are the only deployable files at the root of `api/`.
   API tests live in `api/_tests/`; Vercel ignores underscore-prefixed paths, so
   those tests do not consume the Hobby plan's 12-Function deployment limit.
4. **Environment Variables** — set for **Production, Preview, and Development**:
   - `VITE_SUPABASE_URL` — browser build value (inlined by Vite)
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — browser build value (inlined by Vite)
   - `SUPABASE_URL` — **server-side** copy of the project URL used by the Vercel Functions in `api/`
   - `SUPABASE_PUBLISHABLE_KEY` — **server-side** publishable key used by the Vercel Functions (`SUPABASE_ANON_KEY` works as a legacy fallback). Never a service-role/secret key — the API routes reject those so RLS is never bypassed.
   - `SERPAPI_API_KEY` — server-only; used by `/api/search-run` and never included in the Vite bundle
   - `OPENROUTER_API_KEY` and optional `OPENROUTER_MODEL` (default `deepseek/deepseek-v3.2`), `OPENROUTER_HTTP_REFERER`, `OPENROUTER_X_TITLE` — server-only; used by `/api/ai-chat`, `/api/ai-interpret`, and `/api/ai-analyze`. Also set the key and model as Supabase Edge Function secrets when using the non-Vercel fallback. Never prefix with `VITE_`.
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL` — server-only; used by `/api/team-invite` (emails/links).
   - Razorpay keys remain Supabase Edge Function secrets and must not be added to the browser bundle.

   **A `VITE_` prefix never satisfies a server-side lookup.** `VITE_SUPABASE_URL` is inlined into the browser bundle at build time; the Node runtime of `/api/search-run` reads `process.env.SUPABASE_URL`. Both sets must be configured — they are separate variables by design so a missing server configuration fails with a clear, actionable error instead of silently degrading.
5. **Redeploy after adding or changing an environment variable** — existing deployments do not receive new values retroactively — then test the preview URL end-to-end.
6. Add your custom domain → then go back and:
   - Supabase **Auth → URL Configuration**: add the domain as Site URL + allowed redirect URLs.
   - Confirm the Razorpay webhook URL points to the production project.
7. Every merge to `main` redeploys automatically.

### Troubleshooting the search configuration

| Error from `/api/search-run` | Meaning | Fix |
| --- | --- | --- |
| `Missing server environment variable(s): SUPABASE_URL and/or SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)` | The Vercel Function's Node runtime has no server-side Supabase config. `VITE_*` values do not count. | Add `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` in Vercel for **all three environments**, then redeploy. |
| `SUPABASE_URL isn't a valid URL` | The value was pasted without the scheme/host. | Update `SUPABASE_URL` to the full project URL, then redeploy. |
| `… is a server secret key, which would bypass row-level security` | A service-role/secret key was placed where the publishable key belongs. | Replace it with the project's publishable key so user-scoped RLS stays enforced. |
| `Missing server environment variable: SERPAPI_API_KEY` | The search provider key is absent on the server. | Add `SERPAPI_API_KEY` in Vercel (server-only), then redeploy. |

All of these return HTTP 500 with a `code` of `supabase_config`/`serpapi_config`; the frontend surfaces the message directly and does **not** retry through the Supabase Edge Function, so the real backend problem is never masked.

### Troubleshooting billing ("The requested Edge Function \"billing\" couldn't be reached")

Billing (`checkout` / `sync` / `cancel`) is **intentionally** a Supabase Edge
Function-only path — see "Architecture notes" below. Unlike search, AI,
export, and invite, it has **no same-origin `/api/*` fallback on Vercel**,
because writing authoritative subscription state requires the Supabase
service-role key, which the Vercel routes deliberately refuse to hold. That
means `billing` has no safety net: if the Edge Function isn't deployed (or
its secrets aren't set), every checkout/sync/cancel call fails with exactly
this message — it is not a frontend bug, it's a deployment/config gap.

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `The requested Edge Function "billing" couldn't be reached. Check that it is deployed and try again.` | The function was never deployed to the linked Supabase project (most common — `supabase/config.toml` only configures JWT verification at deploy time; it does not deploy anything by itself, and nothing in this repo's CI deploys Edge Functions automatically), or the Supabase project's Edge Functions have never been provisioned at all. | Run `supabase link --project-ref <ref>` then `supabase functions deploy billing` (see exact command below). |
| `The requested Edge Function "billing" is not deployed.` | The function responded with an explicit 404 from Supabase. | Same fix — deploy it. |
| `Razorpay isn't configured on the server. Missing server environment variable(s): RAZORPAY_KEY_ID and/or RAZORPAY_KEY_SECRET…` | The function **is** deployed but its secrets were never set (or were set on the wrong linked project). | `supabase secrets set RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=…`, then redeploy. |
| `The growth/agency/scale plan isn't available in payments yet.` | `RAZORPAY_PLAN_GROWTH_ID` / `_AGENCY_ID` / `_SCALE_ID` wasn't set as a secret. | Set the missing plan secret(s), then redeploy. |

To confirm deployment status: **Supabase Dashboard → Edge Functions** should
list `billing` with a recent deployment, and **Edge Functions → billing →
Secrets** should show every `RAZORPAY_*` key set (values are never shown back,
only names).

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

- **Secrets**: only `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` reach the browser; the publishable key is safe because every table is RLS-guarded. `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (server-side runtime config), `SERPAPI_API_KEY`, `OPENROUTER_API_KEY`, `RESEND_API_KEY`, and `APP_URL` are read only by server functions (Vercel and the Edge fallback) via `api/_lib/supabase-server.ts` and `api/_lib/openrouter.ts`, and never inlined into the Vite bundle. Razorpay keys and the Supabase service-role/secret keys remain Supabase Edge Function secrets — the Vercel routes deliberately reject secret keys so requests always run with the caller's JWT under RLS. All AI runs server-side through OpenRouter (DeepSeek V3.2) — no AI provider credential exists in the browser.
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
- [ ] Edge secrets configured (SerpApi, OpenRouter, Razorpay, Resend)
- [ ] SerpApi configured (rotated key, quota visible)
- [ ] OpenRouter configured (credits funded, key set on Vercel and as an Edge secret)
- [ ] Ask Zybble assistant streams in production (server-side OpenRouter key working)
- [ ] Razorpay configured (international/USD eligible, plans created)
- [ ] Razorpay webhook configured + signature verified
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
