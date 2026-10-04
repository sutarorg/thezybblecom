# MANUAL CHANGES REQUIRED FROM MY SIDE

This file is the operator runbook for the Team / Workspaces / Razorpay fix.
Everything under "Already completed in code" is done and committed — do **not**
redo it. Everything under "Manual setup" has to be done by a human in the
Supabase, Razorpay and Vercel dashboards, because it involves accounts,
secrets and provider-side configuration that code cannot create.

---

## A. Developer / code changes already completed (nothing for you to do here)

| Area | What was changed |
| --- | --- |
| Database | New migration `supabase/migrations/0006_team_workspace_billing_repair.sql` (762 lines, idempotent, additive — migrations `0001`–`0005` untouched). Adds authorized RPCs `list_workspace_team`, `list_user_workspaces`, `get_user_workspace`, `workspace_seat_usage`, `create_client_workspace`, `can_access_workspace`, `effective_plan_for_user`; fixes the `workspaces` select policy so an **owner** can always read their own workspace; backfills missing owner membership rows; makes billing tables INR-native; adds `subscription_checkouts`; adds the unique index that makes duplicate webhooks harmless. **No fake foreign key** was added between `workspace_members` and `profiles`. |
| `/team` | Roster now comes from the `list_workspace_team` RPC instead of the PostgREST embed that caused *"Could not find a relationship … in the schema cache"*. Shows name, email, role, workspace, active/invited, joined date; invite / remove / cancel-invitation all work; seat counts come from the server. |
| `/workspaces` | List/detail come from `list_user_workspaces` / `get_user_workspace`; personal workspace self-heals; a stale `localStorage` workspace id is dropped instead of breaking the page; client workspaces are created atomically with their owner membership. |
| Razorpay | Hosted-page redirect (`short_url` / `auth_link` / `api.razorpay.com/v1/l/…`) **removed everywhere**. `/api/billing?action=checkout` prepares the subscription server-side and returns only public config (`keyId`, `subscriptionId`, amount in paise, `INR`, prefill, method config). The browser opens the Razorpay **Standard Checkout modal** on zybble.com with `redirect: false`. |
| Verification | The plan is granted only by `action=verify`, which checks the HMAC signature, that the subscription belongs to this user, that the mandate is active, and that a real **captured INR payment** exists. Success / failure / dismiss / retry are all handled in the UI. |
| Webhooks | `supabase/functions/razorpay-webhook` rewritten: signature-verified before any DB write, deduplicated on `x-razorpay-event-id`, and handles authenticated / activated / charged / updated / pending / halted / paused / resumed / cancelled / completed / expired / payment.captured / payment.failed / refund.processed. |
| Entitlements | Effective plan, lead allowance, seat limit and Agency/Scale client workspaces refresh immediately after a verified payment — no logout/login. Cancellation sets `cancel_at_cycle_end` and drops to Free when the paid period ends. |
| Currency | All USD assumptions removed. Amounts are stored and sent in **paise** (₹49 = `4900`) and displayed as INR. |
| Tests | `npm run typecheck` clean, `npm test` → **397 passing**, `npm run build` clean. |

---

## B. Manual setup I must do myself

### B1. Supabase

1. **Run the SQL migration** (required — the app will keep failing until this runs).
   - CLI: `supabase db push` from the repo root, **or**
   - Dashboard → SQL Editor → paste the whole contents of
     `supabase/migrations/0006_team_workspace_billing_repair.sql` → Run.
   - It is idempotent and non-destructive; re-running it is safe.
   - Afterwards confirm in SQL Editor:
     ```sql
     select proname from pg_proc
     where proname in ('list_workspace_team','list_user_workspaces','get_user_workspace',
                       'workspace_seat_usage','create_client_workspace','effective_plan_for_user');
     ```
     Six rows must come back.

2. **Deploy the Edge Functions** (only needed if you use the Supabase fallback
   path; `/api/billing` on Vercel is the primary path, but the **webhook
   function is mandatory**):
   ```
   supabase functions deploy billing
   supabase functions deploy razorpay-webhook
   supabase functions deploy team-invite
   ```

