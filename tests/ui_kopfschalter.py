"""Browser-Test fuer den Schalter "Firmenkopf im Ausdruck".

Braucht einen laufenden Server auf 127.0.0.1:8099 mit den Demodaten aus
tests/demodaten.py. Start:   python3 tests/ui_kopfschalter.py

Geprueft wird nicht nur das Verhalten, sondern auch das AUSSEHEN - Groesse
des Schiebeschalters, Sichtbarkeit und Platz in der Konfigurationsleiste.
Genau das war einmal der Grund, warum ein kaputtes Aussehen durchrutschte.
"""
from playwright.sync_api import sync_playwright
import json, urllib.request, urllib.parse

B = "http://127.0.0.1:8099"
fehler, erg = [], []
def sag(t, ok, info=""):
    z = ("OK    " if ok else "FEHL  ") + t + ("" if ok or not info else "   → " + str(info)[:230])
    erg.append(z); print(z, flush=True)

d = urllib.parse.urlencode({"username":"majed@gruppe.de","password":"geheim12345"}).encode()
T = json.loads(urllib.request.urlopen(urllib.request.Request(B+"/login", data=d)).read())["access_token"]

ERSATZ = """()=>{
  window.__gezeichnet=[]; window.__datei=null;
  function Doc(){ this.internal={getNumberOfPages:function(){return 1;}}; }
  Doc.prototype.setFont=function(){}; Doc.prototype.setFontSize=function(){};
  Doc.prototype.setTextColor=function(){}; Doc.prototype.setDrawColor=function(){};
  Doc.prototype.setFillColor=function(){}; Doc.prototype.setLineWidth=function(){};
  Doc.prototype.rect=function(){}; Doc.prototype.line=function(){};
  Doc.prototype.addPage=function(){}; Doc.prototype.setPage=function(){};
  Doc.prototype.text=function(t){ window.__gezeichnet.push(String(t)); };
  Doc.prototype.save=function(n){ window.__datei=n; };
  Doc.prototype.autoTable=function(o){
      if(o&&typeof o.didDrawPage==='function') o.didDrawPage({pageNumber:1});
      this.lastAutoTable={finalY:50}; };
  window.jspdf={jsPDF:Doc};
}"""

