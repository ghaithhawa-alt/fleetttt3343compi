# Entwurf: Team-Zugänge

Mehrere Personen in einer Firma. Heute gilt: **ein Login = eine Firma**. Damit
Buchhaltung und Disposition am selben Betrieb arbeiten können, bekommt `User`
eine Rolle, die Firma eine Platzgrenze — und die Rechteprüfung wandert von
„welche Firma" auf „welche Firma **und** welche Rolle".

Betrifft `server.py`, TEIL 2, 3 und 7. **5 neue Spalten, 0 neue Tabellen.**
Voraussetzung für das spätere Freigabe-Modul.

---

## 1. Datenmodell

### User erweitern

```python
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    firma_id: int = Field(foreign_key="firma.id", index=True)
    passwort_temporaer: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # ── NEU ───────────────────────────────────────────────────────
    name: str = ""                  # Anzeigename, z.B. "Aylin K."
    rolle: str = "inhaber"          # siehe Abschnitt 2
    aktiv: bool = True              # False = gesperrt, Login abgelehnt
    mitarbeiter_id: Optional[int] = Field(
        default=None, foreign_key="mitarbeiter.id")   # nur Rolle "fahrer"
    letzte_anmeldung: Optional[datetime] = None
```

`mitarbeiter_id` brauchst du heute noch nicht. Aber sobald das Fahrer-Portal
kommt, muss ein Login sagen können „ich bin Fahrer Nr. 12". Die Spalte jetzt
mitzunehmen kostet nichts und spart dir später eine zweite Migration.

### Firma erweitern

```python
    max_benutzer: int = 1     # wie viele Personen in dieser Firma arbeiten dürfen
```

Bewusst getrennt von `max_firmen`: Das eine zählt **Firmen** (Mandanten einer
Gruppe), das andere zählt **Personen** in einer Firma. Zwei Achsen, die sich
nicht stören.

### ⚠ Namenskollision beachten

`Firma.rolle` gibt es schon und bedeutet etwas anderes (`benutzer` | `admin` —
darf diese Firma die Verwaltung öffnen). `/me` und `/license-status` liefern
diesen Wert heute unter dem Schlüssel `rolle`, und `admin-app.js` liest ihn so
aus.

**Belege den Schlüssel nicht neu.** Gib die Personenrolle als `benutzerrolle`
zurück — dann bricht im Frontend nichts.

---

## 2. Rollen und Rechte

Fünf Rollen reichen. Mehr wird unübersichtlich, weniger zwingt dich, jemandem
die Lohnabrechnung zu zeigen, der nur den Dienstplan macht.

| Darf … | Inhaber | Buchhaltung | Disposition | Nur lesen | Fahrer |
|---|:--:|:--:|:--:|:--:|:--:|
| Zeitnachweis | ✓ | ✓ | ✓ | lesen | eigene |
| Lohnabrechnung | ✓ | ✓ | – | lesen | eigene |
| Buchhaltung / Kassenbuch | ✓ | ✓ | – | lesen | – |
| Fahrtenbuch | ✓ | – | ✓ | lesen | – |
| Mitarbeiter-Stammdaten | ✓ | ✓ | lesen | lesen | – |
| Verträge / PDF erzeugen | ✓ | ✓ | – | – | – |
| Firmenprofil, Logo | ✓ | – | – | – | – |
| Team verwalten | ✓ | – | – | – | – |
| Mandanten wechseln | ✓ | – | – | – | – |

**Nur der Inhaber verwaltet das Team.** Wenn die Buchhaltung Kollegen anlegen
dürfte, könnte sie sich selbst zum Inhaber machen — und du hättest die
Rechteprüfung umsonst gebaut.

Der Superadmin steht wie bisher über allem; `_is_superadmin()` bleibt
unverändert und wird in jeder Prüfung zuerst abgefragt.

---

## 3. Migration

Dein `_ensure_columns()` erledigt das komplett von allein — kein Skript, kein
Datenverlust.

