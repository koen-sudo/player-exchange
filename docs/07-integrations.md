# Integraties

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

## 07. Integraties en betrouwbare afwikkeling

### Adapters

Definieer leveranciersneutrale interfaces.

| Adapter | Contract |
|---|---|
| `FootballDataProvider` | Competities, teams, selecties, wedstrijden, statistieken en correcties |
| `ExternalValuationProvider` | Externe spelerswaardes met bron- en bekend-worden-datum |
| `IdentityProvider` | Verificatie starten en actuele status verwerken |
| `PaymentProvider` | Accounts, reserveringen, afwikkeling, storting, opname en reconciliatie |
| `NotificationProvider` | Transactionele berichten en bezorgstatus |
| `ObjectStorageProvider` | Beveiligde opslag van toegestane exports en snapshots |

Een adapter meldt welke capabilities werkelijk worden ondersteund.

Voorbeelden:

- Saldo reserveren.
- Reservering vrijgeven.
- Interne verkoop afwikkelen.
- Commissie splitsen.
- Betalingsstatus opvragen.
- Uitbetaling uitvoeren.

Ontbreekt een noodzakelijke capability, dan blijft productie voor die geldstroom geblokkeerd.

### Importproces

1. Dataset ophalen met cursor en bronversie.
2. Raw snapshot opslaan volgens toegestane bewaartermijn.
3. Schema en identiteit valideren.
4. Externe IDs mappen.
5. Club- en selectielidmaatschap bijwerken.
6. Statistieken versiegebonden opslaan.
7. Problemen in quarantaine plaatsen.
8. Importresultaat publiceren.

Een ontbrekende speler in een gedeeltelijke import wordt niet verwijderd.

Een complete, gecontroleerde nieuwe selectie kan oude lidmaatschappen afsluiten. Historische kaartgegevens blijven bestaan.

De import is idempotent op provider, entity-ID en versie.

### Achtergrondtaken

| Taak | Voorstel |
|---|---|
| Catalogussynchronisatie | Nachtelijks en handmatig |
| Wedstrijdgegevens | Periodiek en na relevante wedstrijdupdates |
| Externe waardes | Dagelijks controleren |
| Waarderingsrun | Wekelijks op gepubliceerde planning |
| Drops openen/sluiten | Op vastgelegde UTC-tijdstippen |
| Orderexpiry | Periodiek |
| Settlementpolling | Volgens status en providerlimieten |
| Reconciliatie | Minimaal dagelijks |
| Notificaties | Via outbox |

Een scheduler houdt rekening met zomertijd. Een job verwerkt geen tweede drop omdat de klok lokaal teruggaat.

### Deposits

Een storting wordt gestart bij de betaalpartner.

Boek pas beschikbaar saldo na voldoende definitieve providerbevestiging volgens de adapter.

Een betaalmethode met vertraagde zekerheid kan eerst pending saldo opleveren.

Een gebruikersredirect kan de status ophalen, maar bevestigt de storting niet zelf.

### Kooporder met reservering

1. Valideer gebruiker, markt, positie en bedrag.
2. Maak een duurzame orderintentie en reserveringsoperatie.
3. Vraag de providerreservering aan met vaste idempotency-key.
4. Bij bevestiging activeert een database-transactie de reservering en order.
5. Bij timeout blijft de intentie pending.
6. Query of replay dezelfde operatie.
7. Maak geen tweede reservering met een nieuwe key.

De demo-adapter volgt dezelfde stappen en kan op verzoek falen of vertragen.

### Matching en settlement

1. Lock de markt en relevante records.
2. Controleer beschikbare orders, geld, kaarten en limieten.
3. Maak één execution voor één concrete kaart.
4. Verplaats betrokken hoeveelheden naar pending.
5. Leg het settlementverzoek vast in de outbox.
6. Commit.
7. Dien het providerverzoek buiten de databasetransactie in.
8. Wacht op bevestiging of vraag de status op.
9. Finaliseer bij bevestiging in één lokale transactie.

Finaliseren verwerkt samen:

- Definitieve kaartoverdracht.
- Nieuwe ownership event.
- Kostenbasis.
- Geldboekingen.
- Commissie.
- Orderaantallen.
- Vrijgave van prijsverbetering.
- Transactienotificaties.

De lokale database en betaalpartner vormen geen enkele gezamenlijke ACID-transactie. De uitvoering gebruikt daarom een expliciete herstartbare afwikkelingsprocedure.

### Onbekende uitkomst

Bij timeout na het indienen:

- Kaart blijft gereserveerd.
- Geld blijft geblokkeerd.
- Execution blijft pending.
- Geen tweede koper voor dezelfde kaart.
- Geen automatische terugbetaling zolang een late succesvolle bevestiging mogelijk is.
- Herstel loopt via dezelfde providerreferentie.

### Definitieve mislukking

Een aantoonbaar mislukte execution:

- Krijgt `FAILED`.
- Verandert eigendom niet.
- Boekt geen omzet of commissie.
- Herstelt beschikbare hoeveelheden of annuleert volgens de vastgelegde oorzaak.
- Wordt geaudit.

Een geannuleerde, verlopen of inmiddels niet-toegelaten order wordt na herstel niet opnieuw actief.

### Grootboek

Rekeningen onderscheiden ten minste:

- PSP-/afwikkelingsactiva.
- Beschikbaar klantgeld.
- Gereserveerd klantgeld.
- Pending settlement.
- Pending uitbetaling.
- Bruto platformcommissie in clearing.
- Bruto primaire opbrengst in clearing.
- Eventuele klantvorderingen.

Een reservering verplaatst geld tussen klantgeldcategorieën en maakt geen omzet.

Na een secundaire verkoop van €20:

- Koper betaalt €20.
- Verkoper krijgt €19.
- Bruto platformfee is €1.

De uiteindelijke btw- en omzetboekingen volgen de vastgestelde fiscale inrichting. Claude hardcodeert de voorlopige 21%-begrotingsaanname niet als juridische waarheid.

### Uitbetaling

1. Controleer beschikbare middelen en rekening.
2. Maak uitbetalingsintentie.
3. Reserveer bedrag tegen dubbel gebruik.
4. Dien idempotent in.
5. Toon pending.
6. Finaliseer op providerbevestiging.
7. Geef alleen na vastgestelde mislukking vrij.

Een onzekere uitbetaling kan niet daarnaast als vrij saldo worden uitgegeven.

### Chargebacks

Een chargeback creëert een afzonderlijk financieel incident.

Is het gebruikerssaldo ontoereikend, registreer een afzonderlijke vordering of platformverlies volgens het goedgekeurde beleid.

Gebruik geen geld van een andere gebruiker om een verschil te verbergen.

Draai latere kaartverkopen niet automatisch terug zonder vastgelegde incident- en rechtsgrondprocedure.

### Meldingen

V1 bevat in-appmeldingen en transactionele e-mail voor:

- Verificatieactie.
- Inschrijving.
- Toewijzing.
- Afgewikkelde aankoop/verkoop.
- Uitbetaling.
- Geannuleerde drop.
- Relevant accountprobleem.

Bezorgen gebeurt pas na de bijbehorende commit.

Een notificatiefout verandert de eigendom of financiële uitkomst niet.

---
