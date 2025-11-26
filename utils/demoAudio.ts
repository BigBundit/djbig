
export const generateRockDemo = (ctx: AudioContext): AudioBuffer => {
    // 22 Seconds Demo High Speed Metal
    const duration = 22.0;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);
    
    const bpm = 175; // High Octane
    const secondsPerBeat = 60 / bpm;
    const totalSixteenths = Math.floor(duration / (secondsPerBeat / 4));

    // Wave shaper for distortion
    const dist = (x: number, drive: number) => {
        return Math.tanh(x * drive);
    };

    // Helper: Add sound to buffer
    const addSound = (startTime: number, type: 'kick' | 'snare' | 'hat' | 'crash' | 'bass' | 'guitar_chug' | 'guitar_open', pitch: number = 1.0) => {
        const startSample = Math.floor(startTime * sampleRate);
        if (startSample >= data.length) return;

        if (type === 'kick') {
            // Metal Kick: Clicky and punchy
            const len = Math.floor(0.15 * sampleRate);
            for (let i = 0; i < len; i++) {
                if (startSample + i >= data.length) break;
                const t = i / sampleRate;
                const freq = 120 * Math.exp(-t * 20);
                const amp = Math.exp(-t * 10);
                // Add click
                const click = (Math.random() - 0.5) * Math.exp(-t * 50) * 0.5;
                data[startSample + i] += (Math.sin(2 * Math.PI * freq * t) + click) * amp * 0.9;
            }
        } else if (type === 'snare') {
            // Tight Snare
            const len = Math.floor(0.2 * sampleRate);
            for (let i = 0; i < len; i++) {
                if (startSample + i >= data.length) break;
                const t = i / sampleRate;
                const noise = (Math.random() * 2 - 1) * Math.exp(-t * 12);
                const tone = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 15) * 0.5;
                data[startSample + i] += dist(noise + tone, 2.0) * 0.7;
            }
        } else if (type === 'hat') {
            // Metal Hat
            const len = Math.floor(0.04 * sampleRate);
            for (let i = 0; i < len; i++) {
                if (startSample + i >= data.length) break;
                const t = i / sampleRate;
                const noise = (Math.random() * 2 - 1) * Math.exp(-t * 30);
                if (i % 2 === 0) data[startSample + i] += noise * 0.25;
            }
        } else if (type === 'crash') {
            const len = Math.floor(2.0 * sampleRate);
            for (let i = 0; i < len; i++) {
                if (startSample + i >= data.length) break;
                const t = i / sampleRate;
                const noise = (Math.random() * 2 - 1) * Math.exp(-t * 3);
                if (i % 3 === 0) data[startSample + i] += noise * 0.4;
            }
        } else if (type === 'bass') {
             const len = Math.floor(0.2 * sampleRate);
             for (let i = 0; i < len; i++) {
                 if (startSample + i >= data.length) break;
                 const t = i / sampleRate;
                 const freq = 41.2 * pitch; // E1
                 // Square-ish wave for growl
                 const val = Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(2 * Math.PI * freq * 2 * t);
                 data[startSample + i] += dist(val, 3.0) * Math.exp(-t * 5) * 0.6;
             }
        } else if (type.startsWith('guitar')) {
            // Distorted Guitar
            const isOpen = type === 'guitar_open';
            const duration = isOpen ? secondsPerBeat * 2 : secondsPerBeat / 2;
            const len = Math.floor(duration * sampleRate);
            const baseFreq = 82.41 * pitch; // E2
            const harmonics = [1, 1.50, 2.0]; // Power Chord (Root, 5th, Octave)
            
            for (let i = 0; i < len; i++) {
                if (startSample + i >= data.length) break;
                const t = i / sampleRate;
                let sample = 0;
                
                // Multi-oscillator for thickness
                harmonics.forEach(h => {
                    const detune = 1 + (Math.random() * 0.002);
                    sample += Math.sin(2 * Math.PI * baseFreq * h * detune * t); // Fundamental
                    sample += 0.5 * (Math.random() - 0.5); // Noise layer for grit
                });

                // Heavy Distortion
                sample = dist(sample, 8.0); 

                // Palm Mute Envelope vs Open Envelope
                const decay = isOpen ? 2.0 : 15.0;
                const env = Math.exp(-t * decay);
                
                data[startSample + i] += sample * env * 0.35;
            }
        }
    };

    // --- SEQUENCER ---
    // 16th note grid
    const stepTime = secondsPerBeat / 4;
    
    // Patterns
    // 0 = rest, 1 = Kick, 2 = Snare, 3 = Crash
    const drumPattern = [
        1, 0, 0, 1,  2, 0, 1, 0,  // Kick..Kick Snare.Kick.
        0, 0, 1, 1,  2, 0, 1, 1   // ..KickKick Snare.KickKick
    ];

    for (let i = 0; i < totalSixteenths; i++) {
        const time = i * stepTime;
        const beatInBar = i % 16;
        
        // Constant 8th note hi-hats
        if (i % 2 === 0) addSound(time, 'hat');
        
        // Drums
        const drumTrig = drumPattern[beatInBar % 16];
        if (drumTrig === 1) addSound(time, 'kick');
        if (drumTrig === 2) addSound(time, 'snare');
        if (i === 0 || i === 64) addSound(time, 'crash'); // Crash start and middle

        // Bass & Guitar (Chugging on low E)
        // Follows kick mostly
        if (drumTrig === 1 || drumTrig === 0) {
            // Palm mute chugs on 16ths
             if (i % 2 === 0) {
                 addSound(time, 'guitar_chug', 1.0);
                 addSound(time, 'bass', 1.0);
             }
        }
        
        // Open chords on snare hits
        if (drumTrig === 2) {
             addSound(time, 'guitar_open', 1.0); // E Power chord
        }
        
        // Turnaround riff at end
        if (i > totalSixteenths - 16) {
             if (beatInBar === 0) addSound(time, 'guitar_open', 1.2); // G
             if (beatInBar === 8) addSound(time, 'guitar_open', 1.33); // A
        }
    }

    // NORMALIZE
    let maxAmp = 0;
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > maxAmp) maxAmp = Math.abs(data[i]);
    }
    if (maxAmp > 0) {
        for (let i = 0; i < data.length; i++) {
            data[i] = (data[i] / maxAmp) * 0.95;
        }
    }

    return buffer;
};
