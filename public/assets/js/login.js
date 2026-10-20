(function () {
  const form = document.getElementById('email-form');
  const title = document.getElementById('login-title');
  const subtitle = document.getElementById('login-subtitle');
  const emailButton = document.getElementById('email-signin');
  const passwordFields = document.getElementById('password-fields');
  const password = document.getElementById('login-password');
  const submit = document.getElementById('email-submit');
  const switchMode = document.getElementById('switch-mode');
  const message = document.getElementById('login-message');
  let mode = 'signin';
  let busy = false;
  function announce(text) { message.textContent = text; message.hidden = false; }
  function run(action) {
    if (busy) return Promise.resolve();
    busy = true;
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    return Promise.resolve().then(action).catch(error => {
      const messages = {
        'auth/invalid-credential': 'The email or password is incorrect.',
        'auth/email-already-in-use': 'This email already has an account. Sign in or reset your password.',
        'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
        'auth/popup-closed-by-user': 'Google sign-in was cancelled. Try again when you’re ready.',
        'auth/popup-blocked': 'Allow the Google sign-in popup and try again.',
        'auth/too-many-requests': 'Too many attempts. Please try again later.',
        'auth/network-request-failed': 'Could not connect. Check your connection and try again.',
        'auth/unauthorized-domain': 'This website must be added to Firebase Authentication’s authorized domains.',
        'auth/operation-not-allowed': 'This sign-in method must be enabled in Firebase Authentication.'
      };
      announce(messages[error.code] || error.message || 'Could not sign in. Please try again.');
      if (window.AppAuth?.user && !window.AppAuth.user.emailVerified) document.getElementById('verification-actions').hidden = false;
    }).finally(() => { busy = false; document.querySelectorAll('button').forEach(button => { button.disabled = false; }); });
  }
  function render(next) {
    mode = next;
    message.hidden = true;
    form.hidden = mode === 'welcome';
    emailButton.hidden = mode !== 'welcome';
    passwordFields.hidden = mode === 'reset';
    password.required = mode !== 'reset';
    password.minLength = mode === 'signup' ? 8 : 0;
    password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    password.placeholder = mode === 'signup' ? 'At least 8 characters' : 'Your password';
    title.textContent = mode === 'welcome' ? 'Let’s get you in' : mode === 'signup' ? 'Your adventure starts here.' : mode === 'reset' ? 'Forgot your password?' : 'Welcome back';
    subtitle.textContent = mode === 'welcome' ? 'Sign in or create your free account.' : mode === 'signup' ? 'Create your free Adventure Scout account.' : mode === 'reset' ? 'We’ll help you get back to your park plans.' : 'Sign in with your email address.';
    submit.textContent = mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in';
    document.getElementById('account-prompt').textContent = mode === 'signup' || mode === 'reset' ? 'Already have an account?' : 'New to Adventure Scout?';
    switchMode.textContent = mode === 'signup' || mode === 'reset' ? 'Sign in' : 'Create account';
  }
  document.getElementById('google-signin').onclick = () => run(() => window.AppAuth.google());
  emailButton.onclick = () => { render('signin'); document.getElementById('login-email').focus(); };
  switchMode.onclick = () => render(mode === 'signin' ? 'signup' : 'signin');
  document.getElementById('forgot-password').onclick = () => render('reset');
  document.getElementById('back-to-options').onclick = () => { form.reset(); password.type = 'password'; updateVisibility(false); render('welcome'); emailButton.focus(); };
  function updateVisibility(visible) {
    const button = document.getElementById('show-password');
    button.textContent = visible ? 'Hide' : 'Show';
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(visible));
  }
  document.getElementById('show-password').onclick = () => { const visible = password.type === 'password'; password.type = visible ? 'text' : 'password'; updateVisibility(visible); };
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const email = document.getElementById('login-email').value.trim();
    const submittedMode = mode;
    const submittedPassword = password.value;
    run(async () => {
      try {
        if (submittedMode === 'reset') { await window.AppAuth.reset(email); announce('If an account exists for that email, a password reset link will be sent.'); }
        else {
          const result = await window.AppAuth.email(email, submittedPassword, submittedMode === 'signup');
          if (result.verificationRequired) {
            announce('Check your inbox to verify your email, then continue here.');
            document.getElementById('verification-actions').hidden = false;
          }
        }
      } finally { password.value = ''; }
    });
  });
  document.getElementById('test-signin').onclick = () => run(() => window.AppAuth.testUser());
  document.getElementById('resend-verification').onclick = () => run(async () => { await window.AppAuth.resendVerification(); announce('Verification email sent. Check your inbox.'); });
  document.getElementById('continue-verified').onclick = () => run(() => window.AppAuth.continueVerified());
  render('welcome');
  run(async () => {
    if (!window.AppAuth) throw new Error('Sign-in files could not load. Refresh the page to try again.');
    await window.AppAuth.ready;
    document.getElementById('test-signin').hidden = !window.AppAuth.emulator;
    document.getElementById('test-note').hidden = !window.AppAuth.emulator;
    if (window.AppAuth.user && !window.AppAuth.user.emailVerified && !window.AppAuth.emulator) {
      announce('Verify your email address to continue.');
      document.getElementById('verification-actions').hidden = false;
    }
  });
})();
