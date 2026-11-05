# Bedrijfsregels

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

## 03. Bedrijfsregels en toestanden

### BR-01 — Spelersidentiteit

Een speler krijgt een interne onveranderlijke UUID.

Externe bron-ID’s verwijzen via een mapping naar deze UUID.

Een transfer maakt geen tweede speler en geen nieuwe spelersmarkt.

Dubbele of conflicterende matches worden in quarantaine geplaatst voor controle.

### BR-02 — Seizoenen en edities

Het platformseizoen loopt van 1 juli tot 1 juli van het volgende jaar.

Bewaar een expliciete seizoenssleutel, bijvoorbeeld `2026-2027`.

De editie is uniek per speler en platformseizoen. Een transfer tussen competities creëert geen tweede editie voor hetzelfde seizoen.

### BR-03 — Voorraadplafond

Maximaal 500 kaartnummers per speler per platformseizoen.

Het gepubliceerde programma mag lager zijn.

Het eerste volledige programma gebruikt als werkaanname:

- Twintig kaarten bij de openingsuitgifte.
- Vijf kaarten in ieder van 36 vervolguitgiftes.
- Totaal 200.

Bij introductie tijdens het seizoen publiceert beheer een kleiner programma.

Claude genereert geen automatische inhaaluitgiftes.

### BR-04 — Vastgesteld programma

Het programma krijgt statussen `DRAFT`, `APPROVED`, `PUBLISHED`, `COMPLETED` en `CANCELLED`.

Na publicatie:

- Geen verborgen verhoging van het aantal.
- Wijzigingen zijn versiegebonden en geaudit.
- Een vermindering of pauze heeft een reden.
- Reeds geopende uitgiftes krijgen geen extra kaarten.
- Bevestigde eigendom blijft intact.

Het volgende seizoensprogramma wordt volgens de werkaanname minimaal 90 dagen vóór de eerste drop aangekondigd. Een gemiste aankondiging verschuift de nieuwe uitgifte.

### BR-05 — Kaartrechten

Alle jaargangen van dezelfde speler zijn economisch gelijk voor de V1-handel.

Iedere kaart behoudt:

- Speler-ID.
- Editie.
- Serienummer.
- Eigenaar.
- Aankoopgeschiedenis.
- Eventuele reservering.
- Auditgeschiedenis.

De klant koopt een digitaal object volgens de definitieve voorwaarden. Er bestaat geen contractueel recht op de echte transfervergoeding of afrekening tegen de referentieprijs.

### BR-06 — Spelerstatus

Bewaar meerdere dimensies afzonderlijk.

| Dimensie | Voorbeelden |
|---|---|
| Carrière | `ACTIVE`, `RETIRED`, `DECEASED`, `UNKNOWN` |
| Datakwaliteit | `OK`, `PARTIAL`, `STALE`, `MISSING` |
| Primaire toelating | `INELIGIBLE`, `REVIEW`, `APPROVED`, `PAUSED` |
| Markt | `PROFILE_ONLY`, `PRELAUNCH`, `OPEN`, `PAUSED`, `CLOSED` |

Een gebrek aan actuele data hoeft secundaire handel niet automatisch te blokkeren. De pagina toont dan duidelijk de datastatus.

Een veiligheids- of juridische blokkade kan handel wel pauzeren.

### BR-07 — Gebruikerstoelating

Voor geldhandelingen controleert de server:

- Account actief.
- Vereiste identiteit en leeftijd bevestigd.
- Woonland toegelaten.
- Betaalaccount geschikt.
- Relevante voorwaarden geaccepteerd.
- Geen toepasselijke beperking.
- Vereiste productiemodus actief.

Biedingen, inschrijvingen en opnames controleren de actuele status opnieuw.

Beperkingen moeten per bevoegdheid worden ingericht. Bijvoorbeeld een handelsstop kan annuleren en geld opnemen nog toestaan.

### BR-08 — Referentieprijs

Alleen een gepubliceerde modelrun kan de publieke referentie wijzigen.

Een conceptprijs wordt niet per ongeluk openbaar via een API.

Bewaar afzonderlijk:

- Informatiepeildatum.
- Berekenmoment.
- Publicatiemoment.
- Modelversie.
- Dataversie.

Geplande publicatie is maandag 18.00 uur in `Europe/Amsterdam`, na controle.

Een structurele transferwaarde-update wordt in de volgende geplande run verwerkt.

Deze planning is configureerbaar en versiegebonden.

### BR-09 — Primaire drop

