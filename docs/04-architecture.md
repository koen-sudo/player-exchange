# Architectuur

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

## 04. Technische architectuur

### Keuze

Bouw één modulaire applicatie in één repository.

De klantomgeving en beheeromgeving delen backenddiensten en database.

Gebruik een afzonderlijk workerproces voor imports, matching, waardering, toewijzing en afwikkeling.

### Voorgestelde stack

| Laag | Keuze |
|---|---|
| Taal | TypeScript |
| Webapp | Next.js met App Router |
| UI | React, Tailwind CSS en toegankelijke componenten |
| Database | PostgreSQL |
| Databasecode | Drizzle ORM met expliciete SQL waar nodig |
| Validatie | Zod |
| Achtergrondtaken | BullMQ en Redis |
| Authenticatie | Auth.js met externe OIDC-provider |
| Tests | Vitest, PostgreSQL-integratietests en Playwright |
| Bestandsopslag | S3-compatibele objectopslag |
| Runtime | Node.js-processen voor web en worker |
| Packagebeheer | pnpm |

Claude controleert bij implementatie de actuele stabiele compatibiliteit en legt exacte versies vast in lockfile en een korte ADR.

Redis is geen bron voor financieel saldo, kaartbezit of definitieve orderstatus.

### Modules

- Identity.
- Catalog.
- Market admission.
- Inventory.
- Issuance.
- Trading.
- Settlement.
- Ledger.
- Payments.
- Valuation.
- Notifications.
- Administration.
- Audit.

### Projectstructuur

| Pad | Verantwoordelijkheid |
|---|---|
| `apps/web` | Klantinterface, beheer en HTTP-endpoints |
| `apps/worker` | Achtergrondtaken |
| `packages/domain` | Bedrijfsregels en use cases |
| `packages/db` | Schema, migrations en repositories |
| `packages/contracts` | Request- en responsevalidatie |
| `packages/integrations` | Externe adapters en demo-implementaties |
| `packages/ui` | Gedeelde visuele componenten |
| `tests` | Integratie-, concurrentie- en end-to-endtests |

De domeinlaag bevat geen UI-code en hoeft geen externe leveranciers-SDK te importeren.

### Backendregels

- Alle mutaties via gedeelde use cases.
- Autorisatie binnen de serverlaag.
- Databaseconstraints ondersteunen de applicatievalidatie.
- Belangrijke mutaties en outboxberichten worden in dezelfde databasetransactie opgeslagen.
- Externe netwerkcalls vinden buiten langlopende database-locks plaats.
- Leverancierscalls krijgen een stabiele idempotency-key.
- De worker kan veilig opnieuw starten.

### Concurrency

Gebruik PostgreSQL-transacties en expliciete locks in een vaste volgorde.

Lock voor gevoelige handelingen:

1. Spelersmarkt of editie.
2. Betrokken wallets op gesorteerde account-ID.
3. Orders op vaste volgorde.
4. Kaarten op gesorteerde kaart-ID.

Bij database-deadlock of serialization failure wordt de volledige betreffende transactie begrensd opnieuw uitgevoerd.

Beveilig dubbel werk met database-unieke sleutels. Een queue-job-ID alleen is onvoldoende.

---


---

## Addendum V1.1 (5 november 2026)

_Overgenomen uit `docs/source/addendum-v1.1.md`. Bij tegenstrijdigheid gaat dit addendum vóór de tekst hierboven._

#### Demo-authenticatie — aanvulling op hoofdstuk 04 en AT-35

Bevestigd. In `demo` mag een lokale testlogin worden gebruikt zonder externe OIDC-provider.

Voorwaarden:

- Alleen vooraf ingestelde fictieve testaccounts.
- Authenticatie loopt via de server.
- De browser kan geen eigen gebruiker-ID, rol of verificatiestatus aanwijzen.
- Lokale testlogin is hard geblokkeerd in productiedeployments, ongeacht meegestuurde parameters.
- Productieconfiguratie die testlogin probeert te activeren faalt bij startup.
- Testlogin verleent nooit toegang tot echte betalingen of productiegegevens.

OIDC blijft de beoogde authenticatieroute voor productie. AT-35 omvat voortaan ook deze testlogin.


#### Monorepo-tooling — aanvulling op hoofdstuk 04

Bevestigd. Gebruik **pnpm workspaces met Turborepo**.

Registreer dit als **A-13**. Gebruik één lockfile. Configureer afhankelijkheden tussen build-, typecheck- en testtaken. Databasewijzigingen, seeds en externe mutaties zijn expliciete taken die niet vanuit de taakcache opnieuw als uitgevoerd mogen worden beschouwd.