```python
_NACHTRAEGLICHE_SPALTEN = [
    # ... die bestehenden Zeilen bleiben ...
    ("user",  "name",             "VARCHAR DEFAULT ''"),
    ("user",  "rolle",            "VARCHAR DEFAULT 'inhaber'"),
    ("user",  "aktiv",            "BOOLEAN DEFAULT TRUE"),
    ("user",  "mitarbeiter_id",   "INTEGER"),
    ("user",  "letzte_anmeldung", "TIMESTAMP"),
    ("firma", "max_benutzer",     "INTEGER DEFAULT 1"),
]
```

`ALTER TABLE … ADD COLUMN … DEFAULT 'inhaber'` füllt bestehende Zeilen in
PostgreSQL direkt mit auf. Jeder heutige Kunde wird also beim nächsten Start
automatisch zum `inhaber` seiner eigenen Firma und zu `aktiv` — genau das, was
er vorher faktisch schon war.

`max_benutzer` bleibt bei 1, bis ein Plan etwas anderes sagt. Damit ist die
Funktion für Bestandskunden erst einmal unsichtbar, und du kannst sie in Ruhe
fertig bauen.

---

## 4. Endpunkte

Fünf neue Wege, alle nur für den Inhaber.

| | Adresse | Was |
|---|---|---|
| `GET` | `/team` | Kollegen der eigenen Firma, mit Rolle und Status |
| `POST` | `/team` | anlegen → liefert das Einmal-Passwort **einmalig** zurück |
| `PUT` | `/team/{id}` | Name und Rolle ändern |
| `POST` | `/team/{id}/sperren` | `{"aktiv": false}` — sperren statt löschen |
| `POST` | `/team/{id}/passwort-neu` | neues Einmal-Passwort, falls jemand seins vergisst |

### Anlegen

```
POST /team
{ "name": "Aylin K.", "email": "aylin@betrieb.de", "rolle": "buchhaltung" }

→ 200
{ "id": 14, "name": "Aylin K.", "email": "aylin@betrieb.de",
  "rolle": "buchhaltung", "aktiv": true,
  "einmal_passwort": "Kp7mXq2rTv9s" }      # nur in DIESER Antwort
```

Den Mechanismus hast du schon: `admin_passwort_neu` erzeugt genau so ein
Passwort und setzt `passwort_temporaer = True`, und `/passwort-setzen` lässt den
Kollegen beim ersten Anmelden sein eigenes wählen. **E-Mail-Versand brauchst du
dafür nicht** — der Inhaber gibt das Passwort weiter, wie du es heute schon bei
deinen Kunden machst.

### /me erweitern

```json
{ "email": "aylin@betrieb.de",
  "firma": "Fahrbetrieb Neuss GmbH",
  "firma_id": 3,
  "rolle": "benutzer",                    // unverändert: kommt aus Firma.rolle
  "benutzerrolle": "buchhaltung",         // NEU: die Person
  "name": "Aylin K.",                     // NEU
  "rechte": ["zeitnachweis", "lohn", "buchhaltung",
             "mitarbeiter", "vertraege"]  // NEU: fürs Ausblenden
}
```

Fehlermeldungen im gewohnten Ton: `409` „Alle 5 Plätze sind belegt", `409`
„Diese E-Mail wird schon benutzt", `403` „Nur der Inhaber darf das Team
verwalten".

---

## 5. Rechteprüfung im Code

Eine Tabelle, zwei Funktionen. Danach ist jede Prüfung im Endpunkt eine Zeile.

```python
RECHTE = {
    "inhaber":     {"zeitnachweis", "lohn", "buchhaltung", "fahrtenbuch",
                    "mitarbeiter", "vertraege", "firmenprofil",
                    "team", "mandanten"},
    "buchhaltung": {"zeitnachweis", "lohn", "buchhaltung",
                    "mitarbeiter", "vertraege"},
    "disposition": {"zeitnachweis", "fahrtenbuch", "mitarbeiter_lesen"},
    "nur_lesen":   {"zeitnachweis_lesen", "lohn_lesen", "buchhaltung_lesen",
                    "fahrtenbuch_lesen", "mitarbeiter_lesen"},
    "fahrer":      {"eigene_daten"},
}


def hat_recht(user: User, recht: str) -> bool:
    if _is_superadmin(user):
        return True
    return recht in RECHTE.get(user.rolle or "inhaber", set())


def braucht(recht: str):
    """FastAPI-Abhaengigkeit. Ersetzt Depends(get_wirk_user) dort,
    wo ein bestimmtes Recht noetig ist."""
    def pruefer(current: User = Depends(get_wirk_user)) -> User:
        if not hat_recht(current, recht):
            raise HTTPException(403, "Dafuer fehlt dir die Berechtigung")
        return current
    return pruefer
```

