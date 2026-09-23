/* Zeitnachweis Auswahl-Ansicht - sauberer Neubau.
   Baut eine neue, zentrierte Auswahl (#znNewChooser) und verdrahtet sie mit
   den ECHTEN Dashboard-Funktionen (znGoNeuerstellen/znGoBearbeiten) und den
   ECHTEN Konfig-Feldern (znFirmaInput/znAnschriftInput/znMonth).
   Die Original-Felder werden gespiegelt, damit die bestehende Logik weiter
   greift. Die Innenteile (Upload, Fahrerliste) bleiben voellig unberuehrt.
   Notausgang: ?classic=1 -> shell.js laeuft nicht -> auch dies nicht. */
(function () {
  if (new URLSearchParams(location.search).get("classic") === "1") return;

  var ICON_NEU = '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  var ICON_BEA = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

  function build() {
    var page = document.getElementById("zeitnachweisPage");
    var main = page && page.querySelector(".fb-main");
    var original = document.getElementById("znModusAuswahl");
    if (!page || !main || !original) return;
    if (document.getElementById("znNewChooser")) return;

    var chooser = document.createElement("div");
    chooser.id = "znNewChooser";
    chooser.innerHTML =
      '<div class="znc-head"><h2>Zeitnachweis</h2>'
      + '<p>Waehle eine Aufgabe, um zu starten</p></div>'
      + '<div class="znc-cards">'
      +   '<div class="znc-card primary" id="zncNeu" role="button" tabindex="0">'
      +     '<div class="znc-ico">' + ICON_NEU + '</div>'
      +     '<h3>Neu erstellen</h3>'
      +     '<p>Leeren Stundennachweis oeffnen und Fahrer manuell anlegen.</p></div>'
      +   '<div class="znc-card" id="zncBea" role="button" tabindex="0">'
      +     '<div class="znc-ico">' + ICON_BEA + '</div>'
      +     '<h3>Bearbeiten</h3>'
      +     '<p>Fahrtenbuch laden und Stundennachweis aus Fahrten erzeugen.</p></div>'
      + '</div>';
    main.insertBefore(chooser, main.firstChild);

    /* Karten -> echte Funktionen */
    function go(fnName) {
      document.body.classList.remove("zn-chooser-on");   // neue Ansicht verlassen
      var fn = window[fnName];
      if (typeof fn === "function") fn();
    }
    document.getElementById("zncNeu").onclick = function () { go("znGoNeuerstellen"); };
    document.getElementById("zncBea").onclick = function () { go("znGoBearbeiten"); };
    ["zncNeu", "zncBea"].forEach(function (id) {
      document.getElementById(id).addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.click(); }
      });
    });

  }

  /* Die neue Ansicht immer dann zeigen, wenn die Original-Auswahl sichtbar waere.
     Wir beobachten znModusAuswahl: ist es sichtbar -> neue Ansicht an. */
  function sync() {
    var orig = document.getElementById("znModusAuswahl");
    var page = document.getElementById("zeitnachweisPage");
    if (!orig || !page) return;
    var pageVisible = page.style.display !== "none";
    var origVisible = orig.style.display !== "none";
    document.body.classList.toggle("zn-chooser-on", pageVisible && origVisible);
  }

  function init() {
    if (!document.getElementById("zeitnachweisPage")) return;
    build();
    sync();
    var orig = document.getElementById("znModusAuswahl");
    var page = document.getElementById("zeitnachweisPage");
    if (orig) new MutationObserver(sync).observe(orig, { attributes: true, attributeFilter: ["style"] });
    if (page) new MutationObserver(sync).observe(page, { attributes: true, attributeFilter: ["style"] });
  }

  /* ── Stundenliste (linke Spalte) ein-/ausklappbar, damit die Schichttabelle
        mehr Platz bekommt. Das Detail-Layout wird dynamisch gerendert, daher
        beobachten wir den Zeitnachweis und ruesten den Knopf nach. ── */
  function ruesteKlappknopf() {
    var layouts = document.querySelectorAll("#zeitnachweisPage .zn-detail-layout");
    layouts.forEach(function (layout) {
      if (layout.querySelector(".zn-hours-toggle")) return;      // schon da
      var hoursCard = layout.querySelector(".hours-card");
      if (!hoursCard) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "zn-hours-toggle";
      btn.title = "Stundenliste ein-/ausblenden";
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<polyline points="15 18 9 12 15 6"/></svg><span>Liste</span>';
      btn.addEventListener("click", function () {
        var off = !layout.classList.contains("zn-hours-off");
        layout.classList.toggle("zn-hours-off", off);
        try { localStorage.setItem("zn_hours_off", off ? "1" : "0"); } catch (e) {}
      });
      layout.appendChild(btn);
      /* Klick auf den eingeklappten Streifen (hours-card) oeffnet wieder */
      var hc = layout.querySelector(".hours-card");
      if (hc) hc.addEventListener("click", function () {
        if (layout.classList.contains("zn-hours-off")) {
          layout.classList.remove("zn-hours-off");
          try { localStorage.setItem("zn_hours_off", "0"); } catch (e) {}
        }
      });
      /* gemerkten Zustand anwenden */
      try { if (localStorage.getItem("zn_hours_off") === "1") layout.classList.add("zn-hours-off"); } catch (e) {}
    });
  }
  var znObs = new MutationObserver(function () { ruesteKlappknopf(); });

  function startHoursToggle() {
    var page = document.getElementById("zeitnachweisPage");
    if (page) { znObs.observe(page, { childList: true, subtree: true }); ruesteKlappknopf(); }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startHoursToggle);
  } else {
    startHoursToggle();
  }

  /* ── Firmenkopf im Ausdruck ──────────────────────────────────────────
     Oben auf dem Stundennachweis standen bisher immer Firmenname und
     Anschrift. Das ist nicht immer gewollt - viele Nachweise sollen nur den
     Mitarbeiter und den Monat zeigen. Deshalb ein Schalter, und zwar
     standardmaessig AUS.

     Umgesetzt ohne Eingriff in dashboard.html: die Export-Funktion liest den
     Kopf aus den beiden Feldern und laesst ihn weg, wenn der Firmenname leer
     ist (inklusive passendem Tabellenbeginn). Genau das nutzen wir - die
     Felder werden fuer die Dauer des Exports geleert und danach exakt so
     wiederhergestellt, wie sie waren. */
  var KOPF_SCHLUESSEL = "fc_zn_firmenkopf";

  function kopfAn() {
    try { return localStorage.getItem(KOPF_SCHLUESSEL) === "1"; } catch (e) { return false; }
  }
  function kopfSetzen(an) {
    try { localStorage.setItem(KOPF_SCHLUESSEL, an ? "1" : "0"); } catch (e) {}
  }

  function kopfSchalterEinbauen() {
    if (document.getElementById("znKopfSchalter")) return;
    var anschrift = document.getElementById("znAnschriftInput");
    var feld = anschrift && anschrift.closest ? anschrift.closest(".field") : null;
    if (!feld) return;

    var box = document.createElement("div");
    box.className = "field zn-kopf-feld";
    box.innerHTML =
      '<label class="zn-kopf-zeile">'
      + '<input type="checkbox" id="znKopfSchalter">'
      + '<span>Firmenkopf im Ausdruck</span>'
      + '</label>'
      + '<div class="zn-kopf-hinweis">Aus: der Nachweis beginnt direkt mit dem '
      + 'Namen des Mitarbeiters.</div>';
    feld.parentNode.insertBefore(box, feld.nextSibling);

    var schalter = document.getElementById("znKopfSchalter");
    schalter.checked = kopfAn();
    schalter.onchange = function () { kopfSetzen(schalter.checked); };
  }

  /* Die Export-Funktion umschliessen, statt sie zu ersetzen. */
  function exportUmschliessen() {
    if (typeof window.znExportPDF !== "function" || window.znExportPDF.fcKopf) return true;
    var original = window.znExportPDF;
    var neu = function () {
      if (kopfAn()) return original.apply(this, arguments);
      var felder = ["znFirmaInput", "znAnschriftInput"];
      var gemerkt = felder.map(function (id) {
        var e = document.getElementById(id);
        return { el: e, wert: e ? e.value : null };
      });
      gemerkt.forEach(function (g) { if (g.el) g.el.value = ""; });
      try {
        return original.apply(this, arguments);
      } finally {
        /* Auch wenn der Export unterwegs abbricht: die Felder muessen zurueck,
           sonst steht der Betrieb anschliessend nicht mehr in der Konfiguration. */
        gemerkt.forEach(function (g) { if (g.el) g.el.value = g.wert; });
      }
    };
    neu.fcKopf = true;
    window.znExportPDF = neu;
    return true;
  }

  function kopfStart() {
    kopfSchalterEinbauen();
    /* Beides kann spaeter bereitstehen - kurz nachfassen, dann aufhoeren. */
    var v = 0;
    var t = setInterval(function () {
      kopfSchalterEinbauen();
      exportUmschliessen();
      if (++v > 40) clearInterval(t);
    }, 150);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kopfStart);
  } else {
    kopfStart();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
