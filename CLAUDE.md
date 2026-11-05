# Player Exchange — projectinstructies

Je bouwt Player Exchange volgens de projectdocumentatie: een echte geldmarktplaats voor digitale voetballerskaarten. De eerste uitvoering gebruikt demo- en sandboxadapters zolang productievoorwaarden ontbreken.

Lees vóór iedere fase: dit bestand, de betreffende specificaties in `docs/`, `docs/12-decisions.md` en `docs/STATUS.md`.

## Productregels

- Houd catalogus, primaire uitgifte en secundaire handel strikt gescheiden.
- Eén interne identiteit (UUID) per speler, ook bij transfer of verhuur.
- Kaarten zijn uniek en ondeelbaar. Maximaal 500 per speler per platformseizoen.
- Platformseizoen: vanaf 1 juli 00.00 `Europe/Amsterdam` tot exclusief 1 juli 00.00 het jaar erna.
- De publieke interface toont alleen gepubliceerde referentiewaardes (`public_reference_values`).
- Bestaande limietorders veranderen niet door een nieuwe referentieprijs.
- Orderduur is exact 1, 7 of 30 dagen (24/168/720 uur vanaf serveracceptatie).
- Commissie: 5% per verkooporder, cumulatief, half omhoog op centen.
- Geld, bezit, limieten en bevoegdheden worden server-side gecontroleerd.
- Echte spelersnamen pas tonen na vrijgave van de gate "Spelersidentiteit" (O-10).

## Technische regels

- Gedeelde domeinservices (`packages/domain`) bevatten de regels; geen UI-code, geen leveranciers-SDK.
- Bescherm geld en bezit met databasetransacties en constraints (`packages/db/migrations`).
- Lockvolgorde: markt/editie → wallets op gesorteerde ID → orders → kaarten op gesorteerde ID.
- Bewaar externe operaties en herstelstatus duurzaam. Inbox/outbox en stabiele idempotency-keys.
- Ondersteun dubbele en te late externe events. Een onbekende betaaluitkomst is pending.
- Geld uitsluitend als gehele eurocenten. Geen floating point.
- Geen eigen authenticatieprotocol of cryptografisch algoritme.
- Demo-login bestaat alleen in `demo`; productieconfiguratie met demo-login faalt bij startup.
- Gebruik externe documentatie voor actuele leveranciersdetails.

## Scope

- Volg de goedgekeurde huisstijl (`docs/02-ux.md`, `docs/wireframes/`).
- Werk eerst de huidige fase volledig af.
- Voeg geen commerciële functies toe zonder productbesluit.
- Wijzig geen prijs-, oplage-, recht- of geldstroomregels om implementatie te vereenvoudigen.
- Documenteer architectuurwijzigingen als ADR in `docs/adr/`.
- Houd demo, sandbox en productie strikt gescheiden.

## Oplevering

- Werkende code via de normale gebruikersroutes.
- Betekenisvolle tests voor geld, eigendom, concurrency en herstel.
- Rapporteer alleen wat werkelijk is getest. Werk `docs/STATUS.md` bij na iedere fase.
- Meld open afhankelijkheden precies. Noem een demo nooit productiegeschikt.

## Commando's

| Doel | Commando |
|---|---|
| Unit- en integratietests (Vitest) | `pnpm test` |
| Databasetests | `pnpm test:db` (vereist PostgreSQL) |
| Typecheck | `pnpm typecheck` |
| Build | `pnpm build` |
| End-to-end (Playwright) | `pnpm test:e2e` |
| Lokale diensten | `docker compose up -d db redis` |

Bekijk na een wijziging aan schermen de demo op 390, 768 en 1440 px.
