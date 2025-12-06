export class NeuralBrain {
    constructor() {
        this.model = null;
        this.isTraining = false;
        this.historySize = 50; 
        this.futureSteps = 5;  
        this.inputBuffer = []; 
        
        // Speicher für Min/Max Werte zur Normalisierung
        this.normalization = {
            min: new Array(16).fill(0),
            max: new Array(16).fill(1)
        };
    }

    // --- TRAINING ---
    async train(recordedData) {
        if (typeof tf === 'undefined') {
            console.error("TensorFlow nicht geladen!");
            return false;
        }

        if (recordedData.length < this.historySize + this.futureSteps + 10) {
            console.warn("Zu wenig Daten!");
            return false;
        }

        this.isTraining = true;
        console.log("Brain: Analysiere Datenbereich (Min/Max)...");

        // 1. Min/Max berechnen für Normalisierung
        this.calculateMinMax(recordedData);

        // 2. Daten normalisieren (alles auf 0.0 bis 1.0 bringen)
        const normalizedData = recordedData.map(row => this.normalizeVector(row));

        const inputs = [];
        const targets = [];

        console.log("Brain: Erstelle Tensoren...");

        // Sliding Window
        for (let i = 0; i < normalizedData.length - this.historySize - this.futureSteps; i++) {
            const window = normalizedData.slice(i, i + this.historySize);
            inputs.push(window);

            // Prediction Targets (Normalized!)
            // Index 9 = Proximity (C), Index 4 = Kinetic (A)
            let maxProx = 0;
            let maxKin = 0;
            for(let j=1; j<=this.futureSteps; j++) {
                const futureFrame = normalizedData[i + this.historySize + j];
                if(futureFrame[9] > maxProx) maxProx = futureFrame[9];
                if(futureFrame[4] > maxKin) maxKin = futureFrame[4];
            }
            targets.push([maxProx, maxKin]);
        }

        const xs = tf.tensor3d(inputs); 
        const ys = tf.tensor2d(targets); 

        // Modell erstellen
        if (!this.model) {
            this.model = tf.sequential();
            this.model.add(tf.layers.lstm({
                units: 32, // Mehr Neuronen für komplexe Muster
                inputShape: [this.historySize, 16],
                returnSequences: false
            }));
            // Dropout gegen Overfitting (lernt nicht auswendig)
            this.model.add(tf.layers.dropout({ rate: 0.2 }));
            this.model.add(tf.layers.dense({ units: 2, activation: 'sigmoid' })); // Sigmoid zwingt Output auf 0-1
            this.model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
        }

        console.log("Brain: Starte Training (20 Epochen)...");
        
        // Training (Mehr Epochen für bessere Konvergenz)
        await this.model.fit(xs, ys, {
            epochs: 20, 
            batchSize: 32,
            shuffle: true
        });

        xs.dispose();
        ys.dispose();
        this.isTraining = false;
        return true;
    }

    // --- LIVE PROZESS ---
    process(inputObj) {
        if (this.isTraining || !this.model) return { safe:0, warn:0, danger:0 };

        // 1. Vektor holen und NORMALISIEREN
        const rawVector = this.flattenInput(inputObj);
        const normVector = this.normalizeVector(rawVector);
        
        this.inputBuffer.push(normVector);
        if (this.inputBuffer.length > this.historySize) {
            this.inputBuffer.shift(); 
        }

        if (this.inputBuffer.length === this.historySize) {
            return this.runInference();
        }

        return { safe: 1, warn: 0, danger: 0 };
    }

    runInference() {
        const prediction = tf.tidy(() => {
            const inputTensor = tf.tensor3d([this.inputBuffer]); 
            const result = this.model.predict(inputTensor); 
            return result.dataSync(); 
        });

        // Output ist 0.0 bis 1.0 (wegen Sigmoid und Normalisierung)
        const predProxNorm = prediction[0];
        const predKinNorm = prediction[1];

        // Rückrechnen in echte Werte für die Logik (Denormalisierung)
        const predProx = this.denormalizeValue(predProxNorm, 9);
        const predKin = this.denormalizeValue(predKinNorm, 4);

        // Debug Ausgabe (damit du siehst was er vorhersagt)
        // console.log(`Pred: Prox=${predProx.toFixed(1)}dBm, Kin=${predKin.toFixed(2)}`);

        let pSafe = 1.0;
        let pWarn = 0.0;
        let pDanger = 0.0;

        // KI Logik mit echten Grenzwerten
        // Kinetic > 2.0 ist meist ein harter Schlag
        // Proximity > -40 ist sehr nah
        if (predKin > 2.5 || predProx > -35) {
            pDanger = 1.0; pSafe = 0.0;
        } else if (predProx > -55) {
            pWarn = 1.0; pSafe = 0.0;
        }

        return { safe: pSafe, warn: pWarn, danger: pDanger };
    }

    // --- HELPER: NORMALISIERUNG ---
    calculateMinMax(data) {
        // Initialisieren
        this.normalization.min = [...data[0]];
        this.normalization.max = [...data[0]];

        for (let row of data) {
            for (let i = 0; i < 16; i++) {
                if (row[i] < this.normalization.min[i]) this.normalization.min[i] = row[i];
                if (row[i] > this.normalization.max[i]) this.normalization.max[i] = row[i];
            }
        }
        
        // Puffer hinzufügen, damit neue Werte nicht sprengen
        for(let i=0; i<16; i++) {
            let span = this.normalization.max[i] - this.normalization.min[i];
            if(span === 0) span = 1; // Division durch Null verhindern
            this.normalization.min[i] -= span * 0.1; 
            this.normalization.max[i] += span * 0.1;
        }
    }

    normalizeVector(vector) {
        return vector.map((val, i) => {
            let min = this.normalization.min[i];
            let max = this.normalization.max[i];
            // Safe Division
            if (max === min) return 0.5;
            let norm = (val - min) / (max - min);
            // Clamping (0-1)
            if (norm < 0) norm = 0;
            if (norm > 1) norm = 1;
            return norm;
        });
    }

    denormalizeValue(normVal, index) {
        let min = this.normalization.min[index];
        let max = this.normalization.max[index];
        return normVal * (max - min) + min;
    }

    flattenInput(input) {
        return [
            input.groupA.accSurge || 0, input.groupA.accSway || 0, input.groupA.accHeave || 0, 
            input.groupA.gyroYaw || 0, input.groupA.kineticEnergy || 0,
            input.groupB.proximity || -100, input.groupB.stability || 0, input.groupB.density || 0, input.groupB.snr || -100,
            input.groupC.proximity || -100, input.groupC.velocity || 0, input.groupC.count || 0, input.groupC.spread || 0,
            input.groupD.ratio || 0, input.groupD.ageGap || 0, input.groupD.latency || 0
        ];
    }
}
 
