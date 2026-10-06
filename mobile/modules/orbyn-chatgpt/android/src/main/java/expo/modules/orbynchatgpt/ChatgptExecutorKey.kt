package expo.modules.orbynchatgpt

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/** Non-exportable OS keystore key; only public metadata and bounded signatures cross the bridge. */
class ChatgptExecutorKey {
  private fun alias(account: String): String {
    require(Regex("^[a-f0-9]{64}$").matches(account))
    return "orbyn.chatgpt.executor.p256.v1.$account"
  }
  private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  private fun metadata(store: KeyStore, alias: String): Map<String, String> {
    val publicKey = store.getCertificate(alias)?.publicKey?.encoded ?: error("ChatGPT signing key unavailable.")
    require(publicKey.size == 91)
    return mapOf("public_key" to encode(publicKey), "public_key_fingerprint" to encode(MessageDigest.getInstance("SHA-256").digest(publicKey)))
  }
  @Synchronized fun metadata(account: String): Map<String, String> {
    val alias = alias(account)
    val store = store()
    if (!store.containsAlias(alias)) {
      val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
      generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256).build())
      generator.generateKeyPair()
    }
    return metadata(store, alias)
  }
  @Synchronized fun sign(account: String, fingerprint: String, message: String): String {
    val bytes = message.toByteArray(Charsets.UTF_8)
    require(bytes.size in 32..2048 && (message.startsWith("orbyn:executor:catalog:v1\n") || message.startsWith("[\"orbyn:executor:")))
    val alias = alias(account)
    val store = store()
    require(metadata(store, alias)["public_key_fingerprint"] == fingerprint)
    val key = store.getKey(alias, null) as? java.security.PrivateKey ?: error("ChatGPT signing key unavailable.")
    val signer = Signature.getInstance("SHA256withECDSA")
    signer.initSign(key)
    signer.update(bytes)
    return encode(ChatgptP256Format.signature(signer.sign()))
  }
  @Synchronized fun remove(account: String) { store().deleteEntry(alias(account)) }
}
