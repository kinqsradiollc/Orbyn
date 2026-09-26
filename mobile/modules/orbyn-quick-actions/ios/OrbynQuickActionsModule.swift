import ExpoModulesCore
import UIKit

// The app icon's quick actions (long-press the icon): New task, Today's
// agenda, Scan notes and Ask assistant. They are listed in Info.plist by the
// config plugin (app.plugin.js), each carrying the orbyn:// link it opens in
// its userInfo. iOS hands a chosen one to the app delegate, which Expo
// forwards here; it reaches JS as that link, the same way any other link
// into the app does. A choice made before JS is listening (the one that
// launched the app) waits here until JS asks for it.

final class QuickActionCenter {
  static let shared = QuickActionCenter()
  private var pending: String?
  var listener: ((String) -> Void)?

  func receive(_ item: UIApplicationShortcutItem) {
    guard let url = item.userInfo?["url"] as? String else { return }
    if let listener = listener {
      listener(url)
    } else {
      pending = url
    }
  }

  func take() -> String? {
    let url = pending
    pending = nil
    return url
  }
}

public class OrbynQuickActionsAppDelegate: ExpoAppDelegateSubscriber {
  // Called for a quick action chosen while the app runs, and after launch
  // for one that launched it (didFinishLaunching returns true).
  public func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    QuickActionCenter.shared.receive(shortcutItem)
    completionHandler(true)
  }
}

public class OrbynQuickActionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OrbynQuickActions")

    Events("onQuickAction")

    OnStartObserving {
      QuickActionCenter.shared.listener = { [weak self] url in
        self?.sendEvent("onQuickAction", ["url": url])
      }
    }

    OnStopObserving {
      QuickActionCenter.shared.listener = nil
    }

    // The quick action that launched the app, once; nil when there was none.
    Function("takeInitial") { () -> String? in
      QuickActionCenter.shared.take()
    }
  }
}
