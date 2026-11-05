# Beheer, beveiliging en livegang

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

## 10. Beheer, beveiliging en livevoorwaarden

### Rollen

| Rol | Toegang |
|---|---|
| Support | Eigen bevoegdheidsbereik voor gebruikersvragen en relevante transacties |
| Catalog manager | Imports, mappings en spelersprofielen |
| Issuance operator | Uitgiftes voorbereiden |
| Valuation analyst | Waarderingen voorbereiden en onderzoeken |
| Finance operator | Settlement, reconciliatie en financiële incidenten |
| Approver | Bevoegde vrijgave van specifieke handelingen |
| Superadmin | Rollenbeheer en noodconfiguratie, volledig geaudit |

Dezelfde actor keurt zijn eigen gevoelige handeling niet goed.

### Gevoelige acties

Vereis tweepersoonsgoedkeuring voor:

- Productieformule publiceren.
- Uitgifteprogramma publiceren of materieel wijzigen.
- Financiële correctie.
- Handmatige oplossing met geld- of eigendomseffect.
- Productiebetalingen activeren.

Voor kleinere teams kunnen personen meerdere rollen hebben, maar de tweede goedkeuring vereist een andere bevoegde gebruiker.

### Securityrequirements

- Beheerders gebruiken MFA via de gekozen identiteitsprovider.
- Bevoegdheden en objecteigendom controleren bij iedere relevante request.
- Beveiligde sessiecookies.
- CSRF-bescherming voor cookiegeauthenticeerde mutaties.
- Rate limiting op gevoelige endpoints.
- Inputvalidatie aan serverzijde.
- Secrets uitsluitend server-side.
- Providerwebhooks authentiseren.
- Logs zonder toegangstokens, identiteitsdocumenten of volledige rekeningnummers.
- Afscherming en bewaartermijn voor raw datasets en exports.
- Toegangscontrole op bestanden.
- Dependency- en secret-scans.
- Back-ups en aantoonbare herstelprocedure.

### Monitoring

Dashboard voor:

- Importvertraging.
- Verouderde referenties.
- Queueachterstand.
- Pending settlements.
- Gefaalde provideroperaties.
- Reconciliatieverschillen.
- Onvoldoende dekking van reserveringen.
- Voorraadverschillen.
- Webhookverificatiefouten.
- Uitbetalingsproblemen.

Een foutmelding bevat een operationele eigenaar en afhandelstatus.

### Dagelijkse reconciliatie

Vergelijk:

1. Providerrecords.
2. Stortingen en opnames.
3. Settlementoperaties.
4. Grootboek.
5. Saldi en reserveringen.
6. Platformfee en primaire opbrengst.

Een materieel onverklaard verschil blokkeert de betrokken geldhandelingen.

Een beheerder kan een verschil niet alleen wegklikken.

### Productiegates

| Gate | Vereist bewijs |
|---|---|
| Juridisch | Beoordeling van exact product, klantlanden en benodigde toelating |
| Contracten | Definitieve kaartvoorwaarden, privacy en relevante overeenkomsten |
| Betalen | Schriftelijke provideracceptatie en geverifieerde geldstromen |
| Data | Commerciële rechten voor data en afgeleide waardes |
| Beeld | Rechten voor daadwerkelijk gebruikte foto’s en merken |
| Waardering | Gevalideerde en goedgekeurde modelversie |
| Techniek | Geslaagde kern-, concurrentie- en hersteltests |
| Security | Opgeloste kritieke en hoge reviewbevindingen |
| Operations | Eigenaren, klachtenpad, incidentproces en afwikkelingsplan |

Een aangevinkte clientinstelling is geen gatebewijs.

De server controleert de vereiste gates. Geldige configuratie én bevoegde vrijgave zijn nodig.

### Uitrol

Volgorde:

1. Lokale demo.
2. Afgeschermde ontwikkelomgeving.
3. Integratiesandbox.
4. Afgeschermde cashpilot na gates.
5. Beperkte productie.
6. Verbreding op gemeten resultaten.

Een technisch geslaagde demo wordt niet als cashklaar beschreven.

---


---

## Addendum V1.1 (5 november 2026)

_Overgenomen uit `docs/source/addendum-v1.1.md`. Bij tegenstrijdigheid gaat dit addendum vóór de tekst hierboven._

#### Aanvulling op hoofdstuk 10 — nieuwe gate “Spelersidentiteit”

Vereist vóór commercieel productiegebruik van echte spelers:

**Een gedocumenteerde juridische beoordeling van het gebruik van spelersnamen en andere identificerende persoonlijkheidskenmerken op kaarten, profielen, handelsaanbiedingen en marketing. Waar toestemming of licenties nodig zijn, moeten deze aantoonbaar zijn verkregen.**

De beoordeling en eventuele overeenkomsten specificeren:

- Gedekte spelers en territoria.
- Toegestane productvorm, inclusief verhandelbare digitale kaarten.
- Marketinggebruik.
- Looptijd, uitzonderingen en beëindigingsgevolgen.
- Behandeling van reeds verkochte kaarten bij rechtenverlies.

Een statistieklicentie of toestemming voor een foto wordt niet automatisch als dekking voor deze toepassingen aangemerkt. Toon echte spelersnamen pas nadat het toepasselijke gebruik is vrijgegeven.

Collectieve licentiëring via FIFPRO, nationale spelersorganisaties of andere bevoegde rechthebbenden is een te onderzoeken route. Dekking van alle spelers en dit specifieke product moet worden bevestigd. FIFPRO biedt collectieve overeenkomsten voor naam, beeld en gelijkenis aan.
