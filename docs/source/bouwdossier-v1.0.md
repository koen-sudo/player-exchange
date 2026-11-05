
# Player Exchange
## PRD, functioneel ontwerp en technisch bouwdossier

Versie 1.0  
Datum 5 november 2026  
Producteigenaar Koen  
Bouwpartner Claude  
Documentstatus Bouwbasis voor ontwikkeling en sandboxvalidatie

## 00. Gebruik van dit dossier

Dit dossier beschrijft de eerste versie van Player Exchange. Het is de inhoudelijke basis voor productontwikkeling, implementatie en acceptatie.

De onderneming bouwt een marktplaats voor digitale voetballerskaarten met echte aankoop- en verkoopprijzen. Gebruikers kunnen spelers ontdekken, kaarten kopen, hun ontwikkeling volgen en kaarten aan andere gebruikers verkopen. Player Exchange publiceert een eigen referentiewaarde in euro’s en ontvangt 5% verkoperscommissie op uitgevoerde secundaire verkopen.

De goedgekeurde handelsinterface is de visuele basis. De technische uitvoering moet alle onderdelen consequent verbinden.

### Bestandsindeling

Claude maakt bij de start de volgende documenten aan en verdeelt de overeenkomstige hoofdstukken over deze bestanden.

| Bestand | Inhoud |
|---|---|
| `README.md` | Productoverzicht, installatie, documentindex en projectstatus |
| `CLAUDE.md` | Permanente projectinstructies uit hoofdstuk 13 |
| `docs/01-prd.md` | Productdoel, gebruikers, scope en requirements |
| `docs/02-ux.md` | Huisstijl, schermen, toestanden en interacties |
| `docs/03-business-rules.md` | Voorraad, uitgifte, matching, commissie en levenscyclus |
| `docs/04-architecture.md` | Technische architectuur en projectstructuur |
| `docs/05-data-model.md` | Entiteiten, relaties en databasebeperkingen |
| `docs/06-api.md` | API-contracten en foutafhandeling |
| `docs/07-integrations.md` | Data, betalingen, identiteit, notificaties en jobs |
| `docs/08-valuation.md` | Waarderingsinterface en onderzoeksopdracht |
| `docs/09-acceptance.md` | Testgevallen en acceptatiecriteria |
| `docs/10-operations.md` | Beveiliging, beheer, monitoring en livegang |
| `docs/11-build-plan.md` | Gefaseerde bouwopdrachten |
| `docs/12-decisions.md` | Besluiten, aannames, afhankelijkheden en bronnen |
| `docs/STATUS.md` | Voortgang, uitgevoerde controles en resterende blokkades |

### Voorrang bij tegenstrijdigheid

1. Latere expliciete besluiten van de producteigenaar.
2. Dit dossier.
3. Goedgekeurde wireframes.
4. Het eerdere bedrijfs- en launchplan.
5. Voorstellen van de bouwpartner.

Afbeeldingen bepalen de visuele richting. Geschreven regels in dit dossier bepalen berekeningen, kaartrechten, statussen en transactieverwerking.

### Drie uitvoeringsmodi

| Modus | Toepassing |
|---|---|
| `demo` | Fictieve spelers, testgeld en lokale integratieadapters |
| `sandbox` | Testomgevingen van externe leveranciers en gecontroleerde datasets |
| `production` | Werkelijke gebruikers en betalingen, uitsluitend na vervulde livevoorwaarden |

Demo- en sandboxgegevens kunnen nooit zonder controle naar productie worden overgezet. Elke omgeving heeft eigen database, sleutels, betaalconfiguratie en auditcontext.

---

## 01. Product requirements document

### Productdoel

Maak het mogelijk om vroeg belangstelling te nemen in voetbaltalent en beperkt uitgegeven digitale kaarten te verhandelen.

De eerste versie moet één volledige keten ondersteunen:

Registreren → verifiëren → geld toevoegen → kaart kopen → kaart bezitten → kaart verkopen → opbrengst opnemen.

Daarnaast moet de beheerder spelersgegevens, waarderingen, uitgiftes, gebruikers en operationele uitzonderingen kunnen beheren.

### Gebruikers

**Bezoeker**

Bekijkt de markt, spelersprofielen, referentiewaardes en uitgifteplanning.

**Geregistreerde gebruiker**

Beheert voorkeuren, volgt spelers en doorloopt de vereiste verificatie.

**Toegelaten handelaar**

Kan geld toevoegen, inschrijven op uitgiftes, orders plaatsen en verkoopopbrengsten opnemen.

**Beheerder**

Heeft een toegewezen rol voor bijvoorbeeld catalogusbeheer, waardering, support of financiële controle.

### Catalogus

Importeer alle teams en de volledige beschikbare eerste-elftalselecties uit:

| Land | Competitie |
|---|---|
| Engeland | Premier League |
| Spanje | LaLiga |
| Duitsland | Bundesliga |
| Frankrijk | Ligue 1 |
| Nederland | Eredivisie |
| België | Pro League |

De catalogus volgt de daadwerkelijk gekozen competitie en het seizoen bij de leverancier. Clubaantallen en selectiegroottes worden geïmporteerd.

Een speler heeft één interne identiteit, ook bij verhuur, transfer of meerdere bronvermeldingen.

Jeugd- en reservespelers vallen onder de import wanneer zij door de gekozen bron bij de eerste selectie worden aangeleverd. Het importeren van een profiel geeft geen automatische toestemming voor kaartuitgifte.

### Catalogus versus handelsmarkt

Iedere geldige geïmporteerde speler krijgt een profiel.

Kaarten worden alleen uitgegeven na toelating van de speler en publicatie van een uitgifteprogramma.

Voor de eerste cashpilot geldt als werkaanname:

- 120 geopende spelersmarkten.
- Twintig spelers per competitie.
- Alle overige profielen blijven doorzoekbaar.
- Uitbreiding wordt in beheer voorbereid en expliciet vrijgegeven.
- Het systeem bevat geen technische cataloguslimiet van 120 of 600 spelers.

### Kernrequirements

| ID | Requirement |
|---|---|
| PRD-01 | Alle zes competities zijn beschikbaar in zoeken en filters. |
| PRD-02 | Alle geïmporteerde teams en spelers kunnen worden weergegeven. |
| PRD-03 | Referentiewaarde, handelsprijzen en voorraad hebben afzonderlijke velden. |
| PRD-04 | Iedere uitgegeven kaart heeft een unieke identiteit en geschiedenis. |
| PRD-05 | Eén centrale spelersmarkt ondersteunt kaarten uit meerdere seizoenen. |
| PRD-06 | Uitgiftes hebben vooraf bekende speler, prijs, hoeveelheid en tijdstippen. |
| PRD-07 | Overinschrijving wordt volgens een controleerbare willekeurige procedure afgehandeld. |
| PRD-08 | Gebruikers kunnen limietkooporders en limietverkooporders plaatsen. |
| PRD-09 | Geld en kaarten worden gereserveerd vóór deelname aan handel. |
| PRD-10 | Iedere secundaire verkoop verwerkt 5% verkoperscommissie met vastgelegde afronding. |
| PRD-11 | De portefeuille toont kaarten, kosten, reserveringen en transacties uit de administratie. |
| PRD-12 | Bevestigde stortingen en opnames sluiten aan op de betaalpartner. |
| PRD-13 | Beheeracties en uitzonderingen worden geaudit. |
| PRD-14 | Herhaalde berichten, retries en gelijktijdige verzoeken veranderen de uitkomst niet onterecht. |
| PRD-15 | Productiehandelingen zijn geblokkeerd zolang de vereiste toelating ontbreekt. |

