# Sakthi-hackfest — EduGen Smart

EduGen Smart is a React + TypeScript/Vite application for planning educational images. It keeps provider credentials on Supabase Edge Functions, checks an exact approved-asset match before generation, and labels costs as estimates until a billing source confirms an actual charge.

## Run the frontend

```powershell
npm install
npm run dev
```

Create a root `.env.local` file from the example and set these exact Vite variables:

```powershell
Copy-Item .env.example .env.local
```

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

Use the project's public publishable/anon key only. Never put a service-role key or provider secret in a `VITE_*` variable. Restart Vite after editing `.env.local`. Local environment files are ignored by Git. The app still opens without Supabase, using visibly labelled sample records; sign-in, shared school records, and generation require a configured project.

## Supabase setup

Install the Supabase CLI separately, then link this repository to your Supabase project and apply the migration:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy generate-image
supabase functions deploy planner-services
supabase functions deploy resolve-image-request
```

### Run the backend locally

The repository includes `supabase/config.toml` for a local Supabase stack. Install Docker Desktop and the Supabase CLI, then run:

```powershell
supabase start
supabase status
supabase db reset
```

`supabase db reset` recreates the **local** database and applies every migration in order; it deletes local Supabase data, so use it only for a disposable development stack. Set the local API URL and anon/publishable key printed by `supabase status` in the root `.env.local` for the frontend.

For local image generation, copy `supabase/functions/.env.example` to `supabase/functions/.env.local`, set the provider key, keep `IMAGE_PROVIDER=openai`, and set `APP_ORIGIN` to the frontend's exact origin (no trailing slash), such as `http://127.0.0.1:5173`, then run:

```powershell
supabase functions serve --env-file supabase/functions/.env.local
```

Never commit the function env file or put provider/service-role secrets in a `VITE_*` variable. The local function also needs a configured source-linked price row and a signed-in local Supabase user. Without a provider key, exercise auth, schema, policies, and non-generation screens locally; do not fake successful generation results.

In the Supabase dashboard, open **Authentication → Providers → Email** and enable Email sign-in (and sign-ups if users should be able to register). Email confirmation can remain enabled; users must follow the verification link before signing in. SMS sign-in is optional and also needs an SMS provider.

In **Authentication → URL Configuration**, set the local Site URL to `http://localhost:5173` and add `http://localhost:5173` to the redirect URL allow list. Also add `http://localhost:5173/**` so verification and password-reset links can return to their routes. If you open Vite at `http://127.0.0.1:5173`, add `http://127.0.0.1:5173` and `http://127.0.0.1:5173/**` as well. Add the production app URL and its redirect pattern before deployment.

The Supabase Edge Function uses the platform-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` server environment variables. Set the image provider key and function options as server-side Edge Function secrets, never as `VITE_*` variables. `APP_ORIGIN` is a single exact HTTPS origin in production. For local development, both `http://localhost:5173` and `http://127.0.0.1:5173` are allowed; other browser origins are rejected:

```powershell
supabase secrets set OPENAI_API_KEY=YOUR_PROVIDER_KEY IMAGE_PROVIDER=openai APP_ORIGIN=http://localhost:5173
```

The frontend requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. The SQL files in `supabase/migrations/` are additive and should be applied in timestamp order. `supabase db push` applies the base EduGen schema and all later migrations, including request reliability, review history, operator authorization, and trusted image recovery. The Edge Function code checks a 10-request-per-hour per-user limit and requires a UUID idempotency key for generation requests. A repeated successful request returns the existing saved image; a queued request cannot start a second provider call. Asset creation, generated-request finalization, and estimated school-budget settlement are performed by a service-role-only database function in one transaction. These server-side behaviors require the migrations and functions to be deployed before they are active.

During prior hosted verification, `planner-services` and `generate-image` returned HTTP 404, so neither was available at the configured project's function URLs at that time. The recovery function is also new source and must be deployed before its operator page can work. A failed price-list request is not evidence that a particular quality tier has no configured price. Deploy all three functions after applying reviewed migrations; local source changes do not update the hosted project automatically. The Supabase CLI is not installed in this workspace, so hosted migrations and function deployment still need to be run from an environment with the CLI and authorized project access.

The Edge Function uses the provider, model, quality tier, image size, per-image price, effective date, and source URL from the same `provider_pricing` row: the row's model and size are sent to OpenAI and its USD price is used for the estimate. The current tiers are `draft-rapid`, `precision-lite`, and `studio-pro`; they are application choices mapped to the model/size explicitly stored for each tier, not separate model names by assumption. `cost_per_image` is PostgreSQL `numeric(12,6)` and represents the per-image unit. Rows must be active, USD-denominated, HTTPS-source-linked, and effective on or before today. The schema permits one active row per provider and tier; it does not currently store a separate `verified_at` field.

