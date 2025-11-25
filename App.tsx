
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Note as NoteType, 
  ScoreRating, 
  GameStatus,
  HitEffectData,
  LaneConfig,
  SongMetadata,
  KeyMapping,
  AudioSettings
} from './types';
import { 
  LANE_CONFIGS_4,
  LANE_CONFIGS_5,
  LANE_CONFIGS_7,
  BASE_FALL_SPEED_MS,
  DEFAULT_KEY_MAPPINGS
} from './constants';
import { ScoreBoard } from './components/ScoreBoard';
import { Lane } from './components/Lane';
import { EndScreen } from './components/EndScreen';
import { Note } from './components/Note';
import { PauseMenu } from './components/PauseMenu';
import { HitEffect } from './components/HitEffect';
import { KeyConfigMenu } from './components/KeyConfigMenu';
import { analyzeAudioAndGenerateNotes } from './utils/audioAnalyzer';
import { generateVideoThumbnail } from './utils/mediaUtils';

const audioCtxRef = { current: null as AudioContext | null };

const App: React.FC = () => {
  // Game State
  const [status, setStatus] = useState<GameStatus>(GameStatus.TITLE);
  const [score, setScore] = useState<number>(0);
  const [combo, setCombo] = useState<number>(0);
  const [maxCombo, setMaxCombo] = useState<number>(0);
  const [health, setHealth] = useState<number>(100);
  
  // Stats for Ranking
  const [perfectCount, setPerfectCount] = useState<number>(0);
  const [goodCount, setGoodCount] = useState<number>(0);
  const [missCount, setMissCount] = useState<number>(0);

  const [feedback, setFeedback] = useState<{ text: string; color: string; id: number } | null>(null);
  const [isAutoPlay, setIsAutoPlay] = useState<boolean>(false);
  
  // Countdown State
  const [startCountdown, setStartCountdown] = useState<number | null>(null);
  const [isShaking, setIsShaking] = useState<boolean>(false);

  // Visual Effects State
  const [hitEffects, setHitEffects] = useState<HitEffectData[]>([]);

  // Local Media State
  const [localVideoSrc, setLocalVideoSrc] = useState<string>('');
  const [localFileName, setLocalFileName] = useState<string>('');
  const [mediaType, setMediaType] = useState<'audio' | 'video'>('video');
  
  // Sound Profile State (Dynamic Drum Sounds)
  const [soundProfile, setSoundProfile] = useState<'electronic' | 'rock' | 'chiptune'>('electronic');

  // Folder / Song Selection State
  const [songList, setSongList] = useState<SongMetadata[]>([]);
  const [isLoadingFolder, setIsLoadingFolder] = useState<boolean>(false);
  
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analyzedNotes, setAnalyzedNotes] = useState<NoteType[] | null>(null);

  const [level, setLevel] = useState<number>(5); // Level 1-10
  const [speedMod, setSpeedMod] = useState<number>(2.0); // Default 2x speed
  
  // Key Mode State
  const [keyMode, setKeyMode] = useState<4 | 5 | 7>(7);
  const [keyMappings, setKeyMappings] = useState<KeyMapping>(DEFAULT_KEY_MAPPINGS);
  const [showKeyConfig, setShowKeyConfig] = useState<boolean>(false);

  // Audio Settings
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({ masterVolume: 0.5, sfxVolume: 1.0 });
  // Ref to hold audio settings for access within game loop/closures without dependency issues
  const audioSettingsRef = useRef<AudioSettings>(audioSettings);

  // Update ref and media volume when state changes
  useEffect(() => {
      audioSettingsRef.current = audioSettings;
      if (mediaRef.current) {
          mediaRef.current.volume = audioSettings.masterVolume;
      }
  }, [audioSettings]);

  // Load Key Mappings from LocalStorage
  useEffect(() => {
      const stored = localStorage.getItem('djbig_key_config');
      if (stored) {
          try {
              setKeyMappings(JSON.parse(stored));
          } catch (e) {
              console.error("Failed to load key config", e);
          }
      }
  }, []);

  const saveKeyMappings = (newMappings: KeyMapping) => {
      setKeyMappings(newMappings);
      localStorage.setItem('djbig_key_config', JSON.stringify(newMappings));
  };

  // Derived Config with Dynamic Keys
  const activeLaneConfig: LaneConfig[] = useMemo(() => {
      let baseConfig: LaneConfig[] = [];
      if (keyMode === 4) baseConfig = LANE_CONFIGS_4;
      else if (keyMode === 5) baseConfig = LANE_CONFIGS_5;
      else baseConfig = LANE_CONFIGS_7;

      // Override keys from mapping
      const currentKeys = keyMappings[keyMode];
      return baseConfig.map((lane, idx) => ({
          ...lane,
          key: currentKeys[idx] || lane.key, // Fallback if something is wrong
          label: currentKeys[idx] === ' ' ? 'SPC' : currentKeys[idx].toUpperCase()
      }));
  }, [keyMode, keyMappings]);

  // Engine State (Refs for performance)
  const frameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const totalPauseDurationRef = useRef<number>(0);
  
  // Ref to track status inside callbacks/closures
  const statusRef = useRef<GameStatus>(GameStatus.TITLE);
  
  const notesRef = useRef<NoteType[]>([]);
  const activeKeysRef = useRef<boolean[]>(new Array(7).fill(false)); // Max 7
  const mediaRef = useRef<HTMLMediaElement>(null); // Ref for audio/video playback
  const bgVideoRef = useRef<HTMLVideoElement>(null); // Ref for background video loop
  const bgRef = useRef<HTMLDivElement>(null); // Ref for background pulse
  const progressBarRef = useRef<HTMLDivElement>(null); // Ref for progress bar
  
  const audioBufferRef = useRef<AudioBuffer | null>(null); // Ref to store raw audio for re-analysis
  const audioDurationRef = useRef<number>(0); // Duration in seconds

  const noiseBufferRef = useRef<AudioBuffer | null>(null); // Ref to cache noise buffer for performance
  
  // Touch Input State
  const laneContainerRef = useRef<HTMLDivElement>(null);
  const touchedLanesRef = useRef<Set<number>>(new Set());

  // Visual State for React Render
  const [renderNotes, setRenderNotes] = useState<NoteType[]>([]);

  // Update status ref
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  // Helper to get or create noise buffer (Optimization)
  const getNoiseBuffer = (ctx: AudioContext) => {
    if (!noiseBufferRef.current) {
      const bufferSize = ctx.sampleRate * 2.0; // 2 seconds
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      noiseBufferRef.current = buffer;
    }
    return noiseBufferRef.current;
  };

  // Helper to calculate volume
  const getVol = (baseVol: number) => {
      return baseVol * audioSettingsRef.current.masterVolume * audioSettingsRef.current.sfxVolume;
  };

  const playUiSound = (type: 'hover' | 'select') => {
      if (!audioCtxRef.current) return; // Only play if context is already initialized
      const ctx = audioCtxRef.current;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      if (type === 'hover') {
          osc.frequency.setValueAtTime(400, t);
          osc.frequency.exponentialRampToValueAtTime(200, t + 0.05);
          gain.gain.setValueAtTime(getVol(0.05), t);
          osc.type = 'sine';
      } else {
          osc.frequency.setValueAtTime(800, t);
          osc.frequency.exponentialRampToValueAtTime(400, t + 0.1);
          gain.gain.setValueAtTime(getVol(0.1), t);
          osc.type = 'square';
      }
      
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.1);
  };

  const performAnalysis = async (buffer: AudioBuffer) => {
      setIsAnalyzing(true);
      try {
        const notes = await analyzeAudioAndGenerateNotes(buffer, level, keyMode);
        setAnalyzedNotes(notes);
      } catch (error) {
        console.error("Analysis failed");
      } finally {
        setIsAnalyzing(false);
      }
  };

  const handleFileSelect = async (file: File) => {
    if (file) {
      // Init audio context on user interaction
      initAudio();
      
      if (localVideoSrc) URL.revokeObjectURL(localVideoSrc);
      const url = URL.createObjectURL(file);
      setLocalVideoSrc(url);
      setLocalFileName(file.name);
      
      // Determine Sound Profile based on file hash to ensure consistency
      // This fulfills "sound changes according to each music file"
      const hash = file.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const profiles: ('electronic' | 'rock' | 'chiptune')[] = ['electronic', 'rock', 'chiptune'];
      const selectedProfile = profiles[hash % profiles.length];
      setSoundProfile(selectedProfile);

      // Detect type
      const isVideo = file.type.startsWith('video') || !!file.name.match(/\.(mp4|webm|ogg|mov|m4v)$/i);
      setMediaType(isVideo ? 'video' : 'audio');

      setAnalyzedNotes(null); // Reset previous analysis
      
      try {
        setIsAnalyzing(true);
        const arrayBuffer = await file.arrayBuffer();
        const ctx = initAudio();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        audioBufferRef.current = audioBuffer; // Store for later re-use
        audioDurationRef.current = audioBuffer.duration;
        
        await performAnalysis(audioBuffer);
      } catch (error) {
        console.error("Audio decode failed");
        alert("Could not analyze audio file.");
        setIsAnalyzing(false);
      }
    }
  };

  const handleSingleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setIsLoadingFolder(true);
      setSongList([]);

      const validExtensions = ['.mp4', '.mp3', '.m4a', '.wav', '.ogg', '.m4v', '.webm'];
      const loadedSongs: SongMetadata[] = [];

      // Process files
      for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const lowerName = file.name.toLowerCase();
          const isValid = validExtensions.some(ext => lowerName.endsWith(ext));
          
          if (isValid) {
              const isVideo = lowerName.endsWith('.mp4') || lowerName.endsWith('.m4v') || lowerName.endsWith('.webm') || lowerName.endsWith('.mov');
              let thumb: string | null = null;
              
              if (isVideo) {
                 try {
                     thumb = await generateVideoThumbnail(file);
                 } catch (err) {
                     console.warn("Failed to gen thumb", err);
                 }
              }

              loadedSongs.push({
                  id: `${i}-${file.name}`,
                  file: file,
                  name: file.name,
                  thumbnailUrl: thumb,
                  type: isVideo ? 'video' : 'audio'
              });
          }
      }

      setSongList(loadedSongs);
      setIsLoadingFolder(false);
  };

  // Re-analyze when level or key mode changes
  useEffect(() => {
    if (audioBufferRef.current && !isAnalyzing) {
       const timeoutId = setTimeout(() => {
           if (audioBufferRef.current) {
               performAnalysis(audioBufferRef.current);
           }
       }, 100);
       return () => clearTimeout(timeoutId);
    }
  }, [level, keyMode]);

  const playHitSound = (laneIndex: number) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const t = ctx.currentTime;
    
    // Determine note type (Kick, Snare, Hi-hat) based on lane
    let isKick = false;
    let isSnare = false;

    if (keyMode === 5 && laneIndex === 2) isKick = true;
    else if (keyMode === 7 && laneIndex === 3) isKick = true;
    else if (keyMode === 4 && (laneIndex === 1 || laneIndex === 2)) isSnare = true; // Inner keys snare
    else if ((keyMode === 5 || keyMode === 7) && (laneIndex % 2 !== 0)) isSnare = true;

    // DYNAMIC SOUND GENERATION based on soundProfile
    if (soundProfile === 'rock') {
        // ROCK KIT: Deeper kicks, punchy snares
        if (isKick) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.setValueAtTime(100, t);
            osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.3);
            gain.gain.setValueAtTime(getVol(1.0), t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.3);
        } else if (isSnare) {
            const noise = ctx.createBufferSource();
            noise.buffer = getNoiseBuffer(ctx);
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.setValueAtTime(3000, t);
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(getVol(0.8), t);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(t);
            noise.stop(t + 0.2);
        } else {
             // Closed Hat
            const noise = ctx.createBufferSource();
            noise.buffer = getNoiseBuffer(ctx);
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 8000;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(getVol(0.3), t);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(t);
            noise.stop(t + 0.05);
        }
    } else if (soundProfile === 'chiptune') {
        // CHIPTUNE KIT: Square waves and noise bursts
        if (isKick) {
             const osc = ctx.createOscillator();
             osc.type = 'square';
             osc.frequency.setValueAtTime(150, t);
             osc.frequency.linearRampToValueAtTime(10, t + 0.1);
             const gain = ctx.createGain();
             gain.gain.setValueAtTime(getVol(0.6), t);
             gain.gain.linearRampToValueAtTime(0, t + 0.1);
             osc.connect(gain);
             gain.connect(ctx.destination);
             osc.start(t);
             osc.stop(t + 0.1);
        } else if (isSnare) {
             const noise = ctx.createBufferSource();
             noise.buffer = getNoiseBuffer(ctx);
             const gain = ctx.createGain();
             gain.gain.setValueAtTime(getVol(0.6), t);
             gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1); // Short burst
             noise.connect(gain);
             gain.connect(ctx.destination);
             noise.start(t);
             noise.stop(t + 0.1);
        } else {
            // Blip
             const osc = ctx.createOscillator();
             osc.type = 'triangle';
             osc.frequency.setValueAtTime(2000, t);
             const gain = ctx.createGain();
             gain.gain.setValueAtTime(getVol(0.3), t);
             gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
             osc.connect(gain);
             gain.connect(ctx.destination);
             osc.start(t);
             osc.stop(t + 0.05);
        }
    } else {
        // DEFAULT ELECTRONIC KIT (Clean Sine/Noise)
        if (isKick) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.setValueAtTime(150, t);
          osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.5);
          gain.gain.setValueAtTime(getVol(0.8), t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.5);
        } else if (isSnare) {
          const noiseBuffer = getNoiseBuffer(ctx);
          const noise = ctx.createBufferSource();
          noise.buffer = noiseBuffer;
          const noiseFilter = ctx.createBiquadFilter();
          noiseFilter.type = 'highpass';
          noiseFilter.frequency.value = 1000;
          const noiseGain = ctx.createGain();
          noiseGain.gain.setValueAtTime(getVol(0.5), t);
          noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
          
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(250, t);
          const oscGain = ctx.createGain();
          oscGain.gain.setValueAtTime(getVol(0.2), t);
          oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    
          noise.connect(noiseFilter);
          noiseFilter.connect(noiseGain);
          noiseGain.connect(ctx.destination);
          osc.connect(oscGain);
          oscGain.connect(ctx.destination);
          noise.start(t);
          osc.start(t);
          noise.stop(t + 0.2);
          osc.stop(t + 0.2);
        } else {
          // HI-HAT
          const noiseBuffer = getNoiseBuffer(ctx);
          const noise = ctx.createBufferSource();
          noise.buffer = noiseBuffer;
          const noiseFilter = ctx.createBiquadFilter();
          noiseFilter.type = 'highpass';
          noiseFilter.frequency.value = 5000;
          const noiseGain = ctx.createGain();
          noiseGain.gain.setValueAtTime(getVol(0.3), t);
          noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.05); // Short decay
    
          noise.connect(noiseFilter);
          noiseFilter.connect(noiseGain);
          noiseGain.connect(ctx.destination);
          noise.start(t);
          noise.stop(t + 0.05);
        }
    }
  };

  const playOutroSound = () => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const t = ctx.currentTime;
    
    // --- DRUM & CYMBAL OUTRO (3 Seconds) ---
    const playDrum = (type: 'kick' | 'snare' | 'tom' | 'crash', startTime: number, intensity: number = 1.0) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        if (type === 'kick') {
            osc.frequency.setValueAtTime(150, startTime);
            osc.frequency.exponentialRampToValueAtTime(0.01, startTime + 0.5);
            gain.gain.setValueAtTime(getVol(1.0 * intensity), startTime);
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.5);
        } else if (type === 'snare') {
            const noise = ctx.createBufferSource();
            noise.buffer = getNoiseBuffer(ctx);
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 800;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(getVol(0.8 * intensity), startTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.2);
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(startTime);
            noise.stop(startTime + 0.2);
            
            const tone = ctx.createOscillator();
            tone.type = 'triangle';
            tone.frequency.setValueAtTime(180, startTime);
            const toneGain = ctx.createGain();
            toneGain.gain.setValueAtTime(getVol(0.4 * intensity), startTime);
            toneGain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);
            tone.connect(toneGain);
            toneGain.connect(ctx.destination);
            tone.start(startTime);
            tone.stop(startTime + 0.2);
        } else if (type === 'tom') {
             osc.frequency.setValueAtTime(200, startTime);
             osc.frequency.exponentialRampToValueAtTime(60, startTime + 0.3);
             gain.gain.setValueAtTime(getVol(0.7 * intensity), startTime);
             gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
             osc.connect(gain);
             gain.connect(ctx.destination);
             osc.start(startTime);
             osc.stop(startTime + 0.4);
        } else if (type === 'crash') {
            const noise = ctx.createBufferSource();
            noise.buffer = getNoiseBuffer(ctx);
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 2000;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(getVol(1.0 * intensity), startTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, startTime + 2.5); // Long decay
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(startTime);
            noise.stop(startTime + 3.0);
            playDrum('kick', startTime, intensity);
        }
    };

    let ct = t;
    const beat = 0.15; 
    playDrum('snare', ct); ct += beat;
    playDrum('snare', ct); ct += beat;
    playDrum('tom', ct); ct += beat;
    playDrum('tom', ct); ct += beat;
    playDrum('snare', ct); ct += beat/2;
    playDrum('snare', ct); ct += beat/2;
    playDrum('kick', ct); ct += beat;
    playDrum('crash', ct); 
    playDrum('snare', ct);
    ct += 0.2;
    playDrum('crash', ct, 1.2); 
  };

  // Toggle Pause
  const togglePause = useCallback(() => {
    if (status === GameStatus.PLAYING) {
        setStatus(GameStatus.PAUSED);
        pauseTimeRef.current = performance.now();
        if (mediaRef.current) mediaRef.current.pause();
        if (bgVideoRef.current) bgVideoRef.current.pause(); // Sync BG
    } else if (status === GameStatus.PAUSED) {
        setStatus(GameStatus.PLAYING);
        const pauseDuration = performance.now() - pauseTimeRef.current;
        totalPauseDurationRef.current += pauseDuration;
        if (mediaRef.current) mediaRef.current.play().catch(() => {});
        if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {}); // Sync BG
        initAudio(); 
    }
  }, [status]);

  // Handle Outro Transition
  const triggerOutro = useCallback(() => {
      setStatus(GameStatus.OUTRO);
      initAudio(); 
      playOutroSound();
       if (mediaRef.current) mediaRef.current.pause();
       if (bgVideoRef.current) bgVideoRef.current.pause(); // Sync BG
      setTimeout(() => setStatus(GameStatus.FINISHED), 3000);
  }, []);

  // CORE GAME LOGIC
  const triggerLane = useCallback((laneIndex: number) => {
    if (status !== GameStatus.PLAYING || isAutoPlay) return; 
    
    if (activeKeysRef.current[laneIndex]) return;
    activeKeysRef.current[laneIndex] = true;

    const now = performance.now();
    // Find nearest note
    const elapsed = now - startTimeRef.current - totalPauseDurationRef.current;
    
    // Filter for unhit notes
    const notesInLane = notesRef.current.filter(n => n.laneIndex === laneIndex && !n.hit && !n.missed);
    notesInLane.sort((a, b) => b.y - a.y); // Closest to bottom first (highest Y)
    const targetNote = notesInLane[0];

    // HIT LOGIC
    if (targetNote) {
        const dist = Math.abs(targetNote.y - 90);
        let hitType: ScoreRating | null = null;

        if (dist < 6) hitType = ScoreRating.PERFECT; // slightly wider window for feel
        else if (dist < 12) hitType = ScoreRating.GOOD;
        else if (dist < 20) hitType = ScoreRating.BAD;

        if (hitType !== null) {
            playHitSound(laneIndex);

            // NORMAL NOTE HIT
            targetNote.hit = true;
            
            const newEffect: HitEffectData = {
                id: Date.now() + Math.random(),
                laneIndex: laneIndex,
                rating: hitType,
                timestamp: now
            };
            setHitEffects(prev => [...prev, newEffect]);
            
            if (hitType === ScoreRating.PERFECT) {
                setScore(s => s + 100 + (combo > 10 ? 10 : 0));
                setPerfectCount(c => c + 1);
                setHealth(h => Math.min(100, h + 0.5));
                setFeedback({ text: "MAX 100%", color: "text-cyan-300", id: Date.now() });
            } else if (hitType === ScoreRating.GOOD) {
                setScore(s => s + 50);
                setGoodCount(c => c + 1);
                setHealth(h => Math.min(100, h + 0.1));
                setFeedback({ text: "90%", color: "text-green-400", id: Date.now() });
            } else {
                setScore(s => s + 10);
                setCombo(0);
                setFeedback({ text: "10%", color: "text-yellow-400", id: Date.now() });
            }

            if (hitType !== ScoreRating.BAD) {
                setCombo(c => {
                    const newC = c + 1;
                    if (newC > maxCombo) setMaxCombo(newC);
                    setMaxCombo(prev => Math.max(prev, newC));
                    return newC;
                });
            }
        }
    } else {
        // Play hit sound even if no note (empty key press) as requested
        playHitSound(laneIndex);
    }
  }, [status, isAutoPlay, combo, maxCombo, soundProfile]);

  const releaseLane = useCallback((laneIndex: number) => {
    activeKeysRef.current[laneIndex] = false;
  }, []);

  // Touch Event Handler
  const handleTouch = useCallback((e: React.TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    if (!laneContainerRef.current) return;
    
    const rect = laneContainerRef.current.getBoundingClientRect();
    const laneWidth = rect.width / keyMode; // Use dynamic keyMode
    const currentTouchLanes = new Set<number>();

    for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
            const laneIndex = Math.floor(x / laneWidth);
            if (laneIndex >= 0 && laneIndex < keyMode) {
                currentTouchLanes.add(laneIndex);
            }
        }
    }

    currentTouchLanes.forEach(laneIdx => {
        if (!touchedLanesRef.current.has(laneIdx)) triggerLane(laneIdx);
    });

    touchedLanesRef.current.forEach(laneIdx => {
        if (!currentTouchLanes.has(laneIdx)) releaseLane(laneIdx);
    });

    touchedLanesRef.current = currentTouchLanes;

  }, [triggerLane, releaseLane, keyMode]);

  // Game Loop
  const update = useCallback(() => {
    if (status !== GameStatus.PLAYING) return;

    // Background pulse logic
    if (bgRef.current) {
         // Subtle breathing effect
         const time = Date.now() / 1000;
         const scale = 1 + Math.sin(time * 2) * 0.01;
         bgRef.current.style.transform = `scale(${scale})`;
    }

    const now = performance.now();
    const elapsed = now - startTimeRef.current - totalPauseDurationRef.current;
    
    // Progress Bar Logic
    if (progressBarRef.current && audioDurationRef.current > 0) {
        const durationMs = audioDurationRef.current * 1000;
        const progress = Math.min(100, (elapsed / durationMs) * 100);
        progressBarRef.current.style.width = `${progress}%`;
    }
    
    const missThreshold = 115; 
    const currentFallSpeed = BASE_FALL_SPEED_MS / speedMod;

    notesRef.current.forEach(note => {
      // Calculate Y
      const timeSinceSpawn = elapsed - note.timestamp;
      const position = (timeSinceSpawn / currentFallSpeed) * 90;
      note.y = position;

      // AUTO PLAY LOGIC
      if (isAutoPlay && !note.hit && !note.missed) {
          // Normal Auto Hit
          if (position >= 90) {
            note.hit = true;
            activeKeysRef.current[note.laneIndex] = true;
            setTimeout(() => { activeKeysRef.current[note.laneIndex] = false; }, 50);

            playHitSound(note.laneIndex);
            
            setHitEffects(prev => [...prev, { id: Date.now() + Math.random(), laneIndex: note.laneIndex, rating: ScoreRating.PERFECT, timestamp: now }]);
            
            // AUTO PLAY DOES NOT ADD SCORE OR RANK STATS
            setFeedback({ text: "AUTO", color: "text-fuchsia-500", id: Date.now() });
            
            setCombo(c => {
                    const newC = c + 1;
                    setMaxCombo(prev => Math.max(prev, newC));
                    return newC;
            });
          }
      }

      // MISS LOGIC (Head passed threshold without being hit)
      if (!note.hit && !note.missed && position > missThreshold) {
        note.missed = true;
        setMissCount(c => c + 1);
        setCombo(0);
        setHealth(h => Math.max(0, h - 4));
        setFeedback({ text: "MISS", color: "text-red-500", id: Date.now() });
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 200);
      }
    });

    const visibleNotes = notesRef.current.filter(n => n.y > -20 && n.y < 120 && !n.hit);
    setRenderNotes([...visibleNotes]); 

    if (health <= 0) {
      triggerOutro();
      return;
    }
    
    setHitEffects(prev => prev.filter(e => Date.now() - e.id < 500));

    frameRef.current = requestAnimationFrame(update);
  }, [status, health, speedMod, isAutoPlay, combo, maxCombo, triggerOutro, soundProfile]);

  useEffect(() => {
    if (status === GameStatus.PLAYING) {
      frameRef.current = requestAnimationFrame(update);
      if (mediaRef.current) {
        mediaRef.current.play().catch(e => console.error("Local media play error"));
      }
      if (bgVideoRef.current) {
        bgVideoRef.current.play().catch(() => {});
      }
    }
    return () => cancelAnimationFrame(frameRef.current);
  }, [status, update]);

  // Input Handling
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // If settings are open, Escape closes settings first
    if (showKeyConfig && e.key === 'Escape') {
        setShowKeyConfig(false);
        return;
    }

    if (status === GameStatus.MENU || status === GameStatus.TITLE) {
        // Just play sound if pressing keys in menu for fun
        const laneIndex = activeLaneConfig.findIndex(l => l.key === e.key.toLowerCase());
        if (laneIndex !== -1 && audioCtxRef.current) {
            playHitSound(laneIndex);
        }
        return;
    }
    
    if (e.key === 'F1') {
        e.preventDefault();
        setSpeedMod(prev => Math.max(1.0, prev - 0.5));
        setFeedback({ text: "SPEED DOWN", color: "text-white", id: Date.now() });
    }
    if (e.key === 'F2') {
        e.preventDefault();
        setSpeedMod(prev => Math.min(10.0, prev + 0.5));
        setFeedback({ text: "SPEED UP", color: "text-white", id: Date.now() });
    }
    if (e.key === 'F4') {
        e.preventDefault();
        setIsAutoPlay(prev => !prev);
        setFeedback({ text: isAutoPlay ? "AUTO OFF" : "AUTO ON", color: "text-fuchsia-400", id: Date.now() });
    }
    if (e.key === 'F9') {
        e.preventDefault();
        triggerOutro();
        return;
    }
    
    if (e.key === 'Escape') {
        togglePause();
        return;
    }

    const laneIndex = activeLaneConfig.findIndex(l => l.key === e.key.toLowerCase());
    if (laneIndex !== -1) {
        triggerLane(laneIndex);
    }
  }, [status, triggerLane, triggerOutro, togglePause, isAutoPlay, activeLaneConfig, showKeyConfig]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    const laneIndex = activeLaneConfig.findIndex(l => l.key === e.key.toLowerCase());
    if (laneIndex !== -1) {
        releaseLane(laneIndex);
    }
  }, [releaseLane, activeLaneConfig]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  const startCountdownSequence = () => {
    initAudio();
    playUiSound('select');

    if (!localVideoSrc) {
        alert("Please select a track first.");
        return;
    }

    if (!analyzedNotes) {
        alert("Please wait for analysis to complete.");
        return;
    }

    setStartCountdown(3);
    let count = 3;
    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            setStartCountdown(count);
        } else {
            clearInterval(timer);
            setStartCountdown(null);
            startGame();
        }
    }, 1000);
  }

  const startGame = () => {
    // Explicitly map properties
    if (analyzedNotes) {
        notesRef.current = analyzedNotes.map(n => ({
            id: Number(n.id),
            laneIndex: Number(n.laneIndex),
            timestamp: Number(n.timestamp),
            y: Number(n.y),
            hit: Boolean(n.hit),
            missed: Boolean(n.missed)
        }));
    } else {
        notesRef.current = [];
    }

    activeKeysRef.current = new Array(keyMode).fill(false);

    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setHealth(100);
    setMissCount(0);
    setPerfectCount(0);
    setGoodCount(0);
    setHitEffects([]);
    setIsAutoPlay(false);
    totalPauseDurationRef.current = 0;
    
    setStatus(GameStatus.PLAYING);
    startTimeRef.current = performance.now();
  };

  const quitGame = () => {
      playUiSound('select');
      setStatus(GameStatus.MENU);
      setHitEffects([]);
  };

  const getLevelColor = (l: number) => {
      if (l <= 3) return 'border-green-500 text-green-400 shadow-green-500/20';
      if (l <= 6) return 'border-yellow-500 text-yellow-400 shadow-yellow-500/20';
      if (l <= 8) return 'border-orange-500 text-orange-400 shadow-orange-500/20';
      return 'border-red-500 text-red-400 shadow-red-500/20';
  };

  return (
    <div className={`relative w-full h-screen bg-black overflow-hidden text-slate-100 select-none ${isShaking ? 'animate-[shake_0.2s_ease-in-out]' : ''}`}>
      
      {/* BACKGROUND LAYER */}
      <div className="absolute inset-0 z-0 pointer-events-auto bg-slate-950 overflow-hidden" ref={bgRef} style={{ transition: 'transform 0.05s, filter 0.05s' }}>
        
        {status === GameStatus.PLAYING || status === GameStatus.PAUSED || status === GameStatus.OUTRO ? (
             <>
                {/* Visual Background */}
                {mediaType === 'audio' ? (
                     <video
                        ref={bgVideoRef}
                        src="background.mp4"
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="w-full h-full object-cover opacity-60"
                    />
                ) : (
                    <video
                        ref={mediaRef as React.RefObject<HTMLVideoElement>}
                        src={localVideoSrc}
                        className="w-full h-full object-cover opacity-80"
                        onEnded={triggerOutro}
                    />
                )}

                {/* Audio Source (Hidden if audio-only, logic handles sync) */}
                {mediaType === 'audio' && (
                    <audio
                        ref={mediaRef as React.RefObject<HTMLAudioElement>}
                        src={localVideoSrc}
                        onEnded={triggerOutro}
                    />
                )}
            </>
        ) : (
            // VIDEO BACKGROUND FOR MENU/TITLE
            <div className="w-full h-full relative overflow-hidden bg-black">
                 <video
                    src="background.mp4" 
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover opacity-100"
                 />
                 {/* Overlays for text readability but lighter to show background */}
                 <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.4)_100%)]"></div>
            </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-slate-950/20 to-transparent pointer-events-none"></div>
      </div>

      {/* SCANLINES */}
      <div className="scanlines z-50 pointer-events-none opacity-40"></div>

      {/* SETTINGS MENU */}
      {showKeyConfig && (
          <KeyConfigMenu 
            currentKeyMode={keyMode}
            mappings={keyMappings}
            audioSettings={audioSettings}
            onAudioSettingsChange={setAudioSettings}
            onSave={saveKeyMappings}
            onClose={() => setShowKeyConfig(false)}
          />
      )}

      {/* COUNTDOWN */}
      {startCountdown !== null && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="text-[15rem] font-black font-display text-cyan-400 animate-ping">
                  {startCountdown}
              </div>
          </div>
      )}

      {/* OUTRO */}
      {status === GameStatus.OUTRO && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black animate-fade-in duration-1000">
              <div className="flex flex-col items-center animate-bounce-short">
                  <h1 className="text-9xl font-display font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-cyan-500 filter drop-shadow-[0_0_50px_rgba(6,182,212,0.8)]">
                      DJ<span className="text-cyan-400">BIG</span>
                  </h1>
                  <div className="text-2xl font-mono text-cyan-200 tracking-[1em] mt-4 animate-pulse">
                      SESSION COMPLETE
                  </div>
              </div>
          </div>
      )}

      {/* TITLE SCREEN */}
      {status === GameStatus.TITLE && (
          <div className="relative z-30 h-full flex flex-col items-center justify-center animate-fade-in px-4">
              <h1 className="text-7xl md:text-9xl font-display font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-500 tracking-tighter filter drop-shadow-[0_0_25px_rgba(6,182,212,0.6)] mb-2 text-center transform hover:scale-105 transition-transform duration-500 animate-pulse">
                DJ<span className="text-cyan-400">BIG</span>
              </h1>
              
              <div className="mb-12 text-center bg-black/50 backdrop-blur-sm p-4 rounded-lg border border-white/5">
                  <p className="text-cyan-400 font-display font-bold tracking-[0.15em] text-sm md:text-base mb-1">
                      CUSTOM RHYTHM ENGINE
                  </p>
                  <p className="text-slate-400 font-mono text-xs md:text-sm tracking-widest">
                      PLAY WITH YOUR OWN MP4 VIDEO FILES
                  </p>
              </div>
              
              <div className="flex flex-col space-y-6 w-full max-w-sm">
                  <button 
                    onClick={() => { setStatus(GameStatus.MENU); playUiSound('select'); initAudio(); }}
                    onMouseEnter={() => playUiSound('hover')}
                    className="group relative px-8 py-4 bg-slate-900/80 border border-cyan-500/50 hover:bg-cyan-900/50 hover:border-cyan-400 transition-all rounded-lg overflow-hidden"
                  >
                      <div className="absolute inset-0 bg-cyan-400/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500"></div>
                      <span className="relative text-2xl font-display font-bold tracking-[0.2em] text-cyan-100 group-hover:text-white group-hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">START</span>
                  </button>

                  <button 
                    onClick={() => { setStatus(GameStatus.MENU); playUiSound('select'); initAudio(); }}
                    onMouseEnter={() => playUiSound('hover')}
                    className="group relative px-8 py-4 bg-slate-900/80 border border-slate-600 hover:border-fuchsia-400 transition-all rounded-lg"
                  >
                       <span className="text-xl font-display font-bold tracking-[0.2em] text-slate-400 group-hover:text-fuchsia-300">MUSIC LIST</span>
                  </button>

                  <button 
                    onClick={() => { setShowKeyConfig(true); playUiSound('select'); }}
                    onMouseEnter={() => playUiSound('hover')}
                    className="group relative px-8 py-4 bg-slate-900/80 border border-slate-600 hover:border-yellow-400 transition-all rounded-lg"
                  >
                       <span className="text-xl font-display font-bold tracking-[0.2em] text-slate-400 group-hover:text-yellow-300">SETTING</span>
                  </button>

                  <button 
                    onClick={() => window.location.reload()}
                    onMouseEnter={() => playUiSound('hover')}
                    className="group relative px-8 py-4 bg-slate-900/80 border border-slate-600 hover:border-red-500 transition-all rounded-lg"
                  >
                       <span className="text-xl font-display font-bold tracking-[0.2em] text-slate-400 group-hover:text-red-400">EXIT</span>
                  </button>
              </div>
              <div className="mt-12 text-slate-600 font-mono text-xs">VERSION 2.8 // SYSTEM READY</div>
          </div>
      )}

      {/* MAIN MENU (Setup Screen) */}
      {status === GameStatus.MENU && !startCountdown && (
        <div className="relative z-30 h-full flex flex-col items-center justify-center animate-fade-in px-4 overflow-y-auto py-8">
            
          {/* BACK BUTTON */}
          <button 
             onClick={() => { setStatus(GameStatus.TITLE); playUiSound('select'); }}
             className="absolute top-4 left-4 p-2 text-slate-400 hover:text-white flex items-center space-x-2 transition-colors"
          >
             <span className="text-2xl">←</span> <span className="font-display font-bold">BACK</span>
          </button>

          {/* SETTINGS BUTTON */}
          <button 
             onClick={() => setShowKeyConfig(true)}
             className="absolute top-4 right-4 p-2 text-slate-400 hover:text-cyan-400 hover:rotate-90 transition-all duration-500"
          >
             <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>
          </button>

          <h1 className="text-4xl md:text-5xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-500 tracking-tighter filter drop-shadow-[0_0_25px_rgba(6,182,212,0.6)] mb-4 text-center">
            SETUP <span className="text-cyan-400">PHASE</span>
          </h1>
          
          <div className="w-full max-w-2xl space-y-4 p-5 backdrop-blur-xl border border-slate-700 rounded-xl shadow-2xl relative transition-all duration-50 bg-black/80">
            
            {isAnalyzing && (
                <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center rounded-xl p-8 text-center">
                    <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <div className="text-cyan-400 font-mono animate-pulse font-bold text-lg mb-2">
                        ANALYZING AUDIO SPECTRUM...
                    </div>
                </div>
            )}

            {/* FOLDER / FILE INPUT */}
            <div className="animate-fade-in space-y-3">
                <div className="flex justify-between items-end">
                    <label className="text-sm font-bold tracking-widest text-cyan-400 block">SELECT MUSIC SOURCE</label>
                    <div className="flex gap-4">
                        {songList.length > 0 && (
                            <button 
                                onClick={() => { setSongList([]); setLocalFileName(''); setAnalyzedNotes(null); }}
                                className="text-xs text-red-400 hover:text-red-300 underline font-mono"
                            >
                                CLEAR PLAYLIST
                            </button>
                        )}
                    </div>
                </div>

                {songList.length === 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                        {/* SINGLE FILE */}
                        <label 
                            className="flex flex-col items-center justify-center w-full h-20 border-2 border-slate-700 border-dashed rounded cursor-pointer hover:bg-slate-800 hover:border-cyan-500 transition-all bg-slate-900/50 group"
                            onMouseEnter={() => playUiSound('hover')}
                            onClick={() => playUiSound('select')}
                        >
                            <div className="flex flex-col items-center justify-center">
                                <span className="text-2xl mb-1 text-slate-500 group-hover:text-cyan-400">📄</span>
                                <p className="text-xs text-slate-400 font-mono group-hover:text-cyan-300 transition-colors text-center">
                                    LOAD SINGLE FILE<br/>
                                    <span className="text-[10px] opacity-60">(MP4, MP3, WAV, OGG)</span>
                                </p>
                            </div>
                            <input type="file" accept="video/*,audio/*" onChange={handleSingleFileUpload} className="hidden" />
                        </label>

                        {/* FOLDER */}
                        <label 
                            className="flex flex-col items-center justify-center w-full h-20 border-2 border-slate-700 border-dashed rounded cursor-pointer hover:bg-slate-800 hover:border-fuchsia-500 transition-all bg-slate-900/50 group"
                            onMouseEnter={() => playUiSound('hover')}
                            onClick={() => playUiSound('select')}
                        >
                            <div className="flex flex-col items-center justify-center">
                                {isLoadingFolder ? (
                                    <div className="w-6 h-6 border-2 border-fuchsia-500 border-t-transparent rounded-full animate-spin"></div>
                                ) : (
                                    <>
                                        <span className="text-2xl mb-1 text-slate-500 group-hover:text-fuchsia-400">📂</span>
                                        <p className="text-xs text-slate-400 font-mono group-hover:text-fuchsia-300 transition-colors">
                                            LOAD FOLDER
                                        </p>
                                    </>
                                )}
                            </div>
                            {/* @ts-ignore */}
                            <input type="file" webkitdirectory="" directory="" multiple onChange={handleFolderSelect} className="hidden" />
                        </label>
                    </div>
                ) : (
                    // ALBUM GRID
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                        {songList.map((song) => (
                            <div 
                                key={song.id}
                                onClick={() => handleFileSelect(song.file)}
                                onMouseEnter={() => playUiSound('hover')}
                                className={`
                                    relative aspect-square group cursor-pointer rounded-lg overflow-hidden border-2 transition-all
                                    ${localFileName === song.name ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.5)]' : 'border-slate-700 hover:border-white'}
                                `}
                            >
                                {song.thumbnailUrl ? (
                                    <img src={song.thumbnailUrl} alt={song.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                ) : (
                                    <div className="w-full h-full bg-slate-800 flex items-center justify-center group-hover:bg-slate-700">
                                        <div className={`w-12 h-12 rounded-full border-4 border-slate-600 flex items-center justify-center ${localFileName === song.name ? 'animate-spin-slow' : ''}`}>
                                            <div className="w-3 h-3 bg-slate-900 rounded-full"></div>
                                        </div>
                                    </div>
                                )}
                                
                                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80 group-hover:opacity-60 transition-opacity"></div>
                                <div className="absolute bottom-0 left-0 right-0 p-1.5">
                                    <div className="text-[10px] font-bold text-white truncate drop-shadow-md font-display">{song.name}</div>
                                </div>

                                {localFileName === song.name && (
                                    <div className="absolute top-1 right-1 w-2 h-2 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_10px_cyan]"></div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* KEY MODE */}
            <div>
                <label className="text-xs font-bold tracking-widest text-cyan-400 mb-1 block">KEY CONFIGURATION</label>
                <div className="flex space-x-2">
                    {[4, 5, 7].map((k) => (
                        <button
                            key={k}
                            onClick={() => { setKeyMode(k as 4|5|7); playUiSound('select'); }}
                            onMouseEnter={() => playUiSound('hover')}
                            className={`flex-1 py-1.5 text-xs font-display font-bold border rounded transition-all ${
                                keyMode === k
                                ? 'bg-cyan-600 border-cyan-400 text-white shadow-[0_0_10px_rgba(34,211,238,0.4)]' 
                                : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'
                            }`}
                        >
                            {k} KEYS
                        </button>
                    ))}
                </div>
            </div>

            {/* LEVEL SELECTOR */}
            <div>
                <label className="text-xs font-bold tracking-widest text-cyan-400 mb-1 block flex justify-between">
                    <span>LEVEL SELECTION</span>
                    <span className="text-white">{level}</span>
                </label>
                <div className="grid grid-cols-10 gap-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => (
                        <button
                            key={l}
                            onClick={() => { setLevel(l); playUiSound('select'); }}
                            onMouseEnter={() => playUiSound('hover')}
                            className={`aspect-square font-display font-bold text-xs flex items-center justify-center border transition-all rounded ${
                                level === l
                                ? `bg-slate-700 text-white scale-110 z-10 shadow-[0_0_15px_rgba(255,255,255,0.2)] ${getLevelColor(l)}` 
                                : `bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700`
                            }`}
                        >
                            {l}
                        </button>
                    ))}
                </div>
            </div>

            {/* SPEED */}
            <div>
                <div className="flex justify-between mb-1">
                    <label className="text-xs font-bold tracking-widest text-cyan-400">SCROLL SPEED</label>
                    <span className="text-xs font-mono text-white">{speedMod.toFixed(1)}x</span>
                </div>
                <input 
                    type="range" 
                    min="1.0" 
                    max="5.0" 
                    step="0.1"
                    value={speedMod}
                    onChange={(e) => setSpeedMod(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
            </div>
            
            <button 
                onClick={startCountdownSequence}
                onMouseEnter={() => playUiSound('hover')}
                disabled={isAnalyzing || !analyzedNotes}
                className={`w-full py-3 bg-gradient-to-r from-cyan-700 to-blue-700 text-white font-display font-bold text-xl tracking-widest uppercase transition-all transform shadow-[0_0_30px_rgba(6,182,212,0.4)] border border-cyan-400/50
                    ${(isAnalyzing || !analyzedNotes) ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:from-cyan-600 hover:to-blue-600 hover:scale-[1.02] animate-pulse'}
                `}
            >
                {isAnalyzing ? 'ANALYZING...' : 'Game Start!!'}
            </button>
          </div>
        </div>
      )}

      {/* GAMEPLAY UI */}
      {(status === GameStatus.PLAYING || status === GameStatus.PAUSED) && (
        <div className="relative z-20 w-full h-full flex">
            
            <div className="relative h-full w-full md:max-w-lg flex-shrink-0 border-r border-white/10 bg-black/70 backdrop-blur-sm shadow-[10px_0_50px_rgba(0,0,0,0.8)]">
                
                <ScoreBoard score={score} combo={combo} health={health} maxCombo={maxCombo} />

                <div 
                    ref={laneContainerRef}
                    className="absolute top-0 bottom-0 left-2 right-2 md:left-4 md:right-4 flex perspective-1000 outline-none"
                    onTouchStart={handleTouch}
                    onTouchMove={handleTouch}
                    onTouchEnd={handleTouch}
                    onTouchCancel={handleTouch}
                >
                    
                    {/* PROGRESS BAR (GOLD) */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-slate-800 z-40">
                         <div ref={progressBarRef} className="h-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.8)]" style={{ width: '0%' }}></div>
                    </div>

                    {activeLaneConfig.map((lane, index) => (
                        <Lane 
                            key={index} 
                            config={lane} 
                            active={activeKeysRef.current[index]}
                            onTrigger={() => triggerLane(index)}
                            onRelease={() => releaseLane(index)}
                        />
                    ))}

                    {/* Hit Effects */}
                    {hitEffects.map(effect => {
                        const width = 100 / keyMode;
                        const left = effect.laneIndex * width;
                        return (
                            <HitEffect 
                                key={effect.id} 
                                x={`${left}%`} 
                                width={`${width}%`} 
                                rating={effect.rating} 
                            />
                        );
                    })}

                    <div className="absolute w-full h-3 bg-white/40 top-[90%] shadow-[0_0_20px_rgba(255,255,255,0.8)] z-10 mix-blend-overlay pointer-events-none"></div>
                    <div className="absolute w-full h-1 bg-cyan-400 top-[90%] z-10 pointer-events-none"></div>

                    {renderNotes.map((note) => {
                        const config = activeLaneConfig[note.laneIndex];
                        if (!config) return null;
                        return (
                            <Note 
                                key={note.id} 
                                note={note} 
                                totalLanes={keyMode} 
                                color={config.color}
                            />
                        );
                    })}

                    <div className="absolute top-[40%] left-0 right-0 flex flex-col items-center pointer-events-none z-50">
                        {isAutoPlay && (
                             <div className="text-xl font-display font-bold text-fuchsia-500 animate-pulse mb-2 border border-fuchsia-500 px-2 bg-black/50">
                                AUTO PILOT
                             </div>
                        )}
                        {combo > 5 && (
                            <div className="text-8xl font-display font-black text-white/20 animate-pulse">
                                {combo}
                            </div>
                        )}
                        {feedback && (
                            <div key={feedback.id} className={`text-5xl font-black font-display ${feedback.color} animate-bounce-short drop-shadow-[0_0_10px_rgba(0,0,0,1)] stroke-black`}>
                                {feedback.text}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 hidden md:flex flex-col justify-end p-12">
                <div className="text-right pointer-events-none">
                    <h2 className="text-6xl font-display font-bold text-white/40 tracking-widest drop-shadow-md">NEON PROTOCOL</h2>
                    <div className="text-cyan-500/80 font-mono mt-2 bg-black/60 inline-block px-4 py-1 rounded backdrop-blur-md border border-cyan-500/30">
                        SYSTEM LINKED: {localFileName ? localFileName : 'LOCAL_FILE'} // MODE: {keyMode}K // KIT: {soundProfile.toUpperCase()}
                    </div>
                </div>
            </div>
        </div>
      )}
      
      {status === GameStatus.PAUSED && (
        <PauseMenu 
            onResume={() => { togglePause(); playUiSound('select'); }} 
            onSettings={() => { setShowKeyConfig(true); playUiSound('select'); }}
            onQuit={quitGame} 
        />
      )}

      {status === GameStatus.FINISHED && (
        <EndScreen 
            stats={{
                score,
                maxCombo,
                miss: missCount,
                perfect: perfectCount,
                good: goodCount
            }}
            fileName={localFileName}
            onRestart={() => { setStatus(GameStatus.MENU); playUiSound('select'); }}
            onMenu={() => { setStatus(GameStatus.MENU); playUiSound('select'); }}
        />
      )}
    </div>
  );
};

export default App;
