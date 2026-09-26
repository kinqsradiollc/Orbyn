import AppIntents
import SwiftUI
import WidgetKit

// The Home Screen widget (CAP-06): today's tasks (or what's next, or one
// list or project) with a circle to tick each, and New task. It reads the
// glance the app keeps; a tick shows at once and reaches Orbyn when the app
// next runs.

struct TodayEntry: TimelineEntry {
  let date: Date
  let glance: Glance?
  let config: OrbynWidgetConfig
}

struct TodayProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: Date(), glance: nil, config: OrbynWidgetConfig())
  }

  func snapshot(for configuration: OrbynWidgetConfig, in context: Context) async -> TodayEntry {
    TodayEntry(date: Date(), glance: SharedStore.glance(), config: configuration)
  }

  func timeline(for configuration: OrbynWidgetConfig, in context: Context) async -> Timeline<
    TodayEntry
  > {
    let entry = TodayEntry(date: Date(), glance: SharedStore.glance(), config: configuration)
    // The app asks for a reload after each refresh; hourly as a fallback.
    let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
    return Timeline(entries: [entry], policy: .after(next))
  }
}

/** The tasks a widget lists, as it was set up to. */
func widgetTasks(_ glance: Glance?, _ config: OrbynWidgetConfig) -> [GlanceTask] {
  let all = glance?.tasks ?? []
  switch config.show {
  case .today:
    return all.filter { $0.overdue || SharedStore.isToday($0.due) }
  case .upNext:
    return all
  case .scope:
    guard let scope = config.scope else { return all }
    return all.filter {
      scope.kind == "list" ? $0.list == scope.value : $0.project == scope.value
    }
  }
}

struct TodayWidgetView: View {
  var entry: TodayEntry
  @Environment(\.widgetFamily) private var family
  private var accent: Color { Color("accent") }

  private var heading: String {
    switch entry.config.show {
    case .today: return "Today"
    case .upNext: return "Up next"
    case .scope: return entry.config.scope?.name ?? "Tasks"
    }
  }

  private var rows: Int {
    switch family {
    case .systemSmall: return 2
    case .systemMedium: return 3
    default: return 6
    }
  }

  var body: some View {
    let tasks = widgetTasks(entry.glance, entry.config)
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Circle().fill(accent).frame(width: 8, height: 8)
        Text(heading).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        Spacer(minLength: 4)
        Link(destination: URL(string: "orbyn://add")!) {
          Image(systemName: "plus.circle.fill").foregroundStyle(accent)
        }
        .accessibilityLabel("New task")
      }
      if entry.glance == nil {
        Spacer(minLength: 0)
        Text("Open Orbyn to sync").font(.caption).foregroundStyle(.secondary)
        Spacer(minLength: 0)
      } else if tasks.isEmpty {
        Spacer(minLength: 0)
        Text(entry.config.show == .today ? "All clear today" : "Nothing waiting")
          .font(.subheadline).foregroundStyle(.secondary)
        Spacer(minLength: 0)
      } else {
        ForEach(tasks.prefix(rows)) { task in
          HStack(spacing: 8) {
            Button(intent: TickTaskIntent(taskID: task.id)) {
              Image(systemName: "circle")
                .foregroundStyle(task.overdue ? Color.orange : accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Tick \(task.title)")
            Text(task.title).font(.caption).lineLimit(1)
            Spacer(minLength: 2)
            if family != .systemSmall, task.due != nil {
              Text(SharedStore.shortDue(task.due))
                .font(.caption2).foregroundStyle(.tertiary)
            }
          }
        }
        Spacer(minLength: 0)
        if family != .systemSmall, let e = entry.glance?.nextEvent {
          HStack(spacing: 4) {
            Image(systemName: "calendar")
            Text("\(SharedStore.shortTime(e.at)) · \(e.title)").lineLimit(1)
          }
          .font(.caption2).foregroundStyle(.secondary)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct OrbynTodayWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "OrbynWidget", intent: OrbynWidgetConfig.self, provider: TodayProvider()
    ) { entry in
      TodayWidgetView(entry: entry)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Orbyn")
    .description("Tick today's tasks, see what's next, or follow one list or project.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
