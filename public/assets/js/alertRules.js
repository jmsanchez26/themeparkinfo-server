(function (root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.AlertRules = rules;
})(typeof window === 'undefined' ? globalThis : window, function () {
  function forecastInsight(currentWait, forecast, now = Date.now()) {
    const future = (Array.isArray(forecast) ? forecast : []).filter(point =>
      Number.isFinite(point.waitTime) && point.waitTime >= 0 && Date.parse(point.time) >= now
    ).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    if (!Number.isFinite(currentWait) || !future.length) return [null, false, currentWait, null];
    const average = Math.round(future.reduce((sum, point) => sum + point.waitTime, 0) / future.length);
    const lowest = Math.min(currentWait, ...future.slice(0, 2).map(point => point.waitTime));
    const willDrop = lowest < currentWait;
    const goodTime = Math.abs(currentWait - average) <= 4 || currentWait < average || !willDrop || currentWait < 20;
    return [goodTime, willDrop, lowest, average];
  }

  function evaluate(alert, ride, now = Date.now()) {
    const status = ride?.status || 'Unknown';
    const currentWait = ride?.queue?.STANDBY?.waitTime ?? ride?.waitTime ?? null;
    const operating = status.toLowerCase() === 'operating';
    const hasWait = Number.isFinite(currentWait) && currentWait >= 0;
    const goodTimeToRide = forecastInsight(currentWait, ride?.forecast, now)[0];
    const isDown = ['down', 'closed', 'refurbishment'].includes(status.toLowerCase());
    const isTriggered = alert.mode === 'good_time'
      ? operating && hasWait && Number.isFinite(alert.lastObservedWait) && currentWait < alert.lastObservedWait && goodTimeToRide === true
      : (operating && hasWait && currentWait <= alert.waitTime) || isDown;
    return { status, currentWait, isTriggered: Boolean(isTriggered), isDown, goodTimeToRide };
  }

  function observation(ride) {
    const wait = ride?.queue?.STANDBY?.waitTime ?? ride?.waitTime;
    return String(ride?.status).toLowerCase() === 'operating' && Number.isFinite(wait) && wait >= 0 ? wait : null;
  }
  return { forecastInsight, evaluate, observation };
});