### Buiten de eerste scope

De volgende onderdelen worden pas na een afzonderlijk productbesluit toegevoegd:

- Mystery packs.
- Dividend of prestatie-uitbetalingen.
- Gegarandeerde terugkoop.
- Handel met geleend geld.
- Fractionele kaarten.
- Crypto of blockchain.
- Native mobiele apps.
- Automatische beleggingsadviezen.
- Abonnementen.
- Extra kaartrechten op basis van zeldzaamheid.
- Een eigen market maker.
- Maandelijkse veilingen van restvoorraad.

Restvoorraad blijft zichtbaar in beheer. Het toevoegen van een veiling vereist een latere briefing.

### Succesmetingen

Meet gebeurtenissen via de backend waar geld of eigendom verandert.

| Meting | Definitie |
|---|---|
| Eerste gefinancierde aankoop | Eerste definitief afgewikkelde aankoop door een onafhankelijke gebruiker |
| Maandhandelaar | Gebruiker met minimaal één afgewikkelde koop of verkoop in 28 dagen |
| Secundair GMV | Som van definitief afgewikkelde secundaire verkoopbedragen, iedere verkoop eenmaal |
| Primaire omzet | Definitief afgewikkelde primaire kaartverkopen |
| Commissie | Definitief geboekte verkopersvergoeding |
| Herhaalgebruik | Gebruiker met een volgende zelfstandige transactie in de gekozen vervolgperiode |
| Liquiditeit | Bieders, verkopers, transacties, spreiding en bieddiepte per speler |
| Afwikkelingskwaliteit | Openstaande uitzonderingen, reconciliatieverschillen en verwerkingstijd |

Demo-, test-, medewerkers- en gesignaleerde manipulatieve transacties worden afzonderlijk gelabeld en kunnen worden uitgesloten.

---

## 02. Huisstijl en schermspecificaties

### Visuele basis

Gebruik de goedgekeurde tradingplatformrichting.

| Onderdeel | Richtlijn |
|---|---|
| Navigatie | Donkerblauw `#142C3C` |
| Achtergrond | Licht `#F7F8FA` |
| Primaire actie | Groen `#087D70` |
| Typografie | Rustige sans-serif, bijvoorbeeld Inter |
| Getallen | Tabular numerals |
| Tabellen | Duidelijke kolommen, rustige scheidingslijnen en consistente uitlijning |
| Avatars | Initialen als standaard |
| Negatieve wijzigingen | Rood met teken en tekst |
| Positieve wijzigingen | Groen met teken en tekst |

De interface gebruikt Nederlands en euro’s. Technische identifiers en code gebruiken Engels.

Foto’s en clublogo’s worden pas gebruikt wanneer daarvoor bevestigde rechten bestaan. Initialen zijn de standaardfallback.

### Navigatie

Desktop:

- Overzicht.
- Markt.
- Uitgiftes.
- Portefeuille.
- Transacties.
- Account.

Mobiel:

- Markt.
- Uitgiftes.
- Portefeuille.
- Account of aanvullend menu.

De belangrijkste handelshandelingen zijn ook met toetsenbord bereikbaar.

### Algemene schermtoestanden

Iedere gegevensafhankelijke pagina krijgt:

- Laden.
- Succesvol geladen.
- Geen resultaten.
- Tijdelijk niet beschikbaar.
- Verouderde gegevens waar relevant.
- Onvoldoende rechten.
- Herstelbare fout met gerichte vervolgactie.

Een lege biedkant wordt weergegeven als “Geen actueel bod”.

Een onbekende prijs wordt weergegeven als “Niet beschikbaar”.

Een ontbrekend bedrag wordt nooit `€0,00` door een fallback.

### Scherm UX-01 — Markt

**Route** `/markt`

Inhoud:

- Zoekveld.
- Competitiefilter.
- Teamfilter.
- Positiefilter.
- Leeftijdsfilter.
- Filter op marktstatus.
- Optioneel alleen gevolgde spelers.
- Sorteerbare tabel.
- Gepagineerde resultaten.

Tabel:

| Kolom | Betekenis |
|---|---|
| Speler | Naam, team, competitie en rol |
| Referentiewaarde | Laatst gepubliceerde modelwaarde |
| Wijziging | Verandering ten opzichte van vorige gepubliceerde modelwaarde |
| Hoogste bod | Beste beschikbare kooporder |
| Laagste vraag | Beste beschikbare verkooporder |
| Status | Profiel, komende uitgifte, handel of beperking |

De standaardweergave toont alle profielen. Er is een snelle filter “Verhandelbaar”.

Profielen zonder uitgegeven kaarten tonen geen verzonnen bied- of laatprijs.

Selectie van een speler opent desktop een compact handelspaneel en biedt een link naar het volledige profiel. Mobiel opent het spelersdetail.

Filters staan in de URL en blijven behouden bij terugnavigeren.

### Scherm UX-02 — Spelersdetail

**Route** `/spelers/[playerId]`

Toon:

- Naam, team, competitie, leeftijd en rol.
- Marktstatus.
- Referentiewaarde met publicatietijdstip.
- Modelversie.
- Referentiewijziging.
- Laatste uitgevoerde verkoop met tijdstip.
- Hoogste bod.
- Laagste vraag.
- Redenen voor de laatste modelwijziging.
- Recente wedstrijden en beschikbare statistieken.
- Koop- en verkoopboek.
- Uitgifteplanning en voorraad.

Voorraad hoort bij deze speler.

| Voorraadveld | Definitie |
|---|---|
| In omloop | Alle definitief geleverde kaarten van deze speler over alle seizoenen |
| Verkocht dit seizoen | Definitief geleverde kaarten van de huidige editie |
| Gepland dit seizoen | Het gepubliceerde uitgifteprogramma voor de editie |
| Seizoensmaximum | De harde bovengrens van 500 |
| Volgende uitgifte | Eerstvolgende aangekondigde drop |

Open orders blijven bij een nieuwe referentiewaarde op hun oorspronkelijke limiet staan.

De handelsknop gaat eerst naar een controlevenster.

### Scherm UX-03 — Portefeuille

**Route** `/portefeuille`

Samenvatting:

- Beschikbaar saldo.
- Gereserveerd saldo.
- Aankoopwaarde van het huidige kaartbezit.
- Som van beschikbare referentiewaardes.
- Aantal spelers en aantal kaarten.
- Bedragen die nog in afwikkeling zijn.

Voorbeeldlabel:

“3 spelers · 6 kaarten”.

Positietabel:

- Speler.
- Aantal in bezit.
- Aantal beschikbaar voor verkoop.
- Aantal gereserveerd.
- Gemiddelde aankoopprijs.
- Totale aankoopwaarde.
- Totale referentiewaarde.
- Hoogste actuele bod per kaart.
- Acties.

