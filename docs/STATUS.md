# Projectstatus

Laatst bijgewerkt: 5 november 2026. Huidige fase: **0 en 1 (gedeeltelijk)**. Niets in deze repository is productiegeschikt.

## Wat de producteigenaar nog moet doen

| # | Actie | Waarom | Waar |
|---|---|---|---|
| 1 | GitHub-account aan Claude koppelen en toegang geven tot `koen-sudo/player-exchange` | Daarna wordt de lokale git-geschiedenis naar de repo gepusht | claude.ai → Settings → Connectors → GitHub |
| 2 | npm-registry toestaan voor Claude-sessies (package managers, of `registry.npmjs.org`) | Zonder pakketten kunnen Next.js, Tailwind, Auth.js, Vitest en Playwright niet worden geïnstalleerd, gebouwd of getest | claude.ai in de browser → Settings → Capabilities (Team/Enterprise: beheerder via Organization settings → Capabilities) |
| 3 | Vraag V-01 beantwoorden: mag de dropprijs tussen donderdag en dinsdag nog wijzigen? | Bepaalt de uitgifte-implementatie in fase 6 | `docs/12-decisions.md` |
| 4 | Vraag V-02: wireframe van het marktoverzicht meesturen, als die er is | Het marktscherm is nu gebouwd volgens UX-01 zonder afbeelding | `docs/12-decisions.md` |

Punt 1 en 2 blokkeren de rest van fase 1. Punt 3 en 4 blokkeren niets nu.

## Fase 0 — Dossier en projectfundament

| Oplevering | Status |
|---|---|
| Documentstructuur (`README`, `CLAUDE.md`, `docs/00–12`, `STATUS`) | Klaar. Addendum V1.1 verwerkt in de betreffende hoofdstukken. |
| Consistentiecontrole | Klaar. 9 bevindingen (C-01 t/m C-09) en 2 vragen in `docs/12-decisions.md`. Geen tegenstrijdigheden in geld-, eigendoms- of afwikkelregels. |
| Beslisregister | Klaar. A-13, O-10 en 15 routinekeuzes (R-01 t/m R-15) toegevoegd. |
| ADR en dependencyversies | ADR 0001–0003 geschreven. **Exacte versies nog niet vastgelegd**: geen registry-toegang. |
| Monorepo (pnpm workspaces + Turborepo) | Configuratie geschreven. **Nog niet geïnstalleerd.** |
| Databaseverbinding en migratiestructuur | Klaar en getest: `packages/db/migrations/0001_core.sql`, `scripts/migrate.sh` (idempotent). |
| Worker | Skelet met configuratiebewaking, jobregister en nette shutdown; getest. Jobinhoud volgt per fase. |
| Testconfiguratie | Tijdelijk `node:test` (ADR 0003); Vitest en Playwright geconfigureerd maar niet geïnstalleerd. |
| Healthcheck | `/api/v1/health` geschreven, niet gedraaid. |
| Omgevingsvalidatie | Klaar en getest (`env-check.ts`). |
| CI | `.github/workflows/ci.yml` geschreven, nog niet gedraaid. |

Acceptatie fase 0 ("nieuwe checkout start met de README zonder verborgen stappen"): **nog niet aangetoond**, omdat `pnpm install` hier niet kon draaien.

## Fase 1 — Huisstijl en demo-interface

| Oplevering | Status |
|---|---|
| Demowereld volgens hoofdstuk 09 (6 × 4 × 10 = 240 spelers, 120 open markten, alle bijzondere gevallen, wireframecijfers) | Klaar en getest. Laadt ook foutloos in het echte databaseschema. |
| Read models (markt, speler, portefeuille, orders, uitgiftes) | Klaar en getest. |
| Server-side orderpreview (UX-06/07, WF-02) | Klaar en getest. |
| Schermen: Overzicht, Markt, Spelersdetail, Portefeuille, Uitgiftes + inschrijfflow, Orders en transacties, Betalingen, Account, Beheer, Inloggen, laad-/fout-/leegtoestanden | **Geschreven, nog niet gebouwd of bekeken.** |
| WF-01 ("3 spelers · 6 kaarten") | Logica getest; scherm geschreven. |
| WF-02 ("Controleer kooporder" → controlevenster → "Kooporder plaatsen") | Logica getest; scherm geschreven. |
| Wireframe-afwijkingen C-01 t/m C-07 | Verwerkt in de schermen. |
| Demo-acties | Elke knop heeft een demoactie of een zichtbare reden waarom hij nog niet werkt. Plaatsen, annuleren, storten, opnemen en inschrijven zeggen expliciet dat er niets is uitgevoerd. |
| Controle op 390, 768 en 1440 px | **Niet uitgevoerd.** Playwright-specs geschreven. |

