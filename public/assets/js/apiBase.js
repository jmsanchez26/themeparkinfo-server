(function () {
  const isNative =
    !!window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === "function" &&
    window.Capacitor.isNativePlatform();

  // Put your Render URL here
  const BACKEND_BASE_URL = "https://themeparkinfo-api.onrender.com";

  window.__API_BASE__ = isNative ? BACKEND_BASE_URL : "";
})();