3. **Set the Edge Function secrets** (`supabase secrets set …`). `SUPABASE_URL`
   and the service key are injected by the runtime — never set those yourself.
   ```
   supabase secrets set \
     RAZORPAY_KEY_ID=rzp_live_xxxxxxxx \
     RAZORPAY_KEY_SECRET=xxxxxxxx \
     RAZORPAY_WEBHOOK_SECRET=xxxxxxxx \
     RAZORPAY_PLAN_GROWTH_ID=plan_xxxxxxxx \
     RAZORPAY_PLAN_AGENCY_ID=plan_xxxxxxxx \
     RAZORPAY_PLAN_SCALE_ID=plan_xxxxxxxx \
     RAZORPAY_CHECKOUT_METHODS=card,wallet \
     RESEND_API_KEY=re_xxxxxxxx \
     RESEND_FROM_EMAIL="Zybble <hello@your-verified-domain.com>" \
     APP_URL="https://zybble.com"
   ```
   Redeploy the functions after changing secrets.

4. **Webhook endpoint URL** to give Razorpay (JWT verification is already
   disabled for this one function in `supabase/config.toml`):
   ```
   https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/razorpay-webhook
   ```

### B2. Razorpay

1. **Create one monthly INR plan per paid tier** (Dashboard → Subscriptions →
   Plans → Create Plan). Billing cycle **Monthly**, interval **1**,
   currency **INR**, amounts exactly:

   | Zybble plan | Amount | Amount in paise (what Razorpay stores) |
   | --- | --- | --- |
   | Growth | ₹49 / month | `4900` |
   | Agency | ₹99 / month | `9900` |
   | Scale | ₹199 / month | `19900` |

   These must match `plans.price_cents` in the database, which migration 0006
   sets to 4900 / 9900 / 19900. If you want different prices, change them in
   **both** places.

2. **Copy the three plan ids** (`plan_XXXXXXXXXXXX`) into
   `RAZORPAY_PLAN_GROWTH_ID`, `RAZORPAY_PLAN_AGENCY_ID`,
   `RAZORPAY_PLAN_SCALE_ID` in Vercel **and** Supabase secrets.

3. **Copy the API keys** (Settings → API Keys): `RAZORPAY_KEY_ID` (public,
   starts `rzp_test_` / `rzp_live_`) and `RAZORPAY_KEY_SECRET` (server-only,
   shown once — regenerate if lost).

4. **Enable payment methods** (Settings → Configuration → Payment Methods):
   turn on **Cards** and the **Wallets** you want. Apple Pay / Google Pay
   appear through the wallet channel on supported devices and must be
   explicitly enabled by Razorpay for your account — raise a support ticket if
   they are not listed. Only methods Razorpay has actually activated for your
   account will render, no matter what the code requests.

5. **Checkout Payment Configuration** (Settings → Configuration → Checkout):
   if you use a named configuration, make sure the methods allowed there
   include card and wallet, otherwise the modal will silently hide them.
   The app additionally restricts the modal via `RAZORPAY_CHECKOUT_METHODS`
   (default `card,wallet`; set to `all` to let Razorpay decide).

6. **Recurring/e-mandate**: subscriptions on cards require the recurring
   payments feature to be enabled on the account. Confirm in Dashboard →
   Subscriptions that you can create a live subscription; if the section is
   locked, request activation from Razorpay.

7. **Webhook** (Settings → Webhooks → Add New Webhook):
   - URL: the Supabase function URL from **B1.4**.
   - Secret: any strong random string — the **same value** you set as
     `RAZORPAY_WEBHOOK_SECRET`.
   - Active events (tick all of these):
     `subscription.authenticated`, `subscription.activated`,
     `subscription.charged`, `subscription.updated`, `subscription.pending`,
     `subscription.halted`, `subscription.paused`, `subscription.resumed`,
     `subscription.cancelled`, `subscription.completed`,
     `subscription.expired`, `payment.captured`, `payment.failed`,
     `refund.processed`.
   - Create the webhook **separately in Test mode and in Live mode** — they are
     different objects with different secrets.

8. **Test vs Live — what must match (very important):**
   - A `rzp_test_` key id must be paired with the **test** key secret and with
     **test-mode plan ids**. A `rzp_live_` key id must be paired with the live
     secret and **live-mode plan ids**. Mixing modes produces
     "The plan does not exist" or authentication failures at checkout.
   - Plan ids are **not** transferable between modes — create the three plans
     twice, once per mode, and keep two sets of env values.
   - Webhook secrets are per-webhook, so the test and live webhook secrets
     differ; `RAZORPAY_WEBHOOK_SECRET` in each environment must match the
     webhook of that same mode.
   - Rule of thumb: Vercel **Production** gets live values; **Preview** and
     **Development** get test values.

