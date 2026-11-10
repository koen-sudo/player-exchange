# ADR 0007 — Hardening voor de cashpilot

Status: aanvaard (6 november 2026, fase 9).

## Context

Fase 9 vraagt een securityreview, belastingtests, een hersteltest en operationele oefeningen, en het afwerken van de productiegates. De review (`docs/security-review.md`) en de belastingtest (`docs/perf/2026-11-06.md`) leverden bevindingen op die een architectuurkeuze vragen.

## Besluiten

1. **Rate limiting in de database** (R-65). Eén atomaire upsert per poging in `rate_limit_hits`, per gebruiker, actie en vast venster. Geen Redis: de limiet moet gelden voor alle instanties en mag niet verdwijnen bij een herstart. Een geweigerde poging telt mee. Nadeel: vaste vensters staan aan de grens kort tot twee keer de limiet toe; aanvaard.
2. **Grootboek: alle rekeningen vooraf vergrendelen, op ID-volgorde.** De belastingtest vond een deadlock: de foreign-key-controle van een journaalregel neemt een gedeelde lock die de saldotrigger daarna opwaardeert. Twee boekingen op dezelfde platformrekening wachtten op elkaar. `post()` vergrendelt nu eerst alle betrokken rekeningen met `SELECT … ORDER BY id FOR UPDATE`. Regressietest: 40 gelijktijdige boekingen op één platformrekening.
3. **MFA via de identiteitsprovider** (R-67). We lezen alleen de `amr`-claim; geen eigen MFA-protocol. De regel staat in `packages/domain/src/security.ts`.
4. **Gates afgedwongen door de server** (R-68). Databasetrigger op `feature_gates`; opstartcontrole in web (instrumentation) en worker; de worker pauzeert geldtaken en de web-app weigert geld- en orderhandelingen zodra een gate open is.
5. **Beveiligingsheaders**: CSP zonder framing, plugins of base-URL-wijziging; HSTS; Permissions-Policy. Scripts houden `'unsafe-inline'` voor de Next.js-bootstrap; nonces volgen bij de hostingkeuze. Geen `form-action`: de stortingsflow leidt door naar de betaalpagina van de partner.
6. **Hersteloefening als script** (`packages/db/ops/restore-check.ts`), ook in CI na de end-to-endtests.

## Aanvulling 10 november 2026

7. **Marktscherm in SQL** (R-70): `marketPage` doet filteren, sorteren en pagineren in de database; de schermen laden alleen de spelers die ze tonen.
8. **CSP met nonce** (R-71) via de Next.js-proxy, met `'strict-dynamic'`; pagina's renderen per verzoek.
9. **Online demo achter een wachtwoord** (R-72) in dezelfde proxy: HTTP Basic over HTTPS, digest-vergelijking in constante tijd; geen eigen protocol.

## Gevolgen

- Elke nieuwe gevoelige route roept `guardSensitive(actie, gebruiker)` aan.
- Een nieuwe gate is een migratie, geen configuratie.
- Een nieuw scherm met spelerslijsten gebruikt `marketPage` of een `loadWorld` met alleen de getoonde spelers, nooit de hele catalogus.
