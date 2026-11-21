package com.blacksrj.smarthelmet;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "SmartHelmetMainActivity";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Bind all app networking specifically to WiFi so mobile data or no-internet checks never bypass the ESP32!
        try {
            ConnectivityManager connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkRequest request = new NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .build();

            connectivityManager.requestNetwork(request, new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    super.onAvailable(network);
                    Log.i(TAG, "WiFi Network available! Binding process to WiFi: " + network);
                    connectivityManager.bindProcessToNetwork(network);
                }

                @Override
                public void onLost(Network network) {
                    super.onLost(network);
                    Log.i(TAG, "WiFi Network lost");
                    connectivityManager.bindProcessToNetwork(null);
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Failed to bind network: " + e.getMessage());
        }
    }
}
