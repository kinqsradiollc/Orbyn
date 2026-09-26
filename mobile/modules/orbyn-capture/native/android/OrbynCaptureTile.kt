package PACKAGE_NAME

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

// "Add to Orbyn" in Quick Settings (CAP-09): one tap opens Orbyn's quick
// add, the same as the Lock Screen control on iPhone. Written into the app
// by mobile/modules/orbyn-capture's config plugin.
class OrbynCaptureTile : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.apply {
      state = Tile.STATE_INACTIVE
      label = "Add to Orbyn"
      updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("orbyn://add"))
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(
        PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE),
      )
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(open)
    }
  }
}
