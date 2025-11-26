
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Note as NoteType, 
  ScoreRating, 
  GameStatus,
  HitEffectData,
  LaneConfig,
  SongMetadata,
  KeyMapping,
  AudioSettings,
  ThemeId,
  PlayerStats,
  Theme,
  LayoutSettings
} from './types';
import { 
  LANE_CONFIGS_4,
  LANE_CONFIGS_5,
  LANE_CONFIGS_7,
  BASE_FALL_SPEED_MS,
  DEFAULT_KEY_MAPPINGS,
  GAME_THEMES
} from './constants';
import { Lane } from './components/Lane';
import { EndScreen } from './components/EndScreen';
import { Note } from './components/Note';
import { PauseMenu } from './components/PauseMenu';
import { HitEffect } from './components/HitEffect';
import { KeyConfigMenu } from './components/KeyConfigMenu';
import { ThemeSelectionMenu } from './components/ThemeSelectionMenu';
import { analyzeAudioAndGenerateNotes } from './utils/audioAnalyzer';
import { generateVideoThumbnail } from './utils/mediaUtils';
import { TRANSLATIONS } from './translations';

const audioCtxRef = { current: null as AudioContext | null };

const DEFAULT_STATS: PlayerStats = {
    totalGamesPlayed: 0,
    highestComboEver: 0,
    totalScore: 0,
    totalPerfects: 0,
    highestLevelCleared: 0,
    highestSpeedUsed: 1.0
};

