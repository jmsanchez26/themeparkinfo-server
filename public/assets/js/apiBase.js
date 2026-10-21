(function () {
  const isNative =
    !!window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === "function" &&
    window.Capacitor.isNativePlatform();

  // Put your Render URL here
  const BACKEND_BASE_URL = "https://themeparkinfo-api.onrender.com";

  window.__API_BASE__ = isNative ? BACKEND_BASE_URL : "";
})();
// Cache public park snapshots only; private account and alert responses are excluded.
(function () {
  const maxAge = 10 * 60 * 1000;
  function key(url) {
    const parsed = new URL(url, location.href);
    const base = new URL(window.__API_BASE__ || location.origin);
    if (parsed.origin !== base.origin || !/^\/api\/(wdw|disneyland|usorlando|hollywood)$/i.test(parsed.pathname)) return null;
    return 'scout-park-snapshot:' + parsed.pathname.toLowerCase();
  }
  window.ParkDataCache = {
    read(url) {
      try {
        const name = key(url);
        if (!name) return null;
        const saved = JSON.parse(sessionStorage.getItem(name) || 'null');
        const age = Date.now() - saved?.savedAt;
        return age >= 0 && age < maxAge && Array.isArray(saved?.payload?.data?.liveData) ? saved : null;
      } catch { return null; }
    },
    write(url, payload) {
      try {
        const name = key(url);
        if (name && !payload.error && Array.isArray(payload?.data?.liveData)) {
          sessionStorage.setItem(name, JSON.stringify({ savedAt: Date.now(), payload }));
        }
      } catch { /* Storage limits must never interrupt live updates. */ }
    }
  };
})();
