import { initializeApp } from 'firebase/app';
import { signInWithGoogle as signInWithAndroidGoogle } from './google-signin.cjs';
import { getAuth, connectAuthEmulator, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signInAnonymously, signOut, reload, browserLocalPersistence, setPersistence } from 'firebase/auth';

(function () {
  const nativeFetch = window.fetch.bind(window);
  const android = window.Capacitor?.getPlatform?.() === 'android';
  const native = android ? window.Capacitor?.Plugins?.FirebaseAuthentication : null;
  const base = window.Capacitor?.isNativePlatform?.() ? 'https://themeparkinfo-api.onrender.com' : '';
  const loginPage = location.pathname === '/pages/login.html';
  let auth, config, currentUser, signingOut = false;
  const navigationCheckKey = 'scout-navigation-check';
  function recentAndroidCheck() {
    if (!android || !currentUser?.uid || !currentUser.emailVerified) return false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(navigationCheckKey) || 'null');
      const age = Date.now() - saved?.checkedAt;
      return saved?.uid === currentUser.uid && age >= 0 && age < 5 * 60 * 1000;
    } catch { return false; }
  }
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const profileKeys = ['favoriteRideKeys', 'waitTimeAlerts'];
  function profileKey(uid) { return 'scout-profile:' + uid; }
  function activateProfile(uid) {
    const previous = localStorage.getItem('scout-active-user');
    if (previous === uid) return;
    if (previous) localStorage.setItem(profileKey(previous), JSON.stringify(Object.fromEntries(profileKeys.map(key => [key, localStorage.getItem(key)]))));
    const saved = JSON.parse(localStorage.getItem(profileKey(uid)) || '{}');
    const legacyOwner = localStorage.getItem('scout-legacy-owner');
    if (!legacyOwner) {
      // First successful account on this installation may retain pre-login data.
      localStorage.setItem('scout-legacy-owner', uid);
    }
    for (const key of profileKeys) {
      if (saved[key] != null) localStorage.setItem(key, saved[key]);
      else if (previous || (legacyOwner && legacyOwner !== uid)) localStorage.removeItem(key);
    }
    localStorage.setItem('scout-active-user', uid);
  }
  function clearProfile() {
    const uid = localStorage.getItem('scout-active-user');
    if (uid) localStorage.setItem(profileKey(uid), JSON.stringify(Object.fromEntries(profileKeys.map(key => [key, localStorage.getItem(key)]))));
    profileKeys.forEach(key => localStorage.removeItem(key));
    localStorage.removeItem('scout-active-user');
    localStorage.removeItem('pushDeviceToken');
    sessionStorage.removeItem(navigationCheckKey);
  }
  async function token(force = false) {
    if (android) {
      if (!native) throw new Error('Update the Android app to use sign-in.');
      return (await native.getIdToken({ forceRefresh: force })).token;
    }
    if (!auth?.currentUser) throw new Error('Please sign in to continue.');
    return auth.currentUser.getIdToken(force);
  }
  async function validate(forceRefresh = false) {
    const response = await nativeFetch(base + '/api/auth/me', { headers: { 'X-Firebase-ID-Token': await token(forceRefresh) }, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not verify sign-in.');
    activateProfile(result.uid);
    if (android) {
      try { sessionStorage.setItem(navigationCheckKey, JSON.stringify({ uid: result.uid, checkedAt: Date.now() })); } catch {}
    }
    document.documentElement.classList.remove('auth-loading');
    return result;
  }
  function redirectLogin() {
    sessionStorage.removeItem(navigationCheckKey);
    if (!loginPage && !signingOut) location.replace('/pages/login.html');
  }
  const app = window.AppAuth = {
    ready, get user() { return currentUser; }, get emulator() { return Boolean(config?.emulator); },
    async google() {
      await ready;
      if (android) { await signInWithAndroidGoogle(native); currentUser = (await native.getCurrentUser()).user; }
      else { currentUser = (await signInWithPopup(auth, new GoogleAuthProvider())).user; }
      await validate(); location.replace('/index.html');
    },
    async email(email, password, signup) {
      await ready;
      if (signup) {
        if (android) { await native.createUserWithEmailAndPassword({ email, password }); await native.sendEmailVerification(); }
        else { const result = await createUserWithEmailAndPassword(auth, email, password); await sendEmailVerification(result.user); }
        currentUser = android ? (await native.getCurrentUser()).user : auth.currentUser;
        return { verificationRequired: true };
      }
      if (android) { await native.signInWithEmailAndPassword({ email, password }); currentUser = (await native.getCurrentUser()).user; }
      else { currentUser = (await signInWithEmailAndPassword(auth, email, password)).user; }
      await validate(); location.replace('/index.html');
      return {};
    },
    async reset(email) { await ready; if (android) await native.sendPasswordResetEmail({ email }); else await sendPasswordResetEmail(auth, email); },
    async resendVerification() {
      await ready;
      if (android) await native.sendEmailVerification();
      else if (auth.currentUser) await sendEmailVerification(auth.currentUser);
      else throw new Error('Sign in with your email first.');
    },
    async continueVerified() {
      await ready;
      if (android) { await native.reload(); currentUser = (await native.getCurrentUser()).user; }
      else if (auth.currentUser) { await reload(auth.currentUser); currentUser = auth.currentUser; }
      await validate(true); location.replace('/index.html');
    },
    async testUser() {
      await ready;
      if (android || !config.emulator || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Test sign-in is available only with the local emulator.');
      currentUser = (await signInAnonymously(auth)).user;
      await validate(); location.replace('/index.html');
    },
    async logout() {
      await ready;
      // Detach first; do not claim logout completed while old-device push remains registered.
      if (android && window.AlertSecurity) {
        await window.AlertSecurity.request('/api/alert-devices/detach', { method: 'POST' });
        await window.Capacitor?.Plugins?.PushNotifications?.unregister?.();
      }
      signingOut = true;
      if (android) await native.signOut(); else await signOut(auth);
      clearProfile(); currentUser = null;
      location.replace('/pages/login.html');
    }
  };
  // Existing app data loaders all use fetch. Authenticate only the fixed backend API,
  // never send an identity token to schedules, maps, CDN assets, or another origin.
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const target = new URL(base || location.origin);
    if (url.origin !== target.origin || !url.pathname.startsWith('/api/') || url.pathname === '/api/auth/config') return nativeFetch(input, options);
    await ready;
    if (!currentUser) { redirectLogin(); throw new Error('Please sign in to continue.'); }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(options?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('X-Firebase-ID-Token', await token());
    const response = await nativeFetch(input, { ...options, headers });
    if (response.status === 401) redirectLogin();
    return response;
  };
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  window.addEventListener('storage', event => { if (event.key === 'scout-active-user') location.reload(); });
  (async () => {
    if (android) {
      // Native Firebase already has its configuration in google-services.json.
      config = { emulator: false };
      if (!native) throw new Error('Update the Android app to use sign-in.');
      currentUser = (await native.getCurrentUser()).user;
    } else {
      const response = await nativeFetch(base + '/api/auth/config', { cache: 'no-store' });
      if (!response.ok) throw new Error('Sign-in configuration is unavailable. Please try again.');
      config = await response.json();
      auth = getAuth(initializeApp(config.firebase));
      if (config.emulator) {
        if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || config.emulatorUrl !== 'http://127.0.0.1:9099') throw new Error('Invalid local authentication configuration.');
        connectAuthEmulator(auth, config.emulatorUrl, { disableWarnings: true });
      }
      await setPersistence(auth, browserLocalPersistence);
      currentUser = await new Promise(resolve => { const unsubscribe = onAuthStateChanged(auth, user => { unsubscribe(); resolve(user); }); });
      onAuthStateChanged(auth, user => { currentUser = user; if (!user && !loginPage) redirectLogin(); });
    }
    if (!loginPage) {
      if (!currentUser) { redirectLogin(); throw new Error('Please sign in to continue.'); }
      if (recentAndroidCheck()) {
        activateProfile(currentUser.uid);
        document.documentElement.classList.remove('auth-loading');
      } else await validate();
    }
    resolveReady();
  })().catch(error => {
    rejectReady(error);
    if (!loginPage) {
      // Keep protected UI hidden; login displays the recoverable configuration error.
      location.replace('/pages/login.html');
    }
  });
})();
