import ActivityKit
import Foundation

// The focus session's Live Activity (CAP-05). The widget target draws it
// (targets/widget/FocusActivity.swift) and must declare the same type.
@available(iOS 16.1, *)
struct OrbynFocusAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var endsAt: Date
    var paused: Bool
  }
  var title: String
}

/** Starts, updates and ends the one focus session Live Activity. */
@available(iOS 16.2, *)
enum FocusActivity {
  static func start(title: String, endsAt: Date) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    end()
    let state = OrbynFocusAttributes.ContentState(endsAt: endsAt, paused: false)
    _ = try? Activity.request(
      attributes: OrbynFocusAttributes(title: title),
      content: ActivityContent(state: state, staleDate: endsAt),
      pushType: nil)
  }

  static func update(endsAt: Date, paused: Bool) {
    let state = OrbynFocusAttributes.ContentState(endsAt: endsAt, paused: paused)
    for activity in Activity<OrbynFocusAttributes>.activities {
      Task { await activity.update(ActivityContent(state: state, staleDate: endsAt)) }
    }
  }

  static func end() {
    for activity in Activity<OrbynFocusAttributes>.activities {
      Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }
  }
}
