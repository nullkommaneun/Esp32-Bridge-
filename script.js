const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID =    "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// --- NEURONALES NETZWERK (ANOMALIE DETEKTOR) ---
class AnomalyDetector {
    constructor() {
        this.windowSize = 20; 
        this.model = this.buildModel();
        this.trainingQueue = [];
        this.isTraining = false;
        
        // Adaptive Schwelle: Startet konservativ
        this.lossThreshold = 0.25; 
        this.lossHistory = [];
        
        log("🧠 KI Modell kompiliert. Lernbereit.", "success");
    }

    buildModel() {
        const model = tf.sequential();
        // Encoder (Komprimieren)
        model.add(tf.layers.dense({inputShape: [this.windowSize], units: 8, activation: 'relu'}));
        model.add(tf.layers.dense({units: 3, activation: 'relu'})); // Bottleneck
        // Decoder (Rekonstruieren)
        model.add(tf.layers.dense({units: 8, activation: 'relu'}));
        model.add(tf.layers.dense({units: this.windowSize, activation: 'sigmoid'}));
        model.compile({optimizer: 'adam', loss: 'meanSquaredError'});
        return model;
    }

    normalize(data) {
        // RSSI (-100 bis -20) auf 0.0 bis 1.0 mappen
        return data.map(val => (val + 100) / 80);
    }

    async detect(rssiSequence) {
        if (rssiSequence.length < this.windowSize) return 0;

        const tensorData = tf.tensor2d([this.normalize(rssiSequence)]);
        
        // 1. Rekonstruktion versuchen
        const output = this.model.predict(tensorData);
        
        // 2. Fehler berechnen (Loss)
        const lossTensor = tf.losses.meanSquaredError(tensorData, output);
        const loss = (await lossTensor.data())[0]; // Das ist der "Überraschungs-Wert" der KI

        // Cleanup Speicher
        tensorData.dispose(); output.dispose(); lossTensor.dispose();

        // 3. Automatische Kalibrierung (Schwelle anpassen)
        this.updateThreshold(loss);

        // 4. Lernen vormerken (wenn Signal "normal" scheint)
        if (loss < this.lossThreshold * 1.5) {
            this.trainingQueue.push(this.normalize(rssiSequence));
        }
        
        // Nachtrainieren alle 30 Datensätze
        if (this.trainingQueue.length > 30 && !this.isTraining) this.train();

        return loss;
    }

    updateThreshold(currentLoss) {
        // Gleitender Durchschnitt für die Schwelle
        this.lossHistory.push(currentLoss);
        if(this.lossHistory.length > 50) this.lossHistory.shift();
        
        const avgLoss = this.lossHistory.reduce((a,b)=>a+b,0) / this.lossHistory.length;
        // Die Schwelle ist der Durchschnitt + Sicherheitsabstand
        this.lossThreshold = avgLoss + 0.10; 
    }

    async train() {
        this.isTraining = true;
        const data = tf.tensor2d(this.trainingQueue);
        // Schnell lernen (epochs: 3) um nicht zu blockieren
        await this.model.fit(data, data, {epochs: 3, shuffle: true});
        data.dispose();
        this.trainingQueue = [];
        this.isTraining = false;
        // log("🧠 KI hat neue Muster gelernt.", "ai");
    }
}

// --- GERÄTE VERWALTUNG ---
class DeviceBrain {
    constructor(mac, aiRef) {
        this.mac = mac;
        this.ai = aiRef;
        this.rssiBuffer = [];
        this.lastSeen = Date.now();
        this.avgRssi = -100;
        
        this.currentLoss = 0; // Wie verwirrt ist die KI bei diesem Gerät?
        this.xPos = Math.random() * 100;
    }

    async addMeasurement(rssi) {
        this.lastSeen = Date.now();
        this.rssiBuffer.push(rssi);
        if (this.rssiBuffer.length > 20) this.rssiBuffer.shift();

        // Mittelwert für UI
        const sum = this.rssiBuffer.reduce((a,b) => a+b, 0);
        this.avgRssi = sum / this.rssiBuffer.length;

        // KI Analyse triggern
        if (this.rssiBuffer.length === 20) {
            this.currentLoss = await this.ai.detect(this.rssiBuffer);
        }
    }
}

// --- MAIN APP & WATCHDOG ---
class StaplerApp {
    constructor() {
        this.devices = {};
        this.ai = new AnomalyDetector();
        this.chart = this.initChart();
        
        // CONNECTION STATE
        this.isConnected = false;
        this.lastPacketTime = 0; // Wann kam das letzte Byte an?
        
        // LOOPs
        setInterval(() => this.updateUI(), 200); // UI Update
        setInterval(() => this.runWatchdog(), 1000); // Verbindungs-Check
        setInterval(() => this.runAIInspector(), 1500); // Debug Log
    }

