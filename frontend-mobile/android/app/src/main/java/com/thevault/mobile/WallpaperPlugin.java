package com.thevault.mobile;

import android.app.WallpaperManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Save a picture to the phone's gallery, or set it as the home / lock wallpaper.
// The picture is pulled from the backend over the LAN (the same address the app
// already loads images from), so all this plugin does is the part the browser
// can't: write to the gallery, and talk to the Android WallpaperManager.
@CapacitorPlugin(name = "Wallpaper")
public class WallpaperPlugin extends Plugin {

    @PluginMethod
    public void setWallpaper(PluginCall call) {
        final String url = call.getString("url");
        final String target = call.getString("target", "both"); // home | lock | both
        if (url == null) { call.reject("No image url"); return; }
        new Thread(() -> {
            try {
                Bitmap bmp = downloadBitmap(url);
                WallpaperManager wm = WallpaperManager.getInstance(getContext());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    int which;
                    if ("home".equals(target)) which = WallpaperManager.FLAG_SYSTEM;
                    else if ("lock".equals(target)) which = WallpaperManager.FLAG_LOCK;
                    else which = WallpaperManager.FLAG_SYSTEM | WallpaperManager.FLAG_LOCK;
                    wm.setBitmap(bmp, null, true, which);
                } else {
                    // Pre-Nougat phones can't target lock separately — set the one wallpaper.
                    wm.setBitmap(bmp);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Failed to set wallpaper" : e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void save(PluginCall call) {
        final String url = call.getString("url");
        if (url == null) { call.reject("No image url"); return; }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = open(url);
                String mime = conn.getContentType();
                if (mime == null || !mime.startsWith("image/")) mime = "image/jpeg";
                String ext = mime.substring(mime.indexOf('/') + 1).split(";")[0];
                if ("jpeg".equals(ext)) ext = "jpg";
                String name = "vault_" + System.currentTimeMillis() + "." + ext;

                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                cv.put(MediaStore.Images.Media.MIME_TYPE, mime);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    cv.put(MediaStore.Images.Media.RELATIVE_PATH,
                            Environment.DIRECTORY_PICTURES + "/The Vault");
                }
                ContentResolver cr = getContext().getContentResolver();
                Uri item = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                if (item == null) { call.reject("Could not create file"); return; }

                // Copy the original bytes straight through — no re-encoding, so the
                // saved picture keeps full quality.
                try (InputStream in = conn.getInputStream();
                     OutputStream out = cr.openOutputStream(item)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Failed to save image" : e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.connect();
        return c;
    }

    private Bitmap downloadBitmap(String url) throws Exception {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            Bitmap bmp = BitmapFactory.decodeStream(in);
            if (bmp == null) throw new Exception("Could not read image");
            return bmp;
        } finally {
            c.disconnect();
        }
    }
}
