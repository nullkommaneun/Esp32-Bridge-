// --- KONFIGURATION ---
// Muss exakt mit deinem ESP32 übereinstimmen!
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID =    "beb5483e-36e1-4688-b7f5-ea07361b26a8";

class DeviceBrain {
    constructor(mac) {
        this.mac = mac;
        this.rssiBuffer = [];
        this.lastSeen = Date.now();
        this.trustScore = 0.5;
        this.velocity = 0;
        this.xPos = Math.random() * 100;
    }

    addMeasurement(rssi) {
        this.lastSeen = Date.now();
        this.rssiBuffer.push(rssi);
        if (this.rssiBuffer.length > 15) this.rssiBuffer.shift();
        this.calculateMetrics();
    }

    calculateMetrics() {
        if (this.rssiBuffer.length < 5) return;
        
        // Simple lineare Regression
        const n = this.rssiBuffer.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += this.rssiBuffer[i];
            sumXY += i * this.rssiBuffer[i];
            sumXX += i * i;
        }
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const avg = sumY / n;
        
        this.velocity = slope;
        
        // KI Logik
        if (slope > 0.8 || avg > -45) {
            this.trustScore = 0.0; // GEFAHR
        } else if (avg < -60 && Math.abs(slope) < 0.2) {
            this.trustScore += 0.05; // Vertrauen aufbauen
            if(this.trustScore > 1.0) this.trustScore = 1.0;
        }
    }
}

class StaplerApp {
    constructor() {
        this.devices = {};
        this.chart = this.initChart();
        this.isScanning = false;
        setInterval(() => this.updateUI(), 200);
        log("App initialisiert. Bereit zum Verbinden.");
    }

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

    // --- BLUETOOTH CORE (SIMPLIFIED) ---
    async connect() {
        try {
            log("Starte Bluetooth Suche (Alle Geräte)...");
            
            // 1. Suche OHNE Filter (zeigt alles an)
            // WICHTIG: optionalServices muss gesetzt sein, sonst können wir später nicht lesen!
            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [SERVICE_UUID] 
            });

            log(`Gerät gewählt: ${device.name} (ID: ${device.id})`);
            log("Verbinde mit GATT Server...");

            const server = await device.gatt.connect();
            log("GATT verbunden. Suche Service...");

            const service = await server.getPrimaryService(SERVICE_UUID);
            log("Service gefunden! Suche Characteristic...");

            const characteristic = await service.getCharacteristic(CHAR_UUID);
            log("Characteristic gefunden! Starte Notifications...");

            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', (e) => this.handleData(e));
            
            this.isScanning = true;
            document.getElementById('btn-connect').innerText = "VERBUNDEN";
            document.getElementById('btn-connect').style.borderColor = "#0f0";
            log("ERFOLG: Scanner läuft!", "success");

        } catch (e) {
            // Ausführliche Fehlermeldung für den Debugger
            log(`FEHLER BEIM VERBINDEN: ${e.message}`, "error");
            console.error(e);
            
            if(e.name === 'NotFoundError') {
                log("Tipp: Hast du das richtige Gerät in der Liste ausgewählt?");
                log("Tipp: Läuft der ESP32? Leuchtet er?");
            } else if (e.name === 'SecurityError') {
                log("Sicherheits-Fehler! Nutze Chrome und HTTPS (Github Pages).");
            }
        }
    }

    handleData(event) {
        try {
            const val = new TextDecoder().decode(event.target.value);
            // Wir erwarten: "MAC|RSSI"
            const parts = val.split("|");
            
            if(parts.length !== 2) {
                // Falls Datenmüll kommt, nicht crashen, nur loggen
                // log("Ignoriere fehlerhaftes Paket: " + val); 
                return;
            }

            const mac = parts[0];
            const rssi = parseInt(parts[1]);

            if (!this.devices[mac]) {
                this.devices[mac] = new DeviceBrain(mac);
                log(`Neues Signal: ${mac}`, "info");
            }
            
            this.devices[mac].addMeasurement(rssi);
        } catch(err) {
            log("Parsing Fehler: " + err.message, "error");
        }
    }

    updateUI() {
        if(!this.isScanning) return;

        const chartData = [];
        let maxRisk = 0; 
        let highestRssi = -100;
        let highestVelocity = 0;
        const now = Date.now();

        for (const mac in this.devices) {
            const dev = this.devices[mac];
            if (now - dev.lastSeen > 5000) continue;
            
            if (dev.rssiBuffer.length === 0) continue;
            const currentRssi = dev.rssiBuffer[dev.rssiBuffer.length-1];

            if (currentRssi > highestRssi) highestRssi = currentRssi;
            if (dev.velocity > highestVelocity) highestVelocity = dev.velocity;

            let risk = 0; 
            if (dev.trustScore < 0.2) risk = 1; 
            if (dev.trustScore < 0.1 && (dev.velocity > 0.8 || currentRssi > -50)) risk = 2; 

            if (risk > maxRisk) maxRisk = risk;

            chartData.push({
                x: dev.xPos,
                y: currentRssi,
                r: (risk === 2) ? 20 : 8,
                riskLevel: risk 
            });
        }

        this.chart.data.datasets[0].data = chartData;
        this.chart.update();

        document.getElementById('val-objects').innerText = chartData.length;
        document.getElementById('val-rssi').innerText = highestRssi;
        document.getElementById('val-velocity').innerText = highestVelocity.toFixed(2);

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
            reason.innerText = "Kollisionskurs erkannt!";
            if(navigator.vibrate) navigator.vibrate(200);
        } else if (riskLevel === 1) {
            display.classList.add('status-safe'); // Warnung ist auch "safe" genug für den Anfang
            display.style.borderColor = "orange";
            display.style.color = "orange";
            text.innerText = "ACHTUNG";
            reason.innerText = "Unbekanntes Objekt";
        } else {
            display.classList.add('status-safe');
            text.innerText = "FREI";
            reason.innerText = "Bereich sicher.";
        }
    }

    getColor(item) {
        if (item.riskLevel === 2) return 'rgba(255, 0, 85, 0.9)'; 
        if (item.riskLevel === 1) return 'rgba(255, 170, 0, 0.8)'; 
        return 'rgba(0, 255, 0, 0.6)'; 
    }
}
