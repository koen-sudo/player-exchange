# ADR 0002 — Databasemigraties in SQL, Drizzle voor queries

Status: aanvaard (5 november 2026).

## Context

De kritieke regels (cap 500, één open execution per kaart, één settlement per markt, sluitende journaalposten, append-only audit, goedkeuring gebonden aan payload) moeten in de database zelf worden afgedwongen. Daarvoor zijn partiële unieke indexen, `CHECK`-constraints, triggers en een deferred constraint trigger nodig. Drizzle-kit genereert niet al deze objecten.

## Besluit

- `packages/db/migrations/NNNN_*.sql` zijn de bron van waarheid, genummerd en alleen-toevoegend.
- Iedere migratie draait in één transactie.
- Het Drizzle-schema (`packages/db/src/schema.ts`) beschrijft dezelfde tabellen voor getypeerde queries. Afwijkingen tussen SQL en Drizzle worden in CI gedetecteerd door `drizzle-kit pull` te vergelijken (vanaf fase 2).
- `packages/db/test/constraints.sql` test iedere constraint en controleert dat een weigering om de juiste reden gebeurt.

## Gevolgen

- Toepassingscode kan de regels niet per ongeluk omzeilen.
- Een migratie die een constraint verzwakt valt op in review en in de constrainttests.
