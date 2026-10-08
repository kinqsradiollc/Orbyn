import CryptoKit
import Foundation

@main struct KeyCheck {
  static func main() throws {
    let key = P256.Signing.PrivateKey()
    let message = "[\"orbyn:executor:enroll:v1\",\"fixture-native-message\"]"
    let metadata = ChatgptExecutorKey.metadata(key.publicKey)
    let signature = ChatgptExecutorKey.encode(try key.signature(for: Data(message.utf8)).rawRepresentation)
    guard metadata["public_key"]?.count == 122, signature.count == 86 else { fatalError("Invalid proof format") }
    let result = ["public_key": metadata["public_key"]!, "fingerprint": metadata["public_key_fingerprint"]!, "message": message, "signature": signature]
    print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
  }
}
