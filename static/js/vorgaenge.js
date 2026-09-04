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
      +   '<div class="vg-zaehler" id="vgZaehler"></div>'
      + '</div>'
      + '<div class="vg-spalten">'
      +   '<div class="vg-links">'
      +     '<div class="vg-sec">Offen</div>'
      +     '<div id="vgOffen" class="vg-liste"></div>'
      +     '<div class="vg-sec vg-sec-klein">Zuletzt erledigt</div>'
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
      +   '<div class="vg-msg" id="vgHakenMsg"></div>'
      +   '<div class="vg-modal-foot">'
      +     '<button class="vg-btn" id="vgHakenAbbruch" type="button">Abbrechen</button>'
      +     '<button class="vg-btn vg-btn-green" id="vgHakenOk" type="button">Abhaken</button>'
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
    ["vgBackdrop", "vgHakenModal", "vgDetailModal"].forEach(function (id) {
      var e = document.getElementById(id); if (e) e.style.display = "none";
    });
    OFFENES_DETAIL = null;
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

    document.querySelectorAll("[data-haken]").forEach(function (b) {
      b.onclick = function () { hakenOeffnen(Number(b.dataset.haken)); };
    });
    document.querySelectorAll("[data-detail]").forEach(function (b) {
      b.onclick = function () { detailOeffnen(Number(b.dataset.detail)); };
    });
    sidebarZahl(ZUSTAND.anzahl_offen || 0);
  }

  function finde(id) {
    return ZUSTAND.offen.concat(ZUSTAND.erledigt)
      .filter(function (v) { return v.id === id; })[0] || {};
  }

  /* ── Laden ─────────────────────────────────────────────────────── */
  function laden() {
    return fetch("/vorgaenge", { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        ZUSTAND = d;
        artenFuellen();
        zeichnen();
      }).catch(function () {});
  }

  function artenFuellen() {
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
  function hakenOeffnen(id) {
    var v = finde(id);
    OFFENES_DETAIL = id;
    document.getElementById("vgHakenTitel").textContent = v.titel || "Abhaken";
    document.getElementById("vgHakenSub").textContent = v.betrag_soll_cent
      ? "Vorgesehen: " + v.betrag_soll + " €"
      : "Kein Betrag hinterlegt.";
    document.getElementById("vgHakenBetragFeld").style.display = v.betrag_soll_cent ? "" : "none";
    document.getElementById("vgHakenBetrag").value = v.betrag_soll_cent ? v.betrag_soll : "";
    document.getElementById("vgHakenText").value = "";
    document.querySelectorAll(".vg-wahl-btn").forEach(function (x) {
      x.classList.toggle("on", x.dataset.erg === "komplett");
    });
    document.getElementById("vgHakenPflicht").textContent = "(optional)";
    meldung("vgHakenMsg", "");
    document.getElementById("vgBackdrop").style.display = "block";
    document.getElementById("vgHakenModal").style.display = "block";
  }

  function abhakenSenden() {
    var erg = (document.querySelector(".vg-wahl-btn.on") || {}).dataset.erg || "komplett";
    var koerper = {
      ergebnis: erg,
      betrag: document.getElementById("vgHakenBetrag").value.trim(),
      hinweis: document.getElementById("vgHakenText").value.trim()
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
      dialogeZu();
      laden();
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
  function zahlTicker() {
    fetch("/vorgaenge/anzahl", { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.aktiv) sidebarZahl(d.offen || 0); })
      .catch(function () {});
  }

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
