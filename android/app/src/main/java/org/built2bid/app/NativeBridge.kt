package org.built2bid.app

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONObject

/**
 * The only door between the web page and the phone. Exposed to the page as `window.Built2BidNative` and only to
 * the Built2Bid origin (main frame), so no other site or embedded frame can reach it.
 *
 * Page → app (JSON string):
 *   {type:"hello"}                                   → replies with state
 *   {type:"sync", resourceId, sites:[{id,name,lat,lng,radiusM}], dwellMin, graceMin, maxAccuracyM}
 *                                                    → saves today's sites and registers geofences
 *   {type:"stop"}                                    → removes all geofences and forgets the sites
 *   {type:"permission"}                              → disclosure, then location ("all the time") and notifications
 *   {type:"battery"}                                 → opens Android's battery optimization list
 * App → page: {type:"state", app:"android", version, location:"granted|prompt|denied", background, notifications,
 *              batteryUnrestricted, tracking, sites, error}
 */
class NativeBridge(private val activity: MainActivity) : WebViewCompat.WebMessageListener {
    private var proxy: JavaScriptReplyProxy? = null
    private var lastError: String? = null

    override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
        if (!isMainFrame || sourceOrigin.toString().trimEnd('/') != MainActivity.origin()) return
        proxy = replyProxy
        val msg = runCatching { JSONObject(message.data ?: return) }.getOrNull() ?: return
        when (msg.optString("type")) {
            "hello" -> pushState()
            "sync" -> {
                val cfg = GpsConfig.fromJson(msg) ?: run { lastError = "bad_config"; pushState(); return }
                Geofences.apply(activity.applicationContext, cfg) { _, err -> lastError = err; activity.runOnUiThread { pushState() } }
            }
            "stop" -> { Geofences.stop(activity.applicationContext); lastError = null; pushState() }
            "permission" -> activity.startLocationFlow { GpsConfig.load(activity)?.let { Geofences.restore(activity) }; pushState() }
            "battery" -> activity.openBatterySettings()
        }
    }

    // Only reachable when the listener was registered, which MainActivity does only if WEB_MESSAGE_LISTENER exists.
    @SuppressLint("RequiresFeature")
    fun pushState() {
        val ctx = activity.applicationContext
        val cfg = GpsConfig.load(ctx)
        val tracking = cfg != null && Permissions.background(ctx) && GpsConfig.registeredFingerprint(ctx) == cfg.fingerprint()
        val state = JSONObject()
            .put("type", "state")
            .put("app", "android")
            .put("version", BuildConfig.VERSION_NAME)
            .put("location", activity.locationState())
            .put("background", Permissions.background(ctx))
            .put("notifications", Permissions.notifications(ctx))
            .put("batteryUnrestricted", Permissions.batteryUnrestricted(ctx))
            .put("tracking", tracking)
            .put("sites", cfg?.sites?.size ?: 0)
            .put("error", lastError ?: JSONObject.NULL)
        runCatching { proxy?.postMessage(state.toString()) }
    }
}
