export class NeuralBrain {
    constructor() {
        this.model = null;
        this.isTraining = false;
        this.historySize = 50; 
        this.futureSteps = 5;  
        this.inputBuffer = []; 
        
        // Speicher für Min/Max Werte
        this.normalization = {
            min: new Array(16).fill(0),
            max: new Array(16).fill(1)
        };
    }

    // --- TRAINING ---
    async train(recordedData) {
        if (typeof tf === 'undefined') return false;
        if (recordedData.length < this.historySize + this.futureSteps + 10) return false;

        this.isTraining = true;
        console.log("Brain: Berechne Normalisierung...");

        // 1. Min/Max lernen
        this.calculateMinMax(recordedData);

        // 2. Daten normalisieren
        const normalizedData = recordedData.map(row => this.normalizeVector(row));

        const inputs = [];
        const targets = [];

        // Sliding Window
        for (let i = 0; i < normalizedData.length - this.historySize - this.futureSteps; i++) {
            const window = normalizedData.slice(i, i + this.historySize);
            inputs.push(window);

            // Wir trainieren auf MAX werte der Zukunft
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

        // Modell Reset & Aufbau
        if (this.model) this.model.dispose(); // Altes Modell löschen
        
        this.model = tf.sequential();
        this.model.add(tf.layers.lstm({
            units: 40, // Etwas mehr Power
            inputShape: [this.historySize, 16],
            returnSequences: false
        }));
        this.model.add(tf.layers.dense({ units: 16, activation: 'relu' })); // Zwischenschicht
        this.model.add(tf.layers.dense({ units: 2, activation: 'sigmoid' })); // Output 0-1
        
        this.model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

        console.log("Brain: Starte Training...");
        await this.model.fit(xs, ys, {
            epochs: 25, 
            batchSize: 16, // Kleinerer Batch lernt genauer
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

        // Vorhersage ist normalisiert (0.0 bis 1.0)
        const predProxNorm = prediction[0];
        const predKinNorm = prediction[1];

        // Umrechnen in echte Werte
        const predProx = this.denormalizeValue(predProxNorm, 9);
        const predKin = this.denormalizeValue(predKinNorm, 4);

        let pSafe = 1.0;
        let pWarn = 0.0;
        let pDanger = 0.0;

        // --- DIAGNOSE LOGIK (Warum ist es rot?) ---
        // Grenzwerte: Kinetic > 2.5G | Proximity > -35dBm
        
        if (predKin > 2.5) {
            pDanger = 1.0; pSafe = 0.0;
            // Nur loggen wenn neu, sonst spammt es
            if(Math.random() < 0.05) console.warn(`ALARM: Crash Vorhersage! (${predKin.toFixed(2)} G)`);
        } 
        else if (predProx > -35) {
            pDanger = 1.0; pSafe = 0.0;
            if(Math.random() < 0.05) console.warn(`ALARM: Kollision Vorhersage! (${predProx.toFixed(1)} dBm)`);
        }
        else if (predProx > -55) {
            pWarn = 1.0; pSafe = 0.0;
        }

        return { safe: pSafe, warn: pWarn, danger: pDanger };
    }

    // --- HELPER ---
    calculateMinMax(data) {
        // Reset mit ersten Werten
        this.normalization.min = [...data[0]];
        this.normalization.max = [...data[0]];

        for (let row of data) {
            for (let i = 0; i < 16; i++) {
                if (row[i] < this.normalization.min[i]) this.normalization.min[i] = row[i];
                if (row[i] > this.normalization.max[i]) this.normalization.max[i] = row[i];
            }
        }
        
        // Sicherheits-Puffer erweitern (verhindert das "Springen" bei leicht neuen Werten)
        for(let i=0; i<16; i++) {
            let range = this.normalization.max[i] - this.normalization.min[i];
            if(range === 0) range = 0.1; 
            // Wir erweitern den gelernten Bereich um 50%, damit die KI tolerant ist
            this.normalization.min[i] -= range * 0.5; 
            this.normalization.max[i] += range * 0.5;
        }
    }

    normalizeVector(vector) {
        return vector.map((val, i) => {
            let min = this.normalization.min[i];
            let max = this.normalization.max[i];
            
            // Berechnen
            let norm = (val - min) / (max - min);
            
            // CLAMPING (Das ist der Fix!)
            // Werte, die außerhalb des gelernten Bereichs liegen, werden abgeschnitten.
            // Das verhindert, dass die KI "unendliche" Werte sieht und Panik bekommt.
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
