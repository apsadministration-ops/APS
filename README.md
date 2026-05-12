# APS — Automotive Platform System

A VIN-centric automotive service marketplace connecting customers with mechanics for repairs, diagnostics, maintenance, and detailing — preserving service history across ownership changes.

This is a pnpm monorepo containing an Express API server, an Expo (React Native) mobile app, an in-browser demo video, and a UI mockup sandbox, with shared TypeScript libraries for the OpenAPI contract, database schema, tier catalog, and integrations.

---

## Stack

- **Monorepo:** pnpm workspaces, TypeScript 5.9, Node.js 24
- **API:** Express 5, esbuild
- **Database:** PostgreSQL + Drizzle ORM
- **Validation:** Zod, `drizzle-zod`
- **API codegen:** Orval from OpenAPI spec
- **Mobile:** Expo SDK 54 (`expo-router`), React Native, React Query
- **Auth:** bcryptjs + jsonwebtoken (7-day token TTL)
- **Payments:** Stripe Checkout (manual capture) + Connect Express

---

## Repository layout

```
artifacts/
  api-server/          Express API (entry: src/index.ts)
  mobile/              Expo app (entry: app/_layout.tsx)
  demo-video/          In-browser product demo (Vite)
  mockup-sandbox/      UI prototyping playground
lib/
  api-spec/            OpenAPI source of truth + generated client/Zod
  db/                  Drizzle schema + migration helpers
  tier-catalog/        Mechanic tiers, services, commission math
  integrations-*/      Replit AI Integrations clients
scripts/               One-off migration / seed scripts
replit.md              Detailed architecture notes (per-file map)
```

Each `artifacts/*` directory is a self-contained deployable. They never import from each other — shared code lives in `lib/`.

---

## Getting started

### Prerequisites

- Node.js 24 (`nvm install 24 && nvm use 24`)
- pnpm 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- PostgreSQL 14+ (local install, Docker, or a hosted provider like Neon)
- Expo Go on a physical device, or Xcode / Android Studio for the mobile app

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# edit .env and set DATABASE_URL + SESSION_SECRET
```

`SESSION_SECRET` must be at least 32 characters in production — the API server throws on startup otherwise.

### 3. Initialize the database

```bash
pnpm --filter @workspace/db run push
```

This applies the Drizzle schema to the database referenced by `DATABASE_URL`.

### 4. Run the services

```bash
# API server (Express, default port 8080)
pnpm --filter @workspace/api-server run dev

# Mobile app (Expo dev server)
pnpm --filter @workspace/mobile run dev
```

Open the Expo URL printed in the terminal on a device running Expo Go, or press `i` / `a` for a simulator.

---

## Common commands

| Command | Purpose |
| --- | --- |
| `pnpm run typecheck` | Full repo typecheck (libs + leaf packages) |
| `pnpm run typecheck:libs` | Composite-build typecheck for `lib/*` |
| `pnpm run build` | Typecheck + build all packages |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate API hooks + Zod schemas from OpenAPI |
| `pnpm --filter @workspace/db run push` | Push Drizzle schema changes (dev only) |
| `pnpm --filter @workspace/<name> run typecheck` | Typecheck a single package |

Don't run `pnpm dev` at the workspace root — there is no root `dev` script. Each artifact has its own dev command.

---

## Architecture highlights

For the full architecture decisions, per-file map, and feature notes, see [`replit.md`](./replit.md). High-level points:

- **VIN permanence.** Service history (`work_logs`) is immutable and survives ownership transfer.
- **Tier-aware job dispatch.** 5-tier mechanic ladder (`detailer → master`) with strict at-or-below visibility on `/jobs/available`. Tier checks are re-validated server-side at accept time.
- **True Net Profit commission model.** APS commission applies only to `(labor revenue − optional Stripe fee)`, never to parts cost or sales tax. Mechanic gets 100% of the parts and tax pass-through plus their tier share of net profit. Customer invoices intentionally never expose commission, fees, or payout numbers.
- **24h escrow + customer work-confirmation.** Stripe authorizes with `capture_method="manual"`; capture fires on customer confirmation, immediate dispute, or 24h auto-confirm.
- **Bidirectional reviews.** Every review is hidden until the counterpart submits or 72h passes — eliminates retaliation. Edits freeze the moment a review becomes visible.
- **VIN-Integrated Parts Matching.** Auto-decode on job accept, confidence-scored recommendations from a curated catalog, pluggable supplier adapters, server-side order validation, and a customer-safe airgap on the invoice.

---

## Production deployment

This repo was developed on Replit; `artifacts/*/.replit-artifact/artifact.toml` files describe each service's dev/prod commands, ports, and health checks. They're useful as documentation for any deployment target — for example, the API server's prod entry is `node --enable-source-maps artifacts/api-server/dist/index.mjs` after `pnpm --filter @workspace/api-server run build`.

To deploy elsewhere (Fly.io, Render, Railway, your own VM):

1. Build: `pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build`.
2. Start: `node --enable-source-maps artifacts/api-server/dist/index.mjs`.
3. Provide `DATABASE_URL`, `SESSION_SECRET`, and any optional integration keys at runtime.
4. For the mobile app, run `eas build` (see `artifacts/mobile/STORE_RELEASE.md`).

---

## Security

- Never commit `.env` — it's in `.gitignore`.
- `SESSION_SECRET` and `DATABASE_URL` are required at runtime; the server fails fast if either is missing.
- Replit-provided secrets (Stripe, Resend, Twilio) are injected through the Replit secrets manager. When self-hosting, supply them via your platform's secret store.
- All per-resource API endpoints enforce IDOR guards (see `replit.md` → "Auth & access control").

---

## License

Proprietary — all rights reserved. Update this section before making the repo public.
