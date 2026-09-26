import ActivityKit
import SwiftUI
import WidgetKit

// The focus session on the Lock Screen and in the Dynamic Island (CAP-05):
// the task and the time left. The app starts, updates and ends it
// (mobile/modules/orbyn-capture); this is how it's drawn. The attributes
// must match the app's copy (OrbynFocusAttributes.swift in the module).

struct OrbynFocusAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var endsAt: Date
    var paused: Bool
  }
  var title: String
}

struct FocusActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: OrbynFocusAttributes.self) { context in
      HStack(spacing: 12) {
        Image(systemName: "scope").foregroundStyle(Color("accent"))
        VStack(alignment: .leading, spacing: 2) {
          Text("Focus").font(.caption).foregroundStyle(.secondary)
          Text(context.attributes.title).font(.headline).lineLimit(1)
        }
        Spacer()
        if context.state.paused {
          Text("Paused").font(.headline)
        } else {
          Text(timerInterval: Date()...max(Date(), context.state.endsAt), countsDown: true)
            .font(.title3.monospacedDigit()).frame(maxWidth: 80)
        }
      }
      .padding(16)
      .widgetURL(URL(string: "orbyn://focus"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "scope").foregroundStyle(Color("accent"))
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.title).font(.headline).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(timerInterval: Date()...max(Date(), context.state.endsAt), countsDown: true)
            .monospacedDigit().frame(maxWidth: 64)
        }
      } compactLeading: {
        Image(systemName: "scope").foregroundStyle(Color("accent"))
      } compactTrailing: {
        Text(timerInterval: Date()...max(Date(), context.state.endsAt), countsDown: true)
          .monospacedDigit().frame(maxWidth: 44)
      } minimal: {
        Image(systemName: "scope").foregroundStyle(Color("accent"))
      }
      .widgetURL(URL(string: "orbyn://focus"))
    }
  }
}
