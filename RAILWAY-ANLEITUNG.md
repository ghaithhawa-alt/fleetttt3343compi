# FleetCompliance online stellen – Schritt für Schritt

Diese Anleitung bringt die App auf **Railway**. Du brauchst dafür einen
GitHub-Account und einen Railway-Account. Rechne mit **20–30 Minuten**.

---

## Was du am Ende hast

- Die App läuft rund um die Uhr unter einer Adresse wie
  `https://fleetcompliance-production.up.railway.app`
- Eine PostgreSQL-Datenbank, in der die Kundendaten dauerhaft liegen
- Jedes Mal, wenn du etwas zu GitHub hochlädst, geht die neue Fassung
  automatisch live

**Kosten:** Railway kostet im Hobby-Plan **5 $ im Monat** Grundgebühr, darin
sind 5 $ Verbrauch enthalten. Für App + Datenbank in deiner Größe reicht das
in der Regel; rechne im Zweifel mit 5–10 $ im Monat.

---

## Schritt 1 – Den Ordner vorbereiten

Der fertige Ordner heißt `fleetcompliance-railway` und enthält:

```
fleetcompliance-railway/
├── server.py            <- die komplette App in EINER Datei
├── requirements.txt     <- welche Python-Pakete gebraucht werden
├── Procfile             <- der Startbefehl
├── railway.json         <- Railway-Einstellungen (Health-Check usw.)
├── runtime.txt          <- Python-Version
├── .gitignore           <- was NICHT hochgeladen wird (u.a. .env!)
├── .env.example         <- Vorlage für die Einstellungen
├── README.md
├── RAILWAY-ANLEITUNG.md <- diese Datei
└── static/
    ├── css/     shell.css, mitarbeiter.css, settings.css, mandanten.css,
    │            zn-redesign.css, fonts.css
    ├── js/      shell.js, mitarbeiter.js, settings.js, mandanten.js,
    │            zn-redesign.js, bridge.js, shim.js, admin-app.js
    ├── pages/   landing.html, login.html, admin.html, dashboard.html,
    │            impressum.html, datenschutz.html
    ├── icons/   favicon.ico, favicon.svg, favicon-32.png,
    │            favicon-192.png, apple-touch-icon.png
    └── fonts/   Inter + JetBrains Mono (woff2)
```

**Wichtig:** Die Datei `.env` gehört **nicht** in diesen Ordner und **nie**
zu GitHub. Die echten Werte trägst du später bei Railway ein.

---

## Schritt 2 – Vorher lokal testen (empfohlen)

Damit du weißt, dass alles läuft, bevor du online gehst:

```
cd fleetcompliance-railway
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Dann `.env` im Editor öffnen und ausfüllen:

- `SECRET_KEY` → irgendeinen langen Zufallstext
- `SUPERADMIN_EMAIL` → deine E-Mail
- `DATABASE_URL` → **leer lassen** (dann wird lokal SQLite benutzt)

Starten:

```
python server.py
```

Im Browser `http://127.0.0.1:8000` öffnen. Wenn die Startseite kommt und du
dich registrieren und anmelden kannst, ist alles in Ordnung.

Zum Beenden: `Strg + C`.

---

## Schritt 3 – Zu GitHub hochladen

1. Auf **github.com** anmelden → oben rechts **+** → **New repository**
2. Name: `fleetcompliance` · Sichtbarkeit: **Private** · sonst nichts ankreuzen
   → **Create repository**
3. In der Eingabeaufforderung (im Ordner `fleetcompliance-railway`):

```
git init
git add .
git commit -m "FleetCompliance – bereit für Railway"
git branch -M main
git remote add origin https://github.com/DEIN-NAME/fleetcompliance.git
git push -u origin main
```

> Prüfe nach dem Hochladen auf GitHub, dass **keine `.env` und keine
> `.db`-Datei** dabei ist. Die `.gitignore` verhindert das – aber schau
> lieber einmal nach.

---

## Schritt 4 – Railway-Projekt anlegen

1. Auf **railway.com** mit dem GitHub-Konto anmelden
2. **New Project** → **Deploy from GitHub repo**
3. Repository `fleetcompliance` auswählen und Zugriff erlauben

Railway erkennt Python von selbst, installiert `requirements.txt` und
startet den Befehl aus dem `Procfile`. Der erste Versuch schlägt eventuell
fehl, weil die Datenbank noch fehlt – das ist normal, weiter mit Schritt 5.

---

