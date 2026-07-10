# FM2 Roadmap

Eine selbst gehostete Team-Roadmap als Ersatz für Google Sheets. Zeilen für Bereiche
(z. B. Eventzeitleiste, Releases) und Mitarbeiter, farbige Aufgaben-Balken auf einer
Tages-Zeitleiste mit Kalenderwochen, Drag & Drop, Benutzerkonten und Rechtesystem.

## Rollen

| Rolle | Rechte |
|-------|--------|
| **Administrator** | Lesen, Bearbeiten, Benutzer verwalten |
| **Bearbeiten** | Lesen und Aufgaben/Zeilen ändern |
| **Nur lesen** | Roadmap ansehen, keine Änderungen |

Beim ersten Start wird automatisch ein Admin-Account angelegt (siehe unten).

## Bedienung

- **Aufgabe anlegen:** auf eine freie Stelle in einer Zeile klicken
- **Aufgabe bearbeiten:** auf einen Balken klicken
- **Verschieben:** Balken mit der Maus ziehen (auch in eine andere Zeile)
- **Verlängern/Verkürzen:** am linken oder rechten Rand des Balkens ziehen
- **Zeile anlegen/bearbeiten:** Button „+ Zeile" bzw. Klick auf den Zeilennamen links

Alle Daten liegen in einer SQLite-Datenbank unter `data/roadmap.db`.

## Lokal entwickeln

```bash
npm install
ROADMAP_ADMIN_USER=admin ROADMAP_ADMIN_PASSWORD=test npm run dev
```

Beim ersten Start wird der Admin-Account `admin` mit Passwort `test` angelegt.
Weitere Benutzer legst du als Admin über den Button „Benutzer" an.

Frontend: http://localhost:5173 (Vite mit Proxy), API: Port 3000.

## Team-Accounts vorbereiten (Selbstregistrierung)

Nutzer können ihr Passwort selbst setzen (Benutzername + Geburtsdatum) unter `/register`.
Die vorangelegten Accounts kommen aus einer **nicht eingecheckten** Datei
`seed-members.json` – so landen keine echten Namen/Geburtsdaten im Repo.

1. `seed-members.example.json` als Vorlage kopieren:

   ```bash
   cp seed-members.example.json seed-members.json
   ```

2. In `seed-members.json` die echten Einträge pflegen (`username`, `birthdate` im
   Format `JJJJ-MM-TT`). Beim Start werden fehlende Accounts als „Nur lesen" angelegt;
   vorhandene Accounts und gesetzte Passwörter werden nie überschrieben.

Die Datei ist über `.gitignore` ausgeschlossen und muss auf dem Server separat
hinterlegt werden (z. B. per `scp`), wenn dort frisch aufgesetzt wird.

## Systemvoraussetzungen

Die App ist sehr genügsam. Ein kleiner Server reicht völlig:

- **Betriebssystem:** Linux mit x86-64 (z. B. Ubuntu 22.04/24.04 oder Debian 12)
- **RAM:** ab ca. 512 MB (1 GB komfortabel)
- **CPU:** 1 vCPU genügt
- **Speicher:** wenige hundert MB; die Datenbank wächst nur langsam
- **Software:** Docker + Docker Compose

Damit ist praktisch jeder Hetzner-Cloud-Server (z. B. CX22) mehr als ausreichend.

### Ist mein Server geeignet? (Diagnose)

Per SSH auf dem Server einloggen und diese Befehle ausführen:

```bash
# Betriebssystem und Architektur (x86_64 erwartet)
uname -a && cat /etc/os-release | head -2

# CPU-Kerne, Arbeitsspeicher und freier Plattenplatz
nproc && free -h && df -h /

# Ist Docker schon installiert?
docker --version && docker compose version
```

- **Architektur** sollte `x86_64` sein.
- **RAM** (`free -h`) mindestens ~512 MB frei.
- Zeigt `docker --version` einen Fehler, ist Docker noch nicht installiert
  (Installationsschritt siehe unten).

## Deployment auf dem Hetzner-Server (Docker)

### 1. Docker installieren (falls noch nicht vorhanden)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # danach einmal ab- und wieder anmelden
```

### 2. Projekt auf den Server holen

```bash
git clone https://github.com/FlooTastisch/fm2-roadmap.git
cd fm2-roadmap
```

### 3. DNS-Eintrag setzen

Beim Domain-Anbieter einen **A-Record** anlegen, der auf die Server-IP zeigt:

```
Typ: A   Name: roadmap   Wert: <SERVER-IP>
```

Bei **Cloudflare** den Eintrag zunächst auf **„DNS only" / graue Wolke** stellen
(nicht „Proxied"). Nur so kann Caddy das Let's-Encrypt-Zertifikat über die
HTTP-Challenge ausstellen. Wer die IP verstecken und Cloudflares DDoS-Schutz
nutzen will (orange Wolke), stellt Caddy zusätzlich auf die DNS-Challenge um –
siehe [Caddy-Doku zum Cloudflare-DNS-Provider](https://caddyserver.com/docs/automatic-https#dns-challenge).

### 4. Zugangsdaten und Domain festlegen

```bash
cp .env.example .env
nano .env   # ROADMAP_ADMIN_PASSWORD und ROADMAP_DOMAIN eintragen
```

### 5. Starten

```bash
docker compose up -d --build
```

Caddy holt automatisch ein Let's-Encrypt-Zertifikat und stellt die App unter
`https://<ROADMAP_DOMAIN>` bereit. Der App-Container ist nur intern erreichbar;
von außen läuft alles verschlüsselt über Caddy (Ports 80/443). Die Datenbank
liegt im Ordner `./data` auf dem Host und übersteht Neustarts und Updates.

Status und Logs prüfen:

```bash
docker compose ps
docker compose logs -f          # beenden mit Strg+C
docker compose logs -f caddy    # gezielt die Zertifikats-Ausstellung beobachten
```

### Backup

Es genügt, die Datei `data/roadmap.db` regelmäßig zu sichern, z. B. per Cronjob:

```bash
cp data/roadmap.db /backup/roadmap-$(date +%F).db
```

## Update einspielen

```bash
git pull
docker compose up -d --build
```

## Was bewusst nicht im Repo liegt

Damit dieses Repo gefahrlos öffentlich sein kann, sind alle instanz- und
personenbezogenen Daten über `.gitignore` ausgeschlossen und werden nie
eingecheckt:

- `data/` – die SQLite-Datenbank (alle Aufgaben und Konten)
- `.env` – Admin-Passwort und Domain
- `seed-members.json` – echte Namen/Geburtsdaten der vorangelegten Team-Accounts
  (nur `seed-members.example.json` mit Beispielwerten ist eingecheckt)

Wer das Repo forkt, startet also mit einer leeren Instanz und den eigenen Daten.

## Mitmachen & forken

Pull Requests und Forks sind willkommen. Die App ist bewusst schlank gehalten
(Express + SQLite + React/Vite, keine externe Datenbank nötig) und lässt sich
komplett per Docker Compose betreiben. Für den eigenen Einsatz genügt es,
die Branding-Texte (Titel in `index.html` und Überschriften in `src/App.tsx`)
anzupassen und eine eigene `seed-members.json` zu hinterlegen.

## Lizenz

Veröffentlicht unter der [MIT-Lizenz](LICENSE) – frei nutzbar, veränderbar und
weiterverteilbar.
