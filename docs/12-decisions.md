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
| A-14 | Storten €5–€2.500 per keer, maximaal 3 onafgeronde stortingen tegelijk; opnemen €1–€5.000 en nooit meer dan beschikbaar | `packages/domain/src/payments.ts` (`DEFAULT_PAYMENT_LIMITS`); bevestigd door de producteigenaar op 5 november 2026; kan per betaalpartner worden bijgesteld (O-02) |

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
| R-19 | Catalogusimports gebruiken de database als wachtrij (`import_runs` met `SKIP LOCKED` en heartbeat) in plaats van BullMQ. | `docs/adr/0004-database-queue-for-imports.md`. |
| R-20 | Hervatten gebeurt per stap (competitielijst, teams per competitie, selectie per team). Een onderbroken stap begint opnieuw bij pagina 1. | Alleen een volledige selectie mag vertrokken spelers afsluiten; daarvoor moet de hele stap gezien zijn. |
| R-21 | Een speler in de volledige of gedeeltelijke selectie van een andere club telt als transfer: zelfde speler-ID en markt, oud eerste-elftallidmaatschap afgesloten. Een speler die ontbreekt in een *volledige* selectie verliest alleen zijn lidmaatschap. Profielen worden nooit verwijderd. | BR-01, docs/07 importproces, AT-03/AT-04. |
| R-22 | Een nieuw extern ID met dezelfde naam en geboortedatum als een bestaand profiel gaat in quarantaine (`CONFLICTING_MATCH`). Er wordt nooit automatisch samengevoegd of dubbel aangemaakt. | BR-01 "dubbele of conflicterende matches in quarantaine". |
| R-23 | Een geïmporteerd profiel krijgt altijd een markt met status `PROFILE_ONLY` en primaire toelating `INELIGIBLE`. | docs/01: importeren geeft geen toestemming voor uitgifte. |
| R-24 | Ruwe importpagina's worden 90 dagen bewaard (`import_snapshots.retain_until`). | Werkaanname tot de datalicentie de bewaartermijn bepaalt (O-03). |
| R-25 | Toelating per handeling (BR-07): verificatie en leeftijd voor alle geldhandelingen; land en voorwaarden alleen voor handelingen die geld of positie toevoegen (handelen, inschrijven, storten); opnemen en annuleren blijven mogelijk. Handelsstop blokkeert alleen handelen; volledige stop alles behalve annuleren; een opgeschort account kan alleen opnemen en annuleren. In productie zijn geldhandelingen geblokkeerd zolang een productiegate open staat. | BR-07 voorbeeld en PRD-15. |
| R-26 | Toegelaten woonlanden staan in `admitted_countries` (start: NL, A-01). Voorwaarden staan in `terms_documents`; de huidige versies zijn placeholders (`demo-0`) tot O-07. | Configureerbaar zonder codewijziging. |
| R-27 | De publieke catalogus-API toont leeftijd, nooit geboortedatum, en niets over gebruikers. | Privacy; acceptatiecriterium fase 2. |
| R-28 | De markt-, speler-, portefeuille- en uitgiftepagina's lezen in fase 2 nog uit de demowereld (met dezelfde ID's als de database). Ze schakelen over naar PostgreSQL zodra voorraad (fase 3) en orderboek (fase 5) in de database staan. De catalogus-API en het beheer lezen al uit PostgreSQL. | Eén bron per scherm; geen half gevulde schermen. |
| R-29 | Een eerste OIDC-login maakt de gebruiker aan (onderwerp `issuer|sub`); nieuwe gebruikers starten ongeverifieerd. | docs/04, BR-07. |
| R-30 | Een kaart verandert alleen van eigenaar samen met een eigendomsevent; de database controleert dat bij commit. De demo-seed legt bestaand bezit vast als `OPENING_BALANCE` met referentie. | docs/09 invariant "definitieve eigendom heeft een gekoppelde afwikkeling"; een openingsbalans is de expliciete uitzondering voor bezit van vóór het platform (demo of migratie). |
| R-31 | Publiceren van een uitgifteprogramma gaat via een vier-ogengoedkeuring die eenmalig wordt verbruikt. Wijzigt het concept na goedkeuring, dan vervalt de goedkeuring. Een nieuwe versie vervangt de vorige (`SUPERSEDED`). | docs/10 gevoelige acties, BR-04, AT-34. |
| R-32 | Een programma mag niet worden verhoogd en niet zakken onder het hoogste al gemaakte kaartnummer. | BR-04, BR-03. |
| R-33 | Kaarten worden aangemaakt (`mintCards`) binnen het gepubliceerde programma met een lock op de editie; dat gebeurt per drop in fase 6. | Gelijktijdigheidstest: 15 parallelle pogingen geven precies 50 unieke nummers. |
| R-34 | Toelating tot primaire uitgifte vereist: actief, 18+, voldoende data en (voor echte spelers) vrijgegeven identiteitsrechten (O-10). Marktstatus open of pre-launch vereist toelating of kaarten in omloop; een markt met kaarten kan niet terug naar alleen profiel. | docs/01, BR-06, BR-22, addendum V1.1 gate "Spelersidentiteit". |
| R-35 | Quarantaine: een identiteitsconflict wordt gekoppeld aan een kandidaat of als nieuw profiel aangemaakt; andere problemen kunnen worden genegeerd. Altijd met reden en audit. | BR-01. |
| R-36 | Schermen lezen in fase 3 spelers, status, referentie, voorraad, kaartbezit, reserveringen en eigen orders uit PostgreSQL. Orderboek, laatste transactie, saldo, transacties en uitgiftes blijven tot hun fase uit de demowereld (vervangt R-28). | Eén bron per gegeven; zichtbaar in `apps/web/src/server/world.ts`. |
| R-37 | Een domeinfout kan een specifieke Nederlandse melding meegeven (`details.userMessage`); beheer toont die, de API houdt de generieke foutcode en melding. | Beheerders moeten zien waarom iets wordt geweigerd. |
| R-38 | Grootboek, betaalstromen, reconciliatie en simulator volgens ADR 0005. Saldo op alle schermen komt vanaf fase 4 uit het grootboek (vervangt het saldo-deel van R-36). | docs/04, docs/07, docs/09. |
| R-39 | Een webhook is alleen een melding: na controle van de handtekening en opslag in de inbox vraagt het platform de status op bij de betaalpartner (fetch-on-notify). | Maakt dubbele, late en omgekeerde berichten onschadelijk (AT-10, AT-22). |
| R-40 | Een betaalmethode met vertraagde zekerheid boekt eerst op ‘Nog niet beschikbaar’; pas de definitieve bevestiging maakt het besteedbaar. Een mislukking daarna boekt het terug. | docs/07 Deposits. |
| R-41 | Een materieel reconciliatieverschil blokkeert opnames (van die gebruiker, of van iedereen als niemand aan te wijzen is) en sluit alleen met voorstel + goedkeuring door een tweede persoon. Een waarschuwing blokkeert niets en sluit vanzelf. | docs/06 `RECONCILIATION_HOLD`, docs/10 "niet alleen wegklikken". |
| R-42 | Een betaalpagina die niemand afrondt, verloopt na een uur bij de betaalpartner; de storting wordt dan ‘mislukt (verlopen)’ zonder boeking. | Voorkomt dat onafgeronde stortingen de limiet van A-14 blijvend vullen. |
| R-43 | Nieuwe foutcodes `AMOUNT_INVALID` en `PAYMENT_ACCOUNT_MISSING`. | Aanvulling op de foutcatalogus (docs/06). |
| R-44 | Demo-openingssaldi zijn vastgelegd als bevestigde storting met een operatie bij de betaalsimulator, zodat de reconciliatie vanaf de start aansluit. | Seed. |
| R-45 | Een orderpreview wordt server-side bewaard (60 seconden geldig, eenmalig te gebruiken). Plaatsen verwijst naar die preview; de server controleert alles opnieuw onder locks. Dezelfde Idempotency-Key geeft dezelfde order terug. | docs/06 "Orderpreview", AT-08. |
| R-46 | Het orderboek en de laatste transactie komen uit de database. Zolang een speler nog geen echte transactie heeft, toont de demo de laatste koers uit de demowereld. | Demo blijft gevuld; vervalt vanzelf bij de eerste echte transactie (vervangt het orderboekdeel van R-36). |
| R-47 | De demo-seed vult het orderboek met orders van een fictieve verzamelaar (met echte kaart- en geldreserveringen). Niveaus die een eigen order van Anna zouden kruisen, worden weggelaten; een kruisend boek kan niet blijven staan. Ordertijden zijn relatief aan het seedmoment. | Wireframe-cijfers blijven zichtbaar zonder dat het boek op een vaste datum verloopt. |
| R-48 | De commissie van een uitvoering wordt bij de match vastgesteld uit de cumulatieve stand van de verkooporder en pas bij definitieve afwikkeling geboekt. Omdat per markt maar één afwikkeling tegelijk loopt, kan de stand daartussen niet veranderen. | BR-20, BR-21; de betaalpartner krijgt bruto, netto en fee vooraf. |
| R-49 | Na een definitief mislukte afwikkeling krijgen nog lopende orders hun deel terug met hun oorspronkelijke prioriteit; een geannuleerde of verlopen order niet. De matcher stopt dan voor die markt tot de volgende workercyclus (geen directe herhaling). | docs/07 "Definitieve mislukking", AT-23. |
| R-50 | Een prijswijziging van een order = annuleren van het restant en een nieuwe order met nieuwe tijdprioriteit; er is geen aparte wijzigknop. | BR-14. |
| R-51 | Een uitgifte wordt als concept vastgelegd en gepubliceerd na goedkeuring door een tweede persoon. Bij publicatie worden de kaarten binnen het programma aangemaakt (`IN_DROP`) en ligt de commitment van de trekking vast. Een prijswijziging tussen publicatie en opening (beide richtingen, V-01a) vraagt ook goedkeuring; de goedkeuring noemt de oude prijs, zodat een tussentijdse wijziging hem ongeldig maakt. Bij opening staat de prijs vast (databaseregel). | docs/10 gevoelige acties, BR-09, AT-34. |
| R-52 | De seed van de trekking wordt versleuteld bewaard met AES-256-GCM; de sleutel komt uit `DROP_SEED_KEY`. De demosleutel wordt in productie geweigerd. Na de trekking wordt de seed vrijgegeven, zodat iedereen de rangorde kan narekenen. | BR-11; standaardprimitieven, geen eigen cryptografie. |
| R-53 | De snapshot bewaart deelnemers én rangorde. Een herhaling en een wachtlijstpromotie gebruiken die vaste rangorde. Wachtlijstreserveringen blijven staan tot alle toewijzingen definitief zijn of de wachttijd (24 uur) voorbij is, en worden dan vrijgegeven. | BR-11, BR-12, AT-24, AT-27. |
| R-54 | Na afmelden kan iemand zich voor dezelfde uitgifte niet opnieuw inschrijven (één inschrijving per persoon per uitgifte). | Eenvoud V1; voorkomt herhaald reserveren en vrijgeven. |
| R-55 | In de demo kan beheer de planning van een uitgifte verschuiven ("nu openen", "nu sluiten en toewijzen"), zodat testers niet tot dinsdag hoeven te wachten. Deze knoppen bestaan alleen in demo-modus en worden gelogd. | Demo-bruikbaarheid; productie volgt de vastgelegde tijdstippen. |
| R-56 | Meldingen in de app komen uit de bestaande outbox (één rij per gebeurtenis). E-mail en push volgen met een notificatieprovider. | docs/07 "Notificaties via outbox". |
| R-57 | Demomodel `demo-v1`: structureel deel S = €5 × √(M / €10 mln) uit de laatste externe transferwaarde, plus een vormcorrectie uit de laatste 5 wedstrijden (speelminuten en, per rol gewogen, doelpunten en assists), begrensd op ±15%. Alleen gegevens die op de peildatum bekend waren; ontbrekende statistiek telt niet als nul; het demomodel claimt nooit hoge betrouwbaarheid. Het is uitdrukkelijk niet de onderzoekskandidaat R = c × [...] en wordt in productie geweigerd. | docs/08 "Claude implementeert deze kandidaat niet stilzwijgend". Vervangen zodra een gevalideerd model met modelkaart is goedgekeurd. |
| R-58 | Een waarderingsrun wordt beoordeeld door iemand anders dan de maker (databaseregel) en pas op het geplande moment (maandag 18.00 Europe/Amsterdam) gepubliceerd; in de demo kan dat direct. De waardes van een run liggen vast zodra hij geen concept meer is; een gepubliceerde run blijft gepubliceerd. | BR-08, docs/08 Publicatie, docs/10 gevoelige acties. |
| R-59 | De worker maakt op maandag vanaf 12.00 één conceptrun per week; er wordt nooit iets zonder goedkeuring gepubliceerd. Een speler zonder nieuwe invoer krijgt geen nieuwe waarde: de vorige blijft zichtbaar met zijn eigen datum. Gestopte spelers houden hun laatste waarde als historisch. | docs/08, BR-22. |
| R-60 | Demo-wedstrijden en externe transferwaardes staan in de database (seed) zolang er geen dataleverancier is (O-03); de jobs `fixtures.sync` en `external-valuations.check` wachten op die leverancier. | O-03. |
| R-61 | Contracttests voor adapters zijn code (ADR 0006). Een niet-ondersteunde capability is `BLOCKED` en houdt de bijbehorende geldstroom dicht. Contracttestoperaties hebben sleutels met `contract-test:` en tellen niet mee in de reconciliatie. | docs/07, docs/11 fase 8. |
| R-62 | De simulator weigert een afwikkeling waarvan netto + commissie niet gelijk is aan bruto, zoals een echte partner moet doen. | Contracteis "Commissie splitsen". |
| R-63 | Bewaking berekent de signalen uit docs/10 rechtstreeks uit de database, met eigenaar en draaiboek (`docs/runbooks/`). Eén melding per signaal; oppakken vraagt een notitie; sluiten gebeurt automatisch bij herstel. Afgewezen webhooks worden geteld zonder de inhoud te bewaren. | docs/10 Monitoring. |
| R-64 | Een correctieboeking op een klantsaldo kan alleen na goedkeuring door een tweede persoon, met exact de goedgekeurde inhoud, één keer, tegen de verliesrekening van het platform, en nooit onder nul. | docs/10 gevoelige acties "Financiële correctie". |
| R-65 | Rate limiting per gebruiker en vast tijdvenster, atomair geteld in PostgreSQL (gedeeld door alle webinstanties): preview 60/min, order 20/min, annuleren 30/min, inschrijven 10/min, storten 10/uur, opnemen 5/uur. Inlogpogingen begrenst de identiteitsprovider. | docs/10 Securityrequirements; ADR 0007. |
| R-66 | Uitbetalen gaat naar de rekening van de eerste bevestigde storting, zoals de betaalpartner die kent (closed loop). Het platform bewaart geen rekeningnummers. Een echte adapter levert de rekeningreferentie van de partner. | Gevonden in scenario A: nieuwe klanten konden niet opnemen. |
| R-67 | Beheerrechten gelden buiten de demo alleen na een login met tweede factor, zoals de identiteitsprovider die meldt (`amr`, RFC 8176). Zonder tweede factor is beheer dicht met uitleg; klantfuncties blijven werken. | docs/10 "Beheerders gebruiken MFA". |
| R-68 | Productiegates: vervullen alleen via een uitgevoerde goedkeuring van een tweede persoon met exact het bewijs (databasetrigger); niet in een demodatabase. Intrekken mag één persoon, altijd geaudit. Productie start niet met een open gate en pauzeert geldtaken binnen 30 seconden als een gate wordt ingetrokken. | docs/10 Productiegates. |
| R-69 | Het marktscherm laadt nog de hele catalogus per verzoek. Alleen getest tot p95 186 ms bij één gebruiker en 10.000 spelers; bij 10 gelijktijdige gebruikers 1,4 s. Server-side paginering van het marktscherm is nodig vóór een cashpilot. | Belastingtest fase 9 (docs/perf/). |

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
| V-01 | Mag de dropprijs tussen publicatie (donderdag 18.00) en vastlegging (dinsdag 09.00) nog wijzigen? | **Beantwoord 5 november 2026: ja, in beide richtingen (V-01a).** Inschrijvers zien de actuele prijs vóór bevestigen; een prijswijziging na inschrijving volgt in fase 6. |
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
