# ADR 0005 — Grootboek, betaalstromen en betaalsimulator

Status: aanvaard (5 november 2026, fase 4).

## Context

Fase 4 vraagt dubbel boekhouden, reserveringen, stortingen, opnames, inbox/outbox en een deterministische betaalsimulator (succes, vertraging, dubbele berichten, fout, onbekende uitkomst). Er is nog geen betaalpartner gekozen (O-02). De oplossing moet straks een echte partner kunnen aansluiten zonder de geldregels te veranderen.

## Besluit

**Grootboek**
- Dubbel boekhouden in `journal_entries`/`journal_lines` met per rekening een saldo in `ledger_accounts`. Elke boeking heeft een unieke `business_event_id` (bijvoorbeeld `deposit:<id>:confirmed`); een herhaling boekt niets (idempotent).
- De database weigert ongebalanceerde boekingen (uitgestelde trigger), wijzigingen in het journaal (append-only) en negatieve klantsaldi. Een tekort wordt `INSUFFICIENT_AVAILABLE_FUNDS`.
- Klantrekeningen: beschikbaar, gereserveerd, nog niet definitief ontvangen, in afwikkeling, opname onderweg en vordering. Platformrekeningen: tegoed bij de betaalpartner, commissie, primaire omzet, verlies.
- Een reservering (`cash_holds`) en de bijbehorende boeking worden in één transactie geschreven. Verbruikt + vrijgegeven is nooit meer dan gereserveerd.

**Betaalstromen**
- Elke externe handeling krijgt eerst een duurzame `settlement_operations`-rij met een vaste idempotency-key, die wordt gecommit vóór de aanroep. De aanroep gebeurt buiten een databasetransactie.
- Alleen `applyOperationOutcome` boekt het geld van stortingen en opnames, en verwerkt een operatie precies één keer (`financially_processed_at`).
- Een webhook is een melding (fetch-on-notify): handtekening controleren, één keer opslaan in `inbox_events`, dan de status bij de betaalpartner opvragen en toepassen. Een webhook die nog niet aan een operatie te koppelen is, blijft bewaard en wordt later verwerkt.
- Een terugkeer van de betaalpagina mag de status opvragen, maar bevestigt zelf niets.
- Een onbekende uitkomst blijft pending. De worker vraagt open operaties opnieuw op of dient ze opnieuw in met dezelfde key; er komt nooit een tweede betaling met een nieuwe key.
- Een opname haalt het bedrag eerst uit het beschikbare saldo (op een gelockte rekening), zodat een opname en een kooporder niet hetzelfde geld kunnen gebruiken.

**Reconciliatie**
- Per operatie vergelijken met het rapport van de betaalpartner, plus totalen en de projectie saldo = journaal. Een verschil wordt een `reconciliation_break` met een vingerafdruk, zodat een herhaling hem niet dubbel opent.
- Materieel verschil: blokkeert opnames van die gebruiker, of van iedereen als er geen gebruiker aan te wijzen is. Sluiten kan alleen met twee personen (voorstel + goedkeuring, afgedwongen door een CHECK).
- Waarschuwing (uitkomst bij de betaalpartner nog niet verwerkt na de wachttijd): blokkeert niets en sluit vanzelf als hij verdwijnt.

**Simulator**
- De betaalsimulator implementeert dezelfde `PaymentProvider`-interface als een echte partner. Hij bewaart zijn eigen administratie in het schema `psp_sim` en stuurt HMAC-ondertekende webhooks die de worker over HTTP aflevert aan de webapp.
- Hij wordt geweigerd in sandbox en productie (configuratiecontrole, AT-35), net als het demo-webhookgeheim.

## Gevolgen

- Een echte partner aansluiten betekent een nieuwe adapter met dezelfde interface en contracttests (fase 8). De boekingslogica, de inbox en de reconciliatie blijven gelijk.
- `psp_sim` staat in dezelfde database als het platform. Dat is alleen acceptabel omdat het een demo-onderdeel is; het platform leest het nooit rechtstreeks, alleen via de interface.
- Correctieboekingen bij een verschil (in plaats van alleen een verklaring) volgen met de operationele procedures in fase 8.