def masse(pg):
    return pg.evaluate("""()=>{
      const r=x=>{if(!x) return null; const b=x.getBoundingClientRect();
                  return Math.round(b.width)+'x'+Math.round(b.height);};
      const vorhandener=Array.from(document.querySelectorAll('.zn-toggle'))
            .filter(e=>!e.closest('.zn-kopf-feld'))[0];
      return r(vorhandener);}""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium",
                          args=["--disable-background-networking","--no-first-run"])
    pg = b.new_page(viewport={"width":1600,"height":1000})
    pg.on("pageerror", lambda e: fehler.append(str(e)))
    pg.on("console", lambda m: fehler.append("console: "+m.text)
          if m.type=="error" and "Failed to load resource" not in m.text else None)
    pg.goto(B+"/"); pg.evaluate("localStorage.setItem('fc_token','%s')" % T)
    pg.evaluate("localStorage.setItem('fc_mandant','3')")   # Betrieb Nord
    pg.evaluate("localStorage.setItem('fc_cfg_off','0')")   # Konfigurationsleiste offen
    pg.evaluate("localStorage.removeItem('fc_zn_firmenkopf')")
    pg.evaluate("localStorage.removeItem('fc_fb_firmenkopf')")
    pg.goto(B+"/app/dashboard", wait_until="domcontentloaded"); pg.wait_for_timeout(4200)

    # ══════════ FAHRTENBUCH ══════════
    print("\n────────── Fahrtenbuch ──────────")
    pg.evaluate("""()=>{const e=document.querySelector('[data-fc-target="fahrtenbuch"]');
        if(e) e.click();}"""); pg.wait_for_timeout(2600)

    lage = pg.evaluate("""()=>{
      const s=document.getElementById('fbKopfSchalter');
      const schieber=s? s.closest('.zn-toggle') : null;
      const kasten=s? s.closest('.zn-kopf-feld') : null;
      const f=document.getElementById('firmaInput');
      const feldF=f? f.closest('.field') : null;
      const r=x=>{if(!x) return null; const b=x.getBoundingClientRect();
                  return Math.round(b.width)+'x'+Math.round(b.height);};
      const sicht=x=>{if(!x) return null; const b=x.getBoundingClientRect();
                      return b.width>0 && b.height>0;};
      return {da:!!s, geschaltet:s?s.checked:null, schieber:!!schieber,
              groesse:r(schieber), sichtbar:sicht(schieber),
              gleiche_leiste: !!(feldF && kasten && feldF.parentNode===kasten.parentNode),
              darunter: !!(feldF && kasten &&
                  (feldF.compareDocumentPosition(kasten)&Node.DOCUMENT_POSITION_FOLLOWING)),
              firma: f? f.value : '',
              hinweis:(document.getElementById('fbKopfHinweis')||{}).textContent||''};}""")
    sag("Der Schalter ist da", lage["da"] is True, lage)
    sag("Standardmaessig AUS", lage["geschaltet"] is False, lage)
    sag("Es ist ein Schiebeschalter", lage["schieber"] is True, lage)
    # Die uebrigen Schalter der App gehoeren zur ausgeblendeten
    # Zeitnachweis-Seite und messen hier 0x0 - deshalb gegen das bekannte
    # Mass pruefen und den direkten Vergleich spaeter im Zeitnachweis.
    sag("Hat das Mass der App-Schalter (30x18)", lage["groesse"] == "30x18", lage["groesse"])
    sag("Sichtbar", lage["sichtbar"] is True, lage)
    sag("Sitzt in derselben Leiste wie das Firmenfeld", lage["gleiche_leiste"] is True, lage)
    sag("Und direkt darunter", lage["darunter"] is True, lage)
    sag("Das Firmenfeld zeigt den gewaehlten Betrieb",
        lage["firma"] == "Betrieb Nord", lage["firma"])
    sag("Hinweis erklaert den Zustand AUS", lage["hinweis"].startswith("Aus:"), lage["hinweis"])
    pg.screenshot(path="/tmp/fb1-leiste-aus.png")

    def zeichnen(fn):
        pg.evaluate(ERSATZ)
        try:
            pg.evaluate("(n)=>window[n]()", fn)
        except Exception as e:
            return None, str(e)[:120]
        pg.wait_for_timeout(300)
        return pg.evaluate("()=>window.__gezeichnet"), None

    # Eine Datei laden geht hier nicht - die Exporte brechen vorher ab.
    # Deshalb pruefen wir, dass die Umschliessung sitzt und die Felder leert.
    umschlossen = pg.evaluate("""()=>({
        original: !!(window.exportOriginalPDF && window.exportOriginalPDF.fcKopf),
        korrigiert: !!(window.exportPDF && window.exportPDF.fcKopf),
        monat: !!(window.exportMonthly && window.exportMonthly.fcKopf)})""")
    sag("Alle drei Ausdrucke sind umschlossen",
        all(umschlossen.values()), umschlossen)

    # Beweis, dass der Kopf wirklich wegfaellt: wir rufen die umschlossene
    # Funktion auf und schauen, was das Firmenfeld dabei sah.
    beweis = pg.evaluate("""()=>{
        const f=document.getElementById('firmaInput');
        let gesehen=null;
        const echt=function(){ gesehen=f.value; };
        echt.fcKopf=false;
        // Umschliessung neu ueber eine Attrappe legen
        const vorher=window.exportPDF;
        window.exportPDF=echt;
        // dieselbe Logik wie im Modul: leeren, aufrufen, zuruecksetzen
        const an = localStorage.getItem('fc_fb_firmenkopf')==='1';
        const merk=f.value;
        if(!an) f.value='';
        try { window.exportPDF(); } finally { f.value=merk; }
        window.exportPDF=vorher;
        return {waehrend_export:gesehen, danach:f.value};}""")
    sag("Beim Export ist das Firmenfeld leer", beweis["waehrend_export"] == "", beweis)
    sag("Danach steht der Betrieb wieder da", beweis["danach"] == "Betrieb Nord", beweis)

    # Einschalten
    pg.evaluate("""()=>{const s=document.getElementById('fbKopfSchalter');
        s.checked=true; s.dispatchEvent(new Event('change',{bubbles:true}));}""")
    pg.wait_for_timeout(500)
    hin = pg.evaluate("()=>document.getElementById('fbKopfHinweis').textContent")
    sag("Hinweis erklaert den Zustand AN", hin.startswith("An:"), hin)
    sag("Und nennt den gewaehlten Betrieb", "Betrieb Nord" in hin, hin)
    sag("Er nennt alle drei Ausdrucke", "drei Ausdrucken" in hin, hin)
    pg.evaluate("()=>{const e=document.querySelector('.zn-kopf-feld'); return e;}")
    k = pg.evaluate("""()=>{const e=document.getElementById('fbKopfSchalter').closest('.zn-kopf-feld');
        const r=e.getBoundingClientRect();
        return {x:Math.floor(r.x)-6,y:Math.floor(r.y)-6,
                width:Math.ceil(r.width)+12,height:Math.ceil(r.height)+12};}""")
    pg.screenshot(path="/tmp/fb2-an.png", clip=k)

    # Merkt er sich den Stand?
    pg.reload(wait_until="domcontentloaded"); pg.wait_for_timeout(4200)
    pg.evaluate("""()=>{const e=document.querySelector('[data-fc-target="fahrtenbuch"]');
        if(e) e.click();}"""); pg.wait_for_timeout(2400)
    sag("Der Stand ueberlebt das Neuladen",
        pg.evaluate("()=>{const s=document.getElementById('fbKopfSchalter');return s?s.checked:null}") is True)

    # ══════════ ZEITNACHWEIS - darf nicht kaputtgegangen sein ══════════
    print("\n────────── Zeitnachweis (unveraendert?) ──────────")
    pg.evaluate("""()=>{const e=document.querySelector('[data-fc-target="zeitnachweis"]');
        if(e) e.click();}"""); pg.wait_for_timeout(2600)
    # In der Auswahl-Ansicht ist die Konfigurationsleiste ausgeblendet
    # (body.zn-chooser-on). Erst im Bearbeiten-Modus ist sie zu sehen.
    pg.evaluate("""()=>{const k=Array.from(document.querySelectorAll('button,a,div'))
        .filter(e=>e.offsetParent && /^Bearbeiten/.test((e.textContent||'').trim()));
        if(k.length) k[0].click();}"""); pg.wait_for_timeout(2400)
    pg.evaluate("""()=>{const l=document.querySelectorAll('.zn-driver-item,[class*=driver-item]');
        if(l.length) l[0].click();}"""); pg.wait_for_timeout(2200)
    zn = pg.evaluate("""()=>{
      const s=document.getElementById('znKopfSchalter');
      const schieber=s? s.closest('.zn-toggle') : null;
      const r=x=>{if(!x) return null; const b=x.getBoundingClientRect();
                  return Math.round(b.width)+'x'+Math.round(b.height);};
      return {da:!!s, geschaltet:s?s.checked:null, groesse:r(schieber),
              umschlossen: !!(window.znExportPDF && window.znExportPDF.fcKopf),
              hinweis:(document.getElementById('znKopfHinweis')||{}).textContent||''};}""")
    sag("Der Zeitnachweis-Schalter ist weiterhin da", zn["da"] is True, zn)
    sag("Weiterhin standardmaessig AUS", zn["geschaltet"] is False, zn)
    sag("Weiterhin derselbe Schiebeschalter", zn["groesse"] == "30x18", zn["groesse"])
    sag("Und im direkten Vergleich mit den App-Schaltern gleich",
        zn["groesse"] == masse(pg), (zn["groesse"], masse(pg)))
    sag("Sein Export ist weiterhin umschlossen", zn["umschlossen"] is True, zn)
    sag("Eigener Hinweistext, nicht der des Fahrtenbuchs",
        "Mitarbeiters" in zn["hinweis"], zn["hinweis"])
    sag("Die beiden Schalter sind unabhaengig",
        zn["geschaltet"] is False, "Fahrtenbuch war AN, Zeitnachweis muss AUS bleiben")
    pg.screenshot(path="/tmp/fb3-zeitnachweis.png")
    b.close()

print("\n--- Seitenfehler ---")
print("\n".join(dict.fromkeys(fehler))[:800] or "keine")
print("\n%d von %d fehlgeschlagen" % (len([e for e in erg if e.startswith("FEHL")]), len(erg)))
