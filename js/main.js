import { BLEManager } from './bluetooth.js';
import { parsePacket } from './protocol.js';
import { PhoneSensors } from './sensors.js'; 
import { UI } from './ui.js';

let latestESPData = null;

document.addEventListener('DOMContentLoaded', () => {
    const btnConnect = document.getElementById('btn-connect');

    // BLE Handler
    const ble = new BLEManager(
        (dataView) => { 
            // 1. Daten empfangen
            try {
                const parsed = parsePacket(dataView);
                // Zeitstempel hinzufügen, damit wir wissen wie alt das Paket ist
                parsed._receiveTime = Date.now(); 
                // Global speichern (wird vom Loop abgeholt)
                latestESPData = parsed;
            } catch (e) { 
                console.error("Parse Error:", e);
                // Fehler nicht ins UI Log schreiben, um Spam zu vermeiden
            }
        },
        (msg, type) => UI.log(msg, type),
        (status, cls) => UI.setStatus(status, cls)
    );

    btnConnect.addEventListener('click', async () => {
        // 1. Handy-Sensoren starten (Audio, Bewegung)
        try {
            await PhoneSensors.init();
            UI.log("Handy-Sensoren aktiv.", "success");
        } catch (e) {
            UI.log("Sensor-Fehler: " + e, "error");
        }

        // 2. Bluetooth verbinden
        ble.connect();
        
        // 3. Den "Fusion Loop" starten (60 mal pro Sekunde)
        requestAnimationFrame(fusionLoop);
    });
});

// Der Fusion Loop aktualisiert die Anzeige flüssig
function fusionLoop() {
    // Audio-Daten aktualisieren (muss in jedem Frame passieren)
    PhoneSensors.updateAudio();

    // UI mit beiden Datenquellen füttern
    // latestESPData = Was vom Chip kommt
    // PhoneSensors.data = Was vom Handy kommt
    UI.updateAll(latestESPData, PhoneSensors.data);

    // Nächsten Frame anfordern (Endlosschleife)
    requestAnimationFrame(fusionLoop);
}