Im Endpunkt wird daraus ein Ein-Wort-Tausch. Aus

```python
def lohn_save(request: Request, current: User = Depends(get_wirk_user), ...)
```

wird

```python
def lohn_save(request: Request, current: User = Depends(braucht("lohn")), ...)
```

Weil `braucht()` denselben `User` zurückgibt wie `get_wirk_user`, funktioniert
der Rest des Endpunkts unverändert weiter — inklusive Mandanten-Umschaltung
über `X-Mandant`.

### Die Rolle gehört nicht in den Token

Lass die Token-Nutzlast bei `{sub, firma_id, exp}` und lies die Rolle bei jeder
Anfrage frisch aus der Datenbank. Sonst wirkt das Sperren eines Kollegen erst,
wenn sein Token abläuft — bei deinen 1440 Minuten also bis zu einen Tag später.
Das ist genau der Moment, in dem man jemanden sperren will.

---

## 6. Stolperfallen

Die Stellen im bestehenden Code, die durch mehrere Benutzer pro Firma **still
falsch** werden. Nummer 1 ist die wichtigste.

**1 · `get_wirk_user` macht jeden zum Inhaber**
Die Funktion baut heute eine losgelöste Kopie des Benutzers:
`User(id=…, email=…, password_hash=…, firma_id=x_mandant)`. Die neuen Felder
fehlen darin — `rolle` fällt also auf den Standardwert `"inhaber"` zurück.
Ergebnis: Sobald ein Kollege auf einen Mandanten umschaltet, hat er dort **volle
Inhaber-Rechte**. Beim Kopieren `rolle`, `aktiv`, `name` und `mitarbeiter_id`
mit übernehmen.

**2 · Login prüft `aktiv` nicht**
Ohne eine zusätzliche Zeile in `/login` ist der Sperr-Knopf reine Dekoration.
Gleiche Antwort geben wie bei falschem Passwort (`401`), nicht „Konto gesperrt"
— sonst verrät die Seite, welche Adressen existieren.

**3 · „Der Hauptbenutzer" ist nicht mehr „der erste"**
`admin_firmen_update` (E-Mail ändern) und `admin_passwort_neu` greifen sich
heute `select(User).where(firma_id==…).order_by(User.id).first()`. Sobald es
Kollegen gibt, kann das der Falsche sein. Beide auf
`User.rolle == "inhaber"` filtern.

**4 · Die Firma kann sich selbst aussperren**
Der Inhaber darf sich weder selbst sperren noch selbst herabstufen, und der
letzte aktive Inhaber einer Firma muss Inhaber bleiben. Zwei Zeilen Prüfung —
analog zu `_schuetze_superadmin()`, das du schon hast.

**5 · Löschen zerstört die spätere Nachvollziehbarkeit**
Beim Freigabe-Modul soll jeder Statuswechsel auf eine Person zeigen. Ein
gelöschter Benutzer macht aus dieser Spur eine Lücke. Deshalb gibt es im Team
keinen Löschen-Knopf, nur `aktiv = False`. Gesperrte Kollegen zählen nicht
gegen `max_benutzer`.

**6 · E-Mails sind global eindeutig**
`User.email` ist über *alle* Firmen hinweg eindeutig. Ein Steuerberater, der bei
drei Betrieben mitarbeitet, kann also nicht dreimal dieselbe Adresse bekommen —
dafür ist die Mandanten-Funktion da. Sag das in der Fehlermeldung deutlich,
sonst rätselt der Kunde.

