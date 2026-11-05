# ADR 0001 — Technische stack

Status: aanvaard (5 november 2026). Versies vastgelegd op 5 november 2026.

## Besluit

Eén repository, pnpm workspaces met Turborepo (A-13).

| Laag | Keuze |
|---|---|
| Taal | TypeScript, `strict` |
| Webapp | Next.js App Router (`apps/web`): klant, beheer en `/api/v1` |
| UI | React, Tailwind CSS, toegankelijke componenten (`packages/ui`) |
| Database | PostgreSQL 16 |
| Databasecode | Handgeschreven SQL-migraties + Drizzle ORM voor queries (ADR 0002) |
| Validatie | Zod (`packages/contracts`) |
| Achtergrondtaken | Workerproces (`apps/worker`) met BullMQ op Redis; Redis is nooit bron voor geld, bezit of definitieve orderstatus |
| Authenticatie | Auth.js met externe OIDC in sandbox/productie; lokale demologin alleen in `demo` |
| Tests | Vitest, PostgreSQL-integratietests, Playwright |
| Runtime | Node.js 22 LTS |

## Versies

Gecontroleerd tegen de npm-registry op 5 november 2026 en vastgelegd in `pnpm-lock.yaml`.

| Pakket | Versie | Opmerking |
|---|---|---|
| Node.js | 22 LTS (≥ 22.18) | Voert de domeinlaag zonder buildstap uit |
| pnpm | 10.28 | Eén lockfile |
| Turborepo | 2.11.10 | |
| TypeScript | 5.9.3 | Bewust niet 7.0.2: de nieuwe native compiler is net uit en Next.js-tooling gebruikt nog de JavaScript-API van TypeScript. Herzien bij een volgende fase. |
| Next.js | 16.4.5 | App Router, Turbopack |
| React / React DOM | 19.3.1 | |
| Auth.js (`next-auth`) | 5.0.0-beta.32 | Auth.js v5 is nog als bèta gepubliceerd; de stabiele lijn (4.x) ondersteunt de App Router-API niet. Exact vastgepind; herzien vóór productie (gate Security). |
| Tailwind CSS | 4.3.4 | |
| Zod | 4.6.7 | |
| Vitest | 5.1.0 | |
| Playwright | 1.64.1 | 1.65.0 was gepubliceerd zonder bijbehorend `playwright-core`; daarom de laatste complete release |
| PostgreSQL | 16 | |

## Gevolgen

- Domeinlogica is los van Next.js testbaar en draait ook zonder pakketten (ADR 0003).
- Eén codebase deelt use cases tussen web en worker; geen tweede backend.
