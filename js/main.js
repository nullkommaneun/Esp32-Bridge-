import { BLEManager } from './bluetooth.js';
import { parsePacket } from './protocol.js';
import { PhoneSensors } from './sensors.js'; 
import { UI } from './ui.js';

// Speicher für Deltas (Berechnung von Stabilität/Speed)
let lastEspState = {
    wifi_rssi: -100,
    ble_rssi: -100,
    timestamp: 0
};

let neuralInput = {
    groupA: {},
    groupB: {},
    groupC: {},
    groupD: {}
};

document.addEventListener('DOMContentLoaded', () => {
    const btnConnect = document.getElementById('btn-connect');
    const ble = new BLEManager(handleEspData, UI.log, UI.setStatus);

    btnConnect.addEventListener('click', async () => {
        try {
            await PhoneSensors.init();
            UI.log("Sensoren OK.", "success");
        } catch (e) {
            UI.log("Sensor Fehler: " + e, "error");
        }
        
        ble.connect();
        requestAnimationFrame(fusionLoop);
    });
});

function handleEspData(dataView) {
    try {
        const raw = parsePacket(dataView);
        if(!raw) return;

        const now = Date.now();

        // --- COMPUTED VALUES ---
        
        // N7: Infra_Stability (Delta Signal)
        let deltaWifi = Math.abs(raw.env_snr - lastEspState.wifi_rssi);
        if (deltaWifi > 50) deltaWifi = 0; // Filter für Startsprünge
        
        // N11: Object_Velocity (Delta BLE Signal -> Annäherung)
        let deltaBle = raw.object_proximity - lastEspState.ble_rssi;
        if (Math.abs(deltaBle) > 50) deltaBle = 0;

        // N14: Human_Machine_Ratio (BLE Count / WiFi Count)
        let ratio = 0;
        if (raw.infra_density > 0) {
            ratio = raw.object_count / raw.infra_density;
        }

        // N15: Data_Age_Gap (WiFi vs BLE Timestamp Differenz Simulation)
        const ageGap = Math.abs(raw.timestamp - lastEspState.timestamp);

        // State Update
        lastEspState = {
            wifi_rssi: raw.env_snr,
            ble_rssi: raw.object_proximity,
            timestamp: raw.timestamp
        };

        // --- MAPPING ---
        neuralInput.groupB = {
            proximity: raw.infra_proximity, // N6
            stability: deltaWifi,           // N7
            density:   raw.infra_density,   // N8
            snr:       raw.env_snr          // N9
        };

        neuralInput.groupC = {
            proximity: raw.object_proximity, // N10
            velocity:  deltaBle,             // N11
            count:     raw.object_count,     // N12
            spread:    raw.object_spread     // N13
        };

        neuralInput.groupD = {
            ratio:     ratio,                // N14
            ageGap:    ageGap,               // N15
            latency:   now - raw._receiveTime // N16 (wird in protocol/ble gesetzt, hier simuliert)
        };
        
        // Fallback für Latency, falls im Parser nicht gesetzt
        if (!raw._receiveTime) neuralInput.groupD.latency = 0; 
        else neuralInput.groupD.latency = now - raw._receiveTime;

    } catch (e) { console.error(e); }
}

function fusionLoop() {
    // Gruppe A live vom Handy
    neuralInput.groupA = PhoneSensors.data;
    
    // UI Update
    UI.updateNeuralVector(neuralInput);
    
    requestAnimationFrame(fusionLoop);
}
