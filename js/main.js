import { BLEManager } from './bluetooth.js';
import { parsePacket } from './protocol.js';
import { PhoneSensors } from './sensors.js'; 
import { UI } from './ui.js';
import { DataRecorder } from './recorder.js';
import { NeuralBrain } from './brain.js';

// --- SYSTEM INITIALIZATION ---
const recorder = new DataRecorder();
const brain = new NeuralBrain();

// Global State
let neuralInput = { 
    groupA: {}, groupB: {}, groupC: {}, groupD: {} 
};

// Delta Memory
let lastEspState = { 
    timestamp: 0, wifi_rssi: 0, ble_rssi: 0, lastReceived: 0 
};

// Learning Config
const LEARNING_DURATION_MS = 120000; // 2 Minutes
let learningTimer = null;
let countdownInterval = null;

// --- STARTUP ---
document.addEventListener('DOMContentLoaded', () => {
    // Buttons
    const btnConnect = document.getElementById('btn-connect');
    const btnLearn = document.getElementById('btn-learn') || document.getElementById('btn-record');

    // BLE Manager
    const ble = new BLEManager(handleEspData, UI.log, UI.setStatus);

    // 1. AUTO-LEARNING LOGIC (2 Minute Timer)
    if (btnLearn) {
        btnLearn.addEventListener('click', async () => {
            
            // IF IDLE -> START 2 MINUTE LEARNING
            if (!recorder.isRecording && !brain.isTraining) {
                startAutoLearning(btnLearn);
            } 
            // IF RECORDING -> MANUAL ABORT (Optional safety)
            else if (recorder.isRecording) {
                stopAutoLearning(btnLearn, false); // False = Aborted
            }
        });
    } else {
        console.error("CRITICAL: Learn button not found!");
        UI.log("GUI Error: Button missing.", "error");
    }

    // 2. CONNECT LOGIC
    if (btnConnect) {
        btnConnect.addEventListener('click', async () => {
            try { 
                await PhoneSensors.init(); 
                UI.log("Sensoren bereit.", "success");
            } catch (e) { console.warn(e); }
            ble.connect();
            requestAnimationFrame(fusionLoop);
        });
    }
});

// --- HELPER FUNCTIONS FOR LEARNING ---

function startAutoLearning(btn) {
    recorder.start();
    btn.classList.add('recording');
    
    UI.log("🚨 LERN-MODUS AKTIV: Fahre 2 Minuten normal!", "info");
    
    let timeLeft = LEARNING_DURATION_MS / 1000;
    
    // Countdown Timer UI
    countdownInterval = setInterval(() => {
        timeLeft--;
        btn.textContent = `⏳ ${timeLeft}s`;
        if(timeLeft <= 0) clearInterval(countdownInterval);
    }, 1000);

    // Auto-Stop Timer
    learningTimer = setTimeout(() => {
        stopAutoLearning(btn, true); // True = Success/Time Done
    }, LEARNING_DURATION_MS);
}

function stopAutoLearning(btn, completed) {
    // Clear Timers
    clearTimeout(learningTimer);
    clearInterval(countdownInterval);
    
    recorder.stop(); // Stop recording, data is in buffer
    btn.classList.remove('recording');

    if (!completed) {
        btn.textContent = "🧠 Lernen (Start)";
        UI.log("Lernvorgang abgebrochen.", "warning");
        return;
    }

    // Start Training Sequence
    btn.textContent = "⚙️ Training...";
    UI.log(`Zeit um! Trainiere mit ${recorder.buffer.length} Datensätzen...`, "info");

    const trainingData = recorder.buffer.map(row => row.slice(1, 17));

    // Async Training
    setTimeout(async () => {
        const success = await brain.train(trainingData);
        if (success) {
            btn.textContent = "✅ AI Aktiv";
            btn.classList.add('active-brain'); 
            UI.log("System Kalibriert & Scharf geschaltet.", "success");
        } else {
            btn.textContent = "❌ Fehler";
            UI.log("Training fehlgeschlagen.", "error");
        }
    }, 100);
}

// --- DATA PROCESSING (unchanged logic) ---
function handleEspData(dataView) {
    try {
        const now = Date.now();
        const raw = parsePacket(dataView);
        if(!raw) return;

        let ratio = 0.0;
        if (raw.infra_density > 0) ratio = raw.object_count / raw.infra_density;

        let ageGap = 0;
        if (lastEspState.timestamp > 0) {
            let delta = raw.timestamp - lastEspState.timestamp;
            if (delta > 0 && delta < 10000) ageGap = delta;
        }

        let latency = 0;
        if (lastEspState.lastReceived > 0) latency = now - lastEspState.lastReceived;

        let stability = Math.abs(raw.env_snr - (lastEspState.wifi_rssi || raw.env_snr));
        let velocity = raw.object_proximity - (lastEspState.ble_rssi || raw.object_proximity);

        lastEspState.timestamp = raw.timestamp;
        lastEspState.lastReceived = now;
        lastEspState.wifi_rssi = raw.env_snr;
        lastEspState.ble_rssi = raw.object_proximity;

        neuralInput.groupB = { proximity: raw.infra_proximity, stability: stability, density: raw.infra_density, snr: raw.env_snr };
        neuralInput.groupC = { proximity: raw.object_proximity, velocity: velocity, count: raw.object_count, spread: raw.object_spread };
        neuralInput.groupD = { ratio: ratio, ageGap: ageGap, latency: latency };

    } catch (e) { console.error("Fusion Error:", e); }
}

// --- MAIN LOOP ---
function fusionLoop() {
    neuralInput.groupA = PhoneSensors.data;
    UI.updateNeuralVector(neuralInput);

    // AI Prediction & Recording
    if (neuralInput.groupB.proximity !== undefined) {
        const prediction = brain.process(neuralInput);
        
        const safeBar = document.getElementById('out-safe');
        const warnBar = document.getElementById('out-warn');
        const dangBar = document.getElementById('out-danger');

        if(safeBar) safeBar.style.width = (prediction.safe * 100) + "%";
        if(warnBar) warnBar.style.width = (prediction.warn * 100) + "%";
        if(dangBar) dangBar.style.width = (prediction.danger * 100) + "%";

        recorder.record(neuralInput);
    }
    requestAnimationFrame(fusionLoop);
}
