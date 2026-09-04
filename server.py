"""
===============================================================================
  FleetCompliance – der komplette Server in einer Datei
===============================================================================

  Alles, was die Anwendung braucht, steht hier drin. Frueher war das auf
  main.py, models.py, auth.py, database.py, config.py, geo.py, blobs.py und
  vorlagen_start.py verteilt.

  So ist die Datei aufgebaut:

    TEIL 1   Einstellungen und Datenbank-Verbindung
    TEIL 2   Datenbank-Modelle (welche Tabellen es gibt)
    TEIL 3   Anmeldung: Passwoerter, Token, Berechtigungen
    TEIL 4   Geo: Adressen zu Koordinaten, Routen, Gelaende-Pruefung
    TEIL 5   Moduldaten: Buchhaltung, Lohn, Zeitnachweis
    TEIL 6   Die Anwendung selbst (FastAPI)
    TEIL 7   Konten, Plaene, Verwaltung, Geo-Endpunkte
    TEIL 8   Webseiten und Dateien aus dem static-Ordner
    TEIL 9   Mitarbeiter, Dokumentvorlagen, PDF, Logo, Mandanten
    TEIL 10  Startinhalt der Dokumentvorlagen (nur Text)

  Starten:
    lokal    python server.py
    Railway  uvicorn server:app --host 0.0.0.0 --port $PORT   (siehe Procfile)

===============================================================================
"""
import base64
import json
import math
import mimetypes
import os
import re
import secrets
import time
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Optional

import jwt  # Paket: PyJWT
from dotenv import load_dotenv
from fastapi import (APIRouter, Depends, FastAPI, Header, HTTPException, Query,
                     Request, status)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (FileResponse, HTMLResponse, RedirectResponse,
                               Response, StreamingResponse)
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pwdlib import PasswordHash
from pydantic import BaseModel
from sqlalchemy import text as sql_text
from sqlmodel import (Field, Session, SQLModel, UniqueConstraint, create_engine,
                      select)


# ==============================================================================
# TEIL 1 – EINSTELLUNGEN UND DATENBANK
# ==============================================================================
# Alle Werte kommen aus Umgebungsvariablen. Auf dem eigenen PC stehen sie in
# der Datei .env, bei Railway traegt man sie unter "Variables" ein.

load_dotenv()

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
DASHBOARD_FILE = STATIC_DIR / "pages" / "dashboard.html"

# Port: Railway gibt ihn vor, lokal ist es 8000.
PORT = int(os.getenv("PORT", "8000"))

# Geheimer Schluessel zum Unterschreiben der Anmelde-Token.
# WICHTIG: Bei Railway unter "Variables" einen langen Zufallswert eintragen.
SECRET_KEY = (os.getenv("SECRET_KEY") or "").strip()
if not SECRET_KEY or SECRET_KEY.startswith("dev-only"):
    SECRET_KEY = secrets.token_urlsafe(48)
    print("!" * 70)
    print("! WARNUNG: Es ist kein SECRET_KEY gesetzt.")
    print("! Es wird einer erzeugt - dadurch werden bei jedem Neustart des")
    print("! Servers alle Anmeldungen ungueltig und jeder muss sich neu anmelden.")
    print("! Bitte in Railway unter 'Variables' einen SECRET_KEY eintragen.")
    print("!" * 70, flush=True)

# E-Mail des Superadmin-Kontos. Dieses Konto sieht alle Module inkl.
# Fahrtenbuch und darf Firmen verwalten.
SUPERADMIN_EMAIL = os.getenv("SUPERADMIN_EMAIL", "").strip().lower()

# Passwort fuer das Superadmin-Konto. Ist beides gesetzt (E-Mail + Passwort)
# und gibt es das Konto noch nicht, wird es beim Start automatisch angelegt.
# Ein bereits vorhandenes Konto wird NIE ueberschrieben - das Passwort aenderst
# du danach in der App unter Einstellungen.
SUPERADMIN_PASSWORD = os.getenv("SUPERADMIN_PASSWORD", "")

# Testphase fuer neue Firmen in Tagen
TRIAL_DAYS = int(os.getenv("TRIAL_DAYS", "30"))

# Wie lange eine Anmeldung gilt (in Minuten). 1440 = ein Tag.
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

# Von welchen Webadressen aus die Schnittstelle benutzt werden darf.
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

# Welche Module es ueberhaupt gibt.
ALL_MODULES = ["fahrtenbuch", "zeitnachweis", "lohnberechnung", "buchhaltung",
               "teamzugaenge"]


# ── Rollen und Rechte ────────────────────────────────────────────
# Eine Firma kann mehrere Anmeldungen haben. Was jemand darf, haengt an
# seiner Rolle - nicht mehr nur daran, zu welcher Firma er gehoert.

ROLLE_INHABER = "inhaber"

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

ROLLEN = list(RECHTE.keys())

# Klartext fuer die Oberflaeche
ROLLEN_NAMEN = {
    "inhaber":     "Inhaber",
    "buchhaltung": "Buchhaltung",
    "disposition": "Disposition",
    "nur_lesen":   "Nur lesen",
    "fahrer":      "Fahrer",
}


def _datenbank_url() -> str:
    """Liefert die Datenbank-Adresse in der Schreibweise, die SQLAlchemy versteht.

    Railway stellt die Adresse als 'postgresql://...' bereit. SQLAlchemy sucht
    dann nach dem alten Treiber psycopg2, den wir nicht installieren. Deshalb
    wird die Adresse hier auf 'postgresql+psycopg://' umgeschrieben (Treiber
    psycopg 3, steht in requirements.txt).

    Ohne DATABASE_URL wird lokal eine SQLite-Datei benutzt. ACHTUNG: Auf
    Railway waere diese Datei nach jedem Neustart wieder leer - dort also
    immer eine PostgreSQL-Datenbank hinzufuegen.
    """
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        return f"sqlite:///{BASE_DIR / 'fleetcompliance.db'}"
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _datenbank_url()
IST_POSTGRES = DATABASE_URL.startswith("postgresql")

if IST_POSTGRES:
    # pool_pre_ping: prueft eine Verbindung, bevor sie benutzt wird. Verhindert
    # Fehler, wenn die Datenbank die Verbindung zwischendurch geschlossen hat.
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=280)
else:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

print(f"Datenbank: {'PostgreSQL' if IST_POSTGRES else 'SQLite (nur lokal!)'}", flush=True)


# Spalten, die in aelteren Datenbestaenden fehlen koennen. Wird bei jedem Start
# geprueft - erspart das Loeschen der Tabellen.
_NACHTRAEGLICHE_SPALTEN = [
    ("firma", "gesperrt", "BOOLEAN DEFAULT FALSE"),
    ("firma", "plan", "VARCHAR DEFAULT 'trial'"),
    ("firma", "notes", "VARCHAR DEFAULT ''"),
    ("firma", "rolle", "VARCHAR DEFAULT 'benutzer'"),
    ("user", "passwort_temporaer", "BOOLEAN DEFAULT FALSE"),
    ("firma", "lizenzart", "VARCHAR DEFAULT 'single'"),
    ("firma", "max_firmen", "INTEGER DEFAULT 1"),
    ("firma", "profil_aenderungen", "INTEGER DEFAULT 0"),
    ("passwortanfrage", "typ", "VARCHAR DEFAULT 'passwort'"),
    ("mitarbeiter", "adresse", "VARCHAR DEFAULT ''"),
    ("mitarbeiter", "geburtsdatum", "DATE"),
    ("mitarbeiter", "eintritt", "DATE"),
    ("mitarbeiter", "vertragsart", "VARCHAR DEFAULT ''"),
    ("mitarbeiter", "befristet_bis", "DATE"),
    ("mitarbeiter", "taetigkeit", "VARCHAR DEFAULT ''"),
    # Team-Zugaenge. Der DEFAULT fuellt bestehende Zeilen gleich mit auf:
    # jedes heutige Konto wird damit zum "inhaber" seiner eigenen Firma.
    ("user", "name", "VARCHAR DEFAULT ''"),
    ("user", "rolle", "VARCHAR DEFAULT 'inhaber'"),
    ("user", "aktiv", "BOOLEAN DEFAULT TRUE"),
    ("user", "mitarbeiter_id", "INTEGER"),
    ("user", "letzte_anmeldung", "TIMESTAMP"),
    ("firma", "max_benutzer", "INTEGER DEFAULT 1"),
]


def _ensure_columns():
    with engine.connect() as conn:
        for tabelle, spalte, typ in _NACHTRAEGLICHE_SPALTEN:
            try:
                wenn = "IF NOT EXISTS " if IST_POSTGRES else ""
                conn.execute(sql_text(
                    f'ALTER TABLE "{tabelle}" ADD COLUMN {wenn}{spalte} {typ}'))
                conn.commit()
            except Exception:
                conn.rollback()   # Spalte existiert schon - alles gut


def init_db():
    SQLModel.metadata.create_all(engine)
    _ensure_columns()


def get_session():
    with Session(engine) as session:
        yield session


# ============================================================================
# TEIL 2 – DATENBANK-MODELLE (Tabellen)
# ============================================================================

DEFAULT_MODULES = '["zeitnachweis", "lohnberechnung", "buchhaltung"]'


class Firma(SQLModel, table=True):
    """Ein Mietwagen-Betrieb (Mandant)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    adresse: str = ""
    betriebssitz: str = ""
    bs_lat: Optional[float] = None
    bs_lon: Optional[float] = None
    kennzeichen_json: str = "[]"          # JSON-Liste, z.B. '["NE-MZ2503"]'
    modules_json: str = DEFAULT_MODULES   # welche Module die Firma sieht
    gueltig_bis: Optional[date] = None    # Ende Testphase/Abo
    gesperrt: bool = False                # sofortige Sperre durch Superadmin
    plan: str = "trial"                   # trial | starter | business | flotte
    rolle: str = "benutzer"               # benutzer | admin  (Superadmin kommt aus der .env)
    lizenzart: str = "single"             # single = ein Unternehmen | gruppe = mehrere
    profil_aenderungen: int = 0           # 0 = darf noch einmal aendern, danach gesperrt
    max_firmen: int = 1                   # nur bei "gruppe": wie viele Unternehmen erlaubt sind
    max_benutzer: int = 1                 # wie viele Personen in dieser Firma arbeiten duerfen
    notes: str = ""                       # interne Admin-Notizen (Kunde sieht sie nie)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class User(SQLModel, table=True):
    """Ein Login-Konto. Gehoert genau einer Firma - mehrere Konten pro Firma
    sind moeglich (Team-Zugaenge), jedes mit einer eigenen Rolle."""
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    firma_id: int = Field(foreign_key="firma.id", index=True)
    passwort_temporaer: bool = False      # True = Einmal-Passwort, muss geaendert werden
    created_at: datetime = Field(default_factory=datetime.utcnow)
    name: str = ""                        # Anzeigename, z.B. "Aylin K."
    rolle: str = ROLLE_INHABER            # siehe ROLLEN weiter unten
    aktiv: bool = True                    # False = gesperrt, Anmeldung wird abgelehnt
    mitarbeiter_id: Optional[int] = Field(  # nur bei der Rolle "fahrer" gesetzt
        default=None, foreign_key="mitarbeiter.id")
    letzte_anmeldung: Optional[datetime] = None


class DatenBlob(SQLModel, table=True):
    """Ein JSON-Datenpaket einer Firma (ersetzt die JSON-Dateien der Desktop-Version).

    art  = Datenart:  'buch' | 'lohn_monat' | 'lohn_stamm' | 'zn_stamm'
    key  = Schluessel: Periode ('2026-04'), Monat ('2026-04') oder 'stammdaten'
    data = JSON-Inhalt als Text (unveraendert das, was das Dashboard speichert)
    """
    __table_args__ = (UniqueConstraint("firma_id", "art", "key", name="uq_blob"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    firma_id: int = Field(foreign_key="firma.id", index=True)
    art: str = Field(index=True)
    key: str
    data: str
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Mitarbeiter(SQLModel, table=True):
    """Ein Mitarbeiter/Fahrer, zentral pro Firma gespeichert.

    Stammdaten, die modulübergreifend (Zeitnachweis, Lohn) gelten.
    Zuschläge gehören NICHT hierher - die werden pro Auswertung in der
    Stundenerfassung eingestellt. Monatsdaten (Schichten) bleiben getrennt.
    """
    __table_args__ = (UniqueConstraint("firma_id", "name", name="uq_mitarbeiter_name"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    firma_id: int = Field(foreign_key="firma.id", index=True)
    name: str
    personalnummer: str = ""
    stundenlohn: float = 0.0
    wochenstunden: float = 0.0            # vertragliche Stunden pro Woche
    adresse: str = ""                     # fuer den Arbeitsvertrag
    geburtsdatum: Optional[date] = None
    eintritt: Optional[date] = None
    vertragsart: str = ""                 # minijob | teilzeit | vollzeit
    befristet_bis: Optional[date] = None  # leer = unbefristet
    taetigkeit: str = ""                  # Mietwagenfahrer | Betriebsleiter | Geschaeftsfuehrer | Buerokraft
    aktiv: bool = True                    # ausgeschiedene MA ausblenden statt loeschen
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GeoCache(SQLModel, table=True):
    """Globaler Cache fuer Geocoding/Reverse/Routen (kein Firmenbezug)."""
    cache_key: str = Field(primary_key=True)
    value: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Plan(SQLModel, table=True):
    """Abo-Plan: vom Superadmin frei konfigurierbar (Preis, Text, Aktion)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(index=True)               # interner Schluessel, z.B. 'starter'
    name: str = "Neuer Plan"                   # Anzeigename
    preis_monat: float = 0.0
    preis_jahr: float = 0.0
    beschreibung: str = ""                     # kurzer Text unter dem Namen
    features_json: str = "[]"                  # Liste von Leistungspunkten
    modules_json: str = "[]"                   # enthaltene Module
    aktiv: bool = True                         # auf der Website sichtbar
    empfohlen: bool = False                    # "beliebtester Plan"-Hinweis
    sortierung: int = 0
    aktion_text: str = ""                      # z.B. "Sommeraktion"
    aktion_prozent: float = 0.0                # Rabatt in Prozent
    aktion_bis: Optional[date] = None          # Aktion laeuft bis


class PasswortAnfrage(SQLModel, table=True):
    """Ein Kunde hat 'Passwort vergessen' gemeldet."""
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True)
    firma_id: Optional[int] = Field(default=None, foreign_key="firma.id", index=True)
    firma_name: str = ""
    typ: str = "passwort"                  # passwort | profil
    status: str = "offen"                  # offen | erledigt
    erstellt_am: datetime = Field(default_factory=datetime.utcnow)
    erledigt_am: Optional[datetime] = None


class Mandant(SQLModel, table=True):
    """Welche Firma (Mandant) darf ein Konto zusaetzlich bearbeiten."""
    id: Optional[int] = Field(default=None, primary_key=True)
    inhaber_firma_id: int = Field(foreign_key="firma.id", index=True)
    mandant_firma_id: int = Field(foreign_key="firma.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Dokumentvorlage(SQLModel, table=True):
    """Vorlage fuer Arbeitsvertrag, Kuendigung usw. - vom Superadmin bearbeitbar."""
    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(index=True)            # vollzeit | teilzeit | minijob | kuendigung | aufhebung
    titel: str = ""
    text: str = ""
    aktiv: bool = True
    sortierung: int = 0
    geaendert_am: datetime = Field(default_factory=datetime.utcnow)
    geaendert_von: str = ""


class FirmaLogo(SQLModel, table=True):
    """Logo eines Betriebs (als Data-URL, PNG/JPEG). Erscheint auf Verträgen,
    Lohnabrechnung, Trinkgeld und Quittung. Getrennt von der Firma-Tabelle,
    damit die (teils größeren) Bilddaten nicht bei jeder Firmen-Abfrage mitgeladen werden."""
    firma_id: int = Field(primary_key=True, foreign_key="firma.id")
    data: str = ""                        # "data:image/png;base64,...."
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ============================================================================
# TEIL 3 – ANMELDUNG: Passwoerter, Token, Berechtigungen
# ============================================================================


import jwt  # Paket: PyJWT
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pwdlib import PasswordHash


# --- Passwoerter ---
_pwd = PasswordHash.recommended()

def hash_password(plain: str) -> str:
    return _pwd.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    return _pwd.verify(plain, hashed)

# --- JWT-Token ---
ALGORITHM = "HS256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def create_access_token(user_id: int, firma_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "firma_id": firma_id, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> User:
    """Liest den Token, prueft ihn und liefert den angemeldeten Nutzer."""
    fehler = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Nicht angemeldet oder Token ungueltig",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except Exception:
        raise fehler
    user = session.get(User, user_id)
    if user is None:
        raise fehler
    # Die Rolle steht bewusst NICHT im Token, sondern wird bei jeder Anfrage
    # frisch aus der Datenbank gelesen. So wirkt eine Sperre oder eine
    # geaenderte Rolle sofort und nicht erst, wenn der Token ablaeuft.
    if not user.aktiv:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Dieser Zugang wurde gesperrt.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user

# ─────────────── Mehrere Mandanten (Kanzlei / Admin) ───────────────


def ist_superadmin(user: User) -> bool:
    return bool(SUPERADMIN_EMAIL) and user.email.lower() == SUPERADMIN_EMAIL.lower()


def darf_mandanten_fuehren(user: User, session: Session) -> bool:
    """Mehrere Firmen betreuen darf, wer die Lizenzart "gruppe" hat."""
    if ist_superadmin(user):
        return True
    firma = session.get(Firma, user.firma_id)
    return bool(firma and (firma.lizenzart or "single") == "gruppe")


def darf_firma_bearbeiten(user: User, session: Session, firma_id: int) -> bool:
    """Die eigene Firma immer; sonst nur zugeordnete Mandanten (Superadmin: alle)."""
    if firma_id == user.firma_id:
        return True
    if ist_superadmin(user):
        return session.get(Firma, firma_id) is not None
    zuordnung = session.exec(
        select(Mandant).where(Mandant.inhaber_firma_id == user.firma_id,
                              Mandant.mandant_firma_id == firma_id)
    ).first()
    return zuordnung is not None


def get_wirk_user(x_mandant: Optional[int] = Header(default=None, alias="X-Mandant"),
                  current: User = Depends(get_current_user),
                  session: Session = Depends(get_session)) -> User:
    """Wie get_current_user - aber wenn ein Mandant aktiv ist, zeigt firma_id
    auf dessen Firma. So arbeiten alle Modul-Daten automatisch im richtigen Betrieb."""
    if x_mandant is None or x_mandant == current.firma_id:
        return current
    if (current.rolle or ROLLE_INHABER) == "fahrer":
        # Die schwaechste Rolle darf nicht die breiteste Tuer oeffnen.
        raise HTTPException(status_code=403, detail="Kein Zugriff auf andere Betriebe")
    if not darf_firma_bearbeiten(current, session, x_mandant):
        raise HTTPException(status_code=403, detail="Kein Zugriff auf diesen Mandanten")
    # Losgeloeste Kopie - wird nur gelesen, nie gespeichert.
    # WICHTIG: rolle, aktiv und name muessen mit. Fehlen sie, faellt die Rolle
    # auf den Standardwert "inhaber" zurueck - und jeder Kollege haette beim
    # Umschalten auf einen Mandanten dort volle Inhaber-Rechte.
    return User(id=current.id, email=current.email,
                password_hash=current.password_hash, firma_id=x_mandant,
                name=current.name, rolle=current.rolle, aktiv=current.aktiv,
                mitarbeiter_id=current.mitarbeiter_id)


# ─────────────── Rechteprüfung ───────────────

def hat_recht(user: User, recht: str) -> bool:
    """Darf dieser Benutzer das? Der Superadmin darf immer alles."""
    if ist_superadmin(user):
        return True
    return recht in RECHTE.get(user.rolle or ROLLE_INHABER, set())


def braucht(recht: str, auch_lesend: bool = False):
    """Abhaengigkeit fuer Endpunkte, die ein bestimmtes Recht voraussetzen.

    Ersetzt Depends(get_wirk_user) und liefert denselben Benutzer zurueck -
    der Rest des Endpunkts bleibt also unveraendert, inklusive der
    Mandanten-Umschaltung ueber X-Mandant.

        def lohn_save(..., current: User = Depends(braucht("lohn"))):

    auch_lesend=True bei Abfragen: dann genuegt auch das Nur-Lesen-Recht,
    also z.B. "lohn_lesen" statt "lohn". So sieht die Rolle "nur_lesen"
    die Daten, kann sie aber nicht aendern.
    """
    def pruefer(current: User = Depends(get_wirk_user)) -> User:
        if hat_recht(current, recht):
            return current
        if auch_lesend and hat_recht(current, recht + "_lesen"):
            return current
        raise HTTPException(
            status_code=403,
            detail="Für diese Funktion fehlt dir die Berechtigung. "
                   "Wende dich an den Inhaber deines Betriebs.")
    return pruefer


# ============================================================================
# TEIL 4 – GEO: Adressen, Koordinaten, Routen
# ============================================================================

import re
import json
import math
import time
import urllib.parse
import urllib.request


USER_AGENT = "FleetCompliance/1.0"
ROAD_FACTOR = 1.75  # Luftlinie x Faktor = Strassendistanz (NRW-kalibriert)

# ── Cache: In-Memory + Datenbank ─────────────────────────────────
_mem_cache = {}

def _cache_get(key: str):
    if key in _mem_cache:
        return _mem_cache[key]
    with Session(engine) as s:
        row = s.get(GeoCache, key)
        if row is not None:
            _mem_cache[key] = row.value
            return row.value
    return None

def _cache_set(key: str, value: str):
    _mem_cache[key] = value
    try:
        with Session(engine) as s:
            row = s.get(GeoCache, key)
            if row is None:
                s.add(GeoCache(cache_key=key, value=value))
            else:
                row.value = value
                s.add(row)
            s.commit()
    except Exception:
        pass  # Cache-Fehler duerfen nie die Anfrage brechen


# ── Adress-Normalisierung (unveraendert aus Desktop v12) ─────────
def normalize_address(addr):
    if not addr:
        return ""
    s = addr.strip()
    s = re.sub(r'[\r\n\t]+', ' ', s)
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'([a-zA-ZäöüÄÖÜß])\.(\d)', r'\1. \2', s)
    s = re.sub(r'([a-zäöüß])(\d)', r'\1 \2', s)
    s = re.sub(r'\bStr\.', 'Strasse', s, flags=re.IGNORECASE)
    s = re.sub(r'\bstr\b', 'strasse', s, flags=re.IGNORECASE)
    s = re.sub(r',(\d{5})', r', \1', s)
    s = re.sub(r'(\d{5})([A-ZÄÖÜ])', r'\1 \2', s)
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r',\s*,+', ',', s)
    s = re.sub(r'\s*,\s*', ', ', s)
    return s.strip(' ,')


def simplified_address(addr):
    s = normalize_address(addr)
    parts = [p.strip() for p in s.split(',') if p.strip()]
    if len(parts) > 3:
        s = ', '.join(parts[-3:])
    return s


def extract_street_and_city(addr):
    s = normalize_address(addr)
    parts = [p.strip() for p in s.split(',') if p.strip()]
    result = {"street": "", "plz": "", "city": ""}
    if parts and parts[-1].lower() in ("deutschland", "germany", "de"):
        parts = parts[:-1]
    remaining_parts = []
    for part in parts:
        m = re.match(r'^(\d{5})\s+(.+)$', part)
        if m and not result["plz"]:
            result["plz"] = m.group(1)
            result["city"] = m.group(2)
            continue
        if re.match(r'^\d{5}$', part) and not result["plz"]:
            result["plz"] = part
            continue
        remaining_parts.append(part)
    if remaining_parts:
        street_part = remaining_parts[-1]
        street_only = re.sub(r'\s+\d+\s*[a-zA-Z]?\s*$', '', street_part).strip()
        if not result["city"] and len(remaining_parts) == 1 and not re.search(r'\d', street_part):
            result["city"] = street_part
        else:
            result["street"] = street_only if street_only else street_part
    return result


# ── Photon / Nominatim (unveraendert) ────────────────────────────
def _try_photon(addr, timeout=10):
    try:
        url = "https://photon.komoot.io/api/?" + urllib.parse.urlencode({
            "q": addr, "limit": 5, "lang": "de"
        })
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
        if data.get("features"):
            ALLOWED_KEYS = {"highway", "place", "building", "amenity", "addr", "shop"}
            best, best_q = None, 0
            for feat in data["features"]:
                props = feat.get("properties", {})
                osm_key = props.get("osm_key", "")
                osm_val = props.get("osm_value", "")
                housenumber = props.get("housenumber")
                if osm_key not in ALLOWED_KEYS:
                    continue
                if housenumber:
                    q = 2
                elif osm_key == "place" and osm_val in ("city", "town", "village", "suburb"):
                    q = 1
                elif osm_key == "highway":
                    q = 1
                elif osm_key in ("building", "amenity", "shop"):
                    q = 2
                else:
                    q = 1
                if q > best_q:
                    best, best_q = feat, q
                    if q == 2:
                        break
            if best:
                coords = best["geometry"]["coordinates"]
                return (f"{float(coords[1]):.6f},{float(coords[0]):.6f}", best_q)
    except Exception as e:
        print(f"  Photon-Fehler fuer '{addr[:50]}': {e}")
    return (None, 0)


def _try_nominatim(addr, timeout=10):
    try:
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
            "q": addr, "format": "json", "limit": 5,
            "countrycodes": "de", "addressdetails": 1
        })
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
        if data:
            ALLOWED_CLASSES = {"highway", "place", "building", "amenity", "shop", "office"}
            best, best_q = None, 0
            for feat in data:
                cls = feat.get("class", "")
                if cls not in ALLOWED_CLASSES:
                    continue
                osm_type = cls + "/" + feat.get("type", "")
                importance = float(feat.get("importance", 0))
                addr_details = feat.get("address", {})
                housenumber = addr_details.get("house_number")
                if housenumber:
                    q = 2
                elif "road" in addr_details or "highway" in osm_type:
                    q = 1
                elif "city" in addr_details or "town" in addr_details:
                    q = 1
                else:
                    q = 1 if importance > 0.3 else 0
                if q > best_q:
                    best, best_q = feat, q
                    if q == 2:
                        break
            if best:
                return (f"{float(best['lat']):.6f},{float(best['lon']):.6f}", best_q)
    except Exception as e:
        print(f"  Nominatim-Fehler fuer '{addr[:50]}': {e}")
    return (None, 0)


def _is_valid_result(coords_str):
    if not coords_str or "," not in coords_str:
        return False
    try:
        lat, lon = [float(x) for x in coords_str.split(",")]
    except ValueError:
        return False
    return 47.2 <= lat <= 55.1 and 5.8 <= lon <= 15.1  # DE-Bounding-Box


# ── Geocoding mit Fallback-Kette (unveraendert) ──────────────────
def geocode_address(address):
    if not address or not address.strip():
        return ""
    addr = address.strip()

    # Direkte Koordinaten?
    s = addr.replace(" ", ",")
    parts = [p for p in s.split(",") if p]   # robuster als Desktop: "51.16, 6.44" geht auch
    if len(parts) == 2:
        try:
            lat, lon = float(parts[0]), float(parts[1])
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return f"{lat:.6f},{lon:.6f}"
        except ValueError:
            pass

    normalized = normalize_address(addr)
    cached = _cache_get("geo:" + addr) or _cache_get("geo:" + normalized)
    if cached is not None:
        return cached

    def _accept(c):
        return _is_valid_result(c)

    best_coords, best_q = None, 0

    coords, q = _try_photon(normalized)
    time.sleep(0.2)
    if coords and _accept(coords) and q > best_q:
        best_coords, best_q = coords, q
    if best_q >= 2:
        return _cache_and_return(addr, normalized, best_coords)

    coords, q = _try_nominatim(normalized)
    time.sleep(1.1)
    if coords and _accept(coords) and q > best_q:
        best_coords, best_q = coords, q
    if best_q >= 2:
        return _cache_and_return(addr, normalized, best_coords)

    simplified = simplified_address(addr)
    if simplified != normalized:
        coords, q = _try_photon(simplified)
        time.sleep(0.2)
        if coords and _accept(coords) and q > best_q:
            best_coords, best_q = coords, q
        if best_q >= 2:
            return _cache_and_return(addr, normalized, best_coords)

    parts_info = extract_street_and_city(addr)
    street, plz, city = parts_info.get("street",""), parts_info.get("plz",""), parts_info.get("city","")
    if street and (plz or city):
        street_query = street + (", " + plz if plz else "") + ((" " if plz else ", ") + city if city else "")
        coords, q = _try_photon(street_query)
        time.sleep(0.2)
        if coords and _accept(coords) and q > best_q:
            best_coords, best_q = coords, q
            print(f"  Fallback: Strassen-Mittelpunkt (Photon) fuer '{addr[:50]}'")
        if best_q < 2:
            coords, q = _try_nominatim(street_query)
            time.sleep(1.1)
            if coords and _accept(coords) and q > best_q:
                best_coords, best_q = coords, q
                print(f"  Fallback: Strassen-Mittelpunkt (Nominatim) fuer '{addr[:50]}'")

    if best_q < 1 and (plz or city):
        plz_query = (plz + " " + city) if (plz and city) else (plz + ", Deutschland" if plz else city + ", Deutschland")
        coords, q = _try_nominatim(plz_query)
        time.sleep(1.1)
        if coords and _accept(coords):
            best_coords, best_q = coords, 1
            print(f"  Fallback: PLZ/Stadt-Zentrum fuer '{addr[:50]}'")

    return _cache_and_return(addr, normalized, best_coords if best_coords else "")


