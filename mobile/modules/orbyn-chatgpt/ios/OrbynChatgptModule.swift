import ExpoModulesCore
import Foundation

public class OrbynChatgptModule: Module {
  private let lock = NSLock()
  private var current: (id: String, listener: ChatgptLoopback)?

  public func definition() -> ModuleDefinition {
    Name("OrbynChatgpt")
    AsyncFunction("start") { (id: String, state: String, timeoutMs: Int, promise: Promise) in
      guard UUID(uuidString: id) != nil else {
        promise.reject("CHATGPT_INPUT", "Invalid ChatGPT callback attempt.")
        return
      }
      let listener = ChatgptLoopback()
      self.lock.lock()
      let previous = self.current
      self.current = (id, listener)
      self.lock.unlock()
      previous?.listener.cancel()
      listener.start(state: state, timeoutMs: timeoutMs) { result in
        switch result {
        case .success(let uri): promise.resolve(uri)
        case .failure: promise.reject("CHATGPT_CALLBACK", "ChatGPT callback could not start.")
        }
      }
    }
    AsyncFunction("wait") { (id: String, promise: Promise) in
      self.lock.lock()
      let current = self.current
      self.lock.unlock()
      guard current?.id == id else {
        promise.reject("CHATGPT_ATTEMPT", "This ChatGPT sign-in attempt is not active.")
        return
      }
      current!.listener.wait { result in
        switch result {
        case .success(let url): promise.resolve(url)
        case .failure: promise.reject("CHATGPT_CALLBACK", "ChatGPT sign-in did not complete.")
        }
      }
    }
    AsyncFunction("cancel") { (id: String) in
      self.lock.lock()
      let current = self.current
      if current?.id == id { self.current = nil }
      self.lock.unlock()
      if current?.id == id { current?.listener.cancel() }
    }
    OnDestroy {
      self.lock.lock()
      let current = self.current
      self.current = nil
      self.lock.unlock()
      current?.listener.cancel()
    }
  }
}
