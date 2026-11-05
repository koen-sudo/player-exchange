# API-contracten

_Bron: bouwdossier V1.0 (`docs/source/bouwdossier-v1.0.md`), hoofdstuk zoals hieronder. Wijzig regels alleen via een besluit van de producteigenaar._

## 06. API-contracten

### Algemene conventies

- Prefix `/api/v1`.
- JSON.
- ISO-8601-datums in UTC.
- Bedragen als integer-centstrings, bijvoorbeeld `"620"`.
- Aantallen als positieve gehele getallen.
- IDs als UUID’s.
- Server bepaalt user-ID uit de sessie.
- Client mag geen fee, eigenaar of definitief saldo bepalen.
- Muterende financiële endpoints vereisen `Idempotency-Key`.
- Hergebruik van een key met andere payload geeft conflict.
- Autorisatie blijft verplicht bij een herhaald verzoek.

### Publieke en catalogus-endpoints

| Methode en pad | Gedrag |
|---|---|
| `GET /competitions` | Zes ingestelde competities en dekking |
| `GET /teams` | Filter op competitie en seizoen |
| `GET /players` | Zoeken, filters, sortering en cursorpaginering |
| `GET /players/{id}` | Profiel en datastatus |
| `GET /players/{id}/reference` | Gepubliceerde referentie en historie |
| `GET /players/{id}/stats` | Beschikbare statistieken met peildatum |
| `GET /players/{id}/market` | Marktstatus, bieding, vraag en handelsactiviteit |
| `GET /players/{id}/orderbook` | Geaggregeerde beschikbare orders |
| `GET /players/{id}/trades` | Definitief afgewikkelde publieke transacties |
| `GET /players/{id}/supply` | Oplage, programma, verkocht en komende drops |
| `GET /drops` | Uitgifteoverzicht |
| `GET /drops/{id}` | Dropdetails |

### Gebruiker-endpoints

| Methode en pad | Gedrag |
|---|---|
| `GET /me` | Profiel, status en toegestane acties |
| `POST /me/verification` | Start verificatie via provider |
| `PUT /me/watchlist/{playerId}` | Speler volgen |
| `DELETE /me/watchlist/{playerId}` | Volgen stoppen |
| `GET /me/portfolio` | Bezit, kostenbasis en waarderingen |
| `GET /me/balances` | Beschikbaar, gereserveerd en pending |
| `GET /me/orders` | Eigen orders |
| `GET /me/transactions` | Eigen uitvoeringen |
| `GET /me/cards/{cardId}` | Kaartbewijs en eigen relevante historie |
| `POST /order-previews` | Order valideren en serverpreview maken |
| `POST /orders` | Preview bevestigen en order plaatsen |
| `POST /orders/{id}/cancel` | Vrij restant annuleren |
| `POST /drops/{id}/subscriptions` | Inschrijven met reservering |
| `POST /subscriptions/{id}/cancel` | Annuleren vóór sluiting |
| `GET /me/subscriptions` | Eigen inschrijvingen en uitkomsten |
| `POST /deposits` | Betaling starten |
| `POST /withdrawals` | Uitbetaling aanvragen |
| `GET /me/payments` | Betaalhistorie |

### Orderpreview

Invoer:

- `side`.
- `playerId`.
- `quantity`.
- `limitPriceMinor`.
- `timeInForce`.
- `cardIds` voor verkoop, of expliciete automatische kaartselectie.

Uitvoer:

- `previewId`.
- Geldigheid, standaard 60 seconden.
- Serverberekende totalen.
- Feeregel.
- Geselecteerde kaart-ID’s.
- Actuele marktstatus.
- Beschikbare rechten.
- Benodigde reservering.

De preview reserveert nog geen middelen.

Bij bevestiging controleert de server actuele beschikbaarheid opnieuw. Een verlopen of inhoudelijk gewijzigde preview vraagt nieuwe controle.

Een actuele marktprijs kan wijzigen. De bevestigde limiet blijft leidend voor de uitvoering.

### Externe callbacks

- `POST /webhooks/payments/{provider}`.
- `POST /webhooks/identity/{provider}`.

Deze endpoints controleren authenticiteit volgens het providercontract, leggen het event duurzaam vast en verwerken het idempotent.

Browsercookies zijn geen authenticatiemiddel voor providerwebhooks.

### Beheer-endpoints

Alle beheer-endpoints vallen onder `/admin`.

Modules ondersteunen:

- Imports starten en problemen bekijken.
- Spelers toelaten of pauzeren.
- Programma’s voorbereiden en goedkeuren.
- Drops publiceren, uitstellen en annuleren.
- Waarderingsruns voorbereiden, reviewen en publiceren.
- Gebruikersbeperkingen instellen.
- Settlement- en reconciliatieproblemen behandelen.
- Auditgegevens bekijken.
- Productiegates beoordelen.

Geen algemeen “saldo aanpassen”-endpoint.

Een financiële correctie heeft een specifiek type, reden, gekoppeld dossier en waar vereist tweede goedkeuring.

### Foutcodes

| Code | Betekenis |
|---|---|
| `AUTH_REQUIRED` | Inloggen vereist |
| `ACTION_NOT_ALLOWED` | Bevoegdheid ontbreekt |
| `VERIFICATION_REQUIRED` | Verificatie nodig |
| `COUNTRY_NOT_SUPPORTED` | Klantmarkt niet toegelaten |
| `MARKET_NOT_OPEN` | Handel voor deze speler gesloten |
| `PRICE_INVALID` | Prijs buiten toegestane grenzen |
| `INSUFFICIENT_AVAILABLE_FUNDS` | Te weinig vrij saldo |
| `CARD_UNAVAILABLE` | Kaart al gereserveerd of niet in bezit |
| `POSITION_LIMIT_EXCEEDED` | Bezitslimiet overschreden |
| `PREVIEW_EXPIRED` | Controlevenster opnieuw openen |
| `IDEMPOTENCY_CONFLICT` | Key hoort bij andere inhoud |
| `DROP_NOT_OPEN` | Geen geldige inschrijfperiode |
| `SUBSCRIPTION_EXISTS` | Al ingeschreven |
| `PAYMENT_PENDING` | Uitkomst nog niet vastgesteld |
| `RECONCILIATION_HOLD` | Handeling tijdelijk geblokkeerd voor onderzoek |

De response bevat `requestId`, foutcode en bruikbare Nederlandse melding. Gevoelige interne details blijven in de beveiligde logs.

---
