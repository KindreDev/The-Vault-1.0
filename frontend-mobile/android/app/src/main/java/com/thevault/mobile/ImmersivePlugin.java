package com.thevault.mobile;

import android.view.View;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Real Android immersive mode. The @capacitor/status-bar plugin only hides the
// top status bar (and even that isn't reliable); this hides BOTH the status bar
// (time/battery/notifications) and the bottom navigation bar, edge-to-edge, so a
// photo truly fills the screen. The bars peek back on a swipe, then auto-hide —
// standard gallery behaviour.
@CapacitorPlugin(name = "Immersive")
public class ImmersivePlugin extends Plugin {

    @PluginMethod
    public void enter(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            View decor = getActivity().getWindow().getDecorView();
            WindowInsetsControllerCompat c =
                    WindowCompat.getInsetsController(getActivity().getWindow(), decor);
            c.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
        });
        call.resolve();
    }

    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            View decor = getActivity().getWindow().getDecorView();
            WindowInsetsControllerCompat c =
                    WindowCompat.getInsetsController(getActivity().getWindow(), decor);
            c.show(WindowInsetsCompat.Type.systemBars());
        });
        call.resolve();
    }
}
