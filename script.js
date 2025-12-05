/* * STAPLER AI CORE v2.0 - "DEEP FUSION"
 * Architektur: Gatekeeper -> Context Mixer -> Autoencoder (24-16-8-16-24) -> Decision Engine
 */

const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID =    "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// --- 1. HARDWARE ABSTRACTION LAYER (Sensoren) ---
class SensorManager {
    constructor() {
        this.acc = 0; this.gyro = 0; this.audio = 0;
        this.initMotion();
        this.initAudio();
    }

    initMotion() {
        if (window.DeviceMotionEvent) {
            window.addEventListener('devicemotion', e => {
                const a = e.accelerationIncludingGravity;
                const r = e.rotationRate;
                if(a) {
                    // Wir glätten die Werte (Low Pass Filter), um Rauschen zu entfernen
                    const totalA = Math.sqrt(a.x**2 + a.y**2 + a.z**2);
                    this.acc = (this.acc * 0.8) + (Math.abs(totalA - 9.8) * 0.2);
                }
                if(r) {
                    const totalR = Math.abs(r.alpha) + Math.abs(r.beta) + Math.abs(r.gamma);
                    this.gyro = (this.gyro * 0.8) + (totalR * 0.2);
                }
            });
        }
    }

    async initAudio() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const ctx = new AudioContext();
            const src = ctx.createMediaStreamSource(stream);
            const ana = ctx.createAnalyser(); ana.fftSize = 256;
            const sc = ctx.createScriptProcessor(2048, 1, 1);
            src.connect(ana); ana.connect(sc); sc.connect(ctx.destination);
            sc.onaudioprocess = () => {
                const data = new Uint8Array(ana.frequencyBinCount);
                ana.getByteFrequencyData(data);
                let sum = 0; for(let x of data) sum+=x;
                this.audio = sum / data.length; // 0-255
            };
        } catch(e) { console.warn("Audio nicht verfügbar"); }
    }

    // Liefert normalisierte Werte (0.0 - 1.0) für die KI
    getNormalized() {
        return {
            acc: Math.min(this.acc / 2.0, 1.0),      // 0-2G
            gyro: Math.min(this.gyro / 100.0, 1.0),  // 0-100 deg/s
            audio: Math.min(this.audio / 100.0, 1.0) // 0-100 Volume
        };
    }
}

// --- 2. THE BRAIN (Neural Network) ---
class NeuralEngine {
    constructor() {
        this.inputSize = 24; 
        this.model = this.buildModel();
        this.trainingQueue = [];
        this.isTraining = false;
        // Dynamische Toleranz
        this.baseLoss = 0.15; 
        this.lossHistory = [];
    }

    buildModel() {
        const m = tf.sequential();
        // Encoder
        m.add(tf.layers.dense({inputShape: [this.inputSize], units: 16, activation: 'relu'}));
        // Bottleneck (Komprimierung des Wissens)
        m.add(tf.layers.dense({units: 8, activation: 'relu'}));
        // Decoder
        m.add(tf.layers.dense({units: 16, activation: 'relu'}));
        // Output (Rekonstruktion)
        m.add(tf.layers.dense({units: this.inputSize, activation: 'sigmoid'}));
        
        m.compile({optimizer: tf.train.adam(0.005), loss: 'meanSquaredError'});
        return m;
    }

