package org.built2bid.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.Location
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent

/**
 * Turns an Android geofence transition into the same events the browser clock sends (enter / dwell / exit), with
 * the distance from the site centre and GPS accuracy only, then hands them to [EventWorker] to deliver (retrying
 * offline for up to a day). An exit also schedules "exit_confirmed" after the company's grace time; arriving again
 * cancels it.
 */
class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val ev = GeofencingEvent.fromIntent(intent) ?: return
        if (ev.hasError()) {
            Log.w("B2BGeofence", "error ${GeofenceStatusCodes.getStatusCodeString(ev.errorCode)}")
            // Location turned off: Android dropped the fences. They're put back when the app is next opened.
            if (ev.errorCode == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) GpsConfig.setRegisteredFingerprint(ctx, null)
            return
        }
        val cfg = GpsConfig.load(ctx) ?: return
        val kind = when (ev.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "enter"
            Geofence.GEOFENCE_TRANSITION_DWELL -> "dwell"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "exit"
            else -> return
        }
        val loc = ev.triggeringLocation
        val now = System.currentTimeMillis()
        for (fence in ev.triggeringGeofences.orEmpty()) {
            val site = cfg.site(fence.requestId) ?: continue
            val reading = Reading.of(loc, site, kind)
            when (kind) {
                "exit" -> EventWorker.scheduleExitConfirm(ctx, cfg, site, now, reading)
                else -> EventWorker.cancelExitConfirm(ctx, site.id)
            }
            EventWorker.enqueue(ctx, cfg.resourceId, site.id, kind, now, reading)
        }
    }
}

/** Distance from the site centre and GPS accuracy, in metres. Never coordinates. */
data class Reading(val distanceM: Double, val accuracyM: Double, val measured: Boolean) {
    companion object {
        fun of(loc: Location?, site: Site, kind: String): Reading {
            if (loc == null) {
                // Android almost always includes the location. Without one, report the fence edge and let the
                // worker take a fresh reading before sending.
                return Reading(site.radiusM.toDouble(), 999.0, measured = false)
            }
            val out = FloatArray(1)
            Location.distanceBetween(loc.latitude, loc.longitude, site.lat, site.lng, out)
            return Reading(out[0].toDouble(), if (loc.hasAccuracy()) loc.accuracy.toDouble() else 999.0, measured = true)
        }
    }

    /** Same rule the server applies: inside needs a usable fix within the radius; outside needs to be clearly beyond it. */
    fun clear(kind: String, site: Site, maxAccuracyM: Int): Boolean = when (kind) {
        "enter", "dwell" -> accuracyM <= maxAccuracyM && distanceM <= site.radiusM
        else -> accuracyM <= maxAccuracyM * 2 && distanceM - accuracyM > site.radiusM
    }
}
