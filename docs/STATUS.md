# Projectstatus

Laatst bijgewerkt: 6 november 2026, 02:15. **Fase 0 tot en met 7 zijn opgeleverd.** Volgende fase: 8 (sandbox-integraties en operationele procedures). Niets in deze repository is productiegeschikt.

## Wat de producteigenaar nog moet doen

| # | Actie | Blokkeert |
|---|---|---|
| 1 | Vraag V-02: wireframe van het marktoverzicht meesturen, als die er is | Niets |
| 2 | Een dataleverancier kiezen en licentie regelen (O-03) | De echte provideradapter |
| 3 | Een identiteitsprovider kiezen (O-06) | Echte verificatie |
| 4 | Een betaalpartner kiezen (O-02) | Fase 8 (sandbox); fase 4 werkt met een simulator |

## Fase 7 — Waardering: opgeleverd

| Oplevering | Status |
|---|---|
| Gemarkeerd demomodel `demo-v1` (R-57), reproduceerbaar, zonder toekomstige gegevens, rolprofielen, ontbrekend ≠ nul | Klaar |
| Conceptrun met invoer per speler bewaard, automatische controles (prijsgrenzen, grote wijzigingen) | Klaar |
| Beoordeling door een tweede persoon; goedkeuren of afwijzen; waardes bevroren na concept | Klaar |
| Publicatie van de hele run tegelijk op maandag 18.00 (demo: direct); demomodel in productie geweigerd | Klaar |
| Worker: wekelijkse conceptrun en publicatie van goedgekeurde runs | Klaar |
| Spelerpagina: vorige waarde, uitleg, betrouwbaarheid en recente wedstrijden uit de database | Klaar |
| Beheer Waardering: run-overzicht, grootste wijzigingen met waarschuwingen, beoordelen, publiceren | Klaar |

### Acceptatie fase 7

| Criterium | Bewijs |
|---|---|
| Alleen goedgekeurde output wordt gepubliceerd | Concept en goedgekeurde run zijn niet publiek (integratie- en e2e-test, publieke API, AT-29); afgewezen run kan niet worden gepubliceerd, ook niet direct in de database |
| Open orders blijven ongewijzigd (AT-28) | Integratietest: alle orders identiek voor en na publicatie; e2e: Anna's limiet blijft €3,55 |
| Ontbrekende gegevens worden expliciet weergegeven | Speler zonder externe waarde krijgt geen nieuwe waarde en houdt de vorige met oude datum; waarschuwingen per speler in beheer; gegevenskwaliteit op de spelerpagina |

## Werkelijk uitgevoerde controles

5 november 2026 (Node.js 22.23, PostgreSQL 16.15, Chrome via Playwright 1.64.1).

| Controle | Uitkomst |
|---|---|
| `pnpm test` (Vitest; unit en integratie op echte PostgreSQL) | **202 tests geslaagd** (fase 7: +14 waarderingsmodel en -runs) |
| `pnpm test:db` | **Alle constraintcontroles geslaagd** (fase 4: +9: holds, opnames, stortingen, dubbele webhook, dubbel verschil, verschil sluiten door één persoon) |
| `pnpm typecheck` en `pnpm build` | **Geslaagd** (6 workspaces) |
| `pnpm test:e2e` op verse database (web + worker) | **32 tests geslaagd** (fase 7: +1: run berekenen, beoordelen door een tweede persoon, publiceren; publieke waarde wijzigt pas na publicatie, orders niet) |
| Schermen fase 4–7 | Betalingen, Transacties, Uitgiftes, Meldingen, spelerpagina en beheer (Betalingen, Handel, Uitgiftes, Waardering) bekeken op 390, 768 en 1440 px; demo-betaalpagina op 390 px |

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

- **Fase 6** — Primaire uitgifte: vier-ogenpublicatie, prijswijziging tot opening, inschrijven met reservering, controleerbare trekking, wachtlijst, levering, meldingen.
- **Fase 5** — Orders en matching: preview, plaatsen onder locks, prijs-tijdprioriteit, afwikkeling met herstel, annuleren en verlopen.
- **Fase 4** — Grootboek en betalingsdemo: dubbel boekhouden, geldreserveringen, stortingen en opnames via de betaalsimulator, webhook-inbox, reconciliatie (zie ADR 0005).
- **Fase 3** — Voorraad en portefeuille (acceptatie: cap, reservering en bezit door database én domein bewaakt; portefeuille volgt het werkelijke kaartbezit): edities, programma's met vier-ogengoedkeuring, kaartaanmaak binnen de cap, reserveren, eigendomsoverdracht met event, spelertoelating en marktstatus.
- **Fase 2** — zie hierboven.
- **Fase 0** — Dossier, projectfundament, CI. Acceptatie aangetoond met een verse checkout.
- **Fase 1** — Huisstijl en demo-interface; WF-01 en WF-02 werken op 390, 768 en 1440 px.

## Niet uitgevoerd

| Controle | Reden / planning |
|---|---|
| Echte provideradapter en contracttests | O-03; fase 8 voor sandbox |
| Een echte betaalpartner (sandbox), contracttests en capability-rapport | O-02; fase 8 |
| Correctieboekingen bij een reconciliatieverschil (nu: verklaren en sluiten met twee personen) | Fase 8 (operationele procedures) |
| Performance bij 10.000 catalogusspelers | Zoekindex staat er; meting in fase 9 |

## Bekende beperkingen van deze demo

- Alle schermgegevens komen uit de database, behalve de "laatste verkoop" van spelers zonder echte transactie (R-46).
- Referentiewaardes komen uit een demomodel met demo-wedstrijden en demo-transferwaardes; er is nog geen dataleverancier (O-03) en geen gevalideerd model.
- Eerdere uitgiftes in de demo (vóór vandaag) zijn demohistorie zonder vastgelegde trekking.
- Meldingen staan alleen in de app; e-mail en push volgen met een notificatieprovider.
- Zolang een speler nog geen echte transactie heeft, is de "laatste verkoop" een demokoers (R-46).
- De tegenpartij in de demo is een fictieve verzamelaar met echte reserveringen; er is geen marktmaker of platformhandel (BR-23).
- De betaalpartner is een simulator in dezelfde database (schema `psp_sim`). Er gaat geen echt geld om en er wordt nergens om betaalgegevens gevraagd.
- Alles is demo: fictieve spelers en clubs, demomodel `demo-v0`, testgeld, lokale testlogin, placeholder-voorwaarden.

## Volgende fase: 8 — Integraties en operatie

Wat zonder externe keuzes kan: contracttests die elke echte adapter moet doorstaan (betalen, data, identiteit, notificaties), het capability-rapport per adapter in beheer, correctieboekingen met vier ogen, runbooks en monitoring/health-signalen. De echte sandbox-koppelingen wachten op O-02 (betaalpartner), O-03 (dataleverancier) en O-06 (identiteitsprovider).