Een bod voor één kaart wordt niet behandeld als uitvoerbare prijs voor de volledige positie.

De aankoopwaarde van het huidige bezit volgt uit de aankoopkosten van de specifieke nog aanwezige kaarten. Verkoop verwijdert de kostenbasis van de daadwerkelijk verkochte kaart.

Realisatie:

Verkoopopbrengst minus verkoopcommissie minus aankoopkosten van de verkochte kaart.

Toon geen rendement op basis van een fictieve verkoop.

### Scherm UX-04 — Uitgiftes

**Route** `/uitgiftes`

Tabbladen:

- Binnenkort.
- Open.
- Mijn inschrijvingen.
- Afgerond.

Iedere aanbieding toont:

- Bekende speler.
- Editie.
- Kaartprijs.
- Aantal kaarten in deze drop.
- Maximum per gebruiker.
- Start en einde.
- Verwijzing naar de bijbehorende referentiewaarde.
- Toewijzingsmethode.
- Reserveringsbedrag.

Voorafgaand aan opening is “Melding instellen” beschikbaar.

Tijdens opening is “Inschrijven” beschikbaar wanneer de gebruiker is toegelaten.

Na inschrijving toont de pagina de reservering en inschrijfstatus.

### Scherm UX-05 — Inschrijving

Stappen:

1. Aanbod bekijken.
2. Inschrijving controleren.
3. Bedrag reserveren en inschrijving bevestigen.
4. Wachten op toewijzing.
5. Uitkomst bekijken.

Uitkomsten:

- Kaart toegewezen en betaling in afwikkeling.
- Kaart geleverd.
- Niet toegewezen en reservering vrijgegeven.
- Op wachtlijst.
- Uitgifte geannuleerd.
- Afwikkeling wordt onderzocht.

“Kaart toegewezen” en “Kaart geleverd” zijn afzonderlijke toestanden.

### Scherm UX-06 — Kooporder

Invoer:

- Speler.
- Aantal.
- Maximale prijs per kaart.
- Vervaldatum volgens de toegestane opties.

Controlevenster:

- Aantal.
- Limiet per kaart.
- Maximaal te reserveren bedrag.
- Orderduur.
- Eventuele actuele beste verkoopprijs.
- Uitleg over gedeeltelijke uitvoering.

Knoppen:

- Terug.
- Kooporder plaatsen.

Het maximale bedrag wordt door de server opnieuw berekend.

### Scherm UX-07 — Verkooporder

De gebruiker selecteert concrete kaarten of laat het systeem de oudste beschikbare aankooplots selecteren.

Toon vóór bevestiging welke kaarten onder de order vallen.

Invoer:

- Aantal.
- Minimale verkoopprijs.
- Orderduur.

Controlevenster:

- Aantal en kaart-ID’s.
- Minimale prijs per kaart.
- Bruto bedrag bij volledige uitvoering tegen de limiet.
- Commissie volgens de afrondingsregel.
- Netto indicatie bij die uitvoering.

Uitvoering tegen een hogere bestaande kooporder kan een hogere opbrengst geven.

### Scherm UX-08 — Orders en transacties

**Route** `/transacties`

Toon afzonderlijk:

- Open orders.
- Gedeeltelijk uitgevoerde orders.
- Uitvoeringen in afwikkeling.
- Afgewikkelde transacties.
- Geannuleerde en verlopen orders.

Orderdetails bevatten alle fills, kosten, reserveringsmutaties en annuleringen.

Een gebruiker kan alleen het nog niet gematchte deel annuleren.

### Scherm UX-09 — Betalingen

**Route** `/betalingen`

Toon:

- Beschikbaar saldo.
- Reserveringen.
- Nog niet beschikbare ontvangsten.
- Stortingen.
- Opnames.
- Verificatiestatus.
- Betaalrekeningstatus.

Storten en opnemen gebruiken de geselecteerde betaalpartner.

Een browserredirect naar “gelukt” geldt niet als financiële bevestiging.

### Scherm UX-10 — Account

Beheer:

- Profiel.
- Verificatie.
- Woonland.
- Taal.
- Notificatievoorkeuren.
- Beveiliging.
- Actieve sessies.
- Document- en gegevensverzoeken.

Een wijziging van relevante identiteit of woonland kan een nieuwe beoordeling vereisen.

### Scherm UX-11 — Beheer

**Route** `/beheer`

Modules:

- Catalogus.
- Importstatus.
- Spelertoelating.
- Editie- en voorraadbeheer.
- Uitgifteplanning.
- Toewijzingen.
- Waarderingsruns.
- Gebruikers en beperkingen.
- Orders en uitvoeringen.
- Betalingsafwijkingen.
- Reconciliatie.
- Auditlog.
- Livevoorwaarden.

Beheeracties worden altijd server-side geautoriseerd.

### Responsiveness

Controleer minimaal op breedtes van 390, 768 en 1440 pixels.

Op mobiel:

- Tabellen veranderen waar nodig in gelabelde kaarten.
- Cruciale prijzen blijven afzonderlijk herkenbaar.
- Actieknoppen bedekken geen belangrijke informatie.
- Formulieren werken met een numeriek toetsenbord.
- Dialogen zijn scrollbaar en houden focus correct vast.

---

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

## 04. Technische architectuur

### Keuze

Bouw één modulaire applicatie in één repository.

De klantomgeving en beheeromgeving delen backenddiensten en database.

Gebruik een afzonderlijk workerproces voor imports, matching, waardering, toewijzing en afwikkeling.

### Voorgestelde stack

| Laag | Keuze |
|---|---|
| Taal | TypeScript |
| Webapp | Next.js met App Router |
| UI | React, Tailwind CSS en toegankelijke componenten |
| Database | PostgreSQL |
| Databasecode | Drizzle ORM met expliciete SQL waar nodig |
| Validatie | Zod |
| Achtergrondtaken | BullMQ en Redis |
| Authenticatie | Auth.js met externe OIDC-provider |
| Tests | Vitest, PostgreSQL-integratietests en Playwright |
| Bestandsopslag | S3-compatibele objectopslag |
| Runtime | Node.js-processen voor web en worker |
| Packagebeheer | pnpm |

Claude controleert bij implementatie de actuele stabiele compatibiliteit en legt exacte versies vast in lockfile en een korte ADR.

Redis is geen bron voor financieel saldo, kaartbezit of definitieve orderstatus.

### Modules

- Identity.
- Catalog.
- Market admission.
- Inventory.
- Issuance.
- Trading.
- Settlement.
- Ledger.
- Payments.
- Valuation.
- Notifications.
- Administration.
- Audit.

### Projectstructuur

| Pad | Verantwoordelijkheid |
|---|---|
| `apps/web` | Klantinterface, beheer en HTTP-endpoints |
| `apps/worker` | Achtergrondtaken |
| `packages/domain` | Bedrijfsregels en use cases |
| `packages/db` | Schema, migrations en repositories |
| `packages/contracts` | Request- en responsevalidatie |
| `packages/integrations` | Externe adapters en demo-implementaties |
| `packages/ui` | Gedeelde visuele componenten |
| `tests` | Integratie-, concurrentie- en end-to-endtests |

De domeinlaag bevat geen UI-code en hoeft geen externe leveranciers-SDK te importeren.

