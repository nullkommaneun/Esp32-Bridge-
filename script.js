// --- KONFIGURATION ---
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

/**
 * KLASSE: DeviceBrain
 * Repräsentiert ein einzelnes Gerät (Handy/Router) und seine KI-Analyse
 */
class DeviceBrain {
    constructor(mac) {
        this.mac = mac;
        this.rssiBuffer = []; // Speichert die letzten Werte
        this.maxBufferSize = 15; 
        this.lastSeen = Date.now();
        this.trustScore = 0.5; // 0 = Gefahr, 1 = Vertrauen
        this.prediction = 0; // Was denkt die KI, wo das Signal gleich ist?
        this.velocity = 0;   // Berechnete Geschwindigkeit
    }

    addMeasurement(rssi) {
        this.lastSeen = Date.now();
        this.rssiBuffer.push(rssi);
        if (this.rssiBuffer.length > this.maxBufferSize) this.rssiBuffer.shift();
        
        // KI Berechnung anstoßen
        this.calculateMetrics();
    }

    // Hier nutzen wir TensorFlow Logic (simuliert durch native Math für Performance, 
    // kann auf tf.tensor umgestellt werden bei komplexeren Modellen)
    calculateMetrics() {
        if (this.rssiBuffer.length < 5) return;

        // 1. Lineare Regression (Trendberechnung)
        // Wir suchen die Steigung (Slope) der Kurve.
        // Steigung > 0 bedeutet: Signal wird stärker (kommt näher)
        const n = this.rssiBuffer.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        
        // Wir mappen die Zeit auf x (0, 1, 2...) und RSSI auf y
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += this.rssiBuffer[i];
            sumXY += i * this.rssiBuffer[i];
            sumXX += i * i;
        }

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        this.velocity = slope; // dB pro Zeiteinheit

        // 2. Varianz (Rauschen) berechnen
        const avg = sumY / n;
        const variance = this.rssiBuffer.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / n;

        // 3. KI Entscheidung (Rule-based based on features)
        this.updateTrust(avg, slope, variance);
    }

    updateTrust(avgRssi, slope, variance) {
        // Logik:
        // - Hohe Varianz (> 10) = Bewegt sich (Mensch/Handy)
        // - Niedrige Varianz (< 2) = Statisch (Router)
        // - Hoher Slope (> 0.5) = Schnelle Annäherung
        
        // Infrastruktur lernen
        if (variance < 3.0 && avgRssi < -50) {
            this.trustScore = Math.min(this.trustScore + 0.05, 1.0); // Vertrauen steigt langsam
        }

        // Akute Gefahr erkennen
        if (slope > 1.0 || avgRssi > -45) {
            this.trustScore = 0.0; // Vertrauen sofort weg
        }
    }
}

/**
 * KLASSE: StaplerApp
 * Verwaltet die UI, Bluetooth Verbindung und alle DeviceBrains
 */
class StaplerApp {
    constructor() {
        this.devices = {}; // Map von MAC -> DeviceBrain
        this.chart = this.initChart();
        this.isScanning = false;
        
        // Loop für UI Updates starten (entkoppelt vom Datenempfang)
        setInterval(() => this.updateUI(), 200);
    }