## Schritt 5 – PostgreSQL-Datenbank hinzufügen

1. Im selben Projekt: **+ New** (oder `Strg + K`) → **Database** →
   **Add PostgreSQL**
2. Warten, bis der Dienst grün ist

Die Datenbank läuft im internen Netz des Projekts – von außen kommt niemand
heran. Genau richtig.

---

## Schritt 6 – Die Einstellungen (Variables) eintragen

Auf den **App-Dienst** klicken (nicht auf Postgres) → Reiter **Variables** →
für jeden Punkt **New Variable**:

| Name | Wert |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `SECRET_KEY` | ein langer Zufallstext, siehe unten |
| `SUPERADMIN_EMAIL` | deine E-Mail-Adresse |
| `SUPERADMIN_PASSWORD` | dein Wunsch-Passwort, mind. 8 Zeichen |
| `TRIAL_DAYS` | `30` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` |
| `CORS_ORIGINS` | `*` |

**Was die einzelnen Werte bedeuten:**

- **`SECRET_KEY`** – damit werden die Anmelde-Token unterschrieben.
- **`SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`** – dein Chef-Zugang. Beim
  ersten Start legt der Server das Konto damit automatisch an. Ist es schon
  da, bleibt es unangetastet – ein hier geändertes Passwort wirkt also
  **nicht** rückwirkend. Ändern kannst du es in der App unter *Einstellungen*.
- **`TRIAL_DAYS`** – wie viele Tage eine neu registrierte Firma kostenlos
  testen darf. Bei `30` steht das Feld „gültig bis" 30 Tage in der Zukunft;
  danach meldet die App „Testphase abgelaufen". Du kannst das Datum pro Firma
  im Admin-Panel jederzeit verlängern.
- **`ACCESS_TOKEN_EXPIRE_MINUTES`** – wie lange eine Anmeldung gilt, in
  Minuten. `1440` = 24 Stunden, danach muss man sich neu anmelden. `10080`
  wäre eine Woche (bequemer), `480` acht Stunden (sicherer).
- **`CORS_ORIGINS`** – von welchen fremden Webadressen aus die Schnittstelle
  angesprochen werden darf. Da Website und Schnittstelle bei dir unter
  **derselben** Adresse laufen, ist `*` in Ordnung. Sobald du eine eigene
  Domain hast, trag dort besser genau diese ein.

`DATABASE_URL` **genau so** mit den geschweiften Klammern eintragen – das ist
ein Verweis auf den Postgres-Dienst. Heißt dein Datenbank-Dienst anders,
den Namen entsprechend anpassen.

Einen `SECRET_KEY` erzeugst du dir so (in der Eingabeaufforderung):

```
python -c "import secrets;print(secrets.token_urlsafe(48))"
```

> **Warum das wichtig ist:** Mit diesem Schlüssel werden die Anmelde-Token
> unterschrieben. Fehlt er, erzeugt der Server bei jedem Start einen neuen –
> dann werden alle Kunden nach jedem Neustart abgemeldet.

Nach dem Speichern startet Railway die App automatisch neu.

---

## Schritt 7 – Adresse freischalten

App-Dienst → **Settings** → **Networking** → **Generate Domain**

Du bekommst eine Adresse wie
`https://fleetcompliance-production.up.railway.app`.

Zum Prüfen im Browser aufrufen:

- `.../health` → muss `{"status":"ok"}` zeigen
- `/` → die Startseite
- `/admin` → das Admin-Panel

---

## Schritt 8 – Als Superadmin anmelden

Dein Chef-Konto wurde beim Start **automatisch angelegt** – aus
`SUPERADMIN_EMAIL` und `SUPERADMIN_PASSWORD`. Du musst dich nicht
registrieren.

1. Startseite öffnen → **Anmelden**
2. Mit genau diesen beiden Werten einloggen
3. Du siehst alle vier Module und die Firmenverwaltung

Danach in der App unter **Einstellungen** ein eigenes Passwort setzen. Der
Wert in der Railway-Variable wird dann nicht mehr benutzt – lösche ihn dort
am besten, damit er nicht mehr herumliegt.

Nebeneffekt: Weil das Konto von Anfang an existiert, kann sich niemand
anderes mit deiner E-Mail registrieren und dadurch Superadmin werden.

Fertig. Ab hier kannst du Kunden anlegen.

---

## Eigene Domain (optional)

