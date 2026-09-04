/* Team-Zugaenge: Seite "Team" unter Verwaltung.
   Nur sichtbar fuer den Inhaber einer Firma, deren Tarif das Modul enthaelt.
   Kollegen anlegen, Rolle vergeben, sperren, Einmal-Passwort erzeugen. */
(function () {
  if (new URLSearchParams(location.search).get("classic") === "1") return;

  var token = null;
  try { token = localStorage.getItem("fc_token") || localStorage.getItem("token"); } catch (e) {}

  function kopf(extra) {
    var h = extra || {};
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  /* Dialoge im Dashboard-Design, mit Rueckfall auf die Browser-Dialoge. */
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

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'
    + '<path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

  var ZUSTAND = { team: [], belegt: 0, grenze: 1, rollen: [] };
  var ICH = null;              // eigene Benutzer-ID, damit man sich selbst erkennt
  var DARF = false;            // Modul freigeschaltet und Rolle "inhaber"?

  /* ── Seite aufbauen ───────────────────────────────────────────── */
  function buildPage() {
    if (document.getElementById("teamPage")) return;
    var page = document.createElement("div");
    page.id = "teamPage";
    page.className = "container tm-page";
    page.style.display = "none";
    page.innerHTML =
      '<div class="tm-head">'
      +   '<div><h2>Team</h2>'
      +     '<p>Wer in diesem Betrieb mitarbeitet – und was er darf.</p></div>'
      +   '<div class="tm-plaetze" id="tmPlaetze"></div>'
      + '</div>'
      + '<div class="tm-table-wrap">'
      +   '<table class="tm-table"><thead><tr>'
      +     '<th>Name</th><th>E-Mail</th><th>Rolle</th><th>Zuletzt angemeldet</th><th></th>'
      +   '</tr></thead><tbody id="tmBody"></tbody></table>'
      + '</div>'
      + '<div class="tm-cards">'
      +   '<div class="tm-card">'
      +     '<div class="tm-card-title">Kollegen hinzufügen</div>'
      +     '<p class="tm-card-sub">Der Kollege bekommt ein Einmal-Passwort. '
      +       'Beim ersten Anmelden wählt er sein eigenes.</p>'
      +     '<div class="tm-felder">'
      +       '<div><label for="tmName">Name</label>'
      +         '<input id="tmName" type="text" placeholder="z.B. Aylin K." autocomplete="off"></div>'
      +       '<div><label for="tmMail">E-Mail</label>'
      +         '<input id="tmMail" type="email" placeholder="name@betrieb.de" autocomplete="off"></div>'
      +       '<div><label for="tmRolle">Rolle</label>'
      +         '<select id="tmRolle"></select></div>'
      +     '</div>'
      +     '<button class="tm-btn tm-btn-green" id="tmAddBtn">Zugang anlegen</button>'
      +     '<div class="tm-msg" id="tmMsg"></div>'
      +   '</div>'
      +   '<div class="tm-card tm-card-info">'
      +     '<div class="tm-card-title">Was die Rollen dürfen</div>'
      +     '<ul class="tm-rollen-liste">'
      +       '<li><b>Inhaber</b><span>Alles – und nur er verwaltet das Team.</span></li>'
      +       '<li><b>Buchhaltung</b><span>Zeitnachweis, Lohn, Kassenbuch, Mitarbeiter, Verträge.</span></li>'
      +       '<li><b>Disposition</b><span>Zeitnachweis und Fahrtenbuch. Mitarbeiter nur ansehen.</span></li>'
      +       '<li><b>Nur lesen</b><span>Sieht alle Module, ändert nichts.</span></li>'
      +       '<li><b>Fahrer</b><span>Später: sieht nur die eigenen Daten.</span></li>'
      +     '</ul>'
      +   '</div>'
      + '</div>';
    var anker = document.getElementById("startPage");
    if (anker && anker.parentNode) anker.parentNode.appendChild(page);
    else document.body.appendChild(page);

    baueDialog();
  }

  /* ── Dialog: Einmal-Passwort einmalig anzeigen ─────────────────── */
  function baueDialog() {
    if (document.getElementById("tmPwBackdrop")) return;
    var d = document.createElement("div");
    d.innerHTML =
      '<div class="tm-backdrop" id="tmPwBackdrop" style="display:none"></div>'
      + '<div class="tm-modal" id="tmPwModal" style="display:none" role="dialog" aria-modal="true"'
      +      ' aria-labelledby="tmPwTitel">'
      +   '<h3 id="tmPwTitel">Zugang angelegt</h3>'
      +   '<p class="tm-modal-sub" id="tmPwSub"></p>'
      +   '<div class="tm-pw-box"><code id="tmPwWert"></code>'
      +     '<button class="tm-btn tm-btn-klein" id="tmPwKopieren" type="button">Kopieren</button></div>'
      +   '<p class="tm-modal-warn">Dieses Passwort wird <b>nicht noch einmal</b> angezeigt. '
      +     'Gib es dem Kollegen weiter – er ändert es beim ersten Anmelden selbst.</p>'
      +   '<div class="tm-modal-foot">'
      +     '<button class="tm-btn tm-btn-green" id="tmPwFertig" type="button">Fertig</button>'
      +   '</div>'
      + '</div>';
    while (d.firstChild) document.body.appendChild(d.firstChild);

    document.getElementById("tmPwFertig").onclick = pwDialogZu;
    document.getElementById("tmPwBackdrop").onclick = pwDialogZu;
    document.getElementById("tmPwKopieren").onclick = function () {
      var wert = document.getElementById("tmPwWert").textContent;
      var knopf = this;
      function fertig() { knopf.textContent = "Kopiert"; setTimeout(function () { knopf.textContent = "Kopieren"; }, 1800); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(wert).then(fertig).catch(markieren);
      } else { markieren(); }
      function markieren() {
        var r = document.createRange();
        r.selectNodeContents(document.getElementById("tmPwWert"));
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        knopf.textContent = "Markiert – Strg+C";
      }
    };
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.getElementById("tmPwModal").style.display === "block") pwDialogZu();
    });
  }

  function pwDialogZeigen(name, passwort) {
    document.getElementById("tmPwSub").textContent =
      (name ? name + " kann sich jetzt anmelden." : "Der Zugang ist bereit.")
      + " Das Einmal-Passwort lautet:";
    document.getElementById("tmPwWert").textContent = passwort;
    document.getElementById("tmPwKopieren").textContent = "Kopieren";
    document.getElementById("tmPwBackdrop").style.display = "block";
    document.getElementById("tmPwModal").style.display = "block";
  }
  function pwDialogZu() {
    document.getElementById("tmPwBackdrop").style.display = "none";
    document.getElementById("tmPwModal").style.display = "none";
  }

  /* ── Daten laden und darstellen ────────────────────────────────── */
  function laden() {
    return fetch("/team", { headers: kopf() })
      .then(function (r) {
        if (r.status === 403) { DARF = false; return null; }
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        ZUSTAND = d;
        zeichnen();
      })
      .catch(function () {});
  }

  function zeichnen() {
    var body = document.getElementById("tmBody");
    if (!body) return;
    var frei = (ZUSTAND.grenze || 1) - (ZUSTAND.belegt || 0);

    var plaetze = document.getElementById("tmPlaetze");
    plaetze.innerHTML =
      '<span class="tm-plaetze-zahl">' + ZUSTAND.belegt + ' von ' + ZUSTAND.grenze + '</span>'
      + '<span class="tm-plaetze-text">Plätzen belegt</span>';
    plaetze.className = "tm-plaetze" + (frei <= 0 ? " tm-plaetze-voll" : "");

    body.innerHTML = (ZUSTAND.team || []).map(function (u) {
      var ichSelbst = (ICH != null && u.id === ICH);
      var knoepfe = "";
      if (!ichSelbst) {
        knoepfe = '<button class="tm-mini" data-tm-pw="' + u.id + '" type="button">Neues Passwort</button>'
          + '<button class="tm-mini ' + (u.aktiv ? "tm-mini-rot" : "") + '" data-tm-sperr="' + u.id
          + '" data-tm-aktiv="' + (u.aktiv ? "0" : "1") + '" type="button">'
          + (u.aktiv ? "Sperren" : "Entsperren") + '</button>';
      } else {
        knoepfe = '<span class="tm-du">das bist du</span>';
      }
      var rollenWahl = '<select class="tm-rollensel" data-tm-rolle="' + u.id + '"'
        + (ichSelbst ? " disabled" : "") + '>'
        + (ZUSTAND.rollen || []).map(function (r) {
            return '<option value="' + r.key + '"' + (r.key === u.rolle ? " selected" : "") + '>'
              + esc(r.name) + '</option>';
          }).join("")
        + '</select>';
      return '<tr' + (u.aktiv ? "" : ' class="tm-gesperrt"') + '>'
        + '<td><span class="tm-name">'
        +   esc(u.name || String(u.email || "").split("@")[0]) + '</span>'
        +   (u.aktiv ? "" : ' <span class="tm-badge tm-badge-rot">gesperrt</span>')
        +   (u.passwort_offen ? ' <span class="tm-badge">Passwort offen</span>' : "")
        + '</td>'
        + '<td class="tm-mail">' + esc(u.email) + '</td>'
        + '<td>' + rollenWahl + '</td>'
        + '<td class="tm-zeit">' + (u.letzte_anmeldung ? esc(u.letzte_anmeldung) : "noch nie") + '</td>'
        + '<td class="tm-akt">' + knoepfe + '</td>'
        + '</tr>';
    }).join("");

    // Rollen-Auswahl im Formular
    var sel = document.getElementById("tmRolle");
    if (sel && !sel.options.length) {
      sel.innerHTML = (ZUSTAND.rollen || [])
        .filter(function (r) { return r.key !== "inhaber"; })
        .map(function (r) { return '<option value="' + r.key + '">' + esc(r.name) + '</option>'; })
        .join("");
    }

    var add = document.getElementById("tmAddBtn");
    if (add) {
      add.disabled = frei <= 0;
      add.textContent = frei <= 0 ? "Alle Plätze belegt" : "Zugang anlegen";
    }

    body.querySelectorAll("[data-tm-sperr]").forEach(function (b) {
      b.onclick = function () { sperren(Number(b.dataset.tmSperr), b.dataset.tmAktiv === "1"); };
    });
    body.querySelectorAll("[data-tm-pw]").forEach(function (b) {
      b.onclick = function () { passwortNeu(Number(b.dataset.tmPw)); };
    });
    body.querySelectorAll("[data-tm-rolle]").forEach(function (s) {
      s.onchange = function () { rolleAendern(Number(s.dataset.tmRolle), s.value); };
    });
  }

  function meldung(text, art) {
    var m = document.getElementById("tmMsg");
    if (!m) return;
    m.textContent = text || "";
    m.className = "tm-msg" + (art ? " tm-msg-" + art : "");
  }

  function fehlertext(r) {
    return r.json().then(function (d) { return (d && d.detail) || "Das hat nicht geklappt."; })
      .catch(function () { return "Das hat nicht geklappt."; });
  }

  /* ── Aktionen ─────────────────────────────────────────────────── */
  function anlegen() {
    var name = document.getElementById("tmName").value.trim();
    var mail = document.getElementById("tmMail").value.trim();
    var rolle = document.getElementById("tmRolle").value;
    if (!mail) { meldung("Bitte eine E-Mail-Adresse eintragen.", "fehler"); return; }
    meldung("");
    fetch("/team", {
      method: "POST",
      headers: kopf({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: name, email: mail, rolle: rolle })
    }).then(function (r) {
      if (!r.ok) return fehlertext(r).then(function (t) { meldung(t, "fehler"); });
      return r.json().then(function (d) {
        document.getElementById("tmName").value = "";
        document.getElementById("tmMail").value = "";
        meldung("");
        pwDialogZeigen(d.name || d.email, d.einmal_passwort);
        laden();
      });
    }).catch(function () { meldung("Verbindung fehlgeschlagen.", "fehler"); });
  }

  function sperren(id, aktiv) {
    var u = (ZUSTAND.team || []).filter(function (x) { return x.id === id; })[0] || {};
    var wer = u.name || u.email || "diesen Zugang";
    function ausfuehren() {
      fetch("/team/" + id + "/sperren", {
        method: "POST",
        headers: kopf({ "Content-Type": "application/json" }),
        body: JSON.stringify({ aktiv: aktiv })
      }).then(function (r) {
        if (!r.ok) return fehlertext(r).then(function (t) { fcInfo("Nicht möglich", t, "warn"); });
        laden();
      }).catch(function () {});
    }
    if (aktiv) { ausfuehren(); return; }
    fcFrage("Zugang sperren?",
      wer + " kann sich danach nicht mehr anmelden. Der Zugang bleibt erhalten "
      + "und kann jederzeit wieder freigegeben werden.",
      "warn", "Sperren", ausfuehren);
  }

  function rolleAendern(id, rolle) {
    fetch("/team/" + id, {
      method: "PUT",
      headers: kopf({ "Content-Type": "application/json" }),
      body: JSON.stringify({ rolle: rolle })
    }).then(function (r) {
      if (!r.ok) return fehlertext(r).then(function (t) { fcInfo("Nicht möglich", t, "warn"); laden(); });
      laden();
    }).catch(function () { laden(); });
  }

  function passwortNeu(id) {
    var u = (ZUSTAND.team || []).filter(function (x) { return x.id === id; })[0] || {};
    fcFrage("Neues Einmal-Passwort?",
      "Das bisherige Passwort von " + (u.name || u.email) + " gilt dann nicht mehr.",
      "warn", "Erzeugen", function () {
        fetch("/team/" + id + "/passwort-neu", { method: "POST", headers: kopf() })
          .then(function (r) {
            if (!r.ok) return fehlertext(r).then(function (t) { fcInfo("Nicht möglich", t, "warn"); });
            return r.json().then(function (d) {
              pwDialogZeigen(d.name || d.email, d.einmal_passwort);
              laden();
            });
          }).catch(function () {});
      });
  }

  /* ── Seite zeigen / verstecken ─────────────────────────────────── */
  function verstecken() {
    var p = document.getElementById("teamPage");
    if (p) p.style.display = "none";
  }

  function showPage() {
    if (typeof window.alleSeitenAus === "function") window.alleSeitenAus();
    ["startPage", "zeitnachweisPage", "buchPage", "lohnPage", "fahrtenbuchPage",
     "mitarbeiterPage", "settingsPage", "firmenPage"].forEach(function (id) {
      var e = document.getElementById(id); if (e) e.style.display = "none";
    });
    document.getElementById("teamPage").style.display = "block";
    laden();
    window.scrollTo({ top: 0 });
  }
  window.openTeamPage = showPage;

  /* ── Seitenleisten-Knopf ───────────────────────────────────────── */
  function sidebarKnopf() {
    var side = document.querySelector(".fc-shell-side, aside.fc-side, .fc-side, [aria-label='Module']");
    if (!side) return false;
    if (side.querySelector('[data-fc-target="team"]')) return true;

    var kontoLabel = [].slice.call(side.querySelectorAll(".fc-side-label"))
      .filter(function (l) { return l.textContent === "Konto"; })[0];
    if (!kontoLabel) return false;      // Seitenleiste noch nicht fertig

    if (!side.querySelector(".fc-side-label-verwaltung")) {
      var lbl = document.createElement("div");
      lbl.className = "fc-side-label fc-side-label-verwaltung";
      lbl.textContent = "Verwaltung";
      side.insertBefore(lbl, kontoLabel);
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fc-side-btn";
    btn.dataset.fcTarget = "team";
    btn.innerHTML = ICON + "<span>Team</span>";
    btn.onclick = showPage;
    side.insertBefore(btn, kontoLabel);

    // Wird ein anderer Punkt geklickt, verschwindet die Team-Seite mit.
    side.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".fc-side-btn") : null;
      if (b && b.dataset.fcTarget !== "team") verstecken();
    }, true);
    document.addEventListener("click", function (e) {
      var k = e.target && e.target.closest ? e.target.closest(".start-mod") : null;
      if (k) verstecken();
    }, true);
    return true;
  }

  /* ── Start ─────────────────────────────────────────────────────── */
  function init() {
    // Nur aufbauen, wenn dieses Konto das Team wirklich verwalten darf.
    fetch("/me", { headers: kopf() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (mich) {
        if (!mich) return;
        ICH = mich.id != null ? mich.id : null;
        var rechte = mich.rechte || [];
        DARF = mich.superadmin === true || rechte.indexOf("team") >= 0;
        if (!DARF) return;
        return fetch("/license-status", { headers: kopf() })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (lic) {
            if (!lic || !lic.ok) return;
            var module = lic.modules || [];
            if (module.indexOf("teamzugaenge") < 0) return;   // Tarif ohne Team
            buildPage();
            document.getElementById("tmAddBtn").onclick = anlegen;
            document.getElementById("tmMail").addEventListener("keydown", function (e) {
              if (e.key === "Enter") anlegen();
            });
            var versuche = 0;
            var iv = setInterval(function () {
              versuche++;
              if (sidebarKnopf() || versuche > 100) clearInterval(iv);
            }, 100);
          });
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
