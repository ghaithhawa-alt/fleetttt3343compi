# FleetCompliance

Verwaltung für Mietwagen- und Uber-Betriebe: Zeitnachweis, Lohn,
Buchhaltung, Fahrtenbuch und Dokumentvorlagen.

Zum Online-Stellen: **[RAILWAY-ANLEITUNG.md](RAILWAY-ANLEITUNG.md)**

---

## Was wo liegt

```
server.py     Die komplette Anwendung. Eine Datei, in zehn Teile gegliedert.
static/css    Aussehen
static/js     Bedienung im Browser
static/pages  Die Seiten (Startseite, Anmeldung, Admin, Dashboard)
static/icons  Symbole
static/fonts  Schriften (selbst gehostet, kein Google)
```

### Die zehn Teile in server.py

| Teil | Inhalt | Frühere Datei |
|---|---|---|
| 1 | Einstellungen und Datenbank-Verbindung | `config.py`, `database.py` |
| 2 | Datenbank-Modelle (welche Tabellen es gibt) | `models.py` |
| 3 | Anmeldung: Passwörter, Token, Berechtigungen | `auth.py` |
| 4 | Geo: Adressen, Koordinaten, Routen | `geo.py` |
| 5 | Moduldaten: Buchhaltung, Lohn, Zeitnachweis | `blobs.py` |
| 6 | Die Anwendung selbst (FastAPI) | `main.py` |
| 7 | Konten, Pläne, Verwaltung, Geo-Endpunkte | `main.py` |
| 8 | Webseiten und Dateien aus dem static-Ordner | `main.py` |
| 9 | Mitarbeiter, Vorlagen, PDF, Logo, Mandanten | `main.py` |
| 10 | Startinhalt der Dokumentvorlagen (nur Text) | `vorlagen_start.py` |

Suchst du etwas, dann im Editor nach `TEIL 7` usw. suchen – oder direkt nach
der Adresse, z.B. `"/mitarbeiter"`.

---

