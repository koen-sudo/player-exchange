# Invariant geschonden

**Signalen:** Dekking van reserveringen (grootboek) of Voorraadverschillen (voorraad, handel, uitgifte). **Eigenaar:** Financiën / Uitgifte. **Altijd kritiek.**

## Wat het betekent

Een structurele regel klopt niet meer, bijvoorbeeld: reservering ≠ open kooporders, saldo ≠ som van het journaal, een kaart met twee levende toewijzingen. De database voorkomt de meeste gevallen; een melding wijst op een fout in code of een handmatige ingreep.

## Stappen

1. Zet de handel in de betrokken markt(en) op pauze (beheer → Spelers → marktstatus) of, bij twijfel, alle geldhandelingen via de productiegate "Betalen".
2. Noteer de exacte tellers uit Bewaking en Betalingen/Handel.
3. Zoek de betrokken records (auditlog, journaal, ownership events). Wijzig niets rechtstreeks.
4. Herstel via de normale routes: correctieboeking (vier ogen) voor geld; voor bezit een incident met tweede persoon en een gedocumenteerde migratie.
5. Incidentproces starten ([incident.md](incident.md)); na herstel: oorzaak, test die het voortaan vangt, en de pauze opheffen.