    async analyze(inputVector, contextFactors) {
        const tensor = tf.tensor2d([inputVector]);
        const output = this.model.predict(tensor);
        const lossTensor = tf.losses.meanSquaredError(tensor, output);
        const loss = (await lossTensor.data())[0];
        
        tensor.dispose(); output.dispose(); lossTensor.dispose();

        // Kontext-basierte Toleranz:
        // Wenn viel Bewegung/Lärm ist, darf der Loss höher sein.
        const dynamicLimit = this.baseLoss + (contextFactors.acc * 0.2) + (contextFactors.gyro * 0.1);

        // Auto-Training: Wenn alles sicher scheint, lerne dieses Muster
        if (loss < dynamicLimit * 1.2) {
            this.trainingQueue.push(inputVector);
        }
        if (this.trainingQueue.length > 50 && !this.isTraining) this.train();

        // Adaptierung der Basis-Toleranz (langsam)
        this.lossHistory.push(loss);
        if(this.lossHistory.length > 100) this.lossHistory.shift();
        this.baseLoss = (this.lossHistory.reduce((a,b)=>a+b,0) / this.lossHistory.length) + 0.05;

        return { loss, limit: dynamicLimit };
    }

    async train() {
        this.isTraining = true;
        const d = tf.tensor2d(this.trainingQueue);
        await this.model.fit(d, d, {epochs: 1, shuffle: true}); // Kurzes, stetiges Lernen
        d.dispose();
        this.trainingQueue = []; // Queue leeren
        this.isTraining = false;
    }

    async forceLearn(vectors) {
        if(!vectors.length) return;
        const d = tf.tensor2d(vectors);
        await this.model.fit(d, d, {epochs: 10, shuffle: true}); // Intensives Lernen
        d.dispose();
    }
}

// --- 3. OBJECT MANAGER (Verwaltet einzelne Geräte) ---
class TrackedObject {
    constructor(mac, neuralEngine) {
        this.mac = mac;
        this.engine = neuralEngine;
        this.rssiHistory = []; // Buffer
        this.lastSeen = Date.now();
        
        // Status
        this.isIgnored = false; // Fahrer-Filter
        this.ignoreCounter = 0; // Zähler für Auto-Ignore
        
        // Output Werte
        this.currentLoss = 0;
        this.currentLimit = 0;
        this.avgRssi = -100;
        this.lastInputVector = null;
    }

    async update(rssi, sensors, packetRate) {
        const now = Date.now();
        const timeDelta = Math.min((now - this.lastSeen) / 1000.0, 1.0); // 0.0 - 1.0 (Sekunden)
        this.lastSeen = now;

        // 1. GATEKEEPER (Fahrer Filter)
        // Wenn ein Gerät 20x in Folge extrem nah ist (-45dB), ist es der Fahrer/Tablet.
        if (rssi > -45) {
            this.ignoreCounter++;
            if (this.ignoreCounter > 20) this.isIgnored = true;
        } else {
            // Langsamer Abbau, falls man mal kurz nah war
            if (this.ignoreCounter > 0) this.ignoreCounter--;
        }

        if (this.isIgnored) return null; // Abbruch

        // 2. BUFFER MANAGEMENT
        this.rssiHistory.push(rssi);
        if (this.rssiHistory.length > 20) this.rssiHistory.shift();
        
        // Durchschnitt berechnen
        this.avgRssi = this.rssiHistory.reduce((a,b)=>a+b,0) / this.rssiHistory.length;

        // 3. KI ANALYSE (Nur wenn genug Daten da sind)
        if (this.rssiHistory.length === 20) {
            // Vektor bauen: 20x RSSI + Zeit + Acc + Gyro + Rate
            const inputVector = [
                ...this.rssiHistory.map(v => (v + 100) / 70), // 0-19: RSSI normiert
                timeDelta,      // 20: Wie alt?
                sensors.acc,    // 21: Vibration
                sensors.gyro,   // 22: Drehung
                Math.min(packetRate / 10, 1.0) // 23: Aktivität
                // Audio ist global, könnte man hier auch adden, aber Sensoren reichen für den Autoencoder meist
            ];

            this.lastInputVector = inputVector;
            const result = await this.engine.analyze(inputVector, sensors);
            this.currentLoss = result.loss;
            this.currentLimit = result.limit;
            
            return result;
        }
        return null;
    }
}