Een drop bevat één speler, één editie, een vast aantal kaarten en één vaste prijs.

Een evenement kan meerdere drops bundelen.

Gebruik voor de eerste ronde één kaart per persoon.

Voorgestelde planning:

- Donderdag 18.00 uur programma publiceren.
- Dinsdag 09.00 uur definitieve prijs vastleggen en inschrijving openen.
- Dinsdag 21.00 uur inschrijving sluiten.
- Daarna toewijzen en afwikkelen.

Alle grenzen worden als UTC-tijdstippen opgeslagen en in de gekozen tijdzone weergegeven.

### BR-10 — Reservering bij inschrijving

Een inschrijving telt alleen als de reservering bevestigd is.

Bij onbekende uitkomst blijft de inschrijving `RESERVATION_PENDING`.

Een bevestiging die pas na sluiting binnenkomt, maakt de inschrijving niet alsnog geldig. Het bedrag wordt volgens de adapterprocedure vrijgegeven.

De sluitingssnapshot bevat alleen tijdig bevestigde, toegelaten inschrijvingen.

### BR-11 — Willekeurige toewijzing

Gebruik een controleerbaar proces met een vóór opening vastgelegde seed commitment.

Proces:

1. Genereer een cryptografisch geschikte seed.
2. Bewaar deze versleuteld.
3. Publiceer of registreer de commitment vóór opening.
4. Sluit de inschrijving.
5. Bevries de lijst geldige deelnemers en reserveer de betrokken voorraad.
6. Maak een deterministische willekeurige rangorde op basis van seed, drop-ID en de bevroren deelnemerslijst.
7. Selecteer winnaars tot het beschikbare aantal.
8. Bewaar de rest als wachtlijst.
9. Sla algoritmeversie, snapshots en resultaatdigest op.
10. Start de financiële afwikkeling.

Een retry gebruikt dezelfde snapshot en dezelfde rangorde.

Een beheerder kan geen gunstiger trekking laten uitvoeren.

Publieke controle mag geen persoonsgegevens van deelnemers blootleggen.

### BR-12 — Mislukte toewijzingsbetaling

Bij definitief mislukte afwikkeling kan de volgende nog toegelaten deelnemer op de vaste wachtlijst de kaart krijgen.

Bij een onzekere uitkomst wordt de kaart vastgehouden.

Voorgestelde wachtlijstduur is 24 uur na de eerste toewijzing.

De procedure mag niet tegelijk twee kopers voor dezelfde kaart afwikkelen.

Restanten worden `UNSOLD` wanneer geen geldige wachtlijstafwikkeling mogelijk is.

### BR-13 — Tweede ronde

Een tweede ronde is een afzonderlijk aangekondigde drop met maximaal drie kaarten per gebruiker en expliciete regels.

De eerste technische versie hoeft deze ronde niet automatisch te openen. Het bestaande dropmodel ondersteunt een tweede ronde zonder nieuwe voorraad buiten het programma.

### BR-14 — Orders

V1 ondersteunt:

- Kooplimietorder.
- Verkooplimietorder.
- Aantal in hele kaarten.
- Orderduur van één dag, zeven dagen of maximaal dertig dagen.
- Annulering van het ongematchte restant.

Een prijswijziging annuleert het oude restant en maakt een nieuwe order met nieuwe tijdprioriteit.

### BR-15 — Matching

Match op:

1. Beste prijs.
2. Daarna oudste geaccepteerde servervolgorde.

Bij een nieuwe kooporder wordt de laagste geldige verkooporder gekozen.

Bij een nieuwe verkooporder wordt de hoogste geldige kooporder gekozen.

Uitvoering vindt plaats tegen de prijs van de al bestaande order.

Iedere uitvoering koppelt concrete kaart-ID’s aan koper en verkoper.

### BR-16 — Reserveringen

Kooporder:

Aantal × limietprijs wordt gereserveerd.

Verkooporder:

De specifieke kaarten worden gereserveerd.

Een kaart kan maar in één actieve reservering zitten.

Prijsverbetering wordt na bevestigde uitvoering vrijgegeven.

Bij annulering wordt alleen het vrije ongematchte restant vrijgegeven.

### BR-17 — Zelfhandel

Orders van dezelfde gebruiker of bekende dezelfde belanghebbende worden niet gematcht.

Bij een zelfkruisende nieuwe order wordt deze afgewezen zonder bestaande orders stilzwijgend te annuleren.

Gebruikers zien geen persoonsgegevens van andere marktpartijen.

### BR-18 — Positielimiet

