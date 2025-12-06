import { BLEManager } from './bluetooth.js';
import { parsePacket } from './protocol.js';
import { UI } from './ui.js';

// Init
document.addEventListener('DOMContentLoaded', () => {
    const btnConnect = document.getElementById('btn-connect');

    // Callback Kette
    const ble = new BLEManager(
        (dataView) => { // On Data
            try {
                const parsed = parsePacket(dataView);
                UI.updateDashboard(parsed, dataView);
            } catch (e) {
                UI.log(`Parse Error: ${e.message}`, "error");
            }
        },
        (msg, type) => UI.log(msg, type), // On Log
        (status, cls) => UI.setStatus(status, cls) // On Status
    );

    btnConnect.addEventListener('click', () => {
        ble.connect();
    });
});