// --- 4. MAIN CONTROLLER (Die App) ---
class StaplerApp {
    constructor() {
        this.sensors = new SensorManager();
        this.brain = new NeuralEngine();
        this.objects = {}; // Map von MAC -> TrackedObject
        
        this.isConnected = false;
        this.lastPacket = 0;
        this.falseAlarms = []; // Speicher für Feedback

        // Loops starten
        setInterval(() => this.uiLoop(), 200);     // UI Update (5fps)
        setInterval(() => this.watchdog(), 1000);  // Verbindung prüfen
        
        // Charts initialisieren
        this.initCharts();
    }

    // --- BLUETOOTH HANDLING ---
    async startSystem() { await this.sensors.initAudio(); this.connect(); }
    
    async connect() {
        try {
            document.getElementById('offline-overlay').classList.add('hidden');
            if(typeof DeviceMotionEvent?.requestPermission === 'function') await DeviceMotionEvent.requestPermission();
            
            const device = await navigator.bluetooth.requestDevice({acceptAllDevices:true, optionalServices:[SERVICE_UUID]});
            device.addEventListener('gattserverdisconnected', () => this.disconnect());
            
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE_UUID);
            const char = await service.getCharacteristic(CHAR_UUID);
            
            await char.startNotifications();
            char.addEventListener('characteristicvaluechanged', e => this.handleData(e));
            
            this.isConnected = true;
            this.lastPacket = Date.now();
            this.uiSetState("ONLINE", "green");
            log("System Verbunden. Kalibrierung läuft...", "success");
            
        } catch(e) { log("Conn Error: " + e.message, "error"); this.disconnect(); }
    }

    disconnect() {
        this.isConnected = false;
        this.uiSetState("OFFLINE", "red");
        document.getElementById('offline-overlay').classList.remove('hidden');
    }

    watchdog() {
        if (this.isConnected && Date.now() - this.lastPacket > 3500) {
            log("Watchdog: Verbindung verloren!", "error");
            this.disconnect();
        }
    }

    handleData(event) {
        this.lastPacket = Date.now();
        try {
            const text = new TextDecoder().decode(event.target.value);
            const [mac, rssiStr] = text.split("|");
            const rssi = parseInt(rssiStr);
            if (isNaN(rssi)) return;

            // Objekt holen oder erstellen
            if (!this.objects[mac]) this.objects[mac] = new TrackedObject(mac, this.brain);
            
            // Daten verarbeiten
            // (Paketrate wird hier vereinfacht simuliert, besser wäre pro-Objekt Zähler)
            const sensors = this.sensors.getNormalized();
            this.objects[mac].update(rssi, sensors, 1); // Rate vorerst 1, da ESP pushed

        } catch(e) { console.error(e); }
    }

    // --- LOGIC & UI ---
    uiLoop() {
        if (!this.isConnected) return;

        const now = Date.now();
        let maxRisk = 0;
        let points = [];
        let currentAlarms = [];
        let bestObj = null, maxRssi = -999;

        // Durch alle Objekte iterieren
        for (const mac in this.objects) {
            const obj = this.objects[mac];
            
            // Cleanup: Alte Objekte löschen (>5s)
            if (now - obj.lastSeen > 5000) continue;

            // Ignorierte Objekte (Fahrer) überspringen
            if (obj.isIgnored) continue;

            // Für Telemetrie das stärkste Signal finden
            if (obj.avgRssi > maxRssi) { maxRssi = obj.avgRssi; bestObj = obj; }

            // --- ENTSCHEIDUNGS-LOGIK (The Judge) ---
            let risk = 0;
            
            // Regel 1: KI Anomalie
            if (obj.currentLoss > obj.currentLimit) {
                // Nur relevant, wenn in der Nähe
                if (obj.avgRssi > -75) risk = 2; // Gefahr
                else if (obj.avgRssi > -85) risk = 1; // Warnung
            }
            
            // Regel 2: Notbremse (Physik schlägt KI)
            if (obj.avgRssi > -50) risk = 2;

            if (risk === 2) currentAlarms.push(obj.lastInputVector);
            if (risk > maxRisk) maxRisk = risk;

            // Für Chart speichern
            points.push({x: obj.x, y: obj.avgRssi, r: (risk===2?25:risk===1?15:6), raw: risk});
        }

        // Alarme für Feedback speichern
        if (currentAlarms.length > 0) this.falseAlarms = currentAlarms;

        // UI Updates
        this.updateCharts(points, bestObj);
        this.updateTelemetry(bestObj);
        this.updateStatus(maxRisk);
    }

    updateStatus(risk) {
        const d = document.getElementById('status-display');
        const t = document.getElementById('main-status-text');
        d.className = "";
        
        if (risk === 2) {
            d.classList.add('status-danger'); t.innerText = "STOP!!";
            if (navigator.vibrate) navigator.vibrate(200);
        } else if (risk === 1) {
            d.classList.add('status-warn'); t.innerText = "ACHTUNG";
        } else {
            d.classList.add('status-safe'); t.innerText = "FREI";
        }
    }

    reportFalseAlarm() {
        if (this.falseAlarms.length === 0) return alert("Keine Daten zum Lernen.");
        this.brain.forceLearn(this.falseAlarms);
        this.falseAlarms = [];
        alert("KI wurde korrigiert und lernt diese Situation als 'SICHER'.");
    }

    // --- VISUALISIERUNG ---
    initCharts() {
        // (Code für Chart.js Setup - analog zu vorher, hier gekürzt für Übersicht)
        this.radar = new Chart(document.getElementById('radarChart').getContext('2d'), {
            type:'bubble', data:{datasets:[{data:[], backgroundColor:c=>this.col(c.raw)}]},
            options:{responsive:true, maintainAspectRatio:false, animation:false, scales:{y:{min:-100,max:-30,grid:{color:'#222'}}, x:{display:false}}, plugins:{legend:{display:false}}}
        });
        this.lossChart = new Chart(document.getElementById('lossChart').getContext('2d'), {
            type:'line', data:{labels:Array(50).fill(''), datasets:[{data:Array(50).fill(0), borderColor:'#00d2ff', borderWidth:1, fill:true, backgroundColor:'rgba(0,210,255,0.1)', pointRadius:0}]},
            options:{responsive:true, maintainAspectRatio:false, animation:false, scales:{y:{min:0,max:0.5,grid:{color:'#222'}}, x:{display:false}}, plugins:{legend:{display:false}}}
        });
    }
    
    updateCharts(points, bestObj) {
        this.radar.data.datasets[0].data = points;
        this.radar.update();
        if(bestObj) {
            this.lossChart.data.datasets[0].data.push(bestObj.currentLoss);
            this.lossChart.data.datasets[0].data.shift();
            this.lossChart.update();
        }
    }

    updateTelemetry(obj) {
        const s = this.sensors.getNormalized();
        document.getElementById('tel-acc').innerText = (s.acc*2).toFixed(2); // De-Norm
        document.getElementById('tel-gyro').innerText = (s.gyro*100).toFixed(0);
        
        if (obj) {
            document.getElementById('tel-mac').innerText = ".." + obj.mac.slice(-5);
            document.getElementById('tel-rssi').innerText = obj.avgRssi.toFixed(1);
            document.getElementById('tel-buf').innerText = obj.rssiHistory.length;
            document.getElementById('tel-loss').innerText = obj.currentLoss.toFixed(4);
            document.getElementById('tel-limit').innerText = obj.currentLimit.toFixed(4);
            document.getElementById('tel-status').innerText = obj.currentLoss > obj.currentLimit ? "ANOMALIE" : "OK";
        }
    }

    uiSetState(text, color) { /* Helfer für Button/LED Status */ }
    col(r) { return r===2?'rgba(255,0,85,0.9)':r===1?'rgba(255,170,0,0.8)':'rgba(0,255,0,0.6)'; }
}

const app = new StaplerApp();
 
