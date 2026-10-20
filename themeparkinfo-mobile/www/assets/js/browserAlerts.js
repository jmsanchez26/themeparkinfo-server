(function () {
  // Native apps keep their existing notification delivery path.
  if (window.Capacitor?.isNativePlatform?.()) return;
  const parks = ['wdw', 'disneyland', 'usorlando', 'hollywood'];
  const normalize = value => String(value || '').toLowerCase().replace(/^ushollywood$/, 'hollywood');
  let pending;
  function read() {
    try {
      const alerts = JSON.parse(localStorage.getItem('waitTimeAlerts') || '[]');
      return Array.isArray(alerts) ? alerts : [];
    } catch { return []; }
  }
  function show(alerts) {
    let dialog = document.getElementById('browserWaitAlert');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'browserWaitAlert';
      dialog.setAttribute('aria-label', 'Wait time alerts');
      document.body.appendChild(dialog);
      const title = document.createElement('h2');
      title.textContent = 'Wait Time Alerts';
      dialog.appendChild(title);
      const list = document.createElement('div');
      list.className = 'browser-alert-messages';
      dialog.appendChild(list);
      const close = document.createElement('button');
      close.textContent = 'OK';
      close.onclick = () => { dialog.close(); list.replaceChildren(); };
      dialog.appendChild(close);
    }
    const list = dialog.querySelector('.browser-alert-messages');
    if (!dialog.open) list.replaceChildren();
    for (const alert of alerts) {
      const message = document.createElement('p');
      message.textContent = `${alert.name}: ${alert.isDown ? 'Currently down' : alert.mode === 'good_time'
        ? `Wait dropped to ${alert.currentWait} min. It is a good time to ride!`
        : `Now ${alert.currentWait} min (alert: ${alert.waitTime} min)`}`;
      list.appendChild(message);
    }
    if (!dialog.open) dialog.showModal();
  }
  async function check() {
    if (pending) return pending;
    pending = (async () => {
      const saved = read();
      if (!saved.length) return;
      const requested = saved.some(alert => !parks.includes(normalize(alert.park)))
        ? parks : [...new Set(saved.map(alert => normalize(alert.park)))];
      const snapshots = await Promise.all(requested.map(async park => {
        try {
          const response = await fetch((window.__API_BASE__ || '') + '/api/' + park,
            { cache: 'no-store', signal: AbortSignal.timeout(15000) });
          if (!response.ok) return { park, rides: [] };
          const payload = await response.json();
          return { park, rides: Array.isArray(payload.data?.liveData) ? payload.data.liveData : [] };
        } catch { return { park, rides: [] }; }
      }));
      // Respect edits/deletions that occurred while fetching.
      const current = read(), triggered = [];
      const before = JSON.stringify(current);
      for (const alert of current) {
        const matches = snapshots.flatMap(snapshot => {
          if (alert.park && normalize(alert.park) !== snapshot.park) return [];
          return snapshot.rides.filter(ride => ride.entityType === 'ATTRACTION' &&
            (alert.rideId ? ride.id === alert.rideId : ride.name === alert.name))
            .map(ride => ({ park: snapshot.park, ride }));
        });
        if (matches.length !== 1) continue;
        const { park, ride } = matches[0];
        const result = window.AlertRules.evaluate(alert, ride);
        if (result.isTriggered && (alert.mode === 'good_time' || !alert.triggeredAt)) {
          alert.triggeredAt = new Date().toISOString();
          triggered.push({ ...alert, ...result });
        }
        alert.park = park;
        alert.rideId = ride.id;
        alert.lastObservedWait = window.AlertRules.observation(ride);
      }
      if (triggered.length) show(triggered);
      const after = JSON.stringify(current);
      if (after !== before) localStorage.setItem('waitTimeAlerts', after);
    })().finally(() => { pending = null; });
    return pending;
  }
  const refresh = () => { check().catch(error => console.warn('Browser alert check failed:', error.message)); };
  window.BrowserAlerts = { check };
  document.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('storage', event => { if (event.key === 'waitTimeAlerts') refresh(); });
  window.addEventListener('local-alerts-changed', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(refresh, 30000);
})();
