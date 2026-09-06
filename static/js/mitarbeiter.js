/* Etappe 2: Mitarbeiter-Verwaltung als eigene Seite.
   Fuegt einen Seitenleisten-Punkt + eine Verwaltungsseite ein (per Injektion,
   dashboard.html bleibt unangetastet). Spricht die /mitarbeiter-Endpunkte an. */
(function () {
  if (new URLSearchParams(location.search).get("classic") === "1") return;

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'
    + '<path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

  var token = null;
  try { token = localStorage.getItem("fc_token") || localStorage.getItem("token"); } catch (e) {}

  function authHeaders(extra) {
    var h = extra || {};
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  }

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

  /* ── Die Mitarbeiter-Seite (Container) bauen ── */
  var FIRMEN = [];            // nur fuer Superadmin/Admin gefuellt
  var AKTUELLE_FIRMA = null;  // welche Firma wird gerade angezeigt
  var IST_ADMIN = false;

  function buildPage() {
    if (document.getElementById("mitarbeiterPage")) return;
    var page = document.createElement("div");
    page.id = "mitarbeiterPage";
    page.className = "container ma-page";
    page.style.display = "none";
    page.innerHTML =
      '<div class="ma-head">'
      + '<div><h2>Mitarbeiter</h2><p>Zentrale Verwaltung - gilt für alle Module</p></div>'
      + '<button type="button" class="ma-add-btn" id="maAddBtn">+ Neuer Mitarbeiter</button>'
      + '</div>'
      + '<div class="ma-firmenwahl" id="maFirmenWahl" style="display:none">'
      +   '<label for="maFirmaSelect">Unternehmer</label>'
      +   '<select id="maFirmaSelect"></select>'
      +   '<span class="ma-firmenwahl-hint">Mitarbeiter werden je Unternehmer getrennt geführt.</span>'
      + '</div>'
      + '<div class="ma-table-wrap">'
      + '<table class="ma-table"><thead><tr>'
      + '<th>Name</th><th>Personalnr.</th><th>Stundenlohn</th><th>Std/Woche</th><th>Status</th><th></th>'
      + '</tr></thead><tbody id="maTableBody"></tbody></table>'
      + '<div id="maEmpty" class="ma-empty" style="display:none">Noch keine Mitarbeiter. Lege den ersten an.</div>'
      + '</div>';
    // in denselben Bereich wie die anderen Seiten haengen
    var host = document.querySelector(".container") ? document.querySelector(".container").parentNode : document.body;
    host.appendChild(page);

    // Formular-Dialog
    var modal = document.createElement("div");
    modal.id = "maModal";
    modal.className = "ma-modal";
    modal.style.display = "none";
    modal.innerHTML =
      '<div class="ma-modal-backdrop" id="maModalBackdrop"></div>'
      + '<div class="ma-modal-card">'
      + '<div class="ma-modal-title" id="maModalTitle">Neuer Mitarbeiter</div>'
      + '<div id="maFFirmaWrap" style="display:none">'
      +   '<label>Unternehmer</label><select id="maFFirma"></select>'
      +   '<div class="ma-feld-hinweis">Der Mitarbeiter gehört zu diesem Betrieb.</div>'
      + '</div>'
      + '<label>Name</label><input type="text" id="maFName" placeholder="z.B. Adham Sawah" autocomplete="off">'
      + '<label>Personalnummer <span class="opt">(optional)</span></label><input type="text" id="maFPn" placeholder="z.B. 12345" autocomplete="off">'
      + '<label>Anschrift</label>'
      + '<input type="text" id="maFAdresse" placeholder="Straße, PLZ Ort" autocomplete="off">'
      + '<label>Geburtsdatum <span class="opt">(optional)</span></label>'
      + '<input type="date" id="maFGeb">'
      + '<label>Tätigkeit</label>'
      + '<select id="maFTaetig">'
      +   '<option value="Mietwagenfahrer">Mietwagenfahrer</option>'
      +   '<option value="Betriebsleiter">Betriebsleiter</option>'
      +   '<option value="Geschäftsführer">Geschäftsführer</option>'
      +   '<option value="Bürokraft">Bürokraft</option>'
      + '</select>'
      + '<label class="ma-check"><input type="checkbox" id="maFAktiv" checked> Aktiv</label>'
      + '<div class="ma-modal-actions">'
      +   '<button type="button" class="ma-btn-ghost" id="maCancel">Abbrechen</button>'
      +   '<button type="button" class="ma-btn-primary" id="maSave">Speichern</button>'
      + '</div>'
      + '<div class="ma-vertrag-hinweis" id="maVertragHinweis"></div>'
      + '<div class="ma-modal-err" id="maErr"></div>'
      + '</div>';
    document.body.appendChild(modal);
  }

  var editId = null;

  function openModal(m) {
    editId = m ? m.id : null;
    document.getElementById("maModalTitle").textContent = m ? "Mitarbeiter bearbeiten" : "Neuer Mitarbeiter";
    document.getElementById("maFName").value = m ? m.name : "";
    document.getElementById("maFPn").value = m ? (m.personalnummer || "") : "";
    document.getElementById("maFAdresse").value = m ? (m.adresse || "") : "";
    document.getElementById("maFGeb").value = m ? (m.geburtsdatum || "") : "";
    document.getElementById("maFTaetig").value = (m && m.taetigkeit) ? m.taetigkeit : "Mietwagenfahrer";
    document.getElementById("maFAktiv").checked = m ? !!m.aktiv : true;
    var vh = document.getElementById("maVertragHinweis");
    if (vh) vh.textContent = "";
    document.getElementById("maErr").textContent = "";
    firmenAuswahlImFormular(m);
    document.getElementById("maModal").style.display = "flex";
    document.getElementById("maFName").focus();
  }
  function closeModal() { document.getElementById("maModal").style.display = "none"; }

  /* ── Aktions-Menü (drei Punkte) ── */
  function menuSchliessen() {
    var alt = document.getElementById("maMenu");
    if (alt) alt.remove();
  }

  function menuOeffnen(knopf, m) {
    menuSchliessen();
    var menu = document.createElement("div");
    menu.id = "maMenu";
    menu.className = "ma-menu";
    var punkte = [
      { text: "Bearbeiten", fn: function () { openModal(m); } },
      { text: "Arbeitsvertrag erzeugen", fn: function () { dokumentErzeugen(m, "arbeitsvertrag"); } },
      { text: "Kündigung erzeugen", fn: function () { dokumentErzeugen(m, "kuendigung"); } },
      { text: "Aufhebungsvertrag erzeugen", fn: function () { dokumentErzeugen(m, "aufhebung"); } }
    ];
    // Selbst angelegte Vorlagen aus dem Admin-Panel als zusätzliche Menüpunkte
    (VORLAGEN_LISTE || []).forEach(function (v) {
      if (CORE_KEYS.indexOf(v.key) !== -1) return;
      punkte.push({ text: v.titel + " erzeugen", fn: function () { customDokument(m, v.key); } });
    });
    punkte.push({ text: "Löschen", fn: function () { del(m); }, rot: true });
    punkte.forEach(function (p) {
      var b = document.createElement("button");
      b.className = "ma-menu-item" + (p.rot ? " ma-menu-rot" : "");
      b.textContent = p.text;
      b.onclick = function (e) { e.stopPropagation(); menuSchliessen(); p.fn(); };
      menu.appendChild(b);
    });
    document.body.appendChild(menu);

    // Unter dem Knopf ausrichten, notfalls darüber
    var r = knopf.getBoundingClientRect();
    var h = menu.offsetHeight || 200;
    var oben = (r.bottom + h + 8 > window.innerHeight) ? (r.top - h - 6) : (r.bottom + 6);
    menu.style.top = Math.max(8, oben) + "px";
    menu.style.left = Math.max(8, r.right - menu.offsetWidth) + "px";
  }

  // Klick daneben oder Escape schließt das Menü
  document.addEventListener("click", menuSchliessen);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") menuSchliessen(); });
  window.addEventListener("resize", menuSchliessen);

  /* ── Dialog "Arbeitsvertrag erzeugen" ──
     Hier stehen die Angaben, die nur den Vertrag betreffen. */
  function vertragDialog(m) {
    var alt = document.getElementById("maVertragModal");
    if (alt) alt.remove();
    var modal = document.createElement("div");
    modal.id = "maVertragModal";
    modal.className = "ma-modal";
    modal.style.display = "flex";
    modal.innerHTML =
      '<div class="ma-modal-backdrop" id="maVModalBackdrop"></div>'
      + '<div class="ma-modal-card">'
      + '<div class="ma-modal-title">Arbeitsvertrag: ' + esc(m.name) + '</div>'
      + '<div class="ma-vertrag-sub">Diese Angaben gelten für den Vertrag und werden mit gespeichert.</div>'
      + '<label>Vertragsart</label>'
      + '<select id="maVArt">'
      +   '<option value="">– bitte wählen –</option>'
      +   '<option value="minijob">Minijob (geringfügig)</option>'
      +   '<option value="teilzeit">Teilzeit</option>'
      +   '<option value="vollzeit">Vollzeit</option>'
      + '</select>'
      + '<div class="ma-modal-row">'
      +   '<div><label>Stundenlohn (€)</label><input type="number" id="maVLohn" step="0.01" placeholder="13.00"></div>'
      +   '<div><label>Stunden / Woche</label><input type="number" id="maVStd" step="0.5" placeholder="40"></div>'
      + '</div>'
      + '<div class="ma-modal-row">'
      +   '<div><label>Eintritt</label><input type="date" id="maVEintritt"></div>'
      +   '<div><label>Befristet bis <span class="opt">(leer = unbefristet)</span></label>'
      +     '<input type="date" id="maVBefristet"></div>'
      + '</div>'
      + '<div class="ma-vertrag-hinweis" id="maVHinweis"></div>'
      + '<div class="ma-modal-actions">'
      +   '<button type="button" class="ma-btn-ghost" id="maVCancel">Abbrechen</button>'
      +   '<button type="button" class="ma-btn-primary" id="maVGo">Vertrag erzeugen</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(modal);

    document.getElementById("maVArt").value = m.vertragsart || "";
    document.getElementById("maVLohn").value = m.stundenlohn || "";
    document.getElementById("maVStd").value = m.wochenstunden || "";
    document.getElementById("maVEintritt").value = m.eintritt || "";
    document.getElementById("maVBefristet").value = m.befristet_bis || "";

    function zu() { modal.remove(); }
    document.getElementById("maVCancel").onclick = zu;
    document.getElementById("maVModalBackdrop").onclick = zu;
    document.getElementById("maVGo").onclick = function () {
      var hinweis = document.getElementById("maVHinweis");
      hinweis.className = "ma-vertrag-hinweis";
      var art = document.getElementById("maVArt").value;
      var eintritt = document.getElementById("maVEintritt").value;
      var fehlt = [];
      if (!art) fehlt.push("Vertragsart");
      if (!eintritt) fehlt.push("Eintritt");
      if (fehlt.length) {
        hinweis.className = "ma-vertrag-hinweis err";
        hinweis.textContent = "Bitte noch angeben: " + fehlt.join(", ") + ".";
        return;
      }
      var daten = {
        name: m.name, adresse: m.adresse, geburtsdatum: m.geburtsdatum,
        vertragsart: art, eintritt: eintritt,
        befristet_bis: document.getElementById("maVBefristet").value || "",
        stundenlohn: parseFloat(document.getElementById("maVLohn").value) || 0,
        wochenstunden: parseFloat(document.getElementById("maVStd").value) || 0
      };
      hinweis.textContent = "Wird gespeichert…";
      // Vertragsdaten am Mitarbeiter sichern, damit sie beim naechsten Mal stehen
      var payload = {
        name: m.name, personalnummer: m.personalnummer || "",
        stundenlohn: daten.stundenlohn, wochenstunden: daten.wochenstunden,
        adresse: m.adresse || "", geburtsdatum: m.geburtsdatum || "",
        eintritt: daten.eintritt, vertragsart: daten.vertragsart,
        befristet_bis: daten.befristet_bis, aktiv: m.aktiv
      };
      fetch("/mitarbeiter/" + m.id, {
        method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload)
      }).catch(function () {}).then(function () {
        return fetch("/me/firmenprofil", { headers: authHeaders() })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      }).then(function (firma) {
        dokumentAnzeigen(daten, firma || {}, 'arbeitsvertrag');
        zu();
        load();
      });
    };
  }

  /* ── Dialog für Kündigung und Aufhebungsvertrag ── */
  function beendigungDialog(m, art) {
    var titel = (art === "kuendigung") ? "Kündigung" : "Aufhebungsvertrag";
    var alt = document.getElementById("maBeendModal");
    if (alt) alt.remove();
    var modal = document.createElement("div");
    modal.id = "maBeendModal";
    modal.className = "ma-modal";
    modal.style.display = "flex";
    modal.innerHTML =
      '<div class="ma-modal-backdrop" id="maBBackdrop"></div>'
      + '<div class="ma-modal-card">'
      + '<div class="ma-modal-title">' + titel + ': ' + esc(m.name) + '</div>'
      + '<div class="ma-vertrag-sub">Zu welchem Datum endet das Arbeitsverhältnis?</div>'
      + '<label>Beendigung zum</label><input type="date" id="maBDatum">'
      + (art === "aufhebung"
          ? '<label>Arbeitsvertrag vom <span class="opt">(steht im Aufhebungsvertrag)</span></label>'
            + '<input type="date" id="maBVertragVom">'
          : '')
      + '<div class="ma-vertrag-hinweis" id="maBHinweis"></div>'
      + '<div class="ma-modal-actions">'
      +   '<button type="button" class="ma-btn-ghost" id="maBCancel">Abbrechen</button>'
      +   '<button type="button" class="ma-btn-primary" id="maBGo">' + titel + ' erzeugen</button>'
      + '</div></div>';
    document.body.appendChild(modal);
    if (m.befristet_bis) document.getElementById("maBDatum").value = m.befristet_bis;
    var vv = document.getElementById("maBVertragVom");
    if (vv && m.eintritt) vv.value = m.eintritt;

    function zu() { modal.remove(); }
    document.getElementById("maBCancel").onclick = zu;
    document.getElementById("maBBackdrop").onclick = zu;
    document.getElementById("maBGo").onclick = function () {
      var datum = document.getElementById("maBDatum").value;
      var hinweis = document.getElementById("maBHinweis");
      if (!datum) {
        hinweis.className = "ma-vertrag-hinweis err";
        hinweis.textContent = "Bitte ein Beendigungsdatum angeben.";
        return;
      }
      var daten = {};
      for (var k in m) daten[k] = m[k];
      daten.beendigung_zum = datum;
      if (vv && vv.value) daten.vertrag_vom = vv.value;
      fetch("/me/firmenprofil", { headers: authHeaders() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (firma) { dokumentAnzeigen(daten, firma || {}, art); zu(); });
    };
  }

  /* Dokument aus der Tabellenzeile erzeugen (Vertrag, Kündigung, Aufhebung). */
  /* Selbst angelegte Vorlagen (aus dem Admin-Panel) - werden einmal geladen. */
  var CORE_KEYS = ["vollzeit", "teilzeit", "minijob", "kuendigung", "aufhebung"];
  var VORLAGEN_LISTE = null;
  function vorlagenListe() {
    return fetch("/vorlagen", { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { VORLAGEN_LISTE = (d && d.vorlagen) || []; })
      .catch(function () { VORLAGEN_LISTE = VORLAGEN_LISTE || []; });
  }

  // Firmenlogo für die Word-Ausgabe der Dokumente (das PDF bekommt es serverseitig).
  var MA_LOGO = null;
  function maLogoLaden() {
    fetch("/me/logo", { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { MA_LOGO = (d && d.logo) ? d.logo : ""; })
      .catch(function () {});
  }

  /* Ein Dokument aus einer selbst angelegten Vorlage erzeugen. */
  function customDokument(m, key) {
    var fehlt = [];
    if (!m.name) fehlt.push("Name");
    if (!m.adresse) fehlt.push("Anschrift");
    if (fehlt.length) {
      fcInfo("Angaben fehlen", "Für dieses Dokument fehlen noch: " + fehlt.join(", ")
        + ". Bitte zuerst über \"Bearbeiten\" ergänzen.", "warn", function () { openModal(m); });
      return;
    }
    fetch("/me/firmenprofil", { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (firma) { dokumentAnzeigen(m, firma || {}, key); });
  }

  function dokumentErzeugen(m, art) {
    var fehlt = [];
    if (!m.name) fehlt.push("Name");
    if (!m.adresse) fehlt.push("Anschrift");
    if (fehlt.length) {
      fcInfo("Angaben fehlen", "Für dieses Dokument fehlen noch: " + fehlt.join(", ")
        + ". Bitte zuerst über \"Bearbeiten\" ergänzen.", "warn", function () { openModal(m); });
      return;
    }
    if (art === "arbeitsvertrag") { vertragDialog(m); return; }
    beendigungDialog(m, art);
  }

  /* Dokument aus der hinterlegten Vorlage erzeugen.
     Die Vorlagen pflegt der Superadmin im Admin-Panel. */
  function dokumentAnzeigen(m, firma, art) {
    var key = (art === "arbeitsvertrag") ? (m.vertragsart || "vollzeit") : art;
    fetch("/vorlagen/" + key, { headers: authHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error("Für diese Art ist noch keine Vorlage hinterlegt.");
        return r.json();
      })
      .then(function (v) { textAnzeigen(fuellen(v.text || "", m, firma), v.titel || "Dokument"); })
      .catch(function (e) { fcInfo("Fehler", e.message, "danger"); });
  }

  /* Platzhalter ersetzen */
  function fuellen(text, m, firma) {
    function d(iso) {
      if (!iso) return "________";
      var t = String(iso).split("-");
      return t.length === 3 ? (t[2] + "." + t[1] + "." + t[0]) : iso;
    }
    function eur(v) { return (Number(v) || 0).toFixed(2).replace(".", ",") + " €"; }
    function teile(anschrift) {
      // "Musterweg 3, 41472 Neuss" -> Straße / PLZ Ort
      var t = String(anschrift || "").split(",");
      return { strasse: (t[0] || "").trim(), ort: t.slice(1).join(",").trim() };
    }
    var ma = teile(m.adresse);
    var fa = teile(firma.adresse || firma.betriebssitz);
    var taetigkeit = m.taetigkeit || "Mietwagenfahrer";
    var heute = new Date();
    var werte = {
      firma_name: firma.name || "", firma_strasse: fa.strasse, firma_plz_ort: fa.ort,
      firma_anschrift: firma.adresse || firma.betriebssitz || "",
      ma_name: m.name || "", ma_anrede: "Herr/Frau",
      ma_strasse: ma.strasse, ma_plz_ort: ma.ort,
      ma_anschrift: m.adresse || "",
      geburtsdatum: d(m.geburtsdatum),
      eintritt: d(m.eintritt),
      befristung: m.befristet_bis ? ("befristet bis " + d(m.befristet_bis)) : "unbefristet",
      beendigung_zum: d(m.beendigung_zum || m.befristet_bis || ""),
      vertrag_vom: d(m.vertrag_vom || m.eintritt),
      taetigkeit: taetigkeit,
      wochenstunden: (Number(m.wochenstunden) || 0),
      arbeitstage: 5,
      urlaubstage: Math.max(20, Math.round((Number(m.wochenstunden) || 40) / 8 * 4)),
      stundenlohn: eur(m.stundenlohn),
      ort: fa.ort ? fa.ort.replace(/^[0-9\s]+/, "") : "",
      datum_heute: ("0" + heute.getDate()).slice(-2) + "." +
                   ("0" + (heute.getMonth() + 1)).slice(-2) + "." + heute.getFullYear(),
      // Lücke zum handschriftlichen Ausfüllen im Fließtext
      luecke: "__________"
    };
    return text.replace(/\{\{(\w+)\}\}/g, function (ganz, name) {
      // Unbekannter Platzhalter (z.B. Tippfehler) bleibt sichtbar stehen.
      if (werte[name] === undefined) return ganz;
      // Bekannter, aber leerer Wert -> Ausfülllinie statt sichtbarem {{...}}.
      var wert = String(werte[name]);
      return wert !== "" ? wert : "__________";
    });
  }

  /* Text als Druckansicht zeigen */
  /* Dokument als PDF anzeigen. Der Server setzt den Text in ein PDF um,
     der Browser zeigt es in seiner PDF-Ansicht - dort kann man drucken
     und speichern. Zusätzlich gibt es einen Word-Download. */
  function textAnzeigen(text, titel) {
    var w = window.open("", "_blank");
    if (!w) { fcInfo("Fenster blockiert", "Bitte Pop-ups für diese Seite erlauben und erneut versuchen.", "warn"); return; }
    w.document.write('<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>'
      + titel + '</title><style>body{font-family:system-ui,sans-serif;background:#1a1a1a;color:#ccc;'
      + 'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style></head>'
      + '<body>Dokument wird erstellt…</body></html>');
    w.document.close();

    fetch("/dokument/pdf", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ titel: titel, text: text })
    }).then(function (r) {
      if (!r.ok) throw new Error("PDF konnte nicht erstellt werden.");
      return r.blob();
    }).then(function (blob) {
      var pdfUrl = URL.createObjectURL(blob);
      // PDF im Fenster anzeigen, darüber eine schmale Leiste zum Speichern
      w.document.open();
      w.document.write(
        '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>' + titel + '</title>'
        + '<style>html,body{margin:0;height:100%;font-family:system-ui,sans-serif;background:#2a2a2a}'
        + '.leiste{height:46px;display:flex;align-items:center;gap:10px;padding:0 14px;'
        +   'background:#141414;border-bottom:1px solid #333;color:#eee;font-size:13px}'
        + '.leiste b{flex:1;font-weight:600}'
        + '.leiste button{padding:7px 14px;font-size:12.5px;cursor:pointer;border-radius:7px;'
        +   'border:1px solid #444;background:#1e1e1e;color:#eee}'
        + '.leiste button:hover{border-color:#10b981;color:#10b981}'
        + 'iframe{width:100%;height:calc(100% - 46px);border:0}</style></head><body>'
        + '<div class="leiste"><b>' + titel + '</b>'
        +   '<button id="pdfBtn">PDF speichern</button>'
        +   '<button id="wordBtn">Als Word speichern</button></div>'
        + '<iframe src="' + pdfUrl + '"></iframe></body></html>'
      );
      w.document.close();

      var name = titel.replace(/[^\wÄÖÜäöüß -]/g, "").trim() || "Dokument";
      function laden(datenUrl, endung) {
        var a = w.document.createElement("a");
        a.href = datenUrl;
        a.download = name + endung;
        w.document.body.appendChild(a);
        a.click();
        a.remove();
      }
      var setzen = function () {
        var p = w.document.getElementById("pdfBtn");
        var wo = w.document.getElementById("wordBtn");
        if (!p || !wo) { setTimeout(setzen, 50); return; }
        p.onclick = function () { laden(pdfUrl, ".pdf"); };
        wo.onclick = function () {
          function esc2(t){var d2=document.createElement("div");d2.textContent=t;return d2.innerHTML;}
          // Mehrere Leerzeichen erhalten (Word verdichtet sie sonst zu einem).
          function raum(s){return s.replace(/ {2,}/g,function(m){return m.replace(/ /g,"&nbsp;");});}
          var abs = text.split(/\n\s*\n/).map(function (a) {
            var z = a.trim();
            if (!z) return "";
            if (/^(§ ?\d+|\d+\.|Anlage \d)/.test(z) && z.length < 90) return "<h2>" + raum(esc2(z)) + "</h2>";
            return "<p>" + raum(esc2(z)).replace(/\n/g, "<br>") + "</p>";
          }).join("");
          var kopf = '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
            + 'xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'
            + '<head><meta charset="utf-8"><title>' + name + '</title>'
            + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->'
            + '<style>@page{size:21cm 29.7cm;margin:2cm}'
            + 'body{font-family:Georgia,serif;font-size:11pt;line-height:1.6}'
            + 'h2{font-size:11.5pt;margin:18px 0 6px}p{margin:8px 0;text-align:justify}</style></head>';
          var mLogo = MA_LOGO ? /^data:(image\/[a-z]+);base64,(.+)$/i.exec(MA_LOGO) : null;
          if (mLogo) {
            // Word zeigt base64-Bilder in HTML oft NICHT. Deshalb MHTML (multipart):
            // das Logo als eigener Teil, per Content-Location referenziert -> erscheint zuverl\u00e4ssig.
            var endung = /png/i.test(mLogo[1]) ? "png" : "jpg";
            var bildOrt = "file:///C:/fc/logo." + endung;
            var htmlOrt = "file:///C:/fc/doc.htm";
            var body = kopf + '<body><div style="text-align:right;margin-bottom:14px">'
              + '<img src="' + bildOrt + '" style="height:110px"></div>' + abs + '</body></html>';
            var b64 = mLogo[2].replace(/\s+/g, "").replace(/(.{76})/g, "$1\r\n");
            var grenze = "----=_FCPart_Logo";
            var mhtml = 'MIME-Version: 1.0\r\n'
              + 'Content-Type: multipart/related; boundary="' + grenze + '"\r\n\r\n'
              + '--' + grenze + '\r\n'
              + 'Content-Type: text/html; charset="utf-8"\r\n'
              + 'Content-Location: ' + htmlOrt + '\r\n\r\n'
              + body + '\r\n\r\n'
              + '--' + grenze + '\r\n'
              + 'Content-Type: ' + mLogo[1] + '\r\n'
              + 'Content-Transfer-Encoding: base64\r\n'
              + 'Content-Location: ' + bildOrt + '\r\n\r\n'
              + b64 + '\r\n'
              + '--' + grenze + '--';
            var bm = new Blob([mhtml], { type: "application/msword" });
            var um = URL.createObjectURL(bm);
            laden(um, ".doc");
            setTimeout(function () { URL.revokeObjectURL(um); }, 1500);
          } else {
            var inhalt = kopf + '<body>' + abs + '</body></html>';
            var b = new Blob(["\ufeff", inhalt], { type: "application/msword" });
            var u = URL.createObjectURL(b);
            laden(u, ".doc");
            setTimeout(function () { URL.revokeObjectURL(u); }, 1500);
          }
        };
      };
      setzen();
    }).catch(function (e) {
      w.document.open();
      w.document.write('<body style="font-family:system-ui;padding:40px">' + e.message + '</body>');
      w.document.close();
    });
  }

  /* Bei mehreren Betrieben kann im Formular gewaehlt werden, zu wem der
     Mitarbeiter gehoert. Bei nur einem Betrieb bleibt das Feld verborgen. */
  function firmenAuswahlImFormular(m) {
    var wrap = document.getElementById("maFFirmaWrap");
    var sel = document.getElementById("maFFirma");
    if (!wrap || !sel) return;
    if (!IST_ADMIN || FIRMEN.length < 2) { wrap.style.display = "none"; return; }
    wrap.style.display = "";
    sel.innerHTML = FIRMEN.map(function (f) {
      return '<option value="' + f.id + '">' + esc(f.name) + '</option>';
    }).join("");
    // Bearbeiten: Betrieb des Mitarbeiters, sonst der gerade gewaehlte
    var ziel = (m && m.firma_id) ? m.firma_id : (AKTUELLE_FIRMA || FIRMEN[0].id);
    sel.value = String(ziel);
    // Beim Bearbeiten nicht verschieben - das waere ein Umzug mit Nebenwirkungen
    sel.disabled = !!m;
    var hinweis = wrap.querySelector(".ma-feld-hinweis");
    if (hinweis) {
      hinweis.textContent = m
        ? "Der Betrieb kann nachträglich nicht gewechselt werden."
        : "Der Mitarbeiter gehört zu diesem Betrieb.";
    }
  }

  function fmtEuro(n) { return (Number(n) || 0).toFixed(2).replace(".", ",") + " €"; }

  function render(list) {
    var body = document.getElementById("maTableBody");
    var empty = document.getElementById("maEmpty");
    body.innerHTML = "";
    if (!list || !list.length) { empty.style.display = "block"; return; }
    empty.style.display = "none";
    list.forEach(function (m) {
      var tr = document.createElement("tr");
      if (!m.aktiv) tr.className = "ma-inactive";
      tr.innerHTML =
        '<td class="ma-name">' + esc(m.name) + '</td>'
        + '<td>' + esc(m.personalnummer || "–") + '</td>'
        + '<td class="ma-num">' + fmtEuro(m.stundenlohn) + '</td>'
        + '<td class="ma-num">' + (m.wochenstunden || 0) + ' h</td>'
        + '<td>' + (m.aktiv ? '<span class="ma-badge ma-badge-on">aktiv</span>' : '<span class="ma-badge">inaktiv</span>') + '</td>'
        + '<td class="ma-actions">'
        +   '<button class="ma-menu-btn" title="Aktionen" aria-label="Aktionen">'
        +     '<span></span><span></span><span></span>'
        +   '</button>'
        + '</td>';
      tr.querySelector(".ma-menu-btn").onclick = function (e) {
        e.stopPropagation();
        menuOeffnen(this, m);
      };
      body.appendChild(tr);
    });
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  function load() {
    var url = "/mitarbeiter" + (AKTUELLE_FIRMA ? ("?firma_id=" + AKTUELLE_FIRMA) : "");
    fetch(url, { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (d) { render(d.mitarbeiter || []); })
      .catch(function () { render([]); });
  }

  function save() {
    var name = document.getElementById("maFName").value.trim();
    var err = document.getElementById("maErr");
    if (!name) { err.textContent = "Name ist erforderlich."; return; }
    var payload = {
      name: name,
      personalnummer: document.getElementById("maFPn").value.trim(),
      adresse: document.getElementById("maFAdresse").value.trim(),
      geburtsdatum: document.getElementById("maFGeb").value || "",
      taetigkeit: document.getElementById("maFTaetig").value || "",
      aktiv: document.getElementById("maFAktiv").checked
    };
    var url = editId ? "/mitarbeiter/" + editId : "/mitarbeiter";
    var method = editId ? "PUT" : "POST";
    var wahl = document.getElementById("maFFirma");
    if (IST_ADMIN) {
      if (wahl && wahl.value && !wahl.disabled) payload.firma_id = Number(wahl.value);
      else if (AKTUELLE_FIRMA) payload.firma_id = AKTUELLE_FIRMA;
    }
    if (typeof window.fcMitarbeiterGeaendert === "function") window.fcMitarbeiterGeaendert();
    fetch(url, { method: method, headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload) })
      .then(function (r) {
        if (r.ok) { closeModal(); load(); return; }
        return r.json().then(function (e) { err.textContent = e.detail || "Fehler beim Speichern."; });
      })
      .catch(function () { err.textContent = "Verbindungsfehler."; });
  }

  function del(m) {
    fcFrage("Mitarbeiter löschen", "„" + m.name + "\" wirklich löschen? Das lässt sich nicht rückgängig machen.",
      "danger", "Löschen", function () {
      if (typeof window.fcMitarbeiterGeaendert === "function") window.fcMitarbeiterGeaendert();
      fetch("/mitarbeiter/" + m.id, { method: "DELETE", headers: authHeaders() })
        .then(function () { load(); })
        .catch(function () {});
    });
  }

  function firmenLaden() {
    return fetch("/firmen-auswahl", { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        IST_ADMIN = !!(d && d.admin);
        FIRMEN = (d && d.firmen) || [];
        var box = document.getElementById("maFirmenWahl");
        var sel = document.getElementById("maFirmaSelect");
        if (!box || !sel) return;
        if (!IST_ADMIN || FIRMEN.length < 2) { box.style.display = "none"; return; }
        box.style.display = "";
        sel.innerHTML = FIRMEN.map(function (f) {
          return '<option value="' + f.id + '">' + esc(f.name) + '</option>';
        }).join("");
        if (!AKTUELLE_FIRMA) AKTUELLE_FIRMA = FIRMEN[0].id;
        sel.value = String(AKTUELLE_FIRMA);
        sel.onchange = function () { AKTUELLE_FIRMA = Number(sel.value); load(); };
      })
      .catch(function () {});
  }

  function showPage() {
    if (typeof window.alleSeitenAus === "function") window.alleSeitenAus();
    // auch die vom Shell nicht erfassten Seiten sicher ausblenden
    ["startPage","zeitnachweisPage","buchPage","lohnPage","fahrtenbuchPage","settingsPage","firmenPage","teamPage","vorgaengePage"].forEach(function (id) {
      var e = document.getElementById(id); if (e) e.style.display = "none";
    });
    document.getElementById("mitarbeiterPage").style.display = "block";
    firmenLaden().then(load);
    vorlagenListe();
    maLogoLaden();
    window.scrollTo({ top: 0 });
  }

  window.openMitarbeiterPage = showPage;   // von aussen aufrufbar

  function wireEvents() {
    document.getElementById("maAddBtn").onclick = function () { openModal(null); };
    document.getElementById("maSave").onclick = save;
    document.getElementById("maCancel").onclick = closeModal;
    document.getElementById("maModalBackdrop").onclick = closeModal;
    document.getElementById("maFName").addEventListener("keydown", function (e) {
      if (e.key === "Enter") save();
    });
  }

  /* ── Seitenleisten-Button einfuegen (nach dem Laden der Shell) ── */
  function addSidebarButton() {
    var side = document.querySelector(".fc-shell-side, aside.fc-side, .fc-side, [aria-label='Module']");
    if (!side) { return false; }
    if (side.querySelector('[data-fc-target="mitarbeiter"]')) return true;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fc-side-btn";
    btn.dataset.fcTarget = "mitarbeiter";
    btn.innerHTML = ICON + "<span>Mitarbeiter</span>";
    btn.onclick = showPage;
    // Erst einsortieren, wenn die Seitenleiste fertig aufgebaut ist -
    // sonst landen die Module hinter der Verwaltung.
    var kontoLabel = [].slice.call(side.querySelectorAll(".fc-side-label"))
      .filter(function(l){return l.textContent==="Konto";})[0];
    if (!kontoLabel) return false;      // noch nicht fertig -> spaeter erneut versuchen
    var anker = kontoLabel;
    if (!side.querySelector(".fc-side-label-verwaltung")) {
      var lbl = document.createElement("div");
      lbl.className = "fc-side-label fc-side-label-verwaltung";
      lbl.textContent = "Verwaltung";
      if (anker) side.insertBefore(lbl, anker);
      else side.appendChild(lbl);
    }
    if (anker) side.insertBefore(btn, anker);
    else side.appendChild(btn);
    return true;
  }

  function init() {
    buildPage();
    wireEvents();
    // Seitenleiste wird evtl. erst nach license-status gebaut -> mehrfach versuchen
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (addSidebarButton() || tries > 100) clearInterval(iv);
    }, 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
