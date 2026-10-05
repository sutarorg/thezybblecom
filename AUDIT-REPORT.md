# Zybble — Pre-Launch Production Readiness Audit

Repository: `sutarorg/thezybblecom` · Branch: `arena/01a105f4-thezybblecom` · Base: `dbcca81`
Date: 2026-10-04

> **Note (2026-10-05):** this audit reflects the repository state *before* the
> Razorpay → Paddle Billing migration. Razorpay findings below are historical:
> Zybble now bills through Paddle Billing (see `README.md` → “4 · Paddle
> Billing setup”), and migration `0009_paddle_billing.sql` retained the legacy
> Razorpay columns and existing subscribers' recorded entitlements.

---

## A. Launch verdict

### **NOT LAUNCH READY — one P0 remains open and it is not a code defect.**

| | |
|---|---|
| **Verdict** | **BLOCKED** |
| **Blocking items** | 1 × P0 (pricing/currency mismatch — business decision), 0 × P1 open |
| **Confidence in the verdict** | **high** |
| **Confidence that the shipped product is defect-free** | **~55%** |

### Why 55% and not higher

Confidence is capped by **coverage, not by findings**. No provider credentials
existed in this environment, so the following could not be executed even once:

* no `SUPABASE_URL` / publishable / secret key → **no authenticated session
  could be created**, so no signed-in browser journey (A–E) was run end to end;
* no `SERPAPI_API_KEY` → the search pipeline was never driven against the real
  provider; dedupe and data-quality claims rest on code reading, not output;
* no Razorpay test keys → **no checkout, no webhook, no plan transition, no
  cancellation was executed**; the billing state machine was reviewed, not run;
* no `RESEND_API_KEY` → no invitation email was delivered;
* `supabase` CLI / a database were not available → **migration 0007 has never
  been applied to a real Postgres**; it is validated by source assertions only.

Everything below separates what was **proved by execution** from what was
**established by code inspection**. The percentage reflects that split
honestly: the static and unit-testable surface is in good shape (443 automated
tests, clean typecheck, clean production build); the integrated, credentialed
surface is largely unverified.

**Launching on this report alone would be launching on an untested integration
layer.** Section H lists exactly what a human must do to close that gap.

---

## B. Coverage

| Dimension | Count | How it was covered |
|---|---|---|
| App + marketing routes | 24 | Code-read; public routes fetched over HTTP; authed routes reachable only to the login redirect |
| Vercel API functions | 9 | Code-read; all 9 probed live over HTTP (unauthenticated + malformed paths); 6 have unit suites |
| Supabase Edge Functions | 8 | Code-read; `export-run` additionally source-guarded; **none invoked** (no Supabase project) |
| Migrations | 7 (`0001`–`0007`) | Source-read in full; ordering/idempotency asserted by 19 source tests; **not applied to a database** |
| Automated tests | **443 passing** in 39 files | `npm test` |
| Typecheck | clean | `tsc --noEmit` |
| Production build | clean, 10 prerendered routes | `npm run build` |
| Defects found | **11** | 1 P0 open, 2 P1 fixed, 1 P1-class fixed, rest P2/P3 |
| Defects fixed in code | **10** | all with regression tests |
| Browser journeys A–E | **0 of 5 completed** | blocked — no credentials |

---

## C. Defect ledger

---

### D1 — CSV / spreadsheet formula injection in both export paths
**Severity P2 · Feature: CSV export · Status: FIXED**

* **Repro.** A lead whose name is `=cmd|'/c calc'!A1` (attacker controls this —
  it is scraped business text) is exported to CSV and the file is opened in
  Excel or LibreOffice.
* **Expected.** The cell displays as literal text.
* **Actual.** The spreadsheet evaluated it as a formula — DDE/command execution
  on the customer's machine. Zybble's own export is the delivery vehicle.
* **Root cause.** `csvEscape()` quoted for CSV correctness only; nothing
  neutralised a leading formula sigil.
* **Files.** `api/export-run.ts`, `supabase/functions/export-run/index.ts`
* **Fix.** `neutralizeCsvFormula()` prefixes `'` when a cell begins with
  `= + - @ TAB CR`, with deliberate carve-outs so real data is not mangled:
  plain numbers (`/^[+-]?\d+(\.\d+)?$/`) and international phone numbers
  (`/^\+\d[\d\s().-]*$/`) pass through untouched.
