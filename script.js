// --- KONFIGURATION ---
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID =    "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// --- DAS NEURONALE NETZ (AUTOENCODER) ---
class AnomalyDetector {
    constructor() {
        this.windowSize = 20; // Wir schauen uns Sequenzen von 20 Werten an
        this.model = this.buildModel();
        this.isTraining = false;
        this.trainingQueue = []; // Sammelt Daten zum Lernen
        
        // Dynamische Schwelle (Lernt, was "normaler" Fehler ist)
        this.lossThreshold = 0.15; 
        this.lossHistory = [];
        
        log("🧠 Neural Network initialisiert.", "info");
    }

    buildModel() {
        const model = tf.sequential();
        // Encoder: Komprimiert die Daten
        model.add(tf.layers.dense({inputShape: [this.windowSize], units: 10, activation: 'relu'}));
        model.add(tf.layers.dense({units: 5, activation: 'relu'})); // Das "Nadelöhr"
        // Decoder: Rekonstruiert die Daten
        model.add(tf.layers.dense({units: 10, activation: 'relu'}));
        model.add(tf.layers.dense({units: this.windowSize, activation: 'sigmoid'})); // Output 0-1
        
        model.compile({optimizer: 'adam', loss: 'meanSquaredError'});
        return model;
    }

    // Normalisiert RSSI (-100 bis -30) auf 0.0 bis 1.0
    normalize(data) {
        return data.map(val => (val + 100) / 70);
    }

    async detect(rssiSequence) {
        if (rssiSequence.length < this.windowSize) return 0; // Nicht genug Daten

        const input = tf.tensor2d([this.normalize(rssiSequence)]);
        
        // 1. Vorhersage (Rekonstruktion)
        const output = this.model.predict(input);
        
        // 2. Fehler berechnen (Loss)
        const lossTensor = tf.losses.meanSquaredError(input, output);
        const loss = (await lossTensor.data())[0];

        // Speicher aufräumen (Wichtig in JS!)
        input.dispose();
        output.dispose();
        lossTensor.dispose();

        // 3. Lernen (Daten für späteres Training vormerken)
        // Wir lernen nur, wenn KEIN Alarm ist (wir wollen ja Normalität lernen)
        if (loss < this.lossThreshold * 2) {
            this.trainingQueue.push(this.normalize(rssiSequence));
        }
        
        // Automatisches Nachtraining alle 50 Datensätze
        if (this.trainingQueue.length > 50 && !this.isTraining) {
            this.train();
        }

        // 4. Adaptiver Schwellenwert (Der "Gewöhnungseffekt")
        this.lossHistory.push(loss);
        if(this.lossHistory.length > 100) this.lossHistory.shift();
        
        // Durchschnittlichen Fehler berechnen
        const avgLoss = this.lossHistory.reduce((a,b)=>a+b,0) / this.lossHistory.length;
        
        // Die Schwelle ist der Durchschnitt + Toleranz
        // Die KI passt sich also an: Wenn die Halle "laut" ist, wird die Schwelle höher.
        this.lossThreshold = avgLoss + 0.05; 

        return loss; // Je höher, desto ungewöhnlicher (Gefahr)
    }

    async train() {
        this.isTraining = true;
        // log("🧠 KI lernt neue Umgebungsmuster...", "info");
        
        const data = tf.tensor2d(this.trainingQueue);
        await this.model.fit(data, data, {epochs: 5, shuffle: true});
        
        data.dispose();
        this.trainingQueue = []; // Queue leeren
        this.isTraining = false;
    }
}

// --- DEVICE MANAGEMENT ---
class DeviceBrain {
    constructor(mac, neuralNet) {
        this.mac = mac;
        this.neuralNet = neuralNet; // Referenz auf das zentrale Gehirn
        this.rssiBuffer = [];
        this.lastSeen = Date.now();
        
        this.anomalyScore = 0; // Wie seltsam findet die KI dieses Gerät?
        this.avgRssi = -100;
        this.xPos = Math.random() * 100;
    }

    async addMeasurement(rssi) {
        this.lastSeen = Date.now();
        this.rssiBuffer.push(rssi);
        if (this.rssiBuffer.length > 20) this.rssiBuffer.shift();

        // Durchschnitt berechnen
        const sum = this.rssiBuffer.reduce((a,b) => a+b, 0);
        this.avgRssi = sum / this.rssiBuffer.length;

        // KI Fragen: "Ist das normal?"
        if (this.rssiBuffer.length === 20) {
            this.anomalyScore = await this.neuralNet.detect(this.rssiBuffer);
        }
    }
}

// --- MAIN APP ---
class StaplerApp {
    constructor() {
        this.devices = {};
        this.ai = new AnomalyDetector(); // Das zentrale Gehirn
        this.isScanning = false;
        
        try {
            this.chart = this.initChart();
        } catch (e) { log(e.message, "error"); }

        setInterval(() => this.updateUI(), 200);
        log("System bereit. Neural Engine: ONLINE", "success");
    }

