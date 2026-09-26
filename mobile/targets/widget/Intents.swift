import AppIntents
import WidgetKit

// The widgets' own actions (CAP-06): tick a task, and what a widget shows.

/** Tick a task from a widget. It waits in the App Group for the app to send. */
struct TickTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Tick a task"
  static var isDiscoverable: Bool = false

  @Parameter(title: "Task")
  var taskID: String

  init() {}
  init(taskID: String) { self.taskID = taskID }

  func perform() async throws -> some IntentResult {
    SharedStore.tick(taskID)
    return .result()
  }
}

/** What a widget lists: today, what's next, or one list or project. */
enum WidgetShow: String, AppEnum {
  case today
  case upNext
  case scope

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Show"
  static var caseDisplayRepresentations: [WidgetShow: DisplayRepresentation] = [
    .today: "Today",
    .upNext: "Up next",
    .scope: "A list or project",
  ]
}

/** A list or a project, named as the glance names them. */
struct ScopeEntity: AppEntity {
  var id: String
  var name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "List or project"
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
  static var defaultQuery = ScopeQuery()

  /** "list:Physics" or "project:Telescope". */
  var kind: String { String(id.split(separator: ":").first ?? "") }
  var value: String { String(id.drop(while: { $0 != ":" }).dropFirst()) }
}

struct ScopeQuery: EntityQuery {
  func entities(for identifiers: [ScopeEntity.ID]) async throws -> [ScopeEntity] {
    try await suggestedEntities().filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [ScopeEntity] {
    let tasks = SharedStore.glance()?.tasks ?? []
    var seen = Set<String>()
    var out: [ScopeEntity] = []
    for t in tasks {
      if let l = t.list, seen.insert("list:\(l)").inserted {
        out.append(ScopeEntity(id: "list:\(l)", name: l))
      }
      if let p = t.project, seen.insert("project:\(p)").inserted {
        out.append(ScopeEntity(id: "project:\(p)", name: p))
      }
    }
    return out
  }
}

struct OrbynWidgetConfig: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Orbyn"
  static var description = IntentDescription("Choose what the widget lists.")

  @Parameter(title: "Show", default: .today)
  var show: WidgetShow

  @Parameter(title: "List or project")
  var scope: ScopeEntity?

  init() {}
}