**7 · Fahrer dürfen nicht auf Mandanten**
`/mandanten` muss für die Rolle `fahrer` `darf: false` liefern, und `X-Mandant`
ist für sie zu ignorieren. Sonst öffnet die schwächste Rolle die breiteste Tür.

**8 · Neue Konten brauchen die Rolle ausdrücklich**
`/register`, `/mandanten/neu`, `/admin/firmen/anlegen` und
`_superadmin_anlegen` legen alle einen `User` an. Überall `rolle="inhaber"`
ausdrücklich hinschreiben, auch wenn der Standardwert es ohnehin täte — sonst
rätselst du in einem Jahr, warum es funktioniert.

---

## 7. Frontend

Genau das Muster, das `settings.js` und `mandanten.js` schon vorgeben.

- Neu: `static/js/team.js` und `static/css/team.css`, in `_dashboard_html()`
  genauso eingehängt wie die anderen — mit `?v=`-Zeitstempel, damit der Browser
  nichts Altes behält.
- Sidebar-Eintrag **Team** unter VERWALTUNG, sichtbar nur wenn
  `/license-status` das Modul `teamzugaenge` enthält **und**
  `benutzerrolle === "inhaber"`.
- Die Liste zeigt Name, E-Mail, Rolle, letzte Anmeldung und einen
  Sperren-Schalter. Oben rechts steht schlicht **3 von 5 Plätzen belegt** — das
  ist die Stelle, an der der Kunde von selbst über den größeren Plan nachdenkt.
- Das Einmal-Passwort erscheint einmal in einem Dialog mit Kopier-Knopf und dem
  Hinweis, dass es nicht noch einmal angezeigt wird. Nirgends im Klartext
  speichern.
- Module, für die die Rolle kein Recht hat, blendet `shell.js` anhand von
  `rechte` aus.

> **Ausblenden ist keine Sicherheit.** Das Verstecken im Frontend ist reine
> Bequemlichkeit — jeder kann die Anfrage von Hand schicken. Die eigentliche
> Prüfung passiert ausschließlich serverseitig über `braucht()`. Wenn du einen
> Endpunkt vergisst, hilft dir das Ausblenden kein Stück.

---

## 8. Bau-Reihenfolge

In dieser Reihenfolge ist die App nach **jedem einzelnen Schritt** lauffähig und
deploybar. Kein großer Umbau, der drei Tage kaputt ist.

1. **Spalten und Migration.** Von außen ändert sich nichts. Einmal deployen,
   prüfen, dass Bestandskunden weiterarbeiten.
2. **Falle 1 und 2 reparieren.** `get_wirk_user` kopiert die neuen Felder,
   `/login` prüft `aktiv`. Noch bevor es Kollegen gibt — danach wäre es eine
   Sicherheitslücke im laufenden Betrieb.
3. **`RECHTE` und `braucht()` einführen.** Erst nur an zwei, drei harmlosen
   Endpunkten. Alle bestehenden Konten sind `inhaber` und merken nichts.
4. **Die fünf `/team`-Endpunkte.** Mit `/docs` von Hand durchtesten, bevor es
   eine Oberfläche gibt.
5. **Fallen 3 bis 8 abarbeiten.** Die Liste einmal von oben nach unten.
6. **`team.js` und die Team-Seite.** Erst jetzt — dann testest du gegen eine
   Schnittstelle, von der du weißt, dass sie stimmt.
7. **`braucht()` auf alle Endpunkte ziehen.** Systematisch durch `server.py`,
   TEIL 5 bis 9. Jeder Endpunkt, der noch `Depends(get_wirk_user)` oder
   `Depends(get_current_user)` hat, ist ungeprüft.
8. **Modul und Plätze in die Pläne.** `teamzugaenge` in `ALL_MODULES`,
   `max_benutzer` pro Plan: Starter 1, Business 5, Flotte unbegrenzt.

---

Danach steht das Fundament für das Freigabe-Modul: Es braucht nur noch zwei
Tabellen — `Vorgang` und `VorgangEreignis` — und kann sofort auf echte Personen
und Rollen zeigen, statt sie erst erfinden zu müssen.
