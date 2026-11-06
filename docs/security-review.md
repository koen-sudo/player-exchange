# Securityreview fase 9

Datum: 6 november 2026. Uitgevoerd door: de bouwer (Claude), op de code in deze repository.

**Dit is een interne review, geen onafhankelijke penetratietest.** De gate Security ("opgeloste kritieke en hoge reviewbevindingen") vraagt daarnaast een onafhankelijke test van de draaiende omgeving zodra hosting, betaalpartner (O-02) en identiteitsprovider (O-06) vastliggen.

## Methode

- Elke eis uit docs/10 "Securityrequirements" nagelopen tegen de code (routes, server actions, domeinservices, migraties).
- Gericht gezocht naar bekende risico's: ruwe SQL, HTML-injectie, `eval`, geheimen in clientcode, ontbrekende eigendomscontroles, ongeauthenticeerde mutaties.
- Gelijktijdigheid getest met een belastingtest (100 gelijktijdige orders op één markt).
- Geheimenscan over de volledige git-geschiedenis met gitleaks 8.21.2: **geen lekken gevonden**.
- Afhankelijkheden: `pnpm audit --prod` in CI (job `security`, 6 november 2026): **geen bekende kwetsbaarheden**. Draait bij elke push.

## Bevindingen

| # | Ernst | Bevinding | Status | Bewijs |
|---|---|---|---|---|
| F-01 | Hoog | Geen rate limiting op gevoelige endpoints (docs/10). | **Opgelost** (R-65) | `hardening.test.ts` (ook onder gelijktijdigheid), e2e fase 9 (429 na 60 previews) |
| F-02 | Hoog | MFA voor beheerders niet afgedwongen (docs/10). | **Opgelost in code** (R-67); echte provider nog niet getest (O-06) | `security.test.ts` |
| F-03 | Hoog | Deadlock in het grootboek bij gelijktijdige boekingen op dezelfde platformrekening. Geld bleef juist (transactie teruggedraaid), maar orders en betalingen faalden onder belasting. | **Opgelost** (ADR 0007) | Regressietest faalt zonder fix, slaagt met fix; belastingtest 100/100 geaccepteerd |
| F-04 | Hoog | Productiegates niet door de server afgedwongen: de opstartcontrole bestond alleen als commentaar; een gate kon direct in de database op "vervuld" worden gezet. | **Opgelost** (R-68) | `hardening.test.ts`, e2e fase 9 |
| F-05 | Middel | Correctieboeking legde altijd omgeving `demo` vast, ook in productie. | **Opgelost** | `operations.test.ts` |
| F-06 | Middel | Geen Content-Security-Policy, HSTS of Permissions-Policy. | **Opgelost**; rest-risico laag: scripts nog met `'unsafe-inline'` | e2e fase 9 (headers) |
| F-07 | Middel | Webhook-endpoint las onbegrensd grote berichten. | **Opgelost** (max. 64 KB, 413) | e2e fase 9 |
| F-08 | Middel | Bewaartermijn ruwe importdata (R-24) niet uitgevoerd. | **Opgelost** (dagelijks via worker) | `hardening.test.ts` |
| F-09 | Middel | Nieuwe klanten kregen nooit een uitbetaalrekening: opnemen was onmogelijk. | **Opgelost** (R-66) | `scenarios.test.ts` scenario A |
| F-10 | Middel | Marktscherm laadt de hele catalogus per verzoek; gevoelig voor overbelasting. | **Open** (R-69), vóór cashpilot | `docs/perf/2026-11-06.md` |
| F-11 | Laag | Een ongeldige ID in sommige formulieren geeft een algemene foutmelding (500) in plaats van een validatiefout. Geen gegevenslek. | Open | — |
| F-12 | Laag | Vaste rate-limitvensters staan aan de venstergrens kort tot twee keer de limiet toe. | Aanvaard | ADR 0007 |

Geen kritieke bevindingen. Alle hoge bevindingen zijn opgelost in code; F-02 moet nog met de echte identiteitsprovider worden aangetoond.

## Eisen uit docs/10

| Eis | Stand |
|---|---|
| Beheerders gebruiken MFA via de identiteitsprovider | In code (R-67); aantonen met O-06 |
| Bevoegdheden en objecteigendom bij iedere request | Ja: gebruiker uit de sessie, rollen en status per request uit de database; eigendom gecontroleerd in de domeinfuncties (orders, inschrijvingen, betaalpagina) |
| Beveiligde sessiecookies | Auth.js: HttpOnly, SameSite=Lax, Secure op https; sessie 8 uur. "Overal uitloggen" volgt met O-06 |
| CSRF-bescherming | API: Origin moet gelijk zijn aan de host (e2e). Server actions: Next.js vergelijkt Origin en Host |
| Rate limiting op gevoelige endpoints | Ja (R-65) |
| Inputvalidatie aan serverzijde | Ja: bedragen als hele centen, vaste orderduren, ID-formaten, idempotency-keys |
| Secrets uitsluitend server-side | Ja: geen `NEXT_PUBLIC_`-variabelen; productie weigert demo- en zwakke geheimen bij opstart |
| Providerwebhooks authentiseren | HMAC met timing-safe vergelijking; afgewezen berichten geteld zonder inhoud |
| Logs zonder tokens, identiteitsdocumenten of volledige rekeningnummers | Ja: gestructureerde logs zonder request-body; rekeningen alleen gemaskeerd |
| Afscherming en bewaartermijn raw datasets en exports | Ruwe importpagina's alleen voor beheer, verwijderd na termijn (F-08). Persoonlijke export alleen voor de persoon zelf, zonder gegevens van anderen |
| Toegangscontrole op bestanden | Er worden nog geen bestanden opgeslagen; volgt met beeldrechten (gate Beeld) |
| Dependency- en secret-scans | Gitleaks: schoon. `pnpm audit --prod`: geen bekende kwetsbaarheden. Beide in CI |
| Back-ups en aantoonbare herstelprocedure | Hersteloefening geslaagd lokaal en in CI; productieback-ups hangen af van de hostingkeuze |
