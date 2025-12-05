const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID =    "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// --- AUDIO SENSOR ---
class AudioSensor {
    constructor() {
        this.volume = 0;
        this.isActive = false;
    }
    
    async start() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const audioContext = new AudioContext();
            const analyser = audioContext.createAnalyser();
            const microphone = audioContext.createMediaStreamSource(stream);
            const scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);

            analyser.smoothingTimeConstant = 0.8;
            analyser.fftSize = 1024;

            microphone.connect(analyser);
            analyser.connect(scriptProcessor);
            scriptProcessor.connect(audioContext.destination);

            scriptProcessor.onaudioprocess = () => {
                const array = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(array);
                let values = 0;
                const length = array.length;
                for (let i = 0; i < length; i++) values += array[i];
                // Durchschnittliche Lautstärke (0-100)
                this.volume = (values / length); 
                this.isActive = true;
            };
            log("🎤 Mikrofon aktiv. Höre auf Lärm.", "success");
        } catch(e) {
            log("Mikrofon Fehler: " + e.message, "error");
        }
    }
    
    getLevel() { return this.isActive ? this.volume : 0; }
}

// --- BEWEGUNG SENSOR ---
class MotionSensor {
    constructor() {
        this.acc = 0;
        this.gyro = 0;
        if (window.DeviceMotionEvent) {
            window.addEventListener('devicemotion', (e) => {
                const a = e.accelerationIncludingGravity;
                if(a) {
                    const total = Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z);
                    this.acc = (this.acc * 0.9) + (Math.abs(total - 9.8) * 0.1);
                }
                const r = e.rotationRate;
                if(r) {
                    const totalR = Math.abs(r.alpha) + Math.abs(r.beta) + Math.abs(r.gamma);
                    this.gyro = (this.gyro * 0.9) + (totalR * 0.1);
                }
            });
        }
    }
    getStats() { return { acc: this.acc, gyro: this.gyro }; }
}

// --- KI CORE ---
class AnomalyDetector {
    constructor(chartCallback) {
        // Input: 20 RSSI + Acc + Gyro + PacketRate + Audio = 24 Neuronen
        this.inputSize = 24; 
        this.windowSize = 20; 
        this.model = this.buildModel();
        this.trainingQueue = [];
        this.isTraining = false;
        
        // Start-Schwelle
        this.lossThreshold = 0.20; 
        this.lossHistory = [];
        this.chartCallback = chartCallback;
        
        log("🧠 Neural Core V4: 24-Input Layer Ready.", "success");
    }

    buildModel() {
        const model = tf.sequential();
        model.add(tf.layers.dense({inputShape: [this.inputSize], units: 16, activation: 'relu'}));
        model.add(tf.layers.dense({units: 8, activation: 'relu'})); // Bottleneck
        model.add(tf.layers.dense({units: 16, activation: 'relu'}));
        model.add(tf.layers.dense({units: this.inputSize, activation: 'sigmoid'}));
        model.compile({optimizer: tf.train.adam(0.01), loss: 'meanSquaredError'});
        return model;
    }

    preprocess(rssiArr, sensors, packetRate, audio) {
        const normRssi = rssiArr.map(v => (v + 100) / 70);
        const normAcc = Math.min(sensors.acc / 2.0, 1.0);
        const normGyro = Math.min(sensors.gyro / 100.0, 1.0);
        const normRate = Math.min(packetRate / 10.0, 1.0); // 10 Pakete/s = Max
        const normAudio = Math.min(audio / 100.0, 1.0);
        
        return [...normRssi, normAcc, normGyro, normRate, normAudio];
    }

    async detect(rssiSequence, sensors, packetRate, audio) {
        if (rssiSequence.length < this.windowSize) return { loss: 0, limit: 0 };

        const inputVector = this.preprocess(rssiSequence, sensors, packetRate, audio);
        const tensorData = tf.tensor2d([inputVector]);
        const output = this.model.predict(tensorData);
        const lossTensor = tf.losses.meanSquaredError(tensorData, output);
        const loss = (await lossTensor.data())[0];

        tensorData.dispose(); output.dispose(); lossTensor.dispose();

        // --- SCHWELLENWERT LOGIK ---
        // Wenn es laut ist, oder wir uns bewegen, sind wir toleranter
        const noiseTol = audio * 0.002; 
        const motionTol = (sensors.acc * 0.2) + (sensors.gyro * 0.004);
        
        this.updateBaseThreshold(loss);
        const effectiveLimit = this.lossThreshold + motionTol + noiseTol;

        // Auto-Lernen (nur wenn Loss einigermaßen okay ist)
        if (loss < effectiveLimit * 1.5) {
            this.trainingQueue.push(inputVector);
        }
        
        if (this.trainingQueue.length > 40 && !this.isTraining) this.train();

        return { loss, limit: effectiveLimit, vector: inputVector };
    }

    updateBaseThreshold(currentLoss) {
        this.lossHistory.push(currentLoss);
        if(this.lossHistory.length > 50) this.lossHistory.shift();
        const avg = this.lossHistory.reduce((a,b)=>a+b,0) / this.lossHistory.length;
        this.lossThreshold = avg + 0.08; 
    }

