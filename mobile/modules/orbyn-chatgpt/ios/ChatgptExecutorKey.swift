import CryptoKit
import Foundation
import Security

/** OS-protected P-256 signing key. No method returns private material. */
final class ChatgptExecutorKey {
  private let lock = NSLock()
  private let service = "dev.orbyn.chatgpt.executor.p256.v1"
  enum Failure: Error { case unavailable }

  private func query(_ account: String) throws -> [String: Any] {
    guard account.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.unavailable }
    return [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false]
  }
  private func key(_ account: String, create: Bool) throws -> P256.Signing.PrivateKey {
    let lookup = try query(account)
    var read = lookup
    read[kSecReturnData as String] = true
    read[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(read as CFDictionary, &result)
    if status == errSecSuccess, let bytes = result as? Data {
      return try P256.Signing.PrivateKey(rawRepresentation: bytes)
    }
    guard status == errSecItemNotFound, create else { throw Failure.unavailable }
    let generated = P256.Signing.PrivateKey()
    var write = lookup
    write[kSecValueData as String] = generated.rawRepresentation
    write[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let added = SecItemAdd(write as CFDictionary, nil)
    if added == errSecDuplicateItem { return try key(account, create: false) }
    guard added == errSecSuccess else { throw Failure.unavailable }
    return generated
  }
  static func encode(_ bytes: Data) -> String {
    bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
  static func metadata(_ key: P256.Signing.PublicKey) -> [String: String] {
    let der = key.derRepresentation
    return ["public_key": encode(der), "public_key_fingerprint": encode(Data(SHA256.hash(data: der)))]
  }
  func metadata(_ account: String) throws -> [String: String] {
    lock.lock(); defer { lock.unlock() }
    return Self.metadata(try key(account, create: true).publicKey)
  }
  func sign(_ account: String, fingerprint: String, message: String) throws -> String {
    lock.lock(); defer { lock.unlock() }
    let key = try key(account, create: false)
    guard Self.metadata(key.publicKey)["public_key_fingerprint"] == fingerprint,
          message.utf8.count >= 32, message.utf8.count <= 2048,
          (message.hasPrefix("orbyn:executor:catalog:v1\n") || message.hasPrefix("[\"orbyn:executor:")) else { throw Failure.unavailable }
    return Self.encode(try key.signature(for: Data(message.utf8)).rawRepresentation)
  }
  func remove(_ account: String) throws {
    lock.lock(); defer { lock.unlock() }
    let status = SecItemDelete(try query(account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure.unavailable }
  }
}
