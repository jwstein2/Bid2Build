package org.built2bid.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Built2Bid for Android: the live site in a WebView (same screens, rules and sign-in as the web app), plus native
 * geofencing so crews are clocked in and out at their assigned sites even when the app is closed.
 * Opens on the time clock. Links to other sites open in the phone's browser.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var offline: View
    private lateinit var bridge: NativeBridge
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var flowDone: (() -> Unit)? = null

    companion object {
        const val EXTRA_PATH = "path"
        private const val PREFS = "b2b_app"
        fun origin(): String = Uri.parse(BuildConfig.BASE_URL).let { "${it.scheme}://${it.authority}" }
        private fun host(): String = Uri.parse(BuildConfig.BASE_URL).host ?: ""
    }

    // ---- permissions: disclosure → while-in-use → "all the time" → notifications ----------------------------------
    private val foregroundRequest = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        prefs().edit().putBoolean("askedLocation", true).apply()
        if (Permissions.foreground(this)) askBackground() else finishFlow()
    }
    private val backgroundRequest = registerForActivityResult(ActivityResultContracts.RequestPermission()) { askNotifications() }
    private val notificationRequest = registerForActivityResult(ActivityResultContracts.RequestPermission()) { finishFlow() }
    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }

    private fun prefs() = getSharedPreferences(PREFS, MODE_PRIVATE)

    fun locationState(): String = when {
        Permissions.foreground(this) -> "granted"
        prefs().getBoolean("askedLocation", false) && !shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION) -> "denied"
        else -> "prompt"
    }

    /** Google Play requires this in-app disclosure before any location prompt; the system dialogs come after it. */
    fun startLocationFlow(done: () -> Unit) {
        flowDone = done
        if (Permissions.foreground(this)) { askBackground(); return }
        if (locationState() == "denied") { openAppSettings(); finishFlow(); return }
        AlertDialog.Builder(this)
            .setTitle(R.string.disclosure_title)
            .setMessage(R.string.disclosure_body)
            .setPositiveButton(R.string.disclosure_continue) { _, _ ->
                foregroundRequest.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            }
            .setNegativeButton(R.string.disclosure_cancel) { _, _ -> finishFlow() }
            .setOnCancelListener { finishFlow() }
            .show()
    }

    private fun askBackground() {
        if (Permissions.background(this)) { askNotifications(); return }
        AlertDialog.Builder(this)
            .setTitle(R.string.background_title)
            .setMessage(R.string.background_body)
            .setPositiveButton(R.string.background_open) { _, _ -> backgroundRequest.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) }
            .setNegativeButton(R.string.not_now) { _, _ -> askNotifications() }
            .setOnCancelListener { askNotifications() }
            .show()
    }

    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && !Permissions.notifications(this)) notificationRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
        else finishFlow()
    }

    private fun finishFlow() { flowDone?.invoke(); flowDone = null }

    fun openBatterySettings() {
        try { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } catch (_: ActivityNotFoundException) { openAppSettings() }
    }

    private fun openAppSettings() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    // ---- WebView ----------------------------------------------------------------------------------------------------
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        offline = offlineView()
        setContentView(FrameLayout(this).apply {
            addView(web, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            addView(offline, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        })

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setGeolocationEnabled(true)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString Built2BidAndroid/${BuildConfig.VERSION_NAME}"
        }
        android.webkit.CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(web, false) }

        bridge = NativeBridge(this)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "Built2BidNative", setOf(origin()), bridge)
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "https" && u.host == host()) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: ActivityNotFoundException) { }
                return true
            }
            override fun onPageFinished(view: WebView, url: String) {
                offline.visibility = View.GONE
                android.webkit.CookieManager.getInstance().flush()
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) offline.visibility = View.VISIBLE
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(o: String, callback: GeolocationPermissions.Callback) {
                // The web clock (used when background tracking is off) gets location only on Built2Bid and only if
                // the phone already allows it; the request itself always goes through the disclosure above.
                val ours = o.trimEnd('/') == origin()
                if (ours && Permissions.foreground(this@MainActivity)) callback.invoke(o, true, false)
                else if (ours) startLocationFlow { callback.invoke(o, Permissions.foreground(this@MainActivity), false) }
                else callback.invoke(o, false, false)
            }
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                return try { fileChooser.launch(params.createIntent()); true } catch (_: ActivityNotFoundException) { fileCallback = null; false }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else load(intent)
    }

    private fun load(i: Intent?) {
        val path = i?.getStringExtra(EXTRA_PATH)?.takeIf { it.startsWith("/") && !it.startsWith("//") } ?: "/clock"
        web.loadUrl(BuildConfig.BASE_URL + path)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasExtra(EXTRA_PATH)) load(intent)
    }

    override fun onResume() {
        super.onResume()
        // Permission may have changed in Settings, or location was off when the fences were added.
        val cfg = GpsConfig.load(this)
        if (cfg != null && Permissions.background(this) && GpsConfig.registeredFingerprint(this) != cfg.fingerprint()) Geofences.restore(this)
        bridge.pushState()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    private fun offlineView(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(64, 64, 64, 64)
        setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.paper))
        visibility = View.GONE
        addView(TextView(context).apply { setText(R.string.offline_title); textSize = 22f; setTextColor(ContextCompat.getColor(context, R.color.navy)); gravity = Gravity.CENTER })
        addView(TextView(context).apply { setText(R.string.offline_body); textSize = 16f; setTextColor(Color.DKGRAY); gravity = Gravity.CENTER; setPadding(0, 24, 0, 24) })
        addView(Button(context).apply { setText(R.string.retry); setOnClickListener { web.reload() } })
    }
}
