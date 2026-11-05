# Acceptatie

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

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


---

## Addendum V1.1 (5 november 2026)

_Overgenomen uit `docs/source/addendum-v1.1.md`. Bij tegenstrijdigheid gaat dit addendum vóór de tekst hierboven._

#### Aanvullende acceptatiecriteria

| ID | Verwachte uitkomst |
|---|---|
| AT-36 | De correcties WF-01 en WF-02 werken op desktop en mobiel. |
| AT-37 | Alleen de drie vaste orderduren worden geaccepteerd. |
| AT-38 | Seizoensgrenzen werken correct in `Europe/Amsterdam`, inclusief het exacte overgangstijdstip. |
| AT-39 | Productiegebruik van een echte spelersidentiteit is geblokkeerd zolang de toepasselijke rechtenvrijgave ontbreekt. |
