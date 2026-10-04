# Zybble Admin Panel — Implementation & Setup Report

Branch: `arena/01a106ba-thezybblecom`
Scope: a production admin console at `/admin`, built against the real repository and the real Supabase schema. No mock data, no invented tables, columns, statuses or metrics.

---

## A) Code changes made in the repository

### A1. Database migration

| File | What it adds |
|---|---|
| `supabase/migrations/0008_admin_console.sql` | `profiles.status`, suspension enforcement inside `reserve_leads()`, `admin_audit_logs`, operational indexes, and all `admin_*` aggregate/listing RPCs. Idempotent; safe to re-run. |

Contents, in order:

1. **`profiles.status`** (`text not null default 'active'`, CHECK `in ('active','suspended')`). There was no account-status field; a suspension that only hides a button is not a suspension.
2. **Enforcement**: `reserve_leads(ws, delta)` was re-created identical to its `0006` definition apart from a suspension gate returning a new `-3` sentinel. Every search reserves quota through this function, so a suspended owner's workspaces can no longer consume leads. `api/search-run.ts` and `supabase/functions/_shared/index.ts` map `-3` → HTTP 403 `account_suspended`.
3. **`protect_profile_role()`** extended to also guard `status`, plus a transaction-local `app.admin_console` escape hatch (see A2).
4. **`admin_set_profile_role(uuid, text)` / `admin_set_profile_status(uuid, text)`** — SECURITY DEFINER, `EXECUTE` revoked from `public, anon, authenticated`.
5. **`admin_audit_logs`** — `id, admin_user_id, admin_email, action, target_type, target_id, summary, before jsonb, after jsonb, metadata jsonb, ip, user_agent, created_at`. Append-only: no update/delete path exists in the API or the UI.
6. **Indexes** for the global, time-ordered admin lists (existing indexes are all workspace-scoped and cannot serve them): on `profiles(created_at)`, `lead_searches(created_at, status)`, `leads(created_at)`, `ai_requests(created_at, status)`, `webhook_events(received_at, status)`, `payments(created_at)`, `invoices(issued_at)`, `subscriptions(status, current_period_end)`, `admin_audit_logs(created_at)`.
7. **Aggregate RPCs** (all `stable`, `EXECUTE` revoked from `anon`/`authenticated`, so only the service role can call them — i.e. only after the API route authorized an admin): `admin_overview_metrics`, `admin_leads_overview`, `admin_ai_overview`, `admin_usage_overview`, `admin_system_health`, `admin_list_users`, `admin_user_detail`, `admin_list_workspaces`, `admin_workspace_detail`, `admin_lookup_identities`, `admin_adjust_usage_counter`.
8. `notify pgrst, 'reload schema'`.

### A2. Why `admin_set_profile_role` / `admin_set_profile_status` exist

`is_zybble_admin()` reads `auth.uid()`. The admin API acts with the **service role**, for which `auth.uid()` is `null`, so `is_zybble_admin()` is false and the `profiles_protect_role` trigger would **reject** a direct `UPDATE` of `role`/`status` even though the caller was already verified as an admin. Rather than weaken the trigger, the two SECURITY DEFINER functions set a transaction-local `app.admin_console` flag that the trigger honours. Their `EXECUTE` is revoked from `anon` and `authenticated`, so an end user cannot reach them. The guard is byte-for-byte unchanged for every other caller.

### A3. Server (Vercel functions)

| File | Purpose |
|---|---|
| `api/_lib/admin-core.ts` (new) | `AdminError`, `requireAdmin` (verify Supabase JWT → read `profiles.role = 'admin'` → `status = 'active'`), cached service client, `writeAuditLog`, query coercers (`str/int/oneOf/paging/period/requireUuid/likeTerm`), `sendJson`/`sendError`. |
| `api/_lib/admin-routes.ts` (new) | All resource handlers: `overview, users, workspaces, billing, plans, searches, leads, usage, ai, webhooks, auditLogs, system, settings`. |
| `api/admin/[...path].ts` (new) | The single entry point. One catch-all keeps the deployed function count at 10 (the routing guard test caps it at 12). Dispatches only after `requireAdmin` succeeds. |
| `api/search-run.ts` (modified) | Maps the new `-3` reserve sentinel to 403 `account_suspended`. |
| `supabase/functions/_shared/index.ts` (modified) | Same mapping for the Edge Function search path. |

Invariants enforced throughout `admin-routes.ts`: only columns that exist in the migrations are selected; `razorpay_customer_id` and anything matching `signature|secret|token|password` are never returned (webhook payloads are walked and redacted); every list is paginated, filtered and sorted **in Postgres**; every mutation validates input, performs the operation, writes an audit row, and returns the real post-operation state.

### A4. Client

