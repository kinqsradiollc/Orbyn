import ExpoModulesCore
import Foundation

// The app's side of capture from outside the app (CAP-05..07): the focus
// session's Live Activity. The glance and the queue of ticks and captures
// live in the App Group, which JS reads and writes through
// @bacons/apple-targets' ExtensionStorage; Siri and Shortcuts actions are
// in the app target (added by this module's config plugin).
public class OrbynCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OrbynCapture")

    Function("startFocus") { (title: String, endsAtMs: Double) in
      if #available(iOS 16.2, *) {
        FocusActivity.start(
          title: title, endsAt: Date(timeIntervalSince1970: endsAtMs / 1000))
      }
    }

    Function("updateFocus") { (endsAtMs: Double, paused: Bool) in
      if #available(iOS 16.2, *) {
        FocusActivity.update(
          endsAt: Date(timeIntervalSince1970: endsAtMs / 1000), paused: paused)
      }
    }

    Function("endFocus") {
      if #available(iOS 16.2, *) {
        FocusActivity.end()
      }
    }
  }
}
