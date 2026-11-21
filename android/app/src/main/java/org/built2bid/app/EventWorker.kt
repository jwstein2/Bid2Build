package org.built2bid.app

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.webkit.CookieManager
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Delivers geofence events to POST /api/workforce/gps/me (the same contract the browser clock uses), signed in
 * with the WebView's own session cookie. Events go out one at a time in order (an arrival must reach the server
 * before the "still here" that depends on it), retry with backoff while offline, and are dropped after 23 hours
 * because the server refuses anything older than a day. Each event has its own clientEventId, so a retry after a
 * lost reply is never counted twice.
 *
 * Mode "confirm" runs the company's grace time after leaving a site: if the employee is clearly still away it
 * queues "exit_confirmed"; if they're back it does nothing.
 */
class EventWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val d = inputData
        val occurredAt = d.getLong(K_AT, 0L)
        if (System.currentTimeMillis() - occurredAt > MAX_AGE_MS) return Result.failure()
        val cfg = GpsConfig.load(applicationContext) ?: return Result.success() // turned off since: drop quietly
        val resourceId = d.getString(K_RESOURCE) ?: return Result.failure()
        if (cfg.resourceId != resourceId) return Result.success()
        val site = cfg.site(d.getString(K_LOCATION) ?: "") ?: return Result.success()

        if (d.getString(K_MODE) == MODE_CONFIRM) {
            val fresh = freshReading(site)
            if (fresh != null && fresh.clear("enter", site, cfg.maxAccuracyM)) return Result.success() // came back
            val stored = Reading(d.getDouble(K_DIST, 0.0), d.getDouble(K_ACC, 999.0), true)
            val use = if (fresh != null && fresh.clear("exit_confirmed", site, cfg.maxAccuracyM)) fresh else stored
            enqueue(applicationContext, resourceId, site.id, "exit_confirmed", System.currentTimeMillis(), use)
            return Result.success()
        }

        val kind = d.getString(K_KIND) ?: return Result.failure()
        var reading = Reading(d.getDouble(K_DIST, 0.0), d.getDouble(K_ACC, 999.0), d.getBoolean(K_MEASURED, false))
        // Android decided this happened; if its reading wouldn't satisfy the server's accuracy rule, take one
        // fresh high-accuracy fix (only on the first try, so retries stay fast).
        if (runAttemptCount == 0 && !reading.clear(kind, site, cfg.maxAccuracyM)) {
            freshReading(site)?.let { f -> if (f.clear(kind, site, cfg.maxAccuracyM) || f.accuracyM < reading.accuracyM) reading = f }
        }

        val body = JSONObject()
            .put("action", "event")
            .put("resourceId", resourceId)
            .put("locationId", site.id)
            .put("kind", kind)
            .put("occurredAt", Instant.ofEpochMilli(occurredAt).toString())
            .put("accuracyM", Math.round(reading.accuracyM.coerceIn(0.0, 100_000.0)))
            .put("distanceM", Math.round(reading.distanceM.coerceIn(0.0, 40_000_000.0)))
            .put("source", "native_android")
            .put("clientEventId", d.getString(K_CLIENT_ID))

        return when (val r = post("/api/workforce/gps/me", body)) {
            is Http.Ok -> {
                Notifier.clearSignedOut(applicationContext)
                val message = r.json?.optString("message")?.takeIf { it.isNotBlank() && it != "null" }
                if (message != null) Notifier.clock(applicationContext, message)
                Result.success()
            }
            is Http.SignedOut -> { Notifier.signedOut(applicationContext); Result.retry() }
            is Http.Rejected -> { Log.w(TAG, "event refused ${r.code}"); Result.failure() }
            is Http.TryLater -> Result.retry()
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun freshReading(site: Site): Reading? {
        if (!Permissions.background(applicationContext)) return null
        return runCatching {
            val cts = CancellationTokenSource()
            val loc = withTimeoutOrNull(30_000) {
                LocationServices.getFusedLocationProviderClient(applicationContext)
                    .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token).await()
            }
            if (loc == null) cts.cancel()
            loc?.let { Reading.of(it, site, "fresh") }
        }.getOrNull()
    }

    private sealed class Http {
        data class Ok(val json: JSONObject?) : Http()
        data object SignedOut : Http()
        data class Rejected(val code: Int) : Http()
        data object TryLater : Http()
    }

    private suspend fun post(path: String, body: JSONObject): Http {
        val base = BuildConfig.BASE_URL
        val cookie = withContext(Dispatchers.Main) { CookieManager.getInstance().getCookie(base) }
            ?: return Http.SignedOut
        return withContext(Dispatchers.IO) {
            val conn = (URL(base + path).openConnection() as HttpURLConnection)
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = 20_000
                conn.readTimeout = 30_000
                conn.doOutput = true
                conn.instanceFollowRedirects = false
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Accept", "application/json")
                conn.setRequestProperty("Cookie", cookie)
                conn.setRequestProperty("User-Agent", "Built2BidAndroid/${BuildConfig.VERSION_NAME}")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
                val code = conn.responseCode
                // The server refreshes the session cookie as it goes; keep the WebView's copy current.
                conn.headerFields["Set-Cookie"]?.let { list ->
                    withContext(Dispatchers.Main) {
                        val cm = CookieManager.getInstance()
                        list.forEach { cm.setCookie(base, it) }
                        cm.flush()
                    }
                }
                val text = runCatching { (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } }.getOrNull()
                when {
                    code in 200..299 -> Http.Ok(text?.let { runCatching { JSONObject(it) }.getOrNull() })
                    code == 401 -> Http.SignedOut
                    code == 429 || code >= 500 -> Http.TryLater
                    else -> Http.Rejected(code)
                }
            } catch (e: Exception) {
                Log.i(TAG, "offline or network error: ${e.javaClass.simpleName}")
                Http.TryLater
            } finally {
                conn.disconnect()
            }
        }
    }

    companion object {
        private const val TAG = "B2BEvents"
        private const val CHAIN = "b2b-gps-events"
        private const val MAX_AGE_MS = 23L * 60 * 60 * 1000
        private const val K_MODE = "mode"; private const val MODE_CONFIRM = "confirm"; private const val MODE_SEND = "send"
        private const val K_RESOURCE = "resourceId"; private const val K_LOCATION = "locationId"; private const val K_KIND = "kind"
        private const val K_AT = "occurredAt"; private const val K_DIST = "distanceM"; private const val K_ACC = "accuracyM"
        private const val K_MEASURED = "measured"; private const val K_CLIENT_ID = "clientEventId"

        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        private fun confirmName(siteId: String) = "b2b-exit-confirm-$siteId"

        fun enqueue(ctx: Context, resourceId: String, siteId: String, kind: String, at: Long, r: Reading) {
            val data = Data.Builder()
                .putString(K_MODE, MODE_SEND).putString(K_RESOURCE, resourceId).putString(K_LOCATION, siteId).putString(K_KIND, kind)
                .putLong(K_AT, at).putDouble(K_DIST, r.distanceM).putDouble(K_ACC, r.accuracyM).putBoolean(K_MEASURED, r.measured)
                .putString(K_CLIENT_ID, "a:" + UUID.randomUUID().toString())
                .build()
            val req = OneTimeWorkRequestBuilder<EventWorker>()
                .setInputData(data)
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(CHAIN)
                .build()
            // One ordered queue. APPEND_OR_REPLACE starts a fresh queue if an earlier event was dropped.
            WorkManager.getInstance(ctx).enqueueUniqueWork(CHAIN, ExistingWorkPolicy.APPEND_OR_REPLACE, req)
        }

        /** [exit] is the reading Android gave when they left; it is re-sent only if no fresh fix can be taken. */
        fun scheduleExitConfirm(ctx: Context, cfg: GpsConfig, site: Site, exitAt: Long, exit: Reading) {
            val data = Data.Builder()
                .putString(K_MODE, MODE_CONFIRM).putString(K_RESOURCE, cfg.resourceId).putString(K_LOCATION, site.id).putLong(K_AT, exitAt)
                .putDouble(K_DIST, exit.distanceM).putDouble(K_ACC, exit.accuracyM)
                .build()
            val req = OneTimeWorkRequestBuilder<EventWorker>()
                .setInputData(data)
                .setInitialDelay(cfg.graceMin.toLong(), TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(confirmName(site.id), ExistingWorkPolicy.REPLACE, req)
        }

        fun cancelExitConfirm(ctx: Context, siteId: String) {
            WorkManager.getInstance(ctx).cancelUniqueWork(confirmName(siteId))
        }

        fun cancelAllExitConfirms(ctx: Context, cfg: GpsConfig?) {
            cfg?.sites?.forEach { cancelExitConfirm(ctx, it.id) }
        }
    }
}
