const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID =    "beb5483e-36e1-4688-b7f5-ea07361b26a8";

class AudioSensor {
    constructor() { this.vol=0; this.active=false; }
    async start() {
        try {
            const s = await navigator.mediaDevices.getUserMedia({audio:true});
            const c = new AudioContext(), src = c.createMediaStreamSource(s), ana = c.createAnalyser();
            const sc = c.createScriptProcessor(2048,1,1);
            src.connect(ana); ana.connect(sc); sc.connect(c.destination);
            sc.onaudioprocess=()=>{
                const d=new Uint8Array(ana.frequencyBinCount); ana.getByteFrequencyData(d);
                let sm=0; for(let i of d) sm+=i; this.vol=sm/d.length; this.active=true;
            };
            log("Mikrofon OK.", "success");
        } catch(e) { log("Mic Fehler: "+e.message, "error"); }
    }
    getLevel() { return this.active?this.vol:0; }
}

class MotionSensor {
    constructor() { this.acc=0; this.gyro=0; 
        if(window.DeviceMotionEvent) window.addEventListener('devicemotion',e=>{
            const a=e.accelerationIncludingGravity, r=e.rotationRate;
            if(a) this.acc=(this.acc*0.9)+(Math.abs(Math.sqrt(a.x**2+a.y**2+a.z**2)-9.8)*0.1);
            if(r) this.gyro=(this.gyro*0.9)+((Math.abs(r.alpha)+Math.abs(r.beta)+Math.abs(r.gamma))*0.1);
        });
    }
    getStats() { return {acc:this.acc, gyro:this.gyro}; }
}

class AnomalyDetector {
    constructor(cb) {
        this.inputSize=24; this.windowSize=20; this.model=this.buildModel();
        this.queue=[]; this.isTraining=false; this.threshold=0.20; this.lossHist=[];
        this.chartCb=cb;
    }
    buildModel() {
        const m=tf.sequential();
        m.add(tf.layers.dense({inputShape:[this.inputSize], units:16, activation:'relu'}));
        m.add(tf.layers.dense({units:8, activation:'relu'}));
        m.add(tf.layers.dense({units:16, activation:'relu'}));
        m.add(tf.layers.dense({units:this.inputSize, activation:'sigmoid'}));
        m.compile({optimizer:tf.train.adam(0.01), loss:'meanSquaredError'});
        return m;
    }
    prep(r,s,rt,a) {
        const nr=r.map(v=>(v+100)/70);
        return [...nr, Math.min(s.acc/2,1), Math.min(s.gyro/100,1), Math.min(rt/10,1), Math.min(a/100,1)];
    }
    async detect(rssi, sens, rate, audio) {
        if(rssi.length<this.windowSize) return {loss:0, limit:0, vec:null};
        const vec=this.prep(rssi, sens, rate, audio);
        const t=tf.tensor2d([vec]);
        const out=this.model.predict(t);
        const loss=(await tf.losses.meanSquaredError(t, out).data())[0];
        t.dispose(); out.dispose();

        const noise=audio*0.002, motion=(sens.acc*0.2)+(sens.gyro*0.004);
        this.lossHist.push(loss); if(this.lossHist.length>50) this.lossHist.shift();
        const avg=this.lossHist.reduce((a,b)=>a+b,0)/this.lossHist.length;
        this.threshold=avg+0.08;
        const limit=this.threshold+motion+noise;

        if(loss<limit*1.5) this.queue.push(vec);
        if(this.queue.length>40 && !this.isTraining) this.train();
        return {loss, limit, vec};
    }
    async train() {
        this.isTraining=true; const d=tf.tensor2d(this.queue);
        const h=await this.model.fit(d,d,{epochs:2, shuffle:true});
        if(this.chartCb) this.chartCb(h.history.loss[0]);
        d.dispose(); this.queue=[]; this.isTraining=false;
    }
    async forceLearn(vecs) {
        if(!vecs.length) return;
        const d=tf.tensor2d(vecs);
        await this.model.fit(d,d,{epochs:15, shuffle:true});
        d.dispose();
    }
}