    async train() {
        this.isTraining = true;
        const data = tf.tensor2d(this.trainingQueue);
        const h = await this.model.fit(data, data, {epochs: 2, shuffle: true}); // Schnell lernen
        if(this.chartCallback) this.chartCallback(h.history.loss[0]);
        data.dispose();
        this.trainingQueue = [];
        this.isTraining = false;
    }

    // MANUELLES TRAINING (Feedback Button)
    async forceLearn(vectors) {
        if(vectors.length === 0) return;
        log(`🎓 Lerne ${vectors.length} Fehlalarme als 'NORMAL'...`, "learning");
        
        // Wir trainieren das Modell explizit darauf, diese Vektoren zu mögen
        const data = tf.tensor2d(vectors);
        // Mehr Epochen für erzwungenes Lernen
        await this.model.fit(data, data, {epochs: 10, shuffle: true}); 
        data.dispose();
        log("✅ Korrektur abgeschlossen.", "success");
    }
}

// --- GERÄTE ---
class DeviceBrain {
    constructor(mac, aiRef) {
        this.mac = mac;
        this.ai = aiRef;
        this.rssiBuffer = [];
        this.lastSeen = Date.now();
        this.avgRssi = -100;
        this.currentLoss = 0;
        this.currentLimit = 0.25;
        this.xPos = Math.random() * 100;
        
        // Paket Rate Berechnung
        this.packetsInLastSec = 0;
        this.lastRateCheck = Date.now();
        this.packetRate = 0;
        
        // Letzter Vektor für Feedback
        this.lastInputVector = null;
    }

    async addMeasurement(rssi, sensors, audioLevel) {
        const now = Date.now();
        this.lastSeen = now;
        
        // Rate berechnen
        this.packetsInLastSec++;
        if(now - this.lastRateCheck > 1000) {
            this.packetRate = this.packetsInLastSec;
            this.packetsInLastSec = 0;
            this.lastRateCheck = now;
        }

        this.rssiBuffer.push(rssi);
        if (this.rssiBuffer.length > 20) this.rssiBuffer.shift();

        this.avgRssi = this.rssiBuffer.reduce((a,b)=>a+b,0) / this.rssiBuffer.length;

        if (this.rssiBuffer.length === 20) {
            const res = await this.ai.detect(this.rssiBuffer, sensors, this.packetRate, audioLevel);
            this.currentLoss = res.loss;
            this.currentLimit = res.limit;
            this.lastInputVector = res.vector;
        }
    }
}

// --- APP ---
class StaplerApp {
    constructor() {
        this.devices = {};
        this.motion = new MotionSensor();
        this.audio = new AudioSensor();
        
        this.lossChartData = Array(50).fill(0);
        this.lossChart = this.initLossChart();
        this.radarChart = this.initRadarChart();

        this.ai = new AnomalyDetector((l) => this.updateLossChart(l));
        
        this.isConnected = false;
        this.lastPacketTime = 0;
        
        // Feedback Speicher
        this.recentAlarms = []; // Speichert Daten für den "False Alarm" Button

        setInterval(() => this.updateUI(), 200);
        setInterval(() => this.runWatchdog(), 1000);
        setInterval(() => this.runAIInspector(), 2000);
    }

