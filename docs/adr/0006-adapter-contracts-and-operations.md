# ADR 0006 — Adaptercontracten, capabilitybewijs en operatie

Status: aanvaard (6 november 2026, fase 8).

## Context

Fase 8 vraagt sandboxkoppelingen met contracttests en een capabilityrapport. Er is nog geen betaalpartner (O-02), dataleverancier (O-03) of identiteitsprovider (O-06) gekozen. Wat nu al kan: vastleggen wát elke koppeling moet bewijzen, en de operationele kant (bewaking, correcties, draaiboeken).

## Besluit

- **Contractsuites als code** (`packages/integrations/src/contract-suite.ts`): `runPaymentContract(harness)` en `runFootballDataContract(provider)`. Ze controleren gedrag, niet de implementatie: idempotentie, "onbekend is niet mislukt", storten pas na betaling bevestigd, verdeling bruto = netto + commissie, uitbetalen, webhookverificatie, reconciliatierapport, stabiele ID's, paginering met compleetheidsmelding, versiegebonden statistieken.
- **Geblokkeerd in plaats van overgeslagen:** een capability die een adapter niet heeft, verschijnt als `BLOCKED` en de geldstroom die hem nodig heeft blijft dicht (`blockedFlows`).
- **Harnas per adapter:** de suite krijgt een harnas dat weet hoe een klant een testbetaling afrondt (simulator: kiezen; sandbox: testkaart) en hoe lang op verwerking moet worden gewacht. Een echte adapter wordt pas gebruikt als hij in zijn sandbox alle controles doorstaat.
- **Bewijs bewaren:** elke run van de suites wordt append-only opgeslagen (`adapter_contract_runs`) en is zichtbaar in beheer → Koppelingen, naast het capabilityrapport en de productiegates.
- **Contracttestgeld is geen klantgeld:** sleutels beginnen met `contract-test:` en worden door de reconciliatie genegeerd.
- **Bewaking:** de signalen uit docs/10 worden berekend uit de database (geen aparte metriekenopslag), met een eigenaar per signaal en een draaiboek. De worker opent per ongezond signaal één melding en sluit hem zodra het signaal gezond is; oppakken vraagt een notitie.
- **Correctieboekingen:** alleen via een goedkeuring (`LEDGER_CORRECTION`) door een tweede persoon, uitgevoerd met exact de goedgekeurde inhoud, één keer (boekingssleutel = goedkeurings-ID), tegen de verliesrekening van het platform, nooit onder nul.

## Gevolgen

- Bij de keuze van een partner: adapter + harnas bouwen, suites in de sandbox draaien, bewijs in beheer; pas dan kan de gate "Betalen" met bewijs en goedkeuring worden vervuld.
- Externe monitoring (alerts naar telefoon/e-mail) koppelt later aan dezelfde signalen.
