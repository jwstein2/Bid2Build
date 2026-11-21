package org.built2bid.app

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * Registers today's assigned sites with Google Play services geofencing. Android delivers ENTER, DWELL (still
 * inside after the company's dwell time) and EXIT to [GeofenceReceiver] even when the app is closed, as long as
 * the employee chose "Allow all the time". Android allows 100 fences per app; the page sends today's sites only.
 */
object Geofences {
    private const val TAG = "B2BGeofences"

    private fun pendingIntent(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, 0, Intent(ctx, GeofenceReceiver::class.java),
        // Geofencing fills in the event extras, so the intent must be mutable.
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )

    /** Applies [c] if it differs from what is registered (or [force]). Returns false when it couldn't register. */
    @SuppressLint("MissingPermission")
    fun apply(ctx: Context, c: GpsConfig, force: Boolean = false, done: (Boolean, String?) -> Unit = { _, _ -> }) {
        GpsConfig.save(ctx, c)
        if (!Permissions.background(ctx)) { done(false, "background_permission"); return }
        val fp = c.fingerprint()
        if (!force && GpsConfig.registeredFingerprint(ctx) == fp) { done(true, null); return }
        val client = LocationServices.getGeofencingClient(ctx)
        client.removeGeofences(pendingIntent(ctx)).addOnCompleteListener {
            if (c.sites.isEmpty()) { GpsConfig.setRegisteredFingerprint(ctx, fp); done(true, null); return@addOnCompleteListener }
            val fences = c.sites.take(100).map { s ->
                Geofence.Builder()
                    .setRequestId(s.id)
                    .setCircularRegion(s.lat, s.lng, s.radiusM)
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_DWELL or Geofence.GEOFENCE_TRANSITION_EXIT)
                    .setLoiteringDelay(c.dwellMin * 60_000)
                    // Responsiveness trades battery for speed; 1 minute keeps clock-in close to arrival.
                    .setNotificationResponsiveness(60_000)
                    .build()
            }
            val req = GeofencingRequest.Builder()
                // Already standing on a site when the fences are set up counts as arriving now.
                .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER or GeofencingRequest.INITIAL_TRIGGER_DWELL)
                .addGeofences(fences)
                .build()
            client.addGeofences(req, pendingIntent(ctx))
                .addOnSuccessListener { GpsConfig.setRegisteredFingerprint(ctx, fp); done(true, null) }
                .addOnFailureListener { e ->
                    Log.w(TAG, "addGeofences failed: ${e.message}")
                    GpsConfig.setRegisteredFingerprint(ctx, null)
                    // Usually "location is turned off" (GEOFENCE_NOT_AVAILABLE).
                    done(false, "geofence_unavailable")
                }
        }
    }

    /** Re-registers the saved config (after reboot, app update or the permission being granted). */
    fun restore(ctx: Context) {
        GpsConfig.setRegisteredFingerprint(ctx, null)
        GpsConfig.load(ctx)?.let { apply(ctx, it, force = true) }
    }

    fun stop(ctx: Context) {
        LocationServices.getGeofencingClient(ctx).removeGeofences(pendingIntent(ctx))
        EventWorker.cancelAllExitConfirms(ctx, GpsConfig.load(ctx))
        GpsConfig.clear(ctx)
    }
}
