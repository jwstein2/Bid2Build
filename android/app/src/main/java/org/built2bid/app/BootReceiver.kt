package org.built2bid.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Android clears geofences on reboot and app update; put today's back. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) Geofences.restore(ctx)
    }
}
