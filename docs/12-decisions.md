# Besluiten, aannames en afhankelijkheden

_Bron: bouwdossier V1.0 hoofdstuk 12 en addendum V1.1. Nieuwe routinekeuzes van de bouwpartner staan onder "R". Vragen aan de producteigenaar staan onder "V". Voorrangsregel: latere expliciete besluiten van de producteigenaar → dossier → wireframes → eerder plan → voorstellen bouwpartner._

## Besloten productuitgangspunten

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

## Werkaannames

| ID | Aanname | Waar vastgelegd |
|---|---|---|
| A-01 | Start met Nederlandse volwassen klanten | Toelatingsbeleid (fase 2) |
| A-02 | Eerste cashpilot opent 120 markten | Seed-data, geen technische limiet |
| A-03 | Eerste volledige uitgifteprogramma: 20 + 36 × 5 = 200 kaarten per speler | `inventory.ts → defaultProgramme()` |
| A-04 | Platformseizoen juli–juni (halfopen, Europe/Amsterdam) | `season.ts`, `editions.season_key` |
| A-05 | Wekelijkse prijsrun maandag 18.00 uur | Workerplanning (fase 7) |
| A-06 | Dinsdag inschrijven 09.00–21.00 uur | Dropplanning (fase 6) |
| A-07 | Eén kaart per persoon in eerste ronde | `drops` CHECK (`round = 1 → max_per_user = 1`) |
| A-08 | Positie-, prijs- en orderduurlimieten | `position-limit.ts`, `order-rules.ts`, `orders` CHECKs |
| A-09 | Cumulatieve commissieafronding per verkooporder | `commission.ts`, `orders.settled_gross_cents / booked_commission_cents` |
| A-10 | Eén externe settlement tegelijk per spelersmarkt | Unieke partiële index `executions_one_inflight_per_market` |
| A-11 | Initialen als standaardbeeld | UI (fase 1) |
| A-12 | TypeScript/PostgreSQL-stack | `docs/adr/0001-stack.md` |
| A-13 | pnpm workspaces met Turborepo, één lockfile; db-migraties, seeds en externe mutaties nooit uit cache | `turbo.json` (`cache: false` voor die taken) |

Deze aannames zijn geen reden om de ontwikkeling te pauzeren. Ze zijn configureerbaar en getest uitgewerkt.

## Open afhankelijkheden

| ID | Nog nodig | Ontwikkeling kan doorgaan met |
|---|---|---|
| O-01 | Definitieve juridische kwalificatie | Afgeschermde demo en sandbox |
| O-02 | Geaccepteerde betaalpartner | Payment simulator en capabilitycontract |
| O-03 | Definitieve datalicenties | Fictieve fixtureprovider |
| O-04 | Externe transferwaardebron | Geversioneerde voorbeeldinput |
| O-05 | Gevalideerde euroformule | Expliciet demomodel |
| O-06 | Identiteitsprovidercontract | Testtenant / lokale demologin |
| O-07 | Definitieve kaart- en consumentenvoorwaarden | Versiebeheer en acceptatie-interface |
| O-08 | Fiscale inrichting | Afzonderlijke bruto-clearing en configureerbare rapportage |
| O-09 | Merk, domein en entiteit | Werknaam en lokale configuratie |
| O-10 | Juridische beoordeling en waar vereist licenties voor spelersnamen en persoonlijkheidskenmerken, met product- en territoriumdekking | Fictieve spelers in demo en sandbox (`players.is_fictional`, `identity_rights_released`) |

De vraag of 500 per seizoen commercieel goed werkt wordt later geëvalueerd met vraag- en handelsgegevens. Claude verandert de oplage niet zelfstandig.

## Routinekeuzes van de bouwpartner (R)

Gemaakt binnen de vastgelegde regels. De producteigenaar kan ieder punt overrulen.

