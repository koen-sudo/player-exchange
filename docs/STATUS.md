# Projectstatus

Laatst bijgewerkt: 5 november 2026, 23:15. **Fase 0 tot en met 4 zijn opgeleverd.** Volgende fase: 5 (orders en matching). Niets in deze repository is productiegeschikt.

## Wat de producteigenaar nog moet doen

| # | Actie | Blokkeert |
|---|---|---|
| 1 | Vraag V-01a: mag de dropprijs tussen donderdag en dinsdag alleen **omlaag**, of **beide kanten op**? | Fase 6 |
| 2 | Vraag V-02: wireframe van het marktoverzicht meesturen, als die er is | Niets |
| 3 | Een dataleverancier kiezen en licentie regelen (O-03) | De echte provideradapter |
| 4 | Een identiteitsprovider kiezen (O-06) | Echte verificatie |
| 5 | Een betaalpartner kiezen (O-02) | Fase 8 (sandbox); fase 4 werkt met een simulator |
| 6 | Stortings- en opnamelimieten bevestigen (A-14: €5–€2.500 per storting, €1–€5.000 per opname) | Niets; nu een configureerbare aanname |

## Fase 4 — Grootboek en betalingsdemo: opgeleverd

| Oplevering | Status |
|---|---|
| Dubbel boekhouden: idempotente boekingen, database weigert ongebalanceerde boekingen, wijzigingen en negatieve klantsaldi | Klaar |
| Geldreserveringen (holds) met verbruik en vrijgave, in één transactie met de boeking | Klaar (gebruikt door orders in fase 5 en inschrijvingen in fase 6) |
| Betaalsimulator achter dezelfde interface als een echte partner: succes, vertraging, dubbele berichten, fout, onbekende uitkomst, geen webhook, verlopen betaalpagina | Klaar |
| Webhook-inbox met handtekeningcontrole; statusopvraag na elke melding (fetch-on-notify) | Klaar |
| Stortingen via een demo-betaalpagina; saldo pas na bevestiging van de betaalpartner | Klaar |
| Opnames; een onbekende uitkomst blijft pending en wordt met dezelfde key opnieuw ingediend | Klaar |
| Worker: webhooks afleveren (demo), open operaties opvragen, reconciliatie elke 10 minuten | Klaar |
| Reconciliatie per operatie, totalen en projectie; verschillen blokkeren opnames en sluiten met twee personen | Klaar |
| Schermen: Betalingen (saldi uit het grootboek, storten, opnemen, geschiedenis), beheer Betalingen en reconciliatie | Klaar |
| API: `POST /deposits`, `POST /withdrawals` (met Idempotency-Key), webhook-endpoint | Klaar |
| Productie weigert de simulator en het demo-webhookgeheim | Klaar |

### Acceptatie fase 4

