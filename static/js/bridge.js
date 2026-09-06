/* Bruecke: die zentrale Mitarbeiter-Liste fliesst automatisch in
   Zeitnachweis und Lohn ein.

   Vorgehen: Wir fangen die beiden Anfragen ab, mit denen die Module ihre
   Mitarbeiter laden (/zn/stammdaten und /lohn/stammdaten), und mischen die
   zentral gepflegten Mitarbeiter dazu. Die Module selbst bleiben unveraendert.
   Faellt etwas aus, liefern wir einfach die Original-Antwort zurueck. */
(function () {
  if (new URLSearchParams(location.search).get("classic") === "1") return;

  var token = null;
  try { token = localStorage.getItem("fc_token") || localStorage.getItem("token"); } catch (e) {}
  function authHeaders() { return token ? { "Authorization": "Bearer " + token } : {}; }

  var originalFetch = window.fetch.bind(window);

  /* Zentrale Liste kurz zwischenspeichern, damit nicht jedes Modul neu laedt */
  var cache = { zeit: 0, namen: null };
  function zentraleNamen() {
    var jetzt = Date.now();
    if (cache.namen && (jetzt - cache.zeit) < 20000) {
      return Promise.resolve(cache.namen);
    }
    var kopf = authHeaders();
    try { var mm = localStorage.getItem("fc_mandant"); if (mm) kopf["X-Mandant"] = String(mm); } catch (e) {}
    return originalFetch("/mitarbeiter", { headers: kopf })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var liste = (d && d.mitarbeiter) ? d.mitarbeiter.filter(function (m) { return m.aktiv; }) : [];
        cache.namen = liste;
        cache.zeit = Date.now();
        return liste;
      })
      .catch(function () { return []; });
  }

  function istStammdatenAnfrage(url) {
    return /^(https?:\/\/[^/]+)?\/(zn|lohn)\/stammdaten(\?|$)/.test(url);
  }

  function mischen(original, zentral) {
    var vorhanden = {};
    var liste = (original && original.mitarbeiter) ? original.mitarbeiter.slice() : [];
    liste.forEach(function (m) {
      if (m && m.name) vorhanden[String(m.name).trim().toLowerCase()] = true;
    });
    zentral.forEach(function (m) {
      if (!m || !m.name) return;
      var schluessel = String(m.name).trim().toLowerCase();
      if (vorhanden[schluessel]) return;
      // Format, das die Module erwarten: { name: "..." }
      liste.push({ name: m.name });
      vorhanden[schluessel] = true;
    });
    var ergebnis = original ? JSON.parse(JSON.stringify(original)) : {};
    ergebnis.mitarbeiter = liste;
    return ergebnis;
  }

  /* Aktiver Mandant: wird als Kopfzeile an jede Anfrage gehaengt,
     damit alle Module im richtigen Betrieb arbeiten. */
  function mandantKopf(optionen) {
    var m = null;
    try { m = localStorage.getItem("fc_mandant"); } catch (e) {}
    if (!m) return optionen;
    var o = optionen ? Object.assign({}, optionen) : {};
    var h = Object.assign({}, o.headers || {});
    h["X-Mandant"] = String(m);
    o.headers = h;
    return o;
  }

  window.fetch = function (eingabe, optionen) {
    var url = (typeof eingabe === "string") ? eingabe : (eingabe && eingabe.url) || "";
    optionen = mandantKopf(optionen);
    if (!istStammdatenAnfrage(url)) {
      return originalFetch(eingabe, optionen);
    }
    var antwort;
    return originalFetch(eingabe, optionen)
      .then(function (r) {
        antwort = r;
        if (!r.ok) return null;
        return r.clone().json().catch(function () { return null; });
      })
      .then(function (daten) {
        if (daten === null) return antwort;      // nichts zu mischen
        return zentraleNamen().then(function (zentral) {
          if (!zentral.length) return antwort;   // keine zentralen Mitarbeiter
          var neu = mischen(daten, zentral);
          return new Response(JSON.stringify(neu), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        });
      })
      .catch(function () { return antwort || originalFetch(eingabe, optionen); });
  };

  /* Wird ein Mitarbeiter zentral geaendert, soll die naechste Modul-Anfrage
     die neue Liste sehen - deshalb den Zwischenspeicher leeren. */
  window.fcMitarbeiterGeaendert = function () { cache.namen = null; cache.zeit = 0; };
})();
