const consoleEl = document.getElementById('console-log');
const statusEl = document.getElementById('status-indicator');
const dashboardEl = document.getElementById('dashboard');

export const UI = {
    updateNeuralVector(input) {
        // Gruppe A: Physik
        setVal('n1', input.groupA.accSurge, 2);
        setVal('n2', input.groupA.accSway, 2);
        setVal('n3', input.groupA.accHeave, 2);
        setVal('n4', input.groupA.gyroYaw, 1);
        setVal('n5', input.groupA.kineticEnergy, 2);

        // Gruppe B: Infrastruktur
        if (input.groupB.proximity) {
            setVal('n6', input.groupB.proximity, 0, ' dBm');
            setVal('n7', input.groupB.stability, 0, ' Δ');
            setVal('n8', input.groupB.density, 0);
            setVal('n9', input.groupB.snr, 0, ' dB');
        }

        // Gruppe C: Reflex
        if (input.groupC.proximity) {
            setVal('n10', input.groupC.proximity, 0, ' dBm');
            setVal('n11', input.groupC.velocity, 0, ' Δ');
            setVal('n12', input.groupC.count, 0);
            setVal('n13', input.groupC.spread, 0);
        }

        // Gruppe D: Meta
        if (input.groupD.ratio !== undefined) {
            setVal('n14', input.groupD.ratio, 2);
            setVal('n15', input.groupD.ageGap, 0, ' ms');
            setVal('n16', input.groupD.latency, 0, ' ms');
        }
    },
    
    log(msg, type="info") {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const time = new Date().toLocaleTimeString().split(' ')[0];
        entry.textContent = `[${time}] ${msg}`;
        consoleEl.prepend(entry);
    },

    setStatus(text, className) {
        statusEl.textContent = text;
        statusEl.className = `status ${className}`;
        if (className === 'connected') dashboardEl.classList.remove('blurred');
    }
};

function setVal(id, val, decimals, suffix='') {
    const el = document.getElementById(id);
    if(el && val !== undefined && val !== null) {
        el.textContent = val.toFixed(decimals) + suffix;
    }
}
 
