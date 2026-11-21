package org.built2bid.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** One assigned work site, as the time clock page passes it to the app (centre + radius only). */
data class Site(val id: String, val name: String, val lat: Double, val lng: Double, val radiusM: Float)

/**
 * What the app watches in the background: the employee (resourceId), today's assigned sites and the company's
 * timing rules. Written by the time clock page through [NativeBridge]; read by the geofence receiver and workers.
 * Nothing here is a coordinate trail: only the sites' fixed centres, which the server already sent to the page.
 */
data class GpsConfig(
    val resourceId: String,
    val sites: List<Site>,
    val dwellMin: Int,
    val graceMin: Int,
    val maxAccuracyM: Int,
) {
    /** Changes only when the set of fences or their timing changes, so re-opening the page doesn't re-register. */
    fun fingerprint(): String = buildString {
        append(resourceId).append('|').append(dwellMin).append('|').append(graceMin).append('|').append(maxAccuracyM)
        sites.sortedBy { it.id }.forEach { append('|').append(it.id).append(',').append(it.lat).append(',').append(it.lng).append(',').append(it.radiusM) }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("resourceId", resourceId)
        .put("dwellMin", dwellMin)
        .put("graceMin", graceMin)
        .put("maxAccuracyM", maxAccuracyM)
        .put("sites", JSONArray().apply {
            sites.forEach { put(JSONObject().put("id", it.id).put("name", it.name).put("lat", it.lat).put("lng", it.lng).put("radiusM", it.radiusM.toDouble())) }
        })

    fun site(id: String): Site? = sites.firstOrNull { it.id == id }

    companion object {
        private const val PREFS = "b2b_gps"
        private const val KEY = "config"
        private const val KEY_FP = "registered"
        private val UUID = Regex("^[0-9a-fA-F-]{36}$")

        /** Validates input from the page; anything malformed is dropped rather than half-applied. */
        fun fromJson(o: JSONObject): GpsConfig? {
            val resourceId = o.optString("resourceId")
            if (!UUID.matches(resourceId)) return null
            val arr = o.optJSONArray("sites") ?: JSONArray()
            val sites = (0 until minOf(arr.length(), 100)).mapNotNull { i ->
                val s = arr.optJSONObject(i) ?: return@mapNotNull null
                val id = s.optString("id")
                val lat = s.optDouble("lat", Double.NaN)
                val lng = s.optDouble("lng", Double.NaN)
                val r = s.optDouble("radiusM", Double.NaN)
                if (!UUID.matches(id) || lat.isNaN() || lng.isNaN() || r.isNaN() || lat !in -90.0..90.0 || lng !in -180.0..180.0) null
                else Site(id, s.optString("name").take(200), lat, lng, r.coerceIn(30.0, 2000.0).toFloat())
            }
            return GpsConfig(
                resourceId = resourceId,
                sites = sites,
                dwellMin = o.optInt("dwellMin", 5).coerceIn(1, 30),
                graceMin = o.optInt("graceMin", 10).coerceIn(2, 60),
                maxAccuracyM = o.optInt("maxAccuracyM", 100).coerceIn(20, 500),
            )
        }

        fun load(ctx: Context): GpsConfig? =
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)?.let { runCatching { fromJson(JSONObject(it)) }.getOrNull() }

        fun save(ctx: Context, c: GpsConfig) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, c.toJson().toString()).apply()
        }

        fun clear(ctx: Context) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).remove(KEY_FP).apply()
        }

        fun registeredFingerprint(ctx: Context): String? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_FP, null)
        fun setRegisteredFingerprint(ctx: Context, fp: String?) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply { if (fp == null) remove(KEY_FP) else putString(KEY_FP, fp) }.apply()
        }
    }
}
