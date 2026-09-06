/* Vorgänge: Übergaben zwischen Buchhaltung und Disposition.
   Die Buchhaltung sagt, was zu tun ist ("Fahrer A – 534,60 € abkassieren"),
   die Disposition erledigt es und meldet zurück: komplett oder nicht. */
(function () {
  if (new URLSearchParams(location.search).get("classic") === "1") return;

  var token = null;
  try { token = localStorage.getItem("fc_token") || localStorage.getItem("token"); } catch (e) {}

  function kopf(extra) {
    var h = extra || {};
    if (token) h["Authorization"] = "Bearer " + token;
    var m = (typeof window.fcAktiverMandant === "function") ? window.fcAktiverMandant() : null;
    if (m) h["X-Mandant"] = String(m);
    return h;
  }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  function fcInfo(titel, text, art) {
    if (typeof window.fcAlert === "function") {
      window.fcAlert({ title: titel, sub: text, kind: art || "warn", okText: "OK", onOk: function () {} });
    } else { alert((titel ? titel + "\n\n" : "") + text); }
  }

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

  var ZUSTAND = { offen: [], erledigt: [], arten: [], darf_bearbeiten: false };
  var FAHRER = [];
  var OFFENES_DETAIL = null;

  /* ── Seite ─────────────────────────────────────────────────────── */
  function buildPage() {
    if (document.getElementById("vorgaengePage")) return;
    var page = document.createElement("div");
    page.id = "vorgaengePage";
    page.className = "container vg-page";
    page.style.display = "none";
    page.innerHTML =
      '<div class="vg-head">'
      +   '<div><h2>Vorgänge</h2>'
      +     '<p>Was zu tun ist – und was zurückgemeldet wurde.</p></div>'
      +   '<div class="vg-kopf-rechts">'
      +     '<button class="vg-btn vg-btn-green" id="vgWocheBtn" type="button">Woche anlegen</button>'
      +     '<div class="vg-zaehler" id="vgZaehler"></div>'
      +   '</div>'
      + '</div>'
      + '<div class="vg-reiter">'
      +   '<button class="vg-reiter-btn on" data-tab="liste" type="button">Liste</button>'
      +   '<button class="vg-reiter-btn" data-tab="woche" type="button">Wochenübersicht</button>'
      +   '<button class="vg-reiter-btn" data-tab="konto" type="button">Fahrerkonten</button>'
      + '</div>'
      /* ── Wochenübersicht ── */
      + '<div id="vgWocheAnsicht" style="display:none">'
      +   '<div class="vg-wochenkopf">'
      +     '<button class="vg-mini" id="vgKwZurueck" type="button">◀</button>'
      +     '<span class="vg-kw" id="vgKwText"></span>'
      +     '<button class="vg-mini" id="vgKwVor" type="button">▶</button>'
      +     '<span class="vg-kw-datum" id="vgKwDatum"></span>'
      +   '</div>'
      +   '<div class="vg-table-wrap">'
      +     '<table class="vg-table"><thead><tr>'
      +       '<th>Fahrer</th><th class="r">Soll</th><th class="r">Erhalten</th>'
      +       '<th class="r">Differenz</th><th>Status</th><th></th>'
      +     '</tr></thead><tbody id="vgWocheBody"></tbody>'
      +     '<tfoot id="vgWocheFuss"></tfoot></table>'
      +   '</div>'
      + '</div>'
      /* ── Fahrerkonten ── */
      + '<div id="vgKontoAnsicht" style="display:none">'
      +   '<div id="vgKontoUebersicht">'
      +     '<div class="vg-kacheln" id="vgKontoKacheln"></div>'
      +     '<div class="vg-table-wrap">'
      +       '<table class="vg-table"><thead><tr>'
      +         '<th>Fahrer</th><th class="r">Offen</th><th class="r">Gestellt</th>'
      +         '<th class="r">Erhalten</th><th class="r">Abgeschrieben</th>'
      +         '<th>Letzte Zahlung</th><th></th>'
      +       '</tr></thead><tbody id="vgKontoBody"></tbody>'
      +       '<tfoot id="vgKontoFuss"></tfoot></table>'
      +     '</div>'
      +   '</div>'
      +   '<div id="vgKontoDetail" style="display:none">'
      +     '<div class="vg-kontokopf">'
      +       '<button class="vg-mini" id="vgKontoZurueck" type="button">◀ Alle Fahrer</button>'
      +       '<h3 id="vgKontoName"></h3>'
      +     '</div>'
      +     '<div class="vg-kacheln" id="vgKontoDetailKacheln"></div>'
      +     '<div class="vg-table-wrap">'
      +       '<table class="vg-table"><thead><tr>'
      +         '<th>Vorgang</th><th class="r">Gefordert</th><th class="r">Erhalten</th>'
      +         '<th class="r">Fehlt</th><th class="r">Stand danach</th><th>Status</th><th></th>'
      +       '</tr></thead><tbody id="vgKontoVerlauf"></tbody></table>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      /* ── Liste ── */
      + '<div class="vg-spalten" id="vgListeAnsicht">'
      +   '<div class="vg-links">'
      +     '<div class="vg-sec">Offen</div>'
      +     '<div id="vgOffen" class="vg-liste"></div>'
      +     '<div class="vg-sec vg-sec-klein">Erledigt'
      +       '<span class="vg-treffer" id="vgTreffer"></span></div>'
      +     '<div class="vg-filter">'
      +       '<input id="vgSuche" type="search" placeholder="Suchen: Fahrer, Woche, Name …">'
      +       '<select id="vgFilterArt"><option value="">Alle Arten</option></select>'
      +       '<input id="vgVon" type="date" title="von">'
      +       '<input id="vgBis" type="date" title="bis">'
      +       '<button class="vg-mini" id="vgFilterWeg" type="button">Zurücksetzen</button>'
      +     '</div>'
      +     '<div id="vgErledigt" class="vg-liste vg-liste-blass"></div>'
      +   '</div>'
      +   '<div class="vg-rechts" id="vgNeuKarte">'
      +     '<div class="vg-card">'
      +       '<div class="vg-card-title">Neuer Vorgang</div>'
      +       '<div class="vg-felder">'
      +         '<div><label for="vgArt">Art</label><select id="vgArt"></select></div>'
      +         '<div id="vgFahrerFeld"><label for="vgFahrer">Fahrer</label>'
      +           '<select id="vgFahrer"></select></div>'
      +         '<div id="vgTitelFeld" style="display:none"><label for="vgTitel">Was ist zu tun?</label>'
      +           '<input id="vgTitel" type="text" placeholder="z.B. Tankbelege sortieren"></div>'
      +         '<div><label for="vgBetrag">Betrag</label>'
      +           '<input id="vgBetrag" type="text" inputmode="decimal" placeholder="534,60"></div>'
      +         '<div><label for="vgFaellig">Fällig am</label>'
      +           '<input id="vgFaellig" type="date"></div>'
      +         '<div><label for="vgHinweis">Hinweis (optional)</label>'
      +           '<input id="vgHinweis" type="text" placeholder="z.B. Woche 36"></div>'
      +       '</div>'
      +       '<button class="vg-btn vg-btn-green" id="vgAnlegen">Vorgang anlegen</button>'
      +       '<div class="vg-msg" id="vgMsg"></div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    var anker = document.getElementById("startPage");
    if (anker && anker.parentNode) anker.parentNode.appendChild(page);
    else document.body.appendChild(page);
    baueDialoge();
  }

  function baueDialoge() {
    if (document.getElementById("vgBackdrop")) return;
    var d = document.createElement("div");
    d.innerHTML =
      '<div class="vg-backdrop" id="vgBackdrop" style="display:none"></div>'
      /* Abhaken */
      + '<div class="vg-modal" id="vgHakenModal" style="display:none" role="dialog" aria-modal="true">'
      +   '<h3 id="vgHakenTitel">Abhaken</h3>'
      +   '<p class="vg-modal-sub" id="vgHakenSub"></p>'
      +   '<div class="vg-wahl">'
      +     '<button class="vg-wahl-btn on" data-erg="komplett" type="button">Komplett</button>'
      +     '<button class="vg-wahl-btn" data-erg="teilweise" type="button">Nicht komplett</button>'
      +   '</div>'
      +   '<div class="vg-felder" style="margin-top:14px">'
      +     '<div id="vgHakenBetragFeld"><label for="vgHakenBetrag">Tatsächlich erhalten</label>'
      +       '<input id="vgHakenBetrag" type="text" inputmode="decimal" placeholder="500,00"></div>'
      +     '<div><label for="vgHakenText">Hinweis <span id="vgHakenPflicht"></span></label>'
      +       '<input id="vgHakenText" type="text" placeholder="z.B. Rest nächste Woche"></div>'
      +   '</div>'
      +   '<label class="vg-haken-rest" id="vgRestZeile" style="display:none">'
      +     '<input type="checkbox" id="vgRestHaken" checked>'
      +     '<span>Fehlbetrag <b id="vgRestBetrag"></b> als neuen Vorgang weiterführen</span>'
      +   '</label>'
      +   '<div class="vg-msg" id="vgHakenMsg"></div>'
      +   '<div class="vg-modal-foot">'
      +     '<button class="vg-btn" id="vgHakenAbbruch" type="button">Abbrechen</button>'
      +     '<button class="vg-btn vg-btn-green" id="vgHakenOk" type="button">Abhaken</button>'
      +   '</div>'
      + '</div>'
      /* Wochen-Stapel */
      + '<div class="vg-modal vg-modal-breit" id="vgStapelModal" style="display:none" role="dialog" aria-modal="true">'
      +   '<h3>Woche anlegen</h3>'
      +   '<p class="vg-modal-sub" id="vgStapelSub"></p>'
      +   '<div class="vg-quelle">'
      +     '<label for="vgStapelMonat">Beträge aus Lohn-Monat</label>'
      +     '<select id="vgStapelMonat"></select>'
      +     '<label for="vgStapelWoche">Woche</label>'
      +     '<select id="vgStapelWoche"></select>'
      +   '</div>'
      +   '<div class="vg-alt" id="vgStapelAlt" style="display:none"></div>'
      +   '<div class="vg-hilfe">'
      +     '<button class="vg-link" id="vgWarumBtn" type="button">Warum steht hier nichts?</button>'
      +     '<div class="vg-diagnose" id="vgDiagnose" style="display:none"></div>'
      +   '</div>'
      +   '<div class="vg-table-wrap">'
      +     '<table class="vg-table"><thead><tr>'
      +       '<th>Fahrer</th><th class="r">Abzukassieren</th><th></th>'
      +     '</tr></thead><tbody id="vgStapelBody"></tbody></table>'
      +   '</div>'
      +   '<div class="vg-msg" id="vgStapelMsg"></div>'
      +   '<div class="vg-modal-foot">'
      +     '<button class="vg-btn" id="vgStapelAbbruch" type="button">Abbrechen</button>'
      +     '<button class="vg-btn vg-btn-green" id="vgStapelOk" type="button">Vorgänge anlegen</button>'
      +   '</div>'
      + '</div>'
      /* Bearbeiten */
      + '<div class="vg-modal" id="vgEditModal" style="display:none" role="dialog" aria-modal="true">'
      +   '<h3>Vorgang bearbeiten</h3>'
      +   '<p class="vg-modal-sub" id="vgEditSub"></p>'
      +   '<div class="vg-felder">'
      +     '<div><label for="vgEditTitel">Bezeichnung</label>'
      +       '<input id="vgEditTitel" type="text"></div>'
      +     '<div><label for="vgEditBetrag">Geforderter Betrag</label>'
      +       '<input id="vgEditBetrag" type="text" inputmode="decimal"></div>'
      +     '<div id="vgEditIstFeld" style="display:none"><label for="vgEditIst">Tatsächlich erhalten</label>'
      +       '<input id="vgEditIst" type="text" inputmode="decimal"></div>'
      +     '<div><label for="vgEditFaellig">Fällig am</label>'
      +       '<input id="vgEditFaellig" type="date"></div>'
      +     '<div><label for="vgEditGrund">Grund <span id="vgEditPflicht"></span></label>'
      +       '<input id="vgEditGrund" type="text" placeholder="z.B. Zählfehler in der Kasse"></div>'
      +   '</div>'
      +   '<div class="vg-msg" id="vgEditMsg"></div>'
      +   '<div class="vg-modal-foot">'
      +     '<button class="vg-btn vg-btn-rot" id="vgEditStorno" type="button">Stornieren</button>'
      +     '<span style="flex:1"></span>'
      +     '<button class="vg-btn" id="vgEditAbbruch" type="button">Abbrechen</button>'
      +     '<button class="vg-btn vg-btn-green" id="vgEditOk" type="button">Speichern</button>'
      +   '</div>'
      + '</div>'
      /* Verlauf */
      + '<div class="vg-modal vg-modal-breit" id="vgDetailModal" style="display:none" role="dialog" aria-modal="true">'
      +   '<h3 id="vgDetailTitel"></h3>'
      +   '<p class="vg-modal-sub" id="vgDetailSub"></p>'
      +   '<div class="vg-verlauf" id="vgVerlauf"></div>'
      +   '<div class="vg-felder" id="vgKommentarFeld">'
      +     '<div><label for="vgKommentar">Hinweis hinzufügen</label>'
      +       '<input id="vgKommentar" type="text" placeholder="kurze Notiz für die Kollegen"></div>'
      +   '</div>'
      +   '<div class="vg-modal-foot">'
      +     '<button class="vg-btn" id="vgDetailZu" type="button">Schließen</button>'
      +     '<button class="vg-btn" id="vgWiederOeffnen" type="button" style="display:none">Wieder öffnen</button>'
      +     '<button class="vg-btn vg-btn-green" id="vgKommentarOk" type="button">Hinweis speichern</button>'
      +   '</div>'
      + '</div>';
    while (d.firstChild) document.body.appendChild(d.firstChild);

    document.getElementById("vgBackdrop").onclick = dialogeZu;
    document.getElementById("vgHakenAbbruch").onclick = dialogeZu;
    document.getElementById("vgDetailZu").onclick = dialogeZu;
    document.getElementById("vgHakenOk").onclick = abhakenSenden;
    document.getElementById("vgEditAbbruch").onclick = dialogeZu;
    document.getElementById("vgEditOk").onclick = editSenden;
    document.getElementById("vgEditStorno").onclick = stornoStarten;
    document.getElementById("vgKommentarOk").onclick = kommentarSenden;
    document.getElementById("vgWiederOeffnen").onclick = wiederOeffnen;
    [].slice.call(document.querySelectorAll(".vg-wahl-btn")).forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll(".vg-wahl-btn").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        var teil = b.dataset.erg === "teilweise";
        document.getElementById("vgHakenPflicht").textContent = teil ? "(nötig)" : "(optional)";
        document.getElementById("vgHakenText").placeholder = teil
          ? "was hat gefehlt?" : "z.B. bar erhalten";
      };
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") dialogeZu();
    });
  }

  function dialogeZu() {
    ["vgBackdrop", "vgHakenModal", "vgDetailModal", "vgStapelModal", "vgEditModal"].forEach(function (id) {
      var e = document.getElementById(id); if (e) e.style.display = "none";
    });
    OFFENES_DETAIL = null;
  }

  /* ── Reiter ────────────────────────────────────────────────────── */
  var TAB = "liste";
  function reiter(name) {
    TAB = name;
    document.querySelectorAll(".vg-reiter-btn").forEach(function (b) {
      b.classList.toggle("on", b.dataset.tab === name);
    });
    document.getElementById("vgListeAnsicht").style.display = (name === "liste") ? "" : "none";
    document.getElementById("vgWocheAnsicht").style.display = (name === "woche") ? "" : "none";
    document.getElementById("vgKontoAnsicht").style.display = (name === "konto") ? "" : "none";
    if (name === "woche") wocheLaden(AKTUELLE_KW);
    if (name === "konto") kontenLaden();
  }

  /* ── Fahrerkonten ──────────────────────────────────────────────────
     Der offene Stand ist die Summe der Soll-Beträge aller offenen
     Vorgänge. Erledigte zählen nie mehr mit: entweder war alles da, der
     Rest läuft als eigener Vorgang weiter, oder er wurde abgeschrieben. */

  function kachel(titel, wert, art) {
    return '<div class="vg-kachel' + (art ? " vg-kachel-" + art : "") + '">'
      + '<div class="vg-kachel-wert">' + esc(wert) + '</div>'
      + '<div class="vg-kachel-titel">' + esc(titel) + '</div></div>';
  }

  function kontenLaden() {
    document.getElementById("vgKontoDetail").style.display = "none";
    document.getElementById("vgKontoUebersicht").style.display = "";
    return fetch("/vorgaenge/konten", { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        document.getElementById("vgKontoKacheln").innerHTML =
          kachel("Offen insgesamt", d.summe_offen + " €", d.anzahl_mit_offen ? "rot" : "")
          + kachel("Fahrer mit offenem Betrag", String(d.anzahl_mit_offen))
          + kachel("Abgeschrieben", d.summe_abgeschrieben + " €");

        document.getElementById("vgKontoBody").innerHTML = d.zeilen.length
          ? d.zeilen.map(function (z) {
              return '<tr class="vg-klickbar" data-konto="' + z.mitarbeiter_id + '">'
                + '<td class="vg-name">' + esc(z.name)
                +   (z.aktiv ? "" : ' <span class="vg-badge">ausgeschieden</span>') + '</td>'
                + '<td class="r geld ' + (z.offen_cent ? "minus" : "") + '">' + esc(z.offen) + '</td>'
                + '<td class="r geld">' + esc(z.gestellt) + '</td>'
                + '<td class="r geld">' + esc(z.erhalten) + '</td>'
                + '<td class="r geld">' + (z.abgeschrieben_cent ? esc(z.abgeschrieben) : "–") + '</td>'
                + '<td>' + (z.letzte_zahlung ? esc(datumKurz(z.letzte_zahlung.slice(0, 10))) : "–") + '</td>'
                + '<td class="r"><button class="vg-mini" data-konto="' + z.mitarbeiter_id
                +   '" type="button">Historie</button></td></tr>';
            }).join("")
          : '<tr><td colspan="7" class="vg-leer">Noch keine Fahrer angelegt.</td></tr>';

        document.getElementById("vgKontoFuss").innerHTML = d.zeilen.length
          ? '<tr><td>' + d.zeilen.length + ' Fahrer</td>'
            + '<td class="r geld">' + esc(d.summe_offen) + '</td>'
            + '<td colspan="2"></td>'
            + '<td class="r geld">' + esc(d.summe_abgeschrieben) + '</td>'
            + '<td colspan="2"></td></tr>'
          : "";

        document.querySelectorAll("#vgKontoBody [data-konto]").forEach(function (el) {
          el.onclick = function (e) {
            e.stopPropagation();
            kontoOeffnen(Number(el.dataset.konto));
          };
        });
      }).catch(function () {});
  }

  var KONTO_ID = 0;

  function kontoOeffnen(mitarbeiterId) {
    KONTO_ID = mitarbeiterId;
    return fetch("/vorgaenge/fahrer/" + mitarbeiterId, { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        document.getElementById("vgKontoUebersicht").style.display = "none";
        document.getElementById("vgKontoDetail").style.display = "";
        document.getElementById("vgKontoName").textContent = d.name;
        document.getElementById("vgKontoDetailKacheln").innerHTML =
          kachel("Offen", d.offen + " €", d.offen_cent ? "rot" : "gruen")
          + kachel("Gefordert insgesamt", d.gestellt + " €")
          + kachel("Erhalten insgesamt", d.erhalten + " €")
          + kachel("Abgeschrieben", d.abgeschrieben + " €");

        document.getElementById("vgKontoVerlauf").innerHTML = d.verlauf.length
          ? d.verlauf.map(function (z) {
              var marke = z.status === "storniert"
                ? '<span class="vg-badge">storniert</span>'
                : z.status === "offen"
                  ? '<span class="vg-badge' + (z.ueberfaellig ? " vg-badge-rot" : "") + '">offen</span>'
                  : '<span class="vg-badge vg-badge-' + (z.ergebnis === "komplett" ? "gruen" : "gelb") + '">'
                    + (z.ergebnis === "komplett" ? "komplett" : "nicht komplett") + '</span>';
              if (z.weitergefuehrt) marke += '<span class="vg-badge">Rest weitergeführt</span>';
              var wann = (z.erledigt_am || z.erstellt_am || "").slice(0, 10);
              return '<tr' + (z.status === "storniert" ? ' class="vg-zeile-fertig"' : '') + '>'
                + '<td class="vg-name">' + esc(z.titel)
                +   '<div class="vg-unten">' + (wann ? esc(datumKurz(wann)) : "")
                +     (z.erledigt_von_name ? " · " + esc(z.erledigt_von_name) : "") + '</div></td>'
                + '<td class="r geld">' + esc(z.soll) + '</td>'
                + '<td class="r geld">' + (z.ist ? esc(z.ist) : "–") + '</td>'
                + '<td class="r geld ' + (z.fehlbetrag ? "minus" : "") + '">'
                +   (z.fehlbetrag ? esc(z.fehlbetrag) : "–") + '</td>'
                + '<td class="r geld">' + esc(z.stand) + '</td>'
                + '<td>' + marke + '</td>'
                + '<td class="r">'
                +   (z.status !== "storniert" && ZUSTAND.darf_bearbeiten
                    ? '<button class="vg-mini" data-edit="' + z.id + '" type="button">Bearbeiten</button>' : "")
                +   '<button class="vg-mini" data-detail="' + z.id + '" type="button">Verlauf</button>'
                + '</td></tr>';
            }).join("")
          : '<tr><td colspan="7" class="vg-leer">Für diesen Fahrer gibt es noch keinen Vorgang.</td></tr>';

        document.querySelectorAll("#vgKontoVerlauf [data-detail]").forEach(function (b) {
          b.onclick = function () { detailOeffnen(Number(b.dataset.detail)); };
        });
        document.querySelectorAll("#vgKontoVerlauf [data-edit]").forEach(function (b) {
          b.onclick = function () { editOeffnen(Number(b.dataset.edit)); };
        });
      }).catch(function () {});
  }

  /* ── Wochenübersicht ───────────────────────────────────────────── */
  var AKTUELLE_KW = "";

  function wocheLaden(kw) {
    return fetch("/vorgaenge/woche" + (kw ? "?kw=" + encodeURIComponent(kw) : ""),
                 { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        AKTUELLE_KW = d.kw;
        document.getElementById("vgKwText").textContent = d.kw.replace("-", " ");
        document.getElementById("vgKwDatum").textContent =
          datumKurz(d.von) + " – " + datumKurz(d.bis);
        document.getElementById("vgKwZurueck").onclick = function () { wocheLaden(d.vorherige_kw); };
        document.getElementById("vgKwVor").onclick = function () { wocheLaden(d.naechste_kw); };

        var body = document.getElementById("vgWocheBody");
        body.innerHTML = d.zeilen.length ? d.zeilen.map(function (v) {
          var diff = v.status === "offen" ? "" : v.differenz_cent;
          return '<tr>'
            + '<td class="vg-name">' + esc(v.mitarbeiter_name || v.titel) + '</td>'
            + '<td class="r geld">' + esc(v.betrag_soll) + '</td>'
            + '<td class="r geld">' + (v.status === "offen" ? "–" : esc(v.betrag_ist)) + '</td>'
            + '<td class="r geld ' + (diff < 0 ? "minus" : (diff > 0 ? "plus" : "")) + '">'
            +   (v.status === "offen" ? "–"
                : (diff === 0 ? "0,00" : (diff > 0 ? "+" : "") + alsEuro(diff)))
            + '</td>'
            + '<td>' + (v.status === "offen"
                ? '<span class="vg-badge' + (v.ueberfaellig ? " vg-badge-rot" : "") + '">offen</span>'
                : '<span class="vg-badge vg-badge-' + (v.ergebnis === "komplett" ? "gruen" : "gelb") + '">'
                  + (v.ergebnis === "komplett" ? "komplett" : "nicht komplett") + '</span>') + '</td>'
            + '<td class="r">'
            +   (v.status === "offen" && ZUSTAND.darf_bearbeiten
                ? '<button class="vg-mini vg-mini-green" data-haken="' + v.id + '" type="button">Abhaken</button>' : "")
            +   (ZUSTAND.darf_bearbeiten
                ? '<button class="vg-mini" data-edit="' + v.id + '" type="button">Bearbeiten</button>' : "")
            +   '<button class="vg-mini" data-detail="' + v.id + '" type="button">Verlauf</button>'
            + '</td></tr>';
        }).join("") : '<tr><td colspan="6" class="vg-leer">Für diese Woche wurde noch nichts angelegt.</td></tr>';

        document.getElementById("vgWocheFuss").innerHTML = d.zeilen.length
          ? '<tr><td>' + d.anzahl + ' Fahrer · ' + d.anzahl_offen + ' offen · '
            + d.anzahl_differenz + ' mit Differenz</td>'
            + '<td class="r geld">' + esc(d.summe_soll) + '</td>'
            + '<td class="r geld">' + esc(d.summe_ist) + '</td>'
            + '<td class="r geld ' + (d.summe_differenz.indexOf("-") === 0 ? "minus" : "") + '">'
            +   esc(d.summe_differenz) + '</td><td colspan="2"></td></tr>'
          : "";

        document.querySelectorAll("#vgWocheBody [data-haken]").forEach(function (b) {
          b.onclick = function () { hakenOeffnen(Number(b.dataset.haken), d.zeilen); };
        });
        document.querySelectorAll("#vgWocheBody [data-detail]").forEach(function (b) {
          b.onclick = function () { detailOeffnen(Number(b.dataset.detail)); };
        });
        document.querySelectorAll("#vgWocheBody [data-edit]").forEach(function (b) {
          b.onclick = function () { editOeffnen(Number(b.dataset.edit)); };
        });
      }).catch(function () {});
  }

  var MONATSNAMEN = ["Januar", "Februar", "März", "April", "Mai", "Juni",
                    "Juli", "August", "September", "Oktober", "November", "Dezember"];

  function monatText(m) {
    if (!/^\d{4}-\d{2}$/.test(m || "")) return m || "";
    return MONATSNAMEN[Number(m.slice(5, 7)) - 1] + " " + m.slice(0, 4);
  }

  /* ── Wochen-Stapel ─────────────────────────────────────────────── */
  var STAPEL_KW = "";

  function stapelOeffnen(monat, wocheNr) {
    var kw = (TAB === "woche" && AKTUELLE_KW) ? AKTUELLE_KW : (ZUSTAND.aktuelle_kw || "");
    var frage = [];
    if (kw) frage.push("kw=" + encodeURIComponent(kw));
    if (monat) frage.push("lohn_monat=" + encodeURIComponent(monat));
    if (wocheNr) frage.push("lohn_woche=" + wocheNr);
    fetch("/vorgaenge/wochenvorschlag" + (frage.length ? "?" + frage.join("&") : ""),
          { headers: kopf() })
      .then(function (r) {
        if (!r.ok) return fehlertext(r).then(function (t) { fcInfo("Nicht möglich", t); return null; });
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        STAPEL_KW = d.kw;

        /* Monat und Woche zur Auswahl stellen - die Zuordnung Kalenderwoche zu
           Lohn-Woche ist eine Vermutung und muss korrigierbar sein. */
        var mSel = document.getElementById("vgStapelMonat");
        var monate = d.lohn_monate || [];
        if (monate.indexOf(d.lohn_monat) < 0) monate = [d.lohn_monat].concat(monate);
        mSel.innerHTML = monate.map(function (m) {
          return '<option value="' + esc(m) + '"' + (m === d.lohn_monat ? " selected" : "")
            + '>' + esc(monatText(m)) + '</option>';
        }).join("");
        var wSel = document.getElementById("vgStapelWoche");
        var anzahl = d.lohn_wochen_anzahl || 5;
        var wOpt = "";
        for (var i = 1; i <= anzahl; i++) {
          wOpt += '<option value="' + i + '"' + (i === d.lohn_woche_nr ? " selected" : "")
            + '>Woche ' + i + '</option>';
        }
        wSel.innerHTML = wOpt;
        wSel.disabled = !d.lohn_gefunden;
        mSel.onchange = function () { stapelOeffnen(mSel.value, 0); };
        wSel.onchange = function () { stapelOeffnen(mSel.value, Number(wSel.value)); };

        var treffer = d.fahrer.filter(function (f) { return f.vorschlag_cent; }).length;
        document.getElementById("vgStapelSub").innerHTML = !d.lohn_gefunden
          ? 'Für <b>' + esc(monatText(d.lohn_monat)) + '</b> ist im Lohn-Modul nichts gespeichert. '
            + 'Wähle links einen anderen Monat oder trage die Beträge von Hand ein.'
          : (treffer
            ? 'Feld „Offen" aus dem Lohn-Modul. Du kannst jeden Wert ändern.'
            : 'In dieser Lohn-Woche steht bei keinem Fahrer etwas unter „Offen". '
              + 'Probiere eine andere Woche oder trage die Beträge von Hand ein.')
          + (d.lohn_ohne_mitarbeiter && d.lohn_ohne_mitarbeiter.length
            ? '<br><span class="vg-warn">Im Lohn, aber nicht unter Mitarbeiter: '
              + esc(d.lohn_ohne_mitarbeiter.join(", ")) + '</span>' : "");

        /* Steht in der gewählten Woche nichts, aber woanders schon: anbieten
           statt still einen fremden Betrag zu nehmen. Beim Bargeld wäre das
           der teuerste aller Fehler. */
        var alt = document.getElementById("vgStapelAlt");
        var vorschlaege = (!treffer && d.lohn_alternativen) ? d.lohn_alternativen : [];
        alt.innerHTML = vorschlaege.length
          ? '<span>Beträge stehen in: </span>' + vorschlaege.map(function (a) {
              return '<button class="vg-mini" type="button" data-alt="'
                + esc(a.monat) + '|' + a.woche_nr + '">' + esc(monatText(a.monat))
                + ', Woche ' + a.woche_nr + ' (' + a.treffer + ')</button>';
            }).join("")
          : "";
        alt.style.display = vorschlaege.length ? "" : "none";
        alt.querySelectorAll("[data-alt]").forEach(function (b) {
          b.onclick = function () {
            var teile = b.dataset.alt.split("|");
            stapelOeffnen(teile[0], Number(teile[1]));
          };
        });

        document.getElementById("vgStapelBody").innerHTML = d.fahrer.map(function (f) {
          /* Für schon angelegte Fahrer kein gesperrtes Eingabefeld: ein
             ausgegrauter Betrag im Feld sieht aus, als sei nichts übernommen
             worden. Stattdessen der Betrag als Text plus deutliche Marke. */
          return '<tr' + (f.schon_angelegt ? ' class="vg-schon"' : '') + '>'
            + '<td class="vg-name">' + esc(f.name) + '</td>'
            /* Bei schon angelegten Fahrern zählt der Betrag AUS DEM VORGANG,
               nicht der Lohn-Vorschlag - sonst zeigt der Dialog eine Zahl,
               die so nirgends gefordert wird. */
            + '<td class="r">' + (f.schon_angelegt
                ? '<span class="vg-fest">' + esc(f.angelegt_betrag || "–") + '</span>'
                : '<input class="vg-stapel-feld" data-ma="' + f.mitarbeiter_id + '"'
                  + ' type="text" inputmode="decimal" value="'
                  + esc(f.vorschlag_cent ? f.vorschlag : "") + '" placeholder="0,00">') + '</td>'
            + '<td>' + (f.schon_angelegt
                ? '<span class="vg-badge vg-badge-gruen">'
                  + (f.angelegt_status === "erledigt" ? "erledigt" : "schon angelegt")
                  + '</span>' : "") + '</td>'
            + '</tr>';
        }).join("") || '<tr><td colspan="3" class="vg-leer">Keine aktiven Mitarbeiter.</td></tr>';

        /* Sind alle Fahrer schon dran, ist der Dialog erledigt - das gehört
           oben hin, nicht als roter Fehler beim Absenden. */
        var offeneFahrer = d.fahrer.filter(function (f) { return !f.schon_angelegt; });
        var fertig = d.fahrer.length && !offeneFahrer.length;
        document.getElementById("vgStapelOk").disabled = fertig;
        if (fertig) {
          meldung("vgStapelMsg",
            "Für " + d.kw + " sind bereits alle " + d.fahrer.length
            + " Fahrer angelegt. Hier ist nichts mehr zu tun.", "ok");
        } else if (d.fahrer.length !== offeneFahrer.length) {
          meldung("vgStapelMsg",
            (d.fahrer.length - offeneFahrer.length) + " von " + d.fahrer.length
            + " Fahrern sind für " + d.kw + " schon angelegt.", "ok");
        } else {
          meldung("vgStapelMsg", "");
        }
        document.getElementById("vgDiagnose").style.display = "none";
        document.getElementById("vgBackdrop").style.display = "block";
        document.getElementById("vgStapelModal").style.display = "block";
      }).catch(function () {});
  }

  function stapelSenden() {
    var zeilen = [];
    document.querySelectorAll(".vg-stapel-feld").forEach(function (i) {
      if (i.disabled) return;
      var wert = (i.value || "").trim();
      if (wert) zeilen.push({ mitarbeiter_id: Number(i.dataset.ma), betrag: wert });
    });
    if (!zeilen.length) {
      var frei = document.querySelectorAll(".vg-stapel-feld").length;
      meldung("vgStapelMsg", frei
        ? "Trage bei mindestens einem Fahrer einen Betrag ein."
        : "Für diese Woche ist schon jeder Fahrer angelegt – hier ist nichts mehr zu tun.",
        frei ? "fehler" : "ok");
      return;
    }
    fetch("/vorgaenge/stapel", {
      method: "POST", headers: kopf({ "Content-Type": "application/json" }),
      body: JSON.stringify({ kw: STAPEL_KW, zeilen: zeilen })
    }).then(function (r) {
      if (!r.ok) return fehlertext(r).then(function (t) { meldung("vgStapelMsg", t, "fehler"); });
      return r.json().then(function (d) {
        dialogeZu();
        laden();
        if (TAB === "woche") wocheLaden(STAPEL_KW);
        fcInfo("Woche angelegt",
          d.angelegt + (d.angelegt === 1 ? " Vorgang" : " Vorgänge") + " für " + d.kw + " angelegt."
          + (d.uebersprungen ? " " + d.uebersprungen + " übersprungen (kein Betrag oder schon vorhanden)." : ""),
          "info");
      });
    }).catch(function () { meldung("vgStapelMsg", "Verbindung fehlgeschlagen.", "fehler"); });
  }

  /* ── Liste zeichnen ────────────────────────────────────────────── */
  function zeile(v, erledigt) {
    var geld = v.betrag_soll_cent
      ? '<span class="vg-geld">' + esc(v.betrag_soll) + ' €</span>' : "";
    var marken = "";
    if (v.ueberfaellig) marken += '<span class="vg-badge vg-badge-rot">überfällig</span>';
    if (v.art === "kasseninventur") marken += '<span class="vg-badge">täglich</span>';
    if (erledigt && v.ergebnis === "teilweise")
      marken += '<span class="vg-badge vg-badge-gelb">nicht komplett</span>';
    if (erledigt && v.ergebnis === "komplett")
      marken += '<span class="vg-badge vg-badge-gruen">komplett</span>';

    var unten = erledigt
      ? esc(v.erledigt_von_name || "") + " · " + esc(v.erledigt_am || "")
        + (v.differenz_cent ? ' · <span class="vg-diff">' + esc(v.betrag_ist) + ' € erhalten</span>' : "")
      : (v.faellig_am ? "fällig " + esc(datumKurz(v.faellig_am)) : "")
        + (v.erstellt_von_name ? " · von " + esc(v.erstellt_von_name) : "");

    return '<div class="vg-zeile' + (erledigt ? " vg-zeile-fertig" : "") + '" data-vg="' + v.id + '">'
      + '<div class="vg-zeile-text">'
      +   '<div class="vg-titel">' + esc(v.titel) + " " + geld + marken + '</div>'
      +   '<div class="vg-unten">' + unten + '</div>'
      + '</div>'
      + '<div class="vg-zeile-akt">'
      +   (!erledigt && ZUSTAND.darf_bearbeiten
          ? '<button class="vg-mini vg-mini-green" data-haken="' + v.id + '" type="button">Abhaken</button>' : "")
      +   (ZUSTAND.darf_bearbeiten
          ? '<button class="vg-mini" data-edit="' + v.id + '" type="button">Bearbeiten</button>' : "")
      +   '<button class="vg-mini" data-detail="' + v.id + '" type="button">Verlauf</button>'
      + '</div></div>';
  }

  function datumKurz(iso) {
    if (!iso) return "";
    var t = iso.split("-");
    return t.length === 3 ? t[2] + "." + t[1] + "." : iso;
  }

  function zeichnen() {
    var o = document.getElementById("vgOffen");
    var e = document.getElementById("vgErledigt");
    if (!o) return;

    o.innerHTML = ZUSTAND.offen.length
      ? ZUSTAND.offen.map(function (v) { return zeile(v, false); }).join("")
      : '<div class="vg-leer">Nichts offen. Alles erledigt.</div>';
    e.innerHTML = ZUSTAND.erledigt.length
      ? ZUSTAND.erledigt.map(function (v) { return zeile(v, true); }).join("")
      : '<div class="vg-leer">Noch nichts erledigt.</div>';

    var z = document.getElementById("vgZaehler");
    var ue = ZUSTAND.anzahl_ueberfaellig || 0;
    z.innerHTML = '<span class="vg-zaehler-zahl">' + (ZUSTAND.anzahl_offen || 0) + '</span>'
      + '<span class="vg-zaehler-text">offen' + (ue ? ", " + ue + " überfällig" : "") + '</span>';
    z.className = "vg-zaehler" + (ue ? " vg-zaehler-warn" : "");

    var karte = document.getElementById("vgNeuKarte");
    if (karte) karte.style.display = ZUSTAND.darf_bearbeiten ? "" : "none";

    var listen = "#vgOffen, #vgErledigt";
    listen.split(", ").forEach(function (wo) {
      document.querySelectorAll(wo + " [data-haken]").forEach(function (b) {
        b.onclick = function () { hakenOeffnen(Number(b.dataset.haken)); };
      });
      document.querySelectorAll(wo + " [data-detail]").forEach(function (b) {
        b.onclick = function () { detailOeffnen(Number(b.dataset.detail)); };
      });
      document.querySelectorAll(wo + " [data-edit]").forEach(function (b) {
        b.onclick = function () { editOeffnen(Number(b.dataset.edit)); };
      });
    });
    sidebarZahl(ZUSTAND.anzahl_offen || 0);
  }

  function finde(id) {
    return ZUSTAND.offen.concat(ZUSTAND.erledigt)
      .filter(function (v) { return v.id === id; })[0] || {};
  }

  /* ── Laden ─────────────────────────────────────────────────────── */
  function filterAbfrage() {
    var t = [];
    var q = (document.getElementById("vgSuche") || {}).value;
    var a = (document.getElementById("vgFilterArt") || {}).value;
    var von = (document.getElementById("vgVon") || {}).value;
    var bis = (document.getElementById("vgBis") || {}).value;
    if (q && q.trim()) t.push("q=" + encodeURIComponent(q.trim()));
    if (a) t.push("art=" + encodeURIComponent(a));
    if (von) t.push("von=" + von);
    if (bis) t.push("bis=" + bis);
    t.push("limit=100");
    return "?" + t.join("&");
  }

  function laden() {
    return fetch("/vorgaenge" + filterAbfrage(), { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        ZUSTAND = d;
        artenFuellen();
        zeichnen();
      }).catch(function () {});
  }

  function artenFuellen() {
    var tr = document.getElementById("vgTreffer");
    if (tr) tr.textContent = ZUSTAND.gefiltert ? (ZUSTAND.erledigt_gesamt || 0) + " Treffer" : "";

    var filter = document.getElementById("vgFilterArt");
    if (filter && filter.options.length <= 1) {
      (ZUSTAND.arten || []).forEach(function (a) {
        var o = document.createElement("option");
        o.value = a.key; o.textContent = a.name;
        filter.appendChild(o);
      });
    }

    var sel = document.getElementById("vgArt");
    if (!sel || sel.options.length) return;
    sel.innerHTML = (ZUSTAND.arten || []).map(function (a) {
      return '<option value="' + a.key + '">' + esc(a.name) + '</option>';
    }).join("");
    sel.onchange = artWechsel;
    artWechsel();
  }

  function artWechsel() {
    var art = document.getElementById("vgArt").value;
    document.getElementById("vgFahrerFeld").style.display =
      (art === "fahrer_kassieren") ? "" : "none";
    document.getElementById("vgTitelFeld").style.display =
      (art === "fahrer_kassieren") ? "none" : "";
  }

  function fahrerLaden() {
    return fetch("/mitarbeiter", { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : { mitarbeiter: [] }; })
      .then(function (d) {
        FAHRER = (d.mitarbeiter || []).filter(function (m) { return m.aktiv; });
        var sel = document.getElementById("vgFahrer");
        if (sel) {
          sel.innerHTML = FAHRER.length
            ? FAHRER.map(function (m) { return '<option value="' + m.id + '">' + esc(m.name) + '</option>'; }).join("")
            : '<option value="">– keine Mitarbeiter angelegt –</option>';
        }
      }).catch(function () {});
  }

  function meldung(id, text, art) {
    var m = document.getElementById(id);
    if (!m) return;
    m.textContent = text || "";
    m.className = "vg-msg" + (art ? " vg-msg-" + art : "");
  }

  function fehlertext(r) {
    return r.json().then(function (d) { return (d && d.detail) || "Das hat nicht geklappt."; })
      .catch(function () { return "Das hat nicht geklappt."; });
  }

  /* ── Anlegen ───────────────────────────────────────────────────── */
  function anlegen() {
    var art = document.getElementById("vgArt").value;
    var koerper = {
      art: art,
      betrag: document.getElementById("vgBetrag").value.trim(),
      faellig_am: document.getElementById("vgFaellig").value || null,
      hinweis: document.getElementById("vgHinweis").value.trim()
    };
    if (art === "fahrer_kassieren") {
      var f = document.getElementById("vgFahrer").value;
      if (!f) { meldung("vgMsg", "Bitte zuerst einen Mitarbeiter anlegen.", "fehler"); return; }
      koerper.mitarbeiter_id = Number(f);
    } else {
      koerper.titel = document.getElementById("vgTitel").value.trim();
      if (!koerper.titel) { meldung("vgMsg", "Bitte eintragen, was zu tun ist.", "fehler"); return; }
    }
    meldung("vgMsg", "");
    fetch("/vorgaenge", {
      method: "POST", headers: kopf({ "Content-Type": "application/json" }),
      body: JSON.stringify(koerper)
    }).then(function (r) {
      if (!r.ok) return fehlertext(r).then(function (t) { meldung("vgMsg", t, "fehler"); });
      document.getElementById("vgBetrag").value = "";
      document.getElementById("vgHinweis").value = "";
      var ti = document.getElementById("vgTitel"); if (ti) ti.value = "";
      meldung("vgMsg", "Angelegt.", "ok");
      setTimeout(function () { meldung("vgMsg", ""); }, 2500);
      laden();
    }).catch(function () { meldung("vgMsg", "Verbindung fehlgeschlagen.", "fehler"); });
  }

  /* ── Abhaken ───────────────────────────────────────────────────── */
  var HAKEN_SOLL = 0;

  function hakenOeffnen(id, quelle) {
    var v = (quelle || []).filter(function (x) { return x.id === id; })[0] || finde(id);
    OFFENES_DETAIL = id;
    HAKEN_SOLL = v.betrag_soll_cent || 0;
    document.getElementById("vgHakenTitel").textContent = v.titel || "Abhaken";
    document.getElementById("vgHakenSub").textContent = HAKEN_SOLL
      ? "Vorgesehen: " + v.betrag_soll + " €"
      : "Kein Betrag hinterlegt.";
    document.getElementById("vgHakenBetragFeld").style.display = HAKEN_SOLL ? "" : "none";
    document.getElementById("vgHakenBetrag").value = HAKEN_SOLL ? v.betrag_soll : "";
    document.getElementById("vgHakenText").value = "";
    document.querySelectorAll(".vg-wahl-btn").forEach(function (x) {
      x.classList.toggle("on", x.dataset.erg === "komplett");
    });
    document.getElementById("vgHakenPflicht").textContent = "(optional)";
    document.getElementById("vgRestHaken").checked = true;
    restZeileAktualisieren();
    meldung("vgHakenMsg", "");
    document.getElementById("vgBackdrop").style.display = "block";
    document.getElementById("vgHakenModal").style.display = "block";
  }

  /* ── Selbstauskunft: was sieht der Server im Lohn-Modul? ──────────
     Bleibt der Vorschlag leer, gibt es genau drei mögliche Gründe. Statt
     raten zu lassen, legt diese Auskunft alle drei nebeneinander. */
  function diagnoseLaden() {
    var kasten = document.getElementById("vgDiagnose");
    kasten.innerHTML = '<div class="vg-leer">Wird geladen …</div>';
    kasten.style.display = "";
    fetch("/vorgaenge/lohn-diagnose", { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { kasten.innerHTML = '<div class="vg-leer">Auskunft nicht verfügbar.</div>'; return; }
        var teile = [];

        teile.push('<div class="vg-diag-zeile"><b>Betrieb:</b> ' + esc(d.firma)
          + ' · <b>Kalenderwoche:</b> ' + esc(d.kw) + ' ('
          + esc(datumKurz(d.kw_von)) + ' – ' + esc(datumKurz(d.kw_bis)) + ')</div>');

        if (!d.monate.length) {
          teile.push('<div class="vg-warn">Im Lohn-Modul ist für diesen Betrieb noch '
            + 'kein einziger Monat gespeichert. Öffne Lohn, trage die Werte ein und '
            + 'klicke dort auf Speichern – erst dann kennt der Server die Zahlen.</div>');
        } else {
          teile.push('<div class="vg-diag-zeile"><b>Gespeicherte Lohn-Monate:</b></div>');
          teile.push('<table class="vg-table vg-table-eng"><thead><tr>'
            + '<th>Monat</th><th class="r">Fahrer</th><th>Wochen mit Beträgen</th></tr></thead><tbody>'
            + d.monate.map(function (m) {
                var voll = m.wochen.filter(function (w) { return w.treffer; });
                return '<tr><td>' + esc(monatText(m.monat)) + '</td>'
                  + '<td class="r">' + m.fahrer_anzahl + '</td>'
                  + '<td>' + (voll.length
                      ? voll.map(function (w) {
                          return 'Woche ' + w.nr + ' (' + w.treffer + ' Fahrer, ' + esc(w.summe) + ' €)';
                        }).join('<br>')
                      : '<span class="vg-warn">keine Woche hat Werte unter „Offen"</span>') + '</td></tr>';
              }).join("") + '</tbody></table>');
        }

        if (d.im_lohn_ohne_mitarbeiter.length) {
          teile.push('<div class="vg-warn"><b>Im Lohn, aber nicht unter Mitarbeiter:</b> '
            + esc(d.im_lohn_ohne_mitarbeiter.join(", "))
            + ' – für diese Namen kann kein Vorgang entstehen. Lege sie unter '
            + 'Mitarbeiter an oder schreibe sie im Lohn genau so wie dort.</div>');
        }
        if (d.mitarbeiter_ohne_lohn.length) {
          teile.push('<div class="vg-diag-zeile"><b>Unter Mitarbeiter, aber nicht im Lohn:</b> '
            + esc(d.mitarbeiter_ohne_lohn.join(", ")) + '</div>');
        }
        if (!d.im_lohn_ohne_mitarbeiter.length && d.monate.length) {
          teile.push('<div class="vg-diag-zeile">Alle Lohn-Namen passen zu einem Mitarbeiter.</div>');
        }

        kasten.innerHTML = teile.join("");
      }).catch(function () {
        kasten.innerHTML = '<div class="vg-leer">Auskunft nicht verfügbar.</div>';
      });
  }

  /* ── Bearbeiten und Stornieren ─────────────────────────────────── */
  var EDIT = null;

  function editOeffnen(id) {
    fetch("/vorgaenge/" + id, { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v) return;
        EDIT = v;
        var fertig = v.status === "erledigt";
        document.getElementById("vgEditSub").textContent = fertig
          ? "Abgehakt von " + (v.erledigt_von_name || "?") + " am " + (v.erledigt_am || "")
            + ". Jede Änderung wird im Verlauf festgehalten."
          : "Angelegt von " + (v.erstellt_von_name || "?")
            + ". Jede Änderung wird im Verlauf festgehalten.";
        document.getElementById("vgEditTitel").value = v.titel || "";
        document.getElementById("vgEditBetrag").value = v.betrag_soll_cent ? v.betrag_soll : "";
        document.getElementById("vgEditIstFeld").style.display = fertig ? "" : "none";
        document.getElementById("vgEditIst").value = fertig && v.betrag_ist_cent ? v.betrag_ist : "";
        document.getElementById("vgEditFaellig").value = v.faellig_am || "";
        document.getElementById("vgEditGrund").value = "";
        document.getElementById("vgEditPflicht").textContent =
          "(Pflicht, sobald ein Betrag geändert wird)";
        meldung("vgEditMsg", "");
        document.getElementById("vgBackdrop").style.display = "block";
        document.getElementById("vgEditModal").style.display = "block";
      }).catch(function () {});
  }

  function editSenden() {
    if (!EDIT) return;
    var daten = {
      titel: document.getElementById("vgEditTitel").value,
      betrag: document.getElementById("vgEditBetrag").value || "0",
      faellig_am: document.getElementById("vgEditFaellig").value,
      grund: document.getElementById("vgEditGrund").value
    };
    if (EDIT.status === "erledigt") daten.betrag_ist = document.getElementById("vgEditIst").value || "0";
    fetch("/vorgaenge/" + EDIT.id, {
      method: "PATCH", headers: kopf({ "Content-Type": "application/json" }),
      body: JSON.stringify(daten)
    }).then(function (r) {
      if (!r.ok) return fehlertext(r).then(function (t) { meldung("vgEditMsg", t, "fehler"); });
      dialogeZu();
      nachAenderung();
    }).catch(function () { meldung("vgEditMsg", "Verbindung fehlgeschlagen.", "fehler"); });
  }

  function stornoStarten() {
    if (!EDIT) return;
    var grund = (document.getElementById("vgEditGrund").value || "").trim();
    if (!grund) {
      meldung("vgEditMsg", "Bitte trage oben einen Grund ein – dann kann ich stornieren.", "fehler");
      return;
    }
    fetch("/vorgaenge/" + EDIT.id + "/stornieren", {
      method: "POST", headers: kopf({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text: grund })
    }).then(function (r) {
      if (!r.ok) return fehlertext(r).then(function (t) { meldung("vgEditMsg", t, "fehler"); });
      dialogeZu();
      nachAenderung();
      fcInfo("Storniert", "Der Vorgang zählt nicht mehr mit. Im Fahrerkonto bleibt er nachlesbar.", "info");
    }).catch(function () { meldung("vgEditMsg", "Verbindung fehlgeschlagen.", "fehler"); });
  }

  function nachAenderung() {
    laden();
    if (TAB === "woche") wocheLaden(AKTUELLE_KW);
    if (TAB === "konto") { KONTO_ID ? kontoOeffnen(KONTO_ID) : kontenLaden(); }
  }

  /* Cent zu deutschem Euro-Text: 137540 -> "1.375,40" */
  function alsEuro(cent) {
    var neg = cent < 0;
    var t = Math.abs(cent || 0).toString();
    while (t.length < 3) t = "0" + t;
    var ganz = t.slice(0, -2), rest = t.slice(-2);
    ganz = ganz.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (neg ? "-" : "") + ganz + "," + rest;
  }

  /* Euro-Text zu Cent - nur fuer die Anzeige des Restbetrags im Dialog.
     Gerechnet wird am Ende immer auf dem Server. */
  function alsCent(text) {
    var t = (text || "").replace(/[€\s]/g, "");
    if (!t) return 0;
    var trenner = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
    var ganz, rest;
    if (trenner < 0) { ganz = t; rest = ""; }
    else if (t.length - trenner - 1 === 3 && (t.match(/[.,]/g) || []).length === 1) {
      ganz = t.replace(/[.,]/g, ""); rest = "";
    } else {
      ganz = t.slice(0, trenner).replace(/[.,]/g, ""); rest = t.slice(trenner + 1);
    }
    var n = parseInt(ganz || "0", 10);
    if (isNaN(n)) return 0;
    return n * 100 + parseInt((rest + "00").slice(0, 2), 10);
  }

  function restZeileAktualisieren() {
    var zeile = document.getElementById("vgRestZeile");
    var teil = (document.querySelector(".vg-wahl-btn.on") || {}).dataset
      && document.querySelector(".vg-wahl-btn.on").dataset.erg === "teilweise";
    var ist = alsCent(document.getElementById("vgHakenBetrag").value);
    var rest = HAKEN_SOLL - ist;
    if (teil && HAKEN_SOLL && rest > 0) {
      document.getElementById("vgRestBetrag").textContent = alsEuro(rest) + " €";
      zeile.style.display = "";
    } else {
      zeile.style.display = "none";
    }
  }

  function abhakenSenden() {
    var erg = (document.querySelector(".vg-wahl-btn.on") || {}).dataset.erg || "komplett";
    var restAn = document.getElementById("vgRestZeile").style.display !== "none"
      && document.getElementById("vgRestHaken").checked;
    var koerper = {
      ergebnis: erg,
      betrag: document.getElementById("vgHakenBetrag").value.trim(),
      hinweis: document.getElementById("vgHakenText").value.trim(),
      rest_uebernehmen: restAn
    };
    if (erg === "teilweise" && !koerper.hinweis) {
      meldung("vgHakenMsg", "Bitte kurz beschreiben, was gefehlt hat.", "fehler");
      return;
    }
    fetch("/vorgaenge/" + OFFENES_DETAIL + "/erledigt", {
      method: "POST", headers: kopf({ "Content-Type": "application/json" }),
      body: JSON.stringify(koerper)
    }).then(function (r) {
      if (!r.ok) return fehlertext(r).then(function (t) { meldung("vgHakenMsg", t, "fehler"); });
      return r.json().then(function (d) {
        dialogeZu();
        laden();
        if (TAB === "woche") wocheLaden(AKTUELLE_KW);
        if (d.rest_vorgang) {
          fcInfo("Rest weitergeführt",
            "Der Fehlbetrag von " + d.rest + " € steht jetzt als eigener Vorgang in der Liste.",
            "info");
        }
      });
    }).catch(function () { meldung("vgHakenMsg", "Verbindung fehlgeschlagen.", "fehler"); });
  }

  /* ── Verlauf ───────────────────────────────────────────────────── */
  var TYP_TEXT = { angelegt: "angelegt", erledigt: "abgehakt",
                   kommentar: "Hinweis", geoeffnet: "wieder geöffnet" };

  function detailOeffnen(id) {
    OFFENES_DETAIL = id;
    fetch("/vorgaenge/" + id, { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v) return;
        document.getElementById("vgDetailTitel").textContent = v.titel;
        document.getElementById("vgDetailSub").textContent =
          (v.betrag_soll_cent ? "Vorgesehen " + v.betrag_soll + " € · " : "")
          + (v.status === "offen" ? "offen" : "erledigt (" + (v.ergebnis || "") + ")");
        document.getElementById("vgVerlauf").innerHTML = (v.verlauf || []).map(function (e) {
          return '<div class="vg-schritt">'
            + '<div class="vg-schritt-kopf"><b>' + esc(TYP_TEXT[e.typ] || e.typ) + '</b>'
            +   '<span>' + esc(e.wer || "") + " · " + esc(e.wann) + '</span></div>'
            + (e.text ? '<div class="vg-schritt-text">' + esc(e.text) + '</div>' : "")
            + (e.betrag ? '<div class="vg-schritt-geld">' + esc(e.betrag) + ' €</div>' : "")
            + '</div>';
        }).join("") || '<div class="vg-leer">Kein Verlauf.</div>';
        var darf = ZUSTAND.darf_bearbeiten;
        document.getElementById("vgKommentarFeld").style.display = darf ? "" : "none";
        document.getElementById("vgKommentarOk").style.display = darf ? "" : "none";
        document.getElementById("vgWiederOeffnen").style.display =
          (darf && v.status !== "offen") ? "" : "none";
        document.getElementById("vgKommentar").value = "";
        document.getElementById("vgBackdrop").style.display = "block";
        document.getElementById("vgDetailModal").style.display = "block";
      }).catch(function () {});
  }

  function kommentarSenden() {
    var text = document.getElementById("vgKommentar").value.trim();
    if (!text) { dialogeZu(); return; }
    fetch("/vorgaenge/" + OFFENES_DETAIL + "/kommentar", {
      method: "POST", headers: kopf({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text: text })
    }).then(function (r) {
      if (!r.ok) return fehlertext(r).then(function (t) { fcInfo("Nicht möglich", t); });
      var id = OFFENES_DETAIL;
      detailOeffnen(id);
      laden();
    }).catch(function () {});
  }

  function wiederOeffnen() {
    var grund = document.getElementById("vgKommentar").value.trim();
    if (!grund) {
      fcInfo("Grund fehlt", "Bitte trage unten kurz ein, warum der Vorgang wieder geöffnet wird. "
        + "Die bisherige Meldung bleibt im Verlauf stehen.");
      return;
    }
    fetch("/vorgaenge/" + OFFENES_DETAIL + "/wieder-oeffnen", {
      method: "POST", headers: kopf({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text: grund })
    }).then(function (r) {
      if (!r.ok) return fehlertext(r).then(function (t) { fcInfo("Nicht möglich", t); });
      var id = OFFENES_DETAIL;
      laden().then(function () { detailOeffnen(id); });
    }).catch(function () {});
  }

  /* ── Seitenleiste ──────────────────────────────────────────────── */
  function verstecken() {
    var p = document.getElementById("vorgaengePage");
    if (p) p.style.display = "none";
  }

  function showPage() {
    if (typeof window.alleSeitenAus === "function") window.alleSeitenAus();
    ["startPage", "zeitnachweisPage", "buchPage", "lohnPage", "fahrtenbuchPage",
     "mitarbeiterPage", "settingsPage", "firmenPage", "teamPage"].forEach(function (id) {
      var e = document.getElementById(id); if (e) e.style.display = "none";
    });
    document.getElementById("vorgaengePage").style.display = "block";
    fahrerLaden().then(laden);
    window.scrollTo({ top: 0 });
  }
  window.openVorgaengePage = showPage;

  function sidebarZahl(n) {
    var b = document.querySelector('[data-fc-target="vorgaenge"]');
    if (!b) return;
    var alt = b.querySelector(".fc-side-zahl");
    if (alt) alt.remove();
    if (!n) return;
    var s = document.createElement("span");
    s.className = "fc-side-zahl";
    s.textContent = n > 99 ? "99+" : String(n);
    b.appendChild(s);
  }

  function sidebarKnopf() {
    var side = document.querySelector(".fc-shell-side, aside.fc-side, .fc-side, [aria-label='Module']");
    if (!side) return false;
    if (side.querySelector('[data-fc-target="vorgaenge"]')) return true;
    var kontoLabel = [].slice.call(side.querySelectorAll(".fc-side-label"))
      .filter(function (l) { return l.textContent === "Konto"; })[0];
    if (!kontoLabel) return false;

    if (!side.querySelector(".fc-side-label-verwaltung")) {
      var lbl = document.createElement("div");
      lbl.className = "fc-side-label fc-side-label-verwaltung";
      lbl.textContent = "Verwaltung";
      side.insertBefore(lbl, kontoLabel);
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fc-side-btn";
    btn.dataset.fcTarget = "vorgaenge";
    btn.innerHTML = ICON + "<span>Vorgänge</span>";
    btn.onclick = showPage;
    // Vor die anderen Verwaltungspunkte - das ist die Seite fuers Tagesgeschaeft.
    var ersterVerwaltung = side.querySelector(".fc-side-label-verwaltung");
    side.insertBefore(btn, ersterVerwaltung.nextSibling);

    side.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".fc-side-btn") : null;
      if (b && b.dataset.fcTarget !== "vorgaenge") verstecken();
    }, true);
    document.addEventListener("click", function (e) {
      var k = e.target && e.target.closest ? e.target.closest(".start-mod") : null;
      if (k) verstecken();
    }, true);
    return true;
  }

  /* Zahl am Menüpunkt aktuell halten - eine kleine Abfrage, kein WebSocket. */
  var LETZTE_ZAHL = null;

  function zahlTicker() {
    fetch("/vorgaenge/anzahl", { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.aktiv) return;
        var n = d.offen || 0;
        sidebarZahl(n);
        // Hat ein Kollege etwas angelegt oder abgehakt, waehrend die Seite
        // offen ist? Dann die Liste gleich mit nachladen - sonst sieht man
        // die Aenderung erst beim naechsten Aufruf der Seite.
        var seite = document.getElementById("vorgaengePage");
        var sichtbar = seite && seite.style.display !== "none";
        if (sichtbar && LETZTE_ZAHL !== null && n !== LETZTE_ZAHL) {
          var dialogOffen = document.getElementById("vgBackdrop")
            && document.getElementById("vgBackdrop").style.display === "block";
          if (!dialogOffen) laden();     // niemandem den offenen Dialog wegziehen
        }
        LETZTE_ZAHL = n;
      })
      .catch(function () {});
  }

  /* Zurueck am Rechner: sofort nachsehen, statt bis zu 30 Sekunden zu warten. */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    var seite = document.getElementById("vorgaengePage");
    if (seite && seite.style.display !== "none") laden();
    else zahlTicker();
  });

  function init() {
    fetch("/me", { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (mich) {
        if (!mich) return;
        var rechte = mich.rechte || [];
        var darf = mich.superadmin === true
          || rechte.indexOf("vorgaenge") >= 0 || rechte.indexOf("vorgaenge_lesen") >= 0;
        if (!darf) return;
        return fetch("/license-status", { headers: kopf() })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (lic) {
            if (!lic || !lic.ok) return;
            if ((lic.modules || []).indexOf("vorgaenge") < 0) return;
            buildPage();
            document.getElementById("vgAnlegen").onclick = anlegen;
            document.getElementById("vgFaellig").value = new Date().toISOString().slice(0, 10);

            document.querySelectorAll(".vg-reiter-btn").forEach(function (b) {
              b.onclick = function () { reiter(b.dataset.tab); };
            });
            document.getElementById("vgWocheBtn").onclick = function () { stapelOeffnen("", 0); };
            document.getElementById("vgStapelOk").onclick = stapelSenden;
            document.getElementById("vgStapelAbbruch").onclick = dialogeZu;
            document.getElementById("vgWarumBtn").onclick = function () {
              var k = document.getElementById("vgDiagnose");
              if (k.style.display === "none") diagnoseLaden();
              else k.style.display = "none";
            };
            document.getElementById("vgKontoZurueck").onclick = function () {
              KONTO_ID = 0; kontenLaden();
            };

            // Restbetrag-Zeile mitrechnen, waehrend getippt wird
            document.getElementById("vgHakenBetrag").addEventListener("input", restZeileAktualisieren);
            document.querySelectorAll(".vg-wahl-btn").forEach(function (b) {
              b.addEventListener("click", restZeileAktualisieren);
            });

            // Filter: Tippen mit kurzer Verzoegerung, damit nicht jede Taste laedt
            var timer = null;
            function spaeter() { clearTimeout(timer); timer = setTimeout(laden, 350); }
            document.getElementById("vgSuche").addEventListener("input", spaeter);
            ["vgFilterArt", "vgVon", "vgBis"].forEach(function (id) {
              document.getElementById(id).addEventListener("change", laden);
            });
            document.getElementById("vgFilterWeg").onclick = function () {
              document.getElementById("vgSuche").value = "";
              document.getElementById("vgFilterArt").value = "";
              document.getElementById("vgVon").value = "";
              document.getElementById("vgBis").value = "";
              laden();
            };
            var versuche = 0;
            var iv = setInterval(function () {
              versuche++;
              if (sidebarKnopf() || versuche > 100) {
                clearInterval(iv);
                zahlTicker();
                setInterval(zahlTicker, 30000);
              }
            }, 100);
          });
      }).catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
