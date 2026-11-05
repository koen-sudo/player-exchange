# Bouwplan

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

## 11. Bouwplan voor Claude

### Fase 0 — Dossier en projectfundament

**Opdracht**

Lees het volledige dossier, maak de documentstructuur en voer een consistentiecontrole uit.

Leg de technische ADR en gekozen dependencyversies vast.

Maak de applicatie, databaseverbinding, migratiestructuur, worker en testconfiguratie.

**Oplevering**

- Werkende lokale start.
- Klant- en beheerroutes.
- Omgevingsvalidatie.
- Healthchecks.
- CI voor typecheck, tests en build.
- Vastgelegde blocking dependencies.

**Acceptatie**

Een nieuwe checkout kan met de README worden gestart zonder verborgen stappen.

### Fase 1 — Huisstijl en complete demo-interface

**Opdracht**

Bouw de goedgekeurde schermen met gedeelde componenten en fictieve fixtures.

Alle knoppen hebben een echte demoactie of een expliciete disabledreden.

**Oplevering**

- Markt.
- Spelersdetail.
- Portefeuille.
- Uitgiftes.
- Koop- en verkoopcontrole.
- Transactieoverzicht.
- Account.
- Beheershell.

**Acceptatie**

Desktop en mobiel zijn bruikbaar. Geen fictieve liveclaims. De twee bekende wireframefouten zijn gecorrigeerd.

### Fase 2 — Catalogus en authenticatie

**Opdracht**

Implementeer identity, autorisatie, catalogusimport, mappings, teams en selecties.

Begin met een fixtureprovider en voeg daarna een gekozen provideradapter toe.

**Acceptatie**

Alle zes competities werken. Imports zijn hervatbaar. Transfers veroorzaken geen duplicaten. Privégegevens blijven privé.

### Fase 3 — Voorraad en portefeuille

**Opdracht**

Implementeer edities, kaartserienummers, eigendomshistorie, voorraadprogramma’s en kostenbasis.

**Acceptatie**

Cap, reservering en bezit worden door database en domeinlaag bewaakt. Portefeuille volgt het werkelijke kaartbezit.

### Fase 4 — Grootboek en betalingsdemo

**Opdracht**

Implementeer dubbel boekhouden, reserveringen, deposits, withdrawals, inbox/outbox en de deterministische payment simulator.

De simulator ondersteunt succes, vertraging, dubbele berichten, fout en onbekende uitkomst.

**Acceptatie**

De financiële invarianten en exacte geldvoorbeelden slagen.

### Fase 5 — Orders en matching

**Opdracht**

Implementeer previews, limietorders, prioriteit, gedeeltelijke uitvoering, annulering, expiry en settlement.

**Acceptatie**

Concurrency-, self-trade-, commissie- en recoverytests slagen. Eén kaart kan nooit twee kopers krijgen.

### Fase 6 — Uitgiftes en toewijzing

**Opdracht**

Implementeer programma’s, drops, inschrijvingen, bevestigde reserveringen, snapshot, rangorde, wachtlijst en levering.

**Acceptatie**

Een retry verandert de winnaars niet. Pending betaling veroorzaakt geen dubbele levering. Niet-toegewezen deelnemers krijgen de reservering terug.

### Fase 7 — Waardering en beheer

**Opdracht**

Bouw inputvalidatie, modelversies, conceptberekening, review en publicatie.

Gebruik een duidelijk gemarkeerd demomodel zolang het productiemodel ontbreekt.

**Acceptatie**

Alleen goedgekeurde output wordt gepubliceerd. Open orders blijven ongewijzigd. Ontbrekende gegevens worden expliciet weergegeven.

### Fase 8 — Externe integratiesandbox

**Opdracht**

Koppel de gekozen leveranciers in hun toegestane testomgevingen.

Lever contracttests en capabilityrapport.

**Acceptatie**

Deposit, hold, settlement, fee, release en withdrawal zijn daadwerkelijk getest voor de geselecteerde betaalroute. Niet ondersteunde functies worden als blokkade gemeld.

### Fase 9 — Hardening en cashpilotvoorbereiding

**Opdracht**

Voer securityreview, belastingtests, restoretest en operationele oefeningen uit.

Werk productiegates, runbooks en overdrachtsdocumentatie af.

**Acceptatie**

De volledige klantketen werkt. De resterende externe voorwaarden zijn expliciet. Productie wordt alleen op basis van vervulde gates vrijgegeven.

### Regels voor iedere fase

Claude levert:

- Wat is gebouwd.
- Welke requirements zijn afgedekt.
- Welke tests werkelijk zijn uitgevoerd.
- Werkelijke testresultaten.
- Open problemen.
- Nieuwe technische besluiten.
- Impact op volgende fasen.

`docs/STATUS.md` wordt na iedere fase bijgewerkt.

Een fase wordt niet als compleet aangemerkt door alleen de UI te tonen.

---
