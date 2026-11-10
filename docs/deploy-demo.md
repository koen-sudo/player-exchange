# Online demo op Railway

Een afgeschermde online demo: fictieve spelers en testgeld, achter een wachtwoord. **Geen productie en geen echt geld.** Kosten: Railway Hobby, $5 per maand inclusief $5 gebruik ([prijzen](https://docs.railway.com/pricing/plans)).

## Wat er klaarstaat

- `Dockerfile`: één image voor web en worker.
- `deploy/start.sh`: web voert de migraties uit, laadt de demogegevens bij een lege database en start; worker wacht op de migraties en start de achtergrondtaken.
- `deploy/railway.web.json` en `deploy/railway.worker.json`: bouw- en startinstellingen per dienst.
- Wachtwoord: met `DEMO_ACCESS_PASSWORD` vraagt de browser om een gebruikersnaam (vrij te kiezen) en dit wachtwoord. Uitgezonderd zijn alleen de statuscontrole en de webhook van de betaalsimulator (die heeft een eigen handtekening).
- Een online demo (https) start niet zonder wachtwoord of met de openbare demosleutels uit `.env.example`.
- CI bouwt bij elke push het image en test het: opstarten, migreren, seeden, wachtwoord en worker.

## Stappen (eenmalig, ongeveer 15 minuten)

1. **Account.** Maak een account op [railway.com](https://railway.com) en kies het Hobby-abonnement.
2. **Project.** New Project → Deploy from GitHub repo → kies `koen-sudo/player-exchange`. Railway maakt één dienst; noem die `web`.
3. **Database.** In het project: New → Database → PostgreSQL. Zet de regio op EU West (Amsterdam) als die er staat.
4. **Dienst web.**
   - Settings → Config-as-code: `deploy/railway.web.json`.
   - Settings → Networking → Generate Domain. Noteer het adres, bijvoorbeeld `https://web-production-1234.up.railway.app`.
   - Variables (zie de tabel hieronder).
5. **Dienst worker.** New → GitHub repo → dezelfde repository. Noem hem `worker`. Config-as-code: `deploy/railway.worker.json`. Dezelfde variabelen als web (Railway: "Shared Variables" maakt dat makkelijk).
6. **Deploy.** Railway bouwt en start beide diensten. Open het adres van web, vul het wachtwoord in en log in als een van de demogebruikers.

## Variabelen

Maak de geheimen zelf aan, bijvoorbeeld met `openssl rand -hex 32` (64 tekens) of een wachtwoordmanager.

| Variabele | Waarde |
|---|---|
| `APP_MODE` | `demo` |
| `DEMO_LOGIN_ENABLED` | `true` |
| `DEMO_ACCESS_PASSWORD` | Een eigen wachtwoord van minimaal 12 tekens; deel het alleen met wie de demo mag zien |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (verwijzing naar de database in Railway) |
| `WEB_BASE_URL` | Het adres van web uit stap 4, met `https://` |
| `AUTH_URL` | Hetzelfde adres |
| `AUTH_SECRET` | Eigen geheim, 64 tekens |
| `PAYMENT_WEBHOOK_SECRET` | Eigen geheim, 64 tekens |
| `DROP_SEED_KEY` | Eigen sleutel, precies 64 hexadecimale tekens (`openssl rand -hex 32`) |
| `PAYMENT_PROVIDER` | `demo` |
| `IDENTITY_PROVIDER` | `demo` |
| `FOOTBALL_DATA_PROVIDER` | `fixture` |
| `NOTIFICATION_PROVIDER` | `demo` |

## Beheer

- **Demo opnieuw beginnen:** verwijder de PostgreSQL-dienst en maak een nieuwe; bij de volgende start laadt web de demogegevens opnieuw. De datums in de demo (uitgiftes, orders) zijn relatief aan dat moment.
- **Wachtwoord wijzigen:** pas `DEMO_ACCESS_PASSWORD` aan bij web; Railway herstart de dienst.
- **Stoppen:** zet beide diensten op nul of verwijder het project; kosten stoppen direct.
- Wat je in de demo doet, blijft in de database tot een nieuwe start. Laat bezoekers geen echte persoonsgegevens invoeren.
