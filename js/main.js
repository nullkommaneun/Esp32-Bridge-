import { BLEManager } from './bluetooth.js';
import { parsePacket } from './protocol.js';
import { PhoneSensors } from './sensors.js'; 
import { UI } from './ui.js';
import { DataRecorder } from './recorder.js';
import { NeuralBrain } from './brain.js';

// Module instanziieren
const recorder = new DataRecorder();
const brain = new NeuralBrain();

// Globaler State
let neuralInput = { groupA: {}, groupB: {}, groupC: {}, groupD: {} };
let lastEspState = { timestamp: 0 };

document.addEventListener('DOMContentLoaded', () => {
    const btnConnect = document.getElementById('btn-connect');
    const btnRecord = document.getElementById('btn-record');

    // BLE Manager mit Callback verbinden
    const ble = new BLEManager(handleEspData, UI.log, UI.setStatus);

    // RECORD BUTTON LOGIK
    btnRecord.addEventListener('click', () => {
        if (!recorder.isRecording) {
            recorder.start();
            btnRecord.textContent = "⏹ Stop";
            btnRecord.classList.add('recording');
        } else {
            recorder.stop();
            btnRecord.textContent = "⚫ Rec";
            btnRecord.classList.remove('recording');
        }
    });

    // CONNECT BUTTON LOGIK
    btnConnect.addEventListener('click', async () => {
        try { await PhoneSensors.init(); } catch (e) { console.warn(e); }
        ble.connect();
        requestAnimationFrame(fusionLoop);
    });
});

// Callback wenn Daten vom ESP32 kommen
function handleEspData(dataView) {
    try {
        const now = Date.now(); // Sofort Zeit nehmen für Latenz!
        
        const raw = parsePacket(dataView);
        if(!raw) return;

        // --- BERECHNUNGEN GRUPPE D ---
        
        // 1. Ratio (Schutz vor Division durch Null)
        let ratio = 0;
        if (raw.infra_density > 0) {
            ratio = raw.object_count / raw.infra_density;
        }

        // 2. Age Gap (Zeit seit letztem Paket)
        // Beim ersten Paket ist lastEspState.timestamp noch 0 -> Gap ignorieren
        let ageGap = 0;
        if (lastEspState.timestamp > 0) {
            ageGap = raw.timestamp - lastEspState.timestamp;
        }
        
        // 3. Latency (Verzögerung Übertragung)
        // Wir nehmen an, raw.timestamp ist ESP-Zeit. Wir können echte Latenz nur messen,
        // wenn wir NTP hätten. Hier messen wir "Verarbeitungszeit im JS".
        // Besser: Wir messen einfach den Jitter (Schwankung).
        // Fürs Dashboard nehmen wir einfach 0 oder einen Dummy, da echte Latenz ohne Zeitsync schwer ist.
        // Alternativ: Zeit seit letztem Paket im Browser.
        const latency = 0; // Platzhalter, da echte Latenz ohne NTP ungenau ist

        // State Update
        lastEspState.timestamp = raw.timestamp;

        // --- DATEN SPEICHERN ---
        // WICHTIG: Wir überschreiben die Objekte nicht, sondern updaten die Properties
        
        neuralInput.groupB = { 
            proximity: raw.infra_proximity, 
            stability: 0, // In V3 Stable schwer zu berechnen, lassen wir auf 0
            density:   raw.infra_density, 
            snr:       raw.env_snr 
        };

        neuralInput.groupC = { 
            proximity: raw.object_proximity, 
            velocity:  0, 
            count:     raw.object_count, 
            spread:    raw.object_spread 
        };

        neuralInput.groupD = { 
            ratio:     ratio,     
            ageGap:    ageGap,    
            latency:   latency
        };
        
        // Debugging für Ratio (Schau in die Konsole F12)
        // console.log(`Ratio Calc: ${raw.object_count} / ${raw.infra_density} = ${ratio}`);

    } catch (e) { console.error(e); }
}

// Der 60FPS Loop für UI und AI
function fusionLoop() {
    // 1. Gruppe A immer frisch vom Handy holen
    neuralInput.groupA = PhoneSensors.data;

    // 2. UI Update
    UI.updateNeuralVector(neuralInput);

    // 3. AI & Recording nur wenn Daten da sind
    if (neuralInput.groupB.proximity !== undefined) {
        
        // Brain fragen
        const prediction = brain.process(neuralInput);
        
        // Balken updaten
        const safeBar = document.getElementById('out-safe');
        const warnBar = document.getElementById('out-warn');
        const dangBar = document.getElementById('out-danger');

        if(safeBar) safeBar.style.width = (prediction.safe * 100) + "%";
        if(warnBar) warnBar.style.width = (prediction.warn * 100) + "%";
        if(dangBar) dangBar.style.width = (prediction.danger * 100) + "%";

        // Aufzeichnen
        recorder.record(neuralInput);
    }
    
    requestAnimationFrame(fusionLoop);
}
