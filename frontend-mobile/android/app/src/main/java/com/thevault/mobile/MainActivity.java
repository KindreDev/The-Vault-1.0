package com.thevault.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before super.onCreate so the bridge picks it up.
        registerPlugin(ImmersivePlugin.class);
        registerPlugin(WallpaperPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
