async function signInWithGoogle(nativeAuth) {
  try {
    return await nativeAuth.signInWithGoogle();
  } catch (error) {
    const detail = `${error?.code || ''} ${error?.message || ''}`;
    const unsupported = /credential[\s_-]*manager/i.test(detail) &&
      /doesn['’]?t support|does not support|not supported|unsupported|unavailable|not available|not implemented/i.test(detail);
    if (!unsupported) throw error;
    // The plugin's supported Google Play Services flow still verifies a Google
    // identity with Firebase; only the unavailable account-picker API changes.
    return nativeAuth.signInWithGoogle({ useCredentialManager: false });
  }
}
module.exports = { signInWithGoogle };
