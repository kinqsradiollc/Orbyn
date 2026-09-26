import SwiftUI
import WidgetKit

// The Lock Screen's "Next up" (CAP-06): the next task or event, small
// enough for the Lock Screen and StandBy.

struct NextUpEntry: TimelineEntry {
  let date: Date
  let glance: Glance?
}

struct NextUpProvider: TimelineProvider {
  func placeholder(in context: Context) -> NextUpEntry { NextUpEntry(date: Date(), glance: nil) }
  func getSnapshot(in context: Context, completion: @escaping (NextUpEntry) -> Void) {
    completion(NextUpEntry(date: Date(), glance: SharedStore.glance()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<NextUpEntry>) -> Void) {
    let entry = NextUpEntry(date: Date(), glance: SharedStore.glance())
    let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

struct NextUpView: View {
  var entry: NextUpEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let task = entry.glance?.tasks?.first
    let event = entry.glance?.nextEvent
    switch family {
    case .accessoryInline:
      if let task {
        Text("Next: \(task.title)")
      } else if let event {
        Text("\(SharedStore.shortTime(event.at)) \(event.title)")
      } else {
        Text("Orbyn: all clear")
      }
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          Text("\(entry.glance?.todayOpen ?? 0)").font(.title3).bold()
          Text("today").font(.caption2)
        }
      }
      .accessibilityLabel("\(entry.glance?.todayOpen ?? 0) tasks today")
    default:
      VStack(alignment: .leading, spacing: 2) {
        Text("Next up").font(.caption2).foregroundStyle(.secondary)
        if let task {
          Text(task.title).font(.headline).lineLimit(1)
          if task.due != nil {
            Text(task.overdue ? "Overdue" : "Due \(SharedStore.shortDue(task.due))")
              .font(.caption2)
          }
        } else if let event {
          Text(event.title).font(.headline).lineLimit(1)
          Text(SharedStore.shortTime(event.at)).font(.caption2)
        } else {
          Text("Nothing waiting").font(.headline)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

struct OrbynNextUpWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "OrbynNextUp", provider: NextUpProvider()) { entry in
      NextUpView(entry: entry)
        .containerBackground(.clear, for: .widget)
        .widgetURL(URL(string: "orbyn://today"))
    }
    .configurationDisplayName("Next up")
    .description("Your next task or event on the Lock Screen.")
    .supportedFamilies([.accessoryRectangular, .accessoryInline, .accessoryCircular])
  }
}
