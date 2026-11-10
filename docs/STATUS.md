# Projectstatus

Laatst bijgewerkt: 10 november 2026, 15:30. **Fase 0 tot en met 9 zijn opgeleverd**, fase 8 zonder echte leveranciers (wacht op O-02, O-03, O-06). Er volgt geen bouwfase meer; wat nog nodig is voor een cashpilot staat onder "Voor een cashpilot". Niets in deze repository is productiegeschikt; de demo is niet cashklaar.

## Wat de producteigenaar nog moet doen

| # | Actie | Blokkeert |
|---|---|---|
| 1 | Vraag V-02: wireframe van het marktoverzicht meesturen, als die er is | Niets |
| 2 | Een dataleverancier kiezen en licentie regelen (O-03) | De echte provideradapter |
| 3 | Een identiteitsprovider kiezen (O-06) | Echte verificatie |
| 4 | Een betaalpartner kiezen (O-02) | Acceptatie fase 8 met een echte sandbox; nu bewezen tegen de simulator |
| 5 | Een Railway-account aanmaken voor de online demo (`docs/deploy-demo.md`); later een productiehost met point-in-time recovery | Online demo nu; sandbox-omgeving en pentest later |
| 6 | Juridische en contractuele voorwaarden (O-01, O-07–O-10) | De gates en dus productie |

## Na fase 9 — 10 november 2026

| Oplevering | Status |
|---|---|
| Marktscherm filtert, sorteert en pagineert in SQL; profiel laadt alleen die speler (R-70) | Klaar: `market-read.test.ts`, e2e, belastingtest herhaald |
| CSP met nonce per verzoek, geen `'unsafe-inline'` voor scripts (R-71) | Klaar: e2e headers, geen consolefouten op 390/768/1440 |
| Ongeldige invoer geeft `INPUT_INVALID` (400) in plaats van een serverfout (F-11) | Klaar: unit test |
| Online demo klaargezet: Docker-image, startscript, Railway-configuratie, wachtwoord, weigering zonder wachtwoord of met demogeheimen (R-72, `docs/deploy-demo.md`) | Klaar; lokaal getest zonder Docker (migreren, seeden, wachtwoord, CSP, worker); het image zelf wordt in CI gebouwd en getest. **Online zetten wacht op jouw Railway-account** |
| Keuzedocument met keuzelijst, vergelijkingen van leveranciers en hosting, vragen voor de jurist | Klaar (Claude-document) |
| Waarderingstest hing af van de datum van vandaag | Opgelost |

## Fase 9 — Hardening en cashpilotvoorbereiding: opgeleverd (met open punten)

| Oplevering | Status |
|---|---|
| Securityreview tegen docs/10 (`docs/security-review.md`): 4 hoge en 5 middelgrote bevindingen opgelost, geen kritieke | Klaar; onafhankelijke pentest volgt op een sandbox-omgeving |
| Rate limiting op geld- en orderhandelingen, gedeeld via de database (R-65) | Klaar |
| MFA voor beheerders via de identiteitsprovider (`amr`, R-67) | In code; aantonen met O-06 |
| Productiegates afgedwongen: databasetrigger, opstartweigering web en worker, pauze binnen 30 s bij intrekken; vervullen/intrekken in Beheer → Koppelingen (R-68) | Klaar |
| Beveiligingsheaders (CSP, HSTS, Permissions-Policy), webhooklimiet 64 KB | Klaar |
| Deadlock in het grootboek onder gelijktijdigheid gevonden en opgelost (ADR 0007) | Klaar |
| Belastingtest 10.000 spelers en 100 gelijktijdige orders (`docs/perf/2026-11-06.md`) | Klaar; marktscherm sinds 10 november ook bij 10 gelijktijdige gebruikers binnen de norm (p95 527 ms, R-70) |
| Hersteloefening: dump → terugzetten → vergelijken → invarianten (`pnpm ops:restore-check`, ook in CI) | Klaar |
| Scenario's A, B en C uit docs/09 als ketentests | Klaar (serverniveau, verificatie gesimuleerd tot O-06) |
| Operationele oefeningen: afwikkeling blijft open, reconciliatieverschil | Klaar (geautomatiseerd) |
| Uitbetaalrekening uit de eerste storting (R-66) | Klaar |
| Bewaartermijn ruwe importdata uitgevoerd door de worker | Klaar |
| Eigen gegevens downloaden (Account → Gegevensverzoeken) | Klaar; verwijderen via support |
| Draaiboek back-up en herstel, overdrachtsdocument (`docs/13-handover.md`), ADR 0007 | Klaar |
| Afhankelijkheden- en geheimenscan in CI (pnpm audit, gitleaks) | CI 6 november: `pnpm audit --prod` geen bekende kwetsbaarheden; gitleaks over de hele geschiedenis: geen lekken |