    // --- CHART JS SETUP ---
    initChart() {
        const ctx = document.getElementById('radarChart').getContext('2d');
        return new Chart(ctx, {
            type: 'bubble',
            data: { datasets: [{ 
                label: 'Radar', data: [], 
                backgroundColor: ctx => this.getColor(ctx.raw),
                borderColor: 'transparent' 
            }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    y: { min: -100, max: -30, grid: { color: '#333' } },
                    x: { display: false, min: 0, max: 100 }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // --- BLUETOOTH ---
    async connect() {
        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [SERVICE_UUID] }]
            });
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE_UUID);
            const characteristic = await service.getCharacteristic(CHAR_UUID);
            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', (e) => this.handleData(e));
            
            this.isScanning = true;
            document.getElementById('btn-connect').innerText = "SYSTEM AKTIV";
            document.getElementById('btn-connect').style.borderColor = "#00c853";
            document.getElementById('btn-connect').style.color = "#00c853";
        } catch (e) {
            console.error(e);
            alert("Verbindung fehlgeschlagen: " + e);
        }
    }

    handleData(event) {
        const val = new TextDecoder().decode(event.target.value);
        const [mac, rssiStr] = val.split("|");
        const rssi = parseInt(rssiStr);

        if (!this.devices[mac]) {
            this.devices[mac] = new DeviceBrain(mac);
            // Zufalls X-Position generieren für Chart
            this.devices[mac].xPos = Math.random() * 100;
        }
        
        this.devices[mac].addMeasurement(rssi);
    }

    // --- UI LOGIK ---
    updateUI() {
        if(!this.isScanning) return;

        const chartData = [];
        let maxRisk = 0; // 0 = Safe, 1 = Warn, 2 = Danger
        let highestRssi = -100;
        let highestVelocity = 0;
        let objectCount = 0;
        const now = Date.now();

        // Alle Geräte durchgehen
        for (const mac in this.devices) {
            const dev = this.devices[mac];

            // Timeout: Wer 5 sek nichts sendet, wird ignoriert
            if (now - dev.lastSeen > 5000) continue;
            
            objectCount++;
            if (dev.rssiBuffer.length === 0) continue;
            const currentRssi = dev.rssiBuffer[dev.rssiBuffer.length-1];

            // Globale Stats updaten
            if (currentRssi > highestRssi) highestRssi = currentRssi;
            if (dev.velocity > highestVelocity) highestVelocity = dev.velocity;

            // Gefahr bewerten
            let risk = 0; // Safe
            if (dev.trustScore < 0.2) risk = 1; // Unbekannt
            if (dev.trustScore < 0.1 && (dev.velocity > 0.8 || currentRssi > -50)) risk = 2; // Danger!

            if (risk > maxRisk) maxRisk = risk;

            // Chart Daten
            chartData.push({
                x: dev.xPos,
                y: currentRssi,
                r: (risk === 2) ? 20 : (risk === 1 ? 10 : 5), // Radius
                riskLevel: risk 
            });
        }

        // Chart Update
        this.chart.data.datasets[0].data = chartData;
        this.chart.update();

        // Dashboard Werte Update
        document.getElementById('val-objects').innerText = objectCount;
        document.getElementById('val-rssi').innerText = highestRssi + " dB";
        document.getElementById('val-velocity').innerText = highestVelocity.toFixed(2);

        // Ampel Logik
        this.setMainStatus(maxRisk, highestRssi, highestVelocity);
    }

    setMainStatus(riskLevel, rssi, velocity) {
        const display = document.getElementById('status-display');
        const text = document.getElementById('main-status-text');
        const reason = document.getElementById('ai-reason');

        // Reset Classes
        display.className = "";

        if (riskLevel === 2) {
            display.classList.add('status-danger');
            text.innerText = "STOP!!";
            reason.innerText = `Kollisionskurs! (Speed: ${velocity.toFixed(1)})`;
            if(navigator.vibrate) navigator.vibrate(200);
        } else if (riskLevel === 1) {
            display.classList.add('status-warn');
            text.innerText = "ACHTUNG";
            reason.innerText = "Unbekanntes Objekt nah";
        } else {
            display.classList.add('status-safe');
            text.innerText = "FREI";
            reason.innerText = "Scan läuft. Umgebung bekannt.";
        }
    }

    getColor(item) {
        if (item.riskLevel === 2) return 'rgba(255, 23, 68, 0.9)'; // Rot
        if (item.riskLevel === 1) return 'rgba(255, 171, 0, 0.8)'; // Orange
        return 'rgba(0, 200, 83, 0.6)'; // Grün
    }
}
