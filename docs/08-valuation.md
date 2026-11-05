# Waardering

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

## 08. Waarderingsmodule

### Doel en status

De waarderingsmodule publiceert een modelmatige euroreferentie.

De definitieve productieformule is nog niet gevalideerd. Dat verhindert het bouwen van de interface en pipeline niet.

Demo gebruikt expliciete voorbeeldwaardes. Productie publiceert pas met een goedgekeurde modelversie en toegestane inputs.

### Onderzoeksmodel

De eerdere kandidaat blijft beschikbaar als onderzoeksrichting:

R = c × [w(a) × (M/M0)^α + (1 − w(a)) × P] × (1 + u) × D.

| Component | Betekenis |
|---|---|
| M | Externe transferwaardeschatting |
| w(a) | Geleidelijke leeftijdsweging |
| P | Structurele positiegebonden prestatiecomponent |
| u | Recente prestatiecorrectie |
| D | Eventuele correctie voor aanbod |
| c, M0, α | Gezamenlijke schaalparameters |

Claude implementeert deze kandidaat niet stilzwijgend als gevalideerde productieprijs.

### Invoer

- Speleridentiteit en rol.
- Leeftijd op peildatum.
- Externe transferwaarde met datum waarop die bekend werd.
- Minuten.
- Rolgebonden wedstrijdstatistieken.
- Competitie- en teamcontext.
- Datakwaliteit.
- Eerdere herijking.
- Eventuele goedgekeurde aanbodgegevens.

### Uitvoer

Iedere berekening levert:

- Referentiebedrag.
- Betrouwbaarheidsstatus.
- Belangrijkste verklaringen.
- Inputsnapshot.
- Modelversie.
- Informatiepeildatum.
- Eventuele fouten of waarschuwingen.
- Indicatie of publicatie is toegestaan.

### Rollen

Maak afzonderlijke featureprofielen voor:

1. Keeper.
2. Centrale verdediger.
3. Back/wingback.
4. Verdedigende middenvelder.
5. Centrale/aanvallende middenvelder.
6. Vleugelspeler.
7. Spits.

Alleen features gebruiken die aantoonbaar gedekt zijn.

Een ontbrekende xG-waarde wordt niet gelijkgesteld aan nul.

### Herijking

Bij een nieuwe externe transferwaardeschatting:

- De nieuwe waarde krijgt een eigen peildatum.
- De structurele component wordt herberekend.
- Recente correcties worden volgens het model opnieuw gebaselineerd.
- Eerdere wedstrijden worden niet opnieuw als nieuwe gebeurtenissen toegepast.

### Publicatie

`DRAFT` → `VALIDATED` → `APPROVED` → `PUBLISHED`.

Andere uitkomsten:

- `REJECTED`.
- `FAILED`.
- `SUPERSEDED`.

Publiceer een run of duidelijk afgebakende batch atomisch. Gebruikers mogen geen willekeurige mix van halve updates zien.

Bij ontbreken van input blijft de vorige referentie zichtbaar met oude datum en datastatus.

### Modelacceptatie

Vereist vóór productie:

- Reproduceerbare output.
- Tijdgescheiden backtest.
- Geen gebruik van toekomstige gegevens.
- Analyse per rol en competitie.
- Gedrag bij weinig minuten.
- Gedrag bij blessure, transfer en pensioen.
- Analyse van extra seizoensaanbod.
- Onderbouwing van de euromapping.
- Begrijpelijkheidstest.
- Getekende modelkaart.

Een backtest van sportieve prestaties bewijst geen uitvoerbare kaartprijs. Deze twee evaluaties blijven afzonderlijk.

---