De werkaanname uit het plan blijft configureerbaar beleid.

Maximaal bezit per speler:

De kleinste van 50 en het grootste van 3 of 10% van het cumulatief uitgegeven aantal, naar beneden afgerond.

Neem eigen bezit en alle nog mogelijke aankopen uit open orders, lopende uitvoeringen en gereserveerde uitgifte-inschrijvingen samen.

Verkooporders verminderen het bezit niet voordat de verkoop definitief is.

Gebruikers met een bestaande positie boven een later geldende limiet kunnen verkopen. Nieuwe aankopen zijn geblokkeerd totdat zij weer voldoen.

### BR-19 — Geldbedragen

EUR is de enige valuta in V1.

Gebruik gehele eurocenten voor prijzen, reserveringen en afwikkeling.

V1-voorstel:

- Minimumlimietprijs €0,20.
- Prijsstap €0,01.
- Maximumlimietprijs €10.000.
- Configureerbare operationele limieten voor totaalbedragen.

Dit zijn technische uitvoeringskeuzes. Ze staan in het beslisregister.

Berekeningen gebruiken gehele getallen of een geschikte decimal library. Geen binary floating-point voor geld.

### BR-20 — Commissie en afronding

Nominale verkoperscommissie is 500 basispunten, dus 5%.

Bereken de commissie cumulatief per verkooporder op definitief afgewikkeld bruto volume.

Voor iedere uitvoering:

Nieuwe cumulatieve afgeronde commissie minus eerder geboekte commissie.

Rond half omhoog op hele eurocenten.

Voorbeeld:

- Eerste verkoop van €0,50 binnen een order geeft €0,03 commissie.
- Tweede verkoop van €0,50 binnen dezelfde order geeft €0,02 extra.
- Over €1,00 totaal is de commissie €0,05.

Zo verandert de totale vergoeding binnen een order niet door het splitsen in meerdere fills.

De preview vermeldt dat bij gedeeltelijke uitvoering centafronding kan verschillen.

Bij een nieuwe afzonderlijke order begint de eigen commissieopbouw opnieuw.

### BR-21 — Afwikkeling

Een match geeft nog geen definitieve overdracht.

Statusvolgorde:

`MATCHED` → `SUBMISSION_PENDING` → `PROVIDER_PENDING` → `SETTLED`.

Afwijkende eindpunten:

- `FAILED`.
- `MANUAL_REVIEW`.

In V1 is maximaal één externe afwikkeling per spelersmarkt tegelijk onderweg. Nieuwe orders kunnen worden opgeslagen en geannuleerd, maar de matcher wacht op een opgeloste voorganger.

Deze bewuste eenvoud vermindert herstelcomplexiteit. Schaalvergroting vraagt een afzonderlijke technische wijziging.

### BR-22 — Pensioen

Kaarten blijven bestaan en kunnen als collectible verhandeld worden.

De laatste actieve referentiewaarde krijgt een historische status en datum.

Een oude referentie wordt niet gepresenteerd als nieuw berekende actuele waarde.

Primaire uitgiftes na bevestigd pensioen worden geblokkeerd.

### BR-23 — Restvoorraad

Onverkochte kaarten blijven platformvoorraad en zijn niet beschikbaar in het secundaire orderboek.

V1 heeft geen automatisch afprijzen, verborgen uitgifte of handel door het platform tegen gebruikers.

---


---

## Addendum V1.1 (5 november 2026)

_Overgenomen uit `docs/source/addendum-v1.1.md`. Bij tegenstrijdigheid gaat dit addendum vóór de tekst hierboven._

#### BR-14 — Orderduur

Bevestigd. V1 kent precies drie vaste keuzes:

- Eén dag.
- Zeven dagen.
- Dertig dagen.

Vrije invoer is niet beschikbaar. Eén dag betekent 24 verstreken uren vanaf serveracceptatie. Bereken `expiresAt` met respectievelijk 24, 168 of 720 uur. Bewaar het resultaat in UTC. De bestaande annulering- en settlementregels blijven gelden.


#### BR-02 — Platformseizoen

Bevestigd. Het seizoen is een halfopen interval:

**Vanaf 1 juli 00.00 uur in `Europe/Amsterdam`, tot exclusief 1 juli 00.00 uur van het volgende jaar in dezelfde tijdzone.**

Converteer beide grenzen afzonderlijk naar UTC. Bepaal de seizoenssleutel volgens deze lokale grenzen. Een tijdstip exact op de nieuwe begingrens hoort bij het nieuwe seizoen.
