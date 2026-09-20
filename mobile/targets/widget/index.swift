import WidgetKit
import SwiftUI

// Orbyn home-screen widget. It renders the compact "glance" the app writes to
// the shared App Group (see mobile/src/lib/widget.ts and @orbyn/core
// buildGlance). No network here: the app keeps the glance fresh and calls
// reloadWidget() after each refresh. Built and verified in Xcode.

private let appGroup = "group.com.orbyn.planner"
private let glanceKey = "glance"

struct Glance: Decodable {
  var updatedAt: String?
  var todayOpen: Int
  var todayDone: Int
  var overdue: Int
  var nextEvent: NextEvent?

  struct NextEvent: Decodable {
    var title: String
    var at: String
  }
}

private func loadGlance() -> Glance? {
  guard let defaults = UserDefaults(suiteName: appGroup),
    let raw = defaults.string(forKey: glanceKey),
    let data = raw.data(using: .utf8)
  else { return nil }
  return try? JSONDecoder().decode(Glance.self, from: data)
}

private func shortTime(_ iso: String) -> String {
  let parser = ISO8601DateFormatter()
  parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
  guard let date else { return "" }
  let out = DateFormatter()
  out.timeStyle = .short
  out.dateStyle = .none
  return out.string(from: date)
}

struct OrbynEntry: TimelineEntry {
  let date: Date
  let glance: Glance?
}

struct OrbynProvider: TimelineProvider {
  func placeholder(in context: Context) -> OrbynEntry {
    OrbynEntry(date: Date(), glance: nil)
  }
  func getSnapshot(
    in context: Context, completion: @escaping (OrbynEntry) -> Void
  ) {
    completion(OrbynEntry(date: Date(), glance: loadGlance()))
  }
  func getTimeline(
    in context: Context, completion: @escaping (Timeline<OrbynEntry>) -> Void
  ) {
    let entry = OrbynEntry(date: Date(), glance: loadGlance())
    // The app nudges via reloadWidget(); refresh hourly as a fallback.
    let next =
      Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

struct OrbynWidgetView: View {
  var entry: OrbynEntry
  @Environment(\.widgetFamily) private var family

  private var accent: Color { Color("accent") }

  var body: some View {
    if let g = entry.glance {
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 6) {
          Circle().fill(accent).frame(width: 8, height: 8)
          Text("Today").font(.caption).foregroundStyle(.secondary)
          Spacer()
        }
        Text("\(g.todayOpen)")
          .font(.system(size: family == .systemSmall ? 34 : 40, weight: .bold))
          .foregroundStyle(accent)
        Text(g.todayOpen == 1 ? "task to do" : "tasks to do")
          .font(.caption).foregroundStyle(.secondary)
        Spacer(minLength: 0)
        if family != .systemSmall, let e = g.nextEvent {
          HStack(spacing: 4) {
            Image(systemName: "calendar")
            Text("\(shortTime(e.at)) · \(e.title)").lineLimit(1)
          }
          .font(.caption)
        }
        Text(subtitle(g)).font(.caption2).foregroundStyle(.tertiary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    } else {
      VStack(spacing: 4) {
        Text("Orbyn").font(.headline)
        Text("Open the app to sync").font(.caption)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func subtitle(_ g: Glance) -> String {
    var parts: [String] = []
    if g.overdue > 0 { parts.append("\(g.overdue) overdue") }
    if g.todayDone > 0 { parts.append("\(g.todayDone) done") }
    return parts.isEmpty ? "All caught up" : parts.joined(separator: " · ")
  }
}

@main
struct OrbynWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "OrbynWidget", provider: OrbynProvider()) {
      entry in
      OrbynWidgetView(entry: entry)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Orbyn")
    .description("Today's tasks and your next event.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