## Werkelijk uitgevoerde controles

Uitgevoerd op 5 november 2026 in de bouwomgeving (Node.js 22.23, PostgreSQL 16.15).

| Controle | Uitkomst |
|---|---|
| `pnpm test:domain` (via `node --test`) | **76 tests geslaagd, 0 mislukt** |
| `scripts/test-db.sh` op een verse database | **45 constraintcontroles geslaagd**, elk met de verwachte weigeringsreden gecontroleerd |
| Migratie op verse database, tweede keer draaien | Eerste keer toegepast, tweede keer overgeslagen |
| Demo-seed in echte database | 240 spelers, 120 open markten, 5.960 kaarten, 228 gepubliceerde referenties, 6 kaarten bij Anna |
| Demo-seed met `APP_MODE=production` | Geweigerd (exit 1) |

Gedekt door deze tests, onder andere: geldvoorbeeld en commissievoorbeeld uit hoofdstuk 09, commissie onafhankelijk van opsplitsing, seizoensgrenzen inclusief exact overgangsmoment (AT-38), alleen 1/7/30 dagen (AT-37), cap 500 (AT-06), dubbele kaart in twee verkooporders (AT-13), tweede open uitvoering voor dezelfde kaart (AT-07), één settlement per markt (A-10), zelfhandel (AT-17), dubbele webhook (AT-10), dubbel financieel verwerken, sluitende en onveranderlijke journaalposten, overboeking van beschikbaar saldo (AT-12), opname tegen hetzelfde saldo (AT-31), goedkeuring gebonden aan payload (AT-34), geen zelfgoedkeuring, auditverplichtingen (AT-33), conceptwaardering niet publiek (AT-29), herhaalde toewijzing met dezelfde winnaars (AT-24), wachtlijst bij onzekere betaling (AT-26/27), modusbewaking (AT-35), positielimiet, prijsgrenzen en orderaantallen.

## Niet uitgevoerd (en waarom)

| Controle | Reden |
|---|---|
| `pnpm install`, `tsc`, `next build` | Geen toegang tot de npm-registry |
| Schermen bekijken, Playwright, breedtes 390/768/1440 | Idem |
| Omzetten tests naar Vitest | Idem (ADR 0003) |
| Gelijktijdigheidstest met parallelle databaseverbindingen | Vraagt een PostgreSQL-driver; gepland in fase 3/5 |
| Push naar GitHub | GitHub niet gekoppeld |

## Eerste stappen zodra toegang er is

1. `pnpm install`, exacte versies vastleggen in `pnpm-lock.yaml` en ADR 0001.
2. `pnpm typecheck` en `pnpm build`; fouten in de nog niet gecompileerde schermcode oplossen.
3. Demo starten, alle schermen bekijken op 390, 768 en 1440 px en vergelijken met de wireframes.
4. Playwright-specs draaien (`apps/web/e2e`).
5. Tests omzetten naar Vitest.
6. Alles pushen naar `koen-sudo/player-exchange` en CI laten draaien.
7. Fase 1 afronden in dit bestand; daarna fase 2 (catalogus en authenticatie).

## Alleen demo

Alles in deze build is demo: fictieve spelers en clubs, een demomodel voor referentiewaardes (`demo-v0`), testgeld, een lokale testlogin en geen betaalpartner, identiteitsprovider of datalicentie. Zie de open afhankelijkheden O-01 t/m O-10.
