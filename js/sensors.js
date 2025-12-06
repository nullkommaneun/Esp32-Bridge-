// js/sensors.js

export const PhoneSensors = {
    data: {
        accX: 0, accY: 0, accZ: 0,
        gyroZ: 0,
        jerk: 0,
        gpsSpeed: 0,
        audioLevel: 0,
        battery: 100
    },

    audioContext: null,
    analyser: null,
    dataArray: null,
    lastAcc: { x:0, y:0, z:0, time:0 },

    async init() {
        console.log("Sensoren werden initialisiert...");

        // 1. Audio (Benötigt Klick)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 32; // Klein für Performance
            source.connect(this.analyser);
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        } catch (e) {
            console.warn("Audio Zugriff verweigert:", e);
        }

        // 2. Battery
        if (navigator.getBattery) {
            const battery = await navigator.getBattery();
            this.data.battery = Math.round(battery.level * 100);
            battery.addEventListener('levelchange', () => {
                this.data.battery = Math.round(battery.level * 100);
            });
        }

        // 3. GPS (Geolocation)
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition((pos) => {
                // speed ist in m/s. Wenn null (Stillstand), dann 0.
                this.data.gpsSpeed = pos.coords.speed || 0;
            }, (err) => console.warn("GPS Fehler:", err), {
                enableHighAccuracy: true
            });
        }

        // 4. Motion (Request für iOS 13+)
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            const response = await DeviceMotionEvent.requestPermission();
            if (response === 'granted') {
                window.addEventListener('devicemotion', this.handleMotion.bind(this));
            } else {
                console.warn("Motion Permission denied");
            }
        } else {
            // Android / Old iOS
            window.addEventListener('devicemotion', this.handleMotion.bind(this));
        }
        
        // Loop für Gyro falls in Motion nicht enthalten, oft kombiniert.
        window.addEventListener('deviceorientation', (e) => {
            // Gyro Z (Alpha) ist Rotation um Z-Achse
            this.data.gyroZ = e.alpha || 0;
        });
    },

    handleMotion(event) {
        // Acc ohne Gravitation ist besser für Bewegungs-Erkennung
        const acc = event.acceleration || event.accelerationIncludingGravity;
        if (!acc) return;

        const x = acc.x || 0;
        const y = acc.y || 0;
        const z = acc.z || 0;
        const now = performance.now();

        // Jerk Berechnung (Änderung der Beschleunigung / Zeit)
        const dt = (now - this.lastAcc.time) / 1000; // in Sekunden
        if (dt > 0) {
            const dAx = x - this.lastAcc.x;
            const dAy = y - this.lastAcc.y;
            const dAz = z - this.lastAcc.z;
            // Euklidischer Ruck (Magnitude)
            this.data.jerk = Math.sqrt(dAx*dAx + dAy*dAy + dAz*dAz) / dt;
        }

        this.data.accX = x;
        this.data.accY = y;
        this.data.accZ = z;

        this.lastAcc = { x, y, z, time: now };
    },

    // Muss in der Animation Loop aufgerufen werden
    updateAudio() {
        if (!this.analyser) return 0;
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Durchschnittslautstärke (RMS approximation)
        let sum = 0;
        for(let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        this.data.audioLevel = sum / this.dataArray.length; // 0 - 255
    }
};
