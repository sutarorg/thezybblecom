# Zybble

Zybble is a production SaaS application for **AI-powered business lead discovery**: describe the businesses you need in plain language, Gemini structures the request, SerpApi collects public business data from Google Maps, Zybble normalizes, deduplicates, and organizes it into exportable lead lists — behind real auth, plan entitlements, team workspaces, and Razorpay-billed subscriptions.

```
Browser (Vite + React SPA, clean URLs via BrowserRouter)
   │
   ├── Supabase Auth (email/password, sessions, reset)
   ├── Supabase PostgREST (RLS-guarded reads/writes)
   ├── Vercel Function /api/search-run
   │     └── validated filters → SerpApi → normalize → dedupe → persist
   │         (user JWT + RLS + atomic quota reservation on every run)
   │
   └── Supabase Edge Functions
         ├── search-run       → fallback for local/non-Vercel deployments
         ├── ai-interpret     → Gemini fills the search form (never runs a search)
         ├── ai-analyze       → Gemini lead intelligence
         ├── export-run       → server-side CSV generation
         ├── team-invite      → seats + Resend invitations
         ├── billing          → Razorpay checkout / sync / cancel
         └── razorpay-webhook → HMAC-verified, idempotent subscription sync
                ▼
         Supabase PostgreSQL (RLS, triggers, atomic usage reservation)
```

### Routing

The app uses **real paths** — `/login`, `/find`, `/leads/:id` — with no hash fragments
anywhere. Deep links and refreshes work because `vercel.json` rewrites every path to
`index.html`. On any other host, add the same SPA fallback rewrite.

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
| Google AI Studio | 1 Gemini API key |
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
9. Verify: **Table Editor** should list `plans, profiles, workspaces, workspace_members, workspace_invitations, subscriptions, payments, invoices, lead_searches, lead_search_jobs, leads, lead_lists, lead_list_members, exports, usage_counters, activity_logs, ai_requests, ai_insights, webhook_events`. Every table shows **RLS Enabled**. In `plans`, the `free` row should show `has_ai = true`.
10. (CLI alternative) `supabase login && supabase link --project-ref <ref> && supabase db push`.

### Deploy the Edge Functions

Install the Supabase CLI (`brew install supabase/tap/supabase` or `npm i -g supabase`), then:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Provider secrets — server-side only, never in git
supabase secrets set \
  SERPAPI_API_KEY=your_rotated_key \
  GEMINI_API_KEY=your_gemini_key \
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

## 3 · Gemini setup

1. Open **aistudio.google.com** → sign in → **Get API key** → **Create API key** (choose a GCP project).
2. Copy the key → Edge secret `GEMINI_API_KEY`. Optional override `GEMINI_MODEL` (default `gemini-2.5-flash`).
3. Test with a `generateContent` request in AI Studio's code snippets — confirm `responseSchema` output returns JSON.

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
cp .env.example .env.local   # fill VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

- Visit `http://localhost:5173` — marketing site.
- `/login` / `/signup` — real auth; `/overview` — protected dashboard. Legacy hash links (for example, `/overview#/find`) are automatically replaced with the canonical `/find` path.
- Without `VITE_` vars the app runs demo mode (mock data, zero persistence, zero crashes).

## 7 · Deploy to Vercel

1. Push the repo to GitHub.
2. Vercel → **Add New Project → Import Git Repository**.
3. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output `dist`.
4. **Environment Variables** (Production + Preview — scoped per current Vercel guidance):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SERPAPI_API_KEY` — server-only; used by `/api/search-run` and never included in the Vite bundle
   - `GEMINI_API_KEY` and optional `GEMINI_MODEL` — server-only; used by `/api/ai-interpret`. Also set these as Supabase Edge Function secrets when using the non-Vercel fallback.
   - Razorpay, Resend, and Supabase secret/service-role keys remain Supabase Edge Function secrets and must not be added to the browser bundle.
5. **Redeploy after adding or changing an environment variable** — existing deployments do not receive new values retroactively — then test the preview URL end-to-end.
6. Add your custom domain → then go back and:
   - Supabase **Auth → URL Configuration**: add the domain as Site URL + allowed redirect URLs.
   - Confirm the Razorpay webhook URL points to the production project.
7. Every merge to `main` redeploys automatically.

## Git workflow

```text
feature branch → pull request → merge to main → auto-deploy
```

Never commit: `.env`, `.env.local`, any key material. `.gitignore` already excludes them.

## Architecture notes

- **Secrets**: only `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` reach the browser; the publishable key is safe because every table is RLS-guarded. `SERPAPI_API_KEY` is read only by the Vercel Function (and optionally the Edge fallback). Other provider keys remain Edge Function secrets.
- **Usage enforcement**: `reserve_leads()` is a security-definer RPC doing an atomic check-and-increment — concurrent searches can't overrun an allowance; unused reservations are refunded after each run.
- **Limits**: one-list (Free), seat counts, and client-workspace gating are enforced by **database triggers**, not the UI.
- **Idempotency**: `webhook_events` stores provider event IDs; duplicates return `200` without re-processing.
- **Deduplication**: deterministic `dedupe_key` (place_id → data_id → data_cid → domain → phone → name+address fallback) + `unique(workspace_id, dedupe_key)` upsert — searches are re-runnable without ever doubling leads.
- **AI honesty**: Gemini never fabricates data; missing fields (e.g. email) are explicitly unavailable.

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
- [ ] Edge secrets configured (SerpApi, Gemini, Razorpay, Resend)
- [ ] SerpApi configured (rotated key, quota visible)
- [ ] Gemini configured
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
