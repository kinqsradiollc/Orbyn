import SwiftUI
import WatchConnectivity

// Orbyn Apple Watch app (scaffold). It shows the same "glance" the phone builds
// (@orbyn/core buildGlance). watchOS can't read the phone's App Group, so the
// phone sends the glance over WatchConnectivity; this receiver caches the last
// one it got in the Watch's own defaults. Wiring the PHONE side to send the
// glance (a small native module calling WCSession.updateApplicationContext) is
// the remaining native step — see docs/mobile.md. Built and verified in Xcode.

struct Glance: Codable {
  var todayOpen: Int = 0
  var todayDone: Int = 0
  var overdue: Int = 0
  var nextEventTitle: String?
  var nextEventAt: String?
}

final class GlanceStore: NSObject, ObservableObject, WCSessionDelegate {
  @Published var glance: Glance = GlanceStore.cached()

  override init() {
    super.init()
    if WCSession.isSupported() {
      let session = WCSession.default
      session.delegate = self
      session.activate()
    }
  }

  static func cached() -> Glance {
    guard let data = UserDefaults.standard.data(forKey: "glance"),
      let g = try? JSONDecoder().decode(Glance.self, from: data)
    else { return Glance() }
    return g
  }

  private func apply(_ context: [String: Any]) {
    guard let json = context["glance"] as? String,
      let data = json.data(using: .utf8),
      let g = try? JSONDecoder().decode(Glance.self, from: data)
    else { return }
    UserDefaults.standard.set(data, forKey: "glance")
    DispatchQueue.main.async { self.glance = g }
  }

  func session(
    _ session: WCSession, didReceiveApplicationContext context: [String: Any]
  ) {
    apply(context)
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith state: WCSessionActivationState,
    error: Error?
  ) {}
}

struct ContentView: View {
  @StateObject private var store = GlanceStore()
  private var accent: Color { Color("accent") }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Today").font(.caption2).foregroundStyle(.secondary)
      Text("\(store.glance.todayOpen)")
        .font(.system(size: 40, weight: .bold))
        .foregroundStyle(accent)
      Text(store.glance.todayOpen == 1 ? "task to do" : "tasks to do")
        .font(.caption2).foregroundStyle(.secondary)
      if let title = store.glance.nextEventTitle {
        Divider()
        Text("Next").font(.caption2).foregroundStyle(.secondary)
        Text(title).font(.footnote).lineLimit(2)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 4)
  }
}

@main
struct OrbynWatchApp: App {
  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