App-Dienst → **Settings** → **Networking** → **Custom Domain** →
z.B. `app.fleetcompliance.de` eintragen. Railway zeigt dir einen
CNAME-Eintrag, den du beim Domain-Anbieter hinterlegst. Nach ein paar
Minuten läuft die Seite unter deiner Adresse, HTTPS inklusive.

Danach `CORS_ORIGINS` auf die eigene Adresse setzen, z.B.
`https://app.fleetcompliance.de`.

---

## Etwas ändern

```
git add .
git commit -m "was geändert wurde"
git push
```

Railway baut und startet automatisch neu. Unter **Deployments** siehst du
den Fortschritt und kannst bei Bedarf auf eine ältere Fassung zurück.

---

## Wenn etwas nicht läuft

| Was du siehst | Woran es meistens liegt |
|---|---|
| „Railpack could not determine how to build the app" bzw. `analyzed contains: ./` | Railway schaut in den **falschen Ordner**. Die Dateien liegen eine Ebene tiefer im Repository → siehe „Wenn die Dateien in einem Unterordner liegen" unten |
| Deployment schlägt fehl | Bei Railway auf **Deploy Logs** klicken – dort steht der Fehler im Klartext |
| „Application failed to respond" | Der Startbefehl stimmt nicht. Muss `--port $PORT` enthalten (steht im Procfile) |
| Alle Daten nach Neustart weg | `DATABASE_URL` fehlt oder zeigt nicht auf Postgres → Schritt 6 |
| Alle müssen sich ständig neu anmelden | `SECRET_KEY` fehlt → Schritt 6 |
| Seite lädt, aber ohne Gestaltung | Der Ordner `static` wurde nicht mit hochgeladen |
| `/health` antwortet nicht | Dienst läuft nicht – Logs ansehen |

---

## Wenn die Dateien in einem Unterordner liegen

Railway sucht `requirements.txt` und `server.py` **ganz oben** im Repository.
Liegt dort stattdessen nur ein Ordner `fleetcompliance-railway/`, bricht der
Build sofort ab. Im Protokoll steht dann:

```
The app contents that Railpack analyzed contains:
  ./
```

Zwei Wege raus — der zweite ist der sauberere:

**A. Railway sagen, wo es suchen soll** (30 Sekunden)

1. Auf den App-Dienst klicken → **Settings**
2. **Root Directory** auf `/fleetcompliance-railway` setzen
3. Wichtig: Die Konfigurationsdatei folgt diesem Pfad **nicht** mit. Wenn es ein
   Feld für den Config-Pfad gibt, dort `/fleetcompliance-railway/railway.json`
   eintragen.
4. **Redeploy**

**B. Die Dateien nach oben ziehen** (dauerhaft übersichtlicher)

Im Repository-Ordner:

```
git mv fleetcompliance-railway/* .
git mv fleetcompliance-railway/.gitignore .
git mv fleetcompliance-railway/.env.example .
rmdir fleetcompliance-railway
git commit -am "Projekt in das Wurzelverzeichnis verschoben"
git push
```

Danach liegen `server.py`, `requirements.txt`, `Procfile` und `railway.json`
direkt im Repository, und Railway findet alles von selbst. Root Directory
bleibt leer.

**So prüfst du es:** Auf GitHub die Startseite deines Repositories öffnen. Du
musst dort direkt `server.py` und `requirements.txt` sehen – nicht erst einen
Ordner, den du anklicken musst.

---

## Ein Wort zur Sicherheit

Was jetzt schon gut ist: Passwörter werden gehasht (Argon2), jede Firma sieht
nur ihre eigenen Daten, das Superadmin-Konto ist gegen Änderung und Löschung
geschützt, Railway liefert HTTPS.

Was du bald angehen solltest, sobald echte Kunden drauf sind:

1. **Datensicherung.** Railway macht keine automatischen Backups im
   Hobby-Plan. Regelmäßig einen `pg_dump` ziehen und woanders ablegen.
2. **Passwort vergessen** läuft aktuell über dich von Hand (Admin-Panel →
   Einmal-Passwort). Für mehr Kunden lohnt sich E-Mail-Versand.
3. **Auftragsverarbeitungsvertrag (AVV)** mit Railway abschließen – du
   verarbeitest Mitarbeiterdaten deiner Kunden. Railway hostet in den USA;
   für deutsche Kunden ist eine EU-Region oder ein EU-Anbieter (Hetzner,
   Scaleway) auf Dauer die sauberere Lösung.
4. **Anmeldeversuche begrenzen**, damit niemand Passwörter durchprobieren
   kann.
