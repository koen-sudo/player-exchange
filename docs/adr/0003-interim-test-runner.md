# ADR 0003 — Tijdelijke testrunner voor de domeinlaag

Status: afgesloten (5 november 2026).

## Context

De eerste bouwsessie had geen toegang tot de npm-registry. Domeintests draaiden daarom tijdelijk op `node:test`.

## Besluit

- De domeinlaag (`packages/domain`) gebruikt alleen wisbare TypeScript-syntax (geen `enum`, geen namespaces, geen parameter properties). Node.js 22 voert die bestanden direct uit; dat blijft zo, zodat worker en scripts de domeinlaag zonder buildstap laden.
- Imports binnen de domeinlaag gebruiken de `.ts`-extensie (`allowImportingTsExtensions`, `rewriteRelativeImportExtensions`).

## Afsluiting

Na het installeren van de pakketten zijn alle tests omgezet naar Vitest (`vitest.config.ts` in de root). De asserties gebruiken `node:assert/strict`, wat Vitest ondersteunt. `pnpm test` draait alle unit- en integratietests.