const DEFAULT_LAYOUT: LayoutSettings = {
    lanePosition: 'left',
    enableMenuBackground: true,
    language: 'en'
};

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

  const [level, setLevel] = useState<number>(7); // Default to 7 (Easy in new scale)
  const [speedMod, setSpeedMod] = useState<number>(2.0); // Default 2x speed
  
  // Key Mode State
  const [keyMode, setKeyMode] = useState<4 | 5 | 7>(7);
  const [keyMappings, setKeyMappings] = useState<KeyMapping>(DEFAULT_KEY_MAPPINGS);
  const [showKeyConfig, setShowKeyConfig] = useState<boolean>(false);
  const [showThemeMenu, setShowThemeMenu] = useState<boolean>(false);

  // Audio Settings
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({ masterVolume: 0.5, sfxVolume: 1.0 });
  
  // Layout Settings
  const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>(DEFAULT_LAYOUT);

  // Theme & Progress System
  const [currentThemeId, setCurrentThemeId] = useState<ThemeId>('ignore');
  const [unlockedThemes, setUnlockedThemes] = useState<Set<ThemeId>>(new Set(['neon', 'ignore', 'titan', 'queen']));
  const [playerStats, setPlayerStats] = useState<PlayerStats>(DEFAULT_STATS);

  // Translations Helper
  const t = TRANSLATIONS[layoutSettings.language];
  const fontClass = layoutSettings.language === 'th' ? 'font-thai' : 'font-display';

  // Ref to hold audio settings for access within game loop/closures without dependency issues
  const audioSettingsRef = useRef<AudioSettings>(audioSettings);

  // Update ref and media volume when state changes
  useEffect(() => {
      audioSettingsRef.current = audioSettings;
      if (mediaRef.current) {
          mediaRef.current.volume = audioSettings.masterVolume;
      }
  }, [audioSettings]);

  // Load Persistence Data
  useEffect(() => {
      // Keys
      const storedKeys = localStorage.getItem('djbig_key_config');
      if (storedKeys) {
          try { setKeyMappings(JSON.parse(storedKeys)); } catch (e) { console.error("Failed to load keys", e); }
      }

      // Stats
      const storedStats = localStorage.getItem('djbig_player_stats');
      if (storedStats) {
          try { setPlayerStats(JSON.parse(storedStats)); } catch (e) { console.error("Failed to load stats", e); }
      }

      // Themes
      setUnlockedThemes(new Set(['neon', 'ignore', 'titan', 'queen']));

      // Active Theme
      const storedActiveTheme = localStorage.getItem('djbig_active_theme');
      if (storedActiveTheme === 'neon' || storedActiveTheme === 'ignore' || storedActiveTheme === 'titan' || storedActiveTheme === 'queen') {
          setCurrentThemeId(storedActiveTheme);
      } else {
          setCurrentThemeId('ignore');
      }

      // Layout Settings
      const storedLayout = localStorage.getItem('djbig_layout_settings');
      if (storedLayout) {
          try { 
            const parsed = JSON.parse(storedLayout);
            setLayoutSettings({...DEFAULT_LAYOUT, ...parsed}); 
          } catch (e) { console.error("Failed to load layout", e); }
      }
  }, []);

  const saveKeyMappings = (newMappings: KeyMapping) => {
      setKeyMappings(newMappings);
      localStorage.setItem('djbig_key_config', JSON.stringify(newMappings));
  };

  const handleLayoutChange = (newLayout: LayoutSettings) => {
      setLayoutSettings(newLayout);
      localStorage.setItem('djbig_layout_settings', JSON.stringify(newLayout));
  };

  const handleSelectTheme = (id: ThemeId) => {
      setCurrentThemeId(id);
      localStorage.setItem('djbig_active_theme', id);
      playUiSound('select');
  };

  const activeThemeObj = useMemo(() => {
      return GAME_THEMES.find(t => t.id === currentThemeId) || GAME_THEMES[0];
  }, [currentThemeId]);

  // Unlock Logic - Runs when game finishes
  const checkUnlocks = (finalScore: number, finalMaxCombo: number, finalPerfects: number) => {
      let newStats = { ...playerStats };
      newStats.totalGamesPlayed += 1;
      newStats.totalScore += finalScore;
      newStats.totalPerfects += finalPerfects;
      newStats.highestComboEver = Math.max(newStats.highestComboEver, finalMaxCombo);
      newStats.highestLevelCleared = Math.max(newStats.highestLevelCleared, level);
      newStats.highestSpeedUsed = Math.max(newStats.highestSpeedUsed, speedMod);
      
      setPlayerStats(newStats);
      localStorage.setItem('djbig_player_stats', JSON.stringify(newStats));
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
        // ROCK KIT
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
        // CHIPTUNE KIT
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
        // DEFAULT ELECTRONIC KIT
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
    // ... [Same Outro logic] ...
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
        }
    };
    // Simple outro
    let ct = t;
    playDrum('snare', ct); ct += 0.15;
    playDrum('snare', ct); ct += 0.15;
    playDrum('kick', ct); ct += 0.15;
    playDrum('crash', ct); 
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
      
      // Perform unlock check before switching to EndScreen so visual unlocks are ready if needed
      if (!isAutoPlay) {
          checkUnlocks(score, maxCombo, perfectCount);
      }
      
      setTimeout(() => setStatus(GameStatus.FINISHED), 3000);
  }, [score, maxCombo, perfectCount, isAutoPlay, playerStats, unlockedThemes, level, speedMod]);

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
                setFeedback({ text: "MAX 100%", color: "text-amber-100", id: Date.now() });
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
            setFeedback({ text: t.AUTO_PILOT, color: "text-fuchsia-500", id: Date.now() });
            
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
  }, [status, health, speedMod, isAutoPlay, combo, maxCombo, triggerOutro, soundProfile, t]);

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
    if ((showKeyConfig || showThemeMenu) && e.key === 'Escape') {
        setShowKeyConfig(false);
        setShowThemeMenu(false);
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
  }, [status, triggerLane, triggerOutro, togglePause, isAutoPlay, activeLaneConfig, showKeyConfig, showThemeMenu]);

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

  const DIFFICULTY_OPTIONS = [
      { label: t.EASY, value: 7, color: 'border-green-500 text-green-400 shadow-green-500/20' },
      { label: t.NORMAL, value: 8, color: 'border-yellow-500 text-yellow-400 shadow-yellow-500/20' },
      { label: t.HARD, value: 9, color: 'border-orange-500 text-orange-400 shadow-orange-500/20' },
      { label: t.EXPERT, value: 10, color: 'border-red-500 text-red-500 shadow-red-500/20' }
  ];

  const getCurrentDifficultyLabel = () => {
      const diff = DIFFICULTY_OPTIONS.find(d => d.value === level);
      return diff ? diff.label : t.NORMAL;
  };

  // Helper render for lanes to avoid duplication
  const renderLanes = () => (
    <div 
        ref={laneContainerRef}
        className="relative flex-1 bg-black/80 flex perspective-1000 outline-none overflow-hidden h-full"
        onTouchStart={handleTouch}
        onTouchMove={handleTouch}
        onTouchEnd={handleTouch}
        onTouchCancel={handleTouch}
    >
        {/* Progress Bar */}
        <div className="absolute top-0 left-0 w-full h-1 bg-slate-800 z-40">
             <div ref={progressBarRef} className="h-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]" style={{ width: '0%' }}></div>
        </div>

        {activeLaneConfig.map((lane, index) => (
            <Lane 
                key={index} 
                config={lane} 
                active={activeKeysRef.current[index]}
                onTrigger={() => triggerLane(index)}
                onRelease={() => releaseLane(index)}
                theme={activeThemeObj}
            />
        ))}

        {/* JUDGE LINE (Dynamic per theme) */}
        {currentThemeId === 'ignore' ? (
             <div className="absolute bottom-24 left-0 w-full h-1 bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.9)] z-10 opacity-80 pointer-events-none"></div>
        ) : currentThemeId === 'titan' ? (
             <div className="absolute bottom-20 left-0 w-full h-[2px] bg-amber-500/80 shadow-[0_0_10px_rgba(245,158,11,0.5)] z-10 pointer-events-none"></div>
        ) : currentThemeId === 'queen' ? (
             <div className="absolute bottom-16 left-0 w-full h-[2px] bg-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.8)] z-10 pointer-events-none"></div>
        ) : (
             <div className="absolute bottom-20 left-0 w-full h-px bg-white/20 pointer-events-none"></div>
        )}

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

        {/* Notes */}
        {renderNotes.map((note) => {
            const config = activeLaneConfig[note.laneIndex];
            if (!config) return null;
            return (
                <Note 
                    key={note.id} 
                    note={note} 
                    totalLanes={keyMode} 
                    color={config.color}
                    theme={activeThemeObj}
                />
            );
        })}

        {/* CENTER HUD: COMBO & JUDGMENT */}
        <div className="absolute top-[30%] left-0 right-0 flex flex-col items-center pointer-events-none z-50">
            {isAutoPlay && (
                 <div className={`text-xl ${fontClass} font-bold text-fuchsia-500 animate-pulse mb-2 border border-fuchsia-500 px-2 bg-black/50`}>
                    {t.AUTO_PILOT}
                 </div>
            )}
            
            {/* COMBO COUNTER */}
            <div className="flex flex-col items-center">
                <div className={`text-sm font-bold text-slate-500/50 tracking-[0.3em] mb-[-10px] ${fontClass}`}>{t.COMBO}</div>
                <div 
                    key={combo} 
                    className={`text-9xl font-display font-black italic tracking-tighter opacity-20 ${combo > 0 ? 'animate-cyber-slam' : ''}`}
                >
                    {combo}
                </div>
            </div>
            
            {/* JUDGMENT TEXT */}
            {feedback && (
                <div key={feedback.id} className={`mt-8 text-5xl font-black font-display italic ${feedback.color} animate-bounce-short drop-shadow-[0_0_10px_rgba(0,0,0,1)] stroke-black`}>
                    {feedback.text}
                </div>
            )}
        </div>
    </div>
  );

  // RENDER THEME FRAMES
  const renderGameFrame = () => {
    // 1. HANDHELD (IGNORE PROTOCOL)
    if (currentThemeId === 'ignore') {
        return (
            <div className={`
                relative h-full md:max-w-lg w-full flex-shrink-0 z-20 
                overflow-hidden border-x-[4px] border-slate-300 bg-slate-900 shadow-[0_0_60px_rgba(0,0,0,0.9)]
                flex flex-col
            `}>
                <div className="relative flex-1 flex w-full">
                    {/* LEFT DECORATION */}
                    <div className="w-4 bg-slate-800 border-r border-slate-700 relative">
                            <div className="absolute bottom-20 left-1 w-2 h-32 bg-red-900/50 rounded-full animate-pulse"></div>
                    </div>

                    {/* GAMEPLAY AREA */}
                    {renderLanes()}

                    {/* RIGHT SIDEBAR: VERTICAL GAUGE */}
                    <div className="w-6 bg-slate-900 border-l border-slate-700 relative flex flex-col justify-end p-0.5">
                        <div className={`absolute top-2 left-0 w-full text-[10px] text-center font-bold text-slate-500 vertical-text ${fontClass}`} style={{writingMode: 'vertical-rl'}}>{t.GROOVE}</div>
                        <div className="w-full bg-slate-800 rounded-sm overflow-hidden h-[80%] relative border border-slate-700">
                                <div className="absolute bottom-0 left-0 w-full transition-all duration-200 bg-gradient-to-t from-red-500 via-yellow-400 to-green-500" style={{ height: `${health}%` }}></div>
                        </div>
                        <div className={`mt-1 w-full h-1 ${health > 90 ? 'bg-cyan-400 animate-pulse' : 'bg-slate-700'}`}></div>
                    </div>
                </div>

                {/* BOTTOM DASHBOARD */}
                <div className="h-16 bg-gradient-to-b from-slate-200 to-slate-400 relative flex items-center justify-between px-4 border-t-4 border-slate-400 shadow-inner">
                        <div className="flex flex-col items-center bg-slate-800/80 p-1 rounded border border-slate-600 shadow-inner scale-75 origin-left">
                            <div className={`text-[8px] text-slate-400 font-bold ${fontClass}`}>{t.SCROLL_SPEED}</div>
                            <div className="text-sm font-display text-white">{speedMod.toFixed(2)}</div>
                        </div>
                        <div className="flex flex-col items-center bg-black px-3 py-1 rounded border-2 border-slate-500 shadow-[inset_0_0_10px_rgba(0,0,0,0.8)]">
                            <div className={`text-[8px] text-red-900 font-bold tracking-widest w-full text-center ${fontClass}`}>{t.SCORE}</div>
                            <div className="font-mono text-2xl text-red-600 font-bold tracking-widest drop-shadow-[0_0_5px_rgba(220,38,38,0.8)]">
                                {score.toString().padStart(7, '0')}
                            </div>
                        </div>
                        <div className="flex space-x-1 scale-75 origin-right">
                            <div className="w-8 h-8 bg-slate-300 rounded shadow-[0_2px_0_rgba(0,0,0,0.2)]"></div>
                            <div className="w-8 h-8 bg-slate-300 rounded shadow-[0_2px_0_rgba(0,0,0,0.2)]"></div>
                        </div>
                </div>
            </div>
        );
    } 
    // 2. INDUSTRIAL (TITAN CONSTRUCT)
    else if (currentThemeId === 'titan') {
        return (
             <div className={`
                relative h-full md:max-w-lg w-full flex-shrink-0 z-20 
                overflow-hidden bg-slate-900 shadow-[0_0_60px_rgba(245,158,11,0.1)]
                flex flex-col border-x-8 border-slate-800
            `}>
                {/* Top Industrial Bar */}
                <div className="w-full h-16 bg-slate-800 border-b-2 border-amber-600/50 flex items-center justify-between px-4 relative">
                     {/* Caution Stripes */}
                     <div className="absolute bottom-0 left-0 w-full h-1 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,#f59e0b_10px,#f59e0b_20px)] opacity-50"></div>
                     
                     <div className="flex flex-col">
                        <div className={`text-[10px] text-amber-500 font-bold tracking-widest ${fontClass}`}>{t.SYSTEM_INTEGRITY}</div>
                        <div className="w-32 h-3 bg-slate-950 border border-slate-600 mt-1">
                            <div className={`h-full transition-all duration-200 ${health < 30 ? 'bg-red-500' : 'bg-amber-500'}`} style={{width: `${health}%`}}></div>
                        </div>
                     </div>
                     <div className="text-right">
                        <div className={`text-[10px] text-amber-500 font-bold tracking-widest ${fontClass}`}>{t.SCORE_OUTPUT}</div>
                        <div className="text-2xl font-mono font-bold text-amber-100">{score.toString().padStart(7, '0')}</div>
                     </div>
                </div>

                {/* Gameplay Area */}
                <div className="flex-1 relative bg-slate-900 border-l border-r border-slate-800">
                    {/* Mesh Pattern BG */}
                    <div className="absolute inset-0 opacity-10" style={{backgroundImage: 'radial-gradient(circle, #78716c 1px, transparent 1px)', backgroundSize: '20px 20px'}}></div>
                    {renderLanes()}
                </div>
                
                {/* Bottom Mechanical Lip */}
                <div className="h-4 bg-slate-800 border-t-2 border-amber-600/30 flex justify-center">
                    <div className="w-1/3 h-full bg-slate-700 rounded-b-lg"></div>
                </div>
            </div>
        );
    }
    // 3. ROYAL (QUEEN PROTOCOL) - BLACK/PURPLE/PINK
    else if (currentThemeId === 'queen') {
        return (
            <div className={`
                relative h-full md:max-w-lg w-full flex-shrink-0 z-20 
                overflow-hidden bg-gradient-to-b from-black via-purple-950 to-pink-900 shadow-[0_0_60px_rgba(236,72,153,0.3)]
                flex flex-col border-x-4 border-pink-800
            `}>
                {/* Top Royal Stats */}
                <div className="w-full py-4 px-6 flex justify-between items-center bg-black/60 backdrop-blur-md border-b border-pink-800">
                    <div className="flex flex-col">
                        <div className={`text-[10px] text-pink-400 font-serif tracking-widest uppercase ${fontClass}`}>{t.GRACE}</div>
                         <div className="w-32 h-2 bg-purple-950 border border-purple-700 rounded-full mt-1 overflow-hidden">
                            <div className={`h-full transition-all duration-200 bg-gradient-to-r from-purple-600 to-pink-500`} style={{width: `${health}%`}}></div>
                        </div>
                    </div>
                    <div className="flex flex-col items-end">
                        <div className={`text-[10px] text-pink-400 font-serif tracking-widest uppercase ${fontClass}`}>{t.POWER}</div>
                        <div className="text-3xl font-display font-bold text-pink-100 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)]">
                            {score.toString().padStart(7, '0')}
                        </div>
                    </div>
                </div>

                {/* Gameplay Area with Elegant Side Bars */}
                <div className="flex-1 relative flex">
                     {/* Left Pillar */}
                    <div className="w-2 h-full bg-gradient-to-b from-purple-900 via-pink-900 to-purple-900"></div>
                    
                    {/* Main Lane */}
                    <div className="flex-1 relative bg-black/40">
                         {/* Subtle Diamond Pattern BG */}
                        <div className="absolute inset-0 opacity-20" style={{backgroundImage: 'linear-gradient(135deg, #be185d 25%, transparent 25%), linear-gradient(225deg, #be185d 25%, transparent 25%), linear-gradient(45deg, #be185d 25%, transparent 25%), linear-gradient(315deg, #be185d 25%, transparent 25%)', backgroundPosition: '10px 0, 10px 0, 0 0, 0 0', backgroundSize: '20px 20px', backgroundRepeat: 'repeat'}}></div>
                        {renderLanes()}
                    </div>

                    {/* Right Pillar */}
                    <div className="w-2 h-full bg-gradient-to-b from-purple-900 via-pink-900 to-purple-900"></div>
                </div>

                 {/* Bottom Decoration */}
                 <div className="h-2 w-full bg-gradient-to-r from-purple-900 via-pink-600 to-purple-900"></div>
            </div>
        );
    }
    // 4. CLASSIC (NEON CORE)
    else {
        return (
            <div className={`
                relative h-full md:max-w-lg w-full flex-shrink-0 z-20 
                overflow-hidden border-x-[4px] border-slate-800 bg-black/80 shadow-[0_0_60px_rgba(6,182,212,0.2)]
                flex flex-col
            `}>
                {/* Top Stats Bar for Classic View */}
                <div className="w-full flex justify-between items-start p-4 bg-gradient-to-b from-slate-900 to-transparent z-30 pointer-events-none border-b border-white/10">
                        <div className="w-1/3">
                        <div className={`text-xs text-cyan-400 font-bold ${fontClass}`}>{t.INTEGRITY}</div>
                        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-600">
                            <div className={`h-full transition-all duration-200 ${health < 30 ? 'bg-red-500' : 'bg-cyan-500'}`} style={{width: `${health}%`}}></div>
                        </div>
                        </div>
                        <div className="w-1/3 text-right">
                        <div className={`text-xs text-cyan-400 font-bold ${fontClass}`}>{t.SCORE}</div>
                        <div className="text-4xl font-mono text-white glow-text">{score.toString().padStart(7, '0')}</div>
                        </div>
                </div>

                {/* Gameplay Area - Full Height */}
                <div className="flex-1 relative bg-black/50 backdrop-blur-sm">
                    {renderLanes()}
                </div>
                
                {/* Simple Bottom Line */}
                <div className="h-2 bg-gradient-to-r from-cyan-500 to-blue-500 w-full shadow-[0_0_20px_rgba(6,182,212,0.5)]"></div>
            </div>
        );
    }
  };

  return (
    <div className={`relative w-full h-screen bg-black overflow-hidden text-slate-100 select-none ${isShaking ? 'animate-[shake_0.2s_ease-in-out]' : ''}`}>
      
      {/* BACKGROUND LAYER */}
      <div className="absolute inset-0 z-0 pointer-events-auto bg-slate-950 overflow-hidden" ref={bgRef} style={{ transition: 'transform 0.05s, filter 0.05s' }}>
        
        {status === GameStatus.PLAYING || status === GameStatus.PAUSED || status === GameStatus.OUTRO ? (
             <>
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

                {mediaType === 'audio' && (
                    <audio
                        ref={mediaRef as React.RefObject<HTMLAudioElement>}
                        src={localVideoSrc}
                        onEnded={triggerOutro}
                    />
                )}
            </>
        ) : (
            <div className="w-full h-full relative overflow-hidden bg-black">
                 {layoutSettings.enableMenuBackground && (
                    <video
                        src="background.mp4" 
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover opacity-100"
                    />
                 )}
                 <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.4)_100%)]"></div>
            </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-slate-950/20 to-transparent pointer-events-none"></div>
      </div>

      <div className="scanlines z-50 pointer-events-none opacity-40"></div>

      {/* OVERLAY MENUS */}
      {showKeyConfig && (
          <KeyConfigMenu 
            currentKeyMode={keyMode}
            mappings={keyMappings}
            audioSettings={audioSettings}
            onAudioSettingsChange={setAudioSettings}
            layoutSettings={layoutSettings}
            onLayoutSettingsChange={handleLayoutChange}
            onSave={saveKeyMappings}
            onClose={() => setShowKeyConfig(false)}
            t={t}
            fontClass={fontClass}
          />
      )}

      {showThemeMenu && (
          <ThemeSelectionMenu
            unlockedThemes={unlockedThemes}
            currentTheme={currentThemeId}
            onSelectTheme={handleSelectTheme}
            onClose={() => setShowThemeMenu(false)}
            t={t}
            fontClass={fontClass}
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
                  <div className={`text-2xl font-mono text-cyan-200 tracking-[1em] mt-4 animate-pulse ${fontClass}`}>
                      {t.MISSION_RESULTS}
                  </div>
              </div>
          </div>
      )}

      {/* TITLE SCREEN & MAIN MENU */}
      {/* ... [Title and Menu logic is largely same, condensed for XML space if untouched, but including full for safety] ... */}
      {status === GameStatus.TITLE && (
          <div className="relative z-30 h-full flex flex-col items-center justify-center animate-fade-in px-4">
              <h1 className="text-7xl md:text-9xl font-display font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-500 tracking-tighter filter drop-shadow-[0_0_25px_rgba(6,182,212,0.6)] mb-2 text-center transform hover:scale-105 transition-transform duration-500 animate-pulse">
                DJ<span className="text-cyan-400">BIG</span>
              </h1>
              
              <div className="mb-12 text-center bg-black/50 backdrop-blur-sm p-4 rounded-lg border border-white/5">
                  <p className={`text-cyan-400 font-bold tracking-[0.15em] text-sm md:text-base mb-1 ${fontClass}`}>
                      {t.SUBTITLE}
                  </p>
                  <p className={`text-slate-400 font-mono text-xs md:text-sm tracking-widest ${fontClass}`}>
                      {t.SUBTITLE_2}
                  </p>
              </div>
              
              <div className="flex flex-col space-y-6 w-full max-w-sm">
                  <button 
                    onClick={() => { setStatus(GameStatus.MENU); playUiSound('select'); initAudio(); }}
                    onMouseEnter={() => playUiSound('hover')}
                    className="group relative px-8 py-4 bg-slate-900/80 border border-cyan-500/50 hover:bg-cyan-900/50 hover:border-cyan-400 transition-all rounded-lg overflow-hidden"
                  >
                      <div className="absolute inset-0 bg-cyan-400/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500"></div>
                      <span className={`relative text-2xl font-bold tracking-[0.2em] text-cyan-100 group-hover:text-white group-hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.8)] ${fontClass}`}>{t.START}</span>
                  </button>

                  <button 
                    onClick={() => { setShowThemeMenu(true); playUiSound('select'); }}
                    onMouseEnter={() => playUiSound('hover')}
                    className="group relative px-8 py-4 bg-slate-900/80 border border-slate-600 hover:border-purple-400 transition-all rounded-lg"
                  >
                       <span className={`text-xl font-bold tracking-[0.2em] text-slate-400 group-hover:text-purple-300 ${fontClass}`}>{t.CUSTOMIZE}</span>
                  </button>

                  <button 
                    onClick={() => { setShowKeyConfig(true); playUiSound('select'); }}
                    onMouseEnter={() => playUiSound('hover')}
                    className="group relative px-8 py-4 bg-slate-900/80 border border-slate-600 hover:border-yellow-400 transition-all rounded-lg"
                  >
                       <span className={`text-xl font-bold tracking-[0.2em] text-slate-400 group-hover:text-yellow-300 ${fontClass}`}>{t.SETTING}</span>
                  </button>

                  <button 
                    onClick={() => window.location.reload()}
                    onMouseEnter={() => playUiSound('hover')}
                    className="group relative px-8 py-4 bg-slate-900/80 border border-slate-600 hover:border-red-500 transition-all rounded-lg"
                  >
                       <span className={`text-xl font-bold tracking-[0.2em] text-slate-400 group-hover:text-red-400 ${fontClass}`}>{t.EXIT}</span>
                  </button>
              </div>
          </div>
      )}

      {status === GameStatus.MENU && !startCountdown && (
        <div className="relative z-30 h-full flex flex-col items-center justify-center animate-fade-in px-4 overflow-y-auto py-8">
            {/* ... (Existing Menu JSX remains same) ... */}
          <button 
             onClick={() => { setStatus(GameStatus.TITLE); playUiSound('select'); }}
             className="absolute top-4 left-4 p-2 text-slate-400 hover:text-white flex items-center space-x-2 transition-colors"
          >
             <span className="text-2xl">←</span> <span className={`font-bold ${fontClass}`}>{t.BACK}</span>
          </button>

           <button 
             onClick={() => setShowThemeMenu(true)}
             className="absolute top-4 right-16 p-2 text-slate-400 hover:text-purple-400 transition-all duration-300 flex items-center space-x-2"
          >
             <span className={`font-bold text-sm hidden md:inline ${fontClass}`}>{t.CUSTOMIZE}</span>
             <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor"><path d="M12,22c4.97,0,9-4.03,9-9c0-4.97-4.03-9-9-9c-0.93,0-1.83,0.14-2.68,0.4c-0.61,0.18-0.95,0.83-0.77,1.44 c0.12,0.41,0.5,0.69,0.92,0.69c0.17,0,0.34-0.05,0.5-0.1C10.59,6.17,11.27,6,12,6c3.31,0,6,2.69,6,6c0,3.31-2.69,6-6,6 c-3.31,0-6-2.69-6-6c0-1.07,0.28-2.07,0.77-2.94C7.14,8.42,6.92,7.63,6.29,7.36C5.7,7.11,5.01,7.27,4.6,7.76 C3.57,9,2.98,10.45,3.01,12.04C3.06,17.26,7.5,21.75,12.72,21.99C17.94,22.23,22,17.88,22,12.65V12c0-0.55-0.45-1-1-1s-1,0.45-1,1 v0.65C20,16.89,16.33,20.08,12,20.08v0.01c-3.15,0-5.88-1.74-7.24-4.29l0,0l2.7-2.7c0.39-0.39,0.39-1.02,0-1.41 s-1.02-0.39-1.41,0l-2.7,2.7C2.45,13.43,2,12.74,2,12c0-0.55-0.45-1-1-1s-1,0.45-1,1c0,0.99,0.16,1.93,0.45,2.81l2.7-2.7 c0.39-0.39,1.02-0.39,1.41,0s0.39,1.02,0,1.41l-2.7,2.7C4.16,19.82,7.73,22,12,22z"/></svg>
          </button>

          <button 
             onClick={() => setShowKeyConfig(true)}
             className="absolute top-4 right-4 p-2 text-slate-400 hover:text-cyan-400 hover:rotate-90 transition-all duration-500"
          >
             <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12-0.61l1.92,3.32c0.12-0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>
          </button>

          <h1 className="text-4xl md:text-5xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-500 tracking-tighter filter drop-shadow-[0_0_25px_rgba(6,182,212,0.6)] mb-4 text-center">
            SETUP <span className="text-cyan-400">PHASE</span>
          </h1>
          
          <div className="w-full max-w-2xl space-y-4 p-5 backdrop-blur-xl border border-slate-700 rounded-xl shadow-2xl relative transition-all duration-50 bg-black/80">
            {isAnalyzing && (
                <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center rounded-xl p-8 text-center">
                    <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <div className={`text-cyan-400 font-mono animate-pulse font-bold text-lg mb-2 ${fontClass}`}>
                        {t.ANALYZING}
                    </div>
                </div>
            )}
            
            {/* ... (Menu options truncated for brevity, assume same as before) ... */}
            <div className="animate-fade-in space-y-3">
                <div className="flex justify-between items-end">
                    <label className={`text-sm font-bold tracking-widest text-cyan-400 block ${fontClass}`}>{t.SELECT_SOURCE}</label>
                    <div className="flex gap-4">
                        {songList.length > 0 && (
                            <button onClick={() => { setSongList([]); setLocalFileName(''); setAnalyzedNotes(null); }} className={`text-xs text-red-400 hover:text-red-300 underline ${fontClass}`}>{t.CLEAR_PLAYLIST}</button>
                        )}
                    </div>
                </div>
                {songList.length === 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                        <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-slate-700 border-dashed rounded cursor-pointer hover:bg-slate-800 hover:border-cyan-500 transition-all bg-slate-900/50 group" onMouseEnter={() => playUiSound('hover')} onClick={() => playUiSound('select')}>
                            <div className="flex flex-col items-center justify-center">
                                <span className="text-2xl mb-1 text-slate-500 group-hover:text-cyan-400">📄</span>
                                <p className={`text-xs text-slate-400 ${fontClass} group-hover:text-cyan-300 transition-colors text-center`}>{t.LOAD_SINGLE}<br/><span className="text-[10px] opacity-60 font-mono">(MP4, MP3, WAV, OGG)</span></p>
                            </div>
                            <input type="file" accept="video/*,audio/*" onChange={handleSingleFileUpload} className="hidden" />
                        </label>
                        <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-slate-700 border-dashed rounded cursor-pointer hover:bg-slate-800 hover:border-fuchsia-500 transition-all bg-slate-900/50 group" onMouseEnter={() => playUiSound('hover')} onClick={() => playUiSound('select')}>
                            <div className="flex flex-col items-center justify-center">
                                {isLoadingFolder ? <div className="w-6 h-6 border-2 border-fuchsia-500 border-t-transparent rounded-full animate-spin"></div> : <><span className="text-2xl mb-1 text-slate-500 group-hover:text-fuchsia-400">📂</span><p className={`text-xs text-slate-400 ${fontClass} group-hover:text-fuchsia-300 transition-colors`}>{t.LOAD_FOLDER}</p></>}
                            </div>
                            {/* @ts-ignore */}
                            <input type="file" webkitdirectory="" directory="" multiple onChange={handleFolderSelect} className="hidden" />
                        </label>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                        {songList.map((song) => (
                            <div key={song.id} onClick={() => handleFileSelect(song.file)} onMouseEnter={() => playUiSound('hover')} className={`relative aspect-square group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${localFileName === song.name ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.5)]' : 'border-slate-700 hover:border-white'}`}>
                                {song.thumbnailUrl ? <img src={song.thumbnailUrl} alt={song.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" /> : <div className="w-full h-full bg-slate-800 flex items-center justify-center group-hover:bg-slate-700"><div className={`w-12 h-12 rounded-full border-4 border-slate-600 flex items-center justify-center ${localFileName === song.name ? 'animate-spin-slow' : ''}`}><div className="w-3 h-3 bg-slate-900 rounded-full"></div></div></div>}
                                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80 group-hover:opacity-60 transition-opacity"></div>
                                <div className="absolute bottom-0 left-0 right-0 p-1.5"><div className="text-[10px] font-bold text-white truncate drop-shadow-md font-display">{song.name}</div></div>
                                {localFileName === song.name && <div className="absolute top-1 right-1 w-2 h-2 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_10px_cyan]"></div>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            
            <div>
                <label className={`text-xs font-bold tracking-widest text-cyan-400 mb-1 block ${fontClass}`}>{t.KEY_CONFIG}</label>
                <div className="flex space-x-2">
                    {[4, 5, 7].map((k) => (
                        <button key={k} onClick={() => { setKeyMode(k as 4|5|7); playUiSound('select'); }} onMouseEnter={() => playUiSound('hover')} className={`flex-1 py-1.5 text-xs font-display font-bold border rounded transition-all ${keyMode === k ? 'bg-cyan-600 border-cyan-400 text-white shadow-[0_0_10px_rgba(34,211,238,0.4)]' : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'}`}>{k} KEYS</button>
                    ))}
                </div>
            </div>

            {/* NEW DIFFICULTY SELECTOR */}
            <div>
                <label className={`text-xs font-bold tracking-widest text-cyan-400 mb-1 block flex justify-between ${fontClass}`}><span>{t.LEVEL}</span><span className="text-white font-display font-bold">{getCurrentDifficultyLabel()}</span></label>
                <div className="grid grid-cols-4 gap-2">
                    {DIFFICULTY_OPTIONS.map((diff) => (
                        <button 
                            key={diff.value} 
                            onClick={() => { setLevel(diff.value); playUiSound('select'); }} 
                            onMouseEnter={() => playUiSound('hover')} 
                            className={`
                                py-3 font-display font-bold text-xs border transition-all rounded flex items-center justify-center
                                ${level === diff.value 
                                    ? `bg-slate-800 scale-105 z-10 ${diff.color}` 
                                    : 'bg-slate-900 border-slate-700 text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                                }
                            `}
                        >
                            {diff.label}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <div className="flex justify-between mb-1"><label className={`text-xs font-bold tracking-widest text-cyan-400 ${fontClass}`}>{t.SCROLL_SPEED}</label><span className="text-xs font-mono text-white">{speedMod.toFixed(1)}x</span></div>
                <input type="range" min="1.0" max="5.0" step="0.1" value={speedMod} onChange={(e) => setSpeedMod(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400" />
            </div>
            
            <button onClick={startCountdownSequence} onMouseEnter={() => playUiSound('hover')} disabled={isAnalyzing || !analyzedNotes} className={`w-full py-3 bg-gradient-to-r from-cyan-700 to-blue-700 text-white font-bold text-xl tracking-widest uppercase transition-all transform shadow-[0_0_30px_rgba(6,182,212,0.4)] border border-cyan-400/50 ${(isAnalyzing || !analyzedNotes) ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:from-cyan-600 hover:to-blue-600 hover:scale-[1.02] animate-pulse'} ${fontClass}`}>{isAnalyzing ? t.ANALYZING : t.GAME_START}</button>
          </div>
        </div>
      )}

      {/* GAMEPLAY UI */}
      {(status === GameStatus.PLAYING || status === GameStatus.PAUSED) && (
        <div className={`relative z-20 w-full h-full flex px-0 ${
            layoutSettings.lanePosition === 'center' ? 'justify-center' :
            layoutSettings.lanePosition === 'right' ? 'justify-end' : 'justify-start'
        }`}>
            
            {/* RENDER THE ACTIVE THEME FRAME */}
            {renderGameFrame()}

            {/* DECORATIVE TEXT */}
            <div className={`
                absolute inset-0 z-10 hidden md:flex flex-col justify-end p-12 pointer-events-none
                ${layoutSettings.lanePosition === 'right' ? 'items-start text-left' : 'items-end text-right'}
            `}>
                <div className="pointer-events-none">
                    <h2 className="text-6xl font-display font-bold text-white/40 tracking-widest drop-shadow-md">
                        {currentThemeId === 'ignore' ? 'IGNORE PROTOCOL' : currentThemeId === 'titan' ? 'TITAN CONSTRUCT' : currentThemeId === 'queen' ? 'QUEEN PROTOCOL' : 'NEON CORE'}
                    </h2>
                    <div className="text-cyan-500/80 font-mono mt-2 bg-black/60 inline-block px-4 py-1 rounded backdrop-blur-md border border-cyan-500/30">
                        {t.SYSTEM_LINKED}: {localFileName ? localFileName : 'LOCAL_FILE'} // MODE: {keyMode}K
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
            t={t}
            fontClass={fontClass}
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
            t={t}
            fontClass={fontClass}
        />
      )}
    </div>
  );
};

export default App;
