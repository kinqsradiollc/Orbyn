import AppIntents
import Foundation

// Siri, Shortcuts and Spotlight (CAP-07): Add to Orbyn, Add to today's
// agenda, What's next and Start focus. They run without opening the app
// (Start focus opens it): a task said to Siri waits in the shared App Group
// and the app adds it the next time it runs. The phrases match @orbyn/core
// SIRI_ACTIONS (a backend test checks). Copied into the app target by
// mobile/modules/orbyn-capture/app.plugin.js.

private let orbynGroup = "group.com.orbyn.planner"

private enum OrbynShared {
  static var defaults: UserDefaults? { UserDefaults(suiteName: orbynGroup) }

  static func capture(_ text: String, to: String) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    var queue: [String: Any] = [:]
    if let raw = defaults?.string(forKey: "pending"),
      let data = raw.data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    {
      queue = parsed
    }
    var captures = queue["captures"] as? [[String: Any]] ?? []
    captures.append([
      "id": UUID().uuidString,
      "text": String(trimmed.prefix(500)),
      "to": to,
      "at": ISO8601DateFormatter().string(from: Date()),
    ])
    queue["captures"] = Array(captures.suffix(50))
    if queue["ticks"] == nil { queue["ticks"] = [] }
    if let data = try? JSONSerialization.data(withJSONObject: queue),
      let raw = String(data: data, encoding: .utf8)
    {
      defaults?.set(raw, forKey: "pending")
    }
  }

  static func open(_ link: String) {
    defaults?.set(link, forKey: "open")
  }

  static func nextUp() -> String {
    guard let raw = defaults?.string(forKey: "glance"),
      let data = raw.data(using: .utf8),
      let glance = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return "Open Orbyn once so it can tell you what's next." }
    if let tasks = glance["tasks"] as? [[String: Any]],
      let first = tasks.first, let title = first["title"] as? String
    {
      let overdue = first["overdue"] as? Bool ?? false
      return overdue ? "Next up: \(title). It's overdue." : "Next up: \(title)."
    }
    if let event = glance["nextEvent"] as? [String: Any],
      let title = event["title"] as? String
    {
      return "Nothing to do before \(title)."
    }
    return "Nothing is waiting. Enjoy the space."
  }
}

struct AddTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Add to Orbyn"
  static var description = IntentDescription("Add a task to Orbyn.")
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Task", requestValueDialog: "What should I add?")
  var text: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    OrbynShared.capture(text, to: "inbox")
    return .result(dialog: "Added to Orbyn.")
  }
}

struct AddToAgendaIntent: AppIntent {
  static var title: LocalizedStringResource = "Add to today's agenda"
  static var description = IntentDescription("Add a line to today's agenda in Orbyn.")
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Words", requestValueDialog: "What should I add to today's agenda?")
  var text: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    OrbynShared.capture(text, to: "agenda")
    return .result(dialog: "Added to today's agenda.")
  }
}

struct WhatsNextIntent: AppIntent {
  static var title: LocalizedStringResource = "What's next"
  static var description = IntentDescription("Hear your next task in Orbyn.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    .result(dialog: IntentDialog(stringLiteral: OrbynShared.nextUp()))
  }
}

struct StartFocusIntent: AppIntent {
  static var title: LocalizedStringResource = "Start focus"
  static var description = IntentDescription("Start a focus session on what's next in Orbyn.")
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    OrbynShared.open("orbyn://focus")
    return .result()
  }
}

struct OrbynShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AddTaskIntent(),
      phrases: ["Add to \(.applicationName)", "Add a task in \(.applicationName)"],
      shortTitle: "Add task",
      systemImageName: "plus.circle")
    AppShortcut(
      intent: AddToAgendaIntent(),
      phrases: ["Add to today's agenda in \(.applicationName)"],
      shortTitle: "Add to agenda",
      systemImageName: "calendar")
    AppShortcut(
      intent: WhatsNextIntent(),
      phrases: ["What's next in \(.applicationName)"],
      shortTitle: "What's next",
      systemImageName: "list.bullet")
    AppShortcut(
      intent: StartFocusIntent(),
      phrases: ["Start focus in \(.applicationName)"],
      shortTitle: "Start focus",
      systemImageName: "scope")
  }
}
