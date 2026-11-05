# Projectstatus

Laatst bijgewerkt: 6 november 2026, 01:30. **Fase 0 tot en met 6 zijn opgeleverd.** Volgende fase: 7 (waardering). Niets in deze repository is productiegeschikt.

## Wat de producteigenaar nog moet doen

| # | Actie | Blokkeert |
|---|---|---|
| 1 | Vraag V-02: wireframe van het marktoverzicht meesturen, als die er is | Niets |
| 2 | Een dataleverancier kiezen en licentie regelen (O-03) | De echte provideradapter |
| 3 | Een identiteitsprovider kiezen (O-06) | Echte verificatie |
| 4 | Een betaalpartner kiezen (O-02) | Fase 8 (sandbox); fase 4 werkt met een simulator |

## Fase 6 — Primaire uitgifte en toewijzing: opgeleverd

| Oplevering | Status |
|---|---|
| Uitgifte als concept, publicatie na goedkeuring door een tweede persoon; kaarten binnen het programma aangemaakt | Klaar |
| Prijswijziging tussen publicatie en opening, in beide richtingen, met goedkeuring en prijshistorie (V-01a); bij opening vast | Klaar |
| Seed versleuteld bewaard, commitment vóór opening, seed na de trekking openbaar | Klaar |
| Inschrijven met geldreservering, afmelden tot sluiting, één inschrijving per persoon, positielimiet telt mee | Klaar |
| Sluiten: te laat bevestigde reserveringen doen niet mee; niet meer toegelaten deelnemers vallen af; bevroren deelnemerslijst | Klaar |
| Controleerbare trekking (alloc-v1), snapshot met rangorde, herhaling verandert niets | Klaar |
| Afwikkeling via de betaalsimulator; levering met eigendomsevent; omzet primaire uitgifte in het grootboek | Klaar |
| Wachtlijst: alleen na definitieve mislukking; bij onzekere uitkomst blijft de kaart vastgehouden; onverkochte kaarten worden `UNSOLD` | Klaar |
| Worker: openen en sluiten op tijd, toewijzen, afwikkelen, herstel | Klaar |
| Schermen: Uitgiftes uit de database met inschrijven, afmelden, status en controleerbare trekking; beheer Uitgiftes; Meldingen in de app | Klaar |

### Acceptatie fase 6

| Criterium | Bewijs |
|---|---|
| AT-24 dubbele toewijzingsjob behoudt dezelfde winnaars | Herhaling geeft geen nieuwe toewijzingen; met de vrijgegeven seed is de rangorde na te rekenen en gelijk (integratietest) |
| AT-25 te late reservering doet niet mee | Integratietest: `INVALID_LATE`, niet in de deelnemerslijst |
| AT-26 onzekere betaling geeft de kaart niet aan de wachtlijst | Integratietest: kaart blijft vastgehouden; late bevestiging levert één keer |
| AT-27 definitieve fout activeert de volgende vaste kandidaat | Integratietest: tweede toewijzing op de volgende rang, geleverd |
| AT-30 gepensioneerde speler krijgt geen nieuwe uitgifte | Integratietest |
| AT-34 gewijzigde inhoud vraagt nieuwe goedkeuring | Integratietest met een verouderde prijsgoedkeuring |
| Geld klopt | Winnaars betalen precies de prijs, anderen krijgen hun reservering terug; grootboek, handel, voorraad en uitgifte-invarianten 0; reconciliatie sluit aan |

## Werkelijk uitgevoerde controles

5 november 2026 (Node.js 22.23, PostgreSQL 16.15, Chrome via Playwright 1.64.1).

| Controle | Uitkomst |
|---|---|
| `pnpm test` (Vitest; unit en integratie op echte PostgreSQL) | **188 tests geslaagd** (fase 6: +9 uitgifte, inschrijving, trekking, wachtlijst) |
| `pnpm test:db` | **Alle constraintcontroles geslaagd** (fase 4: +9: holds, opnames, stortingen, dubbele webhook, dubbel verschil, verschil sluiten door één persoon) |
| `pnpm typecheck` en `pnpm build` | **Geslaagd** (6 workspaces) |
| `pnpm test:e2e` op verse database (web + worker) | **31 tests geslaagd** (fase 6: +2: uitgifte van concept tot levering met vier ogen, meldingen) |
| Schermen fase 4–6 | Betalingen, Transacties, Uitgiftes, Meldingen, spelerpagina en beheer (Betalingen, Handel, Uitgiftes) bekeken op 390, 768 en 1440 px; demo-betaalpagina op 390 px |

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

- Saldo, orderboek, orders, transacties, uitgiftes en inschrijvingen komen uit de database. De "Recente wedstrijden" en de vorige referentiewaarde komen nog uit de demowereld (fase 7).
- Eerdere uitgiftes in de demo (vóór vandaag) zijn demohistorie zonder vastgelegde trekking.
- Meldingen staan alleen in de app; e-mail en push volgen met een notificatieprovider.
- Zolang een speler nog geen echte transactie heeft, is de "laatste verkoop" een demokoers (R-46).
- De tegenpartij in de demo is een fictieve verzamelaar met echte reserveringen; er is geen marktmaker of platformhandel (BR-23).
- De betaalpartner is een simulator in dezelfde database (schema `psp_sim`). Er gaat geen echt geld om en er wordt nergens om betaalgegevens gevraagd.
- Alles is demo: fictieve spelers en clubs, demomodel `demo-v0`, testgeld, lokale testlogin, placeholder-voorwaarden.

## Volgende fase: 7 — Waardering

Wekelijkse waarderingsrun (maandag 18.00 Europe/Amsterdam): concept, controle, goedkeuring en publicatie van referentiewaardes met uitleg, versie en peildata; conceptwaardes nooit publiek (AT-29); bestaande orders veranderen niet (AT-28). Met het demomodel zolang er geen dataleverancier is (O-03).