def _cache_and_return(addr, normalized, result):
    _cache_set("geo:" + addr, result)
    if normalized != addr:
        _cache_set("geo:" + normalized, result)
    return result


# ── Reverse-Geocoding (unveraendert inkl. Filter) ────────────────
SUSPICIOUS_NAMES = re.compile(
    r'\b(hecke|magistrale|langlaufloipe|reitweg|jagdschneise|forst(strasse|weg)?|'
    r'schleuse|kl\u00e4ranlage|wasserwerk|deponie|steinbruch|silo|kompostier|'
    r'sandgrube|kiesgrube|windrad|hochsitz|feldweg|wirtschaftsweg|waldweg|'
    r'radweg|panoramaweg|themenweg|rundweg)\b',
    re.IGNORECASE
)

def reverse_geocode(lat, lon):
    if not lat or not lon:
        return ""
    key = f"rev:{lat},{lon}"
    cached = _cache_get(key)
    if cached is not None:
        return cached
    try:
        float(lat); float(lon)
    except ValueError:
        return ""

    ALLOWED_KEYS = {"highway", "building", "addr", "amenity", "shop", "office", "place"}
    BAD_AMENITIES = {"waste_disposal", "recycling", "water_tower", "wastewater_plant",
                     "grave_yard", "cemetery", "hunting_stand", "shelter"}
    BAD_HIGHWAYS = {"path", "cycleway", "footway", "bridleway", "track", "steps",
                    "pedestrian", "living_street"}

    def _is_good_feature(p):
        osm_key = (p.get("osm_key") or p.get("class") or "").lower()
        osm_val = (p.get("osm_value") or p.get("type") or "").lower()
        if osm_key not in ALLOWED_KEYS:
            return False
        if osm_key == "amenity" and osm_val in BAD_AMENITIES:
            return False
        if osm_key == "highway" and osm_val in BAD_HIGHWAYS:
            return False
        for candidate in [p.get("street",""), p.get("name",""), p.get("locality",""), p.get("road","")]:
            if candidate and SUSPICIOUS_NAMES.search(candidate):
                return False
        return True

    def _build_address(p):
        street = p.get("street") or p.get("road") or p.get("name") or p.get("locality") or ""
        hnr = p.get("housenumber", "")
        plz = p.get("postcode", "")
        city = (p.get("city") or p.get("town") or p.get("village") or
                p.get("district") or p.get("county") or "")
        line1 = (street + " " + hnr).strip() if hnr else street
        line2 = (plz + " " + city).strip() if plz else city
        return ", ".join([x for x in [line1, line2, "Deutschland"] if x])

    try:
        url = "https://photon.komoot.io/reverse?" + urllib.parse.urlencode({
            "lat": lat, "lon": lon, "lang": "de", "limit": 10
        })
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        if not data.get("features"):
            fallback = f"Adresse nicht gefunden ({lat},{lon}), Deutschland"
            _cache_set(key, fallback)
            return fallback
        for feat in data["features"]:
            p = feat.get("properties", {})
            if _is_good_feature(p):
                addr = _build_address(p)
                if addr and addr != "Deutschland":
                    _cache_set(key, addr)
                    return addr
    except Exception as e:
        print(f"  REVERSE Photon-Fehler: {lat},{lon} - {e}")

    # Nominatim-Fallback
    try:
        url2 = "https://nominatim.openstreetmap.org/reverse?" + urllib.parse.urlencode({
            "lat": lat, "lon": lon, "format": "json",
            "accept-language": "de", "addressdetails": 1
        })
        req2 = urllib.request.Request(url2, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req2, timeout=10) as resp2:
            data2 = json.loads(resp2.read())
        addr2 = data2.get("address", {})
        street = addr2.get("road") or ""
        hnr = addr2.get("house_number", "")
        plz = addr2.get("postcode", "")
        city = (addr2.get("city") or addr2.get("town") or
                addr2.get("village") or addr2.get("suburb") or "")
        if street and SUSPICIOUS_NAMES.search(street):
            street = ""
        if street and city:
            line1 = (street + " " + hnr).strip() if hnr else street + " 1"
            line2 = (plz + " " + city).strip() if plz else city
            addr = ", ".join([line1, line2, "Deutschland"])
            _cache_set(key, addr)
            return addr
    except Exception as e2:
        print(f"  REVERSE Nominatim-Fehler: {lat},{lon} - {e2}")

    fallback = f"Umgebung {lat},{lon}, Deutschland"
    _cache_set(key, fallback)
    return fallback


# ── OSRM: Distanz + Fahrzeit (unveraendert) ──────────────────────
def get_route_distance(frm, to):
    def parse_latlon(s):
        if not s: return None
        p = s.strip().split(",")
        if len(p) != 2: return None
        try: return float(p[0]), float(p[1])
        except Exception: return None

    def haversine(a, b):
        R = 6371.0
        la1, lo1 = math.radians(a[0]), math.radians(a[1])
        la2, lo2 = math.radians(b[0]), math.radians(b[1])
        dp, dl = la2 - la1, lo2 - lo1
        x = math.sin(dp/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dl/2)**2
        return R * 2 * math.atan2(math.sqrt(x), math.sqrt(1-x))

    A, B = parse_latlon(frm), parse_latlon(to)
    if not A or not B:
        return {"dist_km": None, "time_min": None, "method": "error"}

    key = f"route:{frm}|{to}"
    cached = _cache_get(key)
    if cached is not None:
        try:
            return json.loads(cached)
        except Exception:
            pass

    for server in ["http://router.project-osrm.org", "https://routing.openstreetmap.de/routed-car"]:
        try:
            osrm_url = f"{server}/route/v1/driving/{A[1]},{A[0]};{B[1]},{B[0]}?overview=false"
            req = urllib.request.Request(osrm_url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            dist_km = data["routes"][0]["distance"] / 1000.0
            time_min = (dist_km / 70.0) * 60.0
            result = {"dist_km": round(dist_km, 1), "time_min": round(time_min, 1), "method": "osrm"}
            _cache_set(key, json.dumps(result))
            return result
        except Exception as e:
            print(f"  ROUTE FEHLER {server}: {e}")
            continue

    dist_km = haversine(A, B) * ROAD_FACTOR
    time_min = (dist_km / 70.0) * 60.0
    return {"dist_km": round(dist_km, 1), "time_min": round(time_min, 1),
            "method": f"luftlinie x{ROAD_FACTOR}"}


def get_osrm_geometry(from_str, to_str):
    if not from_str or not to_str:
        return {"error": "from/to required"}
    try:
        flat, flon = [float(x.strip()) for x in from_str.split(",")]
        tlat, tlon = [float(x.strip()) for x in to_str.split(",")]
    except Exception as e:
        return {"error": f"invalid coords: {e}"}
    url = (f"https://router.project-osrm.org/route/v1/driving/"
           f"{flon:.6f},{flat:.6f};{tlon:.6f},{tlat:.6f}?geometries=geojson&overview=full")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
        if data.get("code") != "Ok":
            return {"error": f"OSRM: {data.get('code')}"}
        routes = data.get("routes", [])
        if not routes:
            return {"error": "no route"}
        coords = routes[0].get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            return {"error": "geometry too short"}
        return {"coordinates": coords}
    except Exception as e:
        return {"error": f"OSRM request: {e}"}


# ── Terrain-Check (unveraendert) ─────────────────────────────────
_TERRAIN_INVALID = {
    "wood": "wald", "forest": "wald",
    "water": "wasser", "lake": "wasser", "river": "wasser",
    "stream": "wasser", "canal": "wasser", "reservoir": "wasser",
    "bay": "wasser", "pond": "wasser",
    "farmland": "feld", "meadow": "feld", "grass": "feld",
    "scrub": "feld", "heath": "feld", "wetland": "feld",
}

def check_terrain(lat, lon):
    if not lat or not lon:
        return {"ok": True, "type": "unklar"}
    try:
        float(lat); float(lon)
    except ValueError:
        return {"ok": True, "type": "unklar"}
    url = ("https://nominatim.openstreetmap.org/reverse"
           f"?lat={lat}&lon={lon}&format=json&zoom=17&extratags=1&accept-language=de")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT + " (terrain-check)"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"ok": True, "type": "unklar", "error": str(e)}

    category = (data.get("category") or "").lower()
    osm_type = (data.get("type") or "").lower()
    extratags = data.get("extratags") or {}
    landuse = (extratags.get("landuse") or "").lower()
    natural = (extratags.get("natural") or "").lower()

    if category in ("highway", "building", "amenity", "shop", "tourism", "place"):
        return {"ok": True, "type": "strasse", "category": category, "osm_type": osm_type}
    if osm_type in ("residential", "commercial", "industrial", "retail"):
        return {"ok": True, "type": "strasse", "category": category, "osm_type": osm_type}
    bad_type = _TERRAIN_INVALID.get(osm_type) or _TERRAIN_INVALID.get(natural) or _TERRAIN_INVALID.get(landuse)
    if bad_type:
        return {"ok": False, "type": bad_type, "category": category, "osm_type": osm_type}
    if category in ("natural", "landuse", "waterway"):
        return {"ok": False, "type": "unklar", "category": category, "osm_type": osm_type}
    if data.get("display_name"):
        return {"ok": True, "type": "strasse", "category": category, "osm_type": osm_type}
    return {"ok": True, "type": "unklar", "category": category, "osm_type": osm_type}


# ============================================================================
# TEIL 5 – MODULDATEN: Buchhaltung, Lohn, Zeitnachweis
# ============================================================================

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request


daten_router = APIRouter()


def _safe_periode(s: str) -> str:
    safe = "".join(c for c in s if c.isalnum() or c in "-_")[:20]
    return safe or "default"


def _firma_name(session: Session, firma_id: int) -> str:
    f = session.get(Firma, firma_id)
    return f.name if f else ""


def _get_blob(session, firma_id, art, key):
    return session.exec(
        select(DatenBlob).where(
            DatenBlob.firma_id == firma_id,
            DatenBlob.art == art,
            DatenBlob.key == key,
        )
    ).first()


def _set_blob(session, firma_id, art, key, data_obj):
    blob = _get_blob(session, firma_id, art, key)
    payload = json.dumps(data_obj, ensure_ascii=False)
    if blob is None:
        blob = DatenBlob(firma_id=firma_id, art=art, key=key, data=payload)
    else:
        blob.data = payload
        blob.updated_at = datetime.utcnow()
    session.add(blob)
    session.commit()


def _list_keys(session, firma_id, art):
    rows = session.exec(
        select(DatenBlob.key).where(
            DatenBlob.firma_id == firma_id, DatenBlob.art == art
        )
    ).all()
    return sorted(rows)


async def _body_json(request: Request) -> dict:
    try:
        return await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Ungueltiges JSON")


# ─────────────── BUCHHALTUNG ───────────────

@daten_router.get("/buch/list")
def buch_list(current: User = Depends(braucht("buchhaltung", auch_lesend=True)), session: Session = Depends(get_session)):
    return {"firma": _firma_name(session, current.firma_id),
            "periods": _list_keys(session, current.firma_id, "buch")}


@daten_router.get("/buch/load")
def buch_load(periode: str = "", current: User = Depends(braucht("buchhaltung", auch_lesend=True)),
              session: Session = Depends(get_session)):
    periode = periode.strip()
    if not periode:
        return {"error": "periode fehlt"}
    key = _safe_periode(periode)
    blob = _get_blob(session, current.firma_id, "buch", key)
    name = _firma_name(session, current.firma_id)
    if blob is None:
        return {"firma": name, "periode": periode, "exists": False}
    return {"firma": name, "periode": periode, "exists": True, "data": json.loads(blob.data)}


@daten_router.post("/buch/save")
async def buch_save(request: Request, current: User = Depends(braucht("buchhaltung")),
                    session: Session = Depends(get_session)):
    payload = await _body_json(request)
    periode = (payload.get("periode") or "").strip()
    data = payload.get("data")
    if not periode or data is None:
        raise HTTPException(status_code=400, detail="periode, data Pflicht")
    _set_blob(session, current.firma_id, "buch", _safe_periode(periode), data)
    return {"ok": True, "firma": _firma_name(session, current.firma_id), "periode": periode}


# ─────────────── LOHN: STAMMDATEN ───────────────

@daten_router.get("/lohn/stammdaten")
def lohn_stammdaten(current: User = Depends(braucht("lohn", auch_lesend=True)),
                    session: Session = Depends(get_session)):
    blob = _get_blob(session, current.firma_id, "lohn_stamm", "stammdaten")
    name = _firma_name(session, current.firma_id)
    if blob is None:
        return {"firma": name, "mitarbeiter": []}
    data = json.loads(blob.data)
    return {"firma": name, "mitarbeiter": data.get("mitarbeiter", [])}


@daten_router.post("/lohn/stammdaten/save")
async def lohn_stammdaten_save(request: Request, current: User = Depends(braucht("lohn")),
                               session: Session = Depends(get_session)):
    payload = await _body_json(request)
    ma = payload.get("mitarbeiter")
    if ma is None:
        raise HTTPException(status_code=400, detail="mitarbeiter Pflicht")
    _set_blob(session, current.firma_id, "lohn_stamm", "stammdaten",
              {"mitarbeiter": ma, "saved_at": datetime.utcnow().date().isoformat()})
    return {"ok": True, "firma": _firma_name(session, current.firma_id)}


# ─────────────── ZEITNACHWEIS: STAMMDATEN ───────────────

@daten_router.get("/zn/stammdaten")
def zn_stammdaten(current: User = Depends(braucht("zeitnachweis", auch_lesend=True)),
                  session: Session = Depends(get_session)):
    blob = _get_blob(session, current.firma_id, "zn_stamm", "stammdaten")
    name = _firma_name(session, current.firma_id)
    if blob is None:
        return {"firma": name, "mitarbeiter": []}
    data = json.loads(blob.data)
    return {"firma": name, "mitarbeiter": data.get("mitarbeiter", [])}


@daten_router.post("/zn/stammdaten/save")
async def zn_stammdaten_save(request: Request, current: User = Depends(braucht("zeitnachweis")),
                             session: Session = Depends(get_session)):
    payload = await _body_json(request)
    ma = payload.get("mitarbeiter")
    if ma is None:
        raise HTTPException(status_code=400, detail="mitarbeiter Pflicht")
    _set_blob(session, current.firma_id, "zn_stamm", "stammdaten",
              {"mitarbeiter": ma, "saved_at": datetime.utcnow().date().isoformat()})
    return {"ok": True, "firma": _firma_name(session, current.firma_id)}


# ─────────────── LOHN: MONATE ───────────────

@daten_router.get("/lohn/list")
def lohn_list(current: User = Depends(braucht("lohn", auch_lesend=True)), session: Session = Depends(get_session)):
    return {"firma": _firma_name(session, current.firma_id),
            "months": _list_keys(session, current.firma_id, "lohn_monat")}


@daten_router.get("/lohn/load")
def lohn_load(monat: str = "", current: User = Depends(braucht("lohn", auch_lesend=True)),
              session: Session = Depends(get_session)):
    monat = monat.strip()
    if not monat:
        return {"error": "monat fehlt"}
    blob = _get_blob(session, current.firma_id, "lohn_monat", _safe_periode(monat))
    name = _firma_name(session, current.firma_id)
    if blob is None:
        return {"firma": name, "monat": monat, "exists": False}
    return {"firma": name, "monat": monat, "exists": True, "data": json.loads(blob.data)}


@daten_router.post("/lohn/save")
async def lohn_save(request: Request, current: User = Depends(braucht("lohn")),
                    session: Session = Depends(get_session)):
    payload = await _body_json(request)
    monat = (payload.get("monat") or "").strip()
    data = payload.get("data")
    if not monat or data is None:
        raise HTTPException(status_code=400, detail="monat, data Pflicht")
    if not re.match(r"^\d{4}-\d{2}$", monat):
        raise HTTPException(status_code=400, detail="monat muss YYYY-MM Format haben")
    _set_blob(session, current.firma_id, "lohn_monat", monat, data)
    return {"ok": True, "firma": _firma_name(session, current.firma_id), "monat": monat}


@daten_router.post("/lohn/delete")
async def lohn_delete(request: Request, current: User = Depends(braucht("lohn")),
                      session: Session = Depends(get_session)):
    payload = await _body_json(request)
    monat = (payload.get("monat") or "").strip()
    if not monat:
        raise HTTPException(status_code=400, detail="monat Pflicht")
    blob = _get_blob(session, current.firma_id, "lohn_monat", _safe_periode(monat))
    if blob is None:
        return {"ok": True, "info": "Eintrag existierte nicht"}
    session.delete(blob)
    session.commit()
    return {"ok": True}


