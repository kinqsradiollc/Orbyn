package PACKAGE_NAME

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

// Orbyn's Android widget (CAP-06): today's tasks with a circle to tick each,
// and New task. It reads the glance the app keeps in its preferences
// ("orbyn_capture", written by mobile/modules/orbyn-capture); a tick shows
// at once and waits there for the app to send. Written into the app by the
// module's config plugin.
class OrbynTodayWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, render(context))
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action == ACTION_TICK) {
      val item = intent.getStringExtra(EXTRA_ITEM) ?: return
      tick(context, item)
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, OrbynTodayWidget::class.java))
      for (id in ids) manager.updateAppWidget(id, render(context))
    }
  }

  companion object {
    const val PREFS = "orbyn_capture"
    const val ACTION_TICK = "PACKAGE_NAME.ORBYN_TICK"
    const val EXTRA_ITEM = "item"
    private val ROWS = listOf(
      Triple(R.id.orbyn_row_0, R.id.orbyn_tick_0, R.id.orbyn_title_0),
      Triple(R.id.orbyn_row_1, R.id.orbyn_tick_1, R.id.orbyn_title_1),
      Triple(R.id.orbyn_row_2, R.id.orbyn_tick_2, R.id.orbyn_title_2),
    )

    private fun now(): String =
      SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .format(Date())

    private fun prefs(context: Context) =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun glance(context: Context): JSONObject? =
      prefs(context).getString("glance", null)?.let {
        try { JSONObject(it) } catch (e: Exception) { null }
      }

    fun render(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.orbyn_widget)
      val add = PendingIntent.getActivity(
        context, 0,
        Intent(Intent.ACTION_VIEW, Uri.parse("orbyn://add")).setPackage(context.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      views.setOnClickPendingIntent(R.id.orbyn_add, add)
      val open = PendingIntent.getActivity(
        context, 1,
        Intent(Intent.ACTION_VIEW, Uri.parse("orbyn://today")).setPackage(context.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      views.setOnClickPendingIntent(R.id.orbyn_heading, open)
      val g = glance(context)
      if (g == null) {
        views.setTextViewText(R.id.orbyn_count, "")
        views.setTextViewText(R.id.orbyn_empty, "Open Orbyn to sync")
        views.setViewVisibility(R.id.orbyn_empty, View.VISIBLE)
        for ((row, _, _) in ROWS) views.setViewVisibility(row, View.GONE)
        return views
      }
      val open0 = g.optInt("todayOpen", 0)
      views.setTextViewText(
        R.id.orbyn_count,
        if (open0 == 1) "1 task today" else "$open0 tasks today",
      )
      val tasks = g.optJSONArray("tasks") ?: JSONArray()
      views.setViewVisibility(R.id.orbyn_empty, if (tasks.length() == 0) View.VISIBLE else View.GONE)
      views.setTextViewText(R.id.orbyn_empty, "All clear")
      ROWS.forEachIndexed { i, (row, tickId, titleId) ->
        if (i >= tasks.length()) {
          views.setViewVisibility(row, View.GONE)
          return@forEachIndexed
        }
        val task = tasks.getJSONObject(i)
        val id = task.optString("id")
        views.setViewVisibility(row, View.VISIBLE)
        views.setTextViewText(titleId, task.optString("title"))
        views.setContentDescription(tickId, "Tick ${task.optString("title")}")
        val tick = Intent(context, OrbynTodayWidget::class.java).apply {
          action = ACTION_TICK
          putExtra(EXTRA_ITEM, id)
          data = Uri.parse("orbyn-tick://$id")
        }
        views.setOnClickPendingIntent(
          tickId,
          PendingIntent.getBroadcast(
            context, 10 + i, tick,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
          ),
        )
      }
      return views
    }

    /** A task ticked here: off the widget now, sent by the app later. */
    fun tick(context: Context, item: String) {
      val p = prefs(context)
      val queue = p.getString("pending", null)?.let {
        try { JSONObject(it) } catch (e: Exception) { null }
      } ?: JSONObject()
      val ticks = queue.optJSONArray("ticks") ?: JSONArray()
      var seen = false
      for (i in 0 until ticks.length()) if (ticks.getJSONObject(i).optString("item") == item) seen = true
      if (!seen) ticks.put(JSONObject().put("item", item).put("at", now()))
      queue.put("ticks", ticks)
      if (!queue.has("captures")) queue.put("captures", JSONArray())
      val g = glance(context)
      if (g != null) {
        val tasks = g.optJSONArray("tasks") ?: JSONArray()
        val kept = JSONArray()
        for (i in 0 until tasks.length()) {
          val t = tasks.getJSONObject(i)
          if (t.optString("id") != item) kept.put(t)
        }
        g.put("tasks", kept)
        p.edit().putString("glance", g.toString()).apply()
      }
      p.edit().putString("pending", queue.toString()).apply()
    }

    /** A task added from outside the app (the tile), waiting for the app. */
    fun capture(context: Context, text: String) {
      val p = prefs(context)
      val queue = p.getString("pending", null)?.let {
        try { JSONObject(it) } catch (e: Exception) { null }
      } ?: JSONObject()
      val captures = queue.optJSONArray("captures") ?: JSONArray()
      captures.put(
        JSONObject()
          .put("id", UUID.randomUUID().toString())
          .put("text", text.take(500))
          .put("to", "inbox")
          .put("at", now()),
      )
      queue.put("captures", captures)
      if (!queue.has("ticks")) queue.put("ticks", JSONArray())
      p.edit().putString("pending", queue.toString()).apply()
    }
  }
}