| ID | Keuze | Reden |
|---|---|---|
| R-01 | Alle planningstijden (prijsrun, dropvensters, publicatie) gelden in `Europe/Amsterdam` en worden als UTC opgeslagen. | BR-08 noemt deze zone expliciet; BR-09 noemt geen zone. Eén zone voorkomt verschuivingen. |
| R-02 | Positielimiet rekent met "In omloop": alle definitief geleverde kaarten van de speler over alle seizoenen. | BR-18 zegt "cumulatief uitgegeven aantal"; platformvoorraad is niet uitgegeven aan klanten. |
| R-03 | "Som van beschikbare referentiewaardes" (UX-03) = som over kaarten van spelers mét gepubliceerde referentie. Kaarten zonder referentie worden apart gemeld, nooit als €0 meegeteld. | UX-regel "ontbrekend bedrag wordt nooit €0,00". |
| R-04 | Zelfkruising (BR-17): een nieuwe order wordt afgewezen als hij een eigen tegengestelde open order van dezelfde gebruiker of belanghebbende zou raken. Niet-kruisende eigen orders aan beide kanten zijn toegestaan. | Letterlijke lezing van BR-17. |
| R-05 | Uitvoeringsprijs = limiet van de order met de laagste servervolgorde. | BR-15 "bestaande order"; bij wachtende matcher (A-10) is de oudste de bestaande. |
| R-06 | A-10 (één settlement tegelijk per markt) geldt voor secundaire executions. Primaire toewijzingen hebben een eigen afwikkelrij per drop. | Hoofdstuk 03 BR-21 staat onder secundaire handel. |
| R-07 | Toewijzingsalgoritme `alloc-v1`: commitment = SHA-256(seed); rangsleutel = HMAC-SHA256(seed, versie‖dropId‖deelnemersdigest‖subscriptionId); oplopend sorteren. | Standaardprimitieven uit `node:crypto`, geen eigen cryptografie. |
| R-08 | Commissie half-omhoog in gehele getallen: `floor((bruto × bps + 5000) / 10000)`. | Exact, zonder floating point. |
| R-09 | Gemiddelde aankoopprijs in de portefeuille wordt voor weergave half-omhoog op centen afgerond; totalen blijven exact. | Weergave; geen financieel effect. |
| R-10 | Databaseconstraints in handgeschreven SQL-migraties; Drizzle-schema volgt het SQL-schema. | `docs/adr/0002-database-migrations.md`. |
| R-11 | Tests draaien op Vitest met `node:assert/strict`; de domeinlaag blijft zonder buildstap uitvoerbaar in Node.js. | `docs/adr/0003-interim-test-runner.md` (afgesloten). |
| R-12 | Extra foutcodes naast de API-lijst: `QUANTITY_INVALID`, `TIME_IN_FORCE_INVALID`, `SELF_TRADE_REJECTED`, `EDITION_CAP_EXCEEDED`, `INVARIANT_VIOLATION`. | Nodig voor AT-37, BR-17 en de cap. |
| R-13 | Gefaalde fill: kaart terug naar "open" alleen als de order nog actief en toegelaten is; anders telt hij als geannuleerd. | Hoofdstuk 07 "Definitieve mislukking", AT-20. |
| R-14 | Eerste ronde (`round = 1`) dwingt `max_per_user = 1` af in de database; tweede ronde staat maximaal 3 toe. | A-07, BR-13. |
| R-15 | Demodata gebruikt datums in seizoen 2026-2027 in plaats van de 2025-datums uit de wireframes. | Consistent met het huidige platformseizoen. |
| R-16 | Spelersdetail op mobiel toont snelknoppen "Kopen" en "Verkopen" onder de prijzen die naar het handelspaneel springen; het paneel zelf blijft onderaan. | Volgt de mobiele wireframe; de controle-eerst-volgorde (WF-02) blijft gelijk. |
| R-17 | In de markttabel wordt een onbekende wijziging getoond als "—" met schermlezertekst "Niet beschikbaar"; onbekende prijzen blijven voluit "Niet beschikbaar". | Ruimte in de tabel bij open handelspaneel; de wijziging is geen prijs. |
| R-18 | TypeScript 5.9.3 in plaats van 7.0.2, Auth.js 5.0.0-beta.32 exact vastgepind, Playwright 1.64.1. | `docs/adr/0001-stack.md`. |

