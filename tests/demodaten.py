"""Demodaten: ein Einzelbetrieb und ein Gruppenkonto mit zwei Betrieben."""
import sys, os, json
from pathlib import Path
WURZEL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WURZEL)); os.chdir(WURZEL)
os.environ["DATABASE_URL"] = "postgresql+psycopg://postgres@/ui3?host=/tmp&port=5433"
from fastapi.testclient import TestClient
import server
from sqlmodel import Session, select

with TestClient(server.app) as c:
    c.post("/register", json={"firma_name":"Fahrbetrieb Neuss GmbH","email":"chef@neuss.de",
                              "password":"geheim12345","plan":"business"})
    c.post("/register", json={"firma_name":"Gruppe Majed","email":"majed@gruppe.de",
                              "password":"geheim12345","plan":"business"})

with Session(server.engine) as s:
    for f in s.exec(select(server.Firma)).all():
        f.modules_json = json.dumps(server.ALL_MODULES)
        if f.name == "Gruppe Majed":
            f.lizenzart = "gruppe"; f.max_firmen = 5
        s.add(f)
    s.commit()
    g = s.exec(select(server.Firma).where(server.Firma.name == "Gruppe Majed")).first()
    for name, mail in [("Betrieb Nord","nord@x.de"), ("Betrieb Süd","sued@x.de")]:
        f = s.exec(select(server.Firma).where(server.Firma.name == name)).first()
        if not f:
            f = server.Firma(name=name, rolle="benutzer", plan="business",
                             modules_json=json.dumps(server.ALL_MODULES))
            s.add(f); s.commit(); s.refresh(f)
            s.add(server.User(email=mail, password_hash=server.hash_password("geheim12345"),
                              firma_id=f.id, rolle=server.ROLLE_INHABER))
            s.add(server.Mandant(inhaber_firma_id=g.id, mandant_firma_id=f.id))
        s.commit()
    for firma_name, leute in [("Fahrbetrieb Neuss GmbH", ["Yilmaz A.","Kerem T.","Sofia M."]),
                              ("Betrieb Nord", ["Hashem A.","Eman M."])]:
        f = s.exec(select(server.Firma).where(server.Firma.name == firma_name)).first()
        for n in leute:
            if not s.exec(select(server.Mitarbeiter).where(
                    server.Mitarbeiter.firma_id == f.id,
                    server.Mitarbeiter.name == n)).first():
                s.add(server.Mitarbeiter(firma_id=f.id, name=n, aktiv=True))
        s.commit()
    for f in s.exec(select(server.Firma)).all():
        print(" ", f.id, f.name, "|", f.lizenzart or "single")