    initChart() {
        const ctx = document.getElementById('radarChart').getContext('2d');
        return new Chart(ctx, {
            type: 'bubble',
            data: { datasets: [{ 
                label: 'AI Perception', 
                data: [], 
                backgroundColor: ctx => this.getColor(ctx.raw),
                borderColor: 'transparent' 
            }] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                scales: {
                    y: { min: -100, max: -30, grid: { color: '#333' } },
                    x: { display: false, min: 0, max: 100 }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    async connect() {
        try {
            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [SERVICE_UUID] 
            });
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE_UUID);
            const characteristic = await service.getCharacteristic(CHAR_UUID);
            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', (e) => this.handleData(e));
            this.isScanning = true;
            document.getElementById('btn-connect').innerText = "AI ACTIVE";
            document.getElementById('btn-connect').style.color = "#0f0";
            document.getElementById('btn-connect').style.borderColor = "#0f0";
            log("Verbindung steht. KI beginnt Datenanalyse...", "success");
        } catch (e) { log(e.message, "error"); }
    }

    handleData(event) {
        try {
            const val = new TextDecoder().decode(event.target.value);
            const parts = val.split("|");
            if(parts.length !== 2) return;
            const mac = parts[0];
            const rssi = parseInt(parts[1]);

            if (!this.devices[mac]) {
                // Übergib das zentrale neuronale Netz an das neue Gerät
                this.devices[mac] = new DeviceBrain(mac, this.ai);
            }
            this.devices[mac].addMeasurement(rssi);
        } catch(err) {}
    }

    updateUI() {
        if(!this.isScanning || !this.chart) return;

        const chartData = [];
        let maxRisk = 0; 
        let highestRssi = -100;
        let maxAnomaly = 0;
        const now = Date.now();
        const threshold = this.ai.lossThreshold; // Die aktuelle Schmerzgrenze der KI

        for (const mac in this.devices) {
            const dev = this.devices[mac];
            if (now - dev.lastSeen > 5000) continue;
            
            if (dev.avgRssi > highestRssi) highestRssi = dev.avgRssi;
            if (dev.anomalyScore > maxAnomaly) maxAnomaly = dev.anomalyScore;

            // --- DIE ENTSCHEIDUNG ---
            let risk = 0;
            
            // Regel 1: Totale Nähe (Notbremse bleibt immer)
            if (dev.avgRssi > -45) risk = 2;
            
            // Regel 2: Die KI findet das Muster seltsam (Anomaly > Threshold)
            // UND es ist nah genug, um relevant zu sein (> -75)
            else if (dev.anomalyScore > threshold && dev.avgRssi > -75) {
                risk = 2; // ALARM! Ungewöhnliches Verhalten in der Nähe
            }
            else if (dev.anomalyScore > threshold * 0.8 && dev.avgRssi > -85) {
                risk = 1; // Warnung
            }

            if (risk > maxRisk) maxRisk = risk;

            chartData.push({
                x: dev.xPos,
                y: dev.avgRssi,
                r: (risk === 2) ? 25 : (risk === 1 ? 15 : 6),
                riskLevel: risk 
            });
        }

        this.chart.data.datasets[0].data = chartData;
        this.chart.update();

        // Dashboard Werte
        document.getElementById('val-objects').innerText = chartData.length;
        document.getElementById('val-rssi').innerText = highestRssi.toFixed(0);
        // Wir zeigen jetzt den "Anomaly Score" an statt Velocity
        document.getElementById('val-velocity').innerText = maxAnomaly.toFixed(3) + " / " + threshold.toFixed(3);

        this.setMainStatus(maxRisk);
    }

    setMainStatus(riskLevel) {
        const display = document.getElementById('status-display');
        const text = document.getElementById('main-status-text');
        const reason = document.getElementById('ai-reason');

        display.className = "";
        if (riskLevel === 2) {
            display.classList.add('status-danger');
            text.innerText = "STOP!!";
            reason.innerText = "KI meldet Anomalie!";
            if(navigator.vibrate) navigator.vibrate(200);
        } else if (riskLevel === 1) {
            display.classList.add('status-safe'); 
            display.style.borderColor = "orange";
            display.style.color = "orange";
            text.innerText = "ACHTUNG";
            reason.innerText = "Ungewöhnliches Signal";
        } else {
            display.classList.add('status-safe');
            text.innerText = "FREI";
            reason.innerText = "Muster normal.";
        }
    }

    getColor(item) {
        if (!item || item.riskLevel === undefined) return 'rgba(0,0,0,0)'; 
        if (item.riskLevel === 2) return 'rgba(255, 0, 85, 0.9)'; 
        if (item.riskLevel === 1) return 'rgba(255, 170, 0, 0.8)'; 
        return 'rgba(0, 255, 0, 0.6)'; 
    }
}
 