class DeviceBrain {
    constructor(mac, ai) {
        this.mac=mac; this.ai=ai; this.buf=[]; this.last=Date.now();
        this.avg=-100; this.loss=0; this.lim=0; this.vec=null; this.pkts=0; this.rate=0; this.chk=Date.now();
        this.x=Math.random()*100;
        this.isIgnored = false; // Neuer Status: Ignoriert?
    }
    async add(rssi, sens, audio) {
        this.last=Date.now(); this.pkts++;
        if(this.last-this.chk>1000) { this.rate=this.pkts; this.pkts=0; this.chk=this.last; }
        this.buf.push(rssi); if(this.buf.length>20) this.buf.shift();
        this.avg=this.buf.reduce((a,b)=>a+b,0)/this.buf.length;
        if(this.buf.length===20) {
            const r=await this.ai.detect(this.buf, sens, this.rate, audio);
            this.loss=r.loss; this.lim=r.limit; this.vec=r.vec;
        }
    }
}

class StaplerApp {
    constructor() {
        this.devs={}; this.motion=new MotionSensor(); this.audio=new AudioSensor();
        this.ai=new AnomalyDetector(l=>this.updLoss(l));
        this.conn=false; this.lastPkt=0; this.startTime=0;
        this.badDevs=[]; // Liste der aktuellen Alarm-Geräte
        
        // Charts Init
        this.lossData=Array(50).fill(0);
        const o={responsive:true, maintainAspectRatio:false, animation:false, scales:{x:{display:false}}, plugins:{legend:{display:false}}};
        this.radar=new Chart(document.getElementById('radarChart').getContext('2d'),{type:'bubble',data:{datasets:[{data:[],backgroundColor:c=>this.col(c.raw)}]},options:{...o,scales:{y:{min:-100,max:-30,grid:{color:'#222'}}}}});
        this.lossC=new Chart(document.getElementById('lossChart').getContext('2d'),{type:'line',data:{labels:Array(50).fill(''),datasets:[{data:this.lossData,borderColor:'#00d2ff',borderWidth:1,fill:true,backgroundColor:'rgba(0,210,255,0.1)',pointRadius:0}]},options:{...o,scales:{y:{min:0,max:0.5,grid:{color:'#222'}}}}});
        
        setInterval(()=>this.loop(), 200);
        setInterval(()=>this.watchdog(), 1000);
    }
    updLoss(v) { this.lossData.push(v); this.lossData.shift(); this.lossC.update(); }
    async startSystem() { await this.audio.start(); this.connect(); }
    
    async connect() {
        try {
            document.getElementById('offline-overlay').classList.add('hidden');
            if(typeof DeviceMotionEvent?.requestPermission==='function') await DeviceMotionEvent.requestPermission();
            const d=await navigator.bluetooth.requestDevice({acceptAllDevices:true, optionalServices:[SERVICE_UUID]});
            d.addEventListener('gattserverdisconnected',()=>this.discon());
            const s=await d.gatt.connect();
            const svc=await s.getPrimaryService(SERVICE_UUID);
            const c=await svc.getCharacteristic(CHAR_UUID);
            await c.startNotifications();
            c.addEventListener('characteristicvaluechanged',e=>this.data(e));
            this.conn=true; this.lastPkt=Date.now(); this.startTime=Date.now();
            document.getElementById('connection-dot').className="dot-green";
            document.getElementById('header-btn').innerText="AKTIV";
            log("System online. Kalibriere Fahrer...", "success");
        } catch(e) { log("Fehler: "+e.message,"error"); this.discon(); }
    }
    reconnect() { this.connect(); }
    discon() { this.conn=false; document.getElementById('offline-overlay').classList.remove('hidden'); document.getElementById('connection-dot').className="dot-red"; }
    watchdog() { if(this.conn && Date.now()-this.lastPkt>3500) this.discon(); }
    
    data(e) {
        this.lastPkt=Date.now();
        try {
            const v=new TextDecoder().decode(e.target.value).split("|");
            const mac=v[0], rssi=parseInt(v[1]); if(isNaN(rssi)) return;
            const sens=this.motion.getStats(), aud=this.audio.getLevel();
            if(!this.devs[mac]) this.devs[mac]=new DeviceBrain(mac, this.ai);
            const dev = this.devs[mac];
            
            // --- FAHRER FILTER LOGIK ---
            // Wenn das Gerät in den ersten 10 Sekunden extrem stark ist, ist es der Fahrer.
            // Wir ignorieren es für immer.
            if (!dev.isIgnored && Date.now() - this.startTime < 10000) {
                if (rssi > -50) {
                    dev.isIgnored = true;
                    log(`Fahrer erkannt [${mac.slice(-5)}]. Ignoriere.`, "success");
                }
            }
            
            dev.add(rssi, sens, aud);
        } catch(err){}
    }
    