### Backendregels

- Alle mutaties via gedeelde use cases.
- Autorisatie binnen de serverlaag.
- Databaseconstraints ondersteunen de applicatievalidatie.
- Belangrijke mutaties en outboxberichten worden in dezelfde databasetransactie opgeslagen.
- Externe netwerkcalls vinden buiten langlopende database-locks plaats.
- Leverancierscalls krijgen een stabiele idempotency-key.
- De worker kan veilig opnieuw starten.

### Concurrency

Gebruik PostgreSQL-transacties en expliciete locks in een vaste volgorde.

Lock voor gevoelige handelingen:

1. Spelersmarkt of editie.
2. Betrokken wallets op gesorteerde account-ID.
3. Orders op vaste volgorde.
4. Kaarten op gesorteerde kaart-ID.

Bij database-deadlock of serialization failure wordt de volledige betreffende transactie begrensd opnieuw uitgevoerd.

Beveilig dubbel werk met database-unieke sleutels. Een queue-job-ID alleen is onvoldoende.

---

## 05. Datamodel en databasebeperkingen

Alle kernrecords krijgen interne UUID, aanmaakdatum en waar relevant een versieveld.

### Identiteit en catalogus

| Entiteit | Belangrijkste velden en beperkingen |
|---|---|
| `users` | Auth-subject uniek, status, locale, aanmaakdatum |
| `user_profiles` | Woonland, verificatieverwijzing, benodigde profielvelden |
| `user_restrictions` | Type beperking, reden, ingangsdatum, einddatum, actor |
| `terms_acceptances` | Gebruiker, documentversie, tijdstip |
| `competitions` | Interne ID, provider-ID, naam, land, actief |
| `competition_seasons` | Competitie, provider-seizoen, datums |
| `teams` | Interne ID, naam, externe mappings |
| `team_competition_memberships` | Team, competitie, geldig interval |
| `players` | Identiteit, naam, geboortedatum, carrièrestatus |
| `provider_player_mappings` | Uniek op provider en externe speler-ID |
| `player_team_memberships` | Speler, team, type lidmaatschap, geldig interval |
| `player_roles` | Rol, bron, geldigheid en weging |
| `fixtures` | Wedstrijd, teams, status en bron-ID |
| `player_match_stats` | Speler, wedstrijd, versie, statistieken en bronpeildatum |
| `watchlists` | Uniek op gebruiker en speler |
| `import_runs` | Provider, scope, cursor, status en dekking |
| `import_issues` | Ontbrekende velden, duplicaten en herstelstatus |

### Waardering

| Entiteit | Belangrijkste velden |
|---|---|
| `external_valuations` | Speler, bron, bedrag, valuta, peildatum en bekend-worden-tijd |
| `valuation_model_versions` | Parameters, codeversie, goedkeuring en status |
| `valuation_runs` | Scope, inputsnapshot, status, berekend en gepubliceerd |
| `player_reference_values` | Speler, run, bedrag, betrouwbaarheid, verklaringen en status |
| `valuation_reviews` | Reviewbesluit, actor, reden en gekoppelde versie |

Publieke queries lezen uitsluitend gepubliceerde waarderingen.

### Voorraad en uitgifte

| Entiteit | Belangrijkste velden en beperkingen |
|---|---|
| `player_markets` | Uniek per speler, marktstatus en reden |
| `editions` | Uniek per speler en platformseizoen, cap 500 |
| `issuance_programs` | Editie, versie, gepland aantal, goedkeuring en publicatie |
| `cards` | Editie, serienummer, speler, voorraadstatus, eigenaar |
| `ownership_events` | Kaart, vorige/nieuwe eigenaar, oorzaak en uitvoering |
| `drops` | Editie, prijs, hoeveelheid, tijdstippen en status |
| `drop_cards` | Concrete kaart-ID’s voor een drop |
| `subscriptions` | Uniek per drop en gebruiker, reservering en status |
| `allocations` | Rangorde, kaart, ontvanger, status en algoritmeversie |
| `allocation_snapshots` | Deelnemersdigest, seed commitment, resultaatdigest |

Kaartserienummers vallen binnen 1–500 en zijn uniek binnen een editie.

Het systeem maakt geen nieuwe kaartsleutel om een mislukte uitgifte buiten de cap om te herstellen.

Een kaart met onzekere externe afwikkeling blijft geblokkeerd.

### Handel

| Entiteit | Belangrijkste velden |
|---|---|
| `orders` | Speler, gebruiker, kant, limiet, aantallen, status, prioriteitsnummer, expiry |
| `order_cards` | Specifieke kaarten gereserveerd voor verkoop |
| `executions` | Kooporder, verkooporder, kaart, prijs, fee en afwikkelingsstatus |
| `settlement_operations` | Type, idempotency-key, providerreferentie, status en retries |
| `idempotency_requests` | Actor, endpoint, key, requesthash en resultaat |
| `outbox_events` | Te verwerken domeinevents |
| `inbox_events` | Uniek ontvangen extern event en verwerkingsstatus |

Orderaantallen bewaren afzonderlijk:

- Oorspronkelijk.
- Vrij openstaand.
- In afwikkeling.
- Definitief uitgevoerd.
- Geannuleerd.
- Verlopen.

De som blijft gelijk aan het oorspronkelijke aantal.

### Geldadministratie

| Entiteit | Belangrijkste velden |
|---|---|
| `payment_accounts` | Gebruiker, provideraccount, valuta, status |
| `ledger_accounts` | Type, eigenaar en valuta |
| `journal_entries` | Business-event-ID, status, tijdstip en bron |
| `journal_lines` | Rekening, debit/credit, bedrag en valuta |
| `cash_holds` | Gebruiker, doel, bevestigd bedrag en status |
| `deposits` | Providerreferentie, bedrag, status |
| `withdrawals` | Bedrag, rekeningverwijzing, status |
| `reconciliation_runs` | Scope, peildatum en uitkomst |
| `reconciliation_breaks` | Verschil, ernst, actor en herstelstatus |
| `customer_receivables` | Afzonderlijke vordering bij bijvoorbeeld een chargeback |

Iedere journal entry is in balans per valuta.

Journaalregels worden niet overschreven. Correcties gebruiken een tegenboeking met verwijzing.

Financiële projections worden bijgewerkt binnen dezelfde transactie als de journaalboeking en kunnen opnieuw uit het journaal worden opgebouwd.

### Audit en beheer

- `roles`.
- `permissions`.
- `user_roles`.
- `admin_approvals`.
- `audit_events`.
- `feature_gates`.
- `notification_outbox`.
- `notification_deliveries`.

Een goedkeuring bindt aan de hash van de exacte handeling en payload. Een wijziging maakt een oude goedkeuring ongeldig.

---

## 06. API-contracten

### Algemene conventies

- Prefix `/api/v1`.
- JSON.
- ISO-8601-datums in UTC.
- Bedragen als integer-centstrings, bijvoorbeeld `"620"`.
- Aantallen als positieve gehele getallen.
- IDs als UUID’s.
- Server bepaalt user-ID uit de sessie.
- Client mag geen fee, eigenaar of definitief saldo bepalen.
- Muterende financiële endpoints vereisen `Idempotency-Key`.
- Hergebruik van een key met andere payload geeft conflict.
- Autorisatie blijft verplicht bij een herhaald verzoek.

