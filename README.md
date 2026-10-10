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

Enable email and SMS authentication in the Supabase dashboard before using those sign-in options. Configure the project redirect URLs for the local and deployed app.

Set the image provider key as an Edge Function secret, never as a `VITE_*` variable:

```powershell
supabase secrets set OPENAI_API_KEY=YOUR_PROVIDER_KEY IMAGE_PROVIDER=openai APP_ORIGIN=http://localhost:5173
```

The SQL files in `supabase/migrations/` are additive and should be applied in timestamp order. `supabase db push` applies both the base EduGen schema and the later category/audience, profile and request-limit changes. The Edge Function enforces a 10-request-per-hour per-user limit and requires a UUID idempotency key for generation requests. A repeated successful request returns the existing saved image; a queued request cannot start a second provider call.

The Edge Function uses the model, quality tier, image size, published price, and source URL stored in `provider_pricing`. Before generation can run, an administrator must add the current OpenAI price entries from the provider's published pricing page. The app intentionally does not seed or invent provider prices. Add one active USD entry per supported tier, with the current `effective_from` date and a verified HTTPS `source_url`. Keep historical rows by setting their `active` field to false instead of overwriting their source.

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
- Completed requests show the client-observed request duration (including network and service response time) and the loaded image's actual pixel dimensions. This is not a provider-only generation-time or file-size measurement. The resource profile is a relative quality tier; provider compute and energy use are not reported.
- The main interface is currently in English. Image output language can be selected as English, Hindi or Tamil.
- School creation, membership administration, review/approval of school images and price-list maintenance require a trusted admin workflow in Supabase. Only one active price row per provider and quality tier is allowed; mark the previous row inactive before adding an updated price.

## Checks

Run the frontend TypeScript check without generating build files:

```powershell
npm exec -- tsc --noEmit --pretty false -p tsconfig.app.json
```

The project has no configured automated test script. The Supabase migrations and Edge Function must be deployed to a Supabase project to validate hosted authentication, database policies, provider calls, request limits and budget enforcement end to end.
