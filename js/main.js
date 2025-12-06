import { BLEManager } from './bluetooth.js';
import { parsePacket } from './protocol.js';
import { PhoneSensors } from './sensors.js'; 
import { UI } from './ui.js';
import { DataRecorder } from './recorder.js';
import { NeuralBrain } from './brain.js';

// --- SYSTEM INITIALISIERUNG ---
const recorder = new DataRecorder();
const brain = new NeuralBrain();

// Daten Container
let neuralInput = { groupA: {}, groupB: {}, groupC: {}, groupD: {} };
let lastEspState = { timestamp: 0, wifi_rssi: 0, ble_rssi: 0, lastReceived: 0 };

document.addEventListener('DOMContentLoaded', () => {
    // Tabs initialisieren
    setupTabs();
    
    // Buttons holen
    const btnConnect = document.getElementById('btn-connect');
    const btnRecord = document.getElementById('btn-auto-record');
    const btnTrain = document.getElementById('btn-start-train');
    const fileInput = document.getElementById('csv-upload');
    
    // BLE Manager Init
    const ble = new BLEManager(handleEspData, UI.log, updateConnectionStatus);

    // 1. CONNECT BUTTON
    if (btnConnect) {
        btnConnect.addEventListener('click', async () => {
            try { 
                await PhoneSensors.init(); 
                UI.log("Handy-Sensoren bereit.", "success");
            } catch (e) { 
                console.warn(e); 
                UI.log("Sensor-Warnung: " + e, "warning");
            }
            ble.connect();
            requestAnimationFrame(fusionLoop);
        });
    }

    // 2. AUTO-RECORD BUTTON (Tab 1)
    if (btnRecord) {
        btnRecord.addEventListener('click', () => {
            startAutoRecording(btnRecord);
        });
    }

    // 3. FILE UPLOAD (Tab 2)
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                if (btnTrain) btnTrain.disabled = false;
                const log = document.getElementById('train-log');
                if (log) log.textContent = `Datei "${e.target.files[0].name}" bereit. Klicke auf 'Start'.`;
            }
        });
    }

    // 4. TRAINING STARTEN (Tab 2) - ROBUSTE VERSION
    if (btnTrain) {
        btnTrain.addEventListener('click', () => {
            const file = fileInput.files[0];
            if (!file) {
                UI.log("Bitte erst eine CSV-Datei auswählen!", "warning");
                return;
            }
            
            btnTrain.disabled = true;
            btnTrain.textContent = "⏳ Lese Datei...";
            const trainLog = document.getElementById('train-log');
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const csvText = e.target.result;
                    // Hier nutzen wir den robusten Parser!
                    const data = parseCSV(csvText);
                    
                    if (data.length < 55) { 
                        throw new Error(`Zu wenig Daten (${data.length} Zeilen). Brauche mind. 60.`);
                    }

                    if (trainLog) trainLog.textContent = `Lese ${data.length} Datensätze... Starte Training...`;
                    
                    // Kurzer Timeout für UI-Update
                    setTimeout(async () => {
                        const success = await brain.train(data);
                        
                        if (success) {
                            if (trainLog) trainLog.textContent = "✅ Training erfolgreich! KI ist aktiv.";
                            btnTrain.textContent = "Training Fertig";
                            btnTrain.disabled = false;
                            
                            const aiOut = document.getElementById('ai-output');
                            if(aiOut) aiOut.classList.remove('blurred');
                            
                            const aiStat = document.getElementById('ai-status');
                            if(aiStat) {
                                aiStat.textContent = "AKTIV";
                                aiStat.style.color = "#2ea043";
                            }
                            UI.log("Neuronales Netz ist jetzt scharf geschaltet.", "success");
                        } else {
                            throw new Error("TensorFlow Training abgebrochen.");
                        }
                    }, 100);

                } catch (err) {
                    console.error(err);
                    if (trainLog) trainLog.textContent = "❌ Fehler: " + err.message;
                    btnTrain.textContent = "Neustart";
                    btnTrain.disabled = false;
                }
            };
            reader.readAsText(file);
        });
    }
});

// --- HELPER: ROBUSTER CSV PARSER ---
function parseCSV(text) {
    const lines = text.trim().split('\n');
    const data = [];
    console.log(`CSV Raw: ${lines.length} Zeilen gefunden.`);

    // Loop ab Zeile 1 (Zeile 0 ist Header)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "") continue; // Leere Zeilen überspringen

        const parts = line.split(',');

        // Check: Haben wir genug Spalten? (Time + 16 Features + Label = 18 Spalten)
        if (parts.length < 17) {
            console.warn(`Zeile ${i} ignoriert: Zu wenig Spalten (${parts.length})`);
            continue; 
        }

        // Wir brauchen Spalten 1 bis 16 (ohne Time an Index 0 und Label am Ende)
        // Indices: 0(Time), 1(N1) ... 16(N16), 17(Label)
        const rowValues = parts.slice(1, 17).map(val => parseFloat(val));

        // NaN Check: Wenn ein Wert keine Zahl ist, Zeile wegwerfen
        const isValid = rowValues.every(val => !isNaN(val));

        if (isValid) {
            data.push(rowValues);
        }
    }
    
    console.log(`CSV Parsed: ${data.length} gültige Vektoren extrahiert.`);
    return data;
}

