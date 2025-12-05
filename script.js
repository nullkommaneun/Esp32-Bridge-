// --- KONFIGURATION ---
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
        
        // Nenner darf nicht 0 sein (Division by Zero verhindern)
        const denominator = (n * sumXX - sumX * sumX);
        if (denominator === 0) return;

        const slope = (n * sumXY - sumX * sumY) / denominator;
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
        // Init Devices Map
        this.devices = {};
        this.isScanning = false;
        
        // Chart initialisieren (mit Error Handling)
        try {
            this.chart = this.initChart();
        } catch (e) {
            console.error("Chart Fehler:", e);
            log("Chart konnte nicht laden: " + e.message, "error");
        }

        // Loop starten
        setInterval(() => this.updateUI(), 200);
        
        log("App initialisiert. Bereit zum Verbinden.", "success");
    }

    initChart() {
        const ctx = document.getElementById('radarChart').getContext('2d');
        return new Chart(ctx, {
            type: 'bubble',
            data: { datasets: [{ 
                label: 'Radar', 
                data: [], 
                // HIER WAR DER FEHLER: Wir prüfen jetzt, ob 'raw' existiert
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

    async connect() {
        try {
            log("Starte Bluetooth Suche (Alle Geräte)...");
            
            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [SERVICE_UUID] 
            });

            log(`Gerät gewählt: ${device.name} (ID: ${device.id})`);
            log("Verbinde mit GATT Server...");

            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE_UUID);
            const characteristic = await service.getCharacteristic(CHAR_UUID);

            log("Verbindung steht! Starte Datenstrom...", "success");

            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', (e) => this.handleData(e));
            
            this.isScanning = true;
            document.getElementById('btn-connect').innerText = "VERBUNDEN";
            document.getElementById('btn-connect').style.borderColor = "#0f0";
            document.getElementById('btn-connect').style.color = "#0f0";

        } catch (e) {
            log(`FEHLER: ${e.message}`, "error");
            console.error(e);
        }
    }

    handleData(event) {
        try {
            const val = new TextDecoder().decode(event.target.value);
            const parts = val.split("|");
            
            if(parts.length !== 2) return;

            const mac = parts[0];
            const rssi = parseInt(parts[1]);

            if(isNaN(rssi)) return; // Schutz vor kaputten Daten

            if (!this.devices[mac]) {
                this.devices[mac] = new DeviceBrain(mac);
                log(`Neues Signal: ${mac}`, "info");
            }
            
            this.devices[mac].addMeasurement(rssi);
        } catch(err) {
            // Parsing Fehler ignorieren
        }
    }

    updateUI() {
        if(!this.isScanning || !this.chart) return;

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
            display.classList.add('status-safe'); 
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

    // --- HIER WAR DER FIX NÖTIG ---
    getColor(item) {
        // Sicherheits-Check: Wenn 'item' null/undefined ist, gib Transparent zurück
        if (!item || item.riskLevel === undefined) return 'rgba(0,0,0,0)'; 

        if (item.riskLevel === 2) return 'rgba(255, 0, 85, 0.9)'; 
        if (item.riskLevel === 1) return 'rgba(255, 170, 0, 0.8)'; 
        return 'rgba(0, 255, 0, 0.6)'; 
    }
}
