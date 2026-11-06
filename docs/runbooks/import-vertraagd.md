# Import vertraagd

**Signalen:** Importvertraging (laatste geslaagde import > 26 uur of mislukte imports), Queueachterstand. **Eigenaar:** Catalogusbeheer.

## Stappen

1. Beheer → Catalogus: status, laatste fout, aantal pogingen per importrun.
2. Draait de worker? Een run zonder heartbeat wordt na 2 minuten door een andere worker overgenomen.
3. Leverancier onbereikbaar: de import hervat bij de volgende poging vanaf de laatste stap; er gaat niets verloren en spelers worden bij een gedeeltelijke import niet verwijderd.
4. Problemen in quarantaine: beheer → Spelers → "Importproblemen" oplossen (koppelen of nieuwe identiteit), met reden.
5. Data ouder dan een week: waarderingsrun waarschuwt per speler; overweeg de publicatie uit te stellen.