## Lokal starten

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # danach ausfüllen
python server.py
```

→ http://127.0.0.1:8000

Ohne `DATABASE_URL` wird lokal eine SQLite-Datei benutzt
(`fleetcompliance.db`). Auf Railway **muss** PostgreSQL eingerichtet sein,
sonst sind die Daten nach jedem Neustart weg.

---

## Einstellungen

| Name | Bedeutung |
|---|---|
| `SECRET_KEY` | Unterschreibt die Anmelde-Token. Lang und zufällig. Pflicht. |
| `DATABASE_URL` | Leer = SQLite lokal. Auf Railway: `${{Postgres.DATABASE_URL}}` |
| `SUPERADMIN_EMAIL` | Dieses Konto sieht alles und darf Firmen verwalten |
| `SUPERADMIN_PASSWORD` | Legt das Superadmin-Konto beim Start automatisch an, falls es noch fehlt. Vorhandenes Konto wird nie überschrieben. |
| `TRIAL_DAYS` | Länge der Testphase für neue Firmen (Standard 30) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Gültigkeit einer Anmeldung (Standard 1440 = 1 Tag) |
| `CORS_ORIGINS` | Erlaubte Herkunftsadressen, Standard `*` |
| `PORT` | Setzt Railway selbst. Lokal 8000. |

---

## Die wichtigsten Adressen

**Seiten**

| Adresse | Was |
|---|---|
| `/` | Startseite |
| `/app/dashboard` | Die eigentliche App |
| `/admin` | Admin-Panel |
| `/impressum`, `/datenschutz` | Rechtliches |
| `/health` | Lebenszeichen für Railway |
| `/docs` | Automatische Schnittstellen-Übersicht von FastAPI |

**Konto**

`POST /register` · `POST /login` · `GET /me` · `POST /me/passwort` ·
`GET /license-status` · `POST /passwort-anfrage` · `POST /passwort-setzen`

**Moduldaten** (Firma kommt immer aus dem Token, nie aus der Anfrage)

`/buch/list` `/buch/load` `/buch/save` ·
`/lohn/list` `/lohn/load` `/lohn/save` `/lohn/delete` ·
`/lohn/stammdaten` `/zn/stammdaten`

**Stammdaten**

`/mitarbeiter` (GET, POST, PUT, DELETE) · `/me/firmenprofil` · `/me/logo` ·
`/vorlagen` · `/dokument/pdf` · `/mandanten`

**Team-Zugänge** (nur Inhaber, Tarif muss `teamzugaenge` enthalten)

`GET /team` · `POST /team` · `PUT /team/{id}` · `POST /team/{id}/sperren` ·
`POST /team/{id}/passwort-neu`

**Vorgänge** (Übergaben zwischen Buchhaltung und Disposition)

`GET /vorgaenge` · `POST /vorgaenge` · `GET /vorgaenge/anzahl` ·
`GET /vorgaenge/{id}` · `POST /vorgaenge/{id}/erledigt` ·
`POST /vorgaenge/{id}/kommentar` · `POST /vorgaenge/{id}/wieder-oeffnen`

**Geo**

`/geocode` · `/reverse` · `/route` · `/osrm-geom` · `/check_terrain`

**Verwaltung** (nur Superadmin/Admin)

`/admin/firmen` · `/admin/firmen/anlegen` · `/admin/firmen/update` ·
`/admin/firmen/delete` · `/admin/firmen/passwort-neu` · `/admin/plaene` ·
`/admin/vorlagen` · `/admin/gruppe/{id}` · `/admin/passwort-anfragen`

---

## Wie die Anmeldung funktioniert

1. `POST /login` liefert einen Token (JWT), gültig 24 Stunden
2. Der Browser legt ihn unter `fc_token` ab
3. `shim.js` wird beim Aufruf von `/app/dashboard` automatisch in die Seite
   gesetzt und hängt den Token an jede Anfrage
4. Kommt einmal `401` zurück, geht es zurück zur Anmeldung

Die Datei `dashboard.html` selbst wird dabei **nicht** verändert.

---

## Datenbank

Die Tabellen werden beim Start automatisch angelegt. Fehlende Spalten
werden ergänzt (siehe `_NACHTRAEGLICHE_SPALTEN` in Teil 1) – bestehende
Daten bleiben erhalten.

| Tabelle | Inhalt |
|---|---|
| `firma` | Betrieb: Name, Anschrift, Betriebssitz, Module, Plan, Lizenzart |
| `user` | Anmeldekonto, gehört zu genau einer Firma |
| `datenblob` | Die Moduldaten als JSON (Buchhaltung, Lohn, Zeitnachweis) |
| `mitarbeiter` | Fahrer und Angestellte pro Firma |
| `mandant` | Welche Firma ein Konto zusätzlich betreuen darf |
| `plan` | Abo-Pläne, im Admin-Panel frei einstellbar |
| `dokumentvorlage` | Arbeitsverträge, Kündigung, Aufhebung |
| `firmalogo` | Logo als Data-URL, erscheint auf den Dokumenten |
| `passwortanfrage` | „Passwort vergessen" und Profil-Freischaltungen |
| `vorgang` | Aufträge: Fahrer abkassieren, Kasseninventur, freie Aufgaben |
| `vorgangereignis` | Zeitleiste dazu – wächst nur an, wird nie überschrieben |
| `geocache` | Zwischenspeicher für Adressen und Routen |

Mehrere Personen pro Firma: `user` hat `rolle` (inhaber · buchhaltung ·
disposition · nur_lesen · fahrer) und `aktiv`; `firma.max_benutzer` begrenzt,
wie viele Zugänge gleichzeitig aktiv sein dürfen. Details im Entwurf
[TEAM-ZUGAENGE.md](TEAM-ZUGAENGE.md).