# ============================================================================
# TEIL 6 – DIE ANWENDUNG (FastAPI)
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Laeuft einmal beim Start: Tabellen anlegen, Standarddaten ergaenzen."""
    init_db()
    _standard_plaene_anlegen()
    _alte_kanzlei_umstellen()
    _vorlagen_anlegen()
    _team_modul_nachtragen()
    _superadmin_anlegen()
    print("FleetCompliance ist bereit.", flush=True)
    yield


app = FastAPI(title="FleetCompliance API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

# Die Moduldaten-Endpunkte aus TEIL 5 anhaengen.
app.include_router(daten_router)

# Browser sollen JavaScript und CSS nicht zwischenspeichern - sonst behalten
# sie nach einer Aenderung die alte Fassung.
_NOCACHE = {"Cache-Control": "no-cache"}


# ============================================================================
# TEIL 7 – KONTEN, PLAENE, VERWALTUNG, GEO-ENDPUNKTE
# ============================================================================

def _is_superadmin(user: User) -> bool:
    return bool(SUPERADMIN_EMAIL) and user.email.strip().lower() == SUPERADMIN_EMAIL


# ─────────────── Konto ───────────────

class RegisterRequest(BaseModel):
    firma_name: str
    email: str
    password: str
    plan: Optional[str] = None


@app.post("/register")
def register(data: RegisterRequest, session: Session = Depends(get_session)):
    firma_name = data.firma_name.strip()
    email = data.email.strip().lower()   # immer klein speichern -> keine Doppel-Konten
    if not firma_name:
        raise HTTPException(status_code=400, detail="Bitte einen Firmennamen angeben")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Bitte eine gueltige E-Mail-Adresse angeben")
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Das Passwort muss mindestens 8 Zeichen haben")
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=400, detail="E-Mail ist bereits registriert")
    gewaehlt = (data.plan or "").strip().lower()
    if gewaehlt and gewaehlt not in _gueltige_plan_keys(session):
        gewaehlt = ""
    firma = Firma(name=firma_name,
                  plan=gewaehlt or "trial",
                  gueltig_bis=date.today() + timedelta(days=TRIAL_DAYS))
    _plan_grenzen_anwenden(firma, firma.plan)
    session.add(firma); session.commit(); session.refresh(firma)
    user = User(email=email, password_hash=hash_password(data.password),
                firma_id=firma.id, rolle=ROLLE_INHABER)
    session.add(user); session.commit(); session.refresh(user)
    return {"nachricht": "Konto erstellt", "firma": firma.name, "email": user.email,
            "testphase_bis": firma.gueltig_bis.isoformat()}


@app.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), session: Session = Depends(get_session)):
    email = form.username.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="E-Mail oder Passwort falsch")
    if not user.aktiv:
        # Bewusst dieselbe Antwort wie bei falschem Passwort - sonst verraet
        # die Seite, welche E-Mail-Adressen es gibt.
        raise HTTPException(status_code=401, detail="E-Mail oder Passwort falsch")
    user.letzte_anmeldung = datetime.utcnow()
    session.add(user); session.commit()
    return {"access_token": create_access_token(user.id, user.firma_id),
            "token_type": "bearer", "superadmin": _is_superadmin(user)}


@app.get("/me")
def me(current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    firma = session.get(Firma, current.firma_id)
    rolle = current.rolle or ROLLE_INHABER
    return {"id": current.id,
            "email": current.email, "firma": firma.name, "firma_id": current.firma_id,
            "superadmin": _is_superadmin(current),
            # "rolle" kommt weiterhin aus der FIRMA (benutzer | admin) - der
            # Schluessel bleibt belegt, damit admin-app.js unveraendert laeuft.
            "rolle": "superadmin" if _is_superadmin(current) else (firma.rolle or "benutzer"),
            # Die Rolle der PERSON steht unter einem eigenen Namen daneben.
            "benutzerrolle": rolle,
            "rollenname": ROLLEN_NAMEN.get(rolle, rolle),
            "name": current.name or "",
            "rechte": sorted(RECHTE[ROLLE_INHABER] if _is_superadmin(current)
                             else RECHTE.get(rolle, set())),
            "passwort_temporaer": bool(getattr(current, "passwort_temporaer", False))}


class ProfilRequest(BaseModel):
    adresse: Optional[str] = None
    betriebssitz: Optional[str] = None
    bs_lat: Optional[float] = None
    bs_lon: Optional[float] = None
    kennzeichen: Optional[list] = None


@app.post("/firma/profil")
def firma_profil(data: ProfilRequest, current: User = Depends(braucht("firmenprofil")),
                 session: Session = Depends(get_session)):
    firma = session.get(Firma, current.firma_id)
    if data.adresse is not None: firma.adresse = data.adresse
    if data.betriebssitz is not None: firma.betriebssitz = data.betriebssitz
    if data.bs_lat is not None: firma.bs_lat = data.bs_lat
    if data.bs_lon is not None: firma.bs_lon = data.bs_lon
    if data.kennzeichen is not None:
        firma.kennzeichen_json = json.dumps([str(k).strip().upper() for k in data.kennzeichen])
    session.add(firma); session.commit()
    return {"ok": True}


# ─────────────── License-Status (Dashboard-kompatibel) ───────────────

def _team_modul_nachtragen():
    """Traegt das Team-Modul bei Firmen nach, die es laut Tarif haben muessten.

    Warum das noetig ist: _plan_grenzen_anwenden() laeuft nur beim Anlegen einer
    Firma und beim Tarifwechsel. Alle Firmen, die es vor der Einfuehrung der
    Team-Zugaenge schon gab, haetten das Modul sonst nie bekommen - bei ihnen
    bliebe der Menuepunkt "Team" fuer immer unsichtbar.

    Laeuft genau einmal pro Firma: Danach steht max_benutzer auf 3, 5 oder 500
    und die Bedingung unten trifft nicht mehr zu. Ein Superadmin, der das Modul
    spaeter bewusst entfernt, bekommt es also nicht wieder untergeschoben.
    """
    with Session(engine) as s:
        geaendert = 0
        for firma in s.exec(select(Firma)).all():
            plan = firma.plan or "trial"
            if plan not in PLAN_MIT_TEAM:
                continue
            if (firma.max_benutzer or 1) > 1:
                continue                      # schon einmal gesetzt - nicht anfassen
            module = json.loads(firma.modules_json or DEFAULT_MODULES)
            if "teamzugaenge" in module:
                continue
            _plan_grenzen_anwenden(firma, plan)
            s.add(firma)
            geaendert += 1
        if geaendert:
            s.commit()
            print(f"  Nachgetragen: Team-Zugaenge fuer {geaendert} Firma(en)", flush=True)


def _superadmin_anlegen():
    """Legt das Superadmin-Konto beim Start an, falls es noch nicht existiert.

    Dafuer muessen SUPERADMIN_EMAIL und SUPERADMIN_PASSWORD gesetzt sein.
    Ein vorhandenes Konto wird nie angefasst - auch das Passwort nicht.
    Nebenbei verhindert das, dass sich jemand anderes mit deiner E-Mail
    registriert und dadurch Superadmin wird.
    """
    if not SUPERADMIN_EMAIL:
        return
    with Session(engine) as s:
        vorhanden = s.exec(select(User).where(User.email == SUPERADMIN_EMAIL)).first()
        if vorhanden:
            return
        if len(SUPERADMIN_PASSWORD) < 8:
            print("Hinweis: Superadmin-Konto fehlt noch. Zum automatischen Anlegen "
                  "SUPERADMIN_PASSWORD setzen (mindestens 8 Zeichen) - sonst einfach "
                  "auf der Startseite mit dieser E-Mail registrieren.", flush=True)
            return
        firma = Firma(name="FleetCompliance (Verwaltung)", plan="business",
                      rolle="admin", lizenzart="gruppe", max_firmen=500,
                      max_benutzer=500,
                      gueltig_bis=date(2099, 12, 31),
                      modules_json=json.dumps(ALL_MODULES))
        s.add(firma); s.commit(); s.refresh(firma)
        s.add(User(email=SUPERADMIN_EMAIL,
                   password_hash=hash_password(SUPERADMIN_PASSWORD),
                   firma_id=firma.id, rolle=ROLLE_INHABER, name="Superadmin"))
        s.commit()
        print(f"Superadmin-Konto angelegt: {SUPERADMIN_EMAIL}", flush=True)


def _vorlagen_anlegen():
    """Legt die Dokumentvorlagen beim ersten Start an.
    Bestehende Vorlagen werden nie ueberschrieben - der Superadmin pflegt sie."""
    with Session(engine) as s:
        for key, v in VORLAGEN.items():
            if s.exec(select(Dokumentvorlage).where(Dokumentvorlage.key == key)).first():
                continue
            s.add(Dokumentvorlage(key=key, titel=v["titel"], text=v["text"],
                                  sortierung=v.get("sortierung", 0), geaendert_von="System"))
        s.commit()


def _alte_kanzlei_umstellen():
    """Frueher war "kanzlei" eine Rolle. Jetzt ist es die Lizenzart "gruppe"."""
    with Session(engine) as s:
        betroffen = s.exec(select(Firma).where(Firma.rolle == "kanzlei")).all()
        for f in betroffen:
            f.rolle = "benutzer"
            f.lizenzart = "gruppe"
            if not f.max_firmen or f.max_firmen < 2:
                f.max_firmen = 5
            s.add(f)
        if betroffen:
            s.commit()
            print(f"  Umgestellt: {len(betroffen)} Firma(en) von Rolle 'kanzlei' auf Lizenzart 'gruppe'")


def _standard_plaene_anlegen():
    """Legt die vier Standard-Plaene an, falls noch keine existieren."""
    with Session(engine) as s:
        if s.exec(select(Plan)).first():
            return
        vorlagen = [
            dict(key="trial", name="Testphase", preis_monat=0.0, preis_jahr=0.0, sortierung=0,
                 beschreibung="30 Tage kostenlos testen",
                 features_json=json.dumps(["Alle Module", "30 Tage", "Keine Zahlung noetig"])),
            dict(key="starter", name="Starter", preis_monat=29.0, preis_jahr=290.0, sortierung=1,
                 beschreibung="Fuer kleine Betriebe",
                 features_json=json.dumps(["Zeitnachweis", "Bis 5 Fahrer",
                                           "1 Zugang", "E-Mail-Support"])),
            dict(key="business", name="Business", preis_monat=59.0, preis_jahr=590.0, sortierung=2,
                 empfohlen=True, beschreibung="Fuer wachsende Betriebe",
                 features_json=json.dumps(["Alle Module", "Unbegrenzte Fahrer",
                                           "5 Team-Zugaenge", "Vorrangiger Support"])),
            dict(key="flotte", name="Flotte", preis_monat=99.0, preis_jahr=990.0, sortierung=3,
                 beschreibung="Fuer grosse Flotten",
                 features_json=json.dumps(["Alle Module", "Unbegrenzt",
                                           "Unbegrenzte Team-Zugaenge", "Telefon-Support"])),
        ]
        for v in vorlagen:
            s.add(Plan(modules_json=DEFAULT_MODULES, **v))
        s.commit()


# Wie viele Zugaenge und welche Module ein Tarif mitbringt. Wird beim Anlegen
# und beim Tarifwechsel angewandt; der Superadmin kann danach frei nachjustieren.
PLAN_BENUTZER = {"trial": 3, "starter": 1, "business": 5, "flotte": 500}
PLAN_MIT_TEAM = {"trial", "business", "flotte"}


def _plan_grenzen_anwenden(firma: Firma, plan_key: str):
    """Setzt Platzgrenze und das Modul teamzugaenge passend zum Tarif."""
    firma.max_benutzer = PLAN_BENUTZER.get(plan_key, 1)
    module = json.loads(firma.modules_json or DEFAULT_MODULES)
    if plan_key in PLAN_MIT_TEAM:
        if "teamzugaenge" not in module:
            module.append("teamzugaenge")
    else:
        module = [m for m in module if m != "teamzugaenge"]
    firma.modules_json = json.dumps(module)


def _plan_dict(p: Plan) -> dict:
    def _liste(txt):
        try:
            v = json.loads(txt or "[]")
            return v if isinstance(v, list) else []
        except Exception:
            return []
    aktion_aktiv = bool(p.aktion_prozent) and (not p.aktion_bis or p.aktion_bis >= date.today())
    preis_akt = round(p.preis_monat * (1 - p.aktion_prozent / 100.0), 2) if aktion_aktiv else p.preis_monat
    return {
        "id": p.id, "key": p.key, "name": p.name,
        "preis_monat": p.preis_monat, "preis_jahr": p.preis_jahr,
        "beschreibung": p.beschreibung or "",
        "features": _liste(p.features_json), "modules": _liste(p.modules_json),
        "aktiv": bool(p.aktiv), "empfohlen": bool(p.empfohlen), "sortierung": p.sortierung or 0,
        "aktion_text": p.aktion_text or "", "aktion_prozent": p.aktion_prozent or 0.0,
        "aktion_bis": p.aktion_bis.isoformat() if p.aktion_bis else None,
        "aktion_aktiv": aktion_aktiv, "preis_aktuell": preis_akt,
    }


@app.get("/plaene")
def plaene_oeffentlich(session: Session = Depends(get_session)):
    """Oeffentlich: aktive Plaene fuer die Website."""
    plaene = session.exec(select(Plan).where(Plan.aktiv == True).order_by(Plan.sortierung)).all()
    return {"plaene": [_plan_dict(p) for p in plaene]}


@app.get("/admin/plaene")
def admin_plaene(current: User = Depends(get_current_user),
                 session: Session = Depends(get_session)):
    _require_admin(current, session)
    plaene = session.exec(select(Plan).order_by(Plan.sortierung)).all()
    return {"plaene": [_plan_dict(p) for p in plaene]}


class PlanRequest(BaseModel):
    id: Optional[int] = None
    key: str
    name: str
    preis_monat: float = 0.0
    preis_jahr: float = 0.0
    beschreibung: str = ""
    features: Optional[list] = None
    modules: Optional[list] = None
    aktiv: bool = True
    empfohlen: bool = False
    sortierung: int = 0
    aktion_text: str = ""
    aktion_prozent: float = 0.0
    aktion_bis: Optional[str] = None


@app.post("/admin/plaene/speichern")
def admin_plan_speichern(data: PlanRequest,
                         current: User = Depends(get_current_user),
                         session: Session = Depends(get_session)):
    _require_admin(current, session)
    key = (data.key or "").strip().lower()
    if not key:
        raise HTTPException(status_code=400, detail="Schluessel darf nicht leer sein")
    if data.aktion_prozent < 0 or data.aktion_prozent > 100:
        raise HTTPException(status_code=400, detail="Rabatt muss zwischen 0 und 100 liegen")
    bis = None
    if data.aktion_bis:
        try:
            bis = date.fromisoformat(data.aktion_bis)
        except ValueError:
            raise HTTPException(status_code=400, detail="aktion_bis muss YYYY-MM-DD sein")

    if data.id:
        plan = session.get(Plan, data.id)
        if not plan:
            raise HTTPException(status_code=404, detail="Plan nicht gefunden")
    else:
        doppelt = session.exec(select(Plan).where(Plan.key == key)).first()
        if doppelt:
            raise HTTPException(status_code=409, detail=f"Schluessel '{key}' gibt es schon")
        plan = Plan(key=key)

    plan.key = key
    plan.name = (data.name or "").strip() or key
    plan.preis_monat = float(data.preis_monat or 0)
    plan.preis_jahr = float(data.preis_jahr or 0)
    plan.beschreibung = (data.beschreibung or "")[:500]
    if data.features is not None:
        plan.features_json = json.dumps([str(f)[:120] for f in data.features])
    if data.modules is not None:
        plan.modules_json = json.dumps(data.modules)
    plan.aktiv = bool(data.aktiv)
    plan.empfohlen = bool(data.empfohlen)
    plan.sortierung = int(data.sortierung or 0)
    plan.aktion_text = (data.aktion_text or "")[:120]
    plan.aktion_prozent = float(data.aktion_prozent or 0)
    plan.aktion_bis = bis
    session.add(plan); session.commit(); session.refresh(plan)
    return {"ok": True, "plan": _plan_dict(plan)}


class PlanLoeschenRequest(BaseModel):
    id: int


@app.post("/admin/plaene/loeschen")
def admin_plan_loeschen(data: PlanLoeschenRequest,
                        current: User = Depends(get_current_user),
                        session: Session = Depends(get_session)):
    _require_admin(current, session)
    plan = session.get(Plan, data.id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan nicht gefunden")
    benutzt = session.exec(select(Firma).where(Firma.plan == plan.key)).first()
    if benutzt:
        raise HTTPException(status_code=409,
                            detail=f"Plan wird noch von '{benutzt.name}' benutzt")
    session.delete(plan); session.commit()
    return {"ok": True}


class PasswortRequest(BaseModel):
    alt: str
    neu: str


@app.post("/me/passwort")
def passwort_aendern(data: PasswortRequest,
                     current: User = Depends(get_current_user),
                     session: Session = Depends(get_session)):
    """Eigenes Passwort aendern. Prueft das alte Passwort zur Sicherheit."""
    if not verify_password(data.alt, current.password_hash):
        raise HTTPException(status_code=400, detail="Aktuelles Passwort ist falsch")
    if len(data.neu) < 8:
        raise HTTPException(status_code=400, detail="Neues Passwort muss mindestens 8 Zeichen haben")
    current.password_hash = hash_password(data.neu)
    current.passwort_temporaer = False
    session.add(current)
    session.commit()
    return {"ok": True}


@app.get("/license-status")
def license_status(current: User = Depends(get_current_user),
                   session: Session = Depends(get_session)):
    firma = session.get(Firma, current.firma_id)

    # Hinweis: Betriebssitz und Kennzeichen werden bewusst NICHT mehr als
    # Lizenzangaben geliefert. In der Desktop-Version sperrte sich die Anwendung
    # selbst, wenn die Eingabe davon abwich - ein Kopierschutz, der in der Cloud
    # keinen Zweck mehr hat (der Zugang laeuft ueber die Anmeldung) und beim
    # Wechsel zwischen mehreren Betrieben nur Fehlalarme ausloest.
    # Die Firmendaten kommen jetzt ueber /me/firmenprofil.
    if _is_superadmin(current):
        payload = {
            "ok": True, "version": "admin",
            "firma": firma.name, "adresse": firma.adresse,
            "modules": ALL_MODULES,
            "mandanten": [],
            "gueltig_bis": "2099-12-31",
        }
    else:
        if firma.gesperrt:
            return {"ok": False,
                    "fehler": "Konto gesperrt. Bitte Kontakt aufnehmen: Fleetcompliance@gmail.com"}
        if firma.gueltig_bis and date.today() > firma.gueltig_bis:
            return {"ok": False,
                    "fehler": f"Testphase/Abo abgelaufen am {firma.gueltig_bis.isoformat()}. "
                              f"Bitte Kontakt aufnehmen."}
        payload = {
            "ok": True, "version": "customer",
            "firma": firma.name, "adresse": firma.adresse,
            "modules": json.loads(firma.modules_json or DEFAULT_MODULES),
            "mandanten": [],
            "gueltig_bis": firma.gueltig_bis.isoformat() if firma.gueltig_bis else "",
        }
    if firma.bs_lat is not None: payload["bs_lat"] = firma.bs_lat
    if firma.bs_lon is not None: payload["bs_lon"] = firma.bs_lon
    # Darf diese Anmeldung die Verwaltung oeffnen? (Superadmin oder Lizenz-Art "admin")
    payload["verwaltung"] = _ist_admin(current, session)
    payload["rolle"] = "superadmin" if _is_superadmin(current) else (firma.rolle or "benutzer")
    return payload


@app.get("/version")
def version():
    return {"version": "cloud-1.0",
            "endpoints": ["/geocode", "/reverse", "/check_terrain", "/route",
                          "/license-status", "/version"]}


@app.get("/health")
def health():
    return {"status": "ok", "service": "FleetCompliance API"}


# ─────────────── Desktop-Altlasten (harmlose No-Ops) ───────────────
# Das Dashboard ruft diese Endpoints auf; online duerfen sie nichts tun.

@app.post("/shutdown")
def shutdown_noop(current: User = Depends(get_current_user)):
    return {"ok": True, "info": "Cloud-Version: Server laeuft weiter, bitte einfach abmelden."}


# ─────────────── Geo-Endpoints (portiert) ───────────────

@app.get("/geocode")
def geocode_ep(q: str = "", current: User = Depends(get_current_user)):
    return {"coords": geocode_address(q), "query": q}


@app.get("/reverse")
def reverse_ep(lat: str = "", lon: str = "", current: User = Depends(get_current_user)):
    return {"address": reverse_geocode(lat, lon)}


@app.get("/route")
def route_ep(frm: str = Query("", alias="from"), to: str = "",
             current: User = Depends(get_current_user)):
    return get_route_distance(frm, to)


@app.get("/osrm-geom")
def osrm_geom_ep(frm: str = Query("", alias="from"), to: str = "",
                 current: User = Depends(get_current_user)):
    try:
        return get_osrm_geometry(frm, to)
    except Exception as e:
        return {"error": str(e)}


@app.get("/check_terrain")
def check_terrain_ep(lat: str = "", lon: str = "", current: User = Depends(get_current_user)):
    try:
        return check_terrain(lat, lon)
    except Exception as e:
        return {"ok": True, "type": "unklar", "error": str(e)}


# ─────────────── Superadmin ───────────────

def _require_superadmin(current: User):
    if not _is_superadmin(current):
        raise HTTPException(status_code=403, detail="Nur fuer Superadmin")


def _ist_admin(current: User, session: Session) -> bool:
    """Superadmin oder eine Firma mit der Lizenz-Art 'admin'."""
    if _is_superadmin(current):
        return True
    firma = session.get(Firma, current.firma_id)
    return bool(firma and (firma.rolle or "benutzer") == "admin")


def _require_admin(current: User, session: Session):
    if not _ist_admin(current, session):
        raise HTTPException(status_code=403, detail="Kein Zugriff auf die Verwaltung")


def _superadmin_firma_id(session: Session):
    """Die Firma des Superadmins - die darf ein normaler Admin nicht anfassen."""
    if not SUPERADMIN_EMAIL:
        return None
    u = session.exec(select(User).where(User.email == SUPERADMIN_EMAIL)).first()
    return u.firma_id if u else None


def _inhaber_der_firma(session: Session, firma_id: int) -> Optional[User]:
    """Der Haupt-Zugang einer Firma. Das ist der Inhaber - und nur wenn es
    gar keinen gibt (sehr alte Datenbestaende), der aelteste Zugang."""
    leute = session.exec(select(User).where(User.firma_id == firma_id)
                         .order_by(User.id)).all()
    for u in leute:
        if (u.rolle or ROLLE_INHABER) == ROLLE_INHABER:
            return u
    return leute[0] if leute else None


def _schuetze_superadmin(current: User, session: Session, firma_id: int):
    """Verhindert, dass ein Admin das Superadmin-Konto aendert oder loescht."""
    if _is_superadmin(current):
        return
    if firma_id == _superadmin_firma_id(session):
        raise HTTPException(status_code=403,
                            detail="Das Superadmin-Konto kann nicht geaendert werden")


@app.get("/admin/firmen")
def admin_firmen(current: User = Depends(get_current_user),
                 session: Session = Depends(get_session)):
    _require_admin(current, session)
    _sa_firma = _superadmin_firma_id(session)
    rows = session.exec(select(Firma).order_by(Firma.id)).all()
    users = session.exec(select(User)).all()
    emails_by_firma = {}
    for u in users:
        emails_by_firma.setdefault(u.firma_id, []).append(u.email)
    aktivitaet = {}
    for b in session.exec(select(DatenBlob)).all():
        alt = aktivitaet.get(b.firma_id)
        if alt is None or b.updated_at > alt:
            aktivitaet[b.firma_id] = b.updated_at
    return {"firmen": [{
        "id": f.id, "name": f.name, "adresse": f.adresse,
        "betriebssitz": f.betriebssitz,
        "emails": emails_by_firma.get(f.id, []),
        "modules": json.loads(f.modules_json or DEFAULT_MODULES),
        "gueltig_bis": f.gueltig_bis.isoformat() if f.gueltig_bis else None,
        "gesperrt": bool(f.gesperrt),
        "plan": f.plan or "trial",
        "rolle": f.rolle or "benutzer",
        "lizenzart": f.lizenzart or "single",
        "max_firmen": f.max_firmen or 1,
        "max_benutzer": f.max_benutzer or 1,
        "benutzer_aktiv": len([e for e in emails_by_firma.get(f.id, [])]),
        "zugeordnet": _anzahl_mandanten(session, f.id),
        "ist_superadmin": (f.id == _sa_firma),
        "notes": f.notes or "",
        "letzte_aktivitaet": aktivitaet[f.id].date().isoformat() if f.id in aktivitaet else None,
        "created_at": f.created_at.date().isoformat(),
    } for f in rows]}


PLAENE = ["trial", "starter", "business", "flotte"]   # Fallback, falls DB leer


def _gueltige_plan_keys(session: Session) -> list:
    """Erlaubte Plan-Schluessel: aus der Datenbank, sonst die Standardliste."""
    keys = [p.key for p in session.exec(select(Plan)).all()]
    return keys or PLAENE


class FirmaUpdateRequest(BaseModel):
    firma_id: int
    modules: Optional[list] = None
    gueltig_bis: Optional[str] = None   # 'YYYY-MM-DD'
    name: Optional[str] = None
    adresse: Optional[str] = None
    email: Optional[str] = None
    rolle: Optional[str] = None
    lizenzart: Optional[str] = None
    max_firmen: Optional[int] = None
    max_benutzer: Optional[int] = None
    gesperrt: Optional[bool] = None
    plan: Optional[str] = None
    notes: Optional[str] = None


@app.post("/admin/firmen/update")
def admin_firmen_update(data: FirmaUpdateRequest, current: User = Depends(get_current_user),
                        session: Session = Depends(get_session)):
    _require_admin(current, session)
    _schuetze_superadmin(current, session, data.firma_id)
    firma = session.get(Firma, data.firma_id)
    if firma is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    if data.modules is not None:
        bad = [m for m in data.modules if m not in ALL_MODULES]
        if bad:
            raise HTTPException(status_code=400, detail=f"Unbekannte Module: {bad}")
        firma.modules_json = json.dumps(data.modules)
    if data.gueltig_bis is not None:
        try:
            firma.gueltig_bis = date.fromisoformat(data.gueltig_bis)
        except ValueError:
            raise HTTPException(status_code=400, detail="gueltig_bis muss YYYY-MM-DD sein")
    if data.gesperrt is not None:
        firma.gesperrt = data.gesperrt
    if data.plan is not None:
        if data.plan not in _gueltige_plan_keys(session):
            raise HTTPException(status_code=400, detail=f"Unbekannter Plan: {data.plan}")
        wechsel = data.plan != (firma.plan or "")
        firma.plan = data.plan
        # Tarifwechsel zieht Plaetze und das Team-Modul mit - ausser der Admin
        # setzt in derselben Anfrage etwas Eigenes.
        if wechsel and data.modules is None and data.max_benutzer is None:
            _plan_grenzen_anwenden(firma, data.plan)
    if data.max_benutzer is not None:
        anzahl = int(data.max_benutzer)
        if anzahl < 1 or anzahl > 500:
            raise HTTPException(status_code=400,
                                detail="Anzahl Zugänge muss zwischen 1 und 500 liegen")
        belegt = _plaetze_belegt(session, firma.id)
        if anzahl < belegt:
            raise HTTPException(status_code=400,
                                detail=f"Es sind bereits {belegt} Zugänge aktiv")
        firma.max_benutzer = anzahl
    if data.rolle is not None:
        if data.rolle not in ("benutzer", "admin"):
            raise HTTPException(status_code=400, detail=f"Unbekannte Rolle: {data.rolle}")
        firma.rolle = data.rolle
    if data.lizenzart is not None:
        if data.lizenzart not in ("single", "gruppe"):
            raise HTTPException(status_code=400, detail=f"Unbekannte Lizenzart: {data.lizenzart}")
        firma.lizenzart = data.lizenzart
        if data.lizenzart == "single":
            firma.max_firmen = 1
    if data.max_firmen is not None:
        anzahl = int(data.max_firmen)
        if anzahl < 1 or anzahl > 500:
            raise HTTPException(status_code=400, detail="Anzahl muss zwischen 1 und 500 liegen")
        schon = _anzahl_mandanten(session, firma.id)
        if anzahl < schon:
            raise HTTPException(status_code=400,
                                detail=f"Es sind bereits {schon} Unternehmen zugeordnet")
        firma.max_firmen = anzahl
    if data.notes is not None:
        firma.notes = data.notes[:2000]
    if data.name is not None:
        neu = data.name.strip()
        if not neu:
            raise HTTPException(status_code=400, detail="Firmenname darf nicht leer sein")
        firma.name = neu
    if data.adresse is not None:
        firma.adresse = data.adresse.strip()
    if data.email is not None:
        neu_mail = data.email.strip().lower()
        if neu_mail:
            # Haupt-User dieser Firma finden = der Inhaber-Zugang.
            # NICHT einfach "der erste" - sobald es Team-Zugaenge gibt,
            # koennte das ein Kollege sein.
            haupt = _inhaber_der_firma(session, firma.id)
            if haupt:
                # pruefen ob die neue E-Mail schon woanders vergeben ist
                konflikt = session.exec(select(User).where(User.email == neu_mail)).first()
                if konflikt and konflikt.id != haupt.id:
                    raise HTTPException(status_code=409, detail="E-Mail ist bereits vergeben")
                haupt.email = neu_mail
                session.add(haupt)
    session.add(firma); session.commit()
    return {"ok": True, "firma": firma.name,
            "modules": json.loads(firma.modules_json),
            "gueltig_bis": firma.gueltig_bis.isoformat() if firma.gueltig_bis else None,
            "gesperrt": bool(firma.gesperrt), "plan": firma.plan, "notes": firma.notes or ""}


class FirmaAnlegenRequest(BaseModel):
    firma_name: str
    email: str
    password: str
    plan: str = "trial"
    rolle: str = "benutzer"
    lizenzart: str = "single"
    max_firmen: int = 1
    max_benutzer: Optional[int] = None
    gueltig_bis: Optional[str] = None
    modules: Optional[list] = None


@app.post("/admin/firmen/anlegen")
def admin_firmen_anlegen(data: FirmaAnlegenRequest, current: User = Depends(get_current_user),
                         session: Session = Depends(get_session)):
    """Superadmin legt eine Firma samt Zugang direkt an (Partner, Kunden vor Ort)."""
    _require_admin(current, session)
    firma_name = data.firma_name.strip()
    email = data.email.strip().lower()
    if not firma_name:
        raise HTTPException(status_code=400, detail="Bitte einen Firmennamen angeben")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Bitte eine gueltige E-Mail-Adresse angeben")
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Das Passwort muss mindestens 8 Zeichen haben")
    if data.plan not in _gueltige_plan_keys(session):
        raise HTTPException(status_code=400, detail=f"Unbekannter Plan: {data.plan}")
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=400, detail="E-Mail ist bereits registriert")
    if data.modules is not None:
        bad = [m for m in data.modules if m not in ALL_MODULES]
        if bad:
            raise HTTPException(status_code=400, detail=f"Unbekannte Module: {bad}")
    try:
        bis = date.fromisoformat(data.gueltig_bis) if data.gueltig_bis else date.today() + timedelta(days=TRIAL_DAYS)
    except ValueError:
        raise HTTPException(status_code=400, detail="gueltig_bis muss YYYY-MM-DD sein")
    firma = Firma(name=firma_name, plan=data.plan, rolle=(data.rolle or "benutzer"),
                  lizenzart=(data.lizenzart if data.lizenzart in ("single", "gruppe") else "single"),
                  max_firmen=max(1, int(data.max_firmen or 1)), gueltig_bis=bis,
                  modules_json=json.dumps(data.modules) if data.modules is not None else DEFAULT_MODULES)
    _plan_grenzen_anwenden(firma, firma.plan)
    if data.max_benutzer is not None:
        firma.max_benutzer = max(1, int(data.max_benutzer))
    session.add(firma); session.commit(); session.refresh(firma)
    user = User(email=email, password_hash=hash_password(data.password),
                firma_id=firma.id, rolle=ROLLE_INHABER)
    session.add(user); session.commit()
    return {"ok": True, "firma_id": firma.id, "firma": firma.name, "email": email,
            "plan": firma.plan, "gueltig_bis": bis.isoformat()}


class FirmaDeleteRequest(BaseModel):
    firma_id: int


class PasswortAnfrageRequest(BaseModel):
    email: str


@app.post("/passwort-anfrage")
def passwort_anfrage(data: PasswortAnfrageRequest, session: Session = Depends(get_session)):
    """Oeffentlich: Kunde meldet 'Passwort vergessen'.
    Antwortet immer gleich - so verraet die Seite nicht, welche E-Mails es gibt."""
    email = (data.email or "").strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Bitte eine gueltige E-Mail-Adresse angeben")
    nutzer = session.exec(select(User).where(User.email == email)).first()
    if nutzer:
        offen = session.exec(select(PasswortAnfrage)
                             .where(PasswortAnfrage.email == email)
                             .where(PasswortAnfrage.status == "offen")).first()
        if not offen:
            firma = session.get(Firma, nutzer.firma_id)
            session.add(PasswortAnfrage(email=email, firma_id=nutzer.firma_id,
                                        firma_name=firma.name if firma else ""))
            session.commit()
    return {"ok": True}


@app.get("/admin/passwort-anfragen")
def admin_passwort_anfragen(current: User = Depends(get_current_user),
                            session: Session = Depends(get_session)):
    _require_admin(current, session)
    zeilen = session.exec(select(PasswortAnfrage)
                          .order_by(PasswortAnfrage.id.desc())).all()
    return {"anfragen": [{
        "id": a.id, "email": a.email, "firma_id": a.firma_id,
        "firma_name": a.firma_name or "", "status": a.status,
        "typ": getattr(a, "typ", "passwort"),
        "erstellt_am": a.erstellt_am.strftime("%d.%m.%Y %H:%M"),
        "erledigt_am": a.erledigt_am.strftime("%d.%m.%Y %H:%M") if a.erledigt_am else None,
    } for a in zeilen],
        "offen": sum(1 for a in zeilen if a.status == "offen")}


class AnfrageErledigtRequest(BaseModel):
    id: int


@app.post("/admin/passwort-anfragen/erledigt")
def admin_anfrage_erledigt(data: AnfrageErledigtRequest,
                           current: User = Depends(get_current_user),
                           session: Session = Depends(get_session)):
    _require_admin(current, session)
    a = session.get(PasswortAnfrage, data.id)
    if a is None:
        raise HTTPException(status_code=404, detail="Anfrage nicht gefunden")
    a.status = "erledigt"
    a.erledigt_am = datetime.utcnow()
    session.add(a); session.commit()
    return {"ok": True}


class PasswortSetzenRequest(BaseModel):
    email: str
    einmal_passwort: str
    neues_passwort: str


@app.post("/passwort-setzen")
def passwort_setzen(data: PasswortSetzenRequest, session: Session = Depends(get_session)):
    """Oeffentlich: Kunde setzt mit dem Einmal-Passwort ein eigenes Passwort.
    Funktioniert nur, solange das Einmal-Passwort gilt."""
    email = (data.email or "").strip().lower()
    nutzer = session.exec(select(User).where(User.email == email)).first()
    fehler = HTTPException(status_code=400,
                           detail="E-Mail oder Einmal-Passwort stimmt nicht")
    if not nutzer or not nutzer.passwort_temporaer:
        raise fehler
    if not verify_password(data.einmal_passwort, nutzer.password_hash):
        raise fehler
    if len(data.neues_passwort) < 8:
        raise HTTPException(status_code=400,
                            detail="Das neue Passwort muss mindestens 8 Zeichen haben")
    nutzer.password_hash = hash_password(data.neues_passwort)
    nutzer.passwort_temporaer = False
    session.add(nutzer); session.commit()
    return {"ok": True}


class PasswortNeuRequest(BaseModel):
    firma_id: int


@app.post("/admin/firmen/passwort-neu")
def admin_passwort_neu(data: PasswortNeuRequest,
                       current: User = Depends(get_current_user),
                       session: Session = Depends(get_session)):
    """Erzeugt ein Einmal-Passwort fuer den Hauptbenutzer einer Firma.
    Der Kunde muss es nach dem Anmelden selbst aendern."""
    _require_admin(current, session)
    _schuetze_superadmin(current, session, data.firma_id)
    firma = session.get(Firma, data.firma_id)
    if firma is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    nutzer = _inhaber_der_firma(session, firma.id)
    if nutzer is None:
        raise HTTPException(status_code=404, detail="Zu dieser Firma gibt es keinen Benutzer")
    neues = _einmal_passwort()
    nutzer.password_hash = hash_password(neues)
    nutzer.passwort_temporaer = True
    session.add(nutzer)
    for a in session.exec(select(PasswortAnfrage)
                          .where(PasswortAnfrage.email == nutzer.email)
                          .where(PasswortAnfrage.status == "offen")).all():
        a.status = "erledigt"; a.erledigt_am = datetime.utcnow()
        session.add(a)
    session.commit()
    return {"ok": True, "email": nutzer.email, "passwort": neues}


@app.post("/admin/firmen/delete")
def admin_firmen_delete(data: FirmaDeleteRequest, current: User = Depends(get_current_user),
                        session: Session = Depends(get_session)):
    _require_admin(current, session)
    _schuetze_superadmin(current, session, data.firma_id)
    if data.firma_id == current.firma_id:
        raise HTTPException(status_code=400, detail="Die eigene Admin-Firma kann nicht geloescht werden")
    firma = session.get(Firma, data.firma_id)
    if firma is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    name = firma.name          # vor dem Loeschen merken
    fid = firma.id
    try:
        # Alles, was an dieser Firma haengt, zuerst entfernen -
        # sonst bleiben Reste zurueck und das Loeschen schlaegt fehl.
        for b in session.exec(select(DatenBlob).where(DatenBlob.firma_id == fid)).all():
            session.delete(b)
        for m in session.exec(select(Mitarbeiter).where(Mitarbeiter.firma_id == fid)).all():
            session.delete(m)
        for z in session.exec(select(Mandant).where(Mandant.inhaber_firma_id == fid)).all():
            session.delete(z)
        for z in session.exec(select(Mandant).where(Mandant.mandant_firma_id == fid)).all():
            session.delete(z)
        for a in session.exec(select(PasswortAnfrage).where(PasswortAnfrage.firma_id == fid)).all():
            session.delete(a)
        for u in session.exec(select(User).where(User.firma_id == fid)).all():
            session.delete(u)
        session.flush()
        session.delete(firma)
        session.commit()
    except Exception as fehler:
        session.rollback()
        raise HTTPException(status_code=400,
                            detail=f"Firma konnte nicht geloescht werden: {fehler}")
    return {"ok": True, "geloescht": name}


# Kompatibilitaet: das Dashboard-Admin-Panel fragt /admin/mandanten ab.
@app.get("/admin/mandanten")
def admin_mandanten(current: User = Depends(get_current_user),
                    session: Session = Depends(get_session)):
    if not _is_superadmin(current):
        return {"mandanten": [], "max_mandanten": None}
    rows = session.exec(select(Firma).order_by(Firma.id)).all()
    return {"mandanten": [{
        "id": f"m_{f.id}", "firma": f.name, "adresse": f.adresse,
        "betriebssitz": f.betriebssitz,
        "bs_lat": str(f.bs_lat) if f.bs_lat is not None else "",
        "bs_lon": str(f.bs_lon) if f.bs_lon is not None else "",
        "kennzeichen": json.loads(f.kennzeichen_json or "[]"),
        "created_at": f.created_at.date().isoformat(),
    } for f in rows], "max_mandanten": None}


@app.post("/admin/mandanten/save")
def admin_mandanten_save_blocked(current: User = Depends(get_current_user)):
    raise HTTPException(status_code=403,
        detail="Cloud-Version: Firmen registrieren sich selbst; Verwaltung ueber /admin/firmen.")


@app.post("/admin/mandanten/delete-data")
def admin_mandanten_delete_blocked(current: User = Depends(get_current_user)):
    raise HTTPException(status_code=403,
        detail="Cloud-Version: Daten-Loeschung erfolgt ueber die Firmen-Verwaltung.")


# ============================================================================
# TEIL 8 – WEBSEITEN UND DATEIEN (static-Ordner)
# ============================================================================

# Der static-Ordner ist in Unterordner sortiert:
#
#   static/css     Aussehen   (shell.css, mitarbeiter.css, fonts.css ...)
#   static/js      Bedienung  (shell.js, mitarbeiter.js, shim.js ...)
#   static/pages   Seiten     (landing.html, login.html, admin.html, dashboard.html)
#   static/icons   Symbole    (favicon, apple-touch-icon)
#   static/fonts   Schriften  (woff2)
#
# Die Adressen im Browser bleiben trotzdem genau wie vorher
# (z.B. /app/shell.css oder /app/assets/fonts.css). Die Funktion unten sucht
# eine angefragte Datei einfach in allen Unterordnern. Dadurch mussten die
# HTML-Dateien nicht angefasst werden.

_ASSET_ORDNER = ("css", "js", "pages", "icons", "fonts")


def _asset_pfad(pfad: str) -> Optional[Path]:
    """Sucht eine Datei im static-Ordner. Gibt None zurueck, wenn es sie nicht
    gibt oder wenn jemand versucht, aus dem Ordner auszubrechen (../)."""
    teile = [t for t in pfad.split("/") if t and t not in (".", "..")]
    if not teile:
        return None
    kandidaten = [STATIC_DIR.joinpath(*teile)]
    if len(teile) == 1:
        kandidaten += [STATIC_DIR / ordner / teile[0] for ordner in _ASSET_ORDNER]
    wurzel = STATIC_DIR.resolve()
    for k in kandidaten:
        try:
            ziel = k.resolve()
            ziel.relative_to(wurzel)          # muss innerhalb von static liegen
        except (ValueError, OSError):
            continue
        if ziel.is_file():
            return ziel
    return None


def _asset_antwort(pfad: str, nocache: bool = True) -> FileResponse:
    datei = _asset_pfad(pfad)
    if datei is None:
        raise HTTPException(status_code=404, detail=f"Datei nicht gefunden: {pfad}")
    typ = mimetypes.guess_type(datei.name)[0] or "application/octet-stream"
    return FileResponse(datei, media_type=typ, headers=_NOCACHE if nocache else {})


def _version(name: str) -> int:
    """Zeitstempel einer Datei - haengt an der Adresse, damit der Browser nach
    einer Aenderung wirklich die neue Fassung laedt."""
    datei = _asset_pfad(name)
    try:
        return int(datei.stat().st_mtime) if datei else 0
    except OSError:
        return 0


def _seite(name: str) -> FileResponse:
    return FileResponse(STATIC_DIR / "pages" / name, media_type="text/html",
                        headers=_NOCACHE)


# ─────────────── Die einzelnen Seiten ───────────────

@app.get("/")
def seite_start():
    return _seite("landing.html")


@app.get("/impressum")
def seite_impressum():
    return _seite("impressum.html")


@app.get("/datenschutz")
def seite_datenschutz():
    return _seite("datenschutz.html")


@app.get("/admin")
def seite_admin():
    return _seite("admin.html")


@app.get("/favicon.ico")
def seite_favicon():
    return _asset_antwort("favicon.ico", nocache=False)


@app.get("/app/")
def app_login():
    """Die alte Anmeldeseite entfaellt - immer zur Startseite mit der Anmelde-Karte."""
    return RedirectResponse(url="/?anmelden=1", status_code=307)


# ─────────────── Das Dashboard ───────────────
# dashboard.html ist gross (rund 700 KB). Es wird einmal gelesen, das
# Login-Script wird hineingesetzt und das Ergebnis gemerkt. Beim naechsten
# Aufruf geht es dann sofort raus.
_dashboard_cache = {"stand": None, "html": ""}


def _dashboard_html() -> str:
    stand = DASHBOARD_FILE.stat().st_mtime
    if _dashboard_cache["stand"] == stand:
        return _dashboard_cache["html"]

    html = DASHBOARD_FILE.read_text(encoding="utf-8", errors="replace")
    einbau = (
        f'<script src="/app/shim.js?v={_version("shim.js")}"></script>'
        '<link rel="stylesheet" href="/app/assets/fonts.css">'
        f'<link rel="stylesheet" href="/app/shell.css?v={_version("shell.css")}">'
        f'<link rel="stylesheet" href="/app/zn-redesign.css?v={_version("zn-redesign.css")}">'
        f'<link rel="stylesheet" href="/app/mitarbeiter.css?v={_version("mitarbeiter.css")}">'
        f'<script src="/app/shell.js?v={_version("shell.js")}" defer></script>'
        f'<script src="/app/zn-redesign.js?v={_version("zn-redesign.js")}" defer></script>'
        f'<script src="/app/mitarbeiter.js?v={_version("mitarbeiter.js")}" defer></script>'
        f'<script src="/app/bridge.js?v={_version("bridge.js")}" defer></script>'
        f'<link rel="stylesheet" href="/app/settings.css?v={_version("settings.css")}">'
        f'<script src="/app/settings.js?v={_version("settings.js")}" defer></script>'
        f'<link rel="stylesheet" href="/app/mandanten.css?v={_version("mandanten.css")}">'
        f'<script src="/app/mandanten.js?v={_version("mandanten.js")}" defer></script>'
        f'<link rel="stylesheet" href="/app/team.css?v={_version("team.css")}">'
        f'<script src="/app/team.js?v={_version("team.js")}" defer></script>'
    )
    stelle = html.lower().find("<head>")
    if stelle != -1:
        ab = stelle + len("<head>")
        html = html[:ab] + "\n" + einbau + html[ab:]
    else:
        html = einbau + "\n" + html

    _dashboard_cache["stand"] = stand
    _dashboard_cache["html"] = html
    return html


@app.get("/app/dashboard")
def app_dashboard():
    """Liefert das echte Dashboard aus und setzt dabei das Login-Script hinein.
    Die Dashboard-Datei selbst bleibt unveraendert."""
    if not DASHBOARD_FILE.exists():
        return HTMLResponse(
            "<h2>dashboard.html fehlt</h2>"
            "<p>Bitte die Datei <b>dashboard.html</b> in den Ordner "
            "<b>static/pages/</b> legen.</p>", status_code=500)
    return HTMLResponse(_dashboard_html())


# ─────────────── Dateien aus dem static-Ordner ───────────────
# Diese beiden Wege muessen NACH allen festen Adressen stehen, sonst wuerden
# sie z.B. /app/dashboard abfangen.

@app.get("/app/assets/{pfad:path}")
def app_assets(pfad: str):
    """Schriften, Symbole und alles, was aus einer CSS-Datei nachgeladen wird."""
    return _asset_antwort(pfad, nocache=False)


@app.get("/app/{datei}")
def app_datei(datei: str):
    """Die CSS- und JS-Dateien der App: /app/shell.css, /app/shim.js usw."""
    return _asset_antwort(datei, nocache=True)


# ============================================================================
# TEIL 9 – MITARBEITER, VORLAGEN, PDF, LOGO, MANDANTEN
# ============================================================================

# ─────────────────────────── Mitarbeiter-Verwaltung ───────────────────────────
class MitarbeiterRequest(BaseModel):
    name: str
    personalnummer: str = ""
    stundenlohn: Optional[float] = None
    wochenstunden: Optional[float] = None
    aktiv: bool = True
    firma_id: Optional[int] = None
    adresse: Optional[str] = None
    geburtsdatum: Optional[str] = None
    eintritt: Optional[str] = None
    vertragsart: Optional[str] = None
    befristet_bis: Optional[str] = None
    taetigkeit: Optional[str] = None


def _ma_dict(m: Mitarbeiter) -> dict:
    return {"id": m.id, "firma_id": m.firma_id,
            "name": m.name, "personalnummer": m.personalnummer,
            "stundenlohn": m.stundenlohn, "wochenstunden": m.wochenstunden,
            "adresse": m.adresse or "",
            "geburtsdatum": m.geburtsdatum.isoformat() if m.geburtsdatum else "",
            "eintritt": m.eintritt.isoformat() if m.eintritt else "",
            "vertragsart": m.vertragsart or "",
            "befristet_bis": m.befristet_bis.isoformat() if m.befristet_bis else "",
            "taetigkeit": m.taetigkeit or "",
            "aktiv": m.aktiv}


def _datum_oder_none(text):
    """'2026-07-01' -> date, leer oder ungueltig -> None."""
    if not text:
        return None
    try:
        return date.fromisoformat(str(text)[:10])
    except ValueError:
        return None


def _ziel_firma(current: User, session: Session, firma_id: Optional[int]) -> int:
    """Eigene Firma - oder ein zugeordneter Mandant (Superadmin: jede Firma)."""
    if firma_id is None or firma_id == current.firma_id:
        return current.firma_id
    if not darf_firma_bearbeiten(current, session, firma_id):
        raise HTTPException(status_code=403, detail="Keine Berechtigung fuer diese Firma")
    if session.get(Firma, firma_id) is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    return firma_id


def _grenze_pruefen(session: Session, inhaber_id: int):
    """Wirft einen Fehler, wenn die erlaubte Anzahl Unternehmen erreicht ist."""
    firma = session.get(Firma, inhaber_id)
    if firma is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    grenze = firma.max_firmen or 1
    schon = _anzahl_mandanten(session, inhaber_id)
    if schon >= grenze:
        raise HTTPException(status_code=409,
                            detail=f"Grenze erreicht: {schon} von {grenze} Unternehmen belegt")


def _anzahl_mandanten(session: Session, firma_id: int) -> int:
    return len(session.exec(select(Mandant)
                            .where(Mandant.inhaber_firma_id == firma_id)).all())


# ───────────────────────── Dokumentvorlagen ───────────────────────────────────
PLATZHALTER_HILFE = [
    ("firma_name", "Name der Firma"),
    ("firma_strasse", "Straße der Firma"),
    ("firma_plz_ort", "PLZ und Ort der Firma"),
    ("firma_anschrift", "Anschrift der Firma in einer Zeile"),
    ("ma_name", "Name des Mitarbeiters"),
    ("ma_anrede", "Herr / Frau"),
    ("ma_strasse", "Straße des Mitarbeiters"),
    ("ma_plz_ort", "PLZ und Ort des Mitarbeiters"),
    ("ma_anschrift", "Anschrift des Mitarbeiters in einer Zeile"),
    ("geburtsdatum", "Geburtsdatum"),
    ("eintritt", "Eintrittsdatum"),
    ("befristung", "unbefristet / befristet bis TT.MM.JJJJ"),
    ("beendigung_zum", "Beendigungsdatum (Kündigung, Aufhebung)"),
    ("vertrag_vom", "Datum des Arbeitsvertrags"),
    ("taetigkeit", "Tätigkeit, z.B. Mietwagenfahrer"),
    ("wochenstunden", "Wochenstunden"),
    ("arbeitstage", "Arbeitstage pro Woche"),
    ("urlaubstage", "Urlaubstage im Jahr"),
    ("stundenlohn", "Stundenlohn, z.B. 13,50 €"),
    ("ort", "Ort für die Unterschriftzeile"),
    ("datum_heute", "heutiges Datum"),
    ("luecke", "Leere Linie im Fließtext zum handschriftlichen Ausfüllen"),
]

# Steuerzeichen (kein Platzhalter, sondern eine Anweisung an die Ausgabe)
STEUERZEICHEN = [
    ("[[SEITE]]", "Seitenumbruch - alles danach beginnt auf einer neuen Seite"),
    ("[[LEER]]", "Leerraum zum Ausfüllen (etwa eine Zeile hoch)"),
    ("[[LINIE]]", "Linie zum Unterschreiben oder Ausfüllen"),
    ("[[UNTERSCHRIFT]]", "Zwei Linien nebeneinander: Arbeitgeber und Arbeitnehmer"),
]


def _vorlage_dict(v: Dokumentvorlage, mit_text=True) -> dict:
    d = {"id": v.id, "key": v.key, "titel": v.titel, "aktiv": bool(v.aktiv),
         "sortierung": v.sortierung or 0,
         "geaendert_am": v.geaendert_am.strftime("%d.%m.%Y %H:%M") if v.geaendert_am else "",
         "geaendert_von": v.geaendert_von or ""}
    if mit_text:
        d["text"] = v.text or ""
    return d


@app.get("/vorlagen/{key}")
def vorlage_lesen(key: str, current: User = Depends(get_current_user),
                  session: Session = Depends(get_session)):
    """Fuer die App: den Text einer Vorlage holen."""
    v = session.exec(select(Dokumentvorlage).where(Dokumentvorlage.key == key)).first()
    if v is None or not v.aktiv:
        raise HTTPException(status_code=404, detail="Vorlage nicht gefunden")
    return _vorlage_dict(v)


# Schluessel der fest ausgelieferten Standard-Vorlagen (koennen nicht geloescht werden).
STANDARD_VORLAGEN_KEYS = {"vollzeit", "teilzeit", "minijob", "kuendigung", "aufhebung"}


@app.get("/vorlagen")
def vorlagen_liste(current: User = Depends(get_current_user),
                   session: Session = Depends(get_session)):
    """Fuer die App: alle aktiven Vorlagen (Schluessel + Titel) zum Erzeugen."""
    rows = session.exec(
        select(Dokumentvorlage).where(Dokumentvorlage.aktiv == True)  # noqa: E712
        .order_by(Dokumentvorlage.sortierung)
    ).all()
    return {"vorlagen": [{"key": v.key, "titel": v.titel} for v in rows]}


@app.get("/admin/vorlagen")
def admin_vorlagen(current: User = Depends(get_current_user),
                   session: Session = Depends(get_session)):
    _require_superadmin(current)
    rows = session.exec(select(Dokumentvorlage).order_by(Dokumentvorlage.sortierung)).all()
    return {"vorlagen": [_vorlage_dict(v) for v in rows],
            "platzhalter": [{"name": n, "beschreibung": b} for n, b in PLATZHALTER_HILFE],
            "steuerzeichen": [{"name": n, "beschreibung": b} for n, b in STEUERZEICHEN]}


class VorlageRequest(BaseModel):
    key: str
    titel: Optional[str] = None
    text: Optional[str] = None
    aktiv: Optional[bool] = None


@app.post("/admin/vorlagen/speichern")
def admin_vorlage_speichern(data: VorlageRequest,
                            current: User = Depends(get_current_user),
                            session: Session = Depends(get_session)):
    _require_superadmin(current)
    v = session.exec(select(Dokumentvorlage).where(Dokumentvorlage.key == data.key)).first()
    if v is None:
        # Selbst angelegte Vorlagen hinter die Standard-Vorlagen (1-5) einsortieren.
        v = Dokumentvorlage(key=data.key.strip().lower(), sortierung=900)
    if data.titel is not None:
        v.titel = data.titel.strip()
    if data.text is not None:
        v.text = data.text
    if data.aktiv is not None:
        v.aktiv = bool(data.aktiv)
    v.geaendert_am = datetime.utcnow()
    v.geaendert_von = current.email
    session.add(v); session.commit(); session.refresh(v)
    # Hinweis, falls die Vorlage Platzhalter nutzt, die das Programm nicht kennt.
    # Solche bleiben im fertigen Dokument als {{...}} sichtbar stehen.
    import re as _re
    bekannte = {n for n, _b in PLATZHALTER_HILFE}
    benutzt = set(_re.findall(r"\{\{(\w+)\}\}", v.text or ""))
    ergebnis = _vorlage_dict(v)
    ergebnis["unbekannte_platzhalter"] = sorted(benutzt - bekannte)
    return ergebnis


@app.post("/admin/vorlagen/loeschen")
def admin_vorlage_loeschen(data: VorlageRequest,
                           current: User = Depends(get_current_user),
                           session: Session = Depends(get_session)):
    _require_superadmin(current)
    key = (data.key or "").strip().lower()
    if key in STANDARD_VORLAGEN_KEYS:
        raise HTTPException(status_code=400,
                            detail="Standard-Vorlagen koennen nicht geloescht werden.")
    v = session.exec(select(Dokumentvorlage).where(Dokumentvorlage.key == key)).first()
    if v is None:
        raise HTTPException(status_code=404, detail="Vorlage nicht gefunden")
    session.delete(v)
    session.commit()
    return {"ok": True, "deleted": key}


class DokumentPdfRequest(BaseModel):
    titel: str = "Dokument"
    text: str = ""


@app.post("/dokument/pdf")
def dokument_pdf(data: DokumentPdfRequest,
                 x_mandant: Optional[int] = Header(default=None, alias="X-Mandant"),
                 current: User = Depends(braucht("vertraege")),
                 session: Session = Depends(get_session)):
    """Erzeugt aus dem fertigen Text ein PDF. Der Browser zeigt es direkt an."""
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_JUSTIFY
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
    from reportlab.lib import colors
    from xml.sax.saxutils import escape
    import re as _re

    puffer = BytesIO()
    doc = SimpleDocTemplate(puffer, pagesize=A4,
                            leftMargin=2.2 * cm, rightMargin=2.2 * cm,
                            topMargin=2 * cm, bottomMargin=2 * cm,
                            title=data.titel or "Dokument")
    basis = getSampleStyleSheet()
    fliess = ParagraphStyle("Fliess", parent=basis["Normal"], fontName="Times-Roman",
                            fontSize=10.5, leading=15, alignment=TA_JUSTIFY, spaceAfter=6)
    ueberschrift = ParagraphStyle("Ueber", parent=basis["Normal"], fontName="Times-Bold",
                                  fontSize=11, leading=15, spaceBefore=12, spaceAfter=4)

    inhalt = []
    for absatz in _re.split(r"\n\s*\n", data.text or ""):
        z = absatz.strip()
        if not z:
            continue
        oben = z.upper()
        # Steuerzeichen
        if oben in ("[[SEITE]]", "[[SEITENUMBRUCH]]"):
            inhalt.append(PageBreak())
            continue
        if oben == "[[LEER]]":
            inhalt.append(Spacer(1, 1.2 * cm))
            continue
        if oben.startswith("[[LINIE"):
            # [[LINIE]] oder [[LINIE:Ort, Datum]] - eine Linie zum Ausfuellen
            beschriftung = ""
            if ":" in z:
                beschriftung = z.split(":", 1)[1].rstrip("]").strip()
            inhalt.append(Spacer(1, 1.1 * cm))
            t = Table([[""], [beschriftung]], colWidths=[8 * cm])
            t.setStyle(TableStyle([
                ("LINEBELOW", (0, 0), (0, 0), 0.6, colors.black),
                ("FONTNAME", (0, 1), (0, 1), "Times-Roman"),
                ("FONTSIZE", (0, 1), (0, 1), 9),
                ("TEXTCOLOR", (0, 1), (0, 1), colors.HexColor("#444444")),
                ("TOPPADDING", (0, 1), (0, 1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]))
            inhalt.append(t)
            continue
        if oben.startswith("[[UNTERSCHRIFT"):
            # [[UNTERSCHRIFT]] oder [[UNTERSCHRIFT:Arbeitgeber|Arbeitnehmer]]
            links, rechts = "Unterschrift Arbeitgeber", "Unterschrift Arbeitnehmer"
            if ":" in z:
                teile = z.split(":", 1)[1].rstrip("]").split("|")
                if len(teile) >= 1 and teile[0].strip():
                    links = teile[0].strip()
                if len(teile) >= 2 and teile[1].strip():
                    rechts = teile[1].strip()
            inhalt.append(Spacer(1, 1.6 * cm))
            t = Table([["", ""], [links, rechts]], colWidths=[7.6 * cm, 7.6 * cm])
            t.setStyle(TableStyle([
                ("LINEBELOW", (0, 0), (0, 0), 0.6, colors.black),
                ("LINEBELOW", (1, 0), (1, 0), 0.6, colors.black),
                ("FONTNAME", (0, 1), (-1, 1), "Times-Roman"),
                ("FONTSIZE", (0, 1), (-1, 1), 9),
                ("TEXTCOLOR", (0, 1), (-1, 1), colors.HexColor("#444444")),
                ("TOPPADDING", (0, 1), (-1, 1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (0, -1), 20),
            ]))
            inhalt.append(t)
            continue
        sicher = escape(z).replace("\n", "<br/>")
        # Mehrere Leerzeichen erhalten (reportlab verdichtet sie sonst zu einem).
        # Einzelne Leerzeichen bleiben normal, damit der Zeilenumbruch weiter greift.
        sicher = _re.sub(r"  +", lambda mm: "&nbsp;" * len(mm.group(0)), sicher)
        if _re.match(r"^(§ ?\d+|\d+\.|Anlage \d)", z) and len(z) < 90:
            inhalt.append(Paragraph(sicher, ueberschrift))
        else:
            inhalt.append(Paragraph(sicher, fliess))
    if not inhalt:
        inhalt.append(Paragraph("(leer)", fliess))
    # Firmenlogo oben links, falls fuer diesen Betrieb hinterlegt.
    # Dieselbe Firma wie der Rest der App verwenden (X-Mandant, falls aktiv).
    try:
        _ziel_pdf = _ziel_firma(current, session, x_mandant) if x_mandant else current.firma_id
    except Exception:
        _ziel_pdf = current.firma_id
    _logo = _logo_fuer(session, _ziel_pdf)
    print(f"[Logo] Vertrag-PDF: firma={_ziel_pdf}, logo={'gefunden' if _logo else 'keins'}", flush=True)
    if _logo:
        _m = _re.match(r"^data:image/(png|jpe?g);base64,(.+)$", _logo, _re.DOTALL)
        if _m:
            try:
                import base64 as _b64
                from reportlab.lib.utils import ImageReader
                from reportlab.platypus import Image as RLImage
                _roh = _b64.b64decode(_m.group(2))
                _leser = ImageReader(BytesIO(_roh))
                _bw, _bh = _leser.getSize()
                # In eine Box von max. 6,5cm Breite x 3,8cm Hoehe einpassen (Briefkopf-Groesse).
                _f = min((6.5 * cm) / _bw, (3.8 * cm) / _bh)
                _bild = RLImage(BytesIO(_roh), width=_bw * _f, height=_bh * _f)
                _bild.hAlign = "RIGHT"
                inhalt.insert(0, Spacer(1, 0.4 * cm))
                inhalt.insert(0, _bild)
            except Exception:
                pass
    doc.build(inhalt)
    puffer.seek(0)

    name = _re.sub(r"[^\w\-. ]", "", data.titel or "Dokument").strip() or "Dokument"
    return StreamingResponse(puffer, media_type="application/pdf",
                             headers={"Content-Disposition": f'inline; filename="{name}.pdf"'})


# ───────────────────────── Firmenlogo ─────────────────────────
_LOGO_RE = re.compile(r"^data:image/(png|jpe?g);base64,", re.IGNORECASE)
_LOGO_MAX = 2_000_000   # ~1,5 MB Bild als Data-URL


def _logo_fuer(session: Session, firma_id: int) -> str:
    row = session.get(FirmaLogo, firma_id)
    return row.data if (row and row.data) else ""


def _logo_verarbeiten(daten: str) -> str:
    """Prueft und bereitet das hochgeladene Logo auf, damit es auf allen Dokumenten
    (Vertrag-PDF, Word, Lohn/Trinkgeld/Quittung) zuverlaessig passt:
    - oeffnet das Bild und stellt sicher, dass es ein echtes Bild ist
    - normalisiert den Farbmodus (CMYK/Palette -> RGB/RGBA, entfernt Problemquellen)
    - begrenzt die Kantenlaenge auf 800px (kleiner, schneller, sauber skaliert)
    - speichert einheitlich als PNG (Transparenz bleibt erhalten)
    Faellt bei einem Fehler auf das Original zurueck, blockiert also nie."""
    try:
        from io import BytesIO as _BytesIO
        from PIL import Image
        import base64 as _b64
        _kopf, b64 = daten.split(",", 1)
        im = Image.open(_BytesIO(_b64.b64decode(b64)))
        im.load()
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA")
        max_kante = 800
        if max(im.size) > max_kante:
            faktor = max_kante / float(max(im.size))
            im = im.resize((max(1, int(im.width * faktor)), max(1, int(im.height * faktor))), Image.LANCZOS)
        aus = _BytesIO()
        im.save(aus, format="PNG", optimize=True)
        return "data:image/png;base64," + _b64.b64encode(aus.getvalue()).decode()
    except Exception:
        return daten


@app.get("/me/logo")
def logo_lesen(firma_id: Optional[int] = None,
               x_mandant: Optional[int] = Header(default=None, alias="X-Mandant"),
               current: User = Depends(get_current_user),
               session: Session = Depends(get_session)):
    if firma_id is None:
        firma_id = x_mandant
    ziel = _ziel_firma(current, session, firma_id)
    return {"logo": _logo_fuer(session, ziel)}


class LogoRequest(BaseModel):
    logo: str = ""
    firma_id: Optional[int] = None


@app.post("/me/logo")
def logo_speichern(data: LogoRequest,
                   x_mandant: Optional[int] = Header(default=None, alias="X-Mandant"),
                   current: User = Depends(braucht("firmenprofil")),
                   session: Session = Depends(get_session)):
    firma_id = data.firma_id if data.firma_id is not None else x_mandant
    ziel = _ziel_firma(current, session, firma_id)
    daten = (data.logo or "").strip()
    row = session.get(FirmaLogo, ziel)
    if not daten:
        # Leeres Logo = entfernen (faellt auf FleetCompliance-Logo zurueck)
        if row:
            session.delete(row)
            session.commit()
        return {"logo": ""}
    if not _LOGO_RE.match(daten):
        raise HTTPException(status_code=400, detail="Nur PNG- oder JPEG-Bilder werden unterstuetzt.")
    if len(daten) > _LOGO_MAX:
        raise HTTPException(status_code=400,
                            detail="Das Logo ist zu groß (max. ca. 1,5 MB). Bitte ein kleineres Bild verwenden.")
    # Bild pruefen und einheitlich aufbereiten, damit es ueberall passt.
    daten = _logo_verarbeiten(daten)
    if row is None:
        row = FirmaLogo(firma_id=ziel, data=daten)
    else:
        row.data = daten
        row.updated_at = datetime.utcnow()
    session.add(row)
    session.commit()
    return {"logo": daten}


# ───────────────────────── Firmenprofil (Anschrift, Betriebssitz) ─────────────
def _profil_dict(firma: Firma) -> dict:
    return {
        "name": firma.name,
        "adresse": firma.adresse or "",
        "betriebssitz": firma.betriebssitz or "",
        "bs_lat": firma.bs_lat,
        "bs_lon": firma.bs_lon,
        "gesperrt": (firma.profil_aenderungen or 0) >= 1,
        "aenderungen": firma.profil_aenderungen or 0,
    }


@app.get("/me/firmenprofil")
def firmenprofil_lesen(x_mandant: Optional[int] = Header(default=None, alias="X-Mandant"),
                       current: User = Depends(get_current_user),
                       session: Session = Depends(get_session)):
    ziel = _ziel_firma(current, session, x_mandant)
    firma = session.get(Firma, ziel)
    if firma is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    return _profil_dict(firma)


class FirmenprofilRequest(BaseModel):
    name: Optional[str] = None
    adresse: Optional[str] = None
    betriebssitz: Optional[str] = None
    bs_lat: Optional[float] = None      # von Hand gesetzt - schlaegt die Automatik
    bs_lon: Optional[float] = None


@app.post("/me/firmenprofil")
def firmenprofil_speichern(data: FirmenprofilRequest,
                           x_mandant: Optional[int] = Header(default=None, alias="X-Mandant"),
                           current: User = Depends(braucht("firmenprofil")),
                           session: Session = Depends(get_session)):
    """Der Kunde darf sein Firmenprofil genau einmal aendern.
    Danach ist es gesperrt und muss vom Superadmin freigeschaltet werden."""
    ziel = _ziel_firma(current, session, x_mandant)
    firma = session.get(Firma, ziel)
    if firma is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    if (firma.profil_aenderungen or 0) >= 1:
        raise HTTPException(status_code=403,
                            detail="Das Firmenprofil ist gesperrt. Bitte eine Freischaltung beantragen.")

    neuer_name = (data.name or "").strip()
    if not neuer_name:
        raise HTTPException(status_code=400, detail="Firmenname darf nicht leer sein")

    if data.bs_lat is not None and not (-90 <= data.bs_lat <= 90):
        raise HTTPException(status_code=400, detail="Breitengrad muss zwischen -90 und 90 liegen")
    if data.bs_lon is not None and not (-180 <= data.bs_lon <= 180):
        raise HTTPException(status_code=400, detail="Laengengrad muss zwischen -180 und 180 liegen")

    sitz = (data.betriebssitz or "").strip()
    koord_geaendert = ((data.bs_lat is not None and data.bs_lat != firma.bs_lat)
                       or (data.bs_lon is not None and data.bs_lon != firma.bs_lon))
    geaendert = (neuer_name != firma.name
                 or (data.adresse or "").strip() != (firma.adresse or "")
                 or sitz != (firma.betriebssitz or "")
                 or koord_geaendert)
    if not geaendert:
        return _profil_dict(firma)          # nichts geaendert -> Zaehler unberuehrt

    firma.name = neuer_name
    firma.adresse = (data.adresse or "").strip()
    sitz_neu = sitz != (firma.betriebssitz or "")
    firma.betriebssitz = sitz

    if data.bs_lat is not None and data.bs_lon is not None:
        # Von Hand eingetragene Koordinaten haben Vorrang
        firma.bs_lat = data.bs_lat
        firma.bs_lon = data.bs_lon
    elif sitz_neu:
        firma.bs_lat = None
        firma.bs_lon = None
        # Koordinaten automatisch aus der Anschrift ermitteln
        if sitz:
            try:
                treffer = geocode_address(sitz)
                if treffer:
                    lat, lon = str(treffer).split(",")[:2]
                    firma.bs_lat = float(lat)
                    firma.bs_lon = float(lon)
            except Exception:
                pass                        # ohne Koordinaten weiter - kein Abbruch
    firma.profil_aenderungen = (firma.profil_aenderungen or 0) + 1
    session.add(firma); session.commit(); session.refresh(firma)
    return _profil_dict(firma)


@app.post("/me/firmenprofil/freischaltung")
def firmenprofil_freischaltung(x_mandant: Optional[int] = Header(default=None, alias="X-Mandant"),
                               current: User = Depends(get_current_user),
                               session: Session = Depends(get_session)):
    """Der Kunde beantragt, sein Firmenprofil erneut aendern zu duerfen."""
    ziel = _ziel_firma(current, session, x_mandant)
    firma = session.get(Firma, ziel)
    if firma is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    offen = session.exec(select(PasswortAnfrage)
                         .where(PasswortAnfrage.firma_id == firma.id)
                         .where(PasswortAnfrage.typ == "profil")
                         .where(PasswortAnfrage.status == "offen")).first()
    if not offen:
        session.add(PasswortAnfrage(email=current.email, firma_id=firma.id,
                                    firma_name=firma.name, typ="profil"))
        session.commit()
    return {"ok": True}


class ProfilFreigabeRequest(BaseModel):
    firma_id: int


@app.post("/admin/firmenprofil/freigeben")
def admin_profil_freigeben(data: ProfilFreigabeRequest,
                           current: User = Depends(get_current_user),
                           session: Session = Depends(get_session)):
    """Superadmin gibt das Firmenprofil wieder frei - der Kunde darf einmal aendern."""
    _require_superadmin(current)
    firma = session.get(Firma, data.firma_id)
    if firma is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    firma.profil_aenderungen = 0
    session.add(firma)
    for a in session.exec(select(PasswortAnfrage)
                          .where(PasswortAnfrage.firma_id == firma.id)
                          .where(PasswortAnfrage.typ == "profil")
                          .where(PasswortAnfrage.status == "offen")).all():
        a.status = "erledigt"; a.erledigt_am = datetime.utcnow()
        session.add(a)
    session.commit()
    return {"ok": True}


# ───────────────────────── Mandanten (mehrere Firmen) ─────────────────────────
def _mandanten_liste(current: User, session: Session):
    """Eigene Firma zuerst, danach die zugeordneten Mandanten."""
    eigene = session.get(Firma, current.firma_id)
    ergebnis = []
    if eigene:
        ergebnis.append({"firma_id": eigene.id, "name": eigene.name, "eigene": True})
    # Auch der Superadmin sieht in den Modulen nur seine eigene Firma und
    # ausdruecklich zugeordnete Mandanten - sonst stuende dort jede Firma.
    zuordnungen = session.exec(
        select(Mandant).where(Mandant.inhaber_firma_id == current.firma_id)).all()
    for z in zuordnungen:
        f = session.get(Firma, z.mandant_firma_id)
        if f:
            ergebnis.append({"firma_id": f.id, "name": f.name, "eigene": False})
    ergebnis[1:] = sorted(ergebnis[1:], key=lambda x: x["name"].lower())
    return ergebnis


@app.get("/mandanten")
def mandanten_liste(current: User = Depends(get_current_user),
                    session: Session = Depends(get_session)):
    # Mandanten fuehren darf nur, wer das Recht dazu hat (also der Inhaber)
    # UND dessen Firma die Lizenzart "gruppe" besitzt.
    darf = hat_recht(current, "mandanten") and darf_mandanten_fuehren(current, session)
    return {"darf": darf, "superadmin": _is_superadmin(current),
            "mandanten": _mandanten_liste(current, session) if darf else []}


class MandantHinzuRequest(BaseModel):
    email: Optional[str] = None
    firma_id: Optional[int] = None


@app.post("/mandanten/hinzufuegen")
def mandant_hinzufuegen(data: MandantHinzuRequest,
                        current: User = Depends(braucht("mandanten")),
                        session: Session = Depends(get_session)):
    """Eine bereits registrierte Firma als Mandant uebernehmen.
    Aus Datenschutzgruenden nur fuer Superadmin und Admin-Rolle."""
    if not _ist_admin(current, session):
        raise HTTPException(status_code=403,
                            detail="Bestehende Firmen darf nur ein Admin zuordnen")
    ziel = None
    if data.firma_id:
        ziel = session.get(Firma, data.firma_id)
    elif data.email:
        nutzer = session.exec(select(User).where(User.email == data.email.strip().lower())).first()
        ziel = session.get(Firma, nutzer.firma_id) if nutzer else None
    if ziel is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    if ziel.id == current.firma_id:
        raise HTTPException(status_code=400, detail="Das ist die eigene Firma")
    schon = session.exec(select(Mandant).where(
        Mandant.inhaber_firma_id == current.firma_id,
        Mandant.mandant_firma_id == ziel.id)).first()
    if schon:
        raise HTTPException(status_code=409, detail="Diese Firma ist bereits zugeordnet")
    if not _is_superadmin(current):
        _grenze_pruefen(session, current.firma_id)
    session.add(Mandant(inhaber_firma_id=current.firma_id, mandant_firma_id=ziel.id))
    session.commit()
    return {"ok": True, "firma_id": ziel.id, "name": ziel.name}


class MandantNeuRequest(BaseModel):
    firma_name: str
    email: str
    password: Optional[str] = None      # leer = Betrieb bekommt vorerst keinen eigenen Zugang
    adresse: Optional[str] = None
    betriebssitz: Optional[str] = None
    bs_lat: Optional[float] = None
    bs_lon: Optional[float] = None
    modules: Optional[list] = None


@app.post("/mandanten/neu")
def mandant_neu(data: MandantNeuRequest,
                current: User = Depends(braucht("mandanten")),
                session: Session = Depends(get_session)):
    """Neue Firma anlegen und sofort dem eigenen Konto als Mandant zuordnen."""
    if not darf_mandanten_fuehren(current, session):
        raise HTTPException(status_code=403, detail="Dein Konto darf keine Mandanten fuehren")
    if not _is_superadmin(current):
        _grenze_pruefen(session, current.firma_id)
    name = (data.firma_name or "").strip()
    email = (data.email or "").strip().lower()
    if not name:
        raise HTTPException(status_code=400, detail="Firmenname fehlt")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Bitte eine gueltige E-Mail angeben")
    passwort = data.password or ""
    if passwort and len(passwort) < 8:
        raise HTTPException(status_code=400, detail="Passwort braucht mindestens 8 Zeichen")
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=409, detail="Diese E-Mail wird schon benutzt")
    if data.bs_lat is not None and not (-90 <= data.bs_lat <= 90):
        raise HTTPException(status_code=400, detail="Breitengrad muss zwischen -90 und 90 liegen")
    if data.bs_lon is not None and not (-180 <= data.bs_lon <= 180):
        raise HTTPException(status_code=400, detail="Laengengrad muss zwischen -180 und 180 liegen")

    sitz = (data.betriebssitz or "").strip()
    lat, lon = data.bs_lat, data.bs_lon
    if sitz and (lat is None or lon is None):
        # Koordinaten automatisch aus dem Betriebssitz ermitteln
        try:
            treffer = geocode_address(sitz)
            if treffer:
                a, b = str(treffer).split(",")[:2]
                lat, lon = float(a), float(b)
        except Exception:
            pass

    firma = Firma(name=name, rolle="benutzer", plan="trial",
                  adresse=(data.adresse or "").strip(), betriebssitz=sitz,
                  bs_lat=lat, bs_lon=lon,
                  gueltig_bis=date.today() + timedelta(days=TRIAL_DAYS),
                  modules_json=json.dumps(data.modules) if data.modules else DEFAULT_MODULES)
    _plan_grenzen_anwenden(firma, firma.plan)
    session.add(firma); session.commit(); session.refresh(firma)

    # Ohne Passwort: Zugang wird angelegt, aber gesperrt. Der Betrieb kann
    # spaeter ein Einmal-Passwort bekommen, wenn er selbst arbeiten moechte.
    ohne_zugang = not passwort
    if ohne_zugang:
        passwort = secrets.token_urlsafe(24)
    session.add(User(email=email, password_hash=hash_password(passwort),
                     firma_id=firma.id, passwort_temporaer=ohne_zugang,
                     rolle=ROLLE_INHABER))
    session.add(Mandant(inhaber_firma_id=current.firma_id, mandant_firma_id=firma.id))
    session.commit()
    return {"ok": True, "firma_id": firma.id, "name": firma.name,
            "eigener_zugang": not ohne_zugang}


class MandantEntfernenRequest(BaseModel):
    firma_id: int


@app.post("/mandanten/entfernen")
def mandant_entfernen(data: MandantEntfernenRequest,
                      current: User = Depends(braucht("mandanten")),
                      session: Session = Depends(get_session)):
    """Zuordnung loesen - die Firma und ihre Daten bleiben bestehen.
    Bewusst nur fuer den Superadmin."""
    if not _is_superadmin(current):
        raise HTTPException(status_code=403,
                            detail="Zuordnungen kann nur der Superadmin loesen")
    z = session.exec(select(Mandant).where(
        Mandant.inhaber_firma_id == current.firma_id,
        Mandant.mandant_firma_id == data.firma_id)).first()
    if z is None:
        raise HTTPException(status_code=404, detail="Zuordnung nicht gefunden")
    session.delete(z); session.commit()
    return {"ok": True}


@app.get("/admin/gruppe/{firma_id}")
def admin_gruppe_lesen(firma_id: int,
                       current: User = Depends(get_current_user),
                       session: Session = Depends(get_session)):
    """Welche Unternehmen sind dieser Gruppe zugeordnet - und welche waeren moeglich."""
    _require_admin(current, session)
    gruppe = session.get(Firma, firma_id)
    if gruppe is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    zuordnungen = session.exec(select(Mandant)
                               .where(Mandant.inhaber_firma_id == firma_id)).all()
    belegt_ids = {z.mandant_firma_id for z in zuordnungen}
    zugeordnet = []
    for z in zuordnungen:
        f = session.get(Firma, z.mandant_firma_id)
        if f:
            zugeordnet.append({"firma_id": f.id, "name": f.name})
    frei = []
    for f in session.exec(select(Firma).order_by(Firma.name)).all():
        if f.id == firma_id or f.id in belegt_ids:
            continue
        if (f.lizenzart or "single") == "gruppe":
            continue                      # Gruppen ordnet man nicht anderen Gruppen zu
        frei.append({"firma_id": f.id, "name": f.name})
    return {"lizenzart": gruppe.lizenzart or "single",
            "max_firmen": gruppe.max_firmen or 1,
            "zugeordnet": sorted(zugeordnet, key=lambda x: x["name"].lower()),
            "moeglich": frei}


class GruppeZuordnenRequest(BaseModel):
    gruppe_firma_id: int
    mandant_firma_id: int


@app.post("/admin/gruppe/zuordnen")
def admin_gruppe_zuordnen(data: GruppeZuordnenRequest,
                          current: User = Depends(get_current_user),
                          session: Session = Depends(get_session)):
    _require_admin(current, session)
    gruppe = session.get(Firma, data.gruppe_firma_id)
    ziel = session.get(Firma, data.mandant_firma_id)
    if gruppe is None or ziel is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    if (gruppe.lizenzart or "single") != "gruppe":
        raise HTTPException(status_code=400,
                            detail="Diese Firma hat nicht die Lizenzart 'Gruppe'")
    if gruppe.id == ziel.id:
        raise HTTPException(status_code=400, detail="Eine Firma kann sich nicht selbst zugeordnet werden")
    schon = session.exec(select(Mandant).where(
        Mandant.inhaber_firma_id == gruppe.id,
        Mandant.mandant_firma_id == ziel.id)).first()
    if schon:
        raise HTTPException(status_code=409, detail="Bereits zugeordnet")
    _grenze_pruefen(session, gruppe.id)
    session.add(Mandant(inhaber_firma_id=gruppe.id, mandant_firma_id=ziel.id))
    session.commit()
    return {"ok": True}


@app.post("/admin/gruppe/loesen")
def admin_gruppe_loesen(data: GruppeZuordnenRequest,
                        current: User = Depends(get_current_user),
                        session: Session = Depends(get_session)):
    # Loesen ist dem Superadmin vorbehalten (Admin evtl. spaeter)
    _require_superadmin(current)
    z = session.exec(select(Mandant).where(
        Mandant.inhaber_firma_id == data.gruppe_firma_id,
        Mandant.mandant_firma_id == data.mandant_firma_id)).first()
    if z is None:
        raise HTTPException(status_code=404, detail="Zuordnung nicht gefunden")
    session.delete(z); session.commit()
    return {"ok": True}


@app.get("/firmen-auswahl")
def firmen_auswahl(current: User = Depends(get_current_user),
                   session: Session = Depends(get_session)):
    """Firmen, in denen dieses Konto Mitarbeiter fuehren darf:
    die eigene Firma und die zugeordneten Mandanten."""
    liste = _mandanten_liste(current, session)
    return {"admin": len(liste) > 1,
            "firmen": [{"id": m["firma_id"], "name": m["name"],
                        "eigene": m.get("eigene", False)} for m in liste]}


@app.get("/mitarbeiter")
def mitarbeiter_liste(firma_id: Optional[int] = None,
                      x_mandant: Optional[int] = Header(default=None, alias="X-Mandant"),
                      current: User = Depends(braucht("mitarbeiter", auch_lesend=True)),
                      session: Session = Depends(get_session)):
    if firma_id is None:
        firma_id = x_mandant
    """Alle Mitarbeiter einer Firma (aktive zuerst, dann nach Name)."""
    ziel = _ziel_firma(current, session, firma_id)
    rows = session.exec(
        select(Mitarbeiter).where(Mitarbeiter.firma_id == ziel)
    ).all()
    rows.sort(key=lambda m: (not m.aktiv, m.name.lower()))
    return {"mitarbeiter": [_ma_dict(m) for m in rows]}


@app.post("/mitarbeiter")
def mitarbeiter_anlegen(data: MitarbeiterRequest,
                        x_mandant: Optional[int] = Header(default=None, alias="X-Mandant"),
                        current: User = Depends(braucht("mitarbeiter")),
                        session: Session = Depends(get_session)):
    if data.firma_id is None and x_mandant is not None:
        data.firma_id = x_mandant
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name ist erforderlich")
    ziel = _ziel_firma(current, session, getattr(data, "firma_id", None))
    # Doppelten Namen in derselben Firma verhindern
    exists = session.exec(
        select(Mitarbeiter).where(Mitarbeiter.firma_id == ziel,
                                  Mitarbeiter.name == name)
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="Mitarbeiter existiert bereits")
    m = Mitarbeiter(firma_id=ziel, name=name,
                    personalnummer=(data.personalnummer or "").strip(),
                    stundenlohn=data.stundenlohn or 0.0,
                    wochenstunden=data.wochenstunden or 0.0,
                    adresse=(data.adresse or "").strip(),
                    geburtsdatum=_datum_oder_none(data.geburtsdatum),
                    eintritt=_datum_oder_none(data.eintritt),
                    vertragsart=(data.vertragsart or "").strip().lower(),
                    befristet_bis=_datum_oder_none(data.befristet_bis),
                    taetigkeit=(data.taetigkeit or "").strip(),
                    aktiv=data.aktiv)
    session.add(m)
    session.commit()
    session.refresh(m)
    return _ma_dict(m)


@app.put("/mitarbeiter/{ma_id}")
def mitarbeiter_aendern(ma_id: int, data: MitarbeiterRequest,
                        current: User = Depends(braucht("mitarbeiter")),
                        session: Session = Depends(get_session)):
    m = session.get(Mitarbeiter, ma_id)
    if not m or not darf_firma_bearbeiten(current, session, m.firma_id):
        raise HTTPException(status_code=404, detail="Mitarbeiter nicht gefunden")
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name ist erforderlich")
    # bei Umbenennung Dopplung prüfen
    if name != m.name:
        dup = session.exec(
            select(Mitarbeiter).where(Mitarbeiter.firma_id == m.firma_id,
                                      Mitarbeiter.name == name)
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail="Name bereits vergeben")
    m.name = name
    m.personalnummer = (data.personalnummer or "").strip()
    if data.stundenlohn is not None:
        m.stundenlohn = data.stundenlohn
    if data.wochenstunden is not None:
        m.wochenstunden = data.wochenstunden
    if data.adresse is not None:
        m.adresse = data.adresse.strip()
    if data.geburtsdatum is not None:
        m.geburtsdatum = _datum_oder_none(data.geburtsdatum)
    if data.eintritt is not None:
        m.eintritt = _datum_oder_none(data.eintritt)
    if data.vertragsart is not None:
        m.vertragsart = data.vertragsart.strip().lower()
    if data.befristet_bis is not None:
        m.befristet_bis = _datum_oder_none(data.befristet_bis)
    if data.taetigkeit is not None:
        m.taetigkeit = data.taetigkeit.strip()
    m.aktiv = data.aktiv
    session.add(m)
    session.commit()
    session.refresh(m)
    return _ma_dict(m)


@app.delete("/mitarbeiter/{ma_id}")
def mitarbeiter_loeschen(ma_id: int,
                         current: User = Depends(braucht("mitarbeiter")),
                         session: Session = Depends(get_session)):
    m = session.get(Mitarbeiter, ma_id)
    if not m or not darf_firma_bearbeiten(current, session, m.firma_id):
        raise HTTPException(status_code=404, detail="Mitarbeiter nicht gefunden")
    session.delete(m)
    session.commit()
    return {"ok": True, "deleted": ma_id}


# ───────────────────────── Team-Zugänge ───────────────────────────────────────
# Mehrere Personen in einer Firma. Anlegen, Rolle vergeben, sperren -
# ausschliesslich durch den Inhaber (und den Superadmin).

_TEAM_ZEICHEN = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def _einmal_passwort(laenge: int = 12) -> str:
    """Gut lesbares Zufallspasswort - ohne 0/O und 1/l/I, die man verwechselt."""
    return "".join(secrets.choice(_TEAM_ZEICHEN) for _ in range(laenge))


def _team_dict(u: User) -> dict:
    rolle = u.rolle or ROLLE_INHABER
    return {
        "id": u.id,
        "name": u.name or "",
        "email": u.email,
        "rolle": rolle,
        "rollenname": ROLLEN_NAMEN.get(rolle, rolle),
        "aktiv": bool(u.aktiv),
        "passwort_offen": bool(u.passwort_temporaer),
        "letzte_anmeldung": (u.letzte_anmeldung.strftime("%d.%m.%Y %H:%M")
                             if u.letzte_anmeldung else None),
        "angelegt_am": u.created_at.date().isoformat() if u.created_at else None,
    }


def _team_der_firma(session: Session, firma_id: int) -> list:
    leute = session.exec(select(User).where(User.firma_id == firma_id)).all()
    # Inhaber zuerst, dann aktive vor gesperrten, dann nach Name
    leute.sort(key=lambda u: ((u.rolle or ROLLE_INHABER) != ROLLE_INHABER,
                              not u.aktiv,
                              (u.name or u.email).lower()))
    return leute


def _plaetze_belegt(session: Session, firma_id: int) -> int:
    """Gesperrte Kollegen zaehlen nicht gegen die Grenze."""
    return len([u for u in session.exec(
        select(User).where(User.firma_id == firma_id)).all() if u.aktiv])


def _team_firma(current: User, session: Session) -> Firma:
    """Die Firma, deren Team verwaltet wird - und die Prüfung, ob das erlaubt ist."""
    if not hat_recht(current, "team"):
        raise HTTPException(status_code=403,
                            detail="Nur der Inhaber darf das Team verwalten")
    firma = session.get(Firma, current.firma_id)
    if firma is None:
        raise HTTPException(status_code=404, detail="Firma nicht gefunden")
    if not _is_superadmin(current) and "teamzugaenge" not in json.loads(
            firma.modules_json or DEFAULT_MODULES):
        raise HTTPException(
            status_code=403,
            detail="Team-Zugänge sind in deinem Tarif nicht enthalten.")
    return firma


def _team_mitglied(current: User, session: Session, user_id: int) -> User:
    """Holt einen Kollegen aus der EIGENEN Firma - nie aus einer fremden."""
    ziel = session.get(User, user_id)
    if ziel is None or ziel.firma_id != current.firma_id:
        raise HTTPException(status_code=404, detail="Zugang nicht gefunden")
    return ziel


def _letzter_inhaber(session: Session, firma_id: int, ausser_id: int) -> bool:
    """True, wenn ausser diesem keiner mehr aktiver Inhaber der Firma ist."""
    andere = [u for u in session.exec(select(User).where(User.firma_id == firma_id)).all()
              if u.id != ausser_id and u.aktiv
              and (u.rolle or ROLLE_INHABER) == ROLLE_INHABER]
    return not andere


@app.get("/team")
def team_liste(current: User = Depends(get_current_user),
               session: Session = Depends(get_session)):
    firma = _team_firma(current, session)
    leute = _team_der_firma(session, firma.id)
    grenze = firma.max_benutzer or 1
    return {"team": [_team_dict(u) for u in leute],
            "belegt": _plaetze_belegt(session, firma.id),
            "grenze": grenze,
            "rollen": [{"key": k, "name": ROLLEN_NAMEN[k]} for k in ROLLEN]}


class TeamAnlegenRequest(BaseModel):
    name: str = ""
    email: str
    rolle: str = "buchhaltung"


@app.post("/team")
def team_anlegen(data: TeamAnlegenRequest,
                 current: User = Depends(get_current_user),
                 session: Session = Depends(get_session)):
    """Legt einen Kollegen an und liefert das Einmal-Passwort genau einmal zurueck.
    Der Kollege setzt sich damit ueber /passwort-setzen sein eigenes Passwort."""
    firma = _team_firma(current, session)
    email = (data.email or "").strip().lower()
    rolle = (data.rolle or "").strip().lower()

    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Bitte eine gueltige E-Mail-Adresse angeben")
    if rolle not in RECHTE:
        raise HTTPException(status_code=400, detail=f"Unbekannte Rolle: {data.rolle}")
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(
            status_code=409,
            detail="Diese E-Mail wird bereits benutzt. Jede Adresse kann nur zu "
                   "einem Zugang gehören - auch über Firmengrenzen hinweg.")

    grenze = firma.max_benutzer or 1
    if _plaetze_belegt(session, firma.id) >= grenze:
        raise HTTPException(
            status_code=409,
            detail=f"Alle {grenze} Plätze sind belegt. Sperre einen Zugang "
                   f"oder wechsle in einen größeren Tarif.")

    passwort = _einmal_passwort()
    neu = User(email=email, password_hash=hash_password(passwort),
               firma_id=firma.id, name=(data.name or "").strip()[:80],
               rolle=rolle, aktiv=True, passwort_temporaer=True)
    session.add(neu); session.commit(); session.refresh(neu)
    ergebnis = _team_dict(neu)
    ergebnis["einmal_passwort"] = passwort   # nur in DIESER Antwort
    return ergebnis


class TeamAendernRequest(BaseModel):
    name: Optional[str] = None
    rolle: Optional[str] = None


@app.put("/team/{user_id}")
def team_aendern(user_id: int, data: TeamAendernRequest,
                 current: User = Depends(get_current_user),
                 session: Session = Depends(get_session)):
    firma = _team_firma(current, session)
    ziel = _team_mitglied(current, session, user_id)

    if data.rolle is not None:
        rolle = data.rolle.strip().lower()
        if rolle not in RECHTE:
            raise HTTPException(status_code=400, detail=f"Unbekannte Rolle: {data.rolle}")
        if (rolle != ROLLE_INHABER
                and (ziel.rolle or ROLLE_INHABER) == ROLLE_INHABER
                and _letzter_inhaber(session, firma.id, ziel.id)):
            raise HTTPException(
                status_code=400,
                detail="Das ist der letzte Inhaber-Zugang. Mach zuerst jemand "
                       "anderen zum Inhaber.")
        ziel.rolle = rolle
    if data.name is not None:
        ziel.name = data.name.strip()[:80]
    session.add(ziel); session.commit(); session.refresh(ziel)
    return _team_dict(ziel)


class TeamSperrenRequest(BaseModel):
    aktiv: bool


@app.post("/team/{user_id}/sperren")
def team_sperren(user_id: int, data: TeamSperrenRequest,
                 current: User = Depends(get_current_user),
                 session: Session = Depends(get_session)):
    """Sperren statt loeschen - damit spaetere Freigaben nachvollziehbar bleiben."""
    firma = _team_firma(current, session)
    ziel = _team_mitglied(current, session, user_id)

    if not data.aktiv:
        if ziel.id == current.id:
            raise HTTPException(status_code=400,
                                detail="Du kannst dich nicht selbst sperren.")
        if ((ziel.rolle or ROLLE_INHABER) == ROLLE_INHABER
                and _letzter_inhaber(session, firma.id, ziel.id)):
            raise HTTPException(
                status_code=400,
                detail="Das ist der letzte Inhaber-Zugang und kann nicht gesperrt werden.")
    else:
        grenze = firma.max_benutzer or 1
        if _plaetze_belegt(session, firma.id) >= grenze:
            raise HTTPException(
                status_code=409,
                detail=f"Alle {grenze} Plätze sind belegt.")

    ziel.aktiv = bool(data.aktiv)
    session.add(ziel); session.commit(); session.refresh(ziel)
    return _team_dict(ziel)


@app.post("/team/{user_id}/passwort-neu")
def team_passwort_neu(user_id: int,
                      current: User = Depends(get_current_user),
                      session: Session = Depends(get_session)):
    """Neues Einmal-Passwort, falls ein Kollege seins vergessen hat."""
    _team_firma(current, session)
    ziel = _team_mitglied(current, session, user_id)
    passwort = _einmal_passwort()
    ziel.password_hash = hash_password(passwort)
    ziel.passwort_temporaer = True
    session.add(ziel); session.commit(); session.refresh(ziel)
    ergebnis = _team_dict(ziel)
    ergebnis["einmal_passwort"] = passwort
    return ergebnis


# ============================================================================
# TEIL 10 – STARTINHALT DER DOKUMENTVORLAGEN
# ============================================================================

"""Diese Texte werden beim allerersten Serverstart in die Datenbank
geschrieben. Danach werden sie NICHT mehr angefasst - Aenderungen macht
der Superadmin im Admin-Panel unter "Vorlagen".
"""

VORLAGEN = {'vollzeit': {'titel': 'Arbeitsvertrag Vollzeit', 'sortierung': 1, 'text': 'Zwischen\n{{firma_name}}\n{{firma_strasse}}\n{{firma_plz_ort}}\n\n-nachfolgend Firma genannt-\nund\nHerr:\n{{ma_name}}\n{{ma_strasse}}\n{{ma_plz_ort}}\n-nachfolgend Mitarbeiter genannt-\n\n\nwird folgender Arbeitsvertrag vereinbart:\n\n\n§1\tEinstellung und Aufgaben\n\nDer Mitarbeiter wird bei der Firma ab dem {{eintritt}} als {{taetigkeit}} tätig. Das Arbeitsverhältnis ist {{befristung}}.\n\nDer Mitarbeiter ist nach näherer Weisung der Geschäftsführung auch zur Leistung anderer zumutbarer Arbeit, auch an einem anderen Arbeitsort, verpflichtet. Der jeweilige Einsatz erfolgt durch die Betriebsleitung nach betrieblichen Belangen. Das Recht der Firma, dem Mitarbeiter eine andere Tätigkeit zu übertragen, wird auch durch eine lange währende Verwendung auf demselben Arbeitsplatz nicht beschränkt.\n\nIst eine Rufbereitschaft im Betrieb eingerichtet, ist der Mitarbeiter verpflichtet diese Rufbereitschaft turnusgemäß wahrzunehmen. Der Mitarbeiter hat dafür Sorge zu tragen, dass er während der Rufbereitschaft telefonisch erreichbar ist.\n\n§ 2\tProbezeit\n\nDas Arbeitsverhältnis wird auf unbestimmte Zeit geschlossen. Die ersten 6 Monate gelten als Probezeit. Während der Probezeit kann das Arbeitsverhältnis beiderseits mit einer Frist von zwei Wochen gekündigt werden.\n\n§ 3\tArbeitszeit\n\nDie Arbeitszeit beträgt {{wochenstunden}} Stunden in der Woche ohne die Berücksichtigung von Pausen. Die Lage der Arbeitszeit richtet sich nach der betriebsüblichen Zeit gemäß den Vorgaben des Einsatzplanes.\n\nEs wird eine {{arbeitstage}}-Tage-Woche zu Grunde gelegt.\n\nDie Firma ist berechtigt, nach billigem Ermessen eine Änderung der Dienstzeiteinteilung vorzunehmen.\nIm Falle der Erforderlichkeit verpflichtet sich der Mitarbeiter, auf Anordnung der Firma auch über die betriebsübliche Zeit hinaus zu arbeiten. Überstunden/Mehrarbeit werden nach Wahl der Firma durch Freizeit oder Geld ausgeglichen.\n\nÜber die täglichen Arbeitszeiten führt der Mitarbeiter Aufzeichnungen. Diese sind der Firma wöchentlich vorzulegen.\n\nDie Firma kann Kurzarbeit anordnen, wenn ein erheblicher Arbeitsausfall vorliegt, der auf wirtschaftlichen Gründen oder einem unabwendbaren Ereignis beruht, und der Arbeitsausfall der Arbeitsverwaltung angezeigt ist (§§ 95 ff. SGB III). Für die Dauer der Kurzarbeit vermindert sich die in § 4 dieses Vertrages geregelte Vergütung im Verhältnis der ausgefallenen Arbeitszeit. Bei der Anordnung von Kurzarbeit hat die Firma gegenüber dem Mitarbeiter eine Ankündigungsfrist von vier Wochen einzuhalten. Die Kurzarbeit kann nur für die Dauer von bis zu 12 Monaten und nur mit Kurzarbeit von mindestens 50 % der bisherigen Arbeitszeit angeordnet werden und nur dann, wenn entweder der ganze Betrieb oder zumindest die Betriebsabteilung des Mitarbeiters betroffen sind.\n\n§ 4\tVergütung\n\nDer Arbeitnehmer erhält einen Stundenlohn in Höhe von        € brutto (§ 1 Abs. 2 MiLoG).\nAbrechnungszeitraum ist jeweils vom 01.des laufenden Monats bis zum Ende des laufenden Monats.\nDie Vergütung ist jeweils bis zum 15. eines Folgemonats bargeldlos zu zahlen.\nDer Mitarbeiter ist verpflichtet, ein Konto zu unterhalten und der Firma die Kontodaten mitzuteilen.\nDer Mitarbeiter ist verpflichtet, die Gehaltszahlung auf ihre Richtigkeit zu überprüfen. Irrtümliche\nGehaltszahlungen sind vom Mitarbeiter unverzüglich der Firma anzuzeigen und auf Verlangen der Firma von dem Mitarbeiter zurückzuerstatten. Der Mitarbeiter kann sich nicht auf den Wegfall der Bereicherung berufen.\n§ 616 Satz 1 BGB ist abgedungen.\n\n§ 5\tUrlaub\n\nDer Mitarbeiter erhält {{urlaubstage}} Arbeitstage Urlaub. Bei der Berechnung der Urlaubstage wird eine {{arbeitstage}}-Tage-Woche zu Grunde gelegt. Eine Reduzierung der Wochenarbeitstage führt zu einer entsprechenden Verringerung des Erholungsurlaubes.\n\nIst das Kalenderjahr nicht erfüllt, wir der Urlaub monatsanteilig nach Betriebszugehörigkeit gewährt. Der Anspruch auf den gesetzlichen Mindesturlaub bleibt unberührt.\n\nDie Urlaubszeitpunkte stimmt der Mitarbeiter rechtzeitig mit der Firma ab, wobei weitgehend die berechtigten Interessen des Mitarbeiters berücksichtigt werden sollen. Der Urlaub muss im laufenden Kalenderjahr genommen werden.\n\nDer Urlaubsanspruch wird unter den Voraussetzungen von § 17 Abs. 1 BEEG für jeden Monat der Elternzeit um ein Zwölftel verkürzt.\n\n§ 6\tNebenbeschäftigung\n\nDer Arbeitnehmer verpflichtet sich, jede entgeltliche oder das Arbeitsverhältnis beeinträchtigende Nebenbeschäftigung vor ihrer Aufnahme dem Arbeitgeber gegenüber in Textform anzuzeigen. Sie ist nur mit Zustimmung des Arbeitgebers zulässig.\n\nDer Arbeitgeber erteilt die Einwilligung, wenn die Wahrnehmung der dienstlichen Aufgaben durch die Nebenbeschäftigung nicht behindert und sonstige berechtigte Interessen des Arbeitgebers nicht beeinträchtigt werden.\nDer Arbeitgeber kann seine Einwilligung jederzeit widerrufen, wenn sein betriebliches Interesse dies auch unter Berücksichtigung der Arbeitnehmerinteressen erfordert.\n\n                                 § 7\tArbeitsverhinderung/Ärztliche Untersuchung\n\nDer Mitarbeiter ist verpflichtet, der Firma seine Arbeitsunfähigkeit und deren voraussichtliche Dauer unverzüglich, d.h. bis spätestens 9:00 Uhr des ersten Krankheitstages, mitzuteilen. Dauert die Arbeitsunfähigkeit länger als einen Tag an, ist der Firma am nächsten Arbeitstag eine\nArbeitsunfähigkeitsbescheinigung vorzulegen. Ist der Zeitraum der Bescheinigung abgelaufen und dauert die\nArbeitsunfähigkeit an, so ist der Mitarbeiter verpflichtet, unverzüglich eine neue ärztliche\nBescheinigung vorzulegen. Dies gilt auch nach Ablauf des gesetzlichen Entgeltfortzahlungszeitraums. Im Einzelfall ist auf Verlangen der Firma eine ärztliche Arbeitsunfähigkeitsbescheinigung bereits am ersten Krankheitstag vorzulegen.\n\nDie Fortzahlung der Vergütung im Krankheitsfall richtet sich an den gesetzlichen Bestimmungen des\nEntgeltfortzahlungsgesetzes, wobei bei der Berechnung der Dauer der Entgeltfortzahlung sowohl die Tage, in denen der Mitarbeiter seine Arbeitsleistung zu erbringen hätte, als auch die arbeitsfreien Tage berücksichtigt werden.\n\nDer Mitarbeiter wird sich bei Vorliegen sachlicher Gründe auf Verlangen der Firma durch den Betriebsarzt, den medizinischen Dienst der Krankenkassen oder einen Amtsarzt auf Kosten der Firma auf seine gesundheitliche Eignung für die Tätigkeit nach diesem Arbeitsvertrag untersuchen lassen.\n\n§ 8\tBeendigung des Arbeitsverhältnisses\n\nDer Rücktritt vom Arbeitsvertrag oder seine Kündigung vor Aufnahme der Tätigkeit sind ausgeschlossen.\n\nDie Beendigung des Arbeitsverhältnisses durch Kündigung oder Aufhebungsvertrag bedarf für ihre Wirksamkeit der Schriftform, die elektronische Form ist ausgeschlossen.\n\nNach Ablauf der Probezeit finden die gesetzlichen Kündigungsfristen (§ 622 BGB) Anwendung.\n\nDanach kann ein Arbeitsverhältnis mit einer Kündigungsfrist von vier Wochen zum Fünfzehnten oder zum Ende eines Kalendermonats gekündigt werden.\n\nDie Kündigungsfristen für Arbeitgeber verlängern sich bei längerem Bestehen des Arbeitsverhältnisses wie folgt:\n\nNach zwei Jahren auf einen Monat zum Monatsende,\nnach fünf Jahren auf zwei Monate zum Monatsende,\nnach acht Jahren auf drei Monate zum Monatsende,\nnach zehn Jahren auf vier Monate zum Monatsende,\nnach zwölf Jahren auf fünf Monate zum Monatsende,\nnach 15 Jahren auf sechs Monate zum Monatsende, \nnach 20 Jahren auf sieben Monate zum Monatsende.\nJede gesetzliche Verlängerung der Kündigungsfrist zugunsten des Arbeitnehmers gilt in gleicher Weise auch zugunsten des Arbeitgebers.\nDer Arbeitgeber ist berechtigt, den Arbeitnehmer bis zur Beendigung des Arbeitsverhältnisses freizustellen. Die Freistellung erfolgt unter Anrechnung der dem Arbeitnehmer eventuell noch zustehenden Urlaubsansprüche sowie eventueller Guthaben auf dem Arbeitszeitkonto. In der Zeit der Freistellung hat sich der Arbeitnehmer einen durch Verwendung seiner Arbeitskraft erzielten Verdienst auf den Vergütungsanspruch gegenüber dem Arbeitgeber anrechnen zu lassen.\n\nDas Arbeitsverhältnis endet ohne Kündigung spätestens mit Ablauf des Monats, in dem der Arbeitnehmer das für ihn gesetzlich festgelegte Renteneintrittsalter vollendet hat.\n\nDas Recht zur außerordentlichen Kündigung bleibt unberührt.\n\n§ 9\tMeldepflichten\n\nDer Mitarbeiter bestätigt, dass weder eine Vorstrafe noch ein anhängiges Strafverfahren im Zusammenhang mit seiner beruflichen Tätigkeit ausgesprochen bzw. eingeleitet ist.\n\nDer Mitarbeiter hat ohne besondere Aufforderung für das Arbeitsverhältnis bedeutsame Änderungen der persönlichen Verhältnisse unverzüglich der Firma mitzuteilen und durch geeignete Unterlagen nachzuweisen.\nDazu gehören: Veränderungen, die zum Erwerb oder Verlust von Sonderrechten nach dem MuSchG oder SGB IX führen können (z. B. Feststellung einer Schwangerschaft, Feststellung der\nSchwerbehinderteneigenschaft); Wechsel der Krankenkassenmitgliedschaft, Veränderung der\nBeitragshöhe, Wohnungswechsel, Änderungen des Personenstandes oder der Familienverhältnisse, Einberufung zum Wehr- oder Zivildienst, Eheschließung, Namenswechsel, Geburt oder Annahme eines Kindes, rechtskräftiges Scheidungsurteil, Rentenantragstellung; Erhalt eines Rentenbescheides; Tod von Ehegatten und Kindern; Arbeits- und Freizeitunfälle; Wechsel des Gehaltskontos, Änderungen hinsichtlich der Aufenthalts- oder Arbeitserlaubnis und der Staatsangehörigkeit.\n\nHat der Mitarbeiter von strafbaren Handlungen im Betrieb oder gegen die Firma Kenntnis erlangt, hat er dies der Firma mitzuteilen. Das gilt insbesondere, wenn durch die Straftat erhebliche Vermögensinteressen der Firma berührt oder Personen gefährdet werden.\n\nWird der Mitarbeiter durch Handlungen eines Dritten arbeitsunfähig, tritt er bereits jetzt die ihm gegen diesen Dritten zustehenden Schadenersatzansprüche wegen Verdienstausfalls insoweit an die Firma ab, als die Firma für die Ausfallzeit Arbeitsentgelt gezahlt hat. Der Mitarbeiter ist verpflichtet, der Firma die zur Erhebung der Ansprüche erforderlichen Auskünfte zu erteilen.\n\n§ 10 Geheimhaltung\n\nDer Arbeitnehmer verpflichtet sich, während der Dauer des Arbeitsverhältnisses und auch nach dem Ausscheiden, über alle Geschäftsgeheimnisse sowie betriebliche Angelegenheiten vertraulicher Natur, die als solche von der Geschäftsleitung schriftlich oder mündlich bezeichnet werden bzw. offensichtlich als solche zu erkennen sind, Stillschweigen zu bewahren und ohne ausdrückliche Genehmigung der Geschäftsleitung keinen dritten Personen zugänglich zu machen. Der Arbeitnehmer hat die Anweisungen und Maßnahmen des Arbeitgebers zur Geheimhaltung zu beachten. Im Zweifelsfall wird der Arbeitnehmer eine Weisung des Arbeitgebers zur Vertraulichkeit bestimmter Tatsachen einholen.\n(Anmerkung: Das am 26. April 2019 in Kraft getretene Gesetz zum Schutz von Geschäftsgeheimnissen (GeschGehG) verlangt zudem aktive, objektiv feststellbare Schutzmaßnahmen seitens der Arbeitgeber; es kann daher empfehlenswert sein, die wesentlichen, von solchen Geheimhaltungsmaßnahmen betroffenen Informationen (abstrakt) zu beschreiben: „Als Geschäftsgeheimnisse geheim zu halten sind insbesondere...“)\nFür jeden Fall der Zuwiderhandlung gegen diese Verpflichtung verpflichtet er sich, eine Vertragsstrafe in Höhe einer Bruttomonatsvergütung zu zahlen. Die Geltendmachung eines weiteren Schadens bleibt dem Arbeitgeber vorbehalten.\n\nVerstößt der Arbeitnehmer gegen seine Verschwiegenheitspflicht, kann dies zur Kündigung führen.\n\n§ 11 Herausgabepflicht\n\nDer Mitarbeiter verpflichtet sich, bei Beendigung des Arbeitsverhältnisses unaufgefordert und ansonsten jederzeit auf Anforderung der Firma sämtliche ihm überlassenen oder von ihm für das Unternehmen gefertigten Schriftstücke oder sonstige Gegenstände der Firma an diesen unverzüglich herauszugeben. Ein Zurückbehaltungsrecht hinsichtlich dieser Unterlagen ist ausgeschlossen. Dasselbe gilt für auf Datenträger gespeicherte Daten.\n\nDer Mitarbeiter teilt der Firma alle Codes, Passwörter, Zugangssperren im Hinblick auf EDV-Nutzung mit und wird von diesen nach Aufforderung durch die Firma bzw. nach Beendigung des Arbeitsverhältnisses selbst keinen Gebrauch mehr machen. Ein Zurückbehaltungsrecht ist ausgeschlossen.\n\n§ 12 EDV-Nutzung\n\nDie betrieblichen EDV-Einrichtungen (Computer, Geräte und Programme),\nTelekommunikationseinrichtungen (Telefone, Telefax) und Kopiergeräte dürfen nur zu arbeitsvertraglichen Zwecken genutzt werden. Eine private Nutzung durch den Mitarbeiter ist nicht zulässig. Die Verpflichtung zur ausschließlich dienstlichen Nutzung gilt insbesondere für die Nutzung von E-Mail und Internet. Sollte der Mitarbeiter E-Mails privaten Inhalts erhalten, sind diese unverzüglich und vollständig zu löschen.\n\nVertrauliche Daten und Informationen sind von dem Mitarbeiter so zu schützen, dass dritte Personen keine Einsicht und Zugriff nehmen können.\n\nDie Vertragsparteien beachten die einschlägigen datenschutzrechtlichen Vorschriften. Der Mitarbeiter wird insbesondere personenbezogene Daten, die von der Firma oder Kunden der Firma zur Verfügung gestellt werden, nur im Rahmen von deren Weisungen und nach Maßgabe des als Anlage beigefügten Verpflichtung zur Einhaltung der datenschutzrechtlichen Anforderungen nach der DS-GVO erheben, verarbeiten oder nutzen.\n\nDer Mitarbeiter ist zu regelmäßiger Datensicherung im erforderlichen Umfang verpflichtet.\n\n§ 13 Ausschlussfristen\n\nAlle Ansprüche aus dem Arbeitsverhältnis und solche, die mit diesem in Verbindung stehen, verfallen, wenn sie nicht innerhalb von drei Monaten nach der Fälligkeit gegenüber der anderen Vertragspartei in Textform erhoben werden. Lehnt die Gegenpartei den Anspruch in Textform ab oder erklärt sie sich nicht innerhalb von einem Monat nach der Geltendmachung des Anspruchs in Textform, so verfällt dieser, wenn er nicht innerhalb von drei Monaten nach der Ablehnung oder dem Fristablauf gerichtlich geltend gemacht wird.\n\nDiese Ausschlussfrist gilt nicht für Ansprüche, die auf einer vorsätzlichen oder grob fahrlässigen Pflichtverletzung der anderen Vertragspartei bzw. eines Erfüllungsgehilfen der anderen Vertragspartei beruhen. Diese Ausschlussfrist gilt weiterhin nicht für Ansprüche, die auf einer Verletzung des Lebens, des Körpers oder der Gesundheit aufgrund einer schuldhaften Pflichtverletzung der anderen Vertragspartei bzw. eines Erfüllungsgehilfen der anderen Vertragspartei beruhen.\n\nAnsprüche nach dem Mindestlohngesetz bleiben von der Ausschlussfristenregelung unberührt.\n\n§ 14 Übergabe von Bargeldeinnahmen\n\nDer Arbeitnehmer verpflichtet sich, alle von Kunden eingenommenen Bargelder jeweils amdarauffolgenden Montag vollständig und ordnungsgemäß an die Firma zu übergeben.\n\nKommt der Arbeitnehmer dieser Verpflichtung nicht innerhalb einer Woche nach, wird die Firmaden Arbeitnehmer schriftlich abmahnen. Erfolgt nach der Abmahnung erneut kein fristgerechter\nAusgleich der Beträge in der darauffolgenden Woche, behält sich die Firma das Recht vor, das Arbeitsverhältnis fristgerecht oder, im Falle eines vorsätzlichen und schwerwiegenden Verstoßes, fristlos zu kündigen.\nNicht übergebene Beträge werden hiermit vereinbart, dass der Arbeitnehmer diese Beträge als Vorschuss auf sein Gehalt akzeptiert.\nDer Arbeitnehmer wird über die Kündigung schriftlich informiert. Die Kündigung wird mit Zugangdes Schreibens wirksam, sofern keine andere Frist gilt.\n\n§ 15 Selbstbeteiligung bei Unfällen\n\nVerursacht der Arbeitnehmer während der Ausübung seiner Tätigkeit einen Unfall, der durchmittlere Fahrlässigkeit, grobe Fahrlässigkeit oder Vorsatz entstanden ist, verpflichtet er sich, eine\nSelbstbeteiligung in Höhe der vertraglich vereinbarten Selbstbeteiligung der Vollkaskoversicherung des Fahrzeugs zu zahlen, jedoch maximal               Euro pro Schadensfall.\n\nDie Selbstbeteiligung wird nur dann fällig, wenn die Schuld des Arbeitnehmers eindeutigfestgestellt wurde, z. B. durch ein Unfallprotokoll, ein Gutachten oder eine Entscheidung der zuständigen Behörden.\n\nDie Zahlung der Selbstbeteiligung erfolgt nach Aufforderung durch die Firma und kann nach Absprache mit dem Arbeitnehmer in Raten vom Gehalt abgezogen werden.\n\n§ 16 Verhalten nach Beendigung eines Auftrags\n\nDer Mitarbeiter, sofern er als {{taetigkeit}} tätig ist, ist gemäß § 49 Absatz 4 des Personenbeförderungsgesetzes (PBefG) verpflichtet, nach jedem abgeschlossenen Auftrag unverzüglich und ohne Aufforderung zum Betriebssitz zurückzukehren, es sei denn, es wurde vor oder während der Rückfahrt ein neuer Auftrag von der Firma vermittelt.\n\nWährend der Rückfahrt zum Betriebssitz darf der Mitarbeiter ausschließlich Aufträge ausführen,die ihm vorab oder unterwegs von der Firma oder einem autorisierten Vermittler übermittelt wurden.\n\nDas eigenständige Aufnehmen von Fahrgästen auf der Straße, ohne vorherige Vermittlung durchdie Firma oder einen autorisierten Vermittler, ist strengstens untersagt. Dies gilt insbesondere für das Anhalten aufgrund von Handzeichen, Zuruf oder anderweitigem direkten Kontakt mit potenziellen Fahrgästen.\nDer Mitarbeiter ist verpflichtet, die Regelungen des Personenbeförderungsgesetzes strikteinzuhalten, insbesondere in Bezug auf die Abgrenzung zwischen Mietwagenverkehr und\nTaxiverkehr. Verstöße gegen diese Bestimmungen können arbeitsrechtliche Konsequenzen nach sich ziehen, bis hin zur fristlosen Kündigung.\n\nHiermit wird der Arbeitsvertrag um folgende Klauseln erweitert:\n§ 17 Zusätzliche Vereinbarungen\n\nDer Mitarbeiter wird überwiegend in der Nachtschicht /Frühschicht eingesetzt\n\n§ 18 Änderungen und Ergänzungen\n\nMündliche Nebenabreden bestehen nicht. Änderungen und Ergänzungen des Vertrages, soweit sie nicht auf einer individuellen Vereinbarung der Parteien beruhen, bedürfen zu ihrer Rechtsgültigkeit der Textform. Das bedeutet, dass Ansprüche aus betrieblicher Übung nicht entstehen können. Eine etwaige Ungültigkeit einzelner Vertragsbestimmungen berührt die Wirksamkeit der übrigen Bestimmungen nicht.\n\nSollten einzelne Bestimmungen dieses Vertrags ganz oder teilweise unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.\n\nDie Vertragsparteien sind im Falle einer unwirksamen Bestimmung verpflichtet, über eine wirksame und zumutbare Ersatzregelung zu verhandeln, die dem von den Vertragsparteien mit der unwirksamen Bestimmung verfolgten wirtschaftlichen Zweck möglichst nahekommt.\n\n\n{{ort}}, den {{datum_heute}}\n\n\nUnterschrift Firma\t                                                                             Unterschrift Mitarbeiter\n\n\nAnlage 1\n\nVerpflichtung zur Einhaltung der datenschutzrechtlichen Anforderungen nach der Datenschutz-Grundverordnung (DS-GVO)\nHerr:  \nwurde darauf verpflichtet, dass es untersagt ist, personenbezogene Daten unbefugt zu verarbeiten. Personenbezogene Daten dürfen daher nur verarbeitet werden, wenn eine Einwilligung bzw. eine gesetzliche Regelung die Verarbeitung erlauben oder eine Verarbeitung dieser Daten vorgeschrieben ist. Die Grundsätze der DS-GVO für die Verarbeitung personenbezogener Daten sind in Art. 5 Abs. 1 DS-GVO festgelegt und beinhalten im Wesentlichen folgende Verpflichtungen:\nPersonenbezogene Daten müssen\nauf rechtmäßige Weise und in einer für die betroffene Person nachvollziehbaren Weise verarbeitet werden;\nfür festgelegte, eindeutige und legitime Zwecke erhoben werden und dürfen nicht in einer mit diesen Zwecken nicht zu vereinbarenden Weise weiterverarbeitet werden;\ndem Zweck angemessen und erheblich sowie auf das für die Zwecke der Verarbeitung notwendige\nMaß beschränkt sein („Datenminimierung“);\nsachlich richtig und erforderlichenfalls auf dem neuesten Stand sein; es sind alle angemessenen\nMaßnahmen zu treffen, damit personenbezogene Daten, die im Hinblick auf die Zwecke ihrer\nVerarbeitung unrichtig sind, unverzüglich gelöscht oder berichtigt werden;\nin einer Form gespeichert werden, die die Identifizierung der betroffenen Personen nur so lange ermöglicht, wie es für die Zwecke, für die sie verarbeitet werden, erforderlich ist;\nin einer Weise verarbeitet werden, die eine angemessene Sicherheit der personenbezogenen Daten gewährleistet, einschließlich Schutz vor unbefugter oder unrechtmäßiger Verarbeitung und vor unbeabsichtigtem Verlust, unbeabsichtigter Zerstörung oder unbeabsichtigter Schädigung durch geeignete technische und organisatorische Maßnahmen („Integrität und Vertraulichkeit“);\nVerstöße gegen diese Verpflichtung können mit Geldbuße und/oder Freiheitsstrafe geahndet werden. Ein Verstoß kann zugleich eine Verletzung von arbeitsvertraglichen Pflichten oder spezieller Geheimhaltungspflichten darstellen. Auch (zivilrechtliche) Schadenersatzansprüche können sich aus schuldhaften Verstößen gegen diese Verpflichtung ergeben. Ihre sich aus dem Arbeitsvertrag oder gesonderten Vereinbarungen ergebende Vertraulichkeitsverpflichtung wird durch diese Erklärung nicht berührt.\nDie Verpflichtung gilt auch nach Beendigung der Tätigkeit weiter.\nIch bestätige diese Verpflichtung. Ein Exemplar der Verpflichtung habe ich erhalten.\n\n{{ort}}, {{datum_heute}}\n\n\n________________________________                                             \t__________________________\nUnterschrift des Verpflichteten\t                                                           Unterschrift des Verantwortlichen\n\n\nAnlage 2\nBelehrung über die Mitführungs- und Vorlagepflicht von Ausweispapieren gemäß §2a SchwarzArbG\nHerr:  \n\nIhre Pflichten als Arbeitnehmer:\nSie sind als Arbeitnehmer verpflichtet, jederzeit ihre amtlichen Ausweispapiere bei der Ausübung der Tätigkeit für den Arbeitgeber mitzuführen. Bei einem Verstoß droht ein Bußgeld bis zu 5.000,00 Euro. Sie sind verpflichtet, die Ausweispapiere im Rahmen einer Prüfung durch staatliche Stellen vorzulegen. Bei einem Verstoß droht ein Bußgeld bis zu 5.000,00 Euro.\nSie haben Prüfungen durch staatliche Stellen zu dulden und die Pflicht mitzuwirken, insbesondere Auskunft zu erteilen.\nWortlaut des §2a Mitführungs- und Vorlagepflicht von Ausweispapieren (SchwarzArbG)\n(1) Bei der Erbringung von Dienst- oder Werkleistungen sind die in folgenden Wirtschaftsbereichen oder Wirtschaftszweigen tätigen Personen verpflichtet, ihren Personalausweis, Pass, Passersatz oder Ausweisersatz mitzuführen und den Behörden der Zollverwaltung auf Verlangen vorzulegen:\nim Baugewerbe,\nim Gaststätten- und Beherbergungsgewerbe,\nim Personenbeförderungsgewerbe,\nim Speditions-, Transport- und damit verbundenen Logistikgewerbe,\nim Schaustellergewerbe,\nbei Unternehmen der Forstwirtschaft,\nim Gebäudereinigungsgewerbe,\nbei Unternehmen, die sich am Auf- und Abbau von Messen und Ausstellungen beteiligen, 9. in der Fleischwirtschaft.\n(2) Der Arbeitgeber hat jeden und jede seiner Arbeitnehmer und Arbeitnehmerinnen nachweislich und schriftlich auf die Pflicht nach Absatz 1 hinzuweisen, diesen Hinweis für die Dauer der Erbringung der Dienst- oder Werkleistungen aufzubewahren und auf Verlangen bei den Prüfungen nach §2 Abs.1 vorzulegen.\nHiermit weisen wir Sie ausdrücklich auf die Mitführungs- und Vorlagepflicht hin. Gleichzeitig weisen wir Sie daraufhin, dass derjenige ordnungswidrig i.S. des §8IIS.1Nr.1 SchwarzArbG handelt, wer vorsätzlich (d.h. mit „Wissen und Wollen“) oder fahrlässig (d.h. „unter Außerachtlassung der im Verkehr erforderlichen Sorgfalt“) entgegen §2a Abs.1 SchwarzArbG ein vorgenanntes Dokument nicht mit führt oder nicht rechtzeitig vorlegt. Die Ordnungswidrigkeit kann mit einer Geldbuße bis zu 5000€ geahndet werden.\n{{ort}}, {{datum_heute}}\n\nOrt, Datum\tUnterschrift, Arbeitgeber\nMit meiner Unterschrift bestätige ich, ein Exemplar der Belehrung erhalten zu haben und über meine Pflichten aufgeklärt worden zu sein:\n\n{{ort}}, {{datum_heute}}\n\nOrt, Datum\tUnterschrift, Arbeitnehmer'}, 'teilzeit': {'titel': 'Arbeitsvertrag Teilzeit', 'sortierung': 2, 'text': 'Zwischen\n{{firma_name}}\n{{firma_strasse}}\n{{firma_plz_ort}}\n\n-nachfolgend Firma genannt-\nund\nHerr:\n{{ma_name}}\n{{ma_strasse}}\n{{ma_plz_ort}}\n-nachfolgend Mitarbeiter genannt-\n\n\nwird folgender Arbeitsvertrag vereinbart:\n\n\n§1\tEinstellung und Aufgaben\n\nDer Mitarbeiter wird bei der Firma ab dem {{eintritt}} als {{taetigkeit}} tätig. Das Arbeitsverhältnis ist {{befristung}}.\n\nDer Mitarbeiter ist nach näherer Weisung der Geschäftsführung auch zur Leistung anderer zumutbarer Arbeit, auch an einem anderen Arbeitsort, verpflichtet. Der jeweilige Einsatz erfolgt durch die Betriebsleitung nach betrieblichen Belangen. Das Recht der Firma, dem Mitarbeiter eine andere Tätigkeit zu übertragen, wird auch durch eine lange währende Verwendung auf demselben Arbeitsplatz nicht beschränkt.\n\nIst eine Rufbereitschaft im Betrieb eingerichtet, ist der Mitarbeiter verpflichtet diese Rufbereitschaft turnusgemäß wahrzunehmen. Der Mitarbeiter hat dafür Sorge zu tragen, dass er während der Rufbereitschaft telefonisch erreichbar ist.\n\n§ 2\tProbezeit\n\nDas Arbeitsverhältnis wird auf unbestimmte Zeit geschlossen. Die ersten 6 Monate gelten als Probezeit. Während der Probezeit kann das Arbeitsverhältnis beiderseits mit einer Frist von zwei Wochen gekündigt werden.\n\n§ 3\tArbeitszeit\n\nDie Arbeitszeit beträgt {{wochenstunden}} Stunden in der Woche ohne die Berücksichtigung von Pausen. Die Lage der Arbeitszeit richtet sich nach der betriebsüblichen Zeit gemäß den Vorgaben des Einsatzplanes.\n\nEs wird eine {{arbeitstage}}-Tage-Woche zu Grunde gelegt.\n\nDie Firma ist berechtigt, nach billigem Ermessen eine Änderung der Dienstzeiteinteilung vorzunehmen.\nIm Falle der Erforderlichkeit verpflichtet sich der Mitarbeiter, auf Anordnung der Firma auch über die betriebsübliche Zeit hinaus zu arbeiten. Überstunden/Mehrarbeit werden nach Wahl der Firma durch Freizeit oder Geld ausgeglichen.\n\nÜber die täglichen Arbeitszeiten führt der Mitarbeiter Aufzeichnungen. Diese sind der Firma wöchentlich vorzulegen.\n\nDie Firma kann Kurzarbeit anordnen, wenn ein erheblicher Arbeitsausfall vorliegt, der auf wirtschaftlichen Gründen oder einem unabwendbaren Ereignis beruht, und der Arbeitsausfall der Arbeitsverwaltung angezeigt ist (§§ 95 ff. SGB III). Für die Dauer der Kurzarbeit vermindert sich die in § 4 dieses Vertrages geregelte Vergütung im Verhältnis der ausgefallenen Arbeitszeit. Bei der Anordnung von Kurzarbeit hat die Firma gegenüber dem Mitarbeiter eine Ankündigungsfrist von vier Wochen einzuhalten. Die Kurzarbeit kann nur für die Dauer von bis zu 12 Monaten und nur mit Kurzarbeit von mindestens 50 % der bisherigen Arbeitszeit angeordnet werden und nur dann, wenn entweder der ganze Betrieb oder zumindest die Betriebsabteilung des Mitarbeiters betroffen sind.\n\n§ 4\tVergütung\n\nDer Arbeitnehmer erhält einen Stundenlohn in Höhe von        € brutto (§ 1 Abs. 2 MiLoG).\nAbrechnungszeitraum ist jeweils vom 01.des laufenden Monats bis zum Ende des laufenden Monats.\nDie Vergütung ist jeweils bis zum 15. eines Folgemonats bargeldlos zu zahlen.\nDer Mitarbeiter ist verpflichtet, ein Konto zu unterhalten und der Firma die Kontodaten mitzuteilen.\nDer Mitarbeiter ist verpflichtet, die Gehaltszahlung auf ihre Richtigkeit zu überprüfen. Irrtümliche\nGehaltszahlungen sind vom Mitarbeiter unverzüglich der Firma anzuzeigen und auf Verlangen der Firma von dem Mitarbeiter zurückzuerstatten. Der Mitarbeiter kann sich nicht auf den Wegfall der Bereicherung berufen.\n§ 616 Satz 1 BGB ist abgedungen.\n\n§ 5\tUrlaub\n\nDer Mitarbeiter erhält {{urlaubstage}} Arbeitstage Urlaub. Bei der Berechnung der Urlaubstage wird eine {{arbeitstage}}-Tage-Woche zu Grunde gelegt. Eine Reduzierung der Wochenarbeitstage führt zu einer entsprechenden Verringerung des Erholungsurlaubes.\n\nIst das Kalenderjahr nicht erfüllt, wir der Urlaub monatsanteilig nach Betriebszugehörigkeit gewährt. Der Anspruch auf den gesetzlichen Mindesturlaub bleibt unberührt.\n\nDie Urlaubszeitpunkte stimmt der Mitarbeiter rechtzeitig mit der Firma ab, wobei weitgehend die berechtigten Interessen des Mitarbeiters berücksichtigt werden sollen. Der Urlaub muss im laufenden Kalenderjahr genommen werden.\n\nDer Urlaubsanspruch wird unter den Voraussetzungen von § 17 Abs. 1 BEEG für jeden Monat der Elternzeit um ein Zwölftel verkürzt.\n\n§ 6\tNebenbeschäftigung\n\nDer Arbeitnehmer verpflichtet sich, jede entgeltliche oder das Arbeitsverhältnis beeinträchtigende Nebenbeschäftigung vor ihrer Aufnahme dem Arbeitgeber gegenüber in Textform anzuzeigen. Sie ist nur mit Zustimmung des Arbeitgebers zulässig.\n\nDer Arbeitgeber erteilt die Einwilligung, wenn die Wahrnehmung der dienstlichen Aufgaben durch die Nebenbeschäftigung nicht behindert und sonstige berechtigte Interessen des Arbeitgebers nicht beeinträchtigt werden.\nDer Arbeitgeber kann seine Einwilligung jederzeit widerrufen, wenn sein betriebliches Interesse dies auch unter Berücksichtigung der Arbeitnehmerinteressen erfordert.\n\n                                 § 7\tArbeitsverhinderung/Ärztliche Untersuchung\n\nDer Mitarbeiter ist verpflichtet, der Firma seine Arbeitsunfähigkeit und deren voraussichtliche Dauer unverzüglich, d.h. bis spätestens 9:00 Uhr des ersten Krankheitstages, mitzuteilen. Dauert die Arbeitsunfähigkeit länger als einen Tag an, ist der Firma am nächsten Arbeitstag eine\nArbeitsunfähigkeitsbescheinigung vorzulegen. Ist der Zeitraum der Bescheinigung abgelaufen und dauert die\nArbeitsunfähigkeit an, so ist der Mitarbeiter verpflichtet, unverzüglich eine neue ärztliche\nBescheinigung vorzulegen. Dies gilt auch nach Ablauf des gesetzlichen Entgeltfortzahlungszeitraums. Im Einzelfall ist auf Verlangen der Firma eine ärztliche Arbeitsunfähigkeitsbescheinigung bereits am ersten Krankheitstag vorzulegen.\n\nDie Fortzahlung der Vergütung im Krankheitsfall richtet sich an den gesetzlichen Bestimmungen des\nEntgeltfortzahlungsgesetzes, wobei bei der Berechnung der Dauer der Entgeltfortzahlung sowohl die Tage, in denen der Mitarbeiter seine Arbeitsleistung zu erbringen hätte, als auch die arbeitsfreien Tage berücksichtigt werden.\n\nDer Mitarbeiter wird sich bei Vorliegen sachlicher Gründe auf Verlangen der Firma durch den Betriebsarzt, den medizinischen Dienst der Krankenkassen oder einen Amtsarzt auf Kosten der Firma auf seine gesundheitliche Eignung für die Tätigkeit nach diesem Arbeitsvertrag untersuchen lassen.\n\n§ 8\tBeendigung des Arbeitsverhältnisses\n\nDer Rücktritt vom Arbeitsvertrag oder seine Kündigung vor Aufnahme der Tätigkeit sind ausgeschlossen.\n\nDie Beendigung des Arbeitsverhältnisses durch Kündigung oder Aufhebungsvertrag bedarf für ihre Wirksamkeit der Schriftform, die elektronische Form ist ausgeschlossen.\n\nNach Ablauf der Probezeit finden die gesetzlichen Kündigungsfristen (§ 622 BGB) Anwendung.\n\nDanach kann ein Arbeitsverhältnis mit einer Kündigungsfrist von vier Wochen zum Fünfzehnten oder zum Ende eines Kalendermonats gekündigt werden.\n\nDie Kündigungsfristen für Arbeitgeber verlängern sich bei längerem Bestehen des Arbeitsverhältnisses wie folgt:\n\nNach zwei Jahren auf einen Monat zum Monatsende,\nnach fünf Jahren auf zwei Monate zum Monatsende,\nnach acht Jahren auf drei Monate zum Monatsende,\nnach zehn Jahren auf vier Monate zum Monatsende,\nnach zwölf Jahren auf fünf Monate zum Monatsende,\nnach 15 Jahren auf sechs Monate zum Monatsende, \nnach 20 Jahren auf sieben Monate zum Monatsende.\nJede gesetzliche Verlängerung der Kündigungsfrist zugunsten des Arbeitnehmers gilt in gleicher Weise auch zugunsten des Arbeitgebers.\nDer Arbeitgeber ist berechtigt, den Arbeitnehmer bis zur Beendigung des Arbeitsverhältnisses freizustellen. Die Freistellung erfolgt unter Anrechnung der dem Arbeitnehmer eventuell noch zustehenden Urlaubsansprüche sowie eventueller Guthaben auf dem Arbeitszeitkonto. In der Zeit der Freistellung hat sich der Arbeitnehmer einen durch Verwendung seiner Arbeitskraft erzielten Verdienst auf den Vergütungsanspruch gegenüber dem Arbeitgeber anrechnen zu lassen.\n\nDas Arbeitsverhältnis endet ohne Kündigung spätestens mit Ablauf des Monats, in dem der Arbeitnehmer das für ihn gesetzlich festgelegte Renteneintrittsalter vollendet hat.\n\nDas Recht zur außerordentlichen Kündigung bleibt unberührt.\n\n§ 9\tMeldepflichten\n\nDer Mitarbeiter bestätigt, dass weder eine Vorstrafe noch ein anhängiges Strafverfahren im Zusammenhang mit seiner beruflichen Tätigkeit ausgesprochen bzw. eingeleitet ist.\n\nDer Mitarbeiter hat ohne besondere Aufforderung für das Arbeitsverhältnis bedeutsame Änderungen der persönlichen Verhältnisse unverzüglich der Firma mitzuteilen und durch geeignete Unterlagen nachzuweisen.\nDazu gehören: Veränderungen, die zum Erwerb oder Verlust von Sonderrechten nach dem MuSchG oder SGB IX führen können (z. B. Feststellung einer Schwangerschaft, Feststellung der\nSchwerbehinderteneigenschaft); Wechsel der Krankenkassenmitgliedschaft, Veränderung der\nBeitragshöhe, Wohnungswechsel, Änderungen des Personenstandes oder der Familienverhältnisse, Einberufung zum Wehr- oder Zivildienst, Eheschließung, Namenswechsel, Geburt oder Annahme eines Kindes, rechtskräftiges Scheidungsurteil, Rentenantragstellung; Erhalt eines Rentenbescheides; Tod von Ehegatten und Kindern; Arbeits- und Freizeitunfälle; Wechsel des Gehaltskontos, Änderungen hinsichtlich der Aufenthalts- oder Arbeitserlaubnis und der Staatsangehörigkeit.\n\nHat der Mitarbeiter von strafbaren Handlungen im Betrieb oder gegen die Firma Kenntnis erlangt, hat er dies der Firma mitzuteilen. Das gilt insbesondere, wenn durch die Straftat erhebliche Vermögensinteressen der Firma berührt oder Personen gefährdet werden.\n\nWird der Mitarbeiter durch Handlungen eines Dritten arbeitsunfähig, tritt er bereits jetzt die ihm gegen diesen Dritten zustehenden Schadenersatzansprüche wegen Verdienstausfalls insoweit an die Firma ab, als die Firma für die Ausfallzeit Arbeitsentgelt gezahlt hat. Der Mitarbeiter ist verpflichtet, der Firma die zur Erhebung der Ansprüche erforderlichen Auskünfte zu erteilen.\n\n§ 10 Geheimhaltung\n\nDer Arbeitnehmer verpflichtet sich, während der Dauer des Arbeitsverhältnisses und auch nach dem Ausscheiden, über alle Geschäftsgeheimnisse sowie betriebliche Angelegenheiten vertraulicher Natur, die als solche von der Geschäftsleitung schriftlich oder mündlich bezeichnet werden bzw. offensichtlich als solche zu erkennen sind, Stillschweigen zu bewahren und ohne ausdrückliche Genehmigung der Geschäftsleitung keinen dritten Personen zugänglich zu machen. Der Arbeitnehmer hat die Anweisungen und Maßnahmen des Arbeitgebers zur Geheimhaltung zu beachten. Im Zweifelsfall wird der Arbeitnehmer eine Weisung des Arbeitgebers zur Vertraulichkeit bestimmter Tatsachen einholen.\n(Anmerkung: Das am 26. April 2019 in Kraft getretene Gesetz zum Schutz von Geschäftsgeheimnissen (GeschGehG) verlangt zudem aktive, objektiv feststellbare Schutzmaßnahmen seitens der Arbeitgeber; es kann daher empfehlenswert sein, die wesentlichen, von solchen Geheimhaltungsmaßnahmen betroffenen Informationen (abstrakt) zu beschreiben: „Als Geschäftsgeheimnisse geheim zu halten sind insbesondere...“)\nFür jeden Fall der Zuwiderhandlung gegen diese Verpflichtung verpflichtet er sich, eine Vertragsstrafe in Höhe einer Bruttomonatsvergütung zu zahlen. Die Geltendmachung eines weiteren Schadens bleibt dem Arbeitgeber vorbehalten.\n\nVerstößt der Arbeitnehmer gegen seine Verschwiegenheitspflicht, kann dies zur Kündigung führen.\n\n§ 11 Herausgabepflicht\n\nDer Mitarbeiter verpflichtet sich, bei Beendigung des Arbeitsverhältnisses unaufgefordert und ansonsten jederzeit auf Anforderung der Firma sämtliche ihm überlassenen oder von ihm für das Unternehmen gefertigten Schriftstücke oder sonstige Gegenstände der Firma an diesen unverzüglich herauszugeben. Ein Zurückbehaltungsrecht hinsichtlich dieser Unterlagen ist ausgeschlossen. Dasselbe gilt für auf Datenträger gespeicherte Daten.\n\nDer Mitarbeiter teilt der Firma alle Codes, Passwörter, Zugangssperren im Hinblick auf EDV-Nutzung mit und wird von diesen nach Aufforderung durch die Firma bzw. nach Beendigung des Arbeitsverhältnisses selbst keinen Gebrauch mehr machen. Ein Zurückbehaltungsrecht ist ausgeschlossen.\n\n§ 12 EDV-Nutzung\n\nDie betrieblichen EDV-Einrichtungen (Computer, Geräte und Programme),\nTelekommunikationseinrichtungen (Telefone, Telefax) und Kopiergeräte dürfen nur zu arbeitsvertraglichen Zwecken genutzt werden. Eine private Nutzung durch den Mitarbeiter ist nicht zulässig. Die Verpflichtung zur ausschließlich dienstlichen Nutzung gilt insbesondere für die Nutzung von E-Mail und Internet. Sollte der Mitarbeiter E-Mails privaten Inhalts erhalten, sind diese unverzüglich und vollständig zu löschen.\n\nVertrauliche Daten und Informationen sind von dem Mitarbeiter so zu schützen, dass dritte Personen keine Einsicht und Zugriff nehmen können.\n\nDie Vertragsparteien beachten die einschlägigen datenschutzrechtlichen Vorschriften. Der Mitarbeiter wird insbesondere personenbezogene Daten, die von der Firma oder Kunden der Firma zur Verfügung gestellt werden, nur im Rahmen von deren Weisungen und nach Maßgabe des als Anlage beigefügten Verpflichtung zur Einhaltung der datenschutzrechtlichen Anforderungen nach der DS-GVO erheben, verarbeiten oder nutzen.\n\nDer Mitarbeiter ist zu regelmäßiger Datensicherung im erforderlichen Umfang verpflichtet.\n\n§ 13 Ausschlussfristen\n\nAlle Ansprüche aus dem Arbeitsverhältnis und solche, die mit diesem in Verbindung stehen, verfallen, wenn sie nicht innerhalb von drei Monaten nach der Fälligkeit gegenüber der anderen Vertragspartei in Textform erhoben werden. Lehnt die Gegenpartei den Anspruch in Textform ab oder erklärt sie sich nicht innerhalb von einem Monat nach der Geltendmachung des Anspruchs in Textform, so verfällt dieser, wenn er nicht innerhalb von drei Monaten nach der Ablehnung oder dem Fristablauf gerichtlich geltend gemacht wird.\n\nDiese Ausschlussfrist gilt nicht für Ansprüche, die auf einer vorsätzlichen oder grob fahrlässigen Pflichtverletzung der anderen Vertragspartei bzw. eines Erfüllungsgehilfen der anderen Vertragspartei beruhen. Diese Ausschlussfrist gilt weiterhin nicht für Ansprüche, die auf einer Verletzung des Lebens, des Körpers oder der Gesundheit aufgrund einer schuldhaften Pflichtverletzung der anderen Vertragspartei bzw. eines Erfüllungsgehilfen der anderen Vertragspartei beruhen.\n\nAnsprüche nach dem Mindestlohngesetz bleiben von der Ausschlussfristenregelung unberührt.\n\n§ 14 Übergabe von Bargeldeinnahmen\n\nDer Arbeitnehmer verpflichtet sich, alle von Kunden eingenommenen Bargelder jeweils amdarauffolgenden Montag vollständig und ordnungsgemäß an die Firma zu übergeben.\n\nKommt der Arbeitnehmer dieser Verpflichtung nicht innerhalb einer Woche nach, wird die Firmaden Arbeitnehmer schriftlich abmahnen. Erfolgt nach der Abmahnung erneut kein fristgerechter\nAusgleich der Beträge in der darauffolgenden Woche, behält sich die Firma das Recht vor, das Arbeitsverhältnis fristgerecht oder, im Falle eines vorsätzlichen und schwerwiegenden Verstoßes, fristlos zu kündigen.\nNicht übergebene Beträge werden hiermit vereinbart, dass der Arbeitnehmer diese Beträge als Vorschuss auf sein Gehalt akzeptiert.\nDer Arbeitnehmer wird über die Kündigung schriftlich informiert. Die Kündigung wird mit Zugangdes Schreibens wirksam, sofern keine andere Frist gilt.\n\n§ 15 Selbstbeteiligung bei Unfällen\n\nVerursacht der Arbeitnehmer während der Ausübung seiner Tätigkeit einen Unfall, der durchmittlere Fahrlässigkeit, grobe Fahrlässigkeit oder Vorsatz entstanden ist, verpflichtet er sich, eine\nSelbstbeteiligung in Höhe der vertraglich vereinbarten Selbstbeteiligung der Vollkaskoversicherung des Fahrzeugs zu zahlen, jedoch maximal               Euro pro Schadensfall.\n\nDie Selbstbeteiligung wird nur dann fällig, wenn die Schuld des Arbeitnehmers eindeutigfestgestellt wurde, z. B. durch ein Unfallprotokoll, ein Gutachten oder eine Entscheidung der zuständigen Behörden.\n\nDie Zahlung der Selbstbeteiligung erfolgt nach Aufforderung durch die Firma und kann nach Absprache mit dem Arbeitnehmer in Raten vom Gehalt abgezogen werden.\n\n§ 16 Verhalten nach Beendigung eines Auftrags\n\nDer Mitarbeiter, sofern er als {{taetigkeit}} tätig ist, ist gemäß § 49 Absatz 4 des Personenbeförderungsgesetzes (PBefG) verpflichtet, nach jedem abgeschlossenen Auftrag unverzüglich und ohne Aufforderung zum Betriebssitz zurückzukehren, es sei denn, es wurde vor oder während der Rückfahrt ein neuer Auftrag von der Firma vermittelt.\n\nWährend der Rückfahrt zum Betriebssitz darf der Mitarbeiter ausschließlich Aufträge ausführen,die ihm vorab oder unterwegs von der Firma oder einem autorisierten Vermittler übermittelt wurden.\n\nDas eigenständige Aufnehmen von Fahrgästen auf der Straße, ohne vorherige Vermittlung durchdie Firma oder einen autorisierten Vermittler, ist strengstens untersagt. Dies gilt insbesondere für das Anhalten aufgrund von Handzeichen, Zuruf oder anderweitigem direkten Kontakt mit potenziellen Fahrgästen.\nDer Mitarbeiter ist verpflichtet, die Regelungen des Personenbeförderungsgesetzes strikteinzuhalten, insbesondere in Bezug auf die Abgrenzung zwischen Mietwagenverkehr und\nTaxiverkehr. Verstöße gegen diese Bestimmungen können arbeitsrechtliche Konsequenzen nach sich ziehen, bis hin zur fristlosen Kündigung.\n\nHiermit wird der Arbeitsvertrag um folgende Klauseln erweitert:\n§ 17 Zusätzliche Vereinbarungen\n\nDer Mitarbeiter wird überwiegend in der Nachtschicht /Frühschicht eingesetzt\n\n§ 18 Änderungen und Ergänzungen\n\nMündliche Nebenabreden bestehen nicht. Änderungen und Ergänzungen des Vertrages, soweit sie nicht auf einer individuellen Vereinbarung der Parteien beruhen, bedürfen zu ihrer Rechtsgültigkeit der Textform. Das bedeutet, dass Ansprüche aus betrieblicher Übung nicht entstehen können. Eine etwaige Ungültigkeit einzelner Vertragsbestimmungen berührt die Wirksamkeit der übrigen Bestimmungen nicht.\n\nSollten einzelne Bestimmungen dieses Vertrags ganz oder teilweise unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.\n\nDie Vertragsparteien sind im Falle einer unwirksamen Bestimmung verpflichtet, über eine wirksame und zumutbare Ersatzregelung zu verhandeln, die dem von den Vertragsparteien mit der unwirksamen Bestimmung verfolgten wirtschaftlichen Zweck möglichst nahekommt.\n\n\n{{ort}}, den {{datum_heute}}\n\n\nUnterschrift Firma\t                                                                             Unterschrift Mitarbeiter\n\n\nAnlage 1\n\nVerpflichtung zur Einhaltung der datenschutzrechtlichen Anforderungen nach der Datenschutz-Grundverordnung (DS-GVO)\nHerr:  \nwurde darauf verpflichtet, dass es untersagt ist, personenbezogene Daten unbefugt zu verarbeiten. Personenbezogene Daten dürfen daher nur verarbeitet werden, wenn eine Einwilligung bzw. eine gesetzliche Regelung die Verarbeitung erlauben oder eine Verarbeitung dieser Daten vorgeschrieben ist. Die Grundsätze der DS-GVO für die Verarbeitung personenbezogener Daten sind in Art. 5 Abs. 1 DS-GVO festgelegt und beinhalten im Wesentlichen folgende Verpflichtungen:\nPersonenbezogene Daten müssen\nauf rechtmäßige Weise und in einer für die betroffene Person nachvollziehbaren Weise verarbeitet werden;\nfür festgelegte, eindeutige und legitime Zwecke erhoben werden und dürfen nicht in einer mit diesen Zwecken nicht zu vereinbarenden Weise weiterverarbeitet werden;\ndem Zweck angemessen und erheblich sowie auf das für die Zwecke der Verarbeitung notwendige\nMaß beschränkt sein („Datenminimierung“);\nsachlich richtig und erforderlichenfalls auf dem neuesten Stand sein; es sind alle angemessenen\nMaßnahmen zu treffen, damit personenbezogene Daten, die im Hinblick auf die Zwecke ihrer\nVerarbeitung unrichtig sind, unverzüglich gelöscht oder berichtigt werden;\nin einer Form gespeichert werden, die die Identifizierung der betroffenen Personen nur so lange ermöglicht, wie es für die Zwecke, für die sie verarbeitet werden, erforderlich ist;\nin einer Weise verarbeitet werden, die eine angemessene Sicherheit der personenbezogenen Daten gewährleistet, einschließlich Schutz vor unbefugter oder unrechtmäßiger Verarbeitung und vor unbeabsichtigtem Verlust, unbeabsichtigter Zerstörung oder unbeabsichtigter Schädigung durch geeignete technische und organisatorische Maßnahmen („Integrität und Vertraulichkeit“);\nVerstöße gegen diese Verpflichtung können mit Geldbuße und/oder Freiheitsstrafe geahndet werden. Ein Verstoß kann zugleich eine Verletzung von arbeitsvertraglichen Pflichten oder spezieller Geheimhaltungspflichten darstellen. Auch (zivilrechtliche) Schadenersatzansprüche können sich aus schuldhaften Verstößen gegen diese Verpflichtung ergeben. Ihre sich aus dem Arbeitsvertrag oder gesonderten Vereinbarungen ergebende Vertraulichkeitsverpflichtung wird durch diese Erklärung nicht berührt.\nDie Verpflichtung gilt auch nach Beendigung der Tätigkeit weiter.\nIch bestätige diese Verpflichtung. Ein Exemplar der Verpflichtung habe ich erhalten.\n\n{{ort}}, {{datum_heute}}\n\n\n________________________________                                             \t__________________________\nUnterschrift des Verpflichteten\t                                                           Unterschrift des Verantwortlichen\n\n\nAnlage 2\nBelehrung über die Mitführungs- und Vorlagepflicht von Ausweispapieren gemäß §2a SchwarzArbG\nHerr:  \n\nIhre Pflichten als Arbeitnehmer:\nSie sind als Arbeitnehmer verpflichtet, jederzeit ihre amtlichen Ausweispapiere bei der Ausübung der Tätigkeit für den Arbeitgeber mitzuführen. Bei einem Verstoß droht ein Bußgeld bis zu 5.000,00 Euro. Sie sind verpflichtet, die Ausweispapiere im Rahmen einer Prüfung durch staatliche Stellen vorzulegen. Bei einem Verstoß droht ein Bußgeld bis zu 5.000,00 Euro.\nSie haben Prüfungen durch staatliche Stellen zu dulden und die Pflicht mitzuwirken, insbesondere Auskunft zu erteilen.\nWortlaut des §2a Mitführungs- und Vorlagepflicht von Ausweispapieren (SchwarzArbG)\n(1) Bei der Erbringung von Dienst- oder Werkleistungen sind die in folgenden Wirtschaftsbereichen oder Wirtschaftszweigen tätigen Personen verpflichtet, ihren Personalausweis, Pass, Passersatz oder Ausweisersatz mitzuführen und den Behörden der Zollverwaltung auf Verlangen vorzulegen:\nim Baugewerbe,\nim Gaststätten- und Beherbergungsgewerbe,\nim Personenbeförderungsgewerbe,\nim Speditions-, Transport- und damit verbundenen Logistikgewerbe,\nim Schaustellergewerbe,\nbei Unternehmen der Forstwirtschaft,\nim Gebäudereinigungsgewerbe,\nbei Unternehmen, die sich am Auf- und Abbau von Messen und Ausstellungen beteiligen, 9. in der Fleischwirtschaft.\n(2) Der Arbeitgeber hat jeden und jede seiner Arbeitnehmer und Arbeitnehmerinnen nachweislich und schriftlich auf die Pflicht nach Absatz 1 hinzuweisen, diesen Hinweis für die Dauer der Erbringung der Dienst- oder Werkleistungen aufzubewahren und auf Verlangen bei den Prüfungen nach §2 Abs.1 vorzulegen.\nHiermit weisen wir Sie ausdrücklich auf die Mitführungs- und Vorlagepflicht hin. Gleichzeitig weisen wir Sie daraufhin, dass derjenige ordnungswidrig i.S. des §8IIS.1Nr.1 SchwarzArbG handelt, wer vorsätzlich (d.h. mit „Wissen und Wollen“) oder fahrlässig (d.h. „unter Außerachtlassung der im Verkehr erforderlichen Sorgfalt“) entgegen §2a Abs.1 SchwarzArbG ein vorgenanntes Dokument nicht mit führt oder nicht rechtzeitig vorlegt. Die Ordnungswidrigkeit kann mit einer Geldbuße bis zu 5000€ geahndet werden.\n{{ort}}, {{datum_heute}}\n\nOrt, Datum\tUnterschrift, Arbeitgeber\nMit meiner Unterschrift bestätige ich, ein Exemplar der Belehrung erhalten zu haben und über meine Pflichten aufgeklärt worden zu sein:\n\n{{ort}}, {{datum_heute}}\n\nOrt, Datum\tUnterschrift, Arbeitnehmer'}, 'minijob': {'titel': 'Arbeitsvertrag Minijob', 'sortierung': 3, 'text': 'Zwischen\n{{firma_name}}\n{{firma_strasse}}\n{{firma_plz_ort}}\n\n-nachfolgend Firma genannt-\nund\nHerr:\n{{ma_name}}\n{{ma_strasse}}\n{{ma_plz_ort}}\n-nachfolgend Mitarbeiter genannt-\n\n\nwird folgender Arbeitsvertrag vereinbart:\n\n\n§1\tEinstellung und Aufgaben\n\nDer Mitarbeiter wird bei der Firma ab dem {{eintritt}} als {{taetigkeit}} tätig. Das Arbeitsverhältnis ist {{befristung}}.\n\nDer Mitarbeiter ist nach näherer Weisung der Geschäftsführung auch zur Leistung anderer zumutbarer Arbeit, auch an einem anderen Arbeitsort, verpflichtet. Der jeweilige Einsatz erfolgt durch die Betriebsleitung nach betrieblichen Belangen. Das Recht der Firma, dem Mitarbeiter eine andere Tätigkeit zu übertragen, wird auch durch eine lange währende Verwendung auf demselben Arbeitsplatz nicht beschränkt.\n\nIst eine Rufbereitschaft im Betrieb eingerichtet, ist der Mitarbeiter verpflichtet diese Rufbereitschaft turnusgemäß wahrzunehmen. Der Mitarbeiter hat dafür Sorge zu tragen, dass er während der Rufbereitschaft telefonisch erreichbar ist.\n\n§ 2\tProbezeit\n\nDas Arbeitsverhältnis wird auf unbestimmte Zeit geschlossen. Die ersten 6 Monate gelten als Probezeit. Während der Probezeit kann das Arbeitsverhältnis beiderseits mit einer Frist von zwei Wochen gekündigt werden.\n\n§ 3\tArbeitszeit\n\nDie Arbeitszeit beträgt {{wochenstunden}} Stunden in der Woche ohne die Berücksichtigung von Pausen. Die Lage der Arbeitszeit richtet sich nach der betriebsüblichen Zeit gemäß den Vorgaben des Einsatzplanes.\n\nEs wird eine {{arbeitstage}}-Tage-Woche zu Grunde gelegt.\n\nDie Firma ist berechtigt, nach billigem Ermessen eine Änderung der Dienstzeiteinteilung vorzunehmen.\nIm Falle der Erforderlichkeit verpflichtet sich der Mitarbeiter, auf Anordnung der Firma auch über die betriebsübliche Zeit hinaus zu arbeiten. Überstunden/Mehrarbeit werden nach Wahl der Firma durch Freizeit oder Geld ausgeglichen.\n\nÜber die täglichen Arbeitszeiten führt der Mitarbeiter Aufzeichnungen. Diese sind der Firma wöchentlich vorzulegen.\n\nDie Firma kann Kurzarbeit anordnen, wenn ein erheblicher Arbeitsausfall vorliegt, der auf wirtschaftlichen Gründen oder einem unabwendbaren Ereignis beruht, und der Arbeitsausfall der Arbeitsverwaltung angezeigt ist (§§ 95 ff. SGB III). Für die Dauer der Kurzarbeit vermindert sich die in § 4 dieses Vertrages geregelte Vergütung im Verhältnis der ausgefallenen Arbeitszeit. Bei der Anordnung von Kurzarbeit hat die Firma gegenüber dem Mitarbeiter eine Ankündigungsfrist von vier Wochen einzuhalten. Die Kurzarbeit kann nur für die Dauer von bis zu 12 Monaten und nur mit Kurzarbeit von mindestens 50 % der bisherigen Arbeitszeit angeordnet werden und nur dann, wenn entweder der ganze Betrieb oder zumindest die Betriebsabteilung des Mitarbeiters betroffen sind.\n\n§ 4\tVergütung\n\nDer Arbeitnehmer erhält einen Stundenlohn in Höhe von        € brutto (§ 1 Abs. 2 MiLoG).\nAbrechnungszeitraum ist jeweils vom 01.des laufenden Monats bis zum Ende des laufenden Monats.\nDie Vergütung ist jeweils bis zum 15. eines Folgemonats bargeldlos zu zahlen.\nDer Mitarbeiter ist verpflichtet, ein Konto zu unterhalten und der Firma die Kontodaten mitzuteilen.\nDer Mitarbeiter ist verpflichtet, die Gehaltszahlung auf ihre Richtigkeit zu überprüfen. Irrtümliche\nGehaltszahlungen sind vom Mitarbeiter unverzüglich der Firma anzuzeigen und auf Verlangen der Firma von dem Mitarbeiter zurückzuerstatten. Der Mitarbeiter kann sich nicht auf den Wegfall der Bereicherung berufen.\n§ 616 Satz 1 BGB ist abgedungen.\n\n§ 5\tUrlaub\n\nDer Mitarbeiter erhält {{urlaubstage}} Arbeitstage Urlaub. Bei der Berechnung der Urlaubstage wird eine {{arbeitstage}}-Tage-Woche zu Grunde gelegt. Eine Reduzierung der Wochenarbeitstage führt zu einer entsprechenden Verringerung des Erholungsurlaubes.\n\nIst das Kalenderjahr nicht erfüllt, wir der Urlaub monatsanteilig nach Betriebszugehörigkeit gewährt. Der Anspruch auf den gesetzlichen Mindesturlaub bleibt unberührt.\n\nDie Urlaubszeitpunkte stimmt der Mitarbeiter rechtzeitig mit der Firma ab, wobei weitgehend die berechtigten Interessen des Mitarbeiters berücksichtigt werden sollen. Der Urlaub muss im laufenden Kalenderjahr genommen werden.\n\nDer Urlaubsanspruch wird unter den Voraussetzungen von § 17 Abs. 1 BEEG für jeden Monat der Elternzeit um ein Zwölftel verkürzt.\n\n§ 6\tNebenbeschäftigung\n\nDer Arbeitnehmer verpflichtet sich, jede entgeltliche oder das Arbeitsverhältnis beeinträchtigende Nebenbeschäftigung vor ihrer Aufnahme dem Arbeitgeber gegenüber in Textform anzuzeigen. Sie ist nur mit Zustimmung des Arbeitgebers zulässig.\n\nDer Arbeitgeber erteilt die Einwilligung, wenn die Wahrnehmung der dienstlichen Aufgaben durch die Nebenbeschäftigung nicht behindert und sonstige berechtigte Interessen des Arbeitgebers nicht beeinträchtigt werden.\nDer Arbeitgeber kann seine Einwilligung jederzeit widerrufen, wenn sein betriebliches Interesse dies auch unter Berücksichtigung der Arbeitnehmerinteressen erfordert.\n\n                                 § 7\tArbeitsverhinderung/Ärztliche Untersuchung\n\nDer Mitarbeiter ist verpflichtet, der Firma seine Arbeitsunfähigkeit und deren voraussichtliche Dauer unverzüglich, d.h. bis spätestens 9:00 Uhr des ersten Krankheitstages, mitzuteilen. Dauert die Arbeitsunfähigkeit länger als einen Tag an, ist der Firma am nächsten Arbeitstag eine\nArbeitsunfähigkeitsbescheinigung vorzulegen. Ist der Zeitraum der Bescheinigung abgelaufen und dauert die\nArbeitsunfähigkeit an, so ist der Mitarbeiter verpflichtet, unverzüglich eine neue ärztliche\nBescheinigung vorzulegen. Dies gilt auch nach Ablauf des gesetzlichen Entgeltfortzahlungszeitraums. Im Einzelfall ist auf Verlangen der Firma eine ärztliche Arbeitsunfähigkeitsbescheinigung bereits am ersten Krankheitstag vorzulegen.\n\nDie Fortzahlung der Vergütung im Krankheitsfall richtet sich an den gesetzlichen Bestimmungen des\nEntgeltfortzahlungsgesetzes, wobei bei der Berechnung der Dauer der Entgeltfortzahlung sowohl die Tage, in denen der Mitarbeiter seine Arbeitsleistung zu erbringen hätte, als auch die arbeitsfreien Tage berücksichtigt werden.\n\nDer Mitarbeiter wird sich bei Vorliegen sachlicher Gründe auf Verlangen der Firma durch den Betriebsarzt, den medizinischen Dienst der Krankenkassen oder einen Amtsarzt auf Kosten der Firma auf seine gesundheitliche Eignung für die Tätigkeit nach diesem Arbeitsvertrag untersuchen lassen.\n\n§ 8\tBeendigung des Arbeitsverhältnisses\n\nDer Rücktritt vom Arbeitsvertrag oder seine Kündigung vor Aufnahme der Tätigkeit sind ausgeschlossen.\n\nDie Beendigung des Arbeitsverhältnisses durch Kündigung oder Aufhebungsvertrag bedarf für ihre Wirksamkeit der Schriftform, die elektronische Form ist ausgeschlossen.\n\nNach Ablauf der Probezeit finden die gesetzlichen Kündigungsfristen (§ 622 BGB) Anwendung.\n\nDanach kann ein Arbeitsverhältnis mit einer Kündigungsfrist von vier Wochen zum Fünfzehnten oder zum Ende eines Kalendermonats gekündigt werden.\n\nDie Kündigungsfristen für Arbeitgeber verlängern sich bei längerem Bestehen des Arbeitsverhältnisses wie folgt:\n\nNach zwei Jahren auf einen Monat zum Monatsende,\nnach fünf Jahren auf zwei Monate zum Monatsende,\nnach acht Jahren auf drei Monate zum Monatsende,\nnach zehn Jahren auf vier Monate zum Monatsende,\nnach zwölf Jahren auf fünf Monate zum Monatsende,\nnach 15 Jahren auf sechs Monate zum Monatsende, \nnach 20 Jahren auf sieben Monate zum Monatsende.\nJede gesetzliche Verlängerung der Kündigungsfrist zugunsten des Arbeitnehmers gilt in gleicher Weise auch zugunsten des Arbeitgebers.\nDer Arbeitgeber ist berechtigt, den Arbeitnehmer bis zur Beendigung des Arbeitsverhältnisses freizustellen. Die Freistellung erfolgt unter Anrechnung der dem Arbeitnehmer eventuell noch zustehenden Urlaubsansprüche sowie eventueller Guthaben auf dem Arbeitszeitkonto. In der Zeit der Freistellung hat sich der Arbeitnehmer einen durch Verwendung seiner Arbeitskraft erzielten Verdienst auf den Vergütungsanspruch gegenüber dem Arbeitgeber anrechnen zu lassen.\n\nDas Arbeitsverhältnis endet ohne Kündigung spätestens mit Ablauf des Monats, in dem der Arbeitnehmer das für ihn gesetzlich festgelegte Renteneintrittsalter vollendet hat.\n\nDas Recht zur außerordentlichen Kündigung bleibt unberührt.\n\n§ 9\tMeldepflichten\n\nDer Mitarbeiter bestätigt, dass weder eine Vorstrafe noch ein anhängiges Strafverfahren im Zusammenhang mit seiner beruflichen Tätigkeit ausgesprochen bzw. eingeleitet ist.\n\nDer Mitarbeiter hat ohne besondere Aufforderung für das Arbeitsverhältnis bedeutsame Änderungen der persönlichen Verhältnisse unverzüglich der Firma mitzuteilen und durch geeignete Unterlagen nachzuweisen.\nDazu gehören: Veränderungen, die zum Erwerb oder Verlust von Sonderrechten nach dem MuSchG oder SGB IX führen können (z. B. Feststellung einer Schwangerschaft, Feststellung der\nSchwerbehinderteneigenschaft); Wechsel der Krankenkassenmitgliedschaft, Veränderung der\nBeitragshöhe, Wohnungswechsel, Änderungen des Personenstandes oder der Familienverhältnisse, Einberufung zum Wehr- oder Zivildienst, Eheschließung, Namenswechsel, Geburt oder Annahme eines Kindes, rechtskräftiges Scheidungsurteil, Rentenantragstellung; Erhalt eines Rentenbescheides; Tod von Ehegatten und Kindern; Arbeits- und Freizeitunfälle; Wechsel des Gehaltskontos, Änderungen hinsichtlich der Aufenthalts- oder Arbeitserlaubnis und der Staatsangehörigkeit.\n\nHat der Mitarbeiter von strafbaren Handlungen im Betrieb oder gegen die Firma Kenntnis erlangt, hat er dies der Firma mitzuteilen. Das gilt insbesondere, wenn durch die Straftat erhebliche Vermögensinteressen der Firma berührt oder Personen gefährdet werden.\n\nWird der Mitarbeiter durch Handlungen eines Dritten arbeitsunfähig, tritt er bereits jetzt die ihm gegen diesen Dritten zustehenden Schadenersatzansprüche wegen Verdienstausfalls insoweit an die Firma ab, als die Firma für die Ausfallzeit Arbeitsentgelt gezahlt hat. Der Mitarbeiter ist verpflichtet, der Firma die zur Erhebung der Ansprüche erforderlichen Auskünfte zu erteilen.\n\n§ 10 Geheimhaltung\n\nDer Arbeitnehmer verpflichtet sich, während der Dauer des Arbeitsverhältnisses und auch nach dem Ausscheiden, über alle Geschäftsgeheimnisse sowie betriebliche Angelegenheiten vertraulicher Natur, die als solche von der Geschäftsleitung schriftlich oder mündlich bezeichnet werden bzw. offensichtlich als solche zu erkennen sind, Stillschweigen zu bewahren und ohne ausdrückliche Genehmigung der Geschäftsleitung keinen dritten Personen zugänglich zu machen. Der Arbeitnehmer hat die Anweisungen und Maßnahmen des Arbeitgebers zur Geheimhaltung zu beachten. Im Zweifelsfall wird der Arbeitnehmer eine Weisung des Arbeitgebers zur Vertraulichkeit bestimmter Tatsachen einholen.\n(Anmerkung: Das am 26. April 2019 in Kraft getretene Gesetz zum Schutz von Geschäftsgeheimnissen (GeschGehG) verlangt zudem aktive, objektiv feststellbare Schutzmaßnahmen seitens der Arbeitgeber; es kann daher empfehlenswert sein, die wesentlichen, von solchen Geheimhaltungsmaßnahmen betroffenen Informationen (abstrakt) zu beschreiben: „Als Geschäftsgeheimnisse geheim zu halten sind insbesondere...“)\nFür jeden Fall der Zuwiderhandlung gegen diese Verpflichtung verpflichtet er sich, eine Vertragsstrafe in Höhe einer Bruttomonatsvergütung zu zahlen. Die Geltendmachung eines weiteren Schadens bleibt dem Arbeitgeber vorbehalten.\n\nVerstößt der Arbeitnehmer gegen seine Verschwiegenheitspflicht, kann dies zur Kündigung führen.\n\n§ 11 Herausgabepflicht\n\nDer Mitarbeiter verpflichtet sich, bei Beendigung des Arbeitsverhältnisses unaufgefordert und ansonsten jederzeit auf Anforderung der Firma sämtliche ihm überlassenen oder von ihm für das Unternehmen gefertigten Schriftstücke oder sonstige Gegenstände der Firma an diesen unverzüglich herauszugeben. Ein Zurückbehaltungsrecht hinsichtlich dieser Unterlagen ist ausgeschlossen. Dasselbe gilt für auf Datenträger gespeicherte Daten.\n\nDer Mitarbeiter teilt der Firma alle Codes, Passwörter, Zugangssperren im Hinblick auf EDV-Nutzung mit und wird von diesen nach Aufforderung durch die Firma bzw. nach Beendigung des Arbeitsverhältnisses selbst keinen Gebrauch mehr machen. Ein Zurückbehaltungsrecht ist ausgeschlossen.\n\n§ 12 EDV-Nutzung\n\nDie betrieblichen EDV-Einrichtungen (Computer, Geräte und Programme),\nTelekommunikationseinrichtungen (Telefone, Telefax) und Kopiergeräte dürfen nur zu arbeitsvertraglichen Zwecken genutzt werden. Eine private Nutzung durch den Mitarbeiter ist nicht zulässig. Die Verpflichtung zur ausschließlich dienstlichen Nutzung gilt insbesondere für die Nutzung von E-Mail und Internet. Sollte der Mitarbeiter E-Mails privaten Inhalts erhalten, sind diese unverzüglich und vollständig zu löschen.\n\nVertrauliche Daten und Informationen sind von dem Mitarbeiter so zu schützen, dass dritte Personen keine Einsicht und Zugriff nehmen können.\n\nDie Vertragsparteien beachten die einschlägigen datenschutzrechtlichen Vorschriften. Der Mitarbeiter wird insbesondere personenbezogene Daten, die von der Firma oder Kunden der Firma zur Verfügung gestellt werden, nur im Rahmen von deren Weisungen und nach Maßgabe des als Anlage beigefügten Verpflichtung zur Einhaltung der datenschutzrechtlichen Anforderungen nach der DS-GVO erheben, verarbeiten oder nutzen.\n\nDer Mitarbeiter ist zu regelmäßiger Datensicherung im erforderlichen Umfang verpflichtet.\n\n§ 13 Ausschlussfristen\n\nAlle Ansprüche aus dem Arbeitsverhältnis und solche, die mit diesem in Verbindung stehen, verfallen, wenn sie nicht innerhalb von drei Monaten nach der Fälligkeit gegenüber der anderen Vertragspartei in Textform erhoben werden. Lehnt die Gegenpartei den Anspruch in Textform ab oder erklärt sie sich nicht innerhalb von einem Monat nach der Geltendmachung des Anspruchs in Textform, so verfällt dieser, wenn er nicht innerhalb von drei Monaten nach der Ablehnung oder dem Fristablauf gerichtlich geltend gemacht wird.\n\nDiese Ausschlussfrist gilt nicht für Ansprüche, die auf einer vorsätzlichen oder grob fahrlässigen Pflichtverletzung der anderen Vertragspartei bzw. eines Erfüllungsgehilfen der anderen Vertragspartei beruhen. Diese Ausschlussfrist gilt weiterhin nicht für Ansprüche, die auf einer Verletzung des Lebens, des Körpers oder der Gesundheit aufgrund einer schuldhaften Pflichtverletzung der anderen Vertragspartei bzw. eines Erfüllungsgehilfen der anderen Vertragspartei beruhen.\n\nAnsprüche nach dem Mindestlohngesetz bleiben von der Ausschlussfristenregelung unberührt.\n\n§ 14 Übergabe von Bargeldeinnahmen\n\nDer Arbeitnehmer verpflichtet sich, alle von Kunden eingenommenen Bargelder jeweils amdarauffolgenden Montag vollständig und ordnungsgemäß an die Firma zu übergeben.\n\nKommt der Arbeitnehmer dieser Verpflichtung nicht innerhalb einer Woche nach, wird die Firmaden Arbeitnehmer schriftlich abmahnen. Erfolgt nach der Abmahnung erneut kein fristgerechter\nAusgleich der Beträge in der darauffolgenden Woche, behält sich die Firma das Recht vor, das Arbeitsverhältnis fristgerecht oder, im Falle eines vorsätzlichen und schwerwiegenden Verstoßes, fristlos zu kündigen.\nNicht übergebene Beträge werden hiermit vereinbart, dass der Arbeitnehmer diese Beträge als Vorschuss auf sein Gehalt akzeptiert.\nDer Arbeitnehmer wird über die Kündigung schriftlich informiert. Die Kündigung wird mit Zugangdes Schreibens wirksam, sofern keine andere Frist gilt.\n\n§ 15 Selbstbeteiligung bei Unfällen\n\nVerursacht der Arbeitnehmer während der Ausübung seiner Tätigkeit einen Unfall, der durchmittlere Fahrlässigkeit, grobe Fahrlässigkeit oder Vorsatz entstanden ist, verpflichtet er sich, eine\nSelbstbeteiligung in Höhe der vertraglich vereinbarten Selbstbeteiligung der Vollkaskoversicherung des Fahrzeugs zu zahlen, jedoch maximal               Euro pro Schadensfall.\n\nDie Selbstbeteiligung wird nur dann fällig, wenn die Schuld des Arbeitnehmers eindeutigfestgestellt wurde, z. B. durch ein Unfallprotokoll, ein Gutachten oder eine Entscheidung der zuständigen Behörden.\n\nDie Zahlung der Selbstbeteiligung erfolgt nach Aufforderung durch die Firma und kann nach Absprache mit dem Arbeitnehmer in Raten vom Gehalt abgezogen werden.\n\n§ 16 Verhalten nach Beendigung eines Auftrags\n\nDer Mitarbeiter, sofern er als {{taetigkeit}} tätig ist, ist gemäß § 49 Absatz 4 des Personenbeförderungsgesetzes (PBefG) verpflichtet, nach jedem abgeschlossenen Auftrag unverzüglich und ohne Aufforderung zum Betriebssitz zurückzukehren, es sei denn, es wurde vor oder während der Rückfahrt ein neuer Auftrag von der Firma vermittelt.\n\nWährend der Rückfahrt zum Betriebssitz darf der Mitarbeiter ausschließlich Aufträge ausführen,die ihm vorab oder unterwegs von der Firma oder einem autorisierten Vermittler übermittelt wurden.\n\nDas eigenständige Aufnehmen von Fahrgästen auf der Straße, ohne vorherige Vermittlung durchdie Firma oder einen autorisierten Vermittler, ist strengstens untersagt. Dies gilt insbesondere für das Anhalten aufgrund von Handzeichen, Zuruf oder anderweitigem direkten Kontakt mit potenziellen Fahrgästen.\nDer Mitarbeiter ist verpflichtet, die Regelungen des Personenbeförderungsgesetzes strikteinzuhalten, insbesondere in Bezug auf die Abgrenzung zwischen Mietwagenverkehr und\nTaxiverkehr. Verstöße gegen diese Bestimmungen können arbeitsrechtliche Konsequenzen nach sich ziehen, bis hin zur fristlosen Kündigung.\n\nHiermit wird der Arbeitsvertrag um folgende Klauseln erweitert:\n§ 17 Zusätzliche Vereinbarungen\n\nDer Mitarbeiter wird überwiegend in der Nachtschicht /Frühschicht eingesetzt\n\n§ 18 Änderungen und Ergänzungen\n\nMündliche Nebenabreden bestehen nicht. Änderungen und Ergänzungen des Vertrages, soweit sie nicht auf einer individuellen Vereinbarung der Parteien beruhen, bedürfen zu ihrer Rechtsgültigkeit der Textform. Das bedeutet, dass Ansprüche aus betrieblicher Übung nicht entstehen können. Eine etwaige Ungültigkeit einzelner Vertragsbestimmungen berührt die Wirksamkeit der übrigen Bestimmungen nicht.\n\nSollten einzelne Bestimmungen dieses Vertrags ganz oder teilweise unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.\n\nDie Vertragsparteien sind im Falle einer unwirksamen Bestimmung verpflichtet, über eine wirksame und zumutbare Ersatzregelung zu verhandeln, die dem von den Vertragsparteien mit der unwirksamen Bestimmung verfolgten wirtschaftlichen Zweck möglichst nahekommt.\n\n\n{{ort}}, den {{datum_heute}}\n\n\nUnterschrift Firma\t                                                                             Unterschrift Mitarbeiter\n\n\nAnlage 1\n\nVerpflichtung zur Einhaltung der datenschutzrechtlichen Anforderungen nach der Datenschutz-Grundverordnung (DS-GVO)\nHerr:  \nwurde darauf verpflichtet, dass es untersagt ist, personenbezogene Daten unbefugt zu verarbeiten. Personenbezogene Daten dürfen daher nur verarbeitet werden, wenn eine Einwilligung bzw. eine gesetzliche Regelung die Verarbeitung erlauben oder eine Verarbeitung dieser Daten vorgeschrieben ist. Die Grundsätze der DS-GVO für die Verarbeitung personenbezogener Daten sind in Art. 5 Abs. 1 DS-GVO festgelegt und beinhalten im Wesentlichen folgende Verpflichtungen:\nPersonenbezogene Daten müssen\nauf rechtmäßige Weise und in einer für die betroffene Person nachvollziehbaren Weise verarbeitet werden;\nfür festgelegte, eindeutige und legitime Zwecke erhoben werden und dürfen nicht in einer mit diesen Zwecken nicht zu vereinbarenden Weise weiterverarbeitet werden;\ndem Zweck angemessen und erheblich sowie auf das für die Zwecke der Verarbeitung notwendige\nMaß beschränkt sein („Datenminimierung“);\nsachlich richtig und erforderlichenfalls auf dem neuesten Stand sein; es sind alle angemessenen\nMaßnahmen zu treffen, damit personenbezogene Daten, die im Hinblick auf die Zwecke ihrer\nVerarbeitung unrichtig sind, unverzüglich gelöscht oder berichtigt werden;\nin einer Form gespeichert werden, die die Identifizierung der betroffenen Personen nur so lange ermöglicht, wie es für die Zwecke, für die sie verarbeitet werden, erforderlich ist;\nin einer Weise verarbeitet werden, die eine angemessene Sicherheit der personenbezogenen Daten gewährleistet, einschließlich Schutz vor unbefugter oder unrechtmäßiger Verarbeitung und vor unbeabsichtigtem Verlust, unbeabsichtigter Zerstörung oder unbeabsichtigter Schädigung durch geeignete technische und organisatorische Maßnahmen („Integrität und Vertraulichkeit“);\nVerstöße gegen diese Verpflichtung können mit Geldbuße und/oder Freiheitsstrafe geahndet werden. Ein Verstoß kann zugleich eine Verletzung von arbeitsvertraglichen Pflichten oder spezieller Geheimhaltungspflichten darstellen. Auch (zivilrechtliche) Schadenersatzansprüche können sich aus schuldhaften Verstößen gegen diese Verpflichtung ergeben. Ihre sich aus dem Arbeitsvertrag oder gesonderten Vereinbarungen ergebende Vertraulichkeitsverpflichtung wird durch diese Erklärung nicht berührt.\nDie Verpflichtung gilt auch nach Beendigung der Tätigkeit weiter.\nIch bestätige diese Verpflichtung. Ein Exemplar der Verpflichtung habe ich erhalten.\n\n{{ort}}, {{datum_heute}}\n\n\n________________________________                                             \t__________________________\nUnterschrift des Verpflichteten\t                                                           Unterschrift des Verantwortlichen\n\n\nAnlage 2\nBelehrung über die Mitführungs- und Vorlagepflicht von Ausweispapieren gemäß §2a SchwarzArbG\nHerr:  \n\nIhre Pflichten als Arbeitnehmer:\nSie sind als Arbeitnehmer verpflichtet, jederzeit ihre amtlichen Ausweispapiere bei der Ausübung der Tätigkeit für den Arbeitgeber mitzuführen. Bei einem Verstoß droht ein Bußgeld bis zu 5.000,00 Euro. Sie sind verpflichtet, die Ausweispapiere im Rahmen einer Prüfung durch staatliche Stellen vorzulegen. Bei einem Verstoß droht ein Bußgeld bis zu 5.000,00 Euro.\nSie haben Prüfungen durch staatliche Stellen zu dulden und die Pflicht mitzuwirken, insbesondere Auskunft zu erteilen.\nWortlaut des §2a Mitführungs- und Vorlagepflicht von Ausweispapieren (SchwarzArbG)\n(1) Bei der Erbringung von Dienst- oder Werkleistungen sind die in folgenden Wirtschaftsbereichen oder Wirtschaftszweigen tätigen Personen verpflichtet, ihren Personalausweis, Pass, Passersatz oder Ausweisersatz mitzuführen und den Behörden der Zollverwaltung auf Verlangen vorzulegen:\nim Baugewerbe,\nim Gaststätten- und Beherbergungsgewerbe,\nim Personenbeförderungsgewerbe,\nim Speditions-, Transport- und damit verbundenen Logistikgewerbe,\nim Schaustellergewerbe,\nbei Unternehmen der Forstwirtschaft,\nim Gebäudereinigungsgewerbe,\nbei Unternehmen, die sich am Auf- und Abbau von Messen und Ausstellungen beteiligen, 9. in der Fleischwirtschaft.\n(2) Der Arbeitgeber hat jeden und jede seiner Arbeitnehmer und Arbeitnehmerinnen nachweislich und schriftlich auf die Pflicht nach Absatz 1 hinzuweisen, diesen Hinweis für die Dauer der Erbringung der Dienst- oder Werkleistungen aufzubewahren und auf Verlangen bei den Prüfungen nach §2 Abs.1 vorzulegen.\nHiermit weisen wir Sie ausdrücklich auf die Mitführungs- und Vorlagepflicht hin. Gleichzeitig weisen wir Sie daraufhin, dass derjenige ordnungswidrig i.S. des §8IIS.1Nr.1 SchwarzArbG handelt, wer vorsätzlich (d.h. mit „Wissen und Wollen“) oder fahrlässig (d.h. „unter Außerachtlassung der im Verkehr erforderlichen Sorgfalt“) entgegen §2a Abs.1 SchwarzArbG ein vorgenanntes Dokument nicht mit führt oder nicht rechtzeitig vorlegt. Die Ordnungswidrigkeit kann mit einer Geldbuße bis zu 5000€ geahndet werden.\n{{ort}}, {{datum_heute}}\n\nOrt, Datum\tUnterschrift, Arbeitgeber\nMit meiner Unterschrift bestätige ich, ein Exemplar der Belehrung erhalten zu haben und über meine Pflichten aufgeklärt worden zu sein:\n\n{{ort}}, {{datum_heute}}\n\nOrt, Datum\tUnterschrift, Arbeitnehmer'}, 'kuendigung': {'titel': 'Kündigung', 'sortierung': 4, 'text': '{{ma_name}}\n{{ma_strasse}}\n{{ma_plz_ort}}\n\n\n{{firma_name}}\n{{firma_strasse}}\n{{firma_plz_ort}}\n\nDatum: {{datum_heute}}\xa0\xa0\xa0\xa0\xa0\xa0\xa0\xa0\xa0\xa0\xa0\xa0\nOrdentliche Kündigung                                                                      \t\t\t\n\nSehr geehrte/r {{ma_anrede}} {{ma_name}},\n\nhiermit kündigen wir das mit Ihnen bestehende Arbeitsverhältnis unter Einhaltung der ordentlichen Kündigungsfrist fristgemäß zum {{beendigung_zum}} hilfsweise zum nächstmöglichen Zeitpunkt.\n\nWir weisen Sie darauf hin, dass Sie nach § 38 Abs. 1 SGB III verpflichtet sind, sich innerhalb von drei Tagen nach Erhalt dieser Kündigung bei der Agentur für Arbeit persönlich arbeitsuchend zu melden. Sofern dieses Arbeitsverhältnis noch länger als drei Monate besteht, ist eine Meldung drei Monate vor Beendigung ausreichend. Kommen Sie Ihrer Verpflichtung nicht fristgerecht nach, kann die Agentur für Arbeit eine Sperrzeit anordnen, in der Sie kein Arbeitslosengeld erhalten (§ 159 Abs. 1 S. 2 Nr. 7, Abs. 6 SGB III). Außerdem sind Sie verpflichtet, aktiv nach einer Beschäftigung zu suchen.\nWir danken Ihnen für Ihre bisherige Mitarbeit und wünschen Ihnen für Ihre berufliche und private Zukunft alles Gute.\n\n\nMit freundlichen Grüßen.'}, 'aufhebung': {'titel': 'Aufhebungsvertrag', 'sortierung': 5, 'text': 'Aufhebungsvertrag\n\n Zwischen \n{{firma_name}} \n{{firma_strasse}} \n{{firma_plz_ort}} \nnachfolgend Firma genannt \nund \n{{ma_name}} \n{{ma_strasse}} \n{{ma_plz_ort}} \nnachfolgend Mitarbeiter genannt\n\n\n besteht zwischen den Parteien ein Arbeitsvertrag vom {{vertrag_vom}}, nach welchem der Mitarbeiter ab dem {{eintritt}} als {{taetigkeit}} in der Personenbeförderung mit einer regelmäβigen Wöchentliche Arbeitszeit von {{wochenstunden}} Stunden beschäftigt werden soll. \nDie Parteien vereinbaren, dass ihr Arbeitsvertrag mit Wirkung zum {{beendigung_zum}}, aufgehoben wird. \nDie Parteien sind sich darüber einig, dass kein zu vergütender oder abzugeltender Urlaubsanspruch des Mitarbeiters besteht. \nDie Firma hat den Mitarbeiter darüber belehrt, dass er gem. § 38 SGB III verpflichtet ist, sich innerhalb von drei Tagen nach Abschluss dieses Aufhebungsvertrages bei der zuständigen Agentur für Arbeit arbeitssuchend zu melden und eigenverantwortlich nach einer neuen Beschäftigung zu suchen, um mögliche Ansprüche auf Arbeitslosenunterstützung nicht zu gefährden.\n Neuss, den\n\n\nUnterschrift Firma                                             \t\t\tUnterschrift Mitarbeiter'}}


# ==============================================================================
# START (nur beim direkten Aufruf: python server.py)
# ==============================================================================
# Auf Railway startet stattdessen der Befehl aus dem Procfile:
#   uvicorn server:app --host 0.0.0.0 --port $PORT

if __name__ == "__main__":
    import uvicorn
    print(f"Server laeuft auf http://127.0.0.1:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
