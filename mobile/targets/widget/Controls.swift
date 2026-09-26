import AppIntents
import SwiftUI
import WidgetKit

// "Add to Orbyn" in Control Center and on the Lock Screen (CAP-05): one tap
// opens Orbyn's quick add straight away. iOS 18 and later.

@available(iOS 18.0, *)
struct OpenQuickAddIntent: AppIntent {
  static var title: LocalizedStringResource = "Add to Orbyn"
  static var description = IntentDescription("Opens quick add in Orbyn.")
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "orbyn://add")!))
  }
}

@available(iOS 18.0, *)
struct AddToOrbynControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.orbyn.planner.add") {
      ControlWidgetButton(action: OpenQuickAddIntent()) {
        Label("Add to Orbyn", systemImage: "plus.circle")
      }
    }
    .displayName("Add to Orbyn")
    .description("Add a task in one tap.")
  }
}
