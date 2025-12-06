import { BLEManager } from './bluetooth.js';
import { parsePacket } from './protocol.js';
import { PhoneSensors } from './sensors.js'; 
import { UI } from './ui.js';
import { DataRecorder } from './recorder.js'; // NEU
import { NeuralBrain } from './brain.js';     // NEU

// Module
const recorder = new DataRecorder();
const brain = new NeuralBrain();

// Globale Input Variable
let neuralInput = { groupA: {}, groupB: {}, groupC: {}, groupD: {} };
let lastEspState = { wifi_rssi: -100, ble_rssi: -100, timestamp: 0 };

document.addEventListener('DOMContentLoaded', () => {
    const btnConnect = document.getElementById('btn-connect');
    const btnRecord = document.getElementById('btn-record');

    const ble = new BLEManager(handleEspData, UI.log, UI.setStatus);

    // RECORD BUTTON
    btnRecord.addEventListener('click', () => {
        if (!recorder.isRecording) {
            recorder.start();
            btnRecord.textContent = "⏹ Stop";
            btnRecord.classList.add('recording');
        } else {
            recorder.stop(); // Lädt CSV herunter
            btnRecord.textContent = "⚫ Rec";
            btnRecord.classList.remove('recording');
        }
    });

    btnConnect.addEventListener('click', async () => {
        try { await PhoneSensors.init(); } catch (e) { console.warn(e); }
        ble.connect();
        requestAnimationFrame(fusionLoop);
    });
});

// ... handleEspData (BLE Parser) bleibt gleich wie vorher ...
function handleEspData(dataView) {
   // ... (Dein existierender Code für Inputs B, C, D) ...
   // Wichtig: Fülle das 'neuralInput' Objekt hier!
   try {
        const raw = parsePacket(dataView);
        if(!raw) return;
        const now = Date.now();
        // ... (Berechnungen Velocity etc.) ...
        
        neuralInput.groupB = { proximity: raw.infra_proximity, stability: 0 /*Calc*/, density: raw.infra_density, snr: raw.env_snr };
        neuralInput.groupC = { proximity: raw.object_proximity, velocity: 0 /*Calc*/, count: raw.object_count, spread: raw.object_spread };
        neuralInput.groupD = { ratio: 0, ageGap: 0, latency: now - (raw._receiveTime||now) };
   } catch(e) {}
}

function fusionLoop() {
    // 1. Gruppe A (Physik) holen
    neuralInput.groupA = PhoneSensors.data;

    // 2. UI Update (Inputs)
    UI.updateNeuralVector(neuralInput);

    // 3. Brain Processing (Inference)
    // Wenn alle Daten da sind:
    if (neuralInput.groupA.accSurge !== undefined && neuralInput.groupB.proximity !== undefined) {
        
        // Prediction holen
        const prediction = brain.process(neuralInput);
        
        // UI Output Update (Balken)
        document.getElementById('out-safe').style.width = (prediction.safe * 100) + "%";
        document.getElementById('out-warn').style.width = (prediction.warn * 100) + "%";
        document.getElementById('out-danger').style.width = (prediction.danger * 100) + "%";

        // 4. Recording (Daten speichern wenn aktiv)
        recorder.record(neuralInput);
    }
    
    requestAnimationFrame(fusionLoop);
}