    initRadarChart() {
        const ctx = document.getElementById('radarChart').getContext('2d');
        return new Chart(ctx, {
            type: 'bubble',
            data: { datasets: [{ label: 'AI', data: [], backgroundColor: c => this.getColor(c.raw), borderColor: 'transparent' }] },
            options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { min: -100, max: -30, grid: { color: '#222' } }, x: { display: false } }, plugins: { legend: { display: false } } }
        });
    }

    initLossChart() {
        const ctx = document.getElementById('lossChart').getContext('2d');
        return new Chart(ctx, {
            type: 'line',
            data: { labels: Array(50).fill(''), datasets: [{ label: 'Loss', data: this.lossChartData, borderColor: '#00d2ff', borderWidth: 1, pointRadius: 0, fill: true, backgroundColor: 'rgba(0, 210, 255, 0.1)' }] },
            options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { min: 0, max: 0.5, grid: { color: '#222' }, ticks: { display: false } }, x: { display: false } }, plugins: { legend: { display: false } } }
        });
    }

    updateLossChart(val) {
        this.lossChartData.push(val);
        this.lossChartData.shift();
        this.lossChart.update();
    }

    async startSystem() {
        // Audio Starten (braucht User Geste)
        await this.audio.start();
        this.connect();
    }

    async connect() {
        try {
            document.getElementById('offline-overlay').classList.add('hidden');
            
            // Motion Permission iOS
            if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
                await DeviceMotionEvent.requestPermission();
            }

            const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SERVICE_UUID] });
            device.addEventListener('gattserverdisconnected', () => this.onDisconnect());
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE_UUID);
            const characteristic = await service.getCharacteristic(CHAR_UUID);
            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', (e) => this.handleData(e));
            
            this.isConnected = true;
            this.lastPacketTime = Date.now(); 
            document.getElementById('connection-dot').className = "dot-green";
            const btn = document.getElementById('header-btn');
            btn.innerText = "AKTIV"; btn.style.color = "#00c853"; btn.style.borderColor = "#00c853";
            
            log("✅ SYSTEM VOLL ONLINE", "success");
        } catch (e) { log(`Error: ${e.message}`, "error"); this.onDisconnect(); }
    }

    reconnect() { this.connect(); }
    onDisconnect() {
        this.isConnected = false;
        document.getElementById('connection-dot').className = "dot-red";
        document.getElementById('status-display').className = "";
        document.getElementById('main-status-text').innerText = "OFFLINE";
        document.getElementById('offline-overlay').classList.remove('hidden');
    }
    runWatchdog() {
        if (!this.isConnected) return;
        if (Date.now() - this.lastPacketTime > 3500) this.onDisconnect();
    }

    handleData(event) {
        this.lastPacketTime = Date.now();
        try {
            const val = new TextDecoder().decode(event.target.value);
            const [mac, rssiStr] = val.split("|");
            const rssi = parseInt(rssiStr);
            if(isNaN(rssi)) return;

            const sensors = this.motion.getStats();
            const audio = this.audio.getLevel();

            if (!this.devices[mac]) this.devices[mac] = new DeviceBrain(mac, this.ai);
            this.devices[mac].addMeasurement(rssi, sensors, audio);
        } catch(e) {}
    }

    updateUI() {
        if(!this.isConnected || !this.radarChart) return;

        const chartData = [];
        let maxRisk = 0; 
        const now = Date.now();
        
        // Sammle potentielle Fehlalarme (Geräte mit Risk 2)
        const currentAlarmVectors = [];

        for (const mac in this.devices) {
            const dev = this.devices[mac];
            if (now - dev.lastSeen > 5000) continue;

            let risk = 0;
            if (dev.currentLoss > dev.currentLimit) {
                if(dev.avgRssi > -75) risk = 2; // Anomalie + Nah
                else if(dev.avgRssi > -85) risk = 1;
            }
            if (dev.avgRssi > -45) risk = 2; // Notbremse

            if (risk === 2 && dev.lastInputVector) {
                currentAlarmVectors.push(dev.lastInputVector);
            }

            if (risk > maxRisk) maxRisk = risk;
            chartData.push({ x: dev.xPos, y: dev.avgRssi, r: (risk===2)?25:(risk===1?15:6), riskLevel: risk });
        }

        // Speichern für den Button
        if (currentAlarmVectors.length > 0) {
            this.recentAlarms = currentAlarmVectors;
        }

        this.radarChart.data.datasets[0].data = chartData;
        this.radarChart.update();

        // UI Stats
        const s = this.motion.getStats();
        const a = this.audio.getLevel();
        document.getElementById('val-objects').innerText = chartData.length;
        document.getElementById('val-motion').innerText = s.acc.toFixed(1) + " G";
        document.getElementById('val-audio').innerText = a.toFixed(0) + " %";

        this.setStatus(maxRisk);
    }

    setStatus(risk) {
        const d = document.getElementById('status-display');
        const t = document.getElementById('main-status-text');
        const r = document.getElementById('ai-reason');
        d.className = "";
        
        if (risk === 2) {
            d.classList.add('status-danger');
            t.innerText = "GEFAHR";
            r.innerText = "Kollisionskurs!";
            if(navigator.vibrate) navigator.vibrate(200);
        } else if (risk === 1) {
            d.classList.add('status-warn');
            t.innerText = "ACHTUNG";
            r.innerText = "Umfeld beobachten";
        } else {
            d.classList.add('status-safe');
            t.innerText = "FREI";
            r.innerText = "Bereich sicher";
        }
    }

    reportFalseAlarm() {
        if (this.recentAlarms.length === 0) {
            alert("Keine Alarme zum Korrigieren.");
            return;
        }
        // KI zwingen zu lernen
        this.ai.forceLearn(this.recentAlarms);
        this.recentAlarms = []; // Reset
        
        const btn = document.getElementById('btn-false-alarm');
        const originalText = btn.innerText;
        btn.innerText = "✅ KI HAT GELERNT!";
        btn.style.borderColor = "#0f0";
        btn.style.color = "#0f0";
        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.borderColor = "#444";
            btn.style.color = "#888";
        }, 2000);
    }

    getColor(item) {
        if (!item) return 'rgba(0,0,0,0)';
        if (item.riskLevel === 2) return 'rgba(255, 0, 85, 0.9)'; 
        if (item.riskLevel === 1) return 'rgba(255, 170, 0, 0.8)'; 
        return 'rgba(0, 255, 0, 0.6)'; 
    }
    
    runAIInspector() {
        // Minimalistischer Heartbeat im Log
        if(this.isConnected) {
            // log("System Heartbeat... Loss: " + this.ai.lossThreshold.toFixed(3), "info");
        }
    }
}
