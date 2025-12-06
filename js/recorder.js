export class DataRecorder {
    constructor() {
        this.isRecording = false;
        this.buffer = [];
        this.startTime = 0;
    }

    start() {
        this.buffer = [];
        this.isRecording = true;
        this.startTime = Date.now();
        console.log("🔴 Aufnahme gestartet...");
    }

    stop() {
        this.isRecording = false;
        console.log(`⏹ Aufnahme gestoppt. ${this.buffer.length} Datensätze.`);
        this.downloadCSV();
    }

    // Wird 60x pro Sekunde vom Main-Loop aufgerufen
    record(vector) {
        if (!this.isRecording) return;

        // Wir flachen das Objekt ab für CSV (1 Zeile pro Frame)
        const row = [
            Date.now() - this.startTime, // Relative Zeit ms
            // Gruppe A
            vector.groupA.accSurge, vector.groupA.accSway, vector.groupA.accHeave, 
            vector.groupA.gyroYaw, vector.groupA.kineticEnergy,
            // Gruppe B
            vector.groupB.proximity, vector.groupB.stability, vector.groupB.density, vector.groupB.snr,
            // Gruppe C
            vector.groupC.proximity, vector.groupC.velocity, vector.groupC.count, vector.groupC.spread,
            // Gruppe D
            vector.groupD.ratio, vector.groupD.ageGap, vector.groupD.latency,
            // Label (Manuell später hinzufügen oder Buttons nutzen)
            0 // 0 = Normal, 1 = Warning, 2 = Danger (Platzhalter)
        ];
        this.buffer.push(row);
    }

    downloadCSV() {
        if (this.buffer.length === 0) return;

        let csvContent = "data:text/csv;charset=utf-8,";
        // Header
        csvContent += "Time,AccX,AccY,AccZ,Gyro,Kinetic,InfraProx,InfraStab,InfraDens,EnvSNR,ObjProx,ObjVel,ObjCount,ObjSpread,Ratio,AgeGap,Latency,Label\n";
        
        // Daten
        this.buffer.forEach(row => {
            csvContent += row.join(",") + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        const timestamp = new Date().toISOString().slice(0,19).replace(/:/g,"-");
        link.setAttribute("download", `training_data_${timestamp}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
