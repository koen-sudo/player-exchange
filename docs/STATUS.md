# Projectstatus

Laatst bijgewerkt: 5 november 2026, 20:30. **Fase 0 en 1 zijn opgeleverd.** Volgende fase: 2 (catalogus en authenticatie). Niets in deze repository is productiegeschikt.

## Wat de producteigenaar nog moet doen

| # | Actie | Blokkeert |
|---|---|---|
| 1 | GitHub koppelen: claude.ai → Settings → **Connectors** → GitHub, en de Claude GitHub App toegang geven tot `koen-sudo/player-exchange` (github.com → Settings → Applications) | Pushen naar de repo en CI |
| 2 | Vraag V-01 beantwoorden: mag de dropprijs tussen donderdag 18.00 en dinsdag 09.00 nog wijzigen? Zo ja, alleen omlaag of beide kanten op? | Fase 6 (uitgiftes) |
| 3 | Vraag V-02: wireframe van het marktoverzicht meesturen, als die er is | Niets; de markt is gebouwd volgens UX-01 |

npm-toegang is in orde.

## Fase 0 — Dossier en projectfundament: opgeleverd

| Oplevering | Status |
|---|---|
| Documentstructuur, `CLAUDE.md`, beslisregister, consistentiecontrole | Klaar (`docs/12-decisions.md`: C-01 t/m C-09, R-01 t/m R-18, V-01 en V-02) |
| ADR en dependencyversies | ADR 0001 met vastgelegde versies, ADR 0002 (SQL-migraties), ADR 0003 (afgesloten) |
| Monorepo (pnpm workspaces + Turborepo, één lockfile) | Klaar |
| Database, migraties, constraints | Klaar en getest |
| Worker | Skelet met configuratiebewaking, jobregister en nette shutdown; jobinhoud volgt per fase |
| Omgevingsvalidatie en healthcheck | Klaar en getest (`/api/v1/health`) |
| CI | `.github/workflows/ci.yml`; draait zodra de repo gekoppeld is |
| **Acceptatie:** nieuwe checkout start met de README zonder verborgen stappen | **Aangetoond.** Verse kloon → `pnpm install --frozen-lockfile` → migratie → seed → tests → typecheck → build: alles geslaagd. Daarbij gevonden en opgelost: Turborepo gaf de omgevingsvariabelen niet door aan de build, en de worker startte niet vanaf een pad met een symlink. |

## Fase 1 — Huisstijl en demo-interface: opgeleverd

| Oplevering | Status |
|---|---|
| Schermen: Overzicht, Markt (met handelspaneel), Spelersdetail, Portefeuille, Uitgiftes + inschrijfflow, Orders en transacties, Betalingen, Account, Beheer, Inloggen | Gebouwd en bekeken |
| Schermtoestanden: laden, leeg, fout, onvoldoende rechten, inloggen vereist, verouderde/ontbrekende data | Gebouwd |
| WF-01 "3 spelers · 6 kaarten" | Werkt op 390, 768 en 1440 px (AT-36, Playwright) |
| WF-02 "Controleer kooporder" → controlevenster → "Kooporder plaatsen" | Werkt (Playwright) |
| Wireframe-afwijkingen C-01 t/m C-07 | Verwerkt |
| Demo-acties | Elke knop heeft een demoactie of een zichtbare reden. Plaatsen, annuleren, storten, opnemen en inschrijven zeggen expliciet dat er niets is uitgevoerd. |
| Responsiveness | Bekeken op 390, 768 en 1440 px. Na bekijken verbeterd: zijbalk over volle hoogte, markttabel past naast het handelspaneel, mobiele spelerspagina met Kopen/Verkopen bovenaan, controlevenster zonder overloop op mobiel. |

## Werkelijk uitgevoerde controles

Uitgevoerd op 5 november 2026 (Node.js 22.23, PostgreSQL 16.15, Chrome via Playwright 1.64.1).

| Controle | Uitkomst |
|---|---|
| `pnpm test` (Vitest) | **76 tests geslaagd** |
| `pnpm test:db` op verse database | **45 constraintcontroles geslaagd**, elk met gecontroleerde weigeringsreden |
| `pnpm typecheck` | **5 van 5 workspaces geslaagd** |
| `pnpm build` (Next.js 16.4.5) | **Geslaagd**, 16 routes |
| `pnpm test:e2e` (Playwright, Chrome) | **8 tests geslaagd**: competitiefilter (AT-01), filters behouden na terugnavigeren, geen verzonnen prijs bij profielen (AT-05), WF-02, WF-01 op drie breedtes (AT-36), niet-toegelaten gebruiker via directe API geweigerd (AT-08) |
| Verse checkout volgens README | Geslaagd (zie fase 0) |
| Migratie tweemaal | Tweede keer overgeslagen |
| Demo-seed | 240 spelers, 120 open markten, 5.960 kaarten, 228 gepubliceerde referenties |
| Demo-seed met `APP_MODE=production` | Geweigerd |
| Screenshots | 26 schermen op 390, 768 en 1440 px bekeken en vergeleken met de wireframes |

## Niet uitgevoerd

| Controle | Reden / planning |
|---|---|
| CI op GitHub | Repo nog niet gekoppeld |
| Gelijktijdigheidstest met parallelle databaseverbindingen (AT-07 onder echte concurrency) | Hoort bij fase 3/5; de databaseconstraints zelf zijn getest |
| Performance-richtwaarden (hoofdstuk 09) | Fase 9 |

## Alleen demo

Alles is demo: fictieve spelers en clubs, demomodel `demo-v0` voor referentiewaardes, testgeld, lokale testlogin, geen betaalpartner, identiteitsprovider of datalicentie. Open afhankelijkheden O-01 t/m O-10 staan in `docs/12-decisions.md`.

## Volgende fase: 2 — Catalogus en authenticatie

Identity en autorisatie op de database, catalogusimport met fixtureprovider, mappings, teams en selecties, hervatbare imports, transfers zonder duplicaten. De read models schakelen dan van de demowereld naar PostgreSQL; de schermen blijven gelijk.
