package com.jarvis.assistant;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private static final int PERMISSION_REQUEST_CODE = 1001;
    private WebView webView;
    private PermissionRequest pendingWebPermission;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#06070b"));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDatabaseEnabled(true);

        final String appUrl = getString(R.string.jarvis_app_url);
        final Uri appUri = Uri.parse(appUrl);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (target != null && appUri.getHost() != null
                        && !appUri.getHost().equalsIgnoreCase(target.getHost())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                    return true;
                }
                return false;
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
        webView.loadUrl(appUrl);
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