* **Regression test.** `api/_tests/export-run.test.ts` (6) +
  `edge-export-run.source.test.ts` (5) — covers `=cmd|'/c calc'!A1`,
  `=HYPERLINK(...)`, `@SUM(1+9)*cmd`, `+SUM(A1)`, `-2+3+cmd|...`, leading TAB,
  and the pass-throughs `+91 98765 43210`, `+1 (415) 555-0123`, `-12`, `-4.5`.
* **Retest.** Passing.

---

### D2 — IDOR in the Edge `export-run` function
**Severity P1 · Feature: CSV export · Security impact: cross-workspace data disclosure · Status: FIXED**

* **Repro.** Authenticated user in workspace A calls the Edge `export-run`
  with `listId` belonging to workspace B.
* **Expected.** Rejected.
* **Actual.** The function read `lead_list_members` by list id without ever
  checking that the list belonged to the caller's workspace, and it runs with
  elevated privileges — so it exported another tenant's leads.
* **Root cause.** Authorization was performed on the *workspace* parameter, not
  on the *resources* named by the request.
* **Files / DB.** `supabase/functions/export-run/index.ts`. No schema change.
* **Fix.** `lead_lists` and `lead_searches` are now resolved **workspace-scoped
  and before** any member read; `listId`/`searchId` must match a UUID; `source`
  is truncated to 120 chars.
* **Regression test.** `edge-export-run.source.test.ts` — asserts the
  workspace-scoped lookups are ordered before the member read, that the UUID
  guard exists, and that auth precedes work.
* **Retest.** Passing. *Caveat: source-level guard; the deployed function was
  never invoked.*

---

### D3 — `workspace_members` RLS allowed privilege escalation
**Severity P0 · Feature: Team / RBAC · Status: FIXED (migration not yet applied)**

* **Repro.** A `member` of a workspace issues a direct PostgREST
  `PATCH /workspace_members?id=eq.<own row>` with `{"role":"owner"}`.
* **Expected.** Denied.
* **Actual.** The policy's `USING`/`WITH CHECK` let a member rewrite their own
  role — full takeover of the workspace, its leads and its billing seat, using
  nothing but the public anon key and a normal login.
* **Root cause.** Self-referential policy that treated "this is my row" as
  sufficient authority to change any column on it, including `role`.
* **Files / DB.** `supabase/migrations/0007_membership_security_and_invitations.sql`
* **Fix.** Role changes are restricted to owner/admin; a member may not alter
  their own role; the last owner cannot be demoted or removed.
* **Regression test.** `supabase-migrations.source.test.ts` (19 tests).
* **Retest.** Source assertions passing. **Requires `supabase db push` and a
  live re-probe before launch — see H.**

---

### D4 — A team invitation could never be accepted
**Severity P1 · Feature: Team · Status: FIXED (DB + service + UI)**

* **Repro.** Invite a teammate from `/team`. They receive the email, click the
  link, sign up.
* **Expected.** They join the inviting workspace.
* **Actual.** They landed in a brand-new personal workspace. The invitation
  stayed `pending` **forever** — while still consuming one of the inviter's
  paid seats. There was no accept path anywhere in the product: no RPC, no
  service function, no UI. The entire team feature was decorative on the
  invitee's side, and seat exhaustion was permanent.
* **Root cause.** The invitation lifecycle was implemented only up to "send".
* **Files / DB.**
  * `supabase/migrations/0007_…sql` — `accept_invitation()` /
    `decline_invitation()` / `list_my_invitations()` SECURITY DEFINER RPCs that
    re-verify the caller's email server-side and re-check the seat limit at
    accept time;
  * `src/app/services/api.ts` — `listMyInvitations` / `acceptInvitation` /
    `declineInvitation` + error-code mapping;
  * `src/app/components/PendingInvitations.tsx` — new banner;
  * mounted in `src/app/pages/Overview.tsx` (where an invited signup actually
    lands) and `src/app/pages/Workspaces.tsx`.
* **Regression tests.** `src/app/services/team-workspace.test.ts` (22) and
  `src/app/components/PendingInvitations.test.tsx` (6 render-level: mounts,
  shows inviter/workspace/role, calls the RPC exactly once, dispatches
  `zybble:workspace` so the switcher reloads, swallows a failed lookup so it
  cannot break Overview, re-reads the list when the server rejects an accept).
* **Retest.** Passing. *The RPCs themselves have not run against Postgres.*

---