### B3. Vercel

Project → Settings → Environment Variables. Names must be exact.

| Variable | Scope | Visibility | Notes |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Production, Preview, Development | public (shipped to browser) | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Production, Preview, Development | public | publishable/anon key only |
| `SUPABASE_URL` | Production, Preview, Development | server | used by `/api/*` |
| `SUPABASE_PUBLISHABLE_KEY` | Production, Preview, Development | server | |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview, Development | **secret** | never expose |
| `RAZORPAY_KEY_ID` | Production (live), Preview + Development (test) | server | returned to the browser by the API, but set it as a server var — do **not** prefix it with `VITE_` |
| `RAZORPAY_KEY_SECRET` | Production (live), Preview + Development (test) | **secret** | |
| `RAZORPAY_WEBHOOK_SECRET` | Production (live), Preview + Development (test) | **secret** | must equal the Razorpay webhook secret of the same mode |
| `RAZORPAY_PLAN_GROWTH_ID` | Production (live), Preview + Dev (test) | server | |
| `RAZORPAY_PLAN_AGENCY_ID` | Production (live), Preview + Dev (test) | server | |
| `RAZORPAY_PLAN_SCALE_ID` | Production (live), Preview + Dev (test) | server | |
| `RAZORPAY_CHECKOUT_METHODS` | all three | server | optional; defaults to `card,wallet` |
| `APP_URL` | all three | server | `https://zybble.com` in Production |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | all three | secret / server | team invitation emails |

**Redeploy is required** after adding or changing any of these — Vercel bakes
env vars at build/deploy time, so an existing deployment will keep using the
old values.

### B4. Local development

1. Copy `.env.example` → `.env.local` and fill it with **test-mode** Razorpay
   values and your Supabase project values.
2. No new npm packages are needed. Razorpay's `checkout.js` is loaded on demand
   from `https://checkout.razorpay.com/v1/checkout.js`; there is no Razorpay
   SDK dependency.
3. Commands:
   ```
   npm install
   npx supabase db push          # applies migration 0006 locally
   npm run typecheck
   npm test
   npm run dev
   ```
4. To test webhooks locally, point a Razorpay **test-mode** webhook at your
   deployed Supabase function (webhooks cannot reach `localhost`), or replay a
   delivery from the Razorpay dashboard.

---

## C. Production-readiness checklist

### `/team`
- [ ] Migration 0006 applied; the six RPCs exist.
- [ ] `/team` loads with no "We couldn't load your team" error and no schema-cache error in the console.
- [ ] Each row shows name, email (where available), role, workspace, Active/Invited, joined date.
- [ ] Invite sends an email; the invitee appears as **Invited**; cancelling the invitation removes the row and the seat.
- [ ] Removing a member works and frees a seat.
- [ ] Seat limits enforced from the **owner's** plan: Free/Growth 1, Agency 3, Scale 5 — active members **plus** pending invites count.
- [ ] A member of another workspace cannot see this roster.

### `/workspaces`
- [ ] `/workspaces` loads with no "You don't have access to that resource."
- [ ] Personal workspace is always present (it is re-created if its membership row was missing).
- [ ] Agency/Scale can create a client workspace; Free/Growth get a clear entitlement message.
- [ ] Switching workspaces updates the whole app without a reload.
- [ ] A stale workspace id in `localStorage` (deleted or revoked) silently falls back to a valid workspace.
- [ ] Hand-entering another user's workspace id shows the not-found state, never their data.

