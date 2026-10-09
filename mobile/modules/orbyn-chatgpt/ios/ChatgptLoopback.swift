import Foundation
import Network

// Owns one ephemeral callback. The queue serializes ready/callback/cancel/timeout.
// Codes are delivered to the owning runtime only; nothing is persisted or logged.
final class ChatgptLoopback {
  private let queue = DispatchQueue(label: "dev.orbyn.chatgpt.callback")
  private var listener: NWListener?
  private var connections: [UUID: NWConnection] = [:]
  private var timer: DispatchWorkItem?
  private var ready: ((Result<String, Error>) -> Void)?
  private var receive: ((Result<String, Error>) -> Void)?
  private var result: Result<String, Error>?
  private var state = ""
  private var callback = ""
  private var finished = false
  private var delivered = false
  private var callbackAccepted = false

  private func failure(_ message: String) -> Error {
    NSError(domain: "OrbynChatgpt", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }

  func start(state: String, timeoutMs: Int, ready: @escaping (Result<String, Error>) -> Void) {
    queue.async {
      guard self.listener == nil, !self.finished,
        state.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
        timeoutMs > 0, timeoutMs <= 600_000 else {
        ready(.failure(self.failure("Invalid ChatGPT callback attempt.")))
        return
      }
      self.state = state
      self.ready = ready
      do {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        listener.stateUpdateHandler = { status in
          switch status {
          case .ready:
            guard let port = listener.port, !self.finished else { return }
            self.callback = "http://127.0.0.1:\(port.rawValue)/auth/callback"
            self.ready?(.success(self.callback))
            self.ready = nil
          case .failed:
            self.finish(.failure(self.failure("ChatGPT callback listener failed.")))
          default: break
          }
        }
        listener.newConnectionHandler = { connection in self.accept(connection) }
        let timer = DispatchWorkItem {
          self.finish(.failure(self.failure("ChatGPT sign-in expired.")))
        }
        self.timer = timer
        self.queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: timer)
        listener.start(queue: self.queue)
      } catch {
        self.finish(.failure(self.failure("ChatGPT callback listener failed.")))
      }
    }
  }

  func wait(_ receive: @escaping (Result<String, Error>) -> Void) {
    queue.async {
      guard !self.delivered, self.receive == nil else {
        receive(.failure(self.failure("ChatGPT callback was already consumed.")))
        return
      }
      if let result = self.result {
        self.delivered = true
        self.result = nil
        receive(result)
      } else {
        self.receive = receive
      }
    }
  }

  func cancel() {
    queue.async { self.finish(.failure(self.failure("ChatGPT sign-in was cancelled."))) }
  }

  private func finish(_ result: Result<String, Error>) {
    guard !finished else { return }
    finished = true
    timer?.cancel()
    timer = nil
    listener?.cancel()
    listener = nil
    connections.values.forEach { $0.cancel() }
    connections.removeAll()
    if ready != nil {
      if case .failure(let error) = result { ready?(.failure(error)) }
      ready = nil
    }
    if let receive = receive {
      delivered = true
      self.receive = nil
      receive(result)
    } else {
      self.result = result
    }
    state = ""
  }

  private func accept(_ connection: NWConnection) {
    guard !finished, connections.count < 8 else { connection.cancel(); return }
    guard case .hostPort(let host, _) = connection.endpoint, host == NWEndpoint.Host("127.0.0.1") else {
      connection.cancel(); return
    }
    let id = UUID()
    connections[id] = connection
    connection.start(queue: queue)
    queue.asyncAfter(deadline: .now() + .seconds(3)) {
      self.connections.removeValue(forKey: id)?.cancel()
    }
    read(connection, id: id, data: Data())
  }

  private func read(_ connection: NWConnection, id: UUID, data: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8193 - data.count) { next, _, complete, error in
      guard self.connections[id] != nil, !self.finished else { return }
      var bytes = data
      if let next = next { bytes.append(next) }
      if bytes.count > 8192 { self.respond(connection, id: id, status: 400); return }
      if let text = String(data: bytes, encoding: .utf8), text.contains("\r\n\r\n") {
        self.handle(connection, id: id, text: text)
      } else if complete || error != nil {
        self.connections.removeValue(forKey: id)?.cancel()
      } else {
        self.read(connection, id: id, data: bytes)
      }
    }
  }

  private func handle(_ connection: NWConnection, id: UUID, text: String) {
    let lines = text.components(separatedBy: "\r\n")
    let request = lines[0].components(separatedBy: " ")
    guard request.count == 3, request[0] == "GET", request[2] == "HTTP/1.1",
      request[1].hasPrefix("/"), !request[1].hasPrefix("//"),
      let url = URL(string: request[1], relativeTo: URL(string: callback)!)?.absoluteURL,
      let parsed = URLComponents(url: url, resolvingAgainstBaseURL: false),
      parsed.percentEncodedPath == "/auth/callback", parsed.fragment == nil else {
      respond(connection, id: id, status: 400); return
    }
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      if line.isEmpty { break }
      guard let separator = line.firstIndex(of: ":") else { respond(connection, id: id, status: 400); return }
      let name = line[..<separator].lowercased()
      guard headers[name] == nil else { respond(connection, id: id, status: 400); return }
      headers[name] = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
    }
    let expectedHost = URLComponents(string: callback)!.host! + ":" + String(URLComponents(string: callback)!.port!)
    guard headers["host"] == expectedHost, headers["origin"] == nil,
      headers["transfer-encoding"] == nil, headers["content-length"] == nil || headers["content-length"] == "0" else {
      respond(connection, id: id, status: 403); return
    }
    let items = parsed.queryItems ?? []
    guard Set(items.map { $0.name }).count == items.count,
      let returned = items.first(where: { $0.name == "state" })?.value,
      sameState(returned) else { respond(connection, id: id, status: 400); return }
    guard !callbackAccepted else { respond(connection, id: id, status: 409); return }
    callbackAccepted = true
    // The JS owner performs exact registration/code/error validation before exchange.
    respond(connection, id: id, status: 200, result: url.absoluteString)
  }

  private func sameState(_ value: String) -> Bool {
    let left = Array(value.utf8), right = Array(state.utf8)
    guard left.count == right.count else { return false }
    var difference: UInt8 = 0
    for index in left.indices { difference |= left[index] ^ right[index] }
    return difference == 0
  }

  private func respond(_ connection: NWConnection, id: UUID, status: Int, result: String? = nil) {
    let message = status == 200 ? "Sign-in received. Return to Orbyn." : "Invalid ChatGPT callback."
    let response = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "Rejected")\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: \(message.utf8.count)\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n\(message)"
    connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
      self.connections.removeValue(forKey: id)?.cancel()
      if let result = result { self.finish(.success(result)) }
    })
  }
}