Before generation can run, an authorized administrator must verify current provider prices against the provider's published pricing page, then configure the exact provider model and supported size in `provider_pricing`. No prices are seeded or inferred by the app. Use Supabase Dashboard → Table Editor → `provider_pricing` (or an authorized SQL/admin workflow) to add a row with the verified `provider`, `model`, `quality_tier`, `image_size`, `currency`, `cost_per_image`, `source_url`, `effective_from`, and `active` values. Deactivate the previous row for that provider and tier before activating its replacement. Do not enter a placeholder/estimated-from-memory price or mark an unverified source as verified. Price writes are not exposed to ordinary signed-in users; do not grant browser roles write access.

To diagnose the three supported tiers, an authorized administrator can use the Supabase SQL editor:

```sql
select provider, model, quality_tier, image_size, currency, cost_per_image,
       source_url, effective_from, active, updated_at, updated_by
from public.provider_pricing
where quality_tier in ('draft-rapid', 'precision-lite', 'studio-pro')
  and active
  and effective_from <= current_date
order by provider, quality_tier, effective_from desc;
```

For generation to be enabled, the selected tier must have a current active USD row and `studio-pro` must have a current baseline row. Check that `IMAGE_PROVIDER` matches the row's provider and that its model/size are accepted by the provider API. If the planner function reports a service/network error, deploy and restore the function first; do not diagnose that as a missing database price. Demo prices are examples, not current provider prices; configured prices are estimates and are not actual bills.

The database migrations create schools, memberships, profiles, assets, image requests, provider pricing, budget records, private image storage and row-level security policies. New migrations must be applied in timestamp order; migrations `202610210001` through `202610210003` add uncertain request handling, fingerprint/attempt metadata, review decisions/history, operator authorization, and image recovery. These migrations are source changes only and are not applied by this task.

### Image generation reliability and review operations

Generation attempts claim the per-user hourly provider quota atomically immediately before calling the provider. Invalid input, pricing/budget/configuration failures, and exact approved-image reuse do not consume a provider-attempt slot. Provider attempts that are rejected by the provider still count; a retry using the same idempotency key does not claim another slot. Reuse does not call the provider.

Each new request stores a SHA-256 fingerprint of normalized generation inputs, tenant scope, configured model, and image size. Reuse of the same key for different or legacy unverifiable inputs is rejected. Requests whose provider outcome, response, storage upload, or completion cannot safely be confirmed become `uncertain`; the system does not retry the provider call or release its budget reservation automatically. The user-facing message and request history instruct the user not to resubmit.

The migration adds `mark_stale_image_requests(interval)`, a service-role-only RPC. It marks provider attempts older than three minutes `uncertain`; requests that are stale before a provider attempt are failed and any reserved school budget is released. No scheduler is enabled by the repository. Configure a trusted server-side scheduled worker (for example, a secured scheduled job calling the Supabase PostgREST RPC endpoint) to invoke it at a cadence appropriate to the Edge Function timeout. Store the service-role credential only in the scheduler's secret store and send it only in authorization headers; never put it in browser code, query parameters, URLs, or logs. Monitor queued and uncertain request counts and investigate provider/storage outcomes before resolving uncertain requests.

Only users explicitly allow-listed in `public.image_generation_operators` may use the recovery page at `/image-operations`. Provision and revoke operator rows through a trusted administrative workflow; ordinary authenticated users have no table access and request owners cannot resolve uncertain requests. The page offers two audited actions. “Confirm no image exists” invokes `resolve_uncertain_image_request`, which fails the request and releases a still-reserved school estimate atomically. “Recover known stored PNG” calls the `resolve-image-request` Edge Function; that function downloads only the deterministic private path for the request, validates size and PNG structure, computes its content hash, then calls a service-role-only RPC that atomically creates the pending asset, settles the estimate reservation once, finalizes the request, and records the operator and note. Neither action calls the image provider. If no known valid image exists or the provider outcome cannot be established, leave the request uncertain and retain its reservation.

The recovery Edge Function deployment requires `verify_jwt = true` and the platform Supabase environment variables; it uses the caller's verified JWT for operator authorization and service role only for restricted storage/database operations. Deploy it with `supabase functions deploy resolve-image-request` after applying reviewed migrations. The `202610210003` migration adds the operator allowlist but intentionally does not insert operator records. An administrator must provision operator identities through an approved trusted workflow. Audit history is visible to the authorized operator, request owner, or relevant school admin according to RLS.

