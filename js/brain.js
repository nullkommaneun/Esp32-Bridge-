export class NeuralBrain {
    constructor() {
        this.model = null;
        this.isTraining = false;
        this.historySize = 50; // Wir schauen 1 Sekunde zurück (50 frames @ 20ms)
        this.futureSteps = 5;  // Wir schauen 100ms in die Zukunft
        
        // Puffer für die Live-Daten
        this.inputBuffer = []; 
        
        // Grenzwerte (werden beim Lernen verfeinert)
        this.thresholds = {
            proximity: -40, // Ab hier wird's eng (dBm)
            kinetic: 3.0    // Ab hier ist es ein Crash
        };
    }

    // Erstellt das neuronale Netz (LSTM Architektur)
    createModel(inputShape) {
        const model = tf.sequential();
        
        // LSTM Layer: Versteht Zeitreihen und Zusammenhänge
        model.add(tf.layers.lstm({
            units: 32, // Anzahl der "Gedankenstränge"
            inputShape: inputShape, // [50, 16]
            returnSequences: false
        }));
        
        // Dense Layer: Die Entscheidungsschicht
        // Wir sagen vorher: [Proximity_Future, Kinetic_Future]
        model.add(tf.layers.dense({ units: 2, activation: 'linear' }));

        model.compile({
            optimizer: tf.train.adam(0.01),
            loss: 'meanSquaredError'
        });

        return model;
    }

    // --- TRAINING (Lernen aus CSV Daten) ---
    async train(recordedData) {
        if (recordedData.length < this.historySize + this.futureSteps) {
            console.warn("Zu wenig Daten!");
            return false;
        }

        console.log("🧠 Starte LSTM Training...");
        this.isTraining = true;

        // 1. Daten vorbereiten (Sliding Window)
        // Input (X): 50 Schritte Vergangenheit
        // Output (Y): Der Wert in der Zukunft (Prediction Target)
        const inputs = [];
        const targets = [];

        // Wir nutzen nur relevante Features für die Vorhersage, um Rechenleistung zu sparen
        // Wir nehmen den ganzen Vektor (16 Features) als Input
        // Aber wir versuchen nur Proximity (Gefahr) und Kinetik (Crash) vorherzusagen.

        for (let i = 0; i < recordedData.length - this.historySize - this.futureSteps; i++) {
            // X: Das Fenster [i ... i+50]
            const window = recordedData.slice(i, i + this.historySize);
            inputs.push(window);

            // Y: Der Wert in der Zukunft [i+55]
            // Wir nehmen den MAXIMALEN Wert der nächsten Schritte (Worst Case Prediction)
            let maxProx = -120;
            let maxKin = 0;
            for(let j=1; j<=this.futureSteps; j++) {
                const futureFrame = recordedData[i + this.historySize + j];
                // Feature Indizes: 9=Prox(C), 14=Kinetic(A) -> Müssen wir mappen
                // Wir nutzen die Hilfsfunktion flattenInput, daher wissen wir die Positionen:
                // Prox(C) ist Index 9. Kinetic(A) ist Index 4.
                if(futureFrame[9] > maxProx) maxProx = futureFrame[9];
                if(futureFrame[4] > maxKin) maxKin = futureFrame[4];
            }
            targets.push([maxProx, maxKin]);
        }

        // In Tensoren umwandeln
        const xs = tf.tensor3d(inputs); // Shape [Batch, 50, 16]
        const ys = tf.tensor2d(targets); // Shape [Batch, 2]

        // Modell bauen (falls noch nicht da)
        if (!this.model) {
            this.model = this.createModel([this.historySize, 16]);
        }

        // Trainieren (Im Browser!)
        // epochs: Wie oft er die Daten durchgeht
        await this.model.fit(xs, ys, {
            epochs: 5, 
            batchSize: 32,
            shuffle: true,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    console.log(`Epoch ${epoch+1}: Loss = ${logs.loss.toFixed(4)}`);
                }
            }
        });

        // Aufräumen
        xs.dispose();
        ys.dispose();
        
        this.isTraining = false;
        console.log("🧠 Training abgeschlossen. Modell ist scharf.");
        return true;
    }

    // --- LIVE PREDICTION (Vorhersage) ---
    process(inputObj) {
        if (this.isTraining || !this.model) return { safe:0, warn:0, danger:0 };

        // 1. Vektor formatieren
        const vector = this.flattenInput(inputObj);
        
        // 2. In Puffer schieben
        this.inputBuffer.push(vector);
        if (this.inputBuffer.length > this.historySize) {
            this.inputBuffer.shift(); // Ältestes raus
        }

        // Erst vorhersagen, wenn wir genug Geschichte haben (50 Frames)
        if (this.inputBuffer.length === this.historySize) {
            return this.runInference();
        }

        return { safe: 1, warn: 0, danger: 0, status: "Buffering..." };
    }

    runInference() {
        // Tensor aus dem Puffer erstellen
        // tf.tidy räumt Speicher automatisch auf (wichtig im Browser!)
        const prediction = tf.tidy(() => {
            const inputTensor = tf.tensor3d([this.inputBuffer]); // Shape [1, 50, 16]
            const result = this.model.predict(inputTensor); // Output [1, 2]
            return result.dataSync(); // Array [Pred_Prox, Pred_Kinetic]
        });

        const predProx = prediction[0];
        const predKin = prediction[1];

        // LOGIK: WAHRSCHEINLICHKEIT BERECHNEN
        // Wir vergleichen die VORHERSAGE mit den Grenzwerten.
        
        let pSafe = 1.0;
        let pWarn = 0.0;
        let pDanger = 0.0;
        let status = "OK";

        // Fall 1: KI sagt Crash voraus (Hohe Kinetik)
        if (predKin > 2.0) {
            pDanger = 1.0; pSafe = 0.0;
            status = "PRED: IMPACT!";
        }
        // Fall 2: KI sagt Annäherung voraus (Hohes Proximity)
        else if (predProx > -50) { // Wenn wir näher als -50dBm kommen
            // Skaliere Warnung je nach Nähe
            pWarn = Math.min((predProx + 50) / 20, 1.0); // 0.0 bis 1.0
            pSafe = 1.0 - pWarn;
            status = `PRED: Proximity (${predProx.toFixed(1)})`;
            if (predProx > -30) { pDanger = 1.0; pWarn = 0; pSafe=0; status="PRED: COLLISION"; }
        }

        // Anomaly Check (Optional): Weicht die Vorhersage stark von der Realität ab?
        // Das wäre "Unsupervised", aber wir verlassen uns hier auf die trainierte Vorhersage.

        return { safe: pSafe, warn: pWarn, danger: pDanger, status: status };
    }

    flattenInput(input) {
        // MUSS exakt die gleiche Reihenfolge haben wie im Recorder!
        return [
            input.groupA.accSurge || 0, input.groupA.accSway || 0, input.groupA.accHeave || 0, 
            input.groupA.gyroYaw || 0, input.groupA.kineticEnergy || 0, // Index 4 = Kinetic
            input.groupB.proximity || -100, input.groupB.stability || 0, input.groupB.density || 0, input.groupB.snr || -100,
            input.groupC.proximity || -100, input.groupC.velocity || 0, input.groupC.count || 0, input.groupC.spread || 0, // Index 9 = C.Prox
            input.groupD.ratio || 0, input.groupD.ageGap || 0, input.groupD.latency || 0
        ];
    }
}
