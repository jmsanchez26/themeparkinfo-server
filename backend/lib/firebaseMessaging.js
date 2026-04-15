const firebaseAdmin = (() => {
  try {
    return require("firebase-admin");
  } catch (error) {
    return null;
  }
})();

function parseServiceAccount(rawValue) {
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    try {
      return JSON.parse(Buffer.from(rawValue, "base64").toString("utf8"));
    } catch (decodeError) {
      console.error("Could not parse FIREBASE_SERVICE_ACCOUNT_JSON");
      return null;
    }
  }
}

function initializeFirebaseMessaging() {
  if (!firebaseAdmin) {
    console.warn("firebase-admin is not installed. Push notifications are disabled.");
    return null;
  }

  if (firebaseAdmin.apps.length) {
    return firebaseAdmin.messaging();
  }

  const serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  if (!serviceAccount) {
    console.warn("Push notifications disabled: missing FIREBASE_SERVICE_ACCOUNT_JSON");
    return null;
  }

  try {
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount)
    });

    return firebaseAdmin.messaging();
  } catch (error) {
    console.error("Firebase initialization failed:", error.message);
    return null;
  }
}

module.exports = {
  initializeFirebaseMessaging
};
