import ExpoModulesCore
import WatchConnectivity

// Sends the compact "glance" to the paired Apple Watch. watchOS can't read the
// phone's App Group, so we push the latest glance as the WatchConnectivity
// application context; the Watch app (mobile/targets/watch) receives it in
// didReceiveApplicationContext and caches it. Built and verified in Xcode.

final class WatchBridge: NSObject, WCSessionDelegate {
  static let shared = WatchBridge()

  func start() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState != .activated {
      session.activate()
    }
  }

  func send(_ glance: String) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    try? session.updateApplicationContext(["glance": glance])
  }

  // WCSessionDelegate
  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {}
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }
}

public class OrbynWatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OrbynWatch")

    OnCreate {
      WatchBridge.shared.start()
    }

    Function("send") { (glance: String) in
      WatchBridge.shared.send(glance)
    }
  }
}
