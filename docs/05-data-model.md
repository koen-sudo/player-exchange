# Datamodel

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

## 05. Datamodel en databasebeperkingen

Alle kernrecords krijgen interne UUID, aanmaakdatum en waar relevant een versieveld.

### Identiteit en catalogus

| Entiteit | Belangrijkste velden en beperkingen |
|---|---|
| `users` | Auth-subject uniek, status, locale, aanmaakdatum |
| `user_profiles` | Woonland, verificatieverwijzing, benodigde profielvelden |
| `user_restrictions` | Type beperking, reden, ingangsdatum, einddatum, actor |
| `terms_acceptances` | Gebruiker, documentversie, tijdstip |
| `competitions` | Interne ID, provider-ID, naam, land, actief |
| `competition_seasons` | Competitie, provider-seizoen, datums |
| `teams` | Interne ID, naam, externe mappings |
| `team_competition_memberships` | Team, competitie, geldig interval |
| `players` | Identiteit, naam, geboortedatum, carrièrestatus |
| `provider_player_mappings` | Uniek op provider en externe speler-ID |
| `player_team_memberships` | Speler, team, type lidmaatschap, geldig interval |
| `player_roles` | Rol, bron, geldigheid en weging |
| `fixtures` | Wedstrijd, teams, status en bron-ID |
| `player_match_stats` | Speler, wedstrijd, versie, statistieken en bronpeildatum |
| `watchlists` | Uniek op gebruiker en speler |
| `import_runs` | Provider, scope, cursor, status en dekking |
| `import_issues` | Ontbrekende velden, duplicaten en herstelstatus |

### Waardering

| Entiteit | Belangrijkste velden |
|---|---|
| `external_valuations` | Speler, bron, bedrag, valuta, peildatum en bekend-worden-tijd |
| `valuation_model_versions` | Parameters, codeversie, goedkeuring en status |
| `valuation_runs` | Scope, inputsnapshot, status, berekend en gepubliceerd |
| `player_reference_values` | Speler, run, bedrag, betrouwbaarheid, verklaringen en status |
| `valuation_reviews` | Reviewbesluit, actor, reden en gekoppelde versie |

Publieke queries lezen uitsluitend gepubliceerde waarderingen.

### Voorraad en uitgifte

| Entiteit | Belangrijkste velden en beperkingen |
|---|---|
| `player_markets` | Uniek per speler, marktstatus en reden |
| `editions` | Uniek per speler en platformseizoen, cap 500 |
| `issuance_programs` | Editie, versie, gepland aantal, goedkeuring en publicatie |
| `cards` | Editie, serienummer, speler, voorraadstatus, eigenaar |
| `ownership_events` | Kaart, vorige/nieuwe eigenaar, oorzaak en uitvoering |
| `drops` | Editie, prijs, hoeveelheid, tijdstippen en status |
| `drop_cards` | Concrete kaart-ID’s voor een drop |
| `subscriptions` | Uniek per drop en gebruiker, reservering en status |
| `allocations` | Rangorde, kaart, ontvanger, status en algoritmeversie |
| `allocation_snapshots` | Deelnemersdigest, seed commitment, resultaatdigest |

Kaartserienummers vallen binnen 1–500 en zijn uniek binnen een editie.

Het systeem maakt geen nieuwe kaartsleutel om een mislukte uitgifte buiten de cap om te herstellen.

Een kaart met onzekere externe afwikkeling blijft geblokkeerd.

### Handel

| Entiteit | Belangrijkste velden |
|---|---|
| `orders` | Speler, gebruiker, kant, limiet, aantallen, status, prioriteitsnummer, expiry |
| `order_cards` | Specifieke kaarten gereserveerd voor verkoop |
| `executions` | Kooporder, verkooporder, kaart, prijs, fee en afwikkelingsstatus |
| `settlement_operations` | Type, idempotency-key, providerreferentie, status en retries |
| `idempotency_requests` | Actor, endpoint, key, requesthash en resultaat |
| `outbox_events` | Te verwerken domeinevents |
| `inbox_events` | Uniek ontvangen extern event en verwerkingsstatus |

Orderaantallen bewaren afzonderlijk:

- Oorspronkelijk.
- Vrij openstaand.
- In afwikkeling.
- Definitief uitgevoerd.
- Geannuleerd.
- Verlopen.

De som blijft gelijk aan het oorspronkelijke aantal.

### Geldadministratie

| Entiteit | Belangrijkste velden |
|---|---|
| `payment_accounts` | Gebruiker, provideraccount, valuta, status |
| `ledger_accounts` | Type, eigenaar en valuta |
| `journal_entries` | Business-event-ID, status, tijdstip en bron |
| `journal_lines` | Rekening, debit/credit, bedrag en valuta |
| `cash_holds` | Gebruiker, doel, bevestigd bedrag en status |
| `deposits` | Providerreferentie, bedrag, status |
| `withdrawals` | Bedrag, rekeningverwijzing, status |
| `reconciliation_runs` | Scope, peildatum en uitkomst |
| `reconciliation_breaks` | Verschil, ernst, actor en herstelstatus |
| `customer_receivables` | Afzonderlijke vordering bij bijvoorbeeld een chargeback |

Iedere journal entry is in balans per valuta.

Journaalregels worden niet overschreven. Correcties gebruiken een tegenboeking met verwijzing.

Financiële projections worden bijgewerkt binnen dezelfde transactie als de journaalboeking en kunnen opnieuw uit het journaal worden opgebouwd.

### Audit en beheer

- `roles`.
- `permissions`.
- `user_roles`.
- `admin_approvals`.
- `audit_events`.
- `feature_gates`.
- `notification_outbox`.
- `notification_deliveries`.

Een goedkeuring bindt aan de hash van de exacte handeling en payload. Een wijziging maakt een oude goedkeuring ongeldig.

---