    loop() {
        const hb=document.getElementById('system-heartbeat');
        hb.style.color=(Date.now()%1000<500)?'#0f0':'#555';
        if(!this.conn) { document.getElementById('tel-status').innerText="DISCONNECTED"; return; }

        const sens=this.motion.getStats(), aud=this.audio.getLevel();
        let maxR=0, points=[], currentBadDevs=[];
        let bestDev=null, bestRSSI=-999;

        for(let k in this.devs) {
            const d=this.devs[k];
            if(Date.now()-d.last>5000) continue;
            
            // Wenn ignoriert (Fahrer), überspringen wir die Gefahr-Berechnung
            if(d.isIgnored) {
                // Zeige Fahrer als kleinen grauen Punkt (zur Kontrolle)
                points.push({x:d.x, y:d.avg, r:3, raw:0}); 
                continue;
            }

            if(d.avg>bestRSSI) { bestRSSI=d.avg; bestDev=d; }
            
            let r=0;
            // 1. KI Anomalie
            if(d.loss > d.lim) r=(d.avg>-75)?2:1;
            // 2. Notbremse (nur wenn nicht ignoriert)
            if(d.avg > -45) r=2;
            
            if(r===2) currentBadDevs.push(d); // Merken für Feedback Button
            if(r>maxR) maxR=r;
            
            points.push({x:d.x, y:d.avg, r:(r===2?25:r===1?15:6), raw:r});
        }
        
        this.badDevs = currentBadDevs; // Globale Liste für Button
        this.radar.data.datasets[0].data=points; this.radar.update();
        
        // UI und Telemetrie
        document.getElementById('val-objects').innerText=points.length;
        document.getElementById('val-audio').innerText=aud.toFixed(0)+"%";
        document.getElementById('val-motion').innerText=sens.acc.toFixed(1)+"G";
        
        if(bestDev) {
            document.getElementById('tel-mac').innerText=".."+bestDev.mac.slice(-5);
            document.getElementById('tel-rssi').innerText=bestDev.avg.toFixed(1);
            document.getElementById('tel-buf').innerText=bestDev.buf.length;
            document.getElementById('tel-loss').innerText=bestDev.loss.toFixed(4);
            document.getElementById('tel-limit').innerText=bestDev.lim.toFixed(4);
            document.getElementById('tel-status').innerText=bestDev.loss>bestDev.lim?"⚠️ ANOMALIE":"OK";
        }
        
        // Debug Sensoren
        document.getElementById('tel-acc').innerText=sens.acc.toFixed(2);
        document.getElementById('tel-gyro').innerText=sens.gyro.toFixed(0);

        this.setStatus(maxR);
    }
    
    setStatus(r) {
        const s=document.getElementById('status-display'), t=document.getElementById('main-status-text');
        s.className="";
        if(r===2) { s.classList.add('status-danger'); t.innerText="GEFAHR"; if(navigator.vibrate) navigator.vibrate(200); }
        else if(r===1) { s.classList.add('status-warn'); t.innerText="WARNUNG"; }
        else { s.classList.add('status-safe'); t.innerText="FREI"; }
    }
    
    reportFalseAlarm() {
        if(!this.badDevs.length) return alert("Kein aktiver Alarm.");
        
        // 1. KI Trainieren
        const vecs = this.badDevs.map(d => d.vec).filter(v => v);
        this.ai.forceLearn(vecs);
        
        // 2. DAS WICHTIGE: Gerät temporär ignorieren (Whitelisting)
        this.badDevs.forEach(d => {
            d.isIgnored = true;
            log(`MAC [${d.mac.slice(-5)}] wird nun ignoriert.`, "learning");
        });
        
        const btn=document.getElementById('btn-false-alarm');
        btn.innerText="✅ IGNORIERE GERÄT!";
        setTimeout(()=>{ btn.innerText="✋ DAS WAR EIN FEHLALARM!"; }, 2000);
    }
    
    col(r) { return r===2?'rgba(255,0,85,0.9)':r===1?'rgba(255,170,0,0.8)':(r===0?'#555':'rgba(0,255,0,0.6)'); }
}
 
