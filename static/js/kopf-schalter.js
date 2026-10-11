/* kopf-schalter.js — "Firmenkopf im Ausdruck" für Zeitnachweis und Fahrtenbuch
 *
 * Oben auf den Ausdrucken stand bisher immer der Firmenname (im Zeitnachweis
 * zusätzlich die Anschrift). Das ist nicht immer gewollt. Deshalb je Modul ein
 * Schalter, und zwar standardmäßig AUS.
 *
 * Umgesetzt ohne Eingriff in dashboard.html: die Export-Funktionen lassen den
 * Kopf von sich aus weg, wenn der Firmenname leer ist - inklusive passendem
 * Tabellenbeginn, und im Monatsbericht rückt sogar der Titel nach links.
 * Genau das nutzen wir: die Felder werden für die Dauer des Exports geleert
 * und danach exakt so wiederhergestellt, wie sie waren.
 *
 * Beide Module teilen sich diesen Code. Dieselbe Sache zweimal zu pflegen
 * hiesse, sie beim naechsten Mal nur an einer Stelle zu reparieren.
 */
(function () {
  "use strict";
  if (new URLSearchParams(location.search).get("classic") === "1") return;

  /* ── Die beiden Module ───────────────────────────────────────────────
     anker    : Feld, hinter dem der Schalter einsortiert wird
     felder   : was fuer den Export geleert wird (erstes = der Firmenname)
     exporte  : Funktionen auf window, die umschlossen werden
     text     : Hinweis, wenn der Schalter AUS ist                        */
  var MODULE = [
    {
      kennung: "zn",
      speicher: "fc_zn_firmenkopf",
      anker: "znAnschriftInput",
      felder: ["znFirmaInput", "znAnschriftInput"],
      exporte: ["znExportPDF"],
      aus: "Aus: der Nachweis beginnt direkt mit dem Namen des Mitarbeiters.",
      an: "und die Anschrift stehen oben auf dem Nachweis."
    },
    {
      kennung: "fb",
      speicher: "fc_fb_firmenkopf",
      anker: "firmaInput",
      /* Im Fahrtenbuch wird nur der Name gedruckt, keine Anschrift. */
      felder: ["firmaInput"],
      /* Alle drei Ausdrucke des Moduls: die hochgeladene Datei als PDF,
         das korrigierte Fahrtenbuch und der Monatsbericht. */
      exporte: ["exportOriginalPDF", "exportPDF", "exportMonthly"],
      aus: "Aus: die Ausdrucke beginnen direkt mit der Tabelle.",
      an: "steht oben auf allen drei Ausdrucken."
    }
  ];

  function an(m) {
    try { return localStorage.getItem(m.speicher) === "1"; } catch (e) { return false; }
  }
  function setzen(m, wert) {
    try { localStorage.setItem(m.speicher, wert ? "1" : "0"); } catch (e) {}
  }

  function schalterEinbauen(m) {
    var id = m.kennung + "KopfSchalter";
    if (document.getElementById(id)) return;
    var ankerFeld = document.getElementById(m.anker);
    var feld = ankerFeld && ankerFeld.closest ? ankerFeld.closest(".field") : null;
    if (!feld) return;

    /* BEWUSST NICHT die Klasse "field": dort gilt `.field input {width:100%}`,
       das blaeht eine Ankreuzbox zu einem leeren Kasten auf - sie sieht dann
       aus wie ein Eingabefeld und nicht wie ein Schalter.
       Stattdessen der Schiebeschalter, den das Dashboard schon mitbringt
       (.zn-toggle, derselbe wie bei "Tag-Verschiebung"). */
    var box = document.createElement("div");
    box.className = "zn-kopf-feld";
    box.innerHTML =
      '<label class="zn-kopf-zeile">'
      + '<span class="zn-toggle">'
      +   '<input type="checkbox" id="' + id + '">'
      +   '<span class="slider"></span>'
      + '</span>'
      + '<span class="zn-kopf-text">Firmenkopf im Ausdruck</span>'
      + '</label>'
      + '<div class="zn-kopf-hinweis" id="' + m.kennung + 'KopfHinweis"></div>';
    feld.parentNode.insertBefore(box, feld.nextSibling);

    var schalter = document.getElementById(id);
    var hinweis = document.getElementById(m.kennung + "KopfHinweis");

    /* Der Hinweis sagt, was der aktuelle Stand bedeutet - sonst steht dort
       "Aus: ..." obwohl der Schalter an ist. */
    function hinweisSetzen() {
      if (!hinweis) return;
      if (schalter.checked) {
        var firma = document.getElementById(m.felder[0]);
        var name = firma && firma.value ? firma.value.trim() : "";
        hinweis.textContent = name
          ? "An: „" + name + "“ " + m.an
          : "An: der Betrieb " + m.an;
      } else {
        hinweis.textContent = m.aus;
      }
    }

    schalter.checked = an(m);
    hinweisSetzen();
    schalter.onchange = function () {
      setzen(m, schalter.checked);
      hinweisSetzen();
    };
    /* Wechselt der Betrieb, soll der Hinweis den neuen Namen zeigen. */
    var firmaFeld = document.getElementById(m.felder[0]);
    if (firmaFeld) firmaFeld.addEventListener("change", hinweisSetzen);
  }

  /* Die Export-Funktionen umschliessen, statt sie zu ersetzen. */
  function exporteUmschliessen(m) {
    m.exporte.forEach(function (name) {
      var vorhanden = window[name];
      if (typeof vorhanden !== "function" || vorhanden.fcKopf) return;
      var neu = function () {
        if (an(m)) return vorhanden.apply(this, arguments);
        var gemerkt = m.felder.map(function (id) {
          var e = document.getElementById(id);
          return { el: e, wert: e ? e.value : null };
        });
        gemerkt.forEach(function (g) { if (g.el) g.el.value = ""; });
        try {
          return vorhanden.apply(this, arguments);
        } finally {
          /* Auch wenn der Export unterwegs abbricht: die Felder muessen
             zurueck, sonst steht der Betrieb anschliessend nicht mehr in
             der Konfiguration. */
          gemerkt.forEach(function (g) { if (g.el) g.el.value = g.wert; });
        }
      };
      neu.fcKopf = true;
      window[name] = neu;
    });
  }

  function start() {
    MODULE.forEach(schalterEinbauen);
    MODULE.forEach(exporteUmschliessen);
    /* Felder und Funktionen koennen spaeter bereitstehen - kurz nachfassen,
       dann aufhoeren. */
    var versuche = 0;
    var timer = setInterval(function () {
      MODULE.forEach(schalterEinbauen);
      MODULE.forEach(exporteUmschliessen);
      if (++versuche > 40) clearInterval(timer);
    }, 150);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