### Publieke en catalogus-endpoints

| Methode en pad | Gedrag |
|---|---|
| `GET /competitions` | Zes ingestelde competities en dekking |
| `GET /teams` | Filter op competitie en seizoen |
| `GET /players` | Zoeken, filters, sortering en cursorpaginering |
| `GET /players/{id}` | Profiel en datastatus |
| `GET /players/{id}/reference` | Gepubliceerde referentie en historie |
| `GET /players/{id}/stats` | Beschikbare statistieken met peildatum |
| `GET /players/{id}/market` | Marktstatus, bieding, vraag en handelsactiviteit |
| `GET /players/{id}/orderbook` | Geaggregeerde beschikbare orders |
| `GET /players/{id}/trades` | Definitief afgewikkelde publieke transacties |
| `GET /players/{id}/supply` | Oplage, programma, verkocht en komende drops |
| `GET /drops` | Uitgifteoverzicht |
| `GET /drops/{id}` | Dropdetails |

### Gebruiker-endpoints

| Methode en pad | Gedrag |
|---|---|
| `GET /me` | Profiel, status en toegestane acties |
| `POST /me/verification` | Start verificatie via provider |
| `PUT /me/watchlist/{playerId}` | Speler volgen |
| `DELETE /me/watchlist/{playerId}` | Volgen stoppen |
| `GET /me/portfolio` | Bezit, kostenbasis en waarderingen |
| `GET /me/balances` | Beschikbaar, gereserveerd en pending |
| `GET /me/orders` | Eigen orders |
| `GET /me/transactions` | Eigen uitvoeringen |
| `GET /me/cards/{cardId}` | Kaartbewijs en eigen relevante historie |
| `POST /order-previews` | Order valideren en serverpreview maken |
| `POST /orders` | Preview bevestigen en order plaatsen |
| `POST /orders/{id}/cancel` | Vrij restant annuleren |
| `POST /drops/{id}/subscriptions` | Inschrijven met reservering |
| `POST /subscriptions/{id}/cancel` | Annuleren vóór sluiting |
| `GET /me/subscriptions` | Eigen inschrijvingen en uitkomsten |
| `POST /deposits` | Betaling starten |
| `POST /withdrawals` | Uitbetaling aanvragen |
| `GET /me/payments` | Betaalhistorie |

### Orderpreview

Invoer:

- `side`.
- `playerId`.
- `quantity`.
- `limitPriceMinor`.
- `timeInForce`.
- `cardIds` voor verkoop, of expliciete automatische kaartselectie.

Uitvoer:

- `previewId`.
- Geldigheid, standaard 60 seconden.
- Serverberekende totalen.
- Feeregel.
- Geselecteerde kaart-ID’s.
- Actuele marktstatus.
- Beschikbare rechten.
- Benodigde reservering.

De preview reserveert nog geen middelen.

Bij bevestiging controleert de server actuele beschikbaarheid opnieuw. Een verlopen of inhoudelijk gewijzigde preview vraagt nieuwe controle.

Een actuele marktprijs kan wijzigen. De bevestigde limiet blijft leidend voor de uitvoering.

### Externe callbacks

- `POST /webhooks/payments/{provider}`.
- `POST /webhooks/identity/{provider}`.

Deze endpoints controleren authenticiteit volgens het providercontract, leggen het event duurzaam vast en verwerken het idempotent.

Browsercookies zijn geen authenticatiemiddel voor providerwebhooks.

### Beheer-endpoints

Alle beheer-endpoints vallen onder `/admin`.

Modules ondersteunen:

- Imports starten en problemen bekijken.
- Spelers toelaten of pauzeren.
- Programma’s voorbereiden en goedkeuren.
- Drops publiceren, uitstellen en annuleren.
- Waarderingsruns voorbereiden, reviewen en publiceren.
- Gebruikersbeperkingen instellen.
- Settlement- en reconciliatieproblemen behandelen.
- Auditgegevens bekijken.
- Productiegates beoordelen.

Geen algemeen “saldo aanpassen”-endpoint.

Een financiële correctie heeft een specifiek type, reden, gekoppeld dossier en waar vereist tweede goedkeuring.

### Foutcodes

| Code | Betekenis |
|---|---|
| `AUTH_REQUIRED` | Inloggen vereist |
| `ACTION_NOT_ALLOWED` | Bevoegdheid ontbreekt |
| `VERIFICATION_REQUIRED` | Verificatie nodig |
| `COUNTRY_NOT_SUPPORTED` | Klantmarkt niet toegelaten |
| `MARKET_NOT_OPEN` | Handel voor deze speler gesloten |
| `PRICE_INVALID` | Prijs buiten toegestane grenzen |
| `INSUFFICIENT_AVAILABLE_FUNDS` | Te weinig vrij saldo |
| `CARD_UNAVAILABLE` | Kaart al gereserveerd of niet in bezit |
| `POSITION_LIMIT_EXCEEDED` | Bezitslimiet overschreden |
| `PREVIEW_EXPIRED` | Controlevenster opnieuw openen |
| `IDEMPOTENCY_CONFLICT` | Key hoort bij andere inhoud |
| `DROP_NOT_OPEN` | Geen geldige inschrijfperiode |
| `SUBSCRIPTION_EXISTS` | Al ingeschreven |
| `PAYMENT_PENDING` | Uitkomst nog niet vastgesteld |
| `RECONCILIATION_HOLD` | Handeling tijdelijk geblokkeerd voor onderzoek |

De response bevat `requestId`, foutcode en bruikbare Nederlandse melding. Gevoelige interne details blijven in de beveiligde logs.

---

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

## 08. Waarderingsmodule

### Doel en status

De waarderingsmodule publiceert een modelmatige euroreferentie.

De definitieve productieformule is nog niet gevalideerd. Dat verhindert het bouwen van de interface en pipeline niet.

Demo gebruikt expliciete voorbeeldwaardes. Productie publiceert pas met een goedgekeurde modelversie en toegestane inputs.

### Onderzoeksmodel

De eerdere kandidaat blijft beschikbaar als onderzoeksrichting:

R = c × [w(a) × (M/M0)^α + (1 − w(a)) × P] × (1 + u) × D.

| Component | Betekenis |
|---|---|
| M | Externe transferwaardeschatting |
| w(a) | Geleidelijke leeftijdsweging |
| P | Structurele positiegebonden prestatiecomponent |
| u | Recente prestatiecorrectie |
| D | Eventuele correctie voor aanbod |
| c, M0, α | Gezamenlijke schaalparameters |

Claude implementeert deze kandidaat niet stilzwijgend als gevalideerde productieprijs.

### Invoer

- Speleridentiteit en rol.
- Leeftijd op peildatum.
- Externe transferwaarde met datum waarop die bekend werd.
- Minuten.
- Rolgebonden wedstrijdstatistieken.
- Competitie- en teamcontext.
- Datakwaliteit.
- Eerdere herijking.
- Eventuele goedgekeurde aanbodgegevens.

### Uitvoer

Iedere berekening levert:

- Referentiebedrag.
- Betrouwbaarheidsstatus.
- Belangrijkste verklaringen.
- Inputsnapshot.
- Modelversie.
- Informatiepeildatum.
- Eventuele fouten of waarschuwingen.
- Indicatie of publicatie is toegestaan.

### Rollen

Maak afzonderlijke featureprofielen voor:

1. Keeper.
2. Centrale verdediger.
3. Back/wingback.
4. Verdedigende middenvelder.
5. Centrale/aanvallende middenvelder.
6. Vleugelspeler.
7. Spits.

Alleen features gebruiken die aantoonbaar gedekt zijn.

Een ontbrekende xG-waarde wordt niet gelijkgesteld aan nul.

### Herijking

Bij een nieuwe externe transferwaardeschatting:

- De nieuwe waarde krijgt een eigen peildatum.
- De structurele component wordt herberekend.
- Recente correcties worden volgens het model opnieuw gebaselineerd.
- Eerdere wedstrijden worden niet opnieuw als nieuwe gebeurtenissen toegepast.

### Publicatie

`DRAFT` → `VALIDATED` → `APPROVED` → `PUBLISHED`.

Andere uitkomsten:

- `REJECTED`.
- `FAILED`.
- `SUPERSEDED`.

Publiceer een run of duidelijk afgebakende batch atomisch. Gebruikers mogen geen willekeurige mix van halve updates zien.

Bij ontbreken van input blijft de vorige referentie zichtbaar met oude datum en datastatus.

### Modelacceptatie

Vereist vóór productie:

- Reproduceerbare output.
- Tijdgescheiden backtest.
- Geen gebruik van toekomstige gegevens.
- Analyse per rol en competitie.
- Gedrag bij weinig minuten.
- Gedrag bij blessure, transfer en pensioen.
- Analyse van extra seizoensaanbod.
- Onderbouwing van de euromapping.
- Begrijpelijkheidstest.
- Getekende modelkaart.

Een backtest van sportieve prestaties bewijst geen uitvoerbare kaartprijs. Deze twee evaluaties blijven afzonderlijk.

---

## 09. Acceptatie- en testplan

### Basisfixture

Gebruik fictieve gegevens:

- Zes competities.
- Vier teams per competitie.
- Tien spelers per team.
- Totaal 240 catalogusspelers.
- Twintig geopende markten per competitie.
- Totaal 120 geopende markten.
- Spelers in alle zeven rolcategorieën.
- Profielen zonder voldoende data.
- Een transfer tussen twee competities.
- Een gepensioneerde speler.
- Een minderjarig profiel zonder primaire toelating.

Deze fixture is demonstratiedata. Ze pretendeert geen volledige echte competitie-import te zijn.

De live-import moet alle werkelijk beschikbare eerste teams en selecties ophalen, inclusief paginering.

### Hoofdtests

| ID | Scenario en verwachte uitkomst |
|---|---|
| AT-01 | Alle zes competities verschijnen en zijn filterbaar. |
| AT-02 | Een volledige herimport creëert geen dubbele spelers. |
| AT-03 | Een transfer behoudt speler-ID, kaartbezit en orderboek. |
| AT-04 | Een gedeeltelijke import verwijdert geen bestaande spelers. |
| AT-05 | Een speler zonder kaarten blijft vindbaar en toont geen fictieve handelsprijs. |
| AT-06 | De 501e kaart van dezelfde speler/editie wordt geweigerd. |
| AT-07 | Twee gelijktijdige aanvragen kunnen dezelfde laatste kaart niet leveren. |
| AT-08 | Een niet-toegelaten gebruiker kan geen order via directe API plaatsen. |
| AT-09 | Een gebruiker kan andermans kaart of order niet wijzigen. |
| AT-10 | Een dubbele stortingswebhook boekt één storting. |
| AT-11 | Een redirect zonder providerbevestiging boekt geen beschikbaar saldo. |
| AT-12 | Twee kooporders kunnen samen niet meer geld reserveren dan beschikbaar. |
| AT-13 | Eén kaart kan niet in twee verkooporders staan. |
| AT-14 | Een nieuwe kooporder matcht de goedkoopste geldige verkooporder. |
| AT-15 | Gelijke prijzen gebruiken vaste serverprioriteit. |
| AT-16 | Uitvoering gebruikt de bestaande orderprijs. |
| AT-17 | Eigen orders worden niet met elkaar gematcht. |
| AT-18 | Een gedeeltelijke uitvoering houdt de resterende reservering correct vast. |
| AT-19 | Annulering tijdens settlement geeft het pending deel niet vrij. |
| AT-20 | Een verlopen order komt na een retry niet opnieuw tot leven. |
| AT-21 | Een settlementtimeout draagt geen kaart over en maakt geen geld vrij. |
| AT-22 | Een late succesvolle bevestiging finaliseert eenmaal. |
| AT-23 | Een definitieve settlementfout boekt geen commissie. |
| AT-24 | Een dubbele toewijzingsjob behoudt dezelfde winnaars. |
| AT-25 | Een reservering die te laat wordt bevestigd doet niet mee. |
| AT-26 | Onzekere betaling van een winnaar geeft dezelfde kaart niet aan de wachtlijst. |
| AT-27 | Een mislukte betaling met definitieve status kan de volgende vaste kandidaat activeren. |
| AT-28 | Een nieuwe referentiewaarde wijzigt geen bestaande limietorder. |
| AT-29 | Een conceptwaardering is niet publiek toegankelijk. |
| AT-30 | Een gepensioneerde speler krijgt geen nieuwe primaire uitgifte. |
| AT-31 | Een uitbetaling en kooporder kunnen niet hetzelfde beschikbare saldo gebruiken. |
| AT-32 | Een chargeback wordt afzonderlijk geboekt en breekt andere saldi niet. |
| AT-33 | Beheeracties hebben actor, reden en gekoppelde records. |
| AT-34 | Een gewijzigde goedkeuringspayload vereist nieuwe goedkeuring. |
| AT-35 | Demo-adapters kunnen niet door een publieke request in productie worden geactiveerd. |

### Exact geldvoorbeeld

Begintoestand koper:

- Beschikbaar €100,00.
- Kooporder twee kaarten met limiet €6,20.
- Reservering €12,40.
- Vrij saldo €87,60.

Er wordt één kaart gekocht tegen een bestaande vraag van €6,00.

Na definitieve afwikkeling:

- Betaald €6,00.
- Vrijgegeven prijsverbetering €0,20.
- Vrij saldo €87,80.
- Nog gereserveerd voor de tweede kaart €6,20.
- Verkoper ontvangt €5,70.
- Platformfee €0,30.

Na annulering van de tweede kaart:

- Vrij saldo koper €94,00.
- Reservering €0,00.
- Eén kaart in bezit.

### Exact commissievoorbeeld

Verkooporder twee kaarten voor €0,50 per kaart.

Na eerste definitieve fill:

- Cumulatief bruto €0,50.
- Cumulatieve commissie €0,03.
- Netto eerste fill €0,47.

Na tweede definitieve fill:

- Cumulatief bruto €1,00.
- Cumulatieve commissie €0,05.
- Extra commissie €0,02.
- Netto tweede fill €0,48.

Totaal netto €0,95.

### Structurele invarianten

Test automatisch:

- Iedere financiële entry is in balans.
- Beschikbaar saldo kan niet door normale gebruikersacties negatief worden.
- Iedere kaart heeft maximaal één eigenaar.
- Iedere kaart heeft maximaal één actieve verkoopreservering.
- Iedere externe operatie wordt maximaal eenmaal financieel verwerkt.
- Iedere edition blijft binnen de cap.
- Orderaantallen blijven aansluiten.
- Definitieve eigendom heeft een gekoppelde succesvolle afwikkeling.
- Publieke handelsstatistieken bevatten alleen toegestane definitieve uitvoeringen.

### End-to-end

Minimaal drie volledige scenario’s:

**Scenario A**

Registreren → verifiëren → storting → primaire inschrijving → levering → verkooporder → tweede koper → afwikkeling → opname.

**Scenario B**

Kooporder met twee kaarten → gedeeltelijke uitvoering → restant annuleren → juiste portefeuille en saldo.

**Scenario C**

Provider timeout → worker herstart → webhook later → één correcte afwikkeling.

### Performance

Richtwaarden voor een eerste testomgeving:

- Marktquery onder 750 ms p95 bij 10.000 catalogusspelers en geschikte indexen.
- Orderacceptatie zonder providerlatency onder één seconde p95.
- Marktinformatie binnen vijf seconden na definitieve mutatie bijgewerkt.
- Geen datacorruptie bij 100 gelijktijdige testrequests op één markt.
- Import verwerkt alle pagina’s en kan onderbreken en hervatten.

Documenteer hardware, dataset en meetmethode. Rapporteer werkelijke uitkomsten.

---

## 10. Beheer, beveiliging en livevoorwaarden

### Rollen

| Rol | Toegang |
|---|---|
| Support | Eigen bevoegdheidsbereik voor gebruikersvragen en relevante transacties |
| Catalog manager | Imports, mappings en spelersprofielen |
| Issuance operator | Uitgiftes voorbereiden |
| Valuation analyst | Waarderingen voorbereiden en onderzoeken |
| Finance operator | Settlement, reconciliatie en financiële incidenten |
| Approver | Bevoegde vrijgave van specifieke handelingen |
| Superadmin | Rollenbeheer en noodconfiguratie, volledig geaudit |

Dezelfde actor keurt zijn eigen gevoelige handeling niet goed.

### Gevoelige acties

Vereis tweepersoonsgoedkeuring voor:

- Productieformule publiceren.
- Uitgifteprogramma publiceren of materieel wijzigen.
- Financiële correctie.
- Handmatige oplossing met geld- of eigendomseffect.
- Productiebetalingen activeren.

Voor kleinere teams kunnen personen meerdere rollen hebben, maar de tweede goedkeuring vereist een andere bevoegde gebruiker.

### Securityrequirements

- Beheerders gebruiken MFA via de gekozen identiteitsprovider.
- Bevoegdheden en objecteigendom controleren bij iedere relevante request.
- Beveiligde sessiecookies.
- CSRF-bescherming voor cookiegeauthenticeerde mutaties.
- Rate limiting op gevoelige endpoints.
- Inputvalidatie aan serverzijde.
- Secrets uitsluitend server-side.
- Providerwebhooks authentiseren.
- Logs zonder toegangstokens, identiteitsdocumenten of volledige rekeningnummers.
- Afscherming en bewaartermijn voor raw datasets en exports.
- Toegangscontrole op bestanden.
- Dependency- en secret-scans.
- Back-ups en aantoonbare herstelprocedure.

### Monitoring

Dashboard voor:

- Importvertraging.
- Verouderde referenties.
- Queueachterstand.
- Pending settlements.
- Gefaalde provideroperaties.
- Reconciliatieverschillen.
- Onvoldoende dekking van reserveringen.
- Voorraadverschillen.
- Webhookverificatiefouten.
- Uitbetalingsproblemen.

Een foutmelding bevat een operationele eigenaar en afhandelstatus.

### Dagelijkse reconciliatie

Vergelijk:

1. Providerrecords.
2. Stortingen en opnames.
3. Settlementoperaties.
4. Grootboek.
5. Saldi en reserveringen.
6. Platformfee en primaire opbrengst.

Een materieel onverklaard verschil blokkeert de betrokken geldhandelingen.

Een beheerder kan een verschil niet alleen wegklikken.

### Productiegates

| Gate | Vereist bewijs |
|---|---|
| Juridisch | Beoordeling van exact product, klantlanden en benodigde toelating |
| Contracten | Definitieve kaartvoorwaarden, privacy en relevante overeenkomsten |
| Betalen | Schriftelijke provideracceptatie en geverifieerde geldstromen |
| Data | Commerciële rechten voor data en afgeleide waardes |
| Beeld | Rechten voor daadwerkelijk gebruikte foto’s en merken |
| Waardering | Gevalideerde en goedgekeurde modelversie |
| Techniek | Geslaagde kern-, concurrentie- en hersteltests |
| Security | Opgeloste kritieke en hoge reviewbevindingen |
| Operations | Eigenaren, klachtenpad, incidentproces en afwikkelingsplan |

Een aangevinkte clientinstelling is geen gatebewijs.

De server controleert de vereiste gates. Geldige configuratie én bevoegde vrijgave zijn nodig.

### Uitrol

Volgorde:

1. Lokale demo.
2. Afgeschermde ontwikkelomgeving.
3. Integratiesandbox.
4. Afgeschermde cashpilot na gates.
5. Beperkte productie.
6. Verbreding op gemeten resultaten.

Een technisch geslaagde demo wordt niet als cashklaar beschreven.

---

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

## 12. Beslisregister, afhankelijkheden en referenties

### Besloten productuitgangspunten

| ID | Besluit |
|---|---|
| D-01 | Marktplaats met echt geld als eindproduct |
| D-02 | Eigen euroreferentie naast werkelijke handelsprijzen |
| D-03 | Zes hoogste divisies in de catalogus |
| D-04 | Alle teams en beschikbare eerste-selecties importeren |
| D-05 | Gefaseerde uitgifte en toelating van handelsmarkten |
| D-06 | Maximaal 500 per speler per seizoen |
| D-07 | Willekeurige toewijzing bij overinschrijving |
| D-08 | 5% commissie voor de secundaire verkoper |
| D-09 | Goedgekeurde tradingstijl voor V1 |
| D-10 | Eén samenhangende applicatie met klantomgeving, beheer en automatische verwerking |

### Ingevulde werkaannames

| ID | Aanname |
|---|---|
| A-01 | Start met Nederlandse volwassen klanten |
| A-02 | Eerste cashpilot opent 120 markten |
| A-03 | Eerste volledige uitgifteprogramma plant 200 kaarten per speler |
| A-04 | Platformseizoen juli-juni |
| A-05 | Wekelijkse prijsrun maandag 18.00 uur |
| A-06 | Dinsdag inschrijven van 09.00 tot 21.00 uur |
| A-07 | Eén kaart per persoon in eerste ronde |
| A-08 | De beschreven positie-, prijs- en orderduurlimieten |
| A-09 | Cumulatieve commissieafronding per verkooporder |
| A-10 | Eén externe settlement tegelijk per spelersmarkt in V1 |
| A-11 | Initialen als standaardbeeld |
| A-12 | De voorgestelde TypeScript/PostgreSQL-stack |