### D5 — Listed price is not the price charged
**Severity P0 · Feature: Pricing / Billing · Status: OPEN — OPERATOR DECISION REQUIRED**

* **Repro.** Open `/pricing` or `/billing`, choose Growth, proceed to Razorpay.
* **Expected.** Charged what the page advertised.
* **Actual.** The page advertises **$49**; Razorpay collects **₹49.00**
  (`plans.price_cents = 4900` paise). The same number is rendered with a dollar
  sign and charged in rupees — a **~85×** discrepancy.
* **Evidence.** `src/lib/site.ts:112+` (`0/49/99/199`),
  `src/app/lib/money.ts:39` (`LIST_CURRENCY = "USD"`),
  `src/sections/Pricing.tsx:48`, `src/app/pages/Billing.tsx:207,286`
  vs `BILLING_CURRENCY = "INR"` and `plans.price_cents` in `0001_init.sql`.
* **Why this is not being "fixed" here.** Either number may be the intended
  one. Changing the list price rewrites the company's public pricing; changing
  `price_cents` changes what every customer is charged. Both are business
  decisions with legal and revenue consequences, and the brief is explicit that
  human-configuration problems must not be dressed up as code fixes.
* **This blocks launch.** Advertising a dollar price and charging a rupee
  amount is a chargeback and consumer-protection exposure, in both directions.

---

### D6 — `/api/search-run` disclosed configuration state to anonymous callers
**Severity P3 · Feature: Search · Status: FIXED**

* **Repro.** `POST /api/search-run` with no `Authorization` header.
* **Expected.** `401 auth_missing`.
* **Actual.** `500` whose body revealed whether `SERPAPI_API_KEY` was
  configured — a free reconnaissance oracle on the provider stack, and the only
  route in the product whose error taxonomy disagreed with its siblings.
* **Fix.** Body parse and bearer extraction now precede the provider-config
  probe.
* **Regression test.** `api/_tests/search-run.test.ts` (17) — anonymous POST
  returns 401 `auth_missing` and the body contains no `SERPAPI`/`SUPABASE`
  string.
* **Retest.** Verified live against the dev server: `401 auth_missing`.

---

### D7 — Unlimited AI spend from a single signed-in account
**Severity P2 (cost / abuse) · Feature: Zybble AI · Status: FIXED**

* **Repro.** Authenticated Free user loops
  `POST /api/ai-analyze {leadId, workspaceId, refresh: true}`.
* **Expected.** Throttled.
* **Actual.** No limit of any kind. `refresh: true` deliberately bypasses the
  `ai_insights` cache, so every iteration was a fresh paid OpenRouter call.
  `has_ai` is a boolean with no allowance, and `increment_usage_counter(ai_runs)`
  is *recorded but never enforced*. `/api/ai-interpret` was equally open. Only
  the public `/api/ai-chat` had a limiter.
* **Files.** new `api/_lib/rate-limit.ts`; `api/ai-analyze.ts`;
  `api/ai-interpret.ts`
* **Fix.** A per-user governor (20/min per route) placed immediately after
  authentication. Keyed on user id rather than IP so one office behind a single
  NAT address is not throttled as one person.
* **Honest limitation, stated in the source.** Vercel scales horizontally, so an
  in-memory window is a **governor, not a hard quota** — it bounds blast radius
  and absorbs retry storms. A true cross-instance quota needs shared state
  (a Postgres allowance or KV). Recorded as follow-up rather than faked.
* **Regression test.** `api/_tests/ai-analyze.test.ts` — 25 looped requests
  yield exactly 20 × 200 and 5 × 429, the provider is reached exactly 20 times,
  and the 429 body carries `rate_limited` with no credential substring.
* **Retest.** Passing.

---

### D8 — Usage numbers did not match the quota the server enforces
**Severity P2 · Feature: Usage / Overview / sidebar · Status: FIXED**

* **Repro.** Run searches until ~all quota is consumed, delete some leads, open
  `/usage` and the sidebar meter, then run another search.
* **Expected.** One consistent number, and the search succeeds if the UI says
  quota remains.
* **Actual.** `/usage` and the sidebar counted **`leads` rows collected this
  month**, while `reserve_leads()` meters **`usage_counters.leads_used`** and
  returns 429 against *that*. Deleting leads lowered the displayed usage without
  returning any quota, so the UI promised remaining leads the next search
  refused. Overview already read the counter, so **two pages of the same product
  showed two different "leads used this month"**.