| Criterium | Bewijs |
|---|---|
| Het exacte geldvoorbeeld slaagt | €100 storten → €12,40 reserveren → 1 kaart à €6,00 → rest annuleren: koper €94,00, verkoper €5,70, commissie €0,30 (integratietest op het grootboek) |
| Financiële invarianten | Ongebalanceerde boekingen, saldo ≠ journaal, negatieve klantsaldi en reserveringen ≠ holds zijn alle 0 na alle scenario's (integratietest; ook zichtbaar in beheer) |
| AT-10 dubbele stortingswebhook boekt één storting | Integratietest (drie leveringen, twee event-ID's → één boeking) en e2e via de worker |
| AT-11 redirect zonder bevestiging boekt niets | Integratietest en e2e (terug van de betaalpagina zonder te betalen) |
| AT-12 / AT-31 nooit meer dan beschikbaar; opname en kooporder niet hetzelfde geld | Integratietests, waaronder twee gelijktijdige opnames: precies één slaagt |
| AT-21 / AT-22 (voor opnames) timeout is geen mislukking; late bevestiging finaliseert één keer | Integratietest: geld blijft ‘onderweg’, de late webhook wordt bewaard, de worker dient opnieuw in met dezelfde key, één uitbetaling |
| AT-32 chargeback | Integratietest: aparte vordering, andere klanten onaangetast |
| Reconciliatie sluit aan en vindt verschillen | Integratietests (seed sluit aan; geld bij de betaalpartner zonder boeking → verschil, opnames geblokkeerd, sluiten alleen met tweede persoon) en e2e |

## Werkelijk uitgevoerde controles

5 november 2026 (Node.js 22.23, PostgreSQL 16.15, Chrome via Playwright 1.64.1).

| Controle | Uitkomst |
|---|---|
| `pnpm test` (Vitest; unit en integratie op echte PostgreSQL) | **172 tests geslaagd** (fase 4: +29: grootboek, betalingen, simulator, reconciliatie, limieten, configuratie) |
| `pnpm test:db` | **Alle constraintcontroles geslaagd** (fase 4: +9: holds, opnames, stortingen, dubbele webhook, dubbel verschil, verschil sluiten door één persoon) |
| `pnpm typecheck` en `pnpm build` | **Geslaagd** (6 workspaces) |
| `pnpm test:e2e` op verse database (web + worker) | **24 tests geslaagd** (fase 4: +6: terugkeer zonder betalen, betaling met dubbele bevestiging via de worker, mislukte betaling, opnames, niet-geverifieerde gebruiker, beheer en reconciliatie) |
| Schermen fase 4 | Betalingen en beheer Betalingen bekeken op 390, 768 en 1440 px; demo-betaalpagina op 390 px |

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

- **Fase 3** — Voorraad en portefeuille (acceptatie: cap, reservering en bezit door database én domein bewaakt; portefeuille volgt het werkelijke kaartbezit): edities, programma's met vier-ogengoedkeuring, kaartaanmaak binnen de cap, reserveren, eigendomsoverdracht met event, spelertoelating en marktstatus.
- **Fase 2** — zie hierboven.
- **Fase 0** — Dossier, projectfundament, CI. Acceptatie aangetoond met een verse checkout.
- **Fase 1** — Huisstijl en demo-interface; WF-01 en WF-02 werken op 390, 768 en 1440 px.

## Niet uitgevoerd

| Controle | Reden / planning |
|---|---|
| Echte provideradapter en contracttests | O-03; fase 8 voor sandbox |
| Gelijktijdigheid bij matching en afwikkeling (twee kopers voor de laatste kaart via orders) | Fase 5; kaartaanmaak, kaartreservering en geldreservering zijn al parallel getest |
| Een echte betaalpartner (sandbox), contracttests en capability-rapport | O-02; fase 8 |
| Correctieboekingen bij een reconciliatieverschil (nu: verklaren en sluiten met twee personen) | Fase 8 (operationele procedures) |
| Performance bij 10.000 catalogusspelers | Zoekindex staat er; meting in fase 9 |

## Bekende beperkingen van deze demo

- Orderboek, laatste transactie, handelstransacties en uitgiftes komen nog uit de demowereld (R-36); ze gaan over in fase 5 (orderboek en transacties) en 6 (uitgiftes). Saldo komt sinds fase 4 uit het grootboek.
- Orders plaatsen kan nog niet (de knop meldt dat eerlijk); dat komt in fase 5 en gebruikt dan de geldreserveringen uit fase 4.
- De betaalpartner is een simulator in dezelfde database (schema `psp_sim`). Er gaat geen echt geld om en er wordt nergens om betaalgegevens gevraagd.
- Alles is demo: fictieve spelers en clubs, demomodel `demo-v0`, testgeld, lokale testlogin, placeholder-voorwaarden.

## Volgende fase: 5 — Orders en matching

Previews, limietorders met geldreservering of kaartreservering, prijs-tijdprioriteit, gedeeltelijke uitvoering, annuleren, verlopen en afwikkeling via de betaalsimulator. Met tests voor gelijktijdigheid, self-trade, commissie en herstel: één kaart kan nooit twee kopers krijgen.
