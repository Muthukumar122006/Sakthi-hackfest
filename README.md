# Sakthi-hackfest — EduGen Smart

EduGen Smart is a React + TypeScript/Vite application for planning educational images. It keeps provider credentials on Supabase Edge Functions, checks an exact approved-asset match before generation, and labels costs as estimates until a billing source confirms an actual charge.

## Run the frontend

```powershell
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and set the public Supabase project URL and publishable/anon key. Local environment files are ignored by Git. The app still opens without Supabase, using visibly labelled sample records; sign-in, shared school records, and generation require a configured project.

## Supabase setup

Install the Supabase CLI separately, then link this repository to your Supabase project and apply the migration:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy generate-image
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
supabase functions serve generate-image --env-file supabase/functions/.env.local
```

Never commit the function env file or put provider/service-role secrets in a `VITE_*` variable. The local function also needs a configured source-linked price row and a signed-in local Supabase user. Without a provider key, exercise auth, schema, policies, and non-generation screens locally; do not fake successful generation results.

Enable email and SMS authentication in the Supabase dashboard before using those sign-in options. Configure the project redirect URLs for the local and deployed app.

The Supabase Edge Function uses the platform-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` server environment variables. Set the image provider key and function options as server-side Edge Function secrets, never as `VITE_*` variables. `APP_ORIGIN` is a single exact HTTPS origin in production; only localhost HTTP origins are allowed for local development. Other browser origins are rejected:

```powershell
supabase secrets set OPENAI_API_KEY=YOUR_PROVIDER_KEY IMAGE_PROVIDER=openai APP_ORIGIN=http://localhost:5173
```

The frontend requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. The SQL files in `supabase/migrations/` are additive and should be applied in timestamp order. `supabase db push` applies the base EduGen schema and the later category/audience, profile, request-limit, image-file-metadata, and atomic-generation-completion migrations. The Edge Function code checks a 10-request-per-hour per-user limit and requires a UUID idempotency key for generation requests. A repeated successful request returns the existing saved image; a queued request cannot start a second provider call. Asset creation, generated-request finalization, and estimated school-budget settlement are performed by a service-role-only database function in one transaction. These server-side behaviors require the migrations and function to be deployed before they are active.

The Edge Function uses the model, quality tier, requested image size, per-image price, and source URL stored in `provider_pricing`. Before generation can run, an administrator must verify and add current OpenAI pricing entries from the provider's published pricing page. The app does not seed current provider prices. Add one active USD entry per supported tier, with the appropriate per-image unit, `effective_from` date, and verified HTTPS `source_url`. Keep historical rows by setting their `active` field to false instead of overwriting their source. Demo prices are examples, not current provider prices; configured prices are estimates and are not actual bills.

The database migration creates schools, memberships, profiles, assets, image requests, provider pricing, budget records, private image storage and row-level security policies. Create a school and assign an initial admin membership using a trusted Supabase SQL/admin workflow. Membership creation and provider-price edits are not available to ordinary browser users. School role checks and monthly budget reservation run on the server; school budget updates are permitted only for school admins. Generated personal images stay private to their creator. Images generated for a school wait for an admin to approve them before other school members can reuse them.

## What works and what still needs setup

- Email login, registration, verification links and password reset use Supabase Auth when configured. Phone OTP uses the selected country, validates and sends E.164 phone numbers, and requires Supabase phone auth plus a configured SMS provider. The selected phone country/calling code is saved separately from the display currency; it is a preference, not proof of residence.
- Intent suggestions use simple, visible keyword rules. Teachers can change the detected purpose.
- The Generate page accepts a creative category, target audience age band (or custom range), educational purpose, and optional wishes. Category ideas append to the current prompt instead of replacing it. A transparent local rule engine suggests Budget, Balanced or High Quality; manual quality choices stay selected until the user accepts the recommendation.
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

Local verification for this implementation included the frontend no-emit TypeScript check, `deno check supabase/functions/generate-image/index.ts`, parsing `supabase/config.toml` and the image-metadata migration, executing the atomic completion migration against a disposable PostgreSQL-compatible runtime with fixture tables (including personal, school-budget, and rollback cases), an isolated Vite production bundle written outside the repository, browser checks of all seven navigation destinations plus browser back/forward and responsive layouts, and `git diff --check`. The repository has no configured automated test script. The temporary database fixture is not a substitute for running the full Supabase migrations, policies, auth, Storage, or Edge Function in Supabase.

A local Supabase stack additionally requires Docker Desktop and the Supabase CLI. A hosted Supabase project with email/phone auth settings and SMS delivery configuration, the Supabase URL and keys, server-side OpenAI API key, deployed migrations/function, valid source-linked provider price rows, and private Storage bucket/policies is required to validate authentication, database policies, provider calls, saved-image retrieval, request limits, and budget enforcement end to end. No local or hosted Supabase stack was started; migrations were not applied to Supabase and the Edge Function was not deployed. Actual billing data is not connected to this flow, so actual billed cost is unavailable.
