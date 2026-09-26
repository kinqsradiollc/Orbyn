package expo.modules.orbyncapture

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The app's side of Android capture (CAP-06, CAP-09): the glance the widget
// reads, and the queue of ticks and captures the widget and the Quick
// Settings tile leave for the app to send. Both live in the app's own
// preferences ("orbyn_capture"); the widget never holds the sign-in.
class OrbynCaptureModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No context")

  private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("OrbynCapture")

    Function("setGlance") { json: String ->
      prefs().edit().putString("glance", json).apply()
      refreshWidgets()
    }

    Function("getPending") { ->
      prefs().getString("pending", null)
    }

    Function("setPending") { json: String ->
      prefs().edit().putString("pending", json).apply()
    }

    Function("takeOpen") { ->
      val link = prefs().getString("open", null)
      if (link != null) prefs().edit().remove("open").apply()
      link
    }

    // iOS has the Live Activity; Android's focus timer is the app's own.
    Function("startFocus") { _: String, _: Double -> }
    Function("updateFocus") { _: Double, _: Boolean -> }
    Function("endFocus") { -> }
  }

  private fun refreshWidgets() {
    val manager = AppWidgetManager.getInstance(context)
    val widget = ComponentName(context.packageName, "${context.packageName}.OrbynTodayWidget")
    val ids = manager.getAppWidgetIds(widget)
    if (ids.isEmpty()) return
    val update = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
      component = widget
      putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
    }
    context.sendBroadcast(update)
  }

  companion object {
    const val PREFS = "orbyn_capture"
  }
}
