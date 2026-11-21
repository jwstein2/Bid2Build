package org.built2bid.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** "Clocked in — Smith deck", "You left ... Still working?", and the signed-out reminder. Taps open the time clock. */
object Notifier {
    private const val CHANNEL = "clock"
    private const val ID_CLOCK = 1001
    private const val ID_SIGNED_OUT = 1002
    private const val PREFS = "b2b_notify"

    private fun channel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, ctx.getString(R.string.channel_clock), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = ctx.getString(R.string.channel_clock_desc)
            })
        }
    }

    private fun openClock(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx, 0,
        Intent(ctx, MainActivity::class.java).putExtra(MainActivity.EXTRA_PATH, "/clock").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun show(ctx: Context, id: Int, text: String) {
        if (!Permissions.notifications(ctx)) return
        channel(ctx)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(ctx.getString(R.string.app_name))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openClock(ctx))
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(id, n) } catch (_: SecurityException) { /* permission revoked */ }
    }

    fun clock(ctx: Context, text: String) = show(ctx, ID_CLOCK, text.take(300))

    /** Shown once until the next successful send, so a signed-out phone doesn't buzz on every retry. */
    fun signedOut(ctx: Context) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (p.getBoolean("signedOutShown", false)) return
        p.edit().putBoolean("signedOutShown", true).apply()
        show(ctx, ID_SIGNED_OUT, ctx.getString(R.string.signed_out))
    }

    fun clearSignedOut(ctx: Context) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!p.getBoolean("signedOutShown", false)) return
        p.edit().putBoolean("signedOutShown", false).apply()
        NotificationManagerCompat.from(ctx).cancel(ID_SIGNED_OUT)
    }
}
