# Seeding

## Billing Catalog

Billing v1 now includes a real idempotent catalog sync command:

- `npm run billing:sync-catalog`

What it does:

- upserts the fixed Billing v1 plan catalog
- upserts the fixed Billing v1 add-on catalog
- marks catalog rows missing from the current manifest as inactive
- is safe to run repeatedly

Source of truth:

- `src/modules/billing/utils/billing-catalog.manifest.js`

Current scope:

- fixed plans only
- fixed add-ons only
- no plan CRUD
- no add-on CRUD

The billing runtime also runs the same sync flow before billing foundation reads so local and test environments stay aligned even before the script is run manually.

Operational notes:

- the catalog manifest also carries Stripe price-id mappings through env-backed `providerMetadata`
- set the `STRIPE_PRICE_*` env values before syncing if Checkout and provider lifecycle sync should resolve plan/add-on prices correctly
- webhook replay and worker runtime are separate operational flows:
  - `npm run billing:worker`
  - `npm run billing:replay-webhooks`
