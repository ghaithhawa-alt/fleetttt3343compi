/* i18n.js — Sprachumschaltung für FleetCompliance
 *
 * Warum zur Laufzeit und nicht in den Dateien?
 * dashboard.html ist rund 700 KB und enthält das Kerngeschäft (Fahrtenbuch,
 * Lohn, Zeitnachweis). Diese Datei bleibt unangetastet — genau wie bei allen
 * bisherigen Erweiterungen. Stattdessen tauscht diese Schicht die Texte im
 * fertigen Seiteninhalt aus.
 *
 * Die wichtigste Regel: übersetzt wird NUR, was wörtlich im Wörterbuch steht.
 * Fahrernamen, Beträge, Kennzeichen, Notizen und alles andere, was der Betrieb
 * selbst eingetippt hat, kann dadurch gar nicht erst verändert werden.
 */
(function () {
  "use strict";

  var SPEICHER = "fc_sprache";
  var SPRACHEN = { de: "Deutsch", ar: "العربية" };

  var woerter = {};        // deutsch -> übersetzt
  var regeln = [];         // [RegExp, Ersatz] für zusammengesetzte Texte
  var aktiv = "de";
  var laeuft = false;      // schützt vor Endlosschleife im Beobachter
  var beobachter = null;

  /* ── Was nie angefasst wird ──────────────────────────────────────── */
  var TABU = {
    SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1,
    SVG: 1, CANVAS: 1, NOSCRIPT: 1, TEMPLATE: 1
  };

  function tabu(el) {
    while (el && el !== document.body) {
      if (el.nodeType === 1) {
        if (TABU[el.tagName]) return true;
        if (el.isContentEditable) return true;
        if (el.hasAttribute && el.hasAttribute("data-keine-uebersetzung")) return true;
      }
      el = el.parentNode;
    }
    return false;
  }

  /* ── Nachschlagen ────────────────────────────────────────────────── */
  /* Rand und Mitte werden getrennt behandelt: "  Speichern " soll die
     Leerzeichen behalten, sonst verrutscht das Layout. */
  function nachschlagen(roh) {
    if (!roh) return null;
    var links = roh.match(/^\s*/)[0];
    var rechts = roh.match(/\s*$/)[0];
    var kern = roh.slice(links.length, roh.length - rechts.length);
    if (!kern) return null;

    var flach = kern.replace(/\s+/g, " ");
    var treffer = woerter[flach];

    if (treffer === undefined) {
      /* Zusammengesetztes wie "Sofia M. abkassieren (2026-KW37)" */
      for (var i = 0; i < regeln.length; i++) {
        if (regeln[i][0].test(flach)) {
          treffer = flach.replace(regeln[i][0], regeln[i][1]);
          break;
        }
      }
    }
    if (treffer === undefined || treffer === null || treffer === kern) return null;
    return links + treffer + rechts;
  }

  /* Für Texte, die das Skript selbst erzeugt: fcT("Speichern") */
  function fcT(s) {
    if (aktiv === "de" || !s) return s;
    var u = nachschlagen(s);
    return u === null ? s : u;
  }

  /* ── Einen Textknoten umstellen ──────────────────────────────────── */
  function knoten(k) {
    if (!k.nodeValue || !/\S/.test(k.nodeValue)) return;

    if (aktiv === "de") {
      if (k.fcOriginal !== undefined) { k.nodeValue = k.fcOriginal; k.fcOriginal = undefined; }
      return;
    }
    /* Immer vom deutschen Original ausgehen, nie vom schon Übersetzten —
       sonst übersetzt sich beim zweiten Durchlauf Übersetztes weiter. */
    var quelle = k.fcOriginal !== undefined ? k.fcOriginal : k.nodeValue;
    var neu = nachschlagen(quelle);
    if (neu === null) {
      if (k.fcOriginal !== undefined) { k.nodeValue = k.fcOriginal; k.fcOriginal = undefined; }
      return;
    }
    if (k.fcOriginal === undefined) k.fcOriginal = quelle;
    if (k.nodeValue !== neu) k.nodeValue = neu;
  }

  /* ── Beschriftungen, die in Attributen stecken ───────────────────── */
  var ATTRIBUTE = ["placeholder", "title", "aria-label", "alt", "data-titel"];

  function attribute(el) {
    for (var i = 0; i < ATTRIBUTE.length; i++) {
      var a = ATTRIBUTE[i];
      if (!el.hasAttribute(a)) continue;
      var merk = "fcAttr_" + a.replace(/-/g, "_");
      if (aktiv === "de") {
        if (el[merk] !== undefined) { el.setAttribute(a, el[merk]); el[merk] = undefined; }
        continue;
      }
      var quelle = el[merk] !== undefined ? el[merk] : el.getAttribute(a);
      var neu = nachschlagen(quelle);
      if (neu === null) continue;
      if (el[merk] === undefined) el[merk] = quelle;
      el.setAttribute(a, neu);
    }
    /* Knöpfe der Bauart <input type="submit" value="Speichern"> */
    if (el.tagName === "INPUT" && /^(submit|button|reset)$/i.test(el.type || "")) {
      if (aktiv === "de") {
        if (el.fcWert !== undefined) { el.value = el.fcWert; el.fcWert = undefined; }
      } else {
        var q = el.fcWert !== undefined ? el.fcWert : el.value;
        var n = nachschlagen(q);
        if (n !== null) { if (el.fcWert === undefined) el.fcWert = q; el.value = n; }
      }
    }
  }

  /* ── Einen Teilbaum durchgehen ───────────────────────────────────── */
  function baum(wurzel) {
    if (!wurzel) return;
    if (wurzel.nodeType === 3) { if (!tabu(wurzel.parentNode)) knoten(wurzel); return; }
    if (wurzel.nodeType !== 1) return;
    if (tabu(wurzel)) return;

    var lauf = document.createTreeWalker(
      wurzel, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function (n) {
          var el = n.nodeType === 1 ? n : n.parentNode;
          if (el && el.nodeType === 1 &&
              (TABU[el.tagName] || el.isContentEditable ||
               (el.hasAttribute && el.hasAttribute("data-keine-uebersetzung")))) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

    if (wurzel.nodeType === 1) attribute(wurzel);
    var n;
    while ((n = lauf.nextNode())) {
      if (n.nodeType === 3) knoten(n); else attribute(n);
    }
  }

  /* ── Die ganze Seite ─────────────────────────────────────────────── */
  function alles() {
    if (laeuft) return;
    laeuft = true;
    try {
      baum(document.body);
      document.documentElement.setAttribute("lang", aktiv);
      document.documentElement.setAttribute("data-fc-sprache", aktiv);
    } finally { laeuft = false; }
  }

  /* ── Nachgeladene Inhalte ────────────────────────────────────────── */
  /* Das Dashboard baut Tabellen erst beim Anzeigen zusammen. Ohne Beobachter
     bliebe alles Nachgeladene deutsch. Gesammelt und einmal pro Bild
     abgearbeitet, damit grosse Tabellen die Seite nicht ausbremsen. */
  var wartend = [];
  var geplant = false;

  function abarbeiten() {
    geplant = false;
    if (aktiv === "de" || !wartend.length) { wartend = []; return; }
    var liste = wartend; wartend = [];
    laeuft = true;
    try {
      for (var i = 0; i < liste.length; i++) {
        var n = liste[i];
        if (n && n.parentNode !== null || (n && n.nodeType === 1 && n.isConnected)) baum(n);
      }
    } finally { laeuft = false; }
  }

  function beobachten() {
    if (beobachter || !window.MutationObserver) return;
    beobachter = new MutationObserver(function (aenderungen) {
      if (laeuft || aktiv === "de") return;
      for (var i = 0; i < aenderungen.length; i++) {
        var a = aenderungen[i];
        if (a.type === "characterData") { wartend.push(a.target); continue; }
        for (var j = 0; j < a.addedNodes.length; j++) wartend.push(a.addedNodes[j]);
      }
      if (wartend.length && !geplant) {
        geplant = true;
        (window.requestAnimationFrame || window.setTimeout)(abarbeiten, 0);
      }
    });
    beobachter.observe(document.body, {
      childList: true, subtree: true, characterData: true
    });
  }

  /* ── Umschalten ──────────────────────────────────────────────────── */
  function setzen(code, merken) {
    if (!SPRACHEN[code]) code = "de";
    if (code === aktiv && merken !== "erzwingen") return;
    aktiv = code;
    try { localStorage.setItem(SPEICHER, code); } catch (e) {}
    alles();
    if (aktiv !== "de") beobachten();
    document.dispatchEvent(new CustomEvent("fc:sprache", { detail: { sprache: code } }));
    if (merken === true) speichernAmBenutzer(code);
  }

  /* Die Wahl gehört zum Benutzer, nicht zum Browser — sonst muss er sie auf
     dem Telefon noch einmal treffen. Scheitert das, gilt weiter die lokale. */
  function speichernAmBenutzer(code) {
    var t = null;
    try { t = localStorage.getItem("fc_token"); } catch (e) {}
    if (!t) return;
    fetch("/me/sprache", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + t },
      body: JSON.stringify({ sprache: code })
    }).catch(function () {});
  }

  /* ── Wörterbuch nachreichen ──────────────────────────────────────── */
  function woerterbuch(code, tabelle, muster) {
    if (code !== "ar") return;                 // vorerst nur Arabisch
    for (var k in tabelle) if (tabelle.hasOwnProperty(k)) woerter[k] = tabelle[k];
    if (muster) for (var i = 0; i < muster.length; i++) regeln.push(muster[i]);
    if (aktiv === code) { alles(); beobachten(); }
  }

  /* ── Start ─────────────────────────────────────────────────────────
     Zwei Schritte, und die Reihenfolge ist wichtig: die eingestellte Sprache
     steht SOFORT fest, noch bevor die Seite fertig geladen ist. Sonst fragt
     ein später geladenes Skript (z.B. der Umschalter auf der Startseite)
     nach der Sprache und bekommt noch "de" zu hören — der Knopf trüge dann
     die falsche Beschriftung. Übersetzt wird erst, wenn es einen Seiteninhalt
     gibt. */
  (function spracheFeststellen() {
    var gespeichert = "de";
    try { gespeichert = localStorage.getItem(SPEICHER) || "de"; } catch (e) {}
    aktiv = SPRACHEN[gespeichert] ? gespeichert : "de";
    if (document.documentElement) {
      document.documentElement.setAttribute("data-fc-sprache", aktiv);
    }
  })();

  function start() {
    document.documentElement.setAttribute("data-fc-sprache", aktiv);
    if (aktiv !== "de") { alles(); beobachten(); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }

  window.fcSprache = {
    setzen: setzen,
    aktuell: function () { return aktiv; },
    sprachen: SPRACHEN,
    woerterbuch: woerterbuch,
    uebersetze: fcT,
    neu: function () { if (aktiv !== "de") alles(); }
  };
  window.fcT = fcT;
})();
