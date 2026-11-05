# Projectstatus

Laatst bijgewerkt: 5 november 2026, 22:00. **Fase 0 tot en met 3 zijn opgeleverd.** Volgende fase: 4 (grootboek en betalingsdemo). Niets in deze repository is productiegeschikt.

## Wat de producteigenaar nog moet doen

| # | Actie | Blokkeert |
|---|---|---|
| 1 | Vraag V-01a: mag de dropprijs tussen donderdag en dinsdag alleen **omlaag**, of **beide kanten op**? | Fase 6 |
| 2 | Vraag V-02: wireframe van het marktoverzicht meesturen, als die er is | Niets |
| 3 | Een dataleverancier kiezen en licentie regelen (O-03) | De echte provideradapter |
| 4 | Een identiteitsprovider kiezen (O-06) | Echte verificatie |
| 5 | Een betaalpartner kiezen (O-02) | Fase 8 (sandbox); fase 4 werkt met een simulator |

## Fase 3 — Voorraad en portefeuille: opgeleverd

| Oplevering | Status |
|---|---|
| Edities per speler per seizoen, uitgifteprogramma's met versies | Klaar |
| Publiceren van een programma via vier-ogengoedkeuring (aanvragen, beslissen door een ander, eenmalig uitvoeren, vervalt bij wijziging) | Klaar |
| Kaarten aanmaken binnen programma en cap van 500, met lock op de editie | Klaar (gebruikt in fase 6) |
| Reserveren en vrijgeven van kaarten voor verkoop | Klaar (gebruikt in fase 5) |
| Eigendomsoverdracht met event en kostenbasis; database weigert eigenaarswissel zonder event | Klaar |
| Invariantcontrole (eigendom, programma, cap, reserveringen) | Klaar |
| Spelertoelating en marktstatus met redenen en audit | Klaar |
| Quarantaine afhandelen (koppelen, nieuw profiel, negeren) | Klaar |
| Beheer: Spelers, Voorraad, Goedkeuringen; quarantaine op Catalogus | Klaar |
| Portefeuille, voorraadblok, marktstatus en eigen orders uit PostgreSQL | Klaar |

### Acceptatie fase 3

| Criterium | Bewijs |
|---|---|
| Cap, reservering en bezit worden door database én domeinlaag bewaakt | Databaseconstraints (50 controles) plus servicechecks; gelijktijdigheidstests op echte PostgreSQL: 15 parallelle aanmaakpogingen leveren precies kaartnummers 1–50, twee gelijktijdige reserveringen van dezelfde kaart leveren precies één winnaar (AT-06, AT-07, AT-13) |
| Portefeuille volgt het werkelijke kaartbezit | Portefeuille leest Anna's 6 specifieke kaarten, kostenbasis €30,60 en de gereserveerde kaart uit de database (integratie- en e2e-test) |

## Werkelijk uitgevoerde controles

5 november 2026 (Node.js 22.23, PostgreSQL 16.15, Chrome via Playwright 1.64.1).

| Controle | Uitkomst |
|---|---|
| `pnpm test` (Vitest; unit en integratie op echte PostgreSQL) | **143 tests geslaagd** (fase 3: +21) |
| `pnpm test:db` | **50 constraintcontroles geslaagd** (fase 3: +5) |
| `pnpm typecheck` en `pnpm build` | **Geslaagd** (6 workspaces, 27 routes) |
| `pnpm test:e2e` op verse database (web + worker) | **18 tests geslaagd** (fase 3: +3: portefeuille uit database, vier-ogenpublicatie met audit, toelating geweigerd voor minderjarige en marktpauze sluit handel) |
| Schermen beheer fase 3 | Bekeken op 1440 px |

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

## Eerdere fasen

- **Fase 2** — zie hierboven.
- **Fase 0** — Dossier, projectfundament, CI. Acceptatie aangetoond met een verse checkout.
- **Fase 1** — Huisstijl en demo-interface; WF-01 en WF-02 werken op 390, 768 en 1440 px.

## Niet uitgevoerd

| Controle | Reden / planning |
|---|---|
| Echte provideradapter en contracttests | O-03; fase 8 voor sandbox |
| Gelijktijdigheid bij matching en afwikkeling (twee kopers voor de laatste kaart via orders) | Fase 5; kaartaanmaak en reservering zijn in fase 3 al parallel getest |
| Performance bij 10.000 catalogusspelers | Zoekindex staat er; meting in fase 9 |

## Bekende beperkingen van deze demo

- Orderboek, laatste transactie, saldo, transacties en uitgiftes komen nog uit de demowereld (R-36); ze gaan over in fase 4 (saldo), 5 (orderboek en transacties) en 6 (uitgiftes).
- Anna's kooporder staat in de database maar heeft nog geen geldreservering in het grootboek; die volgt in fase 4.
- Alles is demo: fictieve spelers en clubs, demomodel `demo-v0`, testgeld, lokale testlogin, placeholder-voorwaarden.

## Volgende fase: 4 — Grootboek en betalingsdemo

Dubbel boekhouden voor klantgeld (beschikbaar, gereserveerd, in afwikkeling), reserveringen, stortingen en opnames, inbox/outbox en een deterministische betaalsimulator die succes, vertraging, dubbele berichten, fouten en onbekende uitkomsten kan nabootsen. Het saldo op de schermen gaat dan over op de database.