### Acceptatie fase 9

| Criterium | Bewijs |
|---|---|
| De volledige klantketen werkt | Scenario A: registreren → verifiëren → storten → inschrijven → levering → verkopen → tweede koper → afwikkeling → opnemen, met exacte bedragen. Scenario B en C ook. Daarna alle invarianten nul en reconciliatie sluitend. In de browser gedekt per stap (e2e fase 4–8); de verificatiestap is gesimuleerd zolang er geen identiteitsprovider is (O-06) |
| De resterende externe voorwaarden zijn expliciet | "Voor een cashpilot" hieronder, `docs/13-handover.md`, gates in Beheer → Koppelingen |
| Productie wordt alleen op basis van vervulde gates vrijgegeven | Integratietests: gate niet direct in de database te zetten, niet zonder tweede persoon, productie weigert te starten met een open gate; e2e: demo kan geen gate vervullen |

## Voor een cashpilot

| Wat | Wie / wanneer |
|---|---|
| Betaalpartner (O-02), dataleverancier (O-03), identiteitsprovider (O-06): adapter, contracttests in hun sandbox | Producteigenaar kiest; daarna bouw |
| Juridisch (O-01), voorwaarden (O-07), fiscaal (O-08), merk/entiteit (O-09), spelersidentiteit (O-10) | Producteigenaar |
| Hosting met point-in-time recovery; afgeschermde sandbox-omgeving | Producteigenaar kiest; daarna inrichting |
| "Overal uitloggen", externe alerting op de bewakingssignalen | Bouw, na O-06 en keuze monitoringdienst |
| Onafhankelijke penetratietest | Na de sandbox-omgeving |
| Alle tien gates vervullen met bewijs en een tweede persoon | Producteigenaar en eigenaren |

## Fase 8 — Externe integratiesandbox: deels opgeleverd (wacht op leverancierskeuzes)

| Oplevering | Status |
|---|---|
| Contractsuite betalen als code: storten, reserveren, interne verkoop met commissiesplitsing, vrijgeven, uitbetalen, status opvragen, webhookverificatie, providerrapport (ADR 0006, R-61) | Klaar |
| Contractsuite voetbaldata: competities, paginering met compleetheid, stabiele ID's, selecties, wedstrijden, versiegebonden statistieken | Klaar |
| Niet-ondersteunde capability = `BLOCKED` en de geldstroom blijft dicht | Klaar |
| Contracttestruns als bewijs bewaard (append-only), zichtbaar in beheer → Koppelingen naast capabilityrapport en gates | Klaar |
| Contracttestgeld (`contract-test:`) telt niet mee in de reconciliatie | Klaar |
| Bewaking: 10 signalen uit docs/10 met eigenaar en draaiboek; worker opent/sluit meldingen; oppakken met notitie; afgewezen webhooks geteld (R-63) | Klaar |
| Correctieboekingen met vier ogen tegen de verliesrekening van het platform, één keer, nooit onder nul (R-64) | Klaar |
| Draaiboeken in `docs/runbooks/` | Klaar |
| **Echte sandboxkoppeling betaalpartner** | **Geblokkeerd: O-02** |
| **Echte dataleverancier** | **Geblokkeerd: O-03** |
| **Echte identiteitsprovider en contracttest identiteit/notificaties** | **Geblokkeerd: O-06 / notificatieprovider** |

### Acceptatie fase 8

| Criterium | Bewijs |
|---|---|
| Deposit, hold, settlement, fee, release en withdrawal daadwerkelijk getest voor de geselecteerde betaalroute | **Alleen tegen de betaalsimulator** (13 controles geslaagd, integratie- en e2e-test). Er is nog geen betaalroute gekozen (O-02); dezelfde suite moet in de sandbox van de partner slagen. Acceptatie dus **niet** vervuld. |
| Niet-ondersteunde functies worden als blokkade gemeld | Integratietest: adapter zonder uitbetalen en rapport → beide `BLOCKED`, opnames en reconciliatie dicht |

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

