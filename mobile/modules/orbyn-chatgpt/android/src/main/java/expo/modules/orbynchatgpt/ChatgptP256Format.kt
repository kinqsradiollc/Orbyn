package expo.modules.orbynchatgpt

/** Strict ASN.1 encoding conversion only; signing always uses the OS cryptography provider. */
object ChatgptP256Format {
  fun signature(der: ByteArray): ByteArray {
    require(der.size in 8..72 && der[0].toInt() == 0x30 && (der[1].toInt() and 255) == der.size - 2)
    var index = 2
    fun integer(): ByteArray {
      require(index + 2 <= der.size && der[index++].toInt() == 2)
      val length = der[index++].toInt() and 255
      require(length in 1..33 && index + length <= der.size)
      val bytes = der.copyOfRange(index, index + length)
      index += length
      require((bytes[0].toInt() and 128) == 0)
      val offset = if (bytes.size > 1 && bytes[0].toInt() == 0) {
        require((bytes[1].toInt() and 128) != 0)
        1
      } else 0
      require(bytes.size - offset <= 32)
      val out = ByteArray(32)
      bytes.copyInto(out, 32 - (bytes.size - offset), offset)
      return out
    }
    val signature = integer() + integer()
    require(index == der.size)
    return signature
  }
}
