# ADR 0001 — Technische stack

Status: aanvaard (5 november 2026). Versies: nog vast te leggen.

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

De dossierregel "actuele stabiele compatibiliteit controleren en exacte versies vastleggen" kon op 5 november 2026 niet worden uitgevoerd: deze bouwsessie had geen toegang tot de npm-registry. De versies in `package.json` zijn daarom bereiken. De eerste `pnpm install` met registry-toegang legt de exacte versies vast in `pnpm-lock.yaml`; daarna wordt deze ADR bijgewerkt met de vastgelegde versies.

## Gevolgen

- Domeinlogica is los van Next.js testbaar en draait ook zonder pakketten (ADR 0003).
- Eén codebase deelt use cases tussen web en worker; geen tweede backend.
