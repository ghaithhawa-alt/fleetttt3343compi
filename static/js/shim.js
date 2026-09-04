/* FleetCompliance Login-Shim
   Wird vom Server automatisch in das Dashboard injiziert.
   Aufgaben:
   1. Ohne Login-Token -> zurueck zur Anmeldeseite
   2. Haengt den Token an ALLE Anfragen des Dashboards (fetch + XMLHttpRequest)
   3. Bei abgelaufener Sitzung (401) -> zurueck zur Anmeldeseite
   Die Dashboard-Datei selbst bleibt unveraendert. */
(function () {
  var KEY = "fc_token";

  function tok() { return localStorage.getItem(KEY); }
  function toLogin() { localStorage.removeItem(KEY); location.href = "/app/"; }

  if (!tok()) { toLogin(); return; }

  function sameOrigin(url) {
    if (!url) return false;
    if (url.startsWith("/")) return true;
    try { return new URL(url, location.origin).origin === location.origin; }
    catch (e) { return false; }
  }

  /* fetch patchen */
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    init = init || {};
    var url = (typeof input === "string") ? input : (input && input.url) || "";
    var so = sameOrigin(url);
    if (so) {
      var h = new Headers(init.headers || (typeof input !== "string" && input.headers) || {});
      h.set("Authorization", "Bearer " + tok());
      init.headers = h;
    }
    return origFetch(input, init).then(function (res) {
      if (so && res.status === 401) { toLogin(); }
      return res;
    });
  };

  /* XMLHttpRequest patchen (falls das Dashboard XHR nutzt) */
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__fc_same_origin = sameOrigin(url);
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__fc_same_origin) {
      try { this.setRequestHeader("Authorization", "Bearer " + tok()); } catch (e) {}
      this.addEventListener("load", function () {
        if (this.status === 401) { toLogin(); }
      });
    }
    return origSend.apply(this, arguments);
  };
})();
