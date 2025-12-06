import { BLEManager } from './bluetooth.js';
import { parsePacket } from './protocol.js';
import { PhoneSensors } from './sensors.js'; 
import { UI } from './ui.js';
import { DataRecorder } from './recorder.js';
import { NeuralBrain } from './brain.js';

// --- SYSTEM INITIALISIERUNG ---
const recorder = new DataRecorder();
const brain = new NeuralBrain();

// Globaler State Container für den 16-Dimensionen Vektor
let neuralInput = { 
    groupA: {}, // Physik (Handy)
    groupB: {}, // Infra (ESP)
    groupC: {}, // Gefahr (ESP)
    groupD: {}  // Meta (Computed)
};

// Speicher für Deltas (um Veränderungen zu messen)
let lastEspState = { 
    timestamp: 0, 
    wifi_rssi: 0, 
    ble_rssi: 0, 
    lastReceived: 0 
};

// --- STARTUP ---
document.addEventListener('DOMContentLoaded', () => {
    const btnConnect = document.getElementById('btn-connect');
    const btnLearn = document.getElementById('btn-learn');

    // Bluetooth Manager konfigurieren
    const ble = new BLEManager(handleEspData, UI.log, UI.setStatus);

    // 1. LOGIK FÜR DEN LERN-BUTTON (Training)
    btnLearn.addEventListener('click', async () => {
        
        // A) Start Aufnahme
        if (!recorder.isRecording) {
            recorder.start(); 
            btnLearn.textContent = "⏳ Aufnehmen...";
            btnLearn.classList.add('recording');
            UI.log("Sammle Trainingsdaten... Bitte normal fahren!", "info");
        } 
        
        // B) Stopp & Training
        else {
            recorder.stop(); // Daten liegen jetzt in recorder.buffer
            btnLearn.textContent = "⚙️ Training...";
            btnLearn.classList.remove('recording');
            
            // UI Feedback geben
            UI.log(`Starte LSTM Training mit ${recorder.buffer.length} Datensätzen...`, "info");
            
            // Daten aufbereiten: Wir brauchen nur die Spalten 1-16 (ohne Zeitstempel/Label)
            // recorder.buffer Format: [Time, N1, N2 ... N16, Label]
            const trainingData = recorder.buffer.map(row => row.slice(1, 17));

            // Kurze Verzögerung, damit der Browser den Button-Text rendern kann
            setTimeout(async () => {
                // Das Brain trainiert sich selbst im Browser
                const success = await brain.train(trainingData);
                
                if (success) {
                    btnLearn.textContent = "✅ AI Aktiv";
                    btnLearn.classList.add('active-brain'); // Grün
                    UI.log("Training abgeschlossen. Vorhersage (Prediction) aktiv.", "success");
                } else {
                    btnLearn.textContent = "❌ Fehler";
                    UI.log("Training fehlgeschlagen (zu wenig Daten?)", "error");
                }
            }, 50);
        }
    });

    // 2. LOGIK FÜR VERBINDEN
    btnConnect.addEventListener('click', async () => {
        // Handy Sensoren brauchen User-Interaktion zum Starten
        try { 
            await PhoneSensors.init(); 
            UI.log("Handy-Sensoren bereit.", "success");
        } catch (e) { 
            console.warn(e); 
            UI.log("Sensor-Fehler (siehe Konsole)", "warning");
        }
        
        // BLE Verbindung starten
        ble.connect();
        
        // Den Main-Loop starten
        requestAnimationFrame(fusionLoop);
    });
});

// --- DATENVERARBEITUNG ESP32 ---
function handleEspData(dataView) {
    try {
        const now = Date.now();
        const raw = parsePacket(dataView);
        if(!raw) return;

        // --- COMPUTED METRICS (Gruppe D Fix) ---
        
        // 1. Human/Machine Ratio
        let ratio = 0.0;
        if (raw.infra_density > 0) {
            ratio = raw.object_count / raw.infra_density;
        }

        // 2. Age Gap (Wie alt sind die WiFi Daten im Vergleich zu BLE?)
        let ageGap = 0;
        if (lastEspState.timestamp > 0) {
            let delta = raw.timestamp - lastEspState.timestamp;
            // Filter für unrealistische Sprünge (z.B. bei Reboot)
            if (delta > 0 && delta < 10000) ageGap = delta;
        }

        // 3. Latency (Jitter-Messung)
        // Zeit seit dem letzten JS-Update
        let latency = 0;
        if (lastEspState.lastReceived > 0) {
            latency = now - lastEspState.lastReceived;
        }

        // --- DELTA BERECHNUNGEN (Trend) ---
        
        // Stability: Wie sehr schwankt das WiFi Signal?
        let stability = Math.abs(raw.env_snr - (lastEspState.wifi_rssi || raw.env_snr));
        
        // Velocity: Wie schnell ändert sich das BLE Signal (Annäherung)?
        let velocity = raw.object_proximity - (lastEspState.ble_rssi || raw.object_proximity);

        // --- GLOBAL UPDATE ---
        
        // Gruppe B (Infrastruktur)
        neuralInput.groupB = { 
            proximity: raw.infra_proximity, 
            stability: stability, 
            density:   raw.infra_density, 
            snr:       raw.env_snr 
        };

        // Gruppe C (Reflex)
        neuralInput.groupC = { 
            proximity: raw.object_proximity, 
            velocity:  velocity, 
            count:     raw.object_count, 
            spread:    raw.object_spread 
        };

        // Gruppe D (Meta)
        neuralInput.groupD = { 
            ratio:     ratio, 
            ageGap:    ageGap, 
            latency:   latency 
        };

        // State speichern für nächsten Loop
        lastEspState.timestamp = raw.timestamp;
        lastEspState.lastReceived = now;
        lastEspState.wifi_rssi = raw.env_snr;
        lastEspState.ble_rssi = raw.object_proximity;

    } catch (e) { 
        console.error("Fusion Error:", e); 
    }
}

// --- MAIN LOOP (60 FPS) ---
function fusionLoop() {
    // 1. Gruppe A (Physik) immer live vom Handy holen
    neuralInput.groupA = PhoneSensors.data;

    // 2. UI Aktualisieren (Alle 16 Werte anzeigen)
    UI.updateNeuralVector(neuralInput);

    // 3. AI Vorhersage & Aufzeichnung
    // Nur ausführen, wenn wir valide Daten vom ESP haben
    if (neuralInput.groupB.proximity !== undefined) {
        
        // A) Vorhersage holen (Safe / Warn / Danger)
        const prediction = brain.process(neuralInput);
        
        // B) Balken aktualisieren
        updateBars(prediction);

        // C) Wenn Aufnahme läuft -> Speichern
        recorder.record(neuralInput);
    }
    
    // Endlosschleife
    requestAnimationFrame(fusionLoop);
}

// Hilfsfunktion für die Balken
function updateBars(prediction) {
    const safeBar = document.getElementById('out-safe');
    const warnBar = document.getElementById('out-warn');
    const dangBar = document.getElementById('out-danger');

    if(safeBar) safeBar.style.width = (prediction.safe * 100) + "%";
    if(warnBar) warnBar.style.width = (prediction.warn * 100) + "%";
    if(dangBar) dangBar.style.width = (prediction.danger * 100) + "%";
}