Deze aannames zijn geen reden om de ontwikkeling te pauzeren. Ze worden configureerbaar en getest uitgewerkt.

### Open afhankelijkheden

| ID | Nog nodig | Ontwikkeling kan doorgaan met |
|---|---|---|
| O-01 | Definitieve juridische kwalificatie | Afgeschermde demo en sandbox |
| O-02 | Geaccepteerde betaalpartner | Payment simulator en capabilitycontract |
| O-03 | Definitieve datalicenties | Fictieve fixtureprovider |
| O-04 | Externe transferwaardebron | Geversioneerde voorbeeldinput |
| O-05 | Gevalideerde euroformule | Expliciet demomodel |
| O-06 | Identiteitsprovidercontract | Testtenant |
| O-07 | Definitieve kaart- en consumentenvoorwaarden | Versiebeheer en acceptatie-interface |
| O-08 | Fiscale inrichting | Afzonderlijke bruto-clearing en configureerbare rapportage |
| O-09 | Merk, domein en entiteit | Werknaam en lokale configuratie |

De vraag of 500 per seizoen commercieel goed werkt wordt later met vraag- en handelsgegevens geëvalueerd. Claude verandert de oplage niet zelfstandig.

### Visuele referenties

Gebruik deze goedgekeurde richting en vervolgschermen:

- [Tradingplatform](https://chatgpt.com/library?file_id=libfile_03be5a00027481919f709f1fcb196139&account_id=personal)
- [Spelersdetail](https://chatgpt.com/library?file_id=libfile_e9a27653977881918329af24a7547b05&account_id=personal)
- [Portefeuille](https://chatgpt.com/library?file_id=libfile_31915a13682c81918c6d0c6f93947e7b&account_id=personal)
- [Uitgiftes](https://chatgpt.com/library?file_id=libfile_34de0a335b208191a122b2a5d240c186&account_id=personal)
- [Orderflow](https://chatgpt.com/library?file_id=libfile_c55bee76c32c8191bcd6301d1cca1386&account_id=personal)

Als Claude deze links niet kan openen, moeten de afbeeldingen als projectbijlagen worden toegevoegd. Een ontbrekende afbeelding verandert de geschreven bedrijfsregels niet.

### Technische bronnen

Geraadpleegd op 5 november 2026.

- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL data consistency](https://www.postgresql.org/docs/current/applevel-consistency.html)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [Auth.js](https://authjs.dev/getting-started)
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [Playwright assertions](https://playwright.dev/docs/test-assertions)
- [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [Claude Code project instructions](https://code.claude.com/docs/en/settings)

Deze documentatie ondersteunt de technische inrichting. Productregels en drempels zijn keuzes uit dit dossier.

---

## 13. Permanente instructies voor Claude

Neem de onderstaande instructies compact over in `CLAUDE.md`.

### Projectopdracht

Je bouwt Player Exchange volgens de projectdocumentatie.

Het eindproduct is een echte geldmarktplaats voor digitale voetballerskaarten. De eerste uitvoering gebruikt demo- en sandboxadapters zolang productievoorwaarden ontbreken.

Lees vóór iedere fase:

- Dit projectbestand.
- De betreffende specificaties.
- `docs/12-decisions.md`.
- `docs/STATUS.md`.

### Productregels

- Bewaar het onderscheid tussen catalogus, primaire uitgifte en secundaire handel.
- Gebruik één identiteit per speler.
- Houd kaarten uniek en ondeelbaar.
- Respecteer de cap van 500 per speler per platformseizoen.
- Gebruik alleen gepubliceerde referentiewaardes in de publieke interface.
- Bestaande limietorders veranderen niet door een nieuwe referentieprijs.
- Bereken commissie volgens de vastgelegde cumulatieve afronding.
- Controleer geld, bezit, limieten en bevoegdheden server-side.

### Technische regels

- Gebruik gedeelde domeinservices.
- Bescherm geld en bezit met databasetransacties en constraints.
- Bewaar externe operaties en herstelstatus duurzaam.
- Gebruik inbox/outbox en stabiele idempotency-keys.
- Ondersteun dubbele en te late externe events.
- Behandel een onbekende betaaluitkomst als pending.
- Maak geen eigen authenticatieprotocol of cryptografisch algoritme.
- Gebruik externe documentatie voor actuele leveranciersdetails.

### Scope

- Volg de goedgekeurde huisstijl.
- Werk eerst de huidige fase volledig af.
- Voeg geen nieuwe commerciële functies toe zonder productbesluit.
- Wijzig geen prijs-, oplage-, recht- of geldstroomregels om een implementatie eenvoudiger te maken.
- Documenteer noodzakelijke architectuurwijzigingen als ADR.
- Houd demo en productie strikt gescheiden.

### Oplevering

- Lever werkende code via de normale gebruikersroutes.
- Schrijf betekenisvolle tests voor geld, eigendom, concurrency en herstel.
- Voer de controles uit en rapporteer alleen wat werkelijk is getest.
- Werk de projectstatus bij.
- Meld open afhankelijkheden precies.
- Noem een demo nooit productiegeschikt zolang livevoorwaarden ontbreken.

---

## 14. Startopdracht om aan Claude te geven

Gebruik het volgende als eerste bouwopdracht nadat dit dossier en de wireframes als projectcontext zijn toegevoegd.

> Bouw Player Exchange op basis van het volledige meegeleverde PRD en bouwdossier.
>
> Begin met fase 0 en fase 1.
>
> Maak eerst de beschreven documentstructuur, het beslisregister en de permanente projectinstructies. Controleer het dossier op technische tegenstrijdigheden. Los routinekeuzes op binnen de vastgelegde regels en registreer je keuze.
>
> Zet daarna de applicatie op met één codebase voor klantomgeving, beheer, gedeelde backend en worker. Leg actuele stabiele dependencyversies vast.
>
> Bouw de goedgekeurde handelsinterface met fictieve fixtures, werkende navigatie en alle beschreven schermtoestanden. Gebruik de zes competities, volledige demo-catalogus en duidelijk gemarkeerde voorbeeldgegevens.
>
> Laat de markt, spelerspagina, portefeuille, uitgiftes en ordercontrole op elkaar aansluiten. De kaartenvoorraad hoort bij de speler. De portefeuille toont afzonderlijk spelersaantal en kaartenaantal. Iedere order heeft vóór plaatsing een controlevenster.
>
> Richt de code zo in dat de beschreven database, handelsdiensten, betaling- en dataproviders in de volgende fasen kunnen worden aangesloten. Plaats productieregels in gedeelde services en valideer requests op de server.
>
> Gebruik geen echte betaalgegevens en maak geen productiebetaling mogelijk zolang de productiegates ontbreken.
>
> Lever na fase 0 en fase 1 een startinstructie, werkende demo, uitgevoerde controles en een bijgewerkte `docs/STATUS.md` op. Benoem welke onderdelen alleen demo zijn en welke volgende fase aansluit.
>
> Maak geen aannames over een definitieve waarderingsformule, geaccepteerde betaalpartner of beschikbare datalicenties. Gebruik de daarvoor beschreven adapters en testvoorzieningen.

Einde bouwdossier V1.