* **Second defect in the same query.** The twelve-month chart ordered
  `period_start` **ascending** with `limit(12)` — that returns the twelve
  **oldest** periods, so the chart silently froze once a workspace was a year
  old.
* **Files.** `src/app/services/api.ts` (`getUsage`)
* **Fix.** `used` is the authoritative counter for the current period, with the
  lead count kept only as the pre-counter fallback for a workspace whose period
  row does not exist yet. History is fetched descending and reversed for display.
* **Regression test.** `src/app/services/usage-truth.test.ts` (4) — counter wins
  over a divergent row count; fallback only when no counter row; `remaining`
  never negative; chart is most-recent, oldest-first.
* **Retest.** Passing.

---

### D9 — "Workspace saved" saved nothing
**Severity P1 (fake success) · Feature: Settings · Status: FIXED**

* **Repro.** Settings → Workspace → change the name → Save changes → reload.
* **Expected.** The workspace is renamed.
* **Actual.** A green "Workspace saved" toast and **no write at all** — the
  handler fell through to a generic `toast(\`${section} saved\`)`. The old name
  returned on the next load. The product lied to the user.
* **Files.** `src/app/services/api.ts` (new `renameWorkspace`),
  `src/app/pages/Settings.tsx`
* **Fix.** A real `UPDATE workspaces SET name` authorized by the existing
  `"workspaces owner admin update"` RLS policy — **not** by a client-side role
  check. RLS filters rather than fails, so "zero rows returned" is translated
  into "Only a workspace owner or admin can rename it." On success the
  `zybble:workspace` event refreshes the switcher, header and context; on
  failure the field is reverted to the stored name so it never displays a value
  the database rejected. Save is disabled while in flight and when unchanged.
* **Regression test.** `src/app/services/team-workspace.test.ts` (4 new) +
  `settings-no-fake-success.source.test.ts` (6) — the latter also pins the
  ordering (write *then* toast) and forbids a client-side role check.
* **Retest.** Passing.

---

### D10 — A Notifications settings page for emails that do not exist
**Severity P2 (fake functionality) · Feature: Settings · Status: FIXED by removal**

* **Repro.** Settings → Notifications → toggle anything → Save preferences →
  reload.
* **Expected.** Either the preference persists and changes behaviour, or the
  control does not exist.
* **Actual.** Four switches — "Search completion", "Exports ready", "Weekly
  usage digest", "Product updates" — plus a success toast. None were persisted
  anywhere, and **none of those emails exist in the product**: Resend is wired
  only to `team-invite`; there is no digest job, no search-completion mail, no
  product-update mail. Persisting the flags would have produced a second lie
  (a stored preference nothing reads), so the honest fix is removal.
* **Files.** `src/app/pages/Settings.tsx` — tab, state, the card and the
  now-orphaned `PrefRow` helper and `Switch`/`Clock` imports removed.
* **Regression test.** `settings-no-fake-success.source.test.ts` — fails if the
  tab, the switch labels, the state setters or `PrefRow` come back.
* **Retest.** Passing. Note: the `Switch` primitive in
  `src/app/components/ui.tsx` is now referenced nowhere in `src/`; it was left
  in place as a design-system export rather than deleted (see §D).

---

### D11 — Dead Tailwind class on the red badge
**Severity P3 · Status: FIXED**

`Badge tone="red"` carried both `text-red-650` (a colour defined nowhere in the
theme) and `text-red-700`. twMerge already resolved to the latter, so there is
no visual change; the undefined token is gone.
`src/app/components/ui.tsx`.

---

## D. Code-quality findings

**Good, and worth preserving**

* Every API route follows one error taxonomy: `{ error, code }`, `Cache-Control:
  no-store`, explicit `Allow` on 405. After D6 this is now **uniform across all
  nine routes** — verified live: `/api/health` → `{"ok":true,…}`; `/api/billing`
  with bad JSON → 400 `invalid_json`; `/api/ai-chat` without a marker → 400
  `message_invalid`; `/api/ai-lead` with an invalid email → 400;
  `/api/export-run` and `/api/search-run` without a token → 401 `auth_missing`;
  GET on any route → 405 JSON.
