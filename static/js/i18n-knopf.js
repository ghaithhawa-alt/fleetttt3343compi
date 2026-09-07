/* i18n-knopf.js — Sprachumschalter für die öffentlichen Seiten
 *
 * Im Dashboard sitzt der Umschalter in der Seitenleiste (shell.js). Auf der
 * Startseite gibt es keine Seitenleiste — ein Fahrer, der sich zum ersten Mal
 * anmeldet, träfe dort sonst nur auf Deutsch. Deshalb hier ein kleiner Knopf
 * oben rechts.
 */
(function () {
  "use strict";
  if (!window.fcSprache) return;

  function bauen() {
    if (document.getElementById("fcSprachKnopf")) return;
    if (document.querySelector(".fc-side")) return;   // Dashboard hat schon einen

    var b = document.createElement("button");
    b.id = "fcSprachKnopf";
    b.type = "button";
    b.setAttribute("data-keine-uebersetzung", "1");

    function beschriften() {
      var ziel = window.fcSprache.aktuell() === "de" ? "ar" : "de";
      b.textContent = window.fcSprache.sprachen[ziel];
      b.title = ziel === "ar" ? "التبديل إلى العربية" : "Auf Deutsch umstellen";
      b.setAttribute("lang", ziel);
    }
    beschriften();

    /* Die Anmeldung ist noch nicht erfolgt - die Wahl kann also nur lokal
       gemerkt werden. Nach dem Anmelden übernimmt sie das Konto. */
    b.onclick = function () {
      window.fcSprache.setzen(window.fcSprache.aktuell() === "de" ? "ar" : "de");
      beschriften();
    };
    document.addEventListener("fc:sprache", beschriften);
    document.body.appendChild(b);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bauen);
  } else { bauen(); }
})();
