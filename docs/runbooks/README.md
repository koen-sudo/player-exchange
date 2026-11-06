# Draaiboeken

Per bewakingssignaal (beheer → Bewaking) één draaiboek. Elke melding heeft een eigenaar (rol) en een status: open → opgepakt (met notitie) → opgelost (automatisch zodra het signaal weer in orde is).

| Signaal | Eigenaar | Draaiboek |
|---|---|---|
| Importvertraging, queueachterstand | Catalogusbeheer | [import-vertraagd.md](import-vertraagd.md) |
| Verouderde referenties | Waardering | [waardering-niet-gepubliceerd.md](waardering-niet-gepubliceerd.md) |
| Openstaande afwikkelingen, gefaalde provideroperaties | Financiën | [afwikkeling-blijft-open.md](afwikkeling-blijft-open.md) |
| Reconciliatieverschillen | Financiën | [reconciliatieverschil.md](reconciliatieverschil.md) |
| Dekking reserveringen, voorraadverschillen | Financiën / Uitgifte | [invariant-geschonden.md](invariant-geschonden.md) |
| Webhookverificatiefouten | Financiën | [webhook-afgewezen.md](webhook-afgewezen.md) |
| Uitbetalingsproblemen | Financiën | [uitbetaling-probleem.md](uitbetaling-probleem.md) |
| Incident (algemeen) | Dienstdoende eigenaar | [incident.md](incident.md) |

Algemene regels:

- Nooit geld of bezit rechtstreeks in de database wijzigen. Correcties gaan via een correctieboeking met goedkeuring van een tweede persoon (beheer → Betalingen).
- Een onbekende uitkomst bij de betaalpartner is pending, nooit mislukt. Niet opnieuw indienen met een nieuwe sleutel.
- Leg elke handeling vast met een reden; de auditlog is het spoor.