* The Razorpay webhook is genuinely idempotent and correctly ordered: HMAC
  verified **before** any work, then an insert into `webhook_events` with a
  UNIQUE `event_id` (Razorpay's own `x-razorpay-event-id`), and a duplicate
  delivery returns 200 without re-applying. Handler failures are recorded and
  still return 200 so the provider does not hot-loop, with
  `/api/billing action=sync` as the reconciliation path. Invoices are upserted
  on `razorpay_payment_id`, so a redelivery cannot double-invoice.
* Activation/renewal events deliberately do not touch `cancel_at_cycle_end`,
  which is the kind of subtlety that usually becomes a billing incident.
* `getUsage`, `getOverview` and the auth bootstrap all degrade rather than
  block: enrichment reads are wrapped in `withTimeout` with null fallbacks, so a
  slow `profiles` or `subscriptions` read cannot wedge sign-in.
* Logging hygiene is clean in `src/` — no tokens, emails or payloads logged.
* An `ErrorBoundary` exists and is mounted in `src/App.tsx`; the command palette
  is real (navigates, signs out, `role="listbox"`, labelled input).
* Only two `localStorage` keys (`zybble.leads.columns`, `zybble.preferences`)
  plus the workspace selection — no credentials or PII in web storage.

**Weaknesses**

1. **Entitlement is defined in three places.** `api/ai-analyze.ts` and
   `api/ai-interpret.ts` compute the plan as
   `["active","trialing"].includes(status)`, while `effective_plan_for_user()`
   and the client's `getEntitlements()` additionally honour a cancelled
   subscription until `current_period_end`. Today this is harmless **only
   because `has_ai` is true on every plan** — the check is effectively dead. The
   moment AI becomes a paid differentiator, a cancelled-but-unexpired customer
   loses AI early and the three definitions diverge in production. They should
   collapse onto one server-side source of truth. *Not changed here: it would
   alter entitlement behaviour with no environment to verify it in.*
2. **Out-of-order webhook delivery is unguarded.** Events are deduplicated but
   not sequenced; a `subscription.activated` arriving after a
   `subscription.cancelled` would re-activate. `action=sync` self-heals on the
   user's next visit, which is why this is recorded rather than patched — adding
   sequencing to a billing state machine with no test environment is a worse
   risk than the one it removes.
3. **In-memory rate limiting** (D7, and the pre-existing `/api/ai-chat` limiter)
   is per warm instance. Correct as a governor, insufficient as a quota.
4. `src/app/components/ui.tsx` still exports `Switch`, now referenced nowhere in
   `src/`. It is proven unused, but it is a design-system primitive rather than
   dead product code, so it was left in place and reported instead of deleted.
5. `getUsage` reads the plan allowance from the **client** catalogue
   (`planFromId`) while the server reads `plans`. They agree today; they are two
   sources for one number.

---

## E. Customer-experience findings

* **Fixed — the invited teammate's dead end (D4).** The single worst CX defect
  found: a paying customer invites a colleague, the colleague receives a real
  email, signs up, and arrives in an empty personal workspace with no
  explanation and no way forward — while the seat stays consumed. Both people
  reasonably conclude the product is broken.
* **Fixed — two lies in Settings (D9, D10).** A success toast over a no-op
  rename, and a notifications panel for mail the product never sends.
* **Fixed — contradictory usage numbers (D8).** Overview and `/usage`
  disagreeing about "leads used this month", with the sidebar meter siding with
  the wrong one, and quota that disappears when you delete leads.
* **Open — pricing (D5).** The highest-stakes CX item in the product: the number
  on the pricing page is not the number on the card statement.
* Error copy is consistently human ("Your session expired — sign in again.",
  "You don't have access to that workspace."), with no stack traces or provider
  names leaking to the client. The new strings match that voice.
* **Unverified.** Loading/empty/error states, 1440×900 / 1280×800 / 1024×768 /
  390×844 / 375×812 layout, keyboard navigation, focus management, screen-reader
  behaviour, multi-tab and bfcache, slow-network and double-submit were **not**
  exercised on authenticated screens, because no session could be created. The
  public marketing pages render and prerender correctly.

---

## F. Security findings

| Area | Result |
|---|---|
| Cross-tenant data access | **1 found, fixed** (D2 export IDOR) |
| Privilege escalation | **1 found, fixed** (D3 `workspace_members` RLS) |
| Secret exposure in `dist` | **None.** Scanned the built bundle for `rzp_live`, `sk-or-`, `serpapi`, `service_role`, `re_…`, `SUPABASE_SECRET` — no match. No API handler code is bundled client-side. |
| Indexable authed routes | Correctly blocked — `X-Robots-Tag: noindex` in `vercel.json`, and the prerenderer emits only the 10 public routes |
| CSV injection | **Found, fixed** in both export paths (D1) |
| Webhook authentication | Sound — HMAC verified before any side effect; replay-safe |
| Information disclosure | **1 found, fixed** (D6 config oracle) |
| Input validation | Hardened where missing (UUID regexes and length caps in Edge `export-run`); the API routes already validated UUIDs and clamped lengths |
| Rate limiting | Public chat was limited; **both authenticated AI routes were not** — fixed (D7). Search and export remain unlimited per-request but are bounded by lead quota. |
| Logging hygiene | No secrets or PII in logs |
| Security headers | Present in `vercel.json` |
| XSS | No `dangerouslySetInnerHTML` on user-controlled data |
| **RLS as a malicious client** | **NOT EXECUTED** — no Supabase project. This is the single largest open security gap; policies were read, not attacked. |

---

## G. External dependency status

| Provider | Configured here | Exercised |
|---|---|---|
| Supabase (DB, Auth, RLS, Edge) | No | **No** — no project reachable |
| Razorpay | No | **No** — no checkout, webhook or transition run |
| OpenRouter (DeepSeek V3.2) | No | No — provider stubbed in tests |
| SerpApi | No | **No** — search pipeline never run against the provider |
| Resend | No | No — no invitation email delivered |
| Vercel | n/a | Routing and headers verified from `vercel.json` + `vercel-routing.test.ts`; `dist` inspected |

Dependency audit is **closed**: no upgrades were performed and no package was
added (the rate limiter is ~60 lines of local code rather than a new dependency,
per the standing constraint).

---

## H. Human actions required

**Blocking — must be resolved before launch**

1. **Decide the pricing question (D5).** Either set the public list prices to
   INR, or raise `plans.price_cents` to the paise equivalent of the USD prices.
   This is a revenue and consumer-protection decision; no engineer should make
   it silently.
2. **Apply migration `0007` to the production database** (`supabase db push`)
   and then **re-probe the escalation directly**: as a plain `member`, attempt
   `PATCH /workspace_members?id=eq.<own row>` with `{"role":"owner"}` and
   confirm it is refused. D3 is a P0 and is only fixed once that migration is
   live.
3. **Provide credentials and re-run the integration layer.** Supabase
   (URL + publishable + secret), Razorpay **test** keys + webhook secret,
   SerpApi, OpenRouter, Resend. Until then journeys A–E, the RLS attack suite,
   the search pipeline, and the billing state machine are **unverified**, and
   the confidence figure in §A cannot responsibly rise above ~55%.

**Recommended before launch**

4. Deploy the updated Edge `export-run` (D1, D2) — the code fix has no effect
   until the function is redeployed.
5. Verify the invitation flow end to end once Resend and Supabase are live:
   invite → email → signup → the banner appears on `/overview` → accept → the
   workspace appears in the switcher → the seat is released on decline.
6. Promote the AI governor to a cross-instance quota (Postgres allowance or KV)
   if AI cost is material at your expected volume.
7. Collapse the three entitlement definitions onto one server-side source of
   truth before AI (or any feature) becomes a paid differentiator.
8. Confirm `dist/sitemap.xml` `<lastmod>` should be the build date for every
   post rather than each post's real `updated` date, and give the homepage its
   own OG image instead of reusing a blog post's.

---

## Changes in this branch

23 files, +1460 / −71.

**New:** `supabase/migrations/0007_membership_security_and_invitations.sql`,
`src/app/components/PendingInvitations.tsx`, `api/_lib/rate-limit.ts`,
`src/app/components/PendingInvitations.test.tsx`,
`src/app/services/usage-truth.test.ts`, `edge-export-run.source.test.ts`,
`settings-no-fake-success.source.test.ts`.

**Modified:** `api/export-run.ts`, `api/search-run.ts`, `api/ai-analyze.ts`,
`api/ai-interpret.ts`, `supabase/functions/export-run/index.ts`,
`src/app/services/api.ts`, `src/app/pages/Settings.tsx`,
`src/app/pages/Overview.tsx`, `src/app/pages/Workspaces.tsx`,
`src/app/components/ui.tsx`, and the corresponding test suites.

**Gate at HEAD:** `npm run typecheck` clean · `npm test` **443 passing / 39
files** · `npm run build` clean, 10 routes prerendered · `dist` secret scan
clean.
