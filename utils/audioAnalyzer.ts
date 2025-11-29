
import { Note } from '../types';

/**
 * Analyzes an audio buffer to detect beats and generate a note chart.
 * Uses a dynamic threshold algorithm to detect energy peaks (onsets).
 * UPDATED: Now includes a Pattern Generator to create varied, fun charts.
 */
export const analyzeAudioAndGenerateNotes = async (
  audioBuffer: AudioBuffer, 
  level: number, // 1 to 10
  laneCount: number, // 4, 5, or 7
  startOffset: number = 3000 // NEW: Delay before music starts (ms)
): Promise<Note[]> => {
  const rawData = audioBuffer.getChannelData(0); // Use left channel
  const sampleRate = audioBuffer.sampleRate;
  
  // 1. Difficulty Scaling
  // Gap: How fast notes can appear. High level = lower gap (faster).
  let minNoteGap = Math.max(110, 550 - ((level - 1) * 45)); 
  
  // EASY MODE TWEAK (Level 7 is "Easy" in UI)
  if (level === 7) {
      minNoteGap = 450; // Force slower gap for Easy
  }

  const sensitivity = Math.max(1.02, 2.5 - ((level - 1) * 0.18));

  // Chord Threshold (Energy required for double notes)
  let chordThreshold = 99;
  if (level >= 4) {
      chordThreshold = 3.0 - ((level - 4) * 0.25); 
  }
  
  // EASY MODE TWEAK: Disable Chords completely
  if (level === 7) {
      chordThreshold = 999;
  }

  const notes: Note[] = [];
  let noteId = 0;
  let lastNoteTime = -minNoteGap; // Allow notes right at start

  const bufferSize = 1024; 
  const audioLength = rawData.length;
  
  // Calculate energies (RMS)
  const energies: number[] = [];
  for (let i = 0; i < audioLength; i += bufferSize) {
    let sum = 0;
    const end = Math.min(i + bufferSize, audioLength);
    for (let j = i; j < end; j++) {
      sum += rawData[j] * rawData[j];
    }
    const rms = Math.sqrt(sum / (end - i));
    energies.push(rms);
  }

  // PATTERN SYSTEM STATE
  // Encapsulated in object to prevent TS control flow issues
  const patternState = {
    type: 'random' as 'random' | 'stream' | 'trill' | 'jack' | 'jump' | 'chaos',
    step: 0,
    direction: 1, // 1 = Right, -1 = Left
    lastLane: Math.floor(laneCount / 2),
    notesSinceChange: 0
  };
  
  // Helper to pick next lane based on pattern
  const getNextLane = () => {
      let next = 0;
      
      // Change pattern MORE FREQUENTLY (Every 2-6 notes)
      if (patternState.notesSinceChange > (2 + Math.random() * 4)) {
          patternState.notesSinceChange = 0;
          const rand = Math.random();
          
          if (level === 7) {
             // EASY MODE PATTERNS: Only Random or Slow Stream
             if (rand < 0.2) patternState.type = 'stream';
             else patternState.type = 'random';
          } else {
             // NORMAL/HARD/EXPERT PATTERNS
             // Distribution: Stream 10%, Trill 10%, Jack 10%, Jump 35%, Chaos 35%
             if (level >= 8 && rand < 0.10) patternState.type = 'stream'; 
             else if (level >= 8 && rand < 0.20) patternState.type = 'trill'; 
             else if (rand < 0.30) patternState.type = 'jack'; // Reduced significantly
             else if (level >= 8 && rand < 0.65) patternState.type = 'jump'; // Increased
             else patternState.type = 'chaos'; // Increased
          }
          
          patternState.direction = Math.random() > 0.5 ? 1 : -1;
      }

      switch (patternState.type) {
          case 'stream':
              // Move 1 step in direction (Stairs)
              next = patternState.lastLane + patternState.direction;
              // Bounce off walls
              if (next >= laneCount) { next = laneCount - 2; patternState.direction = -1; }
              if (next < 0) { next = 1; patternState.direction = 1; }
              break;
              
          case 'trill':
              // Alternate between two lanes (e.g., 2 -> 3 -> 2 -> 3)
              if (patternState.step % 2 === 0) next = patternState.lastLane + 1;
              else next = patternState.lastLane - 1;
              
              // Bounds check
              if (next >= laneCount) next = laneCount - 2;
              if (next < 0) next = 1;
              break;

          case 'jack':
              // Repeat same lane
              next = patternState.lastLane;
              // Force break out if too long (max 3 jacks usually)
              if (patternState.notesSinceChange > 3) patternState.type = 'random';
              break;

          case 'jump':
              // Skip a lane (e.g. 1 -> 3 -> 5)
              next = patternState.lastLane + (patternState.direction * 2);
              if (next >= laneCount || next < 0) {
                  // If hit wall, reverse and single step
                  patternState.direction *= -1;
                  next = patternState.lastLane + patternState.direction;
              }
              break;

          case 'chaos':
              // Full random, no flow logic (High intensity)
              next = Math.floor(Math.random() * laneCount);
              break;

          case 'random':
          default:
              // Weighted random: Prefer moving nearby rather than huge jumps
              const jump = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
              next = patternState.lastLane + jump;
              break;
      }
      
      // Safety Clamp
      if (next < 0) next = 0;
      if (next >= laneCount) next = laneCount - 1;
      
      // Anti-Jack in non-jack modes (unless Chaos)
      if (patternState.type !== 'jack' && patternState.type !== 'chaos' && next === patternState.lastLane) {
          next = (next + 1) % laneCount;
      }

      patternState.step++;
      patternState.notesSinceChange++;
      patternState.lastLane = next;
      return next;
  };

  const historySize = 43; 
  
  for (let i = 0; i < energies.length; i++) {
    const startHistory = Math.max(0, i - historySize);
    let sumHistory = 0;
    for (let h = startHistory; h < i; h++) {
      sumHistory += energies[h];
    }
    const averageEnergy = sumHistory / (i - startHistory || 1);
    const currentEnergy = energies[i];
    
    // Beat Detection
    if (currentEnergy > averageEnergy * sensitivity && currentEnergy > 0.05) {
      const timeMs = ((i * bufferSize / sampleRate) * 1000) + startOffset; // ADD OFFSET HERE

      if (timeMs - lastNoteTime > minNoteGap) {
        
        // 1. Generate Main Note
        const laneIndex = getNextLane();

        notes.push({
          id: noteId++,
          laneIndex: laneIndex,
          timestamp: timeMs,
          y: -10,
          hit: false,
          missed: false
        });

        // 2. Chord Logic (Double Notes)
        // High energy AND not in a trill/fast stream/jack (to preserve flow)
        if (currentEnergy > averageEnergy * chordThreshold && patternState.type !== 'trill' && patternState.type !== 'jack') {
             // Pick a lane far away from the main note for easier reading
             let secondLane = (laneIndex + Math.floor(laneCount / 2)) % laneCount;
             
             // Ensure uniqueness
             if (secondLane === laneIndex) secondLane = (secondLane + 1) % laneCount;

             notes.push({
                id: noteId++,
                laneIndex: secondLane,
                timestamp: timeMs,
                y: -10,
                hit: false,
                missed: false
              });
        }
        
        // 3. Triple Logic (Expert Level Only - Huge Drops)
        if (level === 10 && currentEnergy > averageEnergy * 2.5) {
             const thirdLane = (laneIndex + 2) % laneCount;
             const existing = notes.filter(n => Math.abs(n.timestamp - timeMs) < 1);
             if (!existing.some(n => n.laneIndex === thirdLane)) {
                notes.push({
                    id: noteId++,
                    laneIndex: thirdLane,
                    timestamp: timeMs,
                    y: -10,
                    hit: false,
                    missed: false
                });
             }
        }

        lastNoteTime = timeMs;
      }
    }
  }

  return notes;
};
