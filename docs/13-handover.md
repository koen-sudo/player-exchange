# Overdracht

Stand: 6 november 2026, na fase 9. Bedoeld voor wie Player Exchange verder bouwt, beheert of beoordeelt.

**Wat er is:** een volledig werkende **demo** van de klantketen (registreren via demo-login, storten, inschrijven op uitgiftes, handelen, afwikkelen, opnemen) en het beheer daaromheen, met fictieve spelers en een betaalsimulator. **Wat er niet is:** echte leveranciers, echte spelers, een productieomgeving. De demo is niet productiegeschikt en niet "cashklaar" (docs/10).

## Waar staat wat

| Onderwerp | Plek |
|---|---|
| Productregels, UX, data, API, integraties, waardering, acceptatie, beheer | `docs/01`–`docs/10` (bouwdossier V1.0 + addendum V1.1) |
| Elk besluit tijdens de bouw | `docs/12-decisions.md` (A-, O-, V-, R-nummers) |
| Architectuurkeuzes | `docs/adr/0001`–`0007` |
| Wat werkt, wat getest is, wat open staat | `docs/STATUS.md` |
| Draaiboeken per signaal en voor incidenten, back-up en herstel | `docs/runbooks/` |
| Securityreview | `docs/security-review.md` |
| Belastingtest (hardware, dataset, methode, uitkomsten) | `docs/perf/2026-11-06.md` |

## Hoe het in elkaar zit

- **Eén database als bron van waarheid** (PostgreSQL 16). Geld, bezit, orders en limieten worden bewaakt met transacties, constraints en triggers (`packages/db/migrations`). Redis is niet nodig voor juistheid.
- **Domeinregels** zonder framework in `packages/domain`; **database-operaties** in `packages/db/src`; **schermen en API** in `apps/web`; **achtergrondtaken** in `apps/worker`.
- **Geld:** dubbel boekhouden in hele eurocenten; elke boeking idempotent op een bedrijfsgebeurtenis; reserveringen (holds) per order, inschrijving en opname.
- **Externe partijen** achter leveranciersneutrale contracten (`packages/integrations`), met contracttests die elke echte adapter moet doorstaan (ADR 0006).
- **Vier ogen** voor publicaties, prijswijzigingen, correctieboekingen, reconciliatieverschillen en productiegates.

## Draaien en controleren

Zie README voor de lokale demo. Controles:

| Doel | Commando |
|---|---|
| Unit- en integratietests, inclusief scenario A/B/C en de oefeningen | `pnpm test` |
| Databaseconstraints | `pnpm test:db` |
| End-to-end in de browser | `pnpm test:e2e` (web + worker op een geseede database) |
| Hersteloefening | `pnpm ops:restore-check` (met `DATABASE_URL`) |
| Belastingtest | `pnpm perf:load` en `pnpm perf:http` |
| Configuratie van een omgeving | `pnpm check:env` |

CI (GitHub Actions) draait alles behalve de belastingtest bij elke push, plus een afhankelijkheden- en geheimenscan.

## Voordat er echt geld door kan (cashpilot)

1. **Keuzes van de producteigenaar:** betaalpartner (O-02), dataleverancier (O-03), identiteitsprovider (O-06), juridische kwalificatie (O-01), voorwaarden (O-07), fiscale inrichting (O-08), merk en entiteit (O-09), spelersidentiteit (O-10), hosting.
2. **Per gekozen leverancier:** adapter bouwen, contracttests in de sandbox van de leverancier laten slagen, bewijs in Beheer → Koppelingen.
3. **Open technische punten:** marktscherm server-side pagineren (R-69); CSP met nonces; "overal uitloggen" met de identiteitsprovider; externe alerting op de bewakingssignalen; productieback-ups met point-in-time recovery bij de hostingpartij.
4. **Onafhankelijke penetratietest** van de draaiende sandbox-omgeving.
5. **Gates vervullen** (Beheer → Koppelingen, met bewijs en een tweede persoon): Juridisch, Contracten, Betalen, Data, Beeld, Spelersidentiteit, Waardering, Techniek, Security, Operations. Productie start niet zolang er één open is.

## Eigenaren (voorstel, vast te stellen bij de gate Operations)

| Rol | Verantwoordelijk voor |
|---|---|
| Financiën | Afwikkeling, reconciliatie, correcties, uitbetalingen, webhooks |
| Catalogusbeheer | Imports, mapping, spelersprofielen |
| Uitgifte | Programma's, drops, voorraad |
| Waardering | Modelruns, beoordeling, publicatie |
| Techniek | Deploys, back-ups, herstel, beveiligingsupdates |
| Superadmin | Rollen, productiegates (met tweede persoon) |
| Support | Klantvragen, gegevensverzoeken, klachtenpad |
