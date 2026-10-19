package com.juanm.themeparkinfo;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Stores only encrypted alert credentials on disk; the encryption key stays in Android Keystore. */
@CapacitorPlugin(name = "AlertCredential")
public class AlertCredentialPlugin extends Plugin {
    private static final String ALIAS = "themeparkinfo.alert-credential.v1";

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("alert_credential", Context.MODE_PRIVATE);
    }

    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        if (!create) throw new IllegalStateException("Credential key unavailable");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    @PluginMethod
    public synchronized void getOrCreate(PluginCall call) {
        try {
            SharedPreferences prefs = preferences();
            String encrypted = prefs.getString("ciphertext", null);
            String value;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            if (encrypted != null) {
                byte[] iv = Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP);
                cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
                value = new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
                if (!value.matches("[a-f0-9]{64}")) throw new IllegalStateException("Invalid credential");
            } else {
                value = call.getString("legacyCredential");
                if (value == null || !value.matches("[a-f0-9]{64}")) {
                    byte[] random = new byte[32];
                    new SecureRandom().nextBytes(random);
                    StringBuilder hex = new StringBuilder(64);
                    for (byte b : random) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
                    value = hex.toString();
                }
                cipher.init(Cipher.ENCRYPT_MODE, key(true));
                String ciphertext = Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
                if (!prefs.edit().putString("ciphertext", ciphertext)
                    .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit()) {
                    throw new IllegalStateException("Credential write failed");
                }
            }
            JSObject result = new JSObject();
            result.put("credential", value);
            call.resolve(result);
        } catch (Exception error) {
            // Do not log credentials or silently replace an unreadable existing identity.
            call.reject("Android secure alert storage is unavailable. Please try again.");
        }
    }

    @PluginMethod
    public synchronized void clear(PluginCall call) {
        if (preferences().edit().clear().commit()) call.resolve();
        else call.reject("Could not clear secure alert storage.");
    }
}
