# Product requirements

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

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
