(function () {
  const key = 'privateAlertCredentialV1';
  function credential() {
    let value = localStorage.getItem(key);
    if (!/^[a-f0-9]{64}$/.test(value || '')) {
      value = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(key, value);
    }
    return value;
  }
  async function request(path, options = {}) {
    if (!/^\/api\/(alerts|alert-devices)(\/|$)/.test(path)) throw new Error('Invalid private API path');
    const response = await fetch((window.__API_BASE__ || '') + path, {
      ...options, cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { ...options.headers, Authorization: 'Bearer ' + credential() }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Alert request failed (' + response.status + ')');
    }
    return response;
  }
  let verification = null;
  async function verifyDevice(token, push) {
    if (verification) return verification;
    verification = (async () => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const current = await (await request('/api/alert-devices')).json();
      if (current.verified && current.tokenHash === tokenHash) return;
      let listener, timer, received, expectedId;
      let resolveProof;
      const proofReceived = new Promise((resolve, reject) => {
        resolveProof = resolve;
        timer = setTimeout(() => reject(new Error('Device verification timed out. Keep the app open and try again.')), 30000);
      });
      // Handle rejection even if the HTTP challenge request fails first.
      proofReceived.catch(() => {});
      try {
        listener = await push.addListener('pushNotificationReceived', event => {
          const data = event.data;
          if (data?.source !== 'device-verification') return;
          if (expectedId && data.challengeId === expectedId) resolveProof(data.proof);
          else received = data;
        });
        const result = await (await request('/api/alert-devices/challenge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceToken: token })
        })).json();
        expectedId = result.challengeId;
        if (received?.challengeId === expectedId) resolveProof(received.proof);
        const proof = await proofReceived;
        await request('/api/alert-devices/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: expectedId, proof })
        });
      } finally {
        clearTimeout(timer);
        await listener?.remove();
      }
    })().finally(() => { verification = null; });
    return verification;
  }
  window.AlertSecurity = { request, verifyDevice, async deleteAll() {
    await request('/api/alert-devices', { method: 'DELETE' });
    await window.Capacitor?.Plugins?.PushNotifications?.unregister?.();
    localStorage.removeItem('pushDeviceToken');
    localStorage.removeItem('waitTimeAlerts');
    localStorage.removeItem(key);
  } };
})();
