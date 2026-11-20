package com.jarvis.assistant;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {

    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final String LOCAL_HOST = "jarvis.local";
    private static final String LOCAL_ORIGIN = "https://" + LOCAL_HOST + "/";
    private static final String PREFS_NAME = "jarvis_prefs";
    private static final String PREF_BACKEND_URL = "backend_url";

    private WebView webView;
    private PermissionRequest pendingWebPermission;

    public class JarvisBridge {
        @JavascriptInterface
        public String getBackendUrl() {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            return prefs.getString(PREF_BACKEND_URL, getString(R.string.jarvis_app_url));
        }

        @JavascriptInterface
        public void promptServerUrl() {
            runOnUiThread(() -> showServerUrlDialog());
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#06070b"));

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDatabaseEnabled(true);

        webView.addJavascriptInterface(new JarvisBridge(), "JarvisAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url != null && LOCAL_HOST.equalsIgnoreCase(url.getHost())) {
                    return serveBundledAsset(url.getPath());
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (target == null) return false;
                String host = target.getHost();
                if (LOCAL_HOST.equalsIgnoreCase(host)) {
                    return false;
                }
                String backendHost = Uri.parse(getConfiguredBackendUrl()).getHost();
                if (host != null && (host.equalsIgnoreCase(backendHost)
                        || host.endsWith(".google.com")
                        || host.endsWith(".run.app"))) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, target));
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }
        });

        setContentView(webView);
        requestMissingRuntimePermissions();
        webView.loadUrl(LOCAL_ORIGIN);
    }

    private String getConfiguredBackendUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        return prefs.getString(PREF_BACKEND_URL, getString(R.string.jarvis_app_url));
    }

    private static String normalizeServerUrl(String raw) {
        String trimmed = raw.trim().replaceAll("/+$", "");
        if (trimmed.isEmpty()) return "";
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
            if (trimmed.startsWith("localhost") || trimmed.startsWith("127.") || trimmed.startsWith("192.168.") || trimmed.startsWith("10.")) {
                trimmed = "http://" + trimmed;
            } else {
                trimmed = "https://" + trimmed;
            }
        }
        return trimmed;
    }

    private WebResourceResponse serveBundledAsset(String rawPath) {
        String cleanPath = (rawPath == null || rawPath.isEmpty() || "/".equals(rawPath))
                ? "index.html"
                : rawPath.replaceFirst("^/+", "");

        if (cleanPath.contains("..")) {
            return null;
        }

        String assetPath = "www/" + cleanPath;
        try {
            InputStream stream = getAssets().open(assetPath);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(
                    guessMimeType(cleanPath),
                    "UTF-8",
                    200,
                    "OK",
                    headers,
                    stream
            );
        } catch (IOException e) {
            if (!cleanPath.contains(".")) {
                try {
                    InputStream fallback = getAssets().open("www/index.html");
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Access-Control-Allow-Origin", "*");
                    return new WebResourceResponse("text/html", "UTF-8", 200, "OK", headers, fallback);
                } catch (IOException ignored) {
                }
            }
            return null;
        }
    }

    private static String guessMimeType(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    private void showServerUrlDialog() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String current = getConfiguredBackendUrl();

        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(current);
        input.setSelection(current.length());

        new AlertDialog.Builder(this)
                .setTitle("Jarvis Live Server URL")
                .setMessage("Enter the URL of your deployed Jarvis server (e.g. your published AI Studio Shared URL or local http://192.168.x.x:3000).")
                .setView(input)
                .setPositiveButton("Save", (dialog, which) -> {
                    String next = normalizeServerUrl(input.getText().toString());
                    if (!next.isEmpty()) {
                        prefs.edit().putString(PREF_BACKEND_URL, next).apply();
                    }
                })
                .setNeutralButton("Open in App", (dialog, which) -> {
                    String next = normalizeServerUrl(input.getText().toString());
                    if (!next.isEmpty()) {
                        prefs.edit().putString(PREF_BACKEND_URL, next).apply();
                        webView.loadUrl(next);
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        List<String> neededAndroidPermissions = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                neededAndroidPermissions.add(Manifest.permission.RECORD_AUDIO);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                neededAndroidPermissions.add(Manifest.permission.CAMERA);
            }
        }

        if (neededAndroidPermissions.isEmpty()) {
            request.grant(request.getResources());
        } else {
            pendingWebPermission = request;
            requestPermissions(
                    neededAndroidPermissions.toArray(new String[0]),
                    PERMISSION_REQUEST_CODE
            );
        }
    }

    private void requestMissingRuntimePermissions() {
        List<String> missing = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (!missing.isEmpty()) {
            requestPermissions(missing.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE && pendingWebPermission != null) {
            PermissionRequest req = pendingWebPermission;
            pendingWebPermission = null;
            List<String> grantedResources = new ArrayList<>();
            for (String res : req.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                        && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    grantedResources.add(res);
                } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                        && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    grantedResources.add(res);
                }
            }
            if (grantedResources.isEmpty()) {
                req.deny();
            } else {
                req.grant(grantedResources.toArray(new String[0]));
            }
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
