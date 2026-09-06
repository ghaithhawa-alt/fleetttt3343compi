/* FleetCompliance App-Huelle
   - Seitenleiste mit den freigeschalteten Modulen (ruft die nativen
     Dashboard-Funktionen auf: goHome, openZeitnachweis, openBuch, ...)
   - Aktiv-Markierung folgt dem echten Zustand der Seiten-Container
   - Kopf: Firmenname, Admin-Link (Superadmin), Abmelden
   - Fahrtenbuch: Konfigurations-Panel einklappbar (merkt sich den Zustand)
   - Notausgang: /app/dashboard?classic=1 zeigt das alte Aussehen */
(function () {
  if (new URLSearchParams(location.search).get("classic") === "1") return;

  var ICONS = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    zeitnachweis: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    buchhaltung: '<svg viewBox="0 0 24 24"><path d="M3 3h18v4H3z"/><path d="M5 7v14h14V7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    lohnberechnung: '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    fahrtenbuch: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
  };
  var LOGO = '<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    + '<path d="M 128 16 L 232 56 L 232 144 Q 232 218 128 240 Q 24 218 24 144 L 24 56 Z" fill="#10b981"/>'
    + '<g transform="translate(128, 140) scale(2.5)">'
    + '<path d="M -20 6 L -16 -8 Q -14 -12 -10 -12 L 10 -12 Q 14 -12 16 -8 L 20 6 L 20 12 Q 20 16 16 16 L 14 16 Q 14 18 12 18 L 8 18 Q 6 18 6 16 L -6 16 Q -6 18 -8 18 L -12 18 Q -14 18 -14 16 L -16 16 Q -20 16 -20 12 Z" fill="#0a0a0a"/>'
    + '<rect x="-13" y="-9" width="26" height="6" rx="1.5" fill="#10b981"/>'
    + '<circle cx="-11" cy="14" r="3" fill="#10b981"/>'
    + '<circle cx="11" cy="14" r="3" fill="#10b981"/></g></svg>';

  var MODULE = [
    { id: "zeitnachweis",   label: "Zeitnachweis", fn: "openZeitnachweis", page: "zeitnachweisPage" },
    { id: "buchhaltung",    label: "Buchhaltung",  fn: "openBuch",         page: "buchPage" },
    { id: "lohnberechnung", label: "Lohn",         fn: "openLohn",         page: "lohnPage" },
    { id: "fahrtenbuch",    label: "Fahrtenbuch",  fn: "openFahrtenbuch",  page: "fahrtenbuchPage" }
  ];
  var ALLE_SEITEN = ["startPage", "fahrtenbuchPage", "zeitnachweisPage", "lohnPage", "buchPage", "mitarbeiterPage", "settingsPage", "firmenPage", "teamPage", "vorgaengePage"];

  /* Raeumt ALLE Modul-Seiten weg, bevor eine geoeffnet wird.
     Fix fuer Dashboard-open-Funktionen, die nicht jede andere Seite ausblenden. */
  function alleSeitenAus() {
    ALLE_SEITEN.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }

  function init() {
    var startPage = document.getElementById("startPage");
    var headerRight = document.querySelector(".header-right");
    if (!startPage || !headerRight) return;   // unbekannte Struktur -> nichts tun

    document.body.classList.add("fc-shell");

    /* Admin und Abmelden stehen in der Seitenleiste unter "Konto" -
       die alten Knoepfe oben rechts entfallen. */

    /* ── Seitenleiste ── */
    var side = document.createElement("nav");
    side.className = "fc-side";
    side.setAttribute("aria-label", "Module");

    var brand = document.createElement("div");
    brand.className = "fc-side-brand";
    brand.innerHTML = LOGO + '<span>Fleet<b>Compliance</b></span>';
    side.appendChild(brand);

    function mkBtn(target, label, icon, onClick) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fc-side-btn";
      b.dataset.fcTarget = target;
      b.innerHTML = icon + "<span>" + label + "</span>";
      b.onclick = onClick;
      side.appendChild(b);
      return b;
    }

    mkBtn("start", "Startseite", ICONS.home, function () {
      alleSeitenAus();
      if (typeof window.goHome === "function") window.goHome();
      var sp = document.getElementById("startPage");
      if (sp) sp.style.display = "block";
    });

    var lbl = document.createElement("div");
    lbl.className = "fc-side-label";
    lbl.textContent = "Module";
    side.appendChild(lbl);

    /* Module erst nach license-status einfuegen (nur freigeschaltete) */
    fetch("/license-status").then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) return;
      var foot = document.createElement("div");
      foot.className = "fc-side-foot";
      foot.textContent = d.firma || "";
      var allowed = d.modules || [];
      MODULE.forEach(function (m) {
        if (allowed.indexOf(m.id) < 0) return;
        mkBtn(m.id, m.label, ICONS[m.id], function () {
          alleSeitenAus();
          var f = window[m.fn];
          if (typeof f === "function") { f(); }
          else {
            var card = document.querySelector('.start-mod[data-module="' + m.id + '"]');
            if (card) card.click();
          }
          var page = document.getElementById(m.page);
          if (page) page.style.display = "block";   // sicherstellen, dass das Ziel sichtbar ist
          window.scrollTo({ top: 0 });
        });
      });
      /* ── Gruppe KONTO (Admin, Einstellungen, Abmelden) ── */
      var kontoLabel = document.createElement("div");
      kontoLabel.className = "fc-side-label";
      kontoLabel.textContent = "Konto";
      side.appendChild(kontoLabel);

      // Admin-Panel (nur Superadmin)
      if (d.version === "admin" || d.verwaltung) {
        var adminBtn = document.createElement("button");
        adminBtn.type = "button";
        adminBtn.className = "fc-side-btn fc-side-konto";
        adminBtn.innerHTML = ICONS.admin + "<span>Admin-Panel</span>";
        adminBtn.onclick = function () { location.href = "/admin"; };
        side.appendChild(adminBtn);
      }

      // Einstellungen (Seite kommt spaeter - vorerst Hinweis)
      var settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "fc-side-btn fc-side-konto";
      settingsBtn.innerHTML = ICONS.settings + "<span>Einstellungen</span>";
      settingsBtn.onclick = function () {
        if (typeof window.openSettingsPage === "function") { window.openSettingsPage(); }
        else { alleSeitenAus(); var sp = document.getElementById("settingsPage"); if (sp) sp.style.display = "block"; }
      };
      side.appendChild(settingsBtn);

      // Abmelden
      var logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "fc-side-btn fc-side-konto fc-side-logout";
      logoutBtn.innerHTML = ICONS.logout + "<span>Abmelden</span>";
      logoutBtn.onclick = function () {
        localStorage.removeItem("fc_token");
        // Auch den gewaehlten Mandanten vergessen - sonst arbeitet der
        // naechste Benutzer an diesem Rechner im falschen Betrieb.
        try { localStorage.removeItem("fc_mandant"); } catch (e) {}
        location.href = "/app/";
      };
      side.appendChild(logoutBtn);

      // Firmenname ganz unten
      side.appendChild(foot);

      syncActive();
    }).catch(function () {});

    document.body.appendChild(side);

    /* ── Menü für schmale Bildschirme ──────────────────────────────
       Unter 900px hat die Seitenleiste keinen Platz. Früher wurde sie
       dort ersatzlos ausgeblendet - damit war am Telefon kein einziges
       Modul mehr erreichbar. Jetzt fährt sie über einen Knopf aus. */
    var BURGER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
    var KREUZ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

    var burger = document.createElement("button");
    burger.type = "button";
    burger.className = "fc-burger";
    burger.setAttribute("aria-label", "Menü öffnen");
    burger.setAttribute("aria-expanded", "false");
    burger.innerHTML = BURGER;

    var schatten = document.createElement("div");
    schatten.className = "fc-side-schatten";

    function menue(auf) {
      document.body.classList.toggle("fc-menue-auf", auf);
      burger.setAttribute("aria-expanded", auf ? "true" : "false");
      burger.setAttribute("aria-label", auf ? "Menü schließen" : "Menü öffnen");
      burger.innerHTML = auf ? KREUZ : BURGER;
    }
    burger.onclick = function () {
      menue(!document.body.classList.contains("fc-menue-auf"));
    };
    schatten.onclick = function () { menue(false); };
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") menue(false);
    });
    /* Nach der Wahl eines Moduls schließt sich das Menü von selbst -
       sonst verdeckt es genau die Seite, die man sehen wollte. */
    side.addEventListener("click", function (e) {
      if (e.target.closest(".fc-side-btn")) menue(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) menue(false);
    });

    document.body.appendChild(schatten);
    document.body.appendChild(burger);

    /* ── Aktiv-Markierung folgt dem echten Seiten-Zustand ── */
    var PAGES = [["start", "startPage"]].concat(MODULE.map(function (m) { return [m.id, m.page]; }));
    function syncActive() {
      var current = "start";
      PAGES.forEach(function (p) {
        var el = document.getElementById(p[1]);
        if (el && el.style.display !== "none") current = p[0];
      });
      side.querySelectorAll(".fc-side-btn").forEach(function (b) {
        b.classList.toggle("active", b.dataset.fcTarget === current);
      });
    }
    var observer = new MutationObserver(syncActive);
    PAGES.forEach(function (p) {
      var el = document.getElementById(p[1]);
      if (el) observer.observe(el, { attributes: true, attributeFilter: ["style"] });
    });
    syncActive();

    /* ── Konfiguration als Akkordeon: die vorhandene Titelzeile wird zur Klappflaeche ──
       Kein separater Knopf, kein leerer Streifen. Der erste .fb-sidebar-title
       ("Konfiguration") bekommt einen Pfeil und schaltet einen Huell-Container. */
    var CHEV = '<svg class="fc-acc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<polyline points="6 9 12 15 18 9"/></svg>';

    function angleicheStreifenHoehe(sb) {
      /* Streifen exakt so hoch wie der Inhalt daneben (fb-main mit Tabelle) */
      var layout = sb.closest(".fb-layout");
      var main = layout && layout.querySelector(".fb-main");
      if (sb.classList.contains("fc-acc-off") && main) {
        var h = main.getBoundingClientRect().height;
        if (h > 0) sb.style.height = Math.round(h) + "px";
      } else {
        sb.style.height = "";   /* aufgeklappt: natuerliche Hoehe */
      }
    }
    function accSet(sb, off, merken) {
      sb.classList.toggle("fc-acc-off", off);
      var head = sb.querySelector(".fc-acc-head");
      if (head) head.setAttribute("aria-expanded", off ? "false" : "true");
      angleicheStreifenHoehe(sb);
      /* bei spaeteren Groessenaenderungen (Tabelle waechst) nachfuehren */
      if (off) {
        setTimeout(function () { angleicheStreifenHoehe(sb); }, 60);
      }
      if (merken) { try { localStorage.setItem("fc_cfg_off", off ? "1" : "0"); } catch (e) {} }
    }
    /* Bei Fenstergroessen-Aenderung eingeklappte Streifen nachfuehren */
    window.addEventListener("resize", function () {
      document.querySelectorAll(".fb-sidebar.fc-acc-off").forEach(angleicheStreifenHoehe);
    });

    /* Standard: eingeklappt (Streifen), bis der Nutzer selbst aufklappt */
    var savedOff = true;
    try {
      var stored = localStorage.getItem("fc_cfg_off");
      if (stored !== null) savedOff = (stored === "1");
    } catch (e) {}

    MODULE.forEach(function (m) {
      var sb = document.querySelector("#" + m.page + " .fb-sidebar");
      if (!sb || sb.querySelector(".fc-acc-head")) return;
      var title = sb.querySelector(".fb-sidebar-title");
      if (!title) return;

      /* Titelzeile zur klickbaren Kopfzeile machen */
      title.classList.add("fc-acc-head");
      title.setAttribute("role", "button");
      title.setAttribute("tabindex", "0");
      title.insertAdjacentHTML("beforeend", CHEV);

      /* Alle Geschwister NACH dem Titel in einen aufklappbaren Koerper packen */
      var body = document.createElement("div");
      body.className = "fc-acc-body";
      var node = title.nextSibling;
      while (node) {
        var next = node.nextSibling;
        body.appendChild(node);
        node = next;
      }
      sb.appendChild(body);

      function toggle(ev) {
        ev.stopPropagation();
        accSet(sb, !sb.classList.contains("fc-acc-off"), true);
      }
      title.addEventListener("click", toggle);
      title.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(ev); }
      });

      accSet(sb, savedOff, false);

      /* Modul-Titel oben in den Inhaltsbereich setzen.
         Zeitnachweis hat einen eigenen (zn-redesign) -> hier ueberspringen. */
      var main = document.querySelector("#" + m.page + " .fb-main");
      if (m.page !== "zeitnachweisPage" && main && !main.querySelector(".fc-mod-head")) {
        var head = document.createElement("div");
        head.className = "fc-mod-head";
        head.innerHTML = "<h2>" + m.label + "</h2><p>Aufgabe waehlen oder Konfiguration anpassen</p>";
        main.insertBefore(head, main.firstChild);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