All generated assets start in `pending` review, including personal/private assets. Authenticated creators can review their own private pending images; only school admins can review school assets. The `review_educational_asset` RPC records approval/rejection, reviewer, timestamp and note. Rejected assets are excluded from the approved library and exact-match reuse. PNG signature/dimension/size checks establish only basic technical validity; they do not establish educational accuracy, safety, or audience suitability. A human reviewer remains responsible for content approval.

Provider prices, baseline estimates, and school budget reservations remain estimates, not actual provider bills. This workflow has no trusted billing reconciliation source; actual charges remain unpopulated until an authorized provider billing source and auditable reconciliation process are configured. Generation estimates and budget reservations are explicitly USD-denominated. A non-USD display preference does not convert generation estimates in this endpoint; the UI displays the currency recorded on the estimate rather than treating USD as the selected display currency. Budget conversions retain source URLs and dates when an exchange rate is used.

This project does not configure or enable a scheduler automatically. Applying the migrations, deploying `generate-image`, `planner-services`, and `resolve-image-request`, setting the server-only `OPENAI_API_KEY`, `IMAGE_PROVIDER`, and `APP_ORIGIN` secrets, provisioning operators, and configuring the trusted recovery scheduler are separate deployment/operations steps. Test the migrations and RPC authorization against a disposable local Supabase instance before production use; do not apply them directly without the project's normal review/backup process.

For scheduled recovery, call `POST /rest/v1/rpc/mark_stale_image_requests` from the trusted scheduler with a JSON body such as `{"stale_after":"3 minutes"}` and the project API key/service-role authorization stored in its secret manager. Never call this from the browser or expose the credential. The three-minute default is a conservative stale detector, not proof of provider failure. Alert on any uncertain requests and on queued requests older than the configured timeout. Operators should check the OpenAI request/billing records and the deterministic private Storage path before choosing either recovery action. If evidence is inconclusive, leave the request unchanged; do not retry the provider call.

The database migration creates schools, memberships, profiles, assets, image requests, provider pricing, budget records, private image storage and row-level security policies. Create a school and assign an initial admin membership using a trusted Supabase SQL/admin workflow. Membership creation and provider-price edits are not available to ordinary browser users. School role checks and monthly budget reservation run on the server; school budget updates are permitted only for school admins. Generated personal images stay private to their creator. Images generated for a school wait for an admin to approve them before other school members can reuse them.

`planner-services` exposes the authenticated `health`, `prices`, and `recommendation` actions. Health confirms only that this API function is responding; it deliberately does not claim the image provider is healthy. Pricing returns only current, active, source-linked prices visible to the signed-in user, including provider, model, quality tier, image size, USD amount, effective date, active/applicable status and the explicit `per_image` unit. Recommendations use transparent server-side rules and include configured model, price and limitations; a selected quality remains the user's choice. The generation response records the actual configured provider/model, selected tier, image size, price source/date and per-image estimates. Both Edge Functions use a consistent `{ success, error: { code, message } }` error response. Request history uses the existing row-level-secured Supabase API and supports page-based retrieval and fetching one request; rows are not deletable through the current product policy.

### API reference

All Edge Function calls use `POST /functions/v1/<function-name>` with the configured Supabase project key. Pricing, recommendation, and generation require a valid signed-in session; health reports function availability without checking a user or the image provider. Generation additionally checks membership, request limits, pricing, budget, provider output, and storage.

- `planner-services`: `{ "action": "health" }` reports API availability and `provider_status: "not_checked"`; `{ "action": "prices" }` returns active per-image estimates, source links, supported tiers and sizes; `{ "action": "recommendation", "prompt": "...", "category": "educational", "intent": "general_illustration", "target_audience": "All ages", "target_budget": 2, "budget_currency": "USD", "selected_quality_tier": "precision-lite" }` returns a rule-based recommendation, limitations, configured price (if available), and the selected tier unchanged.
- `generate-image`: accepts the planner's idempotency key, prompt, category, audience, intent, language, style, selected tier, optional school and budget, and display currency. On success it returns `request_id`, `asset_id`, a short-lived signed `image_url`, actual file byte size, requested image size, and source-linked cost estimates. Provider-only duration, actual billing, compute, and energy measurements are not returned because they are not verifiable here.
- `resolve-image-request`: operator-only actions are `list_uncertain`, `confirm_no_image`, and `recover_stored_image`. Calls require a signed-in, allow-listed operator and an audit note for resolution actions.
- Generation history and user preferences use the authenticated Supabase Data API under RLS. History listing accepts a page (1-based) and page size (1–100); fetching an ID remains scoped by the user's database permissions.

