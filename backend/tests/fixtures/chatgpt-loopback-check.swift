import Foundation

@main struct Check {
  static func main() throws {
    let state = String(repeating: "a", count: 43)
    let listener = ChatgptLoopback()
    let ready = DispatchSemaphore(value: 0)
    var callback: String?
    listener.start(state: state, timeoutMs: 5000) { result in
      if case .success(let uri) = result { callback = uri }
      ready.signal()
    }
    precondition(ready.wait(timeout: .now() + 3) == .success)
    let uri = callback!
    func request(_ query: String, origin: Bool = false) -> Int {
      let done = DispatchSemaphore(value: 0)
      var status = 0
      var request = URLRequest(url: URL(string: uri + query)!)
      request.timeoutInterval = 2
      if origin { request.setValue("https://untrusted.example", forHTTPHeaderField: "Origin") }
      URLSession.shared.dataTask(with: request) { _, response, _ in
        status = (response as? HTTPURLResponse)?.statusCode ?? 0
        done.signal()
      }.resume()
      precondition(done.wait(timeout: .now() + 3) == .success)
      return status
    }
    precondition(request("?state=wrong&code=secret&client_id=oaiapp_fixture") == 400)
    precondition(request("?state=\(state)&state=\(state)&code=secret") == 400)
    precondition(request("?state=\(state)&code=secret", origin: true) == 403)
    let result = DispatchSemaphore(value: 0)
    var received = ""
    listener.wait { value in if case .success(let url) = value { received = url }; result.signal() }
    precondition(request("?state=\(state)&code=secret&client_id=oaiapp_fixture") == 200)
    precondition(result.wait(timeout: .now() + 3) == .success)
    precondition(received == uri + "?state=\(state)&code=secret&client_id=oaiapp_fixture")
    let replay = DispatchSemaphore(value: 0)
    listener.wait { value in if case .success = value { preconditionFailure("Callback replay") }; replay.signal() }
    precondition(replay.wait(timeout: .now() + 2) == .success)
    let cancelled = ChatgptLoopback(), cancelDone = DispatchSemaphore(value: 0)
    cancelled.start(state: state, timeoutMs: 5000) { _ in }
    cancelled.wait { value in if case .success = value { preconditionFailure("Cancel resolved") }; cancelDone.signal() }
    cancelled.cancel()
    precondition(cancelDone.wait(timeout: .now() + 2) == .success)
    let timedOut = ChatgptLoopback(), timeoutDone = DispatchSemaphore(value: 0)
    timedOut.start(state: state, timeoutMs: 30) { _ in }
    timedOut.wait { value in if case .success = value { preconditionFailure("Timeout resolved") }; timeoutDone.signal() }
    precondition(timeoutDone.wait(timeout: .now() + 2) == .success)
    print("PASS: wrong state, duplicate parameters, Origin, successful callback, replay, cancellation, timeout")
  }
}
