# Player Exchange

Marktplaats voor digitale voetballerskaarten met echte aankoop- en verkoopprijzen. Gebruikers ontdekken spelers, kopen kaarten bij uitgiftes, volgen hun ontwikkeling en verkopen kaarten aan andere gebruikers. Player Exchange publiceert een eigen referentiewaarde in euro's en ontvangt 5% verkoperscommissie op secundaire verkopen.

> **Status: demo in opbouw (fase 0–1).** Fictieve spelers en testgeld. Geen live service, geen echte betalingen. Productie is geblokkeerd tot alle productiegates zijn vervuld (`docs/10-operations.md`). Zie `docs/STATUS.md` voor wat wel en niet werkt.

## Snel starten (lokale demo)

Vereisten: Node.js 22.18 of nieuwer, pnpm 10, Docker (voor PostgreSQL en Redis) en `psql`.

```bash
cp .env.example .env              # demo-instellingen, geen echte geheimen
docker compose up -d db redis     # lokale database en queue
pnpm install                      # legt exacte versies vast in pnpm-lock.yaml
set -a; source .env; set +a
pnpm db:migrate                   # past packages/db/migrations toe
pnpm db:seed                      # laadt de fictieve demowereld (alleen APP_MODE=demo)
pnpm dev                          # web op http://localhost:3000 + worker
```

Inloggen in de demo gaat via **Inloggen** met een van de fictieve testaccounts:

| Account | Gebruik |
|---|---|
| Anna de Vries | Toegelaten handelaar: 3 spelers · 6 kaarten, €120 beschikbaar, open kooporder |
| Bram Jansen | Geregistreerd, niet geverifieerd: handelen geblokkeerd |
| Sanne (beheer) | Beheerder met catalogus-, uitgifte-, waarderings- en financiële rollen |
| Joris (goedkeurder) | Tweede persoon voor goedkeuringen |

## Tests

| Wat | Commando |
|---|---|
| Domeinregels, demo, server-logica, worker | `pnpm test:domain` |
| Databaseconstraints (vereist PostgreSQL) | `pnpm test:db` |
| Typecheck en build | `pnpm typecheck && pnpm build` |
| End-to-end (Playwright) | `pnpm --filter @px/web test:e2e` |

## Uitvoeringsmodi

| Modus | Gebruik |
|---|---|
| `demo` | Fictieve spelers, testgeld, lokale adapters, demo-login |
| `sandbox` | Testomgevingen van echte leveranciers; geen demo-login |
| `production` | Echte gebruikers en geld; weigert te starten met demo-adapters of demo-login |

De server controleert de configuratie bij het starten (`packages/integrations/src/env-check.ts`).

## Projectstructuur

| Pad | Inhoud |
|---|---|
| `apps/web` | Next.js: klantinterface, beheer en `/api/v1` |
| `apps/worker` | Achtergrondtaken |
| `packages/domain` | Bedrijfsregels (geld, commissie, matching, toewijzing, seizoenen, limieten) |
| `packages/db` | SQL-migraties en constrainttests |
| `packages/demo` | Fictieve demowereld en read models |
| `packages/integrations` | Leveranciersneutrale adaptercontracten en modusbewaking |
| `docs/` | Dossier, besluiten, ADR's, status en wireframes |

## Documentatie

| Bestand | Inhoud |
|---|---|
| `CLAUDE.md` | Permanente projectinstructies |
| `docs/00-dossier.md` | Gebruik van het dossier en startopdracht |
| `docs/01-prd.md` | Productdoel, gebruikers, scope en requirements |
| `docs/02-ux.md` | Huisstijl, schermen en toestanden (+ WF-01/WF-02) |
| `docs/03-business-rules.md` | Voorraad, uitgifte, matching, commissie, levenscyclus |
| `docs/04-architecture.md` | Architectuur en projectstructuur |
| `docs/05-data-model.md` | Entiteiten en databasebeperkingen |
| `docs/06-api.md` | API-contracten en foutafhandeling |
| `docs/07-integrations.md` | Data, betalingen, identiteit, notificaties en jobs |
| `docs/08-valuation.md` | Waarderingsmodule |
| `docs/09-acceptance.md` | Acceptatiecriteria en testgevallen |
| `docs/10-operations.md` | Beveiliging, beheer, monitoring en livegang |
| `docs/11-build-plan.md` | Gefaseerde bouwopdrachten |
| `docs/12-decisions.md` | Besluiten, aannames, open punten en consistentiecontrole |
| `docs/STATUS.md` | Voortgang, uitgevoerde controles en blokkades |
| `docs/adr/` | Architectuurbesluiten |
| `docs/source/` | Origineel bouwdossier V1.0 en addendum V1.1 |
| `docs/wireframes/` | Goedgekeurde wireframes v04 |
