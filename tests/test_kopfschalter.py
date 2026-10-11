"""Tests fuer den Schalter "Firmenkopf im Ausdruck" in Zeitnachweis und Fahrtenbuch.

Hintergrund: Oben auf den Ausdrucken stand immer der Firmenname. Das ist nicht
immer gewollt - deshalb je Modul ein Schalter, standardmaessig AUS.

Zwei Fallen, die hier festgehalten werden:
  1. Eine nackte Ankreuzbox in einem .field wird von `.field input{width:100%}`
     zu einem leeren Kasten aufgeblasen - sie sieht dann aus wie ein
     Eingabefeld und nicht wie ein Schalter. Deshalb der Schiebeschalter des
     Dashboards (.zn-toggle) und KEINE Klasse "field" am eigenen Kasten.
  2. dashboard.html darf dafuer nicht angefasst werden - die Export-Funktionen
     lassen den Kopf von sich aus weg, wenn der Firmenname leer ist.

Das tatsaechliche Verhalten im Browser prueft tests/ui_kopfschalter.py.
"""
import sys, os
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WURZEL))
os.chdir(WURZEL)

fehler = []
def pruef(name, bed, info=""):
    print(("  OK   " if bed else "  FEHL ") + name + ("  → " + str(info) if info and not bed else ""))
    if not bed: fehler.append(name)

ks = Path("static/js/kopf-schalter.js").read_text(encoding="utf-8")
css = Path("static/css/zn-redesign.css").read_text(encoding="utf-8")
dash = Path("static/pages/dashboard.html").read_text(encoding="utf-8")
srv = Path("server.py").read_text(encoding="utf-8")

print("\n=== 1. Beide Module sind erfasst ===")
pruef("Zeitnachweis ist dabei", '"fc_zn_firmenkopf"' in ks)
pruef("Fahrtenbuch ist dabei", '"fc_fb_firmenkopf"' in ks)
pruef("Getrennte Speicher - die Schalter sind unabhaengig",
      ks.count("fc_zn_firmenkopf") >= 1 and ks.count("fc_fb_firmenkopf") >= 1
      and "fc_zn_firmenkopf" != "fc_fb_firmenkopf")

print("\n=== 2. Das Fahrtenbuch deckt alle drei Ausdrucke ab ===")
for fn in ["exportOriginalPDF", "exportPDF", "exportMonthly"]:
    pruef("%s wird umschlossen" % fn, '"%s"' % fn in ks)
pruef("Der Zeitnachweis-Export ebenfalls", '"znExportPDF"' in ks)
# Im Fahrtenbuch wird nur der Name gedruckt, keine Anschrift
i = ks.find('kennung: "fb"')
if i > 0:
    block = ks[i:i + 700]
    ohne = "".join(block.split())      # alle Leerzeichen raus, beidseitig
    pruef("Fahrtenbuch leert nur das Firmenfeld",
          'felder:["firmaInput"]' in ohne, block[:220])

print("\n=== 3. Standard ist AUS ===")
i = ks.find("function an(m)")
pruef("Nur '1' gilt als eingeschaltet",
      i > 0 and '=== "1"' in ks[i:i + 200], ks[i:i + 160] if i > 0 else "(fehlt)")
pruef("Und bei Fehlern ebenfalls AUS",
      i > 0 and "return false" in ks[i:i + 200])

print("\n=== 4. Es ist ein Schiebeschalter, keine Ankreuzbox ===")
pruef("Benutzt den Schiebeschalter des Dashboards",
      'class="zn-toggle"' in ks and 'class="slider"' in ks)
pruef("Der eigene Kasten traegt NICHT die Klasse 'field'",
      'className = "zn-kopf-feld"' in ks and "field zn-kopf-feld" not in ks)
pruef("Die Breite der Ankreuzbox ist ausdruecklich zurueckgesetzt",
      ".zn-kopf-feld .zn-toggle input" in css and "width: 0" in css)
pruef("Der Schieber hat das Mass der uebrigen Schalter",
      "width: 26px; height: 14px" in css)

print("\n=== 5. Der Export wird umschlossen, nicht ersetzt ===")
i = ks.find("function exporteUmschliessen")
if i > 0:
    block = ks[i:i + 1400]
    pruef("Bei eingeschaltetem Kopf bleibt alles wie gehabt",
          "if (an(m)) return vorhanden.apply" in block)
    pruef("Die Felder werden nur fuer den Export geleert", 'g.el.value = ""' in block)
    pruef("Und in JEDEM Fall wiederhergestellt",
          "finally" in block and "g.el.value = g.wert" in block)
    pruef("Ein doppeltes Umschliessen wird verhindert", "fcKopf" in block)
else:
    pruef("exporteUmschliessen gibt es", False)

print("\n=== 6. Der Hinweis passt sich dem Zustand an ===")
pruef("Es gibt zwei Texte", "function hinweisSetzen" in ks and '"An:' in ks)
pruef("Jedes Modul hat einen eigenen Aus-Text",
      ks.count("aus:") >= 2 or ks.count('aus: "') >= 2)
pruef("Der Name des Betriebs wird genannt", "m.felder[0]" in ks)

print("\n=== 7. dashboard.html blieb unangetastet ===")
for spur in ["KopfSchalter", "fc_zn_firmenkopf", "fc_fb_firmenkopf", "kopf-schalter"]:
    pruef("Keine Spur von %r in dashboard.html" % spur, spur not in dash)
pruef("Die Datei hat weiterhin ihre volle Groesse",
      Path("static/pages/dashboard.html").stat().st_size > 680000)

print("\n=== 8. Die Datei wird ausgeliefert ===")
pruef("server.py bindet kopf-schalter.js ein", "/app/kopf-schalter.js" in srv)
pruef("Und zwar nach zn-redesign.js",
      srv.index("zn-redesign.js") < srv.index("kopf-schalter.js"))
pruef("Die Datei liegt im Paket", Path("static/js/kopf-schalter.js").exists())
pruef("zn-redesign.js hat keine eigene Kopie mehr",
      "znKopfSchalter" not in Path("static/js/zn-redesign.js").read_text(encoding="utf-8"))

print()
if fehler:
    print("FEHLGESCHLAGEN (%d): %s" % (len(fehler), ", ".join(fehler[:6])))
    sys.exit(1)
print("Alle Kopfschalter-Tests bestanden.")
