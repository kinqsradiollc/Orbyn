import Foundation
import WidgetKit

// What the widgets read, and the queue they write: the "glance" the app
// keeps in the shared App Group (mobile/src/lib/nativeCapture.ts and
// @orbyn/core buildGlance), and ticks and captures waiting for the app to
// send (@orbyn/core native-capture.ts reads them back). The widgets never
// hold the account's sign-in: a tick shows at once here and reaches Orbyn
// the next time the app runs.

let orbynAppGroup = "group.com.orbyn.planner"

struct GlanceEvent: Codable, Hashable {
  var title: String
  var at: String
}

struct GlanceTask: Codable, Hashable, Identifiable {
  var id: String
  var title: String
  var due: String?
  var overdue: Bool
  var list: String?
  var project: String?
}

struct Glance: Codable {
  var updatedAt: String?
  var todayOpen: Int
  var todayDone: Int
  var overdue: Int
  var nextEvent: GlanceEvent?
  var tasks: [GlanceTask]?
}

struct PendingCapture: Codable {
  var id: String
  var text: String
  var to: String
  var at: String
}

struct PendingTick: Codable {
  var item: String
  var at: String
}

struct PendingQueue: Codable {
  var captures: [PendingCapture] = []
  var ticks: [PendingTick] = []
}

enum SharedStore {
  static var defaults: UserDefaults? { UserDefaults(suiteName: orbynAppGroup) }

  static func glance() -> Glance? {
    guard let raw = defaults?.string(forKey: "glance"),
      let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(Glance.self, from: data)
  }

  static func save(_ glance: Glance) {
    guard let data = try? JSONEncoder().encode(glance),
      let raw = String(data: data, encoding: .utf8)
    else { return }
    defaults?.set(raw, forKey: "glance")
  }

  static func pending() -> PendingQueue {
    guard let raw = defaults?.string(forKey: "pending"),
      let data = raw.data(using: .utf8),
      let queue = try? JSONDecoder().decode(PendingQueue.self, from: data)
    else { return PendingQueue() }
    return queue
  }

  static func save(_ queue: PendingQueue) {
    guard let data = try? JSONEncoder().encode(queue),
      let raw = String(data: data, encoding: .utf8)
    else { return }
    defaults?.set(raw, forKey: "pending")
  }

  static func now() -> String { ISO8601DateFormatter().string(from: Date()) }

  /** A task ticked in a widget: gone from the glance now, sent by the app later. */
  static func tick(_ id: String) {
    var queue = pending()
    if !queue.ticks.contains(where: { $0.item == id }) {
      queue.ticks.append(PendingTick(item: id, at: now()))
      queue.ticks = Array(queue.ticks.suffix(50))
      save(queue)
    }
    if var g = glance() {
      if let task = g.tasks?.first(where: { $0.id == id }) {
        g.tasks?.removeAll { $0.id == id }
        if !task.overdue, task.due != nil, isToday(task.due) {
          g.todayOpen = max(0, g.todayOpen - 1)
          g.todayDone += 1
        } else if task.overdue {
          g.overdue = max(0, g.overdue - 1)
        }
        save(g)
      }
    }
    WidgetCenter.shared.reloadAllTimelines()
  }

  /** A task typed or said outside the app, waiting for the app to add it. */
  static func capture(_ text: String, to: String) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    var queue = pending()
    queue.captures.append(
      PendingCapture(
        id: UUID().uuidString, text: String(trimmed.prefix(500)), to: to, at: now()))
    queue.captures = Array(queue.captures.suffix(50))
    save(queue)
  }

  static func isToday(_ iso: String?) -> Bool {
    guard let date = parse(iso) else { return false }
    return Calendar.current.isDateInToday(date)
  }

  static func parse(_ iso: String?) -> Date? {
    guard let iso else { return nil }
    let full = ISO8601DateFormatter()
    full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return full.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
  }

  static func shortTime(_ iso: String?) -> String {
    guard let date = parse(iso) else { return "" }
    let out = DateFormatter()
    out.timeStyle = .short
    out.dateStyle = .none
    return out.string(from: date)
  }

  static func shortDue(_ iso: String?) -> String {
    guard let date = parse(iso) else { return "" }
    if Calendar.current.isDateInToday(date) { return shortTime(iso) }
    let out = DateFormatter()
    out.setLocalizedDateFormatFromTemplate("EEE d")
    return out.string(from: date)
  }
}
