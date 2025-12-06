export const PhoneSensors = {
    data: {
        // N1 - N5
        accSurge: 0.0,
        accSway: 0.0,
        accHeave: 0.0,
        gyroYaw: 0.0,
        kineticEnergy: 0.0
    },

    async init() {
        console.log("Physik-Sensoren Init...");
        
        // iOS Permission Request
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const response = await DeviceMotionEvent.requestPermission();
                if (response !== 'granted') {
                    console.warn("Motion Permission abgelehnt");
                }
            } catch (e) {
                console.error(e);
            }
        }

        window.addEventListener('devicemotion', this.handleMotion.bind(this));
    },

    handleMotion(event) {
        // N4: Gyro Yaw (Drehrate Z)
        const rot = event.rotationRate;
        if (rot) {
            this.data.gyroYaw = rot.alpha || 0; 
        }

        // N1-N3: Beschleunigung
        const acc = event.acceleration; // Ohne Schwerkraft
        if (acc) {
            this.data.accSurge = acc.x || 0;
            this.data.accSway = acc.y || 0;
            this.data.accHeave = acc.z || 0;

            // N5: Kinetische Energie (Magnitude)
            this.data.kineticEnergy = Math.sqrt(
                (acc.x || 0)**2 + (acc.y || 0)**2 + (acc.z || 0)**2
            );
        }
    },
    
    // Leere Funktion, damit main.js nicht crasht, falls es noch aufgerufen wird
    updateAudio() {} 
};
