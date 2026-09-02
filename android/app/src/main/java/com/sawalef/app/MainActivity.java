package com.sawalef.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String START_URL = "https://sawalef-voice-chat-ekoj.onrender.com";
    private static final String APP_HOST = "sawalef-voice-chat-ekoj.onrender.com";
    private static final int REQ_AUDIO = 1001;
    private static final int REQ_FILE = 1002;
    private static final int REQ_SCREEN = 1003;
    private static final int REQ_NATIVE_AUDIO = 1004;

    private WebView webView;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private PermissionRequest pendingAudioRequest;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingScreenPayload;
    private boolean screenReceiverRegistered = false;

    private final BroadcastReceiver screenStatusReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!ScreenShareService.ACTION_STATUS.equals(intent.getAction())) return;
            try {
                JSONObject status = new JSONObject();
                status.put("state", intent.getStringExtra(ScreenShareService.EXTRA_STATE));
                status.put("message", intent.getStringExtra(ScreenShareService.EXTRA_MESSAGE));
                status.put("quality", intent.getStringExtra(ScreenShareService.EXTRA_ACTUAL_QUALITY));
                status.put("fps", intent.getIntExtra(ScreenShareService.EXTRA_ACTUAL_FPS, 0));
                dispatchScreenStatus(status);
            } catch (Exception ignored) {}
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(7, 17, 31));
        getWindow().setNavigationBarColor(Color.rgb(7, 17, 31));

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(7, 17, 31));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7, 17, 31));
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowContentAccess(true);
        s.setAllowFileAccess(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " SawalefAndroid/1.1");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new NativeBridge(), "SawalefNative");
        webView.setWebViewClient(new SawalefWebViewClient());
        webView.setWebChromeClient(new SawalefChromeClient());
        registerScreenStatusReceiver();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
            Uri deepLink = getIntent() != null ? getIntent().getData() : null;
            if (isSawalefUri(deepLink)) webView.loadUrl(deepLink.toString());
        } else {
            webView.loadUrl(resolveLaunchUrl(getIntent()));
        }
    }

    private String resolveLaunchUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        return isSawalefUri(data) ? data.toString() : START_URL;
    }

    private boolean isSawalefUri(Uri uri) {
        return uri != null
                && "https".equalsIgnoreCase(uri.getScheme())
                && APP_HOST.equalsIgnoreCase(uri.getHost());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent != null ? intent.getData() : null;
        if (isSawalefUri(data) && webView != null) {
            webView.loadUrl(data.toString());
        }
    }

    private void registerScreenStatusReceiver() {
        if (screenReceiverRegistered) return;
        IntentFilter filter = new IntentFilter(ScreenShareService.ACTION_STATUS);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenStatusReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenStatusReceiver, filter);
        }
        screenReceiverRegistered = true;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        if (requestCode == REQ_SCREEN) {
            if (resultCode != RESULT_OK || data == null || pendingScreenPayload == null) {
                pendingScreenPayload = null;
                dispatchScreenStatus(statusObject("cancelled", ""));
                return;
            }
            startNativeScreenService(data, pendingScreenPayload);
            pendingScreenPayload = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_AUDIO && pendingAudioRequest != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingAudioRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                pendingAudioRequest.deny();
                Toast.makeText(this, "سماح المايك مطلوب للمحادثة الصوتية.", Toast.LENGTH_SHORT).show();
            }
            pendingAudioRequest = null;
            return;
        }
        if (requestCode == REQ_NATIVE_AUDIO) {
            // Screen video must still work if playback-audio permission was declined.
            launchScreenCapturePermission();
        }
    }

    private JSONObject statusObject(String state, String message) {
        JSONObject status = new JSONObject();
        try {
            status.put("state", state);
            status.put("message", message);
        } catch (Exception ignored) {}
        return status;
    }

    private void dispatchScreenStatus(JSONObject status) {
        if (webView == null) return;
        final String json = status != null ? status.toString() : "{}";
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.SawalefNativeScreenShareStatus && window.SawalefNativeScreenShareStatus(" + json + ");",
                null
        ));
    }

    private void prepareNativeScreenShare(String payload) {
        pendingScreenPayload = payload;
        boolean wantsAudio = true;
        try { wantsAudio = new JSONObject(payload).optBoolean("audio", true); } catch (Exception ignored) {}
        if (wantsAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_NATIVE_AUDIO);
        } else {
            launchScreenCapturePermission();
        }
    }

    private void launchScreenCapturePermission() {
        if (pendingScreenPayload == null) return;
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        try {
            startActivityForResult(manager.createScreenCaptureIntent(), REQ_SCREEN);
        } catch (Exception e) {
            String message = e.getMessage() != null ? e.getMessage() : "تعذر فتح نافذة مشاركة الشاشة.";
            pendingScreenPayload = null;
            dispatchScreenStatus(statusObject("error", message));
        }
    }

    private void startNativeScreenService(Intent projectionData, String payload) {
        try {
            JSONObject options = new JSONObject(payload);
            Intent service = new Intent(this, ScreenShareService.class)
                    .setAction(ScreenShareService.ACTION_START)
                    .putExtra(ScreenShareService.EXTRA_PROJECTION_DATA, projectionData)
                    .putExtra(ScreenShareService.EXTRA_URL, options.optString("url", ""))
                    .putExtra(ScreenShareService.EXTRA_TOKEN, options.optString("token", ""))
                    .putExtra(ScreenShareService.EXTRA_QUALITY, options.optString("quality", "1080"))
                    .putExtra(ScreenShareService.EXTRA_FPS, options.optInt("fps", 60))
                    .putExtra(ScreenShareService.EXTRA_AUDIO, options.optBoolean("audio", true));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service);
            else startService(service);
        } catch (Exception e) {
            dispatchScreenStatus(statusObject("error", e.getMessage() != null ? e.getMessage() : "تعذر بدء مشاركة الشاشة."));
        }
    }

    private void stopNativeScreenShare() {
        try {
            Intent service = new Intent(this, ScreenShareService.class).setAction(ScreenShareService.ACTION_STOP);
            startService(service);
        } catch (Exception ignored) {}
    }

    private void enterImmersiveLandscape() {
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    private void exitImmersive() {
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        webView.setVisibility(View.VISIBLE);
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
        exitImmersive();
    }

    private class SawalefWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
            String scheme = uri.getScheme();
            if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                } catch (Exception ignored) {}
            }
            return false;
        }
    }

    private class SawalefChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                boolean asksAudio = false;
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                        asksAudio = true;
                        break;
                    }
                }
                if (!asksAudio) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    pendingAudioRequest = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
                }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                Intent intent = params.createIntent();
                startActivityForResult(intent, REQ_FILE);
                return true;
            } catch (Exception e) {
                fileCallback = null;
                Toast.makeText(MainActivity.this, "تعذر فتح اختيار الملفات.", Toast.LENGTH_SHORT).show();
                return false;
            }
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            webView.setVisibility(View.GONE);
            root.addView(customView, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
            ));
            enterImmersiveLandscape();
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
        }
    }

    public class NativeBridge {
        @JavascriptInterface
        public String getPlatform() {
            return "android";
        }

        @JavascriptInterface
        public String getAppVersion() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public int getVersionCode() {
            return BuildConfig.VERSION_CODE;
        }

        @JavascriptInterface
        public boolean isScreenShareAvailable() {
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
        }

        @JavascriptInterface
        public boolean startScreenShare(String payload) {
            if (payload == null || payload.length() < 2) return false;
            runOnUiThread(() -> prepareNativeScreenShare(payload));
            return true;
        }

        @JavascriptInterface
        public void stopScreenShare() {
            runOnUiThread(() -> stopNativeScreenShare());
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                try {
                    Intent settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                    startActivity(settings);
                } catch (Exception ignored) {}
            });
        }
    }

    @Override
    protected void onDestroy() {
        if (screenReceiverRegistered) {
            try { unregisterReceiver(screenStatusReceiver); } catch (Exception ignored) {}
            screenReceiverRegistered = false;
        }
        super.onDestroy();
    }
}
