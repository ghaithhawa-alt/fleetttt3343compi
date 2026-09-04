/* Einstellungen-Seite: Konto (Name/E-Mail/Passwort), Abo, Hilfe.
   Injiziert - dashboard.html bleibt unangetastet. */
(function () {
  if (new URLSearchParams(location.search).get("classic") === "1") return;

  var token = null;
  try { token = localStorage.getItem("fc_token") || localStorage.getItem("token"); } catch (e) {}
  function authHeaders(extra) { var h = extra || {}; if (token) h["Authorization"] = "Bearer " + token; return h; }
  function esc(s){var d=document.createElement("div");d.textContent=s==null?"":String(s);return d.innerHTML;}

  // Dialoge im Website-Design (nutzt das Dashboard-System fcAlert/fcConfirm, mit Fallback).
  function fcInfo(titel, text, art, danach) {
    if (typeof window.fcAlert === "function") {
      window.fcAlert({ title: titel, sub: text, kind: art || "info", okText: "OK", onOk: danach || function () {} });
    } else { alert((titel ? titel + "\n\n" : "") + text); if (danach) danach(); }
  }
  function fcFrage(titel, text, art, okText, onOk) {
    if (typeof window.fcConfirm === "function") {
      window.fcConfirm({ title: titel, sub: text, kind: art || "warn", okText: okText || "Bestätigen", onOk: onOk });
    } else if (confirm((titel ? titel + "\n\n" : "") + text)) { onOk(); }
  }

  var DATA = { email: "", firma: "", plan: "" };

  function buildPage() {
    if (document.getElementById("settingsPage")) return;
    var page = document.createElement("div");
    page.id = "settingsPage";
    page.className = "container set-page";
    page.style.display = "none";
    page.innerHTML =
      '<div class="set-head"><h2>Einstellungen</h2></div>'
      // Konto
      + '<div class="set-card">'
      +   '<div class="set-card-title">Konto-Einstellungen</div>'
      +   '<div class="set-row"><div><div class="set-label">E-Mail</div><div class="set-value" id="setEmail">–</div></div></div>'
      +   '<div class="set-row"><div><div class="set-label">Passwort</div><div class="set-value">••••••••</div></div>'
      +     '<button class="set-btn" id="setPwBtn">Ändern</button></div>'
      + '</div>'
      // Firmenprofil - gilt für alle Module und steht auf allen Dokumenten
      + '<div class="set-card">'
      +   '<div class="set-card-title">Firmenprofil</div>'
      +   '<p class="set-hinweis">Diese Angaben erscheinen auf allen Auswertungen und PDFs.</p>'
      +   '<div id="setProfilSperre"></div>'
      +   '<div class="set-felder">'
      +     '<div class="set-feld"><label for="setPName">Firmenname</label>'
      +       '<input type="text" id="setPName" placeholder="z.B. Taxi Muster GmbH"></div>'
      +     '<div class="set-feld"><label for="setPAdresse">Anschrift</label>'
      +       '<input type="text" id="setPAdresse" placeholder="Straße, PLZ Ort"></div>'
      +     '<div class="set-feld"><label for="setPSitz">Betriebssitz</label>'
      +       '<input type="text" id="setPSitz" placeholder="Straße, PLZ Ort">'
      +       '<div class="set-koord" id="setPKoord"></div></div>'
      +     '<div class="set-feld"><label>Koordinaten</label>'
      +       '<div class="set-koord-paar">'
      +         '<input type="text" inputmode="decimal" id="setPLat" placeholder="Breitengrad, z.B. 51.16557">'
      +         '<input type="text" inputmode="decimal" id="setPLon" placeholder="Längengrad, z.B. 6.66484">'
      +       '</div>'
      +       '<div class="set-koord">Leer lassen: Koordinaten werden aus dem Betriebssitz ermittelt. '
      +         'Eigene Werte haben Vorrang.</div></div>'
      +   '</div>'
      +   '<div class="set-msg" id="setPMsg"></div>'
      +   '<div class="set-aktionen">'
      +     '<button class="set-btn set-btn-green" id="setPSaveBtn">Speichern</button>'
      +     '<button class="set-btn" id="setPFreiBtn" style="display:none">Freischaltung beantragen</button>'
      +   '</div>'
      + '</div>'
      // Firmenlogo - erscheint auf Verträgen, Lohnabrechnung, Trinkgeld, Quittung
      + '<div class="set-card">'
      +   '<div class="set-card-title">Firmenlogo</div>'
      +   '<p class="set-hinweis">Erscheint auf Verträgen, Lohnabrechnung, Trinkgeld und Quittungen. PNG oder JPEG, max. ca. 1,5 MB.</p>'
      +   '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">'
      +     '<div id="setLogoVorschau" style="min-width:120px;min-height:60px;max-width:220px;display:flex;'
      +       'align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.12);border-radius:10px;'
      +       'padding:8px;background:rgba(255,255,255,.03);color:#888;font-size:12px">Kein Logo</div>'
      +     '<div style="display:flex;flex-direction:column;gap:8px">'
      +       '<input type="file" id="setLogoFile" accept="image/png,image/jpeg" style="display:none">'
      +       '<button class="set-btn set-btn-green" id="setLogoBtn">Logo hochladen</button>'
      +       '<button class="set-btn set-btn-red" id="setLogoDelBtn" style="display:none">Entfernen</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="set-msg" id="setLogoMsg"></div>'
      + '</div>'
      // Abo
      + '<div class="set-card">'
      +   '<div class="set-card-title">Abo-Verwaltung</div>'
      +   '<div class="set-row"><div><div class="set-label">Aktueller Plan</div><div class="set-value" id="setPlan">–</div></div>'
      +     '<button class="set-btn set-btn-green" id="setUpgradeBtn">Upgrade</button></div>'
      +   '<div class="set-row"><div><div class="set-label">Abo kündigen</div><div class="set-value">Vertrag beenden</div></div>'
      +     '<button class="set-btn set-btn-red" id="setCancelBtn">Kündigen</button></div>'
      + '</div>'
      // Hilfe
      + '<div class="set-card">'
      +   '<div class="set-card-title">Hilfe & Support</div>'
      +   '<div class="set-row"><div><div class="set-label">E-Mail</div><div class="set-value">support@fleetcompliance.de</div></div>'
      +     '<a class="set-btn" href="mailto:support@fleetcompliance.de">Schreiben</a></div>'
      + '</div>';
    var host = document.querySelector(".container") ? document.querySelector(".container").parentNode : document.body;
    host.appendChild(page);

    // Passwort-Dialog
    var modal = document.createElement("div");
    modal.id = "setPwModal";
    modal.className = "set-modal";
    modal.style.display = "none";
    modal.innerHTML =
      '<div class="set-modal-backdrop" id="setPwBackdrop"></div>'
      + '<div class="set-modal-card">'
      +   '<div class="set-modal-title">Passwort ändern</div>'
      +   '<label>Aktuelles Passwort</label><input type="password" id="setPwAlt" autocomplete="current-password">'
      +   '<label>Neues Passwort (min. 8 Zeichen)</label><input type="password" id="setPwNeu" autocomplete="new-password">'
      +   '<label>Neues Passwort wiederholen</label><input type="password" id="setPwNeu2" autocomplete="new-password">'
      +   '<div class="set-modal-actions">'
      +     '<button class="set-btn" id="setPwCancel">Abbrechen</button>'
      +     '<button class="set-btn set-btn-green" id="setPwSave">Speichern</button>'
      +   '</div>'
      +   '<div class="set-modal-msg" id="setPwMsg"></div>'
      + '</div>';
    document.body.appendChild(modal);
  }

  function load() {
    fetch("/me", { headers: authHeaders() }).then(function(r){return r.json();}).then(function(d){
      DATA.email = d.email || ""; DATA.firma = d.firma || "";
      // Hinweis, wenn noch ein Einmal-Passwort aktiv ist
      var karte = document.querySelector("#settingsPage .set-card");
      var alt = document.getElementById("setPwHinweis");
      if (d.passwort_temporaer && karte && !alt) {
        var hin = document.createElement("div");
        hin.id = "setPwHinweis";
        hin.style.cssText = "background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.3);"
          + "border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12.5px;color:#fbbf24";
        hin.textContent = "Du nutzt ein Einmal-Passwort. Bitte lege jetzt ein eigenes Passwort fest.";
        karte.parentNode.insertBefore(hin, karte);
      } else if (!d.passwort_temporaer && alt) { alt.remove(); }
      var e=document.getElementById("setEmail"); if(e)e.textContent=DATA.email||"–";
      var f=document.getElementById("setFirma"); if(f)f.textContent=DATA.firma||"–";
    }).catch(function(){});
    fetch("/license-status", { headers: authHeaders() }).then(function(r){return r.json();}).then(function(d){
      var plan = d.version==="admin" ? "Superadmin" : (d.version||"Aktiv");
      var p=document.getElementById("setPlan"); if(p)p.textContent=plan;
    }).catch(function(){});
  }

  var PFLICHT = false;   // true = Einmal-Passwort, Dialog darf nicht weggeklickt werden

  function openPw(pflicht){
    PFLICHT = !!pflicht;
    document.getElementById("setPwModal").style.display="flex";
    document.getElementById("setPwAlt").value=""; document.getElementById("setPwNeu").value="";
    document.getElementById("setPwNeu2").value=""; document.getElementById("setPwMsg").textContent="";
    var titel = document.querySelector("#setPwModal .set-modal-title");
    var hinweis = document.getElementById("setPwPflicht");
    var abbrechen = document.getElementById("setPwCancel");
    if (PFLICHT) {
      if (titel) titel.textContent = "Neues Passwort festlegen";
      if (!hinweis) {
        hinweis = document.createElement("div");
        hinweis.id = "setPwPflicht";
        hinweis.style.cssText = "background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.3);"
          + "border-radius:9px;padding:11px 13px;margin-bottom:4px;font-size:12.5px;color:#fbbf24;line-height:1.5";
        hinweis.textContent = "Du hast ein Einmal-Passwort erhalten. Bitte lege jetzt dein eigenes Passwort fest, "
          + "um fortzufahren. Trage oben das Einmal-Passwort ein.";
        titel.parentNode.insertBefore(hinweis, titel.nextSibling);
      }
      hinweis.style.display = "";
      if (abbrechen) abbrechen.style.display = "none";
      document.getElementById("setPwAlt").placeholder = "Das Einmal-Passwort";
    } else {
      if (titel) titel.textContent = "Passwort ändern";
      if (hinweis) hinweis.style.display = "none";
      if (abbrechen) abbrechen.style.display = "";
      document.getElementById("setPwAlt").placeholder = "";
    }
    document.getElementById("setPwAlt").focus();
  }
  function closePw(){
    if (PFLICHT) return;    // im Pflicht-Modus nicht schliessbar
    document.getElementById("setPwModal").style.display="none";
  }

  function savePw(){
    var alt=document.getElementById("setPwAlt").value;
    var neu=document.getElementById("setPwNeu").value;
    var neu2=document.getElementById("setPwNeu2").value;
    var msg=document.getElementById("setPwMsg");
    msg.className="set-modal-msg";
    if(!alt||!neu){msg.textContent="Bitte alle Felder ausfüllen.";return;}
    if(neu.length<8){msg.textContent="Neues Passwort muss mindestens 8 Zeichen haben.";return;}
    if(neu!==neu2){msg.textContent="Die neuen Passwörter stimmen nicht überein.";return;}
    fetch("/me/passwort",{method:"POST",headers:authHeaders({"Content-Type":"application/json"}),
      body:JSON.stringify({alt:alt,neu:neu})})
      .then(function(r){
        if(r.ok){ msg.className="set-modal-msg ok"; msg.textContent="Passwort geändert.";
          PFLICHT=false;
          var h=document.getElementById("setPwHinweis"); if(h)h.remove();
          setTimeout(closePw,1200); return; }
        return r.json().then(function(e){ msg.textContent=e.detail||"Fehler beim Ändern."; });
      }).catch(function(){ msg.textContent="Verbindungsfehler."; });
  }

  /* ── Firmenprofil ── */
  var PROFIL = { gesperrt: false };

  function profilLaden() {
    fetch("/me/firmenprofil", { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        PROFIL = d || {};
        var name = document.getElementById("setPName");
        if (!name) return;
        name.value = d.name || "";
        document.getElementById("setPAdresse").value = d.adresse || "";
        document.getElementById("setPSitz").value = d.betriebssitz || "";
        var lat = document.getElementById("setPLat");
        var lon = document.getElementById("setPLon");
        if (lat) lat.value = (d.bs_lat != null) ? String(d.bs_lat) : "";
        if (lon) lon.value = (d.bs_lon != null) ? String(d.bs_lon) : "";
        var koord = document.getElementById("setPKoord");
        koord.textContent = "";
        profilSperreAnzeigen();
      })
      .catch(function () {});
  }

  function profilSperreAnzeigen() {
    var box = document.getElementById("setProfilSperre");
    var speichern = document.getElementById("setPSaveBtn");
    var frei = document.getElementById("setPFreiBtn");
    var felder = ["setPName", "setPAdresse", "setPSitz", "setPLat", "setPLon"];
    if (!box) return;
    if (PROFIL.gesperrt) {
      box.innerHTML = '<div class="set-sperre">Das Firmenprofil ist gesperrt. '
        + 'Für weitere Änderungen beantrage bitte eine Freischaltung.</div>';
      felder.forEach(function (id) { var e = document.getElementById(id); if (e) e.disabled = true; });
      if (speichern) speichern.style.display = "none";
      if (frei) frei.style.display = "";
    } else {
      box.innerHTML = '<div class="set-warnung">Du kannst dein Firmenprofil <b>einmal</b> ändern. '
        + 'Danach ist es gesperrt und muss vom Support freigeschaltet werden.</div>';
      felder.forEach(function (id) { var e = document.getElementById(id); if (e) e.disabled = false; });
      if (speichern) speichern.style.display = "";
      if (frei) frei.style.display = "none";
    }
  }

  /* Sammelt die Eingaben. Komma wird zu Punkt, leere Koordinaten bleiben leer
     (dann ermittelt der Server sie aus dem Betriebssitz). */
  function profilDaten(name, idAdr, idSitz, idLat, idLon) {
    function zahl(id) {
      var e = document.getElementById(id);
      if (!e) return null;
      var t = (e.value || "").trim().replace(",", ".");
      if (!t) return null;
      var z = parseFloat(t);
      return isNaN(z) ? null : z;
    }
    return {
      name: name,
      adresse: document.getElementById(idAdr).value.trim(),
      betriebssitz: document.getElementById(idSitz).value.trim(),
      bs_lat: zahl(idLat),
      bs_lon: zahl(idLon)
    };
  }

  function profilSpeichern() {
    var msg = document.getElementById("setPMsg");
    msg.className = "set-msg";
    var name = document.getElementById("setPName").value.trim();
    if (!name) { msg.className = "set-msg err"; msg.textContent = "Firmenname darf nicht leer sein."; return; }
    fcFrage("Firmenprofil speichern", "Danach ist es gesperrt und kann nur nach Freischaltung durch den Support geändert werden.",
      "warn", "Speichern", function () {
    msg.textContent = "Wird gespeichert…";
    fetch("/me/firmenprofil", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(profilDaten(name, "setPAdresse", "setPSitz", "setPLat", "setPLon"))
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.detail || "Fehler");
        PROFIL = d;
        var la = document.getElementById("setPLat"), lo = document.getElementById("setPLon");
        if (la) la.value = (d.bs_lat != null) ? String(d.bs_lat) : "";
        if (lo) lo.value = (d.bs_lon != null) ? String(d.bs_lon) : "";
        var koord = document.getElementById("setPKoord");
        koord.textContent = (d.bs_lat == null)
          ? "Koordinaten konnten nicht ermittelt werden - bitte von Hand eintragen." : "";
        msg.className = "set-msg ok"; msg.textContent = "Gespeichert.";
        profilSperreAnzeigen();
      });
    }).catch(function (e) { msg.className = "set-msg err"; msg.textContent = e.message; });
    });
  }

  function profilFreischaltung() {
    var msg = document.getElementById("setPMsg");
    msg.className = "set-msg";
    fetch("/me/firmenprofil/freischaltung", { method: "POST", headers: authHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error("Fehler");
        msg.className = "set-msg ok";
        msg.textContent = "Anfrage ist angekommen. Wir melden uns und schalten das Profil frei.";
      })
      .catch(function () { msg.className = "set-msg err"; msg.textContent = "Anfrage konnte nicht gesendet werden."; });
  }

  /* ── Firmenlogo ── */
  function logoVorschauSetzen(dataUrl) {
    var v = document.getElementById("setLogoVorschau");
    var del = document.getElementById("setLogoDelBtn");
    if (!v) return;
    if (dataUrl) {
      v.innerHTML = '<img src="' + dataUrl + '" alt="Logo" style="max-width:200px;max-height:80px;display:block">';
      if (del) del.style.display = "";
    } else {
      v.textContent = "Kein Logo";
      if (del) del.style.display = "none";
    }
  }
  function logoLaden() {
    fetch("/me/logo", { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { logoVorschauSetzen(d && d.logo ? d.logo : ""); })
      .catch(function () {});
  }
  function logoHochladen(file) {
    var msg = document.getElementById("setLogoMsg"); msg.className = "set-msg";
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      msg.className = "set-msg err"; msg.textContent = "Bitte eine PNG- oder JPEG-Datei wählen."; return;
    }
    if (file.size > 1500000) {
      msg.className = "set-msg err"; msg.textContent = "Das Bild ist zu groß (max. ca. 1,5 MB)."; return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      msg.textContent = "Wird hochgeladen…";
      fetch("/me/logo", {
        method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ logo: reader.result })
      })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.detail || "Fehler"); return d; }); })
        .then(function (d) { logoVorschauSetzen(d.logo || ""); msg.className = "set-msg ok"; msg.textContent = "Logo gespeichert."; })
        .catch(function (e) { msg.className = "set-msg err"; msg.textContent = e.message; });
    };
    reader.readAsDataURL(file);
  }
  function logoEntfernen() {
    var msg = document.getElementById("setLogoMsg"); msg.className = "set-msg";
    fcFrage("Logo entfernen", "Möchtest du das Firmenlogo wirklich entfernen?", "danger", "Entfernen", function () {
    fetch("/me/logo", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ logo: "" })
    })
      .then(function () { logoVorschauSetzen(""); msg.className = "set-msg ok"; msg.textContent = "Logo entfernt."; })
      .catch(function () { msg.className = "set-msg err"; msg.textContent = "Entfernen fehlgeschlagen."; });
    });
  }

  function showPage() {
    if (typeof window.alleSeitenAus === "function") window.alleSeitenAus();
    ["startPage","zeitnachweisPage","buchPage","lohnPage","fahrtenbuchPage","mitarbeiterPage","firmenPage","teamPage"].forEach(function(id){
      var e=document.getElementById(id); if(e)e.style.display="none";
    });
    document.getElementById("settingsPage").style.display="block";
    load();
    profilLaden();
    logoLaden();
    window.scrollTo({top:0});
  }
  window.openSettingsPage = showPage;   // shell.js kann das aufrufen

  function wire() {
    document.getElementById("setPwBtn").onclick=function(){openPw(false);};
    document.getElementById("setPwCancel").onclick=closePw;
    document.getElementById("setPwBackdrop").onclick=closePw;
    document.getElementById("setPwSave").onclick=savePw;
    document.getElementById("setPwNeu2").addEventListener("keydown",function(e){if(e.key==="Enter")savePw();});
    // Knoepfe ohne Funktion (bewusst): freundlicher Hinweis
    var sp=document.getElementById("setPSaveBtn"); if(sp) sp.onclick=profilSpeichern;
    var sf=document.getElementById("setPFreiBtn"); if(sf) sf.onclick=profilFreischaltung;
    var lb=document.getElementById("setLogoBtn"), lf=document.getElementById("setLogoFile");
    if(lb&&lf){ lb.onclick=function(){lf.click();};
      lf.onchange=function(){ if(lf.files&&lf.files[0]) logoHochladen(lf.files[0]); lf.value=""; }; }
    var ld=document.getElementById("setLogoDelBtn"); if(ld) ld.onclick=logoEntfernen;
    document.getElementById("setUpgradeBtn").onclick=function(){fcInfo("Upgrade","Wird verfügbar, sobald die Bezahlung angebunden ist.","info");};
    document.getElementById("setCancelBtn").onclick=function(){fcInfo("Abo kündigen","Zum Kündigen wende dich bitte an den Support.","info");};
  }

  function pflichtPruefen(){
    fetch("/me", { headers: authHeaders() })
      .then(function(r){ return r.json(); })
      .then(function(d){ if (d && d.passwort_temporaer) openPw(true); })
      .catch(function(){});
  }
  function init(){ buildPage(); wire(); }
  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
