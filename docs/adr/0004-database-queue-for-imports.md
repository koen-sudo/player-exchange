# ADR 0004 — Database als wachtrij voor catalogusimports

Status: aanvaard (5 november 2026, fase 2).

## Context

Hoofdstuk 04 noemt BullMQ op Redis voor achtergrondtaken. Tegelijk zegt het dossier dat Redis nooit de bron is voor definitieve status en dat een queue-job-ID alleen onvoldoende bescherming tegen dubbel werk is. Een catalogusimport moet hervatbaar zijn, mag maar één keer tegelijk lopen per bron en moet na een gecrashte worker vanzelf verder gaan.

## Besluit

- Catalogusimports gebruiken de tabel `import_runs` als wachtrij. Beheer zet een run op `QUEUED`; de worker claimt hem met `FOR UPDATE SKIP LOCKED`.
- Een unieke partiële index staat maximaal één actieve run per bron en scope toe.
- De worker houdt een heartbeat bij. Een run met een verlopen heartbeat wordt opnieuw geclaimd en gaat verder vanaf de eerste niet-voltooide stap (`import_run_steps`).
- Een onderbroken stap (één team) wordt vanaf de eerste pagina opnieuw gedaan. Upserts maken dat veilig; alleen een volledig aangeleverde selectie mag lidmaatschappen afsluiten, dus de stap moet compleet zijn.
- BullMQ en Redis blijven de keuze voor taken met hoge frequentie of fan-out (bijvoorbeeld notificaties en settlementpolling, fases 4 tot 6). Ook daar blijft de database de bron van waarheid.

## Gevolgen

- Geen extra infrastructuur nodig voor fase 2; de import werkt met alleen PostgreSQL.
- Pollen gebeurt elke 5 seconden. Dat is ruim voldoende voor een nachtelijke of handmatige import.
- Wordt de wachtrijlogica later naar BullMQ verplaatst, dan blijven `import_runs` en de stappen de bron van waarheid en wordt BullMQ alleen het aanzetsignaal.
