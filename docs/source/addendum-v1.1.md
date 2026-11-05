
# Addendum bouwdossier V1.1

Datum 5 november 2026. Dit addendum wijzigt uitsluitend de onderstaande onderdelen. Bestaande IDs blijven behouden.

## 2. Verduidelijking van de twee bekende wireframefouten

De twee fouten waar **fase 1** naar verwijst zijn:

| ID | Scherm en fout | Vereiste correctie |
|---|---|---|
| WF-01 | **UX-03 Portefeuille.** Het voorbeeld toont “Mijn kaarten (3)”, terwijl de gebruiker drie spelersposities met respectievelijk drie, twee en één kaart heeft. | Toon **“3 spelers · 6 kaarten”**. Tel unieke spelers en individuele kaarten afzonderlijk, ook op mobiel. |
| WF-02 | **UX-02 Spelersdetail.** De knop in het handelsvenster heet “Kooporder plaatsen” en suggereert directe plaatsing zonder de afgesproken controle. | De knop wordt **“Controleer kooporder”**. Deze opent UX-06 met de serverberekende preview. Alleen in het controlevenster staat **“Kooporder plaatsen”**. Pas dezelfde volgorde toe op verkoop. |

Claude’s vermoeden over het door elkaar tellen van spelers en kaarten is correct. De andere bedoelde fout betreft de ontbrekende ordercontrole.

**Eerdere voorraadfout.** In het oorspronkelijke marktoverzicht stonden spelergebonden voorraadcijfers boven de algemene markt. Dit was een afzonderlijke, eerder vastgestelde fout. De correctie blijft vereist onder UX-02. Voorraadcijfers horen uitsluitend bij een duidelijk geïdentificeerde speler. Het vervolgwireframe toont daarvoor het blok “Voorraad Noah Vermeer”.

## 3. Bevestigingen en aanvullingen

### BR-14 — Orderduur

Bevestigd. V1 kent precies drie vaste keuzes:

- Eén dag.
- Zeven dagen.
- Dertig dagen.

Vrije invoer is niet beschikbaar. Eén dag betekent 24 verstreken uren vanaf serveracceptatie. Bereken `expiresAt` met respectievelijk 24, 168 of 720 uur. Bewaar het resultaat in UTC. De bestaande annulering- en settlementregels blijven gelden.

### BR-02 — Platformseizoen

Bevestigd. Het seizoen is een halfopen interval:

**Vanaf 1 juli 00.00 uur in `Europe/Amsterdam`, tot exclusief 1 juli 00.00 uur van het volgende jaar in dezelfde tijdzone.**

Converteer beide grenzen afzonderlijk naar UTC. Bepaal de seizoenssleutel volgens deze lokale grenzen. Een tijdstip exact op de nieuwe begingrens hoort bij het nieuwe seizoen.

### Demo-authenticatie — aanvulling op hoofdstuk 04 en AT-35

Bevestigd. In `demo` mag een lokale testlogin worden gebruikt zonder externe OIDC-provider.

Voorwaarden:

- Alleen vooraf ingestelde fictieve testaccounts.
- Authenticatie loopt via de server.
- De browser kan geen eigen gebruiker-ID, rol of verificatiestatus aanwijzen.
- Lokale testlogin is hard geblokkeerd in productiedeployments, ongeacht meegestuurde parameters.
- Productieconfiguratie die testlogin probeert te activeren faalt bij startup.
- Testlogin verleent nooit toegang tot echte betalingen of productiegegevens.

OIDC blijft de beoogde authenticatieroute voor productie. AT-35 omvat voortaan ook deze testlogin.

### Monorepo-tooling — aanvulling op hoofdstuk 04

Bevestigd. Gebruik **pnpm workspaces met Turborepo**.

Registreer dit als **A-13**. Gebruik één lockfile. Configureer afhankelijkheden tussen build-, typecheck- en testtaken. Databasewijzigingen, seeds en externe mutaties zijn expliciete taken die niet vanuit de taakcache opnieuw als uitgevoerd mogen worden beschouwd.

## 4. Productiegate voor spelersnamen en persoonlijkheidsrechten

### Aanvulling op hoofdstuk 10 — nieuwe gate “Spelersidentiteit”

Vereist vóór commercieel productiegebruik van echte spelers:

**Een gedocumenteerde juridische beoordeling van het gebruik van spelersnamen en andere identificerende persoonlijkheidskenmerken op kaarten, profielen, handelsaanbiedingen en marketing. Waar toestemming of licenties nodig zijn, moeten deze aantoonbaar zijn verkregen.**

De beoordeling en eventuele overeenkomsten specificeren:

- Gedekte spelers en territoria.
- Toegestane productvorm, inclusief verhandelbare digitale kaarten.
- Marketinggebruik.
- Looptijd, uitzonderingen en beëindigingsgevolgen.
- Behandeling van reeds verkochte kaarten bij rechtenverlies.

Een statistieklicentie of toestemming voor een foto wordt niet automatisch als dekking voor deze toepassingen aangemerkt. Toon echte spelersnamen pas nadat het toepasselijke gebruik is vrijgegeven.

Collectieve licentiëring via FIFPRO, nationale spelersorganisaties of andere bevoegde rechthebbenden is een te onderzoeken route. Dekking van alle spelers en dit specifieke product moet worden bevestigd. FIFPRO biedt collectieve overeenkomsten voor naam, beeld en gelijkenis aan.

### Aanvulling beslisregister

| ID | Nog nodig | Ontwikkeling kan doorgaan met |
|---|---|---|
| O-10 | Juridische beoordeling en waar vereist licenties voor commerciële spelersnamen en persoonlijkheidskenmerken, inclusief aantoonbare product- en territoriumdekking | Fictieve spelers in demo en sandbox, met dezelfde datastructuren en koppelingen |

### Aanvullende acceptatiecriteria

| ID | Verwachte uitkomst |
|---|---|
| AT-36 | De correcties WF-01 en WF-02 werken op desktop en mobiel. |
| AT-37 | Alleen de drie vaste orderduren worden geaccepteerd. |
| AT-38 | Seizoensgrenzen werken correct in `Europe/Amsterdam`, inclusief het exacte overgangstijdstip. |
| AT-39 | Productiegebruik van een echte spelersidentiteit is geblokkeerd zolang de toepasselijke rechtenvrijgave ontbreekt. |