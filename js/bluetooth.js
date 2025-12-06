// UUIDs müssen exakt mit dem ESP32 Code übereinstimmen
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID    = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

export class BLEManager {
    constructor(onDataCallback, onLogCallback, onStatusCallback) {
        this.device = null;
        this.characteristic = null;
        this.onData = onDataCallback;
        this.log = onLogCallback;
        this.updateStatus = onStatusCallback;
    }

    async connect() {
        try {
            this.log("Suche nach ESP32 Neural Node...", "info");
            
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ name: "Neural_Node_ESP32" }], // Oder Name Prefix
                optionalServices: [SERVICE_UUID]
            });

            this.updateStatus("Verbinde...", "connecting");
            
            this.device.addEventListener('gattserverdisconnected', this.onDisconnected.bind(this));

            const server = await this.device.gatt.connect();
            this.log("GATT Server verbunden.", "success");

            const service = await server.getPrimaryService(SERVICE_UUID);
            this.characteristic = await service.getCharacteristic(CHAR_UUID);

            // Notify starten
            await this.characteristic.startNotifications();
            this.characteristic.addEventListener('characteristicvaluechanged', this.handleNotifications.bind(this));

            this.log("Notifications aktiviert. Empfange Stream...", "success");
            this.updateStatus("Verbunden", "connected");

        } catch (error) {
            this.log(`Verbindungsfehler: ${error}`, "error");
            this.updateStatus("Fehler", "disconnected");
        }
    }

    handleNotifications(event) {
        const value = event.target.value; // DataView
        if (this.onData) {
            this.onData(value);
        }
    }

    onDisconnected() {
        this.updateStatus("Getrennt", "disconnected");
        this.log("Verbindung zum Sensor verloren.", "warning");
    }
}
