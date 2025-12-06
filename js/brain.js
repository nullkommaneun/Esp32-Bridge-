// Wir nutzen TensorFlow.js global (wird via CDN in index.html geladen)

export class NeuralBrain {
    constructor() {
        this.historySize = 50; // 50 Frames = 1 Sekunde (für LSTM)
        this.inputBuffer = []; // Puffert die letzten 50 Vektoren
        this.model = null;
        this.isReady = false;
        
        this.initDummyModel();
    }

    async initDummyModel() {
        // Hier würden wir später model.load('model.json') machen
        console.log("🧠 Brain: Initialisiert (Untrained Mode)");
        this.isReady = true;
    }

    // Hauptfunktion: Nimmt Live-Vektor -> Gibt Sicherheit [0..1] aus
    process(inputVector) {
        if (!this.isReady) return { safe:0, warn:0, danger:0 };

        // 1. Feature Extraction (Flatten Input)
        const features = [
            inputVector.groupA.accSurge, inputVector.groupA.accSway, inputVector.groupA.accHeave, inputVector.groupA.gyroYaw, inputVector.groupA.kineticEnergy,
            inputVector.groupB.proximity, inputVector.groupB.stability, inputVector.groupB.density, inputVector.groupB.snr,
            inputVector.groupC.proximity, inputVector.groupC.velocity, inputVector.groupC.count, inputVector.groupC.spread,
            inputVector.groupD.ratio, inputVector.groupD.ageGap, inputVector.groupD.latency
        ];

        // 2. Sliding Window Buffer füllen (FIFO)
        this.inputBuffer.push(features);
        if (this.inputBuffer.length > this.historySize) {
            this.inputBuffer.shift(); // Ältestes Element raus
        }

        // 3. Wenn Puffer voll -> Vorhersage (Inference)
        if (this.inputBuffer.length === this.historySize) {
            return this.runInference();
        }

        return { safe: 1.0, warn: 0.0, danger: 0.0 }; // Noch nicht genug Daten
    }

    runInference() {
        // --- HIER KOMMT SPÄTER DEIN TENSORFLOW CODE REIN ---
        // const inputTensor = tf.tensor3d([this.inputBuffer]); // Shape: [1, 50, 16]
        // const prediction = this.model.predict(inputTensor);
        
        // MOMENTAN: Dummy Logik basierend auf Heuristik (zum Testen der GUI)
        // Einfache Regel: Wenn Kinetik hoch ODER BLE sehr nah -> WARNUNG
        const latest = this.inputBuffer[this.inputBuffer.length-1];
        const kinetic = latest[4]; // N5
        const bleProx = latest[9]; // N10

        let pDanger = 0;
        let pWarn = 0;
        let pSafe = 1;

        if (bleProx > -50) { pWarn = 0.8; pSafe = 0.2; } // Nah dran
        if (kinetic > 2.0) { pDanger = 0.9; pSafe = 0.1; pWarn = 0; } // Crash/Schlag

        return { safe: pSafe, warn: pWarn, danger: pDanger };
    }
}
