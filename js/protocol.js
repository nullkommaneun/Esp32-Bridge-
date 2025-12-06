// NSFP v1.0 Parser
// Mappt das 10-Byte Array auf ein JS Objekt

export const PACKET_SIZE = 10;

export function parsePacket(dataView) {
    if (dataView.byteLength !== PACKET_SIZE) {
        throw new Error(`Invalid packet size. Expected ${PACKET_SIZE}, got ${dataView.byteLength}`);
    }

    return {
        // --- Gruppe B: Spectrum ---
        wifi_count:      dataView.getUint8(0),
        wifi_avg_rssi:   dataView.getInt8(1),      // Signed!
        wifi_cong_peak:  dataView.getUint8(2),

        // --- Gruppe C: Dynamic Env ---
        ble_dev_count:   dataView.getUint8(3),
        ble_max_rssi:    dataView.getInt8(4),      // Signed!
        ble_traffic_idx: dataView.getUint8(5),

        // --- Meta ---
        // Little Endian (true) ist wichtig für ESP32
        timestamp:       dataView.getUint32(6, true) 
    };
}

// Hilfsfunktion für den Debugger (Hex String)
export function toHexString(dataView) {
    let hex = "";
    for (let i = 0; i < dataView.byteLength; i++) {
        const byte = dataView.getUint8(i).toString(16).toUpperCase();
        hex += (byte.length === 1 ? "0" + byte : byte) + " ";
    }
    return hex.trim();
}