| File | Purpose |
|---|---|
| `src/app/admin/client.ts` (new) | `adminGet`/`adminPost`/`useAdminResource`, attaching the browser session JWT; reuses `parseApiResponse` semantics. |
| `src/app/admin/ui.tsx` (new) | Admin-local primitives built on the existing design system: `PageHead, Metric/MetricGrid, Section, StatusBadge, PlanBadge, FilterBar/SearchField/SelectField/Chip, PeriodPicker, DataTable, TableFooter, KeyValue, Mono, BarSeries, Distribution, ErrorPanel, Unavailable`. |
| `src/app/admin/AdminLayout.tsx` (new) | Dedicated operator shell (not `AppLayout`): grouped sidebar, collapsible, mobile drawer, admin badge, back-to-app link. |
| `src/app/admin/pages/*.tsx` (new, 15 routes) | `Dashboard, Users, UserDetail, Workspaces, WorkspaceDetail, Billing, Plans, Searches (+ SearchDetail), Leads, Usage, Ai, Webhooks, AuditLogs, System, Settings`. |
| `src/App.tsx` (modified) | Lazy imports for the whole console (nothing admin ships in the customer bundle) + the `AdminOnly` gate + 17 clean routes. |
| `vercel.json` (modified) | `functions` key widened to `api/**/*.ts` (`maxDuration: 60`) so the nested admin function keeps the same limit; `admin` added to the `X-Robots-Tag: noindex` source pattern. |
| `supabase-migrations.source.test.ts` (modified) | Pinned-last-migration assertion now expects `0008_admin_console.sql`. |

### A5. Security model

```
browser (Supabase JWT, anon key only)
      │  same-origin fetch, Authorization: Bearer <access_token>
      ▼
/api/admin/*          ← never rewritten to the SPA (the rewrite excludes /api)
      │  requireAdmin(): sb.auth.getUser(token) → profiles.role === 'admin' → status === 'active'
      ▼
service-role Supabase client (server-only env var)
      │  aggregate RPCs + explicit column lists + redaction
      ▼
sanitized JSON
```

* The client-side `isAdmin` flag only decides whether to render the UI. Typing the URL, editing local storage or flipping React state grants nothing — the server re-authorizes **every** request.
* No existing RLS policy was changed or weakened; no table was made publicly readable; `auth.users` is never exposed to the browser (emails are resolved server-side via `admin_lookup_identities`).
* Every privileged mutation writes an audit row with actor, action, target, before, after, IP, user agent and timestamp.

### A6. Things deliberately NOT built, and why

| Not built | Reason |
|---|---|
| MRR/ARR beyond `plans.price_cents` | MRR is summed from the real `plans` rows of `active`/`trialing` subscriptions. **ARR is shown as unavailable** — every plan is monthly and no annual term exists in the schema, so an ARR figure would be invented. |
| AI spend in ₹ | `ai_requests` stores model and tokens, no price. OpenRouter pricing lives nowhere in this database. The AI page says so and points at the OpenRouter dashboard. |
| Webhook "retry" button | The Razorpay webhook verifies an HMAC over the raw request body, which is not retained. A replay could not be verified; a button that only flipped `status` would hide a real failure. The page documents the real recovery path (Razorpay *Resend* + per-customer reconciliation). |
| Search "retry" button | The pipeline reserves quota before calling the provider and has no idempotent resume path — a retry would double-charge the customer's allowance. |
| "Log in as user" impersonation | Replaced by the read-only Customer 360 at `/admin/users/:id`. |
| Feature flags / maintenance mode | No flag table and no runtime evaluator exist; a toggle would be cosmetic. `/admin/settings` states this explicitly instead of shipping dead switches. |
| Secret viewing/editing in `/admin/settings` | Not a secret manager. `/admin/system` reports only **presence** booleans. |

---

## B) Supabase changes required

| # | Change | Where | Notes |
|---|---|---|---|
| B1 | Run `supabase/migrations/0008_admin_console.sql` | Dashboard → SQL Editor (or `supabase db push`) | Idempotent. Creates `profiles.status`, `admin_audit_logs`, the indexes and all `admin_*` functions. **Required — the panel will not work without it.** |
| B2 | Promote the first admin | SQL Editor | See section H. |
| B3 | Nothing else | — | No RLS policy is added, removed or relaxed. No table is made public. Edge Function secrets unchanged. |

Verification query after B1:

```sql
select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name like 'admin!_%' escape '!'
order by 1;
-- expect 13 rows, including admin_set_profile_role and admin_set_profile_status
select count(*) from admin_audit_logs;  -- 0 on a fresh install
```

---

## C) Vercel changes required

| # | Setting | Value | Redeploy? |
|---|---|---|---|
| C1 | `vercel.json` (already committed) | `functions: { "api/**/*.ts": { "maxDuration": 60 } }` | Yes — ships with the deploy. |
| C2 | SPA rewrite | **Unchanged.** `/((?!api(?:/|$)).*) → /app.html` already excludes `/api`, so `/api/admin/*` is never served the SPA HTML, and every `/admin/...` deep link survives a hard refresh. | — |
| C3 | `X-Robots-Tag: noindex` header source | `admin` added to the existing route list. | Yes |
| C4 | Function count | 10 deployed functions (the guard test caps at 12). The admin API is one catch-all, not 13 files. | — |

No project-level dashboard setting needs to change by hand.

---

## D) Environment variables

