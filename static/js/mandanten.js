/* Mehrere Mandanten: Seite "Firmen" unter Verwaltung + Umschalter in den Modulen.
   Nur sichtbar fuer Konten, die mehrere Firmen betreuen duerfen. */
(function () {
  if (new URLSearchParams(location.search).get("classic") === "1") return;

  var SCHLUESSEL = "fc_mandant";
  var token = null;
  try { token = localStorage.getItem("fc_token") || localStorage.getItem("token"); } catch (e) {}
  function authHeaders(extra) {
    var h = extra || {};
    if (token) h["Authorization"] = "Bearer " + token;
    var m = aktiverMandant();
    if (m) h["X-Mandant"] = String(m);
    return h;
  }
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

  var ZUSTAND = { darf: false, superadmin: false, mandanten: [] };
  var GRUPPEN = [];          // nur fuer Superadmin: alle Gruppen-Konten
  var GEWAEHLTE_GRUPPE = null;  // welche Gruppe der Superadmin gerade verwaltet

  function aktiverMandant() {
    try { var v = localStorage.getItem(SCHLUESSEL); return v ? Number(v) : null; } catch (e) { return null; }
  }
  function setzeMandant(id) {
    try {
      if (id) localStorage.setItem(SCHLUESSEL, String(id));
      else localStorage.removeItem(SCHLUESSEL);
    } catch (e) {}
  }
  window.fcAktiverMandant = aktiverMandant;

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg>';

  /* ── Seite aufbauen ── */
  function buildPage() {
    if (document.getElementById("firmenPage")) return;
    var page = document.createElement("div");
    page.id = "firmenPage";
    page.className = "container md-page";
    page.style.display = "none";
    page.innerHTML =
      '<div class="md-head"><div><h2>Firmen</h2>'
      + '<p>Betriebe, die du betreust. In Zeitnachweis und Lohn kannst du zwischen ihnen wechseln.</p></div></div>'
      + '<div class="md-gruppenwahl" id="mdGruppenWahl" style="display:none">'
      +   '<label for="mdGruppeSel">Gruppe verwalten</label>'
      +   '<select id="mdGruppeSel"></select>'
      +   '<span class="md-hint">Als Superadmin kannst du die Unternehmen jeder Gruppe zuordnen.</span>'
      + '</div>'
      + '<div class="md-table-wrap">'
      +   '<table class="md-table"><thead><tr><th>Firma</th><th>Art</th><th></th></tr></thead>'
      +   '<tbody id="mdBody"></tbody></table>'
      +   '<div id="mdEmpty" class="md-empty" style="display:none">Noch keine weiteren Firmen.</div>'
      + '</div>'
      + '<div class="md-cards">'
      +   '<div class="md-card" id="mdCardZuordnen">'
      +     '<div class="md-card-title">Unternehmen zuordnen</div>'
      +     '<p class="md-card-sub">Registrierte Unternehmen der Gruppe zuordnen.</p>'
      +     '<div class="md-row"><select id="mdFreieWahl"></select>'
      +       '<button class="md-btn md-btn-green" id="mdZuordnenBtn">Zuordnen</button></div>'
      +     '<div class="md-msg" id="mdMsg1"></div>'
      +   '</div>'
      +   '<div class="md-card">'
      +     '<div class="md-card-title">Neue Firma anlegen</div>'
      +     '<p class="md-card-sub">Legt einen neuen Betrieb an und ordnet ihn dir sofort zu. '
      +       'Ein eigener Zugang für den Betrieb ist nicht nötig – du führst ihn selbst.</p>'
      +     '<div class="md-felder">'
      +       '<div><label>Firmenname</label><input type="text" id="mdNeuName" placeholder="z.B. Taxi Muster"></div>'
      +       '<div><label>E-Mail</label><input type="email" id="mdNeuMail" placeholder="chef@firma.de"></div>'
      +       '<div><label>Anschrift</label><input type="text" id="mdNeuAdresse" placeholder="Straße, PLZ Ort"></div>'
      +       '<div><label>Betriebssitz</label><input type="text" id="mdNeuSitz" placeholder="Straße, PLZ Ort"></div>'
      +       '<div><label>Koordinaten (optional)</label>'
      +         '<div class="md-koord-paar">'
      +           '<input type="text" inputmode="decimal" id="mdNeuLat" placeholder="Breitengrad">'
      +           '<input type="text" inputmode="decimal" id="mdNeuLon" placeholder="Längengrad">'
      +         '</div>'
      +         '<div class="md-koord">Leer lassen: werden aus dem Betriebssitz ermittelt.</div></div>'
      +     '</div>'
      +     '<button class="md-btn md-btn-green" id="mdNeuBtn">Firma anlegen</button>'
      +     '<div class="md-msg" id="mdMsg2"></div>'
      +   '</div>'
      + '</div>';
    var host = document.querySelector(".container") ? document.querySelector(".container").parentNode : document.body;
    host.appendChild(page);
  }

  function render() {
    var body = document.getElementById("mdBody");
    var leer = document.getElementById("mdEmpty");
    if (!body) return;
    var liste = ZUSTAND.mandanten || [];
    body.innerHTML = liste.map(function (m) {
      return '<tr><td class="md-name">' + esc(m.name) + '</td>'
        + '<td>' + (m.eigene ? '<span class="md-badge">eigene Firma</span>'
                             : '<span class="md-badge md-badge-green">Mandant</span>') + '</td>'
        + '<td style="text-align:right;white-space:nowrap">'
        + '<button class="md-btn md-btn-green" data-profil="' + m.firma_id + '" data-name="' + esc(m.name) + '">Profil bearbeiten</button> '
        + ((m.eigene || !ZUSTAND.superadmin) ? '' : '<button class="md-btn md-btn-red" data-entf="' + m.firma_id + '">Zuordnung lösen</button>')
        + '</td></tr>';
    }).join("");
    if (leer) leer.style.display = liste.length > 1 ? "none" : "";
    [].forEach.call(body.querySelectorAll("[data-entf]"), function (b) {
      b.onclick = function () { entfernen(Number(b.dataset.entf)); };
    });
    [].forEach.call(body.querySelectorAll("[data-profil]"), function (b) {
      b.onclick = function () { profilOeffnen(Number(b.dataset.profil), b.dataset.name); };
    });
    umschalterFuellen();
  }

  function laden() {
    return fetch("/mandanten", { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        ZUSTAND.darf = !!(d && d.darf);
        ZUSTAND.superadmin = !!(d && d.superadmin);
        ZUSTAND.mandanten = (d && d.mandanten) || [];
        var karte = document.getElementById("mdCardZuordnen");
        if (karte) karte.style.display = ZUSTAND.superadmin ? "" : "none";
        if (ZUSTAND.superadmin) return gruppenLaden().then(render).then(function () { return ZUSTAND; });
        render();
        return ZUSTAND;
      })
      .catch(function () { return ZUSTAND; });
  }

  /* Superadmin: alle Konten mit Lizenzart "Gruppe" zur Auswahl */
  function gruppenLaden() {
    return fetch("/admin/firmen", { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        GRUPPEN = (d && d.firmen ? d.firmen : []).filter(function (f) { return f.lizenzart === "gruppe"; });
        var box = document.getElementById("mdGruppenWahl");
        var sel = document.getElementById("mdGruppeSel");
        if (!box || !sel) return;
        if (!GRUPPEN.length) { box.style.display = "none"; return; }
        box.style.display = "";
        sel.innerHTML = GRUPPEN.map(function (g) {
          return '<option value="' + g.id + '">' + esc(g.name) + ' (' + (g.zugeordnet || 0) + '/' + (g.max_firmen || 1) + ')</option>';
        }).join("");
        if (!GEWAEHLTE_GRUPPE || !GRUPPEN.some(function (g) { return g.id === GEWAEHLTE_GRUPPE; })) {
          GEWAEHLTE_GRUPPE = GRUPPEN[0].id;
        }
        sel.value = String(GEWAEHLTE_GRUPPE);
        sel.onchange = function () { GEWAEHLTE_GRUPPE = Number(sel.value); gruppeAnzeigen(); };
        return gruppeAnzeigen();
      })
      .catch(function () {});
  }

  /* Zugeordnete Unternehmen der gewaehlten Gruppe anzeigen */
  function gruppeAnzeigen() {
    if (!GEWAEHLTE_GRUPPE) return Promise.resolve();
    return fetch("/admin/gruppe/" + GEWAEHLTE_GRUPPE, { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        var body = document.getElementById("mdBody");
        var leer = document.getElementById("mdEmpty");
        if (!body) return;
        body.innerHTML = d.zugeordnet.map(function (z) {
          return '<tr><td class="md-name">' + esc(z.name) + '</td>'
            + '<td><span class="md-badge md-badge-green">zugeordnet</span></td>'
            + '<td style="text-align:right;white-space:nowrap">'
            + '<button class="md-btn md-btn-green" data-profil="' + z.firma_id + '" data-name="' + esc(z.name) + '">Profil bearbeiten</button> '
            + '<button class="md-btn md-btn-red" data-loesen="' + z.firma_id + '">Zuordnung lösen</button></td></tr>';
        }).join("");
        if (leer) leer.style.display = d.zugeordnet.length ? "none" : "";
        [].forEach.call(body.querySelectorAll("[data-loesen]"), function (b) {
          b.onclick = function () { gruppeLoesen(Number(b.dataset.loesen)); };
        });
        [].forEach.call(body.querySelectorAll("[data-profil]"), function (b) {
          b.onclick = function () { profilOeffnen(Number(b.dataset.profil), b.dataset.name); };
        });
        // Auswahl freier Unternehmen in die Zuordnen-Karte
        var karte = document.getElementById("mdCardZuordnen");
        if (karte) {
          karte.querySelector(".md-card-sub").textContent =
            d.zugeordnet.length + " von " + d.max_firmen + " Unternehmen belegt.";
          var wahl = document.getElementById("mdFreieWahl");
          if (wahl) {
            wahl.innerHTML = d.moeglich.length
              ? d.moeglich.map(function (m) { return '<option value="' + m.firma_id + '">' + esc(m.name) + '</option>'; }).join("")
              : '<option value="">Keine freien Unternehmen</option>';
          }
        }
      })
      .catch(function () {});
  }

  function gruppeZuordnen() {
    var wahl = document.getElementById("mdFreieWahl");
    var msg = document.getElementById("mdMsg1");
    msg.className = "md-msg";
    if (!wahl || !wahl.value) { msg.textContent = "Kein Unternehmen zur Auswahl."; return; }
    fetch("/admin/gruppe/zuordnen", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ gruppe_firma_id: GEWAEHLTE_GRUPPE, mandant_firma_id: Number(wahl.value) })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.detail || "Fehler");
        msg.className = "md-msg ok"; msg.textContent = "Zugeordnet.";
        return gruppenLaden();
      });
    }).catch(function (e) { msg.className = "md-msg err"; msg.textContent = e.message; });
  }

  function gruppeLoesen(mandantId) {
    fcFrage("Zuordnung lösen", "Die Firma und ihre Daten bleiben bestehen.", "warn", "Lösen", function () {
    fetch("/admin/gruppe/loesen", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ gruppe_firma_id: GEWAEHLTE_GRUPPE, mandant_firma_id: mandantId })
    }).then(function () { return gruppenLaden(); })
      .catch(function () {});
    });
  }

  function zuordnen() {
    var msg = document.getElementById("mdMsg1");
    var mail = document.getElementById("mdMail").value.trim();
    msg.className = "md-msg";
    if (!mail) { msg.textContent = "Bitte E-Mail eintragen."; return; }
    fetch("/mandanten/hinzufuegen", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ email: mail })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.detail || "Fehler");
        msg.className = "md-msg ok"; msg.textContent = d.name + " wurde zugeordnet.";
        document.getElementById("mdMail").value = "";
        return laden();
      });
    }).catch(function (e) { msg.className = "md-msg err"; msg.textContent = e.message; });
  }

  function neuAnlegen() {
    var msg = document.getElementById("mdMsg2");
    msg.className = "md-msg";
    function zahl(id) {
      var e = document.getElementById(id);
      if (!e) return null;
      var t = (e.value || "").trim().replace(",", ".");
      if (!t) return null;
      var z = parseFloat(t);
      return isNaN(z) ? null : z;
    }
    var name = document.getElementById("mdNeuName").value.trim();
    var mail = document.getElementById("mdNeuMail").value.trim();
    if (!name || !mail) { msg.className = "md-msg err"; msg.textContent = "Firmenname und E-Mail werden gebraucht."; return; }
    fetch("/mandanten/neu", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        firma_name: name, email: mail,
        adresse: document.getElementById("mdNeuAdresse").value.trim(),
        betriebssitz: document.getElementById("mdNeuSitz").value.trim(),
        bs_lat: zahl("mdNeuLat"), bs_lon: zahl("mdNeuLon")
      })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.detail || "Fehler");
        msg.className = "md-msg ok"; msg.textContent = d.name + " wurde angelegt und zugeordnet.";
        ["mdNeuName", "mdNeuMail", "mdNeuAdresse", "mdNeuSitz", "mdNeuLat", "mdNeuLon"]
          .forEach(function (id) { var e = document.getElementById(id); if (e) e.value = ""; });
        return laden();
      });
    }).catch(function (e) { msg.className = "md-msg err"; msg.textContent = e.message; });
  }

  function entfernen(id) {
    var m = ZUSTAND.mandanten.filter(function (x) { return x.firma_id === id; })[0];
    fcFrage("Zuordnung lösen", "Zuordnung zu „" + (m ? m.name : id) + "\" lösen? Die Firma und ihre Daten bleiben bestehen.",
      "warn", "Lösen", function () {
    fetch("/mandanten/entfernen", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ firma_id: id })
    }).then(function () {
      if (aktiverMandant() === id) { setzeMandant(null); }
      return laden();
    }).catch(function () {});
    });
  }

  /* ── Umschalter in Zeitnachweis und Lohn ── */
  /* Statt eines zweiten Feldes: das vorhandene "Firmenname"-Feld wird zur
     Auswahlliste, sobald das Konto mehrere Unternehmen fuehrt. */
  var FELDER = [
    { seite: "zeitnachweisPage", eingabe: "znFirmaInput" },
    { seite: "lohnPage",         eingabe: "lnFirmaInput" },
    { seite: "buchPage",         eingabe: "bkFirmaInput" },
    { seite: "fahrtenbuchPage",  eingabe: "firmaInput" }
  ];

  function umschalterEinbauen() {
    FELDER.forEach(function (f) {
      var eingabe = document.getElementById(f.eingabe);
      if (!eingabe || document.getElementById("md-sel-" + f.eingabe)) return;
      var sel = document.createElement("select");
      sel.id = "md-sel-" + f.eingabe;
      sel.className = "md-switch-sel";
      sel.style.display = "none";
      eingabe.parentNode.insertBefore(sel, eingabe.nextSibling);
      sel.onchange = function () {
        var wert = this.value;
        setzeMandant(wert === "eigene" ? null : Number(wert));
        firmaUebernehmen();
      };
    });
    umschalterFuellen();
  }

  function umschalterFuellen() {
    var liste = ZUSTAND.mandanten || [];
    var aktiv = aktiverMandant();
    var mehrere = ZUSTAND.darf && liste.length > 1;
    FELDER.forEach(function (f) {
      var eingabe = document.getElementById(f.eingabe);
      var sel = document.getElementById("md-sel-" + f.eingabe);
      if (!eingabe || !sel) return;
      if (!mehrere) {
        // Nur eine Firma: alles bleibt wie gewohnt
        sel.style.display = "none";
        eingabe.style.display = "";
        return;
      }
      sel.innerHTML = liste.map(function (m) {
        var wert = m.eigene ? "eigene" : m.firma_id;
        var gewaehlt = m.eigene ? !aktiv : (aktiv === m.firma_id);
        return '<option value="' + wert + '"' + (gewaehlt ? " selected" : "") + '>' + esc(m.name) + '</option>';
      }).join("");
      // Das Eingabefeld bleibt im Hintergrund erhalten (die Module lesen es aus),
      // wird aber durch die Auswahl ersetzt.
      var gewaehlt = liste.filter(function (m) {
        return m.eigene ? !aktiv : (aktiv === m.firma_id);
      })[0] || liste[0];
      if (gewaehlt && !eingabe.value) eingabe.value = gewaehlt.name;
      eingabe.style.display = "none";
      sel.style.display = "";
    });
  }

  /* Firmenwechsel ohne Neuladen: Name uebernehmen und die Mitarbeiter
     der gewaehlten Firma frisch holen. */
  function aktiverName() {
    var aktiv = aktiverMandant();
    var treffer = (ZUSTAND.mandanten || []).filter(function (m) {
      return m.eigene ? !aktiv : (aktiv === m.firma_id);
    })[0];
    return treffer ? treffer.name : "";
  }

  function firmaUebernehmen() {
    var aktiv = aktiverMandant();

    // Alle Auswahlfelder gleichziehen
    FELDER.forEach(function (f) {
      var sel = document.getElementById("md-sel-" + f.eingabe);
      if (sel) sel.value = aktiv ? String(aktiv) : "eigene";
    });

    if (typeof window.fcMitarbeiterGeaendert === "function") window.fcMitarbeiterGeaendert();

    // Profil der gewaehlten Firma holen und in alle Module eintragen
    return fetch("/me/firmenprofil", { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var name = (d && d.name) || aktiverName();
        function setzen(id, wert) {
          var e = document.getElementById(id);
          if (!e) return;
          e.value = (wert == null) ? "" : String(wert);
          try { e.dispatchEvent(new Event("change", { bubbles: true })); } catch (x) {}
        }
        ["znFirmaInput", "lnFirmaInput", "bkFirmaInput", "firmaInput"].forEach(function (id) {
          setzen(id, name);
        });
        if (d) {
          setzen("znAnschriftInput", d.adresse || d.betriebssitz || "");
          setzen("betriebssitz", d.betriebssitz || d.adresse || "");
          koordinatenFelderAngleichen();
          setzen("lat", d.bs_lat != null ? d.bs_lat : "");
          setzen("lon", d.bs_lon != null ? d.bs_lon : "");
        }
      })
      .catch(function () {})
      .then(function () {
        // Mitarbeiter der neuen Firma nachladen
        var arbeiten = [];
        if (typeof window.znLoadStammdaten === "function") {
          arbeiten.push(Promise.resolve(window.znLoadStammdaten()).then(function () {
            if (window.ZN_STATE) window.ZN_STATE.hoursData = {};
            znMitarbeiterEintragen();
            if (typeof window.znRenderDriverList === "function") window.znRenderDriverList();
          }));
        }
        if (typeof window.lnLoadStammdaten === "function") {
          arbeiten.push(Promise.resolve(window.lnLoadStammdaten()).then(function () {
            if (typeof window.lnRenderStammSidebar === "function") window.lnRenderStammSidebar();
            if (typeof window.lnRenderStammModal === "function") window.lnRenderStammModal();
          }));
        }
        // Buchhaltung und Lohn: Daten der neuen Firma fuer den Zeitraum holen
        arbeiten.push(buchhaltungNeuLaden());
        arbeiten.push(lohnNeuLaden());
        return Promise.all(arbeiten).catch(function () {});
      });
  }

  /* ── Firmenprofil je Betrieb bearbeiten ── */
  function kopfFuer(firmaId, extra) {
    var h = extra || {};
    if (token) h["Authorization"] = "Bearer " + token;
    if (firmaId) h["X-Mandant"] = String(firmaId);
    return h;
  }

  window.profilOeffnen = function (firmaId, firmaName) {
    var host = document.getElementById("mdProfilHost");
    if (!host) { host = document.createElement("div"); host.id = "mdProfilHost"; document.body.appendChild(host); }
    host.innerHTML = '<div class="md-modal-backdrop" id="mdProfilZu"></div>'
      + '<div class="md-modal"><div class="md-modal-head">'
      +   '<div class="md-modal-title">' + esc(firmaName || "Firmenprofil") + '</div>'
      +   '<button class="md-btn" id="mdProfilZu2">Schließen</button></div>'
      + '<div id="mdProfilInhalt" style="padding:18px 0">Wird geladen…</div></div>';
    host.style.display = "block";
    document.getElementById("mdProfilZu").onclick = profilSchliessen;
    document.getElementById("mdProfilZu2").onclick = profilSchliessen;

    fetch("/me/firmenprofil", { headers: kopfFuer(firmaId) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var box = document.getElementById("mdProfilInhalt");
        var gesperrt = !!d.gesperrt;
        box.innerHTML =
          (gesperrt
            ? '<div class="md-sperre">Dieses Firmenprofil ist gesperrt. '
              + (ZUSTAND.superadmin
                  ? 'Als Superadmin kannst du es unten wieder freigeben.'
                  : 'Für Änderungen bitte eine Freischaltung beim Support beantragen.') + '</div>'
            : '<div class="md-warnung">Das Profil kann <b>einmal</b> geändert werden. '
              + 'Danach ist es gesperrt.</div>')
          + '<div class="md-felder">'
          +   '<div><label>Firmenname</label><input type="text" id="mdPName" value="' + esc(d.name || "") + '"' + (gesperrt ? " disabled" : "") + '></div>'
          +   '<div><label>Anschrift</label><input type="text" id="mdPAdresse" value="' + esc(d.adresse || "") + '" placeholder="Straße, PLZ Ort"' + (gesperrt ? " disabled" : "") + '></div>'
          +   '<div><label>Betriebssitz</label><input type="text" id="mdPSitz" value="' + esc(d.betriebssitz || "") + '" placeholder="Straße, PLZ Ort"' + (gesperrt ? " disabled" : "") + '></div>'
          +   '<div><label>Koordinaten</label>'
          +     '<div class="md-koord-paar">'
          +       '<input type="text" inputmode="decimal" id="mdPLat" value="' + (d.bs_lat != null ? d.bs_lat : "") + '" placeholder="Breitengrad"' + (gesperrt ? " disabled" : "") + '>'
          +       '<input type="text" inputmode="decimal" id="mdPLon" value="' + (d.bs_lon != null ? d.bs_lon : "") + '" placeholder="Längengrad"' + (gesperrt ? " disabled" : "") + '>'
          +     '</div>'
          +     '<div class="md-koord" id="mdPKoord">Leer lassen: wird aus dem Betriebssitz ermittelt. '
          +       'Eigene Werte haben Vorrang.</div></div>'
          + '</div>'
          + '<div style="margin-top:4px"><label style="display:block;font-size:12px;color:#aaa;margin-bottom:6px">'
          +   'Firmenlogo <span style="color:#777">(auf Verträgen, Lohn, Trinkgeld, Quittung)</span></label>'
          +   '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
          +     '<div id="mdLogoVorschau" style="min-width:110px;min-height:54px;max-width:200px;display:flex;'
          +       'align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.12);border-radius:10px;'
          +       'padding:8px;background:rgba(255,255,255,.03);color:#888;font-size:12px">Kein Logo</div>'
          +     '<div style="display:flex;flex-direction:column;gap:8px">'
          +       '<input type="file" id="mdLogoFile" accept="image/png,image/jpeg" style="display:none">'
          +       '<button class="md-btn md-btn-green" id="mdLogoBtn" type="button">Logo hochladen</button>'
          +       '<button class="md-btn md-btn-red" id="mdLogoDelBtn" type="button" style="display:none">Entfernen</button>'
          +     '</div>'
          +   '</div><div class="md-msg" id="mdLogoMsg"></div></div>'
          + '<div class="md-msg" id="mdPMsg"></div>'
          + '<div class="md-modal-aktionen">'
          +   (gesperrt
                ? (ZUSTAND.superadmin
                    ? '<button class="md-btn md-btn-green" id="mdPFreiBtn">Profil freigeben</button>'
                    : '<button class="md-btn" id="mdPAntragBtn">Freischaltung beantragen</button>')
                : '<button class="md-btn md-btn-green" id="mdPSaveBtn">Speichern</button>')
          + '</div>';

        var save = document.getElementById("mdPSaveBtn");
        if (save) save.onclick = function () { profilSpeichern(firmaId, firmaName); };
        var frei = document.getElementById("mdPFreiBtn");
        if (frei) frei.onclick = function () { profilFreigeben(firmaId, firmaName); };
        var antrag = document.getElementById("mdPAntragBtn");
        if (antrag) antrag.onclick = function () { profilAntrag(firmaId); };
        // Firmenlogo (unabhängig von der Profilsperre)
        mdLogoLaden(firmaId);
        var lb = document.getElementById("mdLogoBtn"), lf = document.getElementById("mdLogoFile");
        if (lb && lf) {
          lb.onclick = function () { lf.click(); };
          lf.onchange = function () { if (lf.files && lf.files[0]) mdLogoHochladen(firmaId, lf.files[0]); lf.value = ""; };
        }
        var ldel = document.getElementById("mdLogoDelBtn");
        if (ldel) ldel.onclick = function () { mdLogoEntfernen(firmaId); };
      })
      .catch(function () {
        document.getElementById("mdProfilInhalt").innerHTML =
          '<div class="md-msg err">Profil konnte nicht geladen werden.</div>';
      });
  };

  function profilSchliessen() {
    var h = document.getElementById("mdProfilHost");
    if (h) { h.style.display = "none"; h.innerHTML = ""; }
  }

  function profilSpeichern(firmaId, firmaName) {
    var msg = document.getElementById("mdPMsg");
    msg.className = "md-msg";
    var name = document.getElementById("mdPName").value.trim();
    if (!name) { msg.className = "md-msg err"; msg.textContent = "Firmenname darf nicht leer sein."; return; }
    fcFrage("Firmenprofil speichern", "Danach ist es für diesen Betrieb gesperrt.", "warn", "Speichern", function () {
    msg.textContent = "Wird gespeichert…";
    fetch("/me/firmenprofil", {
      method: "POST", headers: kopfFuer(firmaId, { "Content-Type": "application/json" }),
      body: JSON.stringify((function () {
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
          adresse: document.getElementById("mdPAdresse").value.trim(),
          betriebssitz: document.getElementById("mdPSitz").value.trim(),
          bs_lat: zahl("mdPLat"),
          bs_lon: zahl("mdPLon")
        };
      })())
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.detail || "Fehler");
        laden();
        profilOeffnen(firmaId, d.name || firmaName);   // frisch anzeigen (jetzt gesperrt)
      });
    }).catch(function (e) { msg.className = "md-msg err"; msg.textContent = e.message; });
    });
  }

  function profilFreigeben(firmaId, firmaName) {
    fcFrage("Profil freigeben", "Der Betrieb kann danach einmal geändert werden.", "warn", "Freigeben", function () {
    fetch("/admin/firmenprofil/freigeben", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ firma_id: firmaId })
    }).then(function () { profilOeffnen(firmaId, firmaName); })
      .catch(function () {});
    });
  }

  function profilAntrag(firmaId) {
    var msg = document.getElementById("mdPMsg");
    fetch("/me/firmenprofil/freischaltung", { method: "POST", headers: kopfFuer(firmaId) })
      .then(function () {
        msg.className = "md-msg ok";
        msg.textContent = "Anfrage ist angekommen. Wir schalten das Profil frei.";
      })
      .catch(function () { msg.className = "md-msg err"; msg.textContent = "Anfrage fehlgeschlagen."; });
  }

  /* ── Firmenlogo je Betrieb (nutzt X-Mandant über kopfFuer) ── */
  function mdLogoVorschau(dataUrl) {
    var v = document.getElementById("mdLogoVorschau"), del = document.getElementById("mdLogoDelBtn");
    if (!v) return;
    if (dataUrl) {
      v.innerHTML = '<img src="' + dataUrl + '" alt="Logo" style="max-width:180px;max-height:70px;display:block">';
      if (del) del.style.display = "";
    } else { v.textContent = "Kein Logo"; if (del) del.style.display = "none"; }
  }
  function mdLogoLaden(firmaId) {
    fetch("/me/logo", { headers: kopfFuer(firmaId) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { mdLogoVorschau(d && d.logo ? d.logo : ""); })
      .catch(function () {});
  }
  function mdLogoHochladen(firmaId, file) {
    var msg = document.getElementById("mdLogoMsg"); if (msg) msg.className = "md-msg";
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { if (msg) { msg.className = "md-msg err"; msg.textContent = "Bitte PNG oder JPEG."; } return; }
    if (file.size > 1500000) { if (msg) { msg.className = "md-msg err"; msg.textContent = "Zu groß (max. ca. 1,5 MB)."; } return; }
    var reader = new FileReader();
    reader.onload = function () {
      if (msg) msg.textContent = "Wird hochgeladen…";
      fetch("/me/logo", { method: "POST", headers: kopfFuer(firmaId, { "Content-Type": "application/json" }),
        body: JSON.stringify({ logo: reader.result }) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.detail || "Fehler"); return d; }); })
        .then(function (d) { mdLogoVorschau(d.logo || ""); if (msg) { msg.className = "md-msg ok"; msg.textContent = "Logo gespeichert."; } })
        .catch(function (e) { if (msg) { msg.className = "md-msg err"; msg.textContent = e.message; } });
    };
    reader.readAsDataURL(file);
  }
  function mdLogoEntfernen(firmaId) {
    var msg = document.getElementById("mdLogoMsg");
    fcFrage("Logo entfernen", "Möchtest du das Firmenlogo wirklich entfernen?", "danger", "Entfernen", function () {
    fetch("/me/logo", { method: "POST", headers: kopfFuer(firmaId, { "Content-Type": "application/json" }),
      body: JSON.stringify({ logo: "" }) })
      .then(function () { mdLogoVorschau(""); if (msg) { msg.className = "md-msg ok"; msg.textContent = "Logo entfernt."; } })
      .catch(function () { if (msg) { msg.className = "md-msg err"; msg.textContent = "Entfernen fehlgeschlagen."; } });
    });
  }

  /* ── Seite anzeigen + Seitenleiste ── */
  function showPage() {
    if (typeof window.alleSeitenAus === "function") window.alleSeitenAus();
    ["startPage","zeitnachweisPage","buchPage","lohnPage","fahrtenbuchPage","mitarbeiterPage","settingsPage","teamPage"]
      .forEach(function (id) { var e = document.getElementById(id); if (e) e.style.display = "none"; });
    document.getElementById("firmenPage").style.display = "block";
    laden();
    window.scrollTo({ top: 0 });
  }
  window.openFirmenPage = showPage;

  function sidebarKnopf() {
    var side = document.querySelector(".fc-shell-side, aside.fc-side, .fc-side, [aria-label='Module']");
    if (!side) return false;
    if (side.querySelector('[data-fc-target="firmen"]')) return true;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fc-side-btn";
    btn.dataset.fcTarget = "firmen";
    btn.innerHTML = ICON + "<span>Firmen</span>";
    btn.onclick = showPage;
    // Erst einsortieren, wenn die Verwaltung-Gruppe steht
    var ma = side.querySelector('[data-fc-target="mitarbeiter"]');
    var konto = [].slice.call(side.querySelectorAll(".fc-side-label"))
      .filter(function (l) { return l.textContent === "Konto"; })[0];
    if (!ma || !konto) return false;    // noch nicht fertig -> spaeter erneut
    side.insertBefore(btn, ma.nextSibling || konto);
    return true;
  }

  function wire() {
    var z = document.getElementById("mdZuordnenBtn"); if (z) z.onclick = gruppeZuordnen;
    var n = document.getElementById("mdNeuBtn"); if (n) n.onclick = neuAnlegen;

  }

  /* Der Knopf "verwalten" in Zeitnachweis und Lohn entfaellt - die Mitarbeiter
     kommen aus der zentralen Verwaltung. */
  function verwaltenKnoepfeAusblenden() {
    // Hinweistexte anpassen, die noch auf "verwalten" verweisen
    ["zeitnachweisPage", "lohnPage"].forEach(function (seite) {
      var s = document.getElementById(seite);
      if (!s) return;
      [].forEach.call(s.querySelectorAll("div, p, span"), function (el) {
        if (el.children.length === 0 && /Klick "verwalten"/.test(el.textContent)) {
          el.textContent = 'Mitarbeiter legst du unter Verwaltung > Mitarbeiter an.';
        }
      });
    });
    // Beide Module: jeden "verwalten"-Knopf kennzeichnen. Die Stilregel in
    // mandanten.css blendet ihn dauerhaft aus - auch wenn das Modul ihn
    // beim Neuzeichnen wieder einblenden will.
    ["lohnPage", "zeitnachweisPage"].forEach(function (seite) {
      var s = document.getElementById(seite);
      if (!s) return;
      [].forEach.call(s.querySelectorAll("button"), function (b) {
        if (b.textContent.trim().toLowerCase() === "verwalten") {
          b.classList.add("md-verwalten-weg");
        }
      });
    });
    var zn = document.getElementById("znStammVerwaltenBtn");
    if (zn) zn.classList.add("md-verwalten-weg");
  }

  /* Lohn beim Firmenwechsel neu laden - sonst blieben die Fahrer-Abrechnungen
     der vorherigen Firma stehen, bis die Seite neu geladen wird. */
  function lohnNeuLaden() {
    if (typeof window.LN_STATE === "undefined") return Promise.resolve();
    // Abrechnung der vorherigen Firma weg
    try {
      window.LN_STATE.drivers = [];
      window.LN_STATE.activeDriverId = null;
    } catch (e) {}
    var monat = "";
    var feld = document.getElementById("lnMonth");
    if (feld) monat = feld.value || "";
    var firma = "";
    try {
      if (typeof window.lnGetFirmaKey === "function") firma = window.lnGetFirmaKey();
    } catch (e) {}
    if (monat && typeof window.lnDoLoad === "function") {
      return Promise.resolve(window.lnDoLoad(firma, monat))
        .catch(function () {})
        .then(function () {
          if (typeof window.lnRefreshMonthList === "function") {
            try { window.lnRefreshMonthList(); } catch (e) {}
          }
        });
    }
    // Kein Monat gewaehlt: nur die Anzeige leeren
    ["lnRender", "lnRefreshMonthList"].forEach(function (fn) {
      if (typeof window[fn] === "function") { try { window[fn](); } catch (e) {} }
    });
    return Promise.resolve();
  }

  /* Buchhaltung beim Firmenwechsel neu laden. Ohne das blieben die Buchungen
     der vorherigen Firma stehen, bis die Seite neu geladen wird. */
  function buchhaltungNeuLaden() {
    if (typeof window.BK_STATE === "undefined") return Promise.resolve();
    // Alte Buchungen weg - sie gehoeren zur vorherigen Firma
    try {
      window.BK_STATE.buchungen = [];
      window.BK_STATE.startKasse = 0;
      window.BK_STATE.startBank = 0;
    } catch (e) {}
    var periode = "";
    try {
      if (typeof window.bkGetPeriode === "function") periode = window.bkGetPeriode();
    } catch (e) {}
    var firma = "";
    try {
      if (typeof window.bkGetFirmaKey === "function") firma = window.bkGetFirmaKey();
    } catch (e) {}
    if (periode && typeof window.bkDoLoad === "function") {
      // Lädt die gespeicherten Daten der neuen Firma (oder zeigt "nicht gefunden")
      return Promise.resolve(window.bkDoLoad(firma, periode))
        .catch(function () {})
        .then(function () {
          if (typeof window.bkRefreshPeriodList === "function") {
            try { window.bkRefreshPeriodList(); } catch (e) {}
          }
        });
    }
    // Kein Zeitraum gewaehlt: nur die Anzeige leeren
    ["bkRender", "bkRefreshPeriodList"].forEach(function (fn) {
      if (typeof window[fn] === "function") { try { window[fn](); } catch (e) {} }
    });
    return Promise.resolve();
  }

  /* Wichtig: Der Zeitnachweis zeichnet seine Fahrerliste aus ZN_STATE.hoursData,
     nicht aus den Stammdaten. Wer dort nicht steht, erscheint auch nicht.
     Deshalb tragen wir die Mitarbeiter der Firma dort ein (mit 0 Stunden). */
  function znMitarbeiterEintragen() {
    var z = window.ZN_STATE;
    if (!z) return false;
    if (!z.hoursData) z.hoursData = {};
    var neuEingetragen = false;
    (z.stamm || []).forEach(function (m) {
      if (m && m.name && !z.hoursData[m.name]) {
        z.hoursData[m.name] = {};
        neuEingetragen = true;
      }
    });
    return neuEingetragen;
  }

  function zeichnenAbsichern() {
    // Zeitnachweis
    var znOriginal = window.znRenderDriverList;
    if (typeof znOriginal === "function" && !znOriginal.__fcAbgesichert) {
      var znLaeuft = false;
      var znNeu = function () {
        znMitarbeiterEintragen();                 // vor dem Zeichnen eintragen
        var ergebnis = znOriginal.apply(this, arguments);
        var z = window.ZN_STATE;
        var ohneStamm = !z || !z.stamm || !z.stamm.length;
        if (ohneStamm && !znLaeuft && typeof window.znLoadStammdaten === "function") {
          znLaeuft = true;
          Promise.resolve(window.znLoadStammdaten()).then(function () {
            if (znMitarbeiterEintragen()) znOriginal.apply(window);   // ohne Schleife
          }).catch(function () {}).then(function () { znLaeuft = false; });
        }
        return ergebnis;
      };
      znNeu.__fcAbgesichert = true;
      window.znRenderDriverList = znNeu;
    }

    // Lohn
    var lnOriginal = window.lnRenderStammSidebar;
    if (typeof lnOriginal === "function" && !lnOriginal.__fcAbgesichert) {
      var lnLaeuft = false;
      var lnNeu = function () {
        var ergebnis = lnOriginal.apply(this, arguments);
        var z = window.LN_STATE;
        var leer = !z || !z.stamm || !z.stamm.length;
        if (leer && !lnLaeuft && typeof window.lnLoadStammdaten === "function") {
          lnLaeuft = true;
          Promise.resolve(window.lnLoadStammdaten()).then(function () {
            var z2 = window.LN_STATE;
            if (z2 && z2.stamm && z2.stamm.length) lnOriginal.apply(window);
          }).catch(function () {}).then(function () { lnLaeuft = false; });
        }
        return ergebnis;
      };
      lnNeu.__fcAbgesichert = true;
      window.lnRenderStammSidebar = lnNeu;
    }
  }

  function moduleUeberwachen() {
    zeichnenAbsichern();
    [["openZeitnachweis", "znLoadStammdaten", "znRenderDriverList"],
     ["openLohn", "lnLoadStammdaten", "lnRenderStammSidebar"],
     ["openFahrtenbuch", null, null],
     ["openBuch", null, null]].forEach(function (p) {
      var oeffnen = p[0], laden = p[1], zeichnen = p[2];
      if (typeof window[oeffnen] !== "function" || window[oeffnen].__fcErweitert) return;
      var original = window[oeffnen];
      var neu = function () {
        var ergebnis = original.apply(this, arguments);
        setTimeout(function () {
          verwaltenKnoepfeAusblenden();
          koordinatenFelderAngleichen();
          umschalterEinbauen();
          profilInModule();
          if (laden && typeof window[laden] === "function") {
            Promise.resolve(window[laden]()).then(function () {
              znMitarbeiterEintragen();
              if (typeof window[zeichnen] === "function") window[zeichnen]();
            }).catch(function () {});
          }
        }, 50);
        return ergebnis;
      };
      neu.__fcErweitert = true;
      window[oeffnen] = neu;
    });
  }

  /* Firmenname und Anschrift kommen aus dem Firmenprofil - die Felder in den
     Modulen werden damit gefuellt und sind nicht mehr frei eintippbar. */
  /* Echte Feld-Kennungen der Module (nachgesehen, nicht geraten):
     Zeitnachweis: znFirmaInput / znAnschriftInput
     Lohn:         lnFirmaInput
     Fahrtenbuch:  firmaInput / betriebssitz / lat / lon */
  function profilInModule() {
    fetch("/me/firmenprofil", { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        function setzen(id, wert) {
          var e = document.getElementById(id);
          if (!e || !wert) return;
          if (e.value && e.value.trim()) return;      // vorhandene Eingabe nicht ueberschreiben
          e.value = wert;
          try { e.dispatchEvent(new Event("change", { bubbles: true })); } catch (x) {}
        }
        // Firmenname in allen drei Modulen
        setzen("znFirmaInput", d.name);
        setzen("lnFirmaInput", d.name);
        setzen("firmaInput", d.name);
        // Anschrift / Betriebssitz
        setzen("znAnschriftInput", d.adresse || d.betriebssitz);
        setzen("betriebssitz", d.betriebssitz || d.adresse);
        // Koordinaten
        koordinatenFelderAngleichen();
        if (d.bs_lat != null && d.bs_lon != null) {
          setzen("lat", String(d.bs_lat));
          setzen("lon", String(d.bs_lon));
        }
      })
      .catch(function () {});
  }

  /* Zahlenfelder zeigen bei deutscher Spracheinstellung ein Komma an, gerechnet
     wird aber mit Punkt. Damit Anzeige und Rechnung uebereinstimmen, stellen wir
     die Koordinatenfelder auf Text um - und wandeln Komma-Eingaben in Punkt. */
  function koordinatenFelderAngleichen() {
    ["lat", "lon"].forEach(function (id) {
      var e = document.getElementById(id);
      if (!e || e.dataset.fcPunkt) return;
      e.dataset.fcPunkt = "1";
      if (e.type === "number") {
        var wert = e.value;
        e.type = "text";
        e.setAttribute("inputmode", "decimal");
        e.value = wert;
      }
      e.addEventListener("input", function () {
        if (this.value.indexOf(",") >= 0) {
          var pos = this.selectionStart;
          this.value = this.value.replace(/,/g, ".");
          try { this.setSelectionRange(pos, pos); } catch (x) {}
        }
      });
      e.addEventListener("change", function () {
        this.value = this.value.replace(/,/g, ".");
      });
    });
  }

  function init() {
    buildPage();
    wire();
    umschalterEinbauen();
    verwaltenKnoepfeAusblenden();
    profilInModule();
    // Die Modul-Funktionen stehen evtl. erst spaeter bereit
    var v = 0;
    var t = setInterval(function () {
      moduleUeberwachen();
      verwaltenKnoepfeAusblenden();
      if (++v > 40) clearInterval(t);
    }, 150);
    // Falls beim Start schon ein Modul offen ist: Liste gleich holen
    setTimeout(function () {
      var offen = ["zeitnachweisPage", "lohnPage"].filter(function (id) {
        var e = document.getElementById(id);
        return e && e.style.display !== "none";
      })[0];
      if (!offen) return;
      if (offen === "zeitnachweisPage" && typeof window.znLoadStammdaten === "function") {
        Promise.resolve(window.znLoadStammdaten()).then(function () {
          if (typeof window.znRenderDriverList === "function") window.znRenderDriverList();
        }).catch(function () {});
      }
      if (offen === "lohnPage" && typeof window.lnLoadStammdaten === "function") {
        Promise.resolve(window.lnLoadStammdaten()).then(function () {
          if (typeof window.lnRenderStammSidebar === "function") window.lnRenderStammSidebar();
        }).catch(function () {});
      }
    }, 400);
    laden().then(function (z) {
      if (!z.darf) {
        var s = document.getElementById("firmenPage"); if (s) s.remove();
        return;
      }
      var versuche = 0;
      var timer = setInterval(function () {
        if (sidebarKnopf() || ++versuche > 100) clearInterval(timer);
      }, 150);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
