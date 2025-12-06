import { toHexString } from './protocol.js';

const consoleEl = document.getElementById('console-log');
const statusEl = document.getElementById('status-indicator');
const dashboardEl = document.getElementById('dashboard');

// Mapping der IDs zu Objekt-Keys
const uiMap = {
    'val-wifi-count': 'wifi_count',
    'val-wifi-rssi': 'wifi_avg_rssi',
    'val-wifi-cong': 'wifi_cong_peak',
    'val-ble-count': 'ble_dev_count',
    'val-ble-max': 'ble_max_rssi',
    'val-ble-traffic': 'ble_traffic_idx',
    'val-timestamp': 'timestamp'
};

export const UI = {
    setStatus(text, className) {
        statusEl.textContent = text;
        statusEl.className = `status ${className}`;
        
        if (className === 'connected') {
            dashboardEl.classList.remove('blurred');
        } else {
            dashboardEl.classList.add('blurred');
        }
    },

    log(message, type = "info") {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const time = new Date().toLocaleTimeString().split(' ')[0];
        entry.textContent = `[${time}] ${message}`;
        
        consoleEl.appendChild(entry);
        consoleEl.scrollTop = consoleEl.scrollHeight; // Auto-Scroll
    },

    updateDashboard(data, rawDataView) {
        // Werte updaten
        for (const [domId, dataKey] of Object.entries(uiMap)) {
            const el = document.getElementById(domId);
            if (el && data[dataKey] !== undefined) {
                el.textContent = data[dataKey];
            }
        }
        
        // Debugger Log nur alle X Pakete oder bei Fehlern, sonst spammen wir die Konsole voll.
        // Hier: Wir loggen nur den Raw Hex ins Debug-Overlay "statisch" oder in ein spezielles Feld, 
        // wenn wir nicht spammen wollen. 
        // Für diesen Code loggen wir den Hex-Stream direkt in die Konsole (ggf. auskommentieren bei 20Hz!)
        // this.log(`RX: ${toHexString(rawDataView)}`, "debug");
    }
};
