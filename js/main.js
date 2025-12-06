import { BLEManager } from './bluetooth.js';
import { parsePacket } from './protocol.js';
import { PhoneSensors } from './sensors.js'; 
import { UI } from './ui.js';
import { DataRecorder } from './recorder.js';
import { NeuralBrain } from './brain.js';

const recorder = new DataRecorder();
const brain = new NeuralBrain();

// Daten Container
let neuralInput = { groupA: {}, groupB: {}, groupC: {}, groupD: {} };
let lastEspState = { timestamp: 0, wifi_rssi: 0, ble_rssi: 0, lastReceived: 0 };

document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    
    const btnConnect = document.getElementById('btn-connect');
    const btnRecord = document.getElementById('btn-auto-record');
    const btnTrain = document.getElementById('btn-start-train');
    const fileInput = document.getElementById('csv-upload');
    const ble = new BLEManager(handleEspData, UI.log, updateConnectionStatus);

    // 1. CONNECT
    btnConnect.addEventListener('click', async () => {
        try { await PhoneSensors.init(); } catch (e) { console.warn(e); }
        ble.connect();
        requestAnimationFrame(fusionLoop);
    });

    // 2. AUTO-RECORD (Tab 1)
    btnRecord.addEventListener('click', () => {
        startAutoRecording(btnRecord);
    });

    // 3. FILE UPLOAD (Tab 2)
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            btnTrain.disabled = false;
            document.getElementById('train-log').textContent = "Datei bereit. Klicke auf 'Start'.";
        }
    });

    // 4. TRAINING STARTEN (Tab 2)
    btnTrain.addEventListener('click', () => {
        const file = fileInput.files[0];
        if (!file) return;
        
        btnTrain.disabled = true;
        btnTrain.textContent = "⏳ Lese Datei...";
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            const csvText = e.target.result;
            const data = parseCSV(csvText);
            
            document.getElementById('train-log').textContent = `Lerne aus ${data.length} Datensätzen...`;
            
            // Training starten
            const success = await brain.train(data);
            
            if (success) {
                document.getElementById('train-log').textContent = "✅ Training erfolgreich! KI ist aktiv.";
                btnTrain.textContent = "Fertig";
                document.getElementById('ai-output').classList.remove('blurred');
                document.getElementById('ai-status').textContent = "AKTIV";
                document.getElementById('ai-status').style.color = "#2ea043";
            } else {
                document.getElementById('train-log').textContent = "❌ Fehler beim Training.";
                btnTrain.disabled = false;
            }
        };
        reader.readAsText(file);
    });
});

// --- HELPER: CSV PARSER ---
function parseCSV(text) {
    const lines = text.trim().split('\n');
    const data = [];
    // Überspringe Header (Zeile 0), starte bei 1
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',').map(Number);
        // Wir brauchen Spalten 1 bis 16 (ohne Time und Label)
        // Format: Time, N1...N16, Label
        if (row.length >= 17) {
            data.push(row.slice(1, 17));
        }
    }
    return data;
}

// --- HELPER: AUTO RECORDING ---
function startAutoRecording(btn) {
    if (recorder.isRecording) return; // Schutz

    let timeLeft = 120; // 2 Minuten
    
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
            setTimeout(() => { btn.textContent = "🔴 Start Aufnahme (2min)"; }, 5000);
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
            document.getElementById(tab.dataset.tab).classList.add('active');
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
        document.getElementById('dashboard').classList.remove('blurred');
        document.getElementById('btn-auto-record').disabled = false;
    }
}

// --- FUSION LOOP ---
function fusionLoop() {
    neuralInput.groupA = PhoneSensors.data;
    UI.updateNeuralVector(neuralInput);

    // AI Prediction (Nur wenn Brain trainiert ist)
    if (!brain.isTraining && brain.model && neuralInput.groupB.proximity !== undefined) {
        const prediction = brain.process(neuralInput);
        
        document.getElementById('out-safe').style.width = (prediction.safe * 100) + "%";
        document.getElementById('out-warn').style.width = (prediction.warn * 100) + "%";
        document.getElementById('out-danger').style.width = (prediction.danger * 100) + "%";
    }

    if (recorder.isRecording && neuralInput.groupB.proximity !== undefined) {
        recorder.record(neuralInput);
    }
    
    requestAnimationFrame(fusionLoop);
}

// --- ESP DATA HANDLER (wie gehabt) ---
function handleEspData(dataView) {
    try {
        const now = Date.now();
        const raw = parsePacket(dataView);
        if(!raw) return;

        let ratio = (raw.infra_density > 0) ? raw.object_count / raw.infra_density : 0;
        let ageGap = (lastEspState.timestamp > 0) ? raw.timestamp - lastEspState.timestamp : 0;
        if (ageGap < 0 || ageGap > 10000) ageGap = 0;
        let latency = (lastEspState.lastReceived > 0) ? now - lastEspState.lastReceived : 0;

        let stability = Math.abs(raw.env_snr - (lastEspState.wifi_rssi || raw.env_snr));
        let velocity = raw.object_proximity - (lastEspState.ble_rssi || raw.object_proximity);

        lastEspState = { timestamp: raw.timestamp, lastReceived: now, wifi_rssi: raw.env_snr, ble_rssi: raw.object_proximity };

        neuralInput.groupB = { proximity: raw.infra_proximity, stability, density: raw.infra_density, snr: raw.env_snr };
        neuralInput.groupC = { proximity: raw.object_proximity, velocity, count: raw.object_count, spread: raw.object_spread };
        neuralInput.groupD = { ratio, ageGap, latency };

    } catch (e) { console.error(e); }
}