## What works and what still needs setup

- Email login, registration, verification links and password reset use Supabase Auth when configured. Phone OTP uses the selected country, validates and sends E.164 phone numbers, and requires Supabase phone auth plus a configured SMS provider. The selected phone country/calling code is saved separately from the display currency; it is a preference, not proof of residence.
- Intent suggestions use simple, visible keyword rules. Teachers can change the detected purpose.
- The Generate page accepts a creative category, target audience age band (or custom range), educational purpose, and optional wishes. Category ideas append to the current prompt instead of replacing it. Signed-in users receive a transparent server-side rule-based quality suggestion using the request, configured options, and budget; guest mode uses the local rules. Manual quality choices stay selected until the user accepts the suggestion.
- An exact match checks the full normalized request, category, audience, purpose, language, style and quality tier against an approved asset before generation. Semantic search is not enabled.
- OpenAI image generation runs only inside the Supabase Edge Function. Requests need valid authentication, current source-linked prices, and enough budget. Generated files are stored in a private bucket and returned as short-lived previews.
- Every completed generation or reuse response includes the selected method, estimate, maximum-quality baseline, estimated savings and percentage when comparable source-linked prices are available, plus the calculation, source date and estimate classification. Provider prices are estimates, not the actual bill. Reuse estimates describe avoided generation API cost only and exclude storage/service costs.
- The quality check confirms a valid PNG signature and minimum dimensions. It does not judge image meaning or safety; a teacher must review each image.
- School spending is reserved atomically before generation. Stored values are estimates based on the configured price list; actual provider charges are not available from this flow and are never presented as billed amounts.
- Approved asset search, request history, settings, overview, analytics and school budgets use Supabase data when signed in. Without Supabase, the app displays sample records marked as demo data.
- Currency display uses the browser's `Intl.NumberFormat` and Frankfurter exchange rates. The country is a user preference, not verified location.
- Completed requests show total client-observed request duration measured from immediately before the Supabase function call until its response has been received, parsed, and validated. It includes client/network time and the service's wait for the provider; it excludes the later browser image load. This is not provider-only generation time. The OpenAI response used here does not expose a verifiable provider-only generation duration, so the UI marks it unavailable.
- The image file size is the exact byte length of the decoded PNG bytes that the Edge Function uploads. That byte count is saved as `educational_assets.file_size_bytes` and is reused without downloading the image again. Older saved images without this metadata show file size as unavailable. The UI formats byte counts using binary units (1 KiB = 1024 bytes; 1 MiB = 1024 KiB). Pixel dimensions come from the browser's `naturalWidth` and `naturalHeight` after the signed image loads; if it cannot load, dimensions are shown as unavailable.
- Compute and energy usage are marked unavailable because the configured provider does not expose verifiable measurements. Budget/Balanced/High Quality are relative quality choices, not compute, energy, carbon, or GPU-time measurements.
- The main interface is currently in English. Image output language can be selected as English, Hindi or Tamil.
- School creation, membership administration, review/approval of school images and price-list maintenance require a trusted admin workflow in Supabase. Only one active price row per provider and quality tier is allowed; mark the previous row inactive before adding an updated price.

## Checks

Run the frontend TypeScript check without generating build files:

```powershell
npm exec -- tsc --noEmit --pretty false -p tsconfig.app.json
```

Validation completed for the current source includes `node --test tests/image-generation-helpers.test.mjs` (6 passing tests), `node --check` for the shared helper, `npm run build`, frontend diagnostics, and `git diff --check`. The build reports existing warnings about a mixed static/dynamic import and a large JavaScript chunk. Deno, Docker, PostgreSQL tooling, and the Supabase CLI are unavailable in this workspace, so the Edge Functions and SQL migrations were not runtime-validated here. The repository has no configured automated test script; these helper tests do not replace testing the migrations, policies, auth, Storage, and Edge Functions in a disposable local Supabase stack.

A local Supabase stack additionally requires Docker Desktop and the Supabase CLI. A hosted Supabase project with email/phone auth settings and SMS delivery configuration, the Supabase URL and keys, server-side OpenAI API key, deployed migrations/function, valid source-linked provider price rows, and private Storage bucket/policies is required to validate authentication, database policies, provider calls, saved-image retrieval, request limits, and budget enforcement end to end. No local or hosted Supabase stack was started; migrations were not applied to Supabase and the Edge Function was not deployed. Actual billing data is not connected to this flow, so actual billed cost is unavailable.