## Consistentiecontrole dossier V1.0 + addendum V1.1

Uitgevoerd op 5 november 2026. Rekenvoorbeelden nagerekend en als geautomatiseerde test vastgelegd:

- Geldvoorbeeld (hoofdstuk 09): €100 → €87,60 → €87,80 → €94,00. Klopt.
- Commissievoorbeeld: €0,03 + €0,02 = €0,05, netto €0,95. Klopt.
- Secundaire verkoop €20 → €19 / €1. Klopt.
- Wireframe-portefeuille: €30,60 aankoopwaarde en €33,00 referentiewaarde. Klopt.
- Programma 20 + 36 × 5 = 200. Klopt.

Gevonden afwijkingen, met de toegepaste oplossing:

| # | Waar | Afwijking | Oplossing |
|---|---|---|---|
| C-01 | Wireframe spelersdetail | "Bijgewerkt na speelronde" botst met BR-08 (gepubliceerde run, maandag 18.00). | Toon publicatietijdstip en modelversie. |
| C-02 | Wireframe spelersdetail | Voorraadblok mist "Verkocht dit seizoen" (UX-02). | Toegevoegd. |
| C-03 | Wireframe orderflow | Orderduur ontbreekt in koop- en verkoopformulier (UX-06/07). | Keuzeveld 1/7/30 dagen toegevoegd. |
| C-04 | Wireframe orderflow | Verkoopcontrole toont geen kaart-ID's en geen afrondingsnotitie (UX-07). | Toegevoegd. |
| C-05 | Wireframe orderflow | Statussen missen "In afwikkeling" en "Verlopen" (BR-21, UX-08). | Toegevoegd. |
| C-06 | Wireframe portefeuille | WF-01 (telling), ontbrekende kolommen beschikbaar/gereserveerd, blok "in afwikkeling", "per kaart" bij Hoogste bod. | Volgens UX-03. |
| C-07 | Wireframe uitgiftes | Tekst noemt de reservering bij inschrijving niet (BR-10). | Tekst aangepast. |
| C-08 | BR-09 vs PRD-06/UX-04 | Prijs wordt donderdag gepubliceerd, maar "definitief vastgelegd" op dinsdag 09.00. Onduidelijk of de prijs tussendoor mag wijzigen. | Open vraag V-01. Datamodel ondersteunt beide (`drops.price_fixed_at`). |
| C-09 | Wireframes | Markt-overzicht (UX-01) ontbreekt. | Gebouwd volgens UX-01 in dezelfde stijl. Open vraag V-02. |

Geen tegenstrijdigheden gevonden in de geld-, eigendoms- of afwikkelregels.

## Vragen aan de producteigenaar (V)

| ID | Vraag | Tijdelijke werkwijze |
|---|---|---|
| V-01 | Mag de dropprijs tussen publicatie (donderdag 18.00) en vastlegging (dinsdag 09.00) nog wijzigen, bijvoorbeeld door de maandagrun? Zo ja: alleen omlaag, of in beide richtingen? | Demo toont de prijs als vast vanaf publicatie (strengste lezing van PRD-06). |
| V-02 | Is er een wireframe van het marktoverzicht (UX-01)? | Gebouwd volgens UX-01. |

## Visuele referenties

Opgeslagen in `docs/wireframes/` (wireframes v04, fictieve spelers):

- `01-spelersdetail.png`
- `02-uitgiftes.png`
- `03-portefeuille.png`
- `04-orderflow.png`

Het tradingplatform-/marktoverzicht ontbreekt (V-02).

## Technische bronnen

Geraadpleegd door de producteigenaar op 5 november 2026 (zie `docs/source/bouwdossier-v1.0.md`, hoofdstuk 12). Exacte dependencyversies worden vastgelegd in de lockfile zodra pakketten installeerbaar zijn.
