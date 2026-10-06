package expo.modules.orbynchatgpt

import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

fun main() {
  val key = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
  val message = "orbyn:executor:catalog:v1\n" + "f".repeat(43)
  val encoder = Base64.getUrlEncoder().withoutPadding()
  var raw = ByteArray(0)
  repeat(200) {
    val signer = Signature.getInstance("SHA256withECDSA").apply { initSign(key.private); update(message.toByteArray()) }
    val der = signer.sign()
    raw = ChatgptP256Format.signature(der)
    check(raw.size == 64)
    val verifier = Signature.getInstance("SHA256withECDSAinP1363Format").apply { initVerify(key.public); update(message.toByteArray()) }
    check(verifier.verify(raw))
  }
  for (invalid in listOf(byteArrayOf(), byteArrayOf(0x30, 0x06, 0x02, 0x01, 0x80.toByte(), 0x02, 0x01, 0x01),
    byteArrayOf(0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01),
    byteArrayOf(0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x00))) {
    check(runCatching { ChatgptP256Format.signature(invalid) }.isFailure)
  }
  val publicKey = encoder.encodeToString(key.public.encoded)
  val fingerprint = encoder.encodeToString(MessageDigest.getInstance("SHA-256").digest(key.public.encoded))
  check(publicKey.length == 122)
  val escaped = message.replace("\n", "\\n")
  println("{\"public_key\":\"$publicKey\",\"fingerprint\":\"$fingerprint\",\"message\":\"$escaped\",\"signature\":\"${encoder.encodeToString(raw)}\"}")
}
