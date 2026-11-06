# Webhook afgewezen

**Signaal:** Webhookverificatiefouten (> 0 in 24 uur; kritiek > 20). **Eigenaar:** Financiën.

## Wat het betekent

Berichten op het webhook-endpoint hadden geen geldige handtekening. Ze zijn niet verwerkt en niet opgeslagen (alleen tijdstip, grootte en een hash). Er is niets geboekt.

## Stappen

1. Controleer of het webhookgeheim bij de betaalpartner en in de configuratie (`PAYMENT_WEBHOOK_SECRET`) overeenkomen — bijvoorbeeld na een rotatie.
2. Veel afwijzingen van onbekende herkomst: mogelijk misbruik. Overleg met security; overweeg IP-beperking bij de partner.
3. Echte berichten die zijn afgewezen, gaan niet verloren: de worker vraagt de status van open operaties zelf op (fetch-on-notify en polling).
4. Pak de melding op met de oorzaak.
