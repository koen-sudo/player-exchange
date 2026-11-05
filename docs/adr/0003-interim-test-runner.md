# ADR 0003 — Tijdelijke testrunner voor de domeinlaag

Status: tijdelijk (5 november 2026). Vervalt zodra Vitest is geïnstalleerd.

## Context

De eerste bouwsessie had geen toegang tot de npm-registry. Vitest kon daardoor niet worden geïnstalleerd.

## Besluit

- De domeinlaag (`packages/domain`) gebruikt alleen wisbare TypeScript-syntax (geen `enum`, geen namespaces, geen parameter properties). Node.js 22 voert die bestanden direct uit.
- Domeintests gebruiken tijdelijk `node:test` en `node:assert/strict`.
- Imports binnen de domeinlaag gebruiken de `.ts`-extensie. `tsconfig` zet `allowImportingTsExtensions` en `rewriteRelativeImportExtensions`, zodat `tsc` dezelfde bestanden accepteert.

## Vervolg

Zodra pakketten installeerbaar zijn, worden de tests omgezet naar Vitest (`describe/it` blijven gelijk; `assert` → `expect`). De wisbare-syntaxregel blijft gelden, omdat de worker de domeinlaag dan zonder buildstap kan laden.
