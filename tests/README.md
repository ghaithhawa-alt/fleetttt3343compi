# Tests

Diese Tests gehören ab jetzt ins Paket — damit sie bei dir auf GitHub liegen
und nicht mehr verloren gehen können.

## Was hier liegt

| Datei | Was sie prüft | Braucht |
|---|---|---|
| `test_kopfschalter.py` | Den Schalter „Firmenkopf im Ausdruck" am Quelltext: beide Module, alle drei Fahrtenbuch-Ausdrucke, Standard AUS, dass es ein Schiebeschalter ist und `dashboard.html` unangetastet blieb. | nichts |
| `ui_kopfschalter.py` | Dasselbe im echten Browser — **inklusive Aussehen**: Größe des Schalters, Sichtbarkeit, Platz in der Konfigurationsleiste. | laufenden Server + Playwright |
| `demodaten.py` | Legt Demodaten an: einen Einzelbetrieb und ein Gruppenkonto mit zwei Betrieben. | Datenbank |

## Ausführen

Die Quelltext-Prüfungen brauchen nichts weiter:

```bash
.venv/bin/python tests/test_kopfschalter.py
```

Für den Browser-Test zuerst Demodaten anlegen und den Server starten:

```bash
.venv/bin/python tests/demodaten.py
.venv/bin/python -m uvicorn server:app --port 8099 &
python3 tests/ui_kopfschalter.py
```

## Warum auch das Aussehen geprüft wird

Der Schalter war einmal fertig, getestet und funktionierte — sah aber aus wie
ein leeres Eingabefeld, weil `.field input { width: 100% }` aus der
Konfigurationsleiste eine Ankreuzbox auf volle Breite zieht. Alle
Verhaltenstests waren grün.

Seitdem misst `ui_kopfschalter.py` die Größe des Schiebeschalters und
vergleicht sie mit den übrigen Schaltern der App. Ein zweiter Stolperstein,
der dort festgehalten ist: die Konfigurationsleiste startet eingeklappt
(`fc_cfg_off` im Browser-Speicher), und im Zeitnachweis ist sie in der
Auswahl-Ansicht ganz ausgeblendet. Wer dort misst, misst Null — und hält ein
kaputtes Aussehen für in Ordnung.

## Was noch fehlt

Die übrigen Testdateien des Projekts (Vorgänge, Lohn, Team, Anmeldung,
Sprache, Gruppenkonten …) lagen außerhalb des Projektordners und sind bei
einem Reset der Arbeitsumgebung verloren gegangen. Sie sind hier noch nicht
wiederhergestellt.
