# Dossiergebruik en startopdracht

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

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