// --- HELPER: AUTO RECORDING ---
function startAutoRecording(btn) {
    if (recorder.isRecording) return; 

    let timeLeft = 120; // 2 Minuten Aufnahme
    
    recorder.start();
    btn.classList.add('recording');
    
    const interval = setInterval(() => {
        timeLeft--;
        btn.textContent = `⏳ Aufnahme läuft... ${timeLeft}s`;
        
        if (timeLeft <= 0) {
            clearInterval(interval);
            recorder.stop(); // Lädt CSV herunter
            btn.classList.remove('recording');
            btn.textContent = "✅ Fertig (Download)";
            UI.log("Aufnahme beendet. Datei wurde heruntergeladen.", "success");
            
            // Button Reset nach 5 Sekunden
            setTimeout(() => { 
                btn.textContent = "🔴 Start Aufnahme (2min)"; 
                btn.disabled = false;
            }, 5000);
        }
    }, 1000);
}

// --- TAB LOGIK ---
function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const target = document.getElementById(tab.dataset.tab);
            if (target) target.classList.add('active');
        });
    });
}

function updateConnectionStatus(text, cls) {
    const el = document.getElementById('connection-status');
    if (el) {
        el.textContent = text;
        el.className = `status ${cls}`;
    }
    // Buttons freischalten wenn verbunden
    if (cls === 'connected') {
        const dash = document.getElementById('dashboard');
        if (dash) dash.classList.remove('blurred');
        
        const btnRec = document.getElementById('btn-auto-record');
        if (btnRec) btnRec.disabled = false;
    }
}

// --- ESP DATA HANDLER ---
function handleEspData(dataView) {
    try {
        const now = Date.now();
        const raw = parsePacket(dataView);
        if(!raw) return;

        // Berechnungen
        let ratio = (raw.infra_density > 0) ? raw.object_count / raw.infra_density : 0;
        
        let ageGap = 0;
        if (lastEspState.timestamp > 0) {
            let delta = raw.timestamp - lastEspState.timestamp;
            if (delta > 0 && delta < 10000) ageGap = delta;
        }
        
        let latency = 0;
        if (lastEspState.lastReceived > 0) latency = now - lastEspState.lastReceived;

        // Deltas (Stabilität / Geschwindigkeit)
        let stability = Math.abs(raw.env_snr - (lastEspState.wifi_rssi || raw.env_snr));
        let velocity = raw.object_proximity - (lastEspState.ble_rssi || raw.object_proximity);

        // State Update
        lastEspState = { 
            timestamp: raw.timestamp, 
            lastReceived: now, 
            wifi_rssi: raw.env_snr, 
            ble_rssi: raw.object_proximity 
        };

        // Input Vektor füllen
        neuralInput.groupB = { proximity: raw.infra_proximity, stability, density: raw.infra_density, snr: raw.env_snr };
        neuralInput.groupC = { proximity: raw.object_proximity, velocity, count: raw.object_count, spread: raw.object_spread };
        neuralInput.groupD = { ratio, ageGap, latency };

    } catch (e) { console.error("Parse Logic Error:", e); }
}

// --- FUSION LOOP ---
function fusionLoop() {
    // Gruppe A immer frisch
    neuralInput.groupA = PhoneSensors.data;
    
    // UI Update
    UI.updateNeuralVector(neuralInput);

    // AI Prediction (Nur wenn Brain trainiert ist und Daten da sind)
    if (!brain.isTraining && brain.model && neuralInput.groupB.proximity !== undefined) {
        const prediction = brain.process(neuralInput);
        
        const safeBar = document.getElementById('out-safe');
        const warnBar = document.getElementById('out-warn');
        const dangBar = document.getElementById('out-danger');

        if(safeBar) safeBar.style.width = (prediction.safe * 100) + "%";
        if(warnBar) warnBar.style.width = (prediction.warn * 100) + "%";
        if(dangBar) dangBar.style.width = (prediction.danger * 100) + "%";
    }

    // Recording (falls aktiv)
    if (recorder.isRecording && neuralInput.groupB.proximity !== undefined) {
        recorder.record(neuralInput);
    }
    
    requestAnimationFrame(fusionLoop);
}
