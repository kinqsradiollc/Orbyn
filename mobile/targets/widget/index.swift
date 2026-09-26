import SwiftUI
import WidgetKit

// Orbyn's widgets (CAP-05, CAP-06): the Home Screen widget you tick tasks
// from, the Lock Screen's "Next up", the focus session's Live Activity and,
// on iOS 18, "Add to Orbyn" in Control Center and on the Lock Screen. They
// read the glance the app keeps in the shared App Group (see Glance.swift).
// Built in Xcode with the owner's EAS build; `swiftc -typecheck` checks them.

@main
struct OrbynWidgets: WidgetBundle {
  var body: some Widget {
    OrbynTodayWidget()
    OrbynNextUpWidget()
    FocusActivityWidget()
    if #available(iOS 18.0, *) {
      AddToOrbynControl()
    }
  }
}