**Nothing new is required.** The admin API reuses the variables the product already has. None of them are new, none are `VITE_*`, and none reach the browser.

| Variable | Scope | Public/Secret | Format | Used by admin for |
|---|---|---|---|---|
| `SUPABASE_URL` | Vercel, server | Public-ish (not exposed) | `https://<ref>.supabase.co` | Both clients |
| `SUPABASE_PUBLISHABLE_KEY` *(or `SUPABASE_ANON_KEY`)* | Vercel, server | Public key, still server-side here | JWT-like string | Verifying the caller's token |
| `SUPABASE_SERVICE_ROLE_KEY` *(or `SUPABASE_SECRET_KEY`, or `SUPABASE_SECRET_KEYS.default`)* | Vercel, server | **SECRET** | JWT-like string | Privileged reads/writes after authorization |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Vercel, server | **SECRET** | `rzp_live_…` / opaque | Subscription reconciliation (read-only GET) + billing health |
| `RAZORPAY_WEBHOOK_SECRET` | Supabase Edge | **SECRET** | opaque | Presence check only |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Vercel, server | **SECRET** / plain | `sk-or-…` / model slug | Presence check + reported model name |
| `RESEND_API_KEY`, `SERPAPI_API_KEY` | Vercel, server | **SECRET** | `re_…` / opaque | Presence check only |
| `APP_URL` | Vercel, server | Public | `https://zybble.com` | Origin for the real `/api/health` probe on `/admin/system` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Build time | Public | unchanged | Browser client (unchanged) |

> If `APP_URL` is unset, `VERCEL_URL` is used; if neither exists, the API check honestly reports **unknown** rather than green.
>
> **Never** add any of the secret rows above to a `VITE_*` variable — Vite inlines those into the browser bundle.

---

## E) Razorpay

| # | Action | Required? |
|---|---|---|
| E1 | No new keys, no new plans, no new webhook events. | — |
| E2 | The only provider call the console makes is `GET https://api.razorpay.com/v1/subscriptions/{id}` for reconciliation. It is read-only, behind an explicit confirmation dialog, and **never mutates anything at Razorpay**. | Works with existing keys |
| E3 | Recovering a failed webhook is done in Razorpay → Settings → Webhooks → Deliveries → **Resend** (Razorpay re-signs, so the Edge Function accepts it). | Manual, as needed |
| E4 | If `RAZORPAY_KEY_ID`/`KEY_SECRET` are absent, the reconcile action returns a clear 500 and `/admin/system` marks billing as failing. | — |

---

## F) Other providers

| Provider | Change |
|---|---|
| OpenRouter | None. The console reads `ai_requests` only, and reports that **cost is not tracked** rather than inventing a figure. |
| SerpApi | None. Search health is derived from `lead_searches.status`. |
| Resend | None. Presence check only. |
| Vercel Analytics | None. |

---

## G) Manual migration steps (in order)

1. **Back up** (Supabase → Database → Backups, or `pg_dump`).
2. Supabase → SQL Editor → paste the whole of `supabase/migrations/0008_admin_console.sql` → **Run**. Expect `Success. No rows returned.`
3. Verify with the queries in section B.
4. Deploy the branch to Vercel (the `vercel.json` change ships with it).
5. Promote your first admin (section H).
6. Sign out and back in so the browser session reloads `profiles.role`, then open `https://zybble.com/admin`.
7. Hard-refresh `https://zybble.com/admin/users` to confirm the SPA rewrite serves deep links.
8. Perform one harmless audited action (e.g. a quota override of the same value) and confirm it appears on `/admin/audit-logs`.

Rollback: the migration only adds objects. `profiles.status` defaults to `'active'`, so reverting the deploy leaves the database functional.

---

## H) Creating the first admin

There is intentionally no self-service path and no bootstrap endpoint. Run this once in **Supabase → SQL Editor** (service-role context, which bypasses the trigger's `auth.uid()` check):

```sql
-- 1. Find the account.
select id, email from auth.users where email = 'you@zybble.com';

-- 2. Promote it.
update profiles
set role = 'admin', status = 'active'
where id = (select id from auth.users where email = 'you@zybble.com');

-- 3. Confirm.
select p.id, u.email, p.role, p.status
from profiles p join auth.users u on u.id = p.id
where p.role = 'admin';
```

After that, every further grant or revoke is done **in the console** at `/admin/users/:id` → Change role, which is audited (actor, before, after, IP, timestamp) and visible on `/admin/settings`. Safety rails: an admin cannot remove their own admin role, and cannot suspend their own account.

---

## Verification performed

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| `npm run test` | ✅ 446 tests / 39 files passing, including the routing, migration and no-fake-success guards |
| `npm run build` + prerender | ✅ clean; 10 static routes prerendered, sitemap regenerated |
| Dev server `/admin` deep link | ✅ 200 |
| Admin code in the customer bundle | ✅ none — every admin module is lazy-loaded |
| Mobile | ✅ sidebar collapses to a drawer; tables hide columns progressively at `sm/md/lg` instead of scrolling horizontally |