6 november 2026 (Node.js 22.23, PostgreSQL 16.15, Chrome via Playwright 1.64.1).

| Controle | Uitkomst |
|---|---|
| `pnpm test` (Vitest; unit en integratie op echte PostgreSQL) | **231 tests geslaagd** (10 november: +6: marktpagina in SQL, foutafhandeling, online-democonfiguratie; fase 9: +17: rate limiting, gates, MFA-regel, deadlock-regressie, gegevensexport, bewaartermijn, scenario A/B/C, twee oefeningen) |
| `pnpm test:db` | **Alle constraintcontroles geslaagd** (incl. fase 8: contracttestbewijs is niet te wijzigen; fase 4: +9: holds, opnames, stortingen, dubbele webhook, dubbel verschil, verschil sluiten door één persoon) |
| CI (GitHub Actions) | Alle stappen groen, inclusief hersteloefening na e2e en de securityjob |
| `pnpm typecheck` en `pnpm build` | **Geslaagd** (6 workspaces) |
| `pnpm test:e2e` op verse database (web + worker) | **42 tests geslaagd** (10 november: +1: marktscherm sorteert en pagineert; fase 9: +6: beveiligingsheaders, CSRF, rate limiting, webhooklimiet, gates in de demo, gegevensdownload; fase 8: +3: contracttests uitvoeren met 0 mislukt, bewaking met 10 signalen, correctie aanvragen → tweede persoon keurt goed → één keer boeken) |
| Hersteloefening op de demodatabase (`pnpm ops:restore-check`) | **Geslaagd**: 72 tabellen, 18.862 rijen, geen verschillen, invarianten nul, auditlog blijft beschermd |
| Belastingtest (`pnpm perf:load`, `perf:http`) | Zie `docs/perf/2026-11-06.md` |
| Schermen fase 4–9 | Koppelingen met gates en Account met gegevensdownload (fase 9); Bewaking, Koppelingen, Betalingen met correcties (fase 8); Betalingen, Transacties, Uitgiftes, Meldingen, spelerpagina en beheer (Betalingen, Handel, Uitgiftes, Waardering) bekeken op 390, 768 en 1440 px; demo-betaalpagina op 390 px |

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

- **Fase 8** — Adaptercontracten als code, capabilitybewijs, bewaking met eigenaren en draaiboeken, correctieboekingen met vier ogen.

- **Fase 7** — Waardering: demomodel, conceptrun, beoordeling door een tweede persoon, publicatie op maandag 18.00.

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
| Contractsuites tegen een echte dataleverancier | O-03 |
| Contractsuites en capabilityrapport tegen een echte betaalpartner-sandbox | O-02 |
| Contracttests identiteit en notificaties | O-06 en keuze notificatieprovider |
| Externe alerting (telefoon/e-mail) op de bewakingssignalen | Keuze monitoringdienst |
| MFA met een echte identiteitsprovider | O-06 |
| Onafhankelijke penetratietest | Na sandbox-omgeving |

## Bekende beperkingen van deze demo

- Alle schermgegevens komen uit de database, behalve de "laatste verkoop" van spelers zonder echte transactie (R-46).
- Referentiewaardes komen uit een demomodel met demo-wedstrijden en demo-transferwaardes; er is nog geen dataleverancier (O-03) en geen gevalideerd model.
- Eerdere uitgiftes in de demo (vóór vandaag) zijn demohistorie zonder vastgelegde trekking.
- Meldingen staan alleen in de app; e-mail en push volgen met een notificatieprovider.
- Zolang een speler nog geen echte transactie heeft, is de "laatste verkoop" een demokoers (R-46).
- De tegenpartij in de demo is een fictieve verzamelaar met echte reserveringen; er is geen marktmaker of platformhandel (BR-23).
- De betaalpartner is een simulator in dezelfde database (schema `psp_sim`). Er gaat geen echt geld om en er wordt nergens om betaalgegevens gevraagd.
- Alles is demo: fictieve spelers en clubs, demomodel `demo-v1`, testgeld, lokale testlogin, placeholder-voorwaarden.

## Volgende stap

Geen nieuwe bouwfase: de volgende stap zijn de keuzes onder "Voor een cashpilot". Daarna: adapters voor de gekozen leveranciers, hosting en een afgeschermde sandbox-omgeving.