### Razorpay checkout
- [ ] Clicking Upgrade opens the Razorpay **modal on zybble.com** — no new tab, no `api.razorpay.com/v1/l/…`, no "Hosted page is not available".
- [ ] Cards and the enabled wallets (incl. Apple Pay on supported devices) are offered.
- [ ] A successful test payment upgrades the plan only after server verification; the plan, lead allowance, seat limit and client-workspace entitlement update without re-login.
- [ ] A failed payment, a closed modal and a retry all leave the plan unchanged and show a usable message.
- [ ] The webhook endpoint returns 200 in the Razorpay dashboard; replaying the same event does not duplicate invoices or payments.
- [ ] Cancel sets "cancels at period end"; access remains until `current_period_end`, then drops to Free.
- [ ] Renewal (`subscription.charged`) extends the period and creates one invoice.
- [ ] Amounts display as ₹ everywhere; no USD anywhere.
- [ ] `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and the service-role key appear in **no** browser payload or bundle.

---

## D. Admin console (`/admin`)

The console is already in the code. It is **not** usable until the database
migration has been applied and at least one account holds the admin role.

### D1. What the code already does (nothing to do)

| Area | What was added |
| --- | --- |
| Database | `supabase/migrations/0008_admin_console.sql` — idempotent and additive (`0001`–`0007` untouched). Adds the append-only `admin_audit_logs` table, ~30 operational indexes, and 19 `security definer` reporting/mutation functions that are **revoked from `anon` and `authenticated`** and granted only to `service_role`. No existing RLS policy is relaxed. |
| API | One Vercel function, `api/admin.ts`, serving every `/api/admin/*` endpoint. It verifies the caller's Supabase JWT, re-reads `profiles.role` from the database on **every** request (reads and writes), and only then uses the privileged server client. Errors are always `{error, code}` — never a raw Postgres message. |
| Audit | Every privileged mutation requires a typed reason plus an explicit confirmation, and writes an `admin_audit_logs` row with actor, action, target, before/after state, reason, IP and user agent — including when the action fails. |
| UI | `/admin` and its 14 sub-routes, in their own lazy chunk and their own layout (not the customer `AppLayout`). The UI gate calls `GET /api/admin/me`; the client never holds a privileged credential. |

### D2. Apply the migration (required)

1. `supabase db push` from the repo root, **or** paste
   `supabase/migrations/0008_admin_console.sql` into Dashboard → SQL Editor → Run.
2. Verify:
   ```sql
   select count(*) from pg_proc where proname like 'admin\_%';   -- expect 19
   select relrowsecurity from pg_class where relname = 'admin_audit_logs'; -- t
   ```

### D3. Make the first administrator (required, one time)

`profiles.role` is protected by a trigger, so promote the first admin with SQL
(the console can do every promotion after that):

```sql
update profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@yourdomain.com');
```

Then sign in and open `https://zybble.com/admin`.

### D4. Environment variables

The console adds **no new variables**. It reuses the server-side values that
`/api/billing` already needs:

| Variable | Where | Public/secret | Needed for | Redeploy |
| --- | --- | --- | --- | --- |
| `SUPABASE_URL` | Vercel → Environment Variables | public value, server-side | all admin endpoints | yes |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) | Vercel | **secret — never `VITE_`** | all admin endpoints | yes |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Vercel | **secret** | the "Reconcile with Razorpay" action only | yes |
| `SERPAPI_API_KEY`, `OPENROUTER_API_KEY`, `RESEND_API_KEY`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_*_ID`, `APP_URL` | Vercel | **secret** (plan ids: non-public config) | reported as present/missing on `/admin/system`; not required by the console itself | yes |

Nothing admin-related belongs in a `VITE_*` variable. If a secret ever appears
in one, it is in the browser bundle and must be rotated.

### D5. Production checklist

- [ ] Migration 0008 applied; 19 `admin_*` functions exist.
- [ ] At least one `profiles.role = 'admin'` account exists.
- [ ] A normal customer hitting `/admin` sees "Admin access required", and
      `curl -H "Authorization: Bearer <their token>" https://zybble.com/api/admin/users`
      returns **403**.
- [ ] No token at all returns **401** from every `/api/admin/*` endpoint.
- [ ] `/admin/users/<id>` survives a hard refresh (Vercel rewrite + SPA route).
- [ ] Granting a role, suspending an account, editing a plan, adjusting a quota
      and reconciling a subscription each appear in `/admin/audit-logs` with a
      reason.
- [ ] `update admin_audit_logs set action = 'x';` fails with
      `admin_audit_logs is append-only` (test it in the SQL editor).
- [ ] A suspended account really cannot sign in.
- [ ] `/admin/system` shows the database as Healthy and the credentials you set
      as Configured.