    initChart() {
        try {
            const ctx = document.getElementById('radarChart').getContext('2d');
            return new Chart(ctx, {
                type: 'bubble',
                data: { datasets: [{ label: 'AI', data: [], backgroundColor: c => this.getColor(c.raw), borderColor: 'transparent' }] },
                options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { min: -100, max: -30, grid: { color: '#222' } }, x: { display: false } }, plugins: { legend: { display: false } } }
            });
        } catch(e) { log("Chart Init Fehler", "error"); }
    }

    async connect() {
        try {
            document.getElementById('offline-overlay').classList.add('hidden');
            log("Starte Bluetooth...", "info");
            
            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [SERVICE_UUID]
            });

            // Event Listener für "echtes" Disconnect (Bluetooth aus, Reichweite)
            device.addEventListener('gattserverdisconnected', () => this.onDisconnect());

            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE_UUID);
            const characteristic = await service.getCharacteristic(CHAR_UUID);
            
            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', (e) => this.handleData(e));
            
            this.isConnected = true;
            this.lastPacketTime = Date.now(); // Reset Timer
            document.getElementById('connection-dot').className = "dot-green";
            log("✅ SYSTEM ONLINE", "success");

        } catch (e) {
            log(`Verbindungsfehler: ${e.message}`, "error");
            this.onDisconnect();
        }
    }

    reconnect() {
        this.connect();
    }

    onDisconnect() {
        this.isConnected = false;
        document.getElementById('connection-dot').className = "dot-red";
        document.getElementById('status-display').className = ""; // Grau
        document.getElementById('main-status-text').innerText = "OFFLINE";
        document.getElementById('offline-overlay').classList.remove('hidden');
        log("❌ VERBINDUNG UNTERBROCHEN", "error");
    }

    // --- WATCHDOG: Der Herzschlag-Wächter ---
    runWatchdog() {
        if (!this.isConnected) return;

        const silence = Date.now() - this.lastPacketTime;
        // Wenn länger als 3.5 Sekunden keine Daten kamen -> Alarm
        if (silence > 3500) {
            log(`Watchdog Alarm: Keine Daten seit ${silence}ms`, "error");
            this.onDisconnect();
        }
    }

    handleData(event) {
        this.lastPacketTime = Date.now(); // Herzschlag resetten!
        
        try {
            const val = new TextDecoder().decode(event.target.value);
            const [mac, rssiStr] = val.split("|");
            const rssi = parseInt(rssiStr);
            if(isNaN(rssi)) return;

            if (!this.devices[mac]) this.devices[mac] = new DeviceBrain(mac, this.ai);
            this.devices[mac].addMeasurement(rssi);
        } catch(e) {}
    }

    updateUI() {
        if(!this.isConnected || !this.chart) return;

        const chartData = [];
        let maxRisk = 0; 
        let highestLoss = 0;
        const now = Date.now();
        const threshold = this.ai.lossThreshold;

        for (const mac in this.devices) {
            const dev = this.devices[mac];
            if (now - dev.lastSeen > 5000) continue;

            if (dev.currentLoss > highestLoss) highestLoss = dev.currentLoss;

            // --- ENTSCHEIDUNG ---
            let risk = 0;
            // 1. Anomalie Logik
            if (dev.currentLoss > threshold) {
                // Wenn Anomalie UND nah genug -> Gefahr
                if(dev.avgRssi > -75) risk = 2;
                else if(dev.avgRssi > -85) risk = 1;
            }
            // 2. Absolute Notbremse
            if (dev.avgRssi > -45) risk = 2;

            if (risk > maxRisk) maxRisk = risk;

            chartData.push({ x: dev.xPos, y: dev.avgRssi, r: (risk===2)?25:(risk===1?15:6), riskLevel: risk });
        }

        this.chart.data.datasets[0].data = chartData;
        this.chart.update();

        // Dashboard Werte Updaten
        document.getElementById('val-objects').innerText = chartData.length;
        document.getElementById('val-loss').innerText = highestLoss.toFixed(4); // Zeige 4 Kommastellen
        document.getElementById('val-thresh').innerText = threshold.toFixed(4);

        this.setStatus(maxRisk);
    }

    // --- AI INSPECTOR (DEBUGGER) ---
    runAIInspector() {
        if(!this.isConnected) return;
        
        // Zeige Details zum "schlimmsten" Signal
        let worstDev = null;
        let maxLoss = -1;

        for(const mac in this.devices) {
            if(this.devices[mac].currentLoss > maxLoss) {
                maxLoss = this.devices[mac].currentLoss;
                worstDev = this.devices[mac];
            }
        }

        if(worstDev) {
            const thresh = this.ai.lossThreshold.toFixed(4);
            const loss = worstDev.currentLoss.toFixed(4);
            const rssi = worstDev.avgRssi.toFixed(0);
            
            // Symbolik für den Debugger
            let status = "✅ OK";
            if (loss > thresh) status = "⚠️ ANOMALIE";
            if (rssi > -45) status = "🚨 CRITICAL";

            log(`SCAN: [${worstDev.mac.slice(-5)}] RSSI: ${rssi}dB | Loss: ${loss} (Limit: ${thresh}) | ${status}`, "ai");
        }
    }

    setStatus(risk) {
        const d = document.getElementById('status-display');
        const t = document.getElementById('main-status-text');
        const r = document.getElementById('ai-reason');
        d.className = "";
        
        if (risk === 2) {
            d.classList.add('status-danger');
            t.innerText = "STOP!!";
            r.innerText = "KI: Kritisches Muster erkannt!";
            if(navigator.vibrate) navigator.vibrate(200);
        } else if (risk === 1) {
            d.classList.add('status-warn');
            t.innerText = "ACHTUNG";
            r.innerText = "KI: Ungewöhnliches Signal";
        } else {
            d.classList.add('status-safe');
            t.innerText = "FREI";
            r.innerText = "Muster innerhalb Toleranz";
        }
    }

    getColor(item) {
        if (!item) return 'rgba(0,0,0,0)';
        if (item.riskLevel === 2) return 'rgba(255, 0, 85, 0.9)'; 
        if (item.riskLevel === 1) return 'rgba(255, 170, 0, 0.8)'; 
        return 'rgba(0, 255, 0, 0.6)'; 
    }
}
