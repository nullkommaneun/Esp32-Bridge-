// js/ui.js

const consoleEl = document.getElementById('console-log');
const statusEl = document.getElementById('status-indicator');
const dashboardEl = document.getElementById('dashboard');

export const UI = {
    // Liste aller 16 IDs
    updateAll(espData, phoneData) {
        // --- ESP32 DATEN (Wenn vorhanden) ---
        if (espData) {
            setText('n6-wifi-count', espData.wifi_count);
            setText('n7-wifi-rssi', espData.wifi_avg_rssi + " dB");
            setText('n8-wifi-cong', espData.wifi_cong_peak);
            
            setText('n10-ble-count', espData.ble_dev_count);
            setText('n11-ble-rssi', espData.ble_max_rssi + " dB");
            setText('n12-ble-traffic', espData.ble_traffic_idx);

            // N14: Scan Age (Differenz zwischen Jetzt und ESP Timestamp)
            // Achtung: ESP Timestamp resettet bei Boot. 
            // Hier zeigen wir einfach den rohen Timestamp-Delta des Pakets an
            // Ein echter Sync wäre komplexer (NTP), für jetzt reicht "Ping".
            const age = Date.now() - espData._receiveTime; 
            setText('n14-age', age + " ms");
        }

        // --- PHONE DATEN (Sensoren) ---
        if (phoneData) {
            setNum('n1-acc-x', phoneData.accX, 2);
            setNum('n2-acc-y', phoneData.accY, 2);
            setNum('n3-acc-z', phoneData.accZ, 2);
            
            setNum('n4-gyro-z', phoneData.gyroZ, 1);
            setNum('n5-jerk', phoneData.jerk, 1);
            
            setNum('n9-gps-speed', phoneData.gpsSpeed, 1);
            
            // Audio (0-255) skalieren auf 0.0 - 1.0 für NN
            const audioNorm = phoneData.audioLevel / 255.0;
            setNum('n13-audio', audioNorm, 3);
            
            setText('n16-batt', phoneData.battery + "%");
        }
    },

    log(msg, type="info") {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const time = new Date().toLocaleTimeString().split(' ')[0];
        entry.textContent = `[${time}] ${msg}`;
        consoleEl.prepend(entry); // Neueste oben
    },

    setStatus(text, className) {
        statusEl.textContent = text;
        statusEl.className = `status ${className}`;
        if (className === 'connected') dashboardEl.classList.remove('blurred');
    }
};

// Hilfsfunktionen
function setText(id, val) {
    const el = document.getElementById(id);
    if(el) el.textContent = val;
}
function setNum(id, val, decimals) {
    const el = document.getElementById(id);
    if(el && typeof val === 'number') el.textContent = val.toFixed(decimals);
}
