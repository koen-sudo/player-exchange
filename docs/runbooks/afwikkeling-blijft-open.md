# Afwikkeling blijft open

**Signaal:** Openstaande afwikkelingen (operaties > 15 min niet definitief; kritiek > 60 min) of gefaalde provideroperaties. **Eigenaar:** Financiën.

## Wat het betekent

Een storting, opname, verkoop of uitgifte wacht op de betaalpartner. Zolang de uitkomst onbekend is:

- verplaatst er geen kaart;
- blijft het geld van de koper in "in afwikkeling" en wordt de verkoper niet betaald;
- wacht de markt van die speler met nieuwe matches (maximaal één afwikkeling per markt).

## Stappen

1. Beheer → Betalingen → "Openstaande operaties": noteer soort, bedrag, pogingen, laatste fout.
2. Controleer of de worker draait (logregel `payments cycle`, health-endpoint).
3. De worker vraagt elke 5 seconden de status op, of dient opnieuw in met **dezelfde** idempotency-key. Start nooit handmatig een nieuwe operatie.
4. Kijk bij de betaalpartner (dashboard/support) naar de operatie met die sleutel.
   - Geslaagd bij de partner: wacht op de volgende poll of webhook; die boekt precies één keer.
   - Definitief mislukt: de volgende poll boekt de mislukking (geen kaartoverdracht, geen commissie; de order krijgt zijn deel terug als hij nog loopt).
   - Partner kent de operatie niet: storting → vervalt na 15 minuten vanzelf als "niet gestart"; opname/afwikkeling → escaleren naar de partner.
5. Pak de melding op in Bewaking met een notitie (wat je hebt gedaan, ticketnummer bij de partner).
6. Blijft het > 4 uur open: incidentproces ([incident.md](incident.md)).
