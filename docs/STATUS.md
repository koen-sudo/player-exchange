# Projectstatus

Laatst bijgewerkt: 5 november 2026, 21:30. **Fase 0, 1 en 2 zijn opgeleverd.** Volgende fase: 3 (voorraad en portefeuille). Niets in deze repository is productiegeschikt.

## Wat de producteigenaar nog moet doen

| # | Actie | Blokkeert |
|---|---|---|
| 1 | Vraag V-01a: mag de dropprijs tussen donderdag en dinsdag alleen **omlaag**, of **beide kanten op**? | Fase 6 |
| 2 | Vraag V-02: wireframe van het marktoverzicht meesturen, als die er is | Niets |
| 3 | Een dataleverancier kiezen en licentie regelen (O-03) | De echte provideradapter in fase 2; tot die tijd draait de import op de fictieve fixtureprovider |
| 4 | Een identiteitsprovider kiezen (O-06) | Echte verificatie; in demo is de verificatiestatus vast |

## Fase 2 — Catalogus en authenticatie: opgeleverd (met één blokkade)

| Oplevering | Status |
|---|---|
| Databasetoegang (Drizzle 0.45.4 + node-postgres 8.23.1) | Klaar |
| Migratie 0002: importvoortgang, snapshots, quarantaine, unieke lidmaatschappen, rechten, voorwaarden, toegelaten landen, zoekindex | Klaar |
| Fixtureprovider met scenario's: transfer tussen competities, vertrek, naamcorrectie, nieuwe jeugdspeler, gedeeltelijke feed, storing, dubbele aanlevering, conflicterende identiteit | Klaar |
| Catalogusimport: mapping naar vaste speler-ID, transfers zonder duplicaten, gedeeltelijke feeds verwijderen niets, conflicten in quarantaine, idempotent, hervatbaar | Klaar |
| Worker verwerkt ingeplande en onderbroken imports (database als wachtrij, ADR 0004) | Klaar |
| Identiteit: inloggen via de database, eerste OIDC-login maakt gebruiker aan, sessie bevat alleen het gebruikers-ID | Klaar |
| Toelating per handeling (BR-07) en productieblokkade (PRD-15) | Klaar, gebruikt door orderpreview en orders-API |
| Rollen en rechten uit de database; beheer per recht afgeschermd | Klaar |
| Beheer: Catalogus en importstatus, Gebruikers en beperkingen, Auditlog | Klaar |
| API: `/competitions`, `/teams`, `/players` (cursorpaginering), `/players/{id}`, `/me` uit PostgreSQL | Klaar |
| **Gekozen provideradapter toevoegen** | **Geblokkeerd door O-03** (geen dataleverancier gekozen) |

### Acceptatie fase 2

| Criterium | Bewijs |
|---|---|
| Alle zes competities werken | Import, catalogus-API en beheer tonen 6 competities met 4 teams en 40 spelers (integratie- en e2e-tests) |
| Imports zijn hervatbaar | Storing halverwege → run `FAILED` met voltooide stappen → hervat met minder providercalls → zelfde eindresultaat; een run met verlopen heartbeat wordt opnieuw opgepakt |
| Transfers veroorzaken geen duplicaten | Transfer van Eredivisie naar Premier League: zelfde speler-ID, zelfde markt, kaarten en eigenaren ongewijzigd, oud lidmaatschap afgesloten (AT-03) |
| Privégegevens blijven privé | Publieke API zonder geboortedata en zonder gebruikersgegevens; `/me` alleen over de ingelogde gebruiker; beheer alleen met het juiste recht |

## Werkelijk uitgevoerde controles

5 november 2026 (Node.js 22.23, PostgreSQL 16.15, Chrome via Playwright 1.64.1).

| Controle | Uitkomst |
|---|---|
| `pnpm test` (Vitest; unit en integratie op echte PostgreSQL) | **122 tests geslaagd** (fase 2: +46) |
| `pnpm test:db` | **45 constraintcontroles geslaagd** |
| `pnpm typecheck` | **6 van 6 workspaces geslaagd** |
| `pnpm build` | **Geslaagd**, 24 routes |
| `pnpm test:e2e` (web + worker tegen geseede database) | **15 tests geslaagd**: 8 uit fase 1, 7 nieuw (catalogus-API en privacy, `/me`, rechten in beheer, import via beheer die de worker afrondt, handelsstop met audit, geen zelfbeperking) |
| Eerste import op verse demodatabase | 240 ongewijzigd, 0 nieuw, 0 bijgewerkt |
| Schermen beheer | Bekeken op 1440 en 390 px |

Belangrijke tests per acceptatiecriterium: AT-01 (zes competities), AT-02 (herimport zonder duplicaten), AT-03 (transfer behoudt ID, kaarten en markt), AT-04 (gedeeltelijke import verwijdert niets), AT-08 (niet-toegelaten gebruiker), AT-29 (concept-waardering niet publiek), AT-33 (beheeracties met actor en reden).

## Eerdere fasen

- **Fase 0** — Dossier, projectfundament, CI. Acceptatie aangetoond met een verse checkout.
- **Fase 1** — Huisstijl en demo-interface; WF-01 en WF-02 werken op 390, 768 en 1440 px.

## Niet uitgevoerd

| Controle | Reden / planning |
|---|---|
| Echte provideradapter en contracttests | O-03; fase 8 voor sandbox |
| Gelijktijdigheidstest met parallelle verbindingen op kaarten (AT-07) | Fase 3/5 |
| Performance bij 10.000 catalogusspelers | Zoekindex staat er; meting in fase 9 |

## Bekende beperkingen van deze demo

- Markt-, speler-, portefeuille- en uitgiftepagina's lezen nog uit de demowereld (R-28). Ze gaan over op PostgreSQL in fase 3 (voorraad) en fase 5 (orderboek).
- Problemen in quarantaine zijn zichtbaar maar kunnen nog niet worden afgehandeld; de beoordelingsflow volgt met fase 3 (spelertoelating).
- Alles is demo: fictieve spelers en clubs, demomodel `demo-v0`, testgeld, lokale testlogin, placeholder-voorwaarden.

## Volgende fase: 3 — Voorraad en portefeuille

Edities, kaartserienummers, eigendomshistorie, voorraadprogramma's en kostenbasis in PostgreSQL. Spelertoelating en afhandeling van quarantaine in beheer. De voorraad- en portefeuilleschermen gaan dan over op de database.
