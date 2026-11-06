# Back-up en herstel

**Eigenaar:** Techniek (uitvoering), Financiën (controle van de uitkomst).

## Uitgangspunten

- De database is de enige bron van waarheid voor geld, bezit en orders. Redis en de worker houden geen eigen staat.
- Productie draait op een beheerde PostgreSQL met **point-in-time recovery** (doorlopende WAL-archivering) en dagelijkse volledige back-ups, bewaard op een andere locatie dan de database. De keuze van de hostingpartij is nog open; dit is een eis aan die keuze.
- Doelwaarden voor de cashpilot (voorstel, vast te stellen bij de gate Operations): maximaal 5 minuten gegevensverlies (RPO) en herstel binnen 4 uur (RTO).
- Externe operaties zijn duurzaam vastgelegd met idempotency-keys. Na een herstel naar een eerder moment vraagt de worker de betaalpartner opnieuw naar elke open operatie met dezelfde sleutel; niets wordt dubbel geboekt (zie [afwikkeling-blijft-open.md](afwikkeling-blijft-open.md)).

## Hersteloefening (minimaal per kwartaal, en na elke schemawijziging die geld raakt)

```
DATABASE_URL=postgres://…/kopie PG_BIN=/usr/lib/postgresql/16/bin node packages/db/ops/restore-check.ts
```

Het script maakt een dump, zet die terug in een nieuwe database, en vergelijkt per tabel het aantal rijen, de saldi, de kaarteigenaren, de orderaantallen, de auditlog en de gepubliceerde referentiewaardes. Daarna draait het alle invarianten van geld, handel, voorraad en uitgifte op de herstelde database en controleert het dat de beschermende triggers werken (de auditlog weigert een verwijdering). Het resultaat is `GESLAAGD` of `MISLUKT`, met de verschillen. Draai het op een kopie of in een rustig moment: verandert de bron tijdens de dump, dan stopt het. `pg_dump` moet dezelfde hoofdversie hebben als de server (`PG_BIN` of `PG_DOCKER_IMAGE=postgres:16`); het script controleert dat. Die eis vond de eerste CI-run: een nieuwere client schreef instellingen die PostgreSQL 16 niet kent.

De oefening draait ook bij elke wijziging in CI, op de demo-database na de end-to-endtests.

## Herstel na een incident

1. Incidentproces starten ([incident.md](incident.md)); handel en opnames pauzeren (marktstatus en gate intrekken — productie stopt geldtaken binnen 30 seconden).
2. Bepaal het hersteltijdstip (vlak vóór de fout) en herstel naar een **nieuwe** database. Overschrijf nooit de bestaande; die is bewijs.
3. Controleer de herstelde database: alle invarianten (Beheer → Bewaking: "Dekking van reserveringen" en "Voorraadverschillen" in orde). `restore-check.ts` vergelijkt met een bron; bij noodherstel is er geen gezonde bron, dus tellen hier alleen de invarianten.
4. Laat de worker open operaties bij de betaalpartner opvragen en draai de reconciliatie. Elk verschil volgt [reconciliatieverschil.md](reconciliatieverschil.md).
5. Pas na een schone reconciliatie en goedkeuring door een tweede persoon de handel heropenen.
6. Leg tijdlijn, verloren venster en genomen stappen vast in het incidentverslag.
