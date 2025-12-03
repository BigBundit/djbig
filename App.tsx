

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
import { analyzeAudioAndGenerateNotes } from './utils/audioAnalyzer';
import { generateVideoThumbnail, bufferToWave } from './utils/mediaUtils';
import { generateRockDemo } from './utils/demoAudio';
import { saveSongToDB, getAllSongsFromDB, clearAllSongsFromDB } from './utils/songStorage';
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

const START_OFFSET_MS = 3000; // 3 Seconds Silence/Delay at start

// --- HELPER COMPONENT FOR MARQUEE TEXT ---
const MarqueeText: React.FC<{ text: string, className?: string }> = ({ text, className }) => {
    const isLong = text.length > 15;
    
    if (isLong) {
        return (
            <div className={`overflow-hidden w-full relative ${className}`}>
                <div className="animate-marquee">
                    <span className="mr-8">{text}</span>
                    <span className="mr-8">{text}</span>
                </div>
            </div>
        );
    }
    
    return <div className={`truncate ${className}`}>{text}</div>;
};

// HELPER: Convert Key Code to readable label
const codeToLabel = (code: string) => {
    if (code === 'Space') return 'SPC';
    if (code.startsWith('Key')) return code.replace('Key', '');
    if (code.startsWith('Digit')) return code.replace('Digit', '');
    return code.toUpperCase().slice(0,3);
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
  const [currentSongMetadata, setCurrentSongMetadata] = useState<SongMetadata | null>(null);
  
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

  // Audio Settings
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({ masterVolume: 0.5, sfxVolume: 1.0, musicVolume: 0.5, audioOffset: 0 });
  const [isBgMusicMuted, setIsBgMusicMuted] = useState<boolean>(false);
  
  // Layout Settings
  const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>(DEFAULT_LAYOUT);

  // Theme & Progress System
  const [currentThemeId, setCurrentThemeId] = useState<ThemeId>('ignore');
  const [playerStats, setPlayerStats] = useState<PlayerStats>(DEFAULT_STATS);

  // Preview Audio State
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Mobile States
  const [showMobileStart, setShowMobileStart] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [showMobileSetup, setShowMobileSetup] = useState<boolean>(false);
  
  // Refs for scrolling
  const mobileSetupStartBtnRef = useRef<HTMLButtonElement>(null);

  // Translations Helper
  const t = TRANSLATIONS[layoutSettings.language];
  const fontClass = layoutSettings.language === 'th' ? 'font-thai' : 'font-display';

  // Ref to hold audio settings for access within game loop/closures without dependency issues
  const audioSettingsRef = useRef<AudioSettings>(audioSettings);

  // Engine State (Refs for performance)
  const frameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const totalPauseDurationRef = useRef<number>(0);
  
  // Ref to track status inside callbacks/closures
  const statusRef = useRef<GameStatus>(GameStatus.TITLE);
  
  const notesRef = useRef<NoteType[]>([]);
  const activeKeysRef = useRef<boolean[]>(new Array(7).fill(false)); // Max 7
  
  // VISUAL STATE: Tracks key press visuals separately to force re-renders immediately
  const [activeLanesState, setActiveLanesState] = useState<boolean[]>(new Array(7).fill(false));

  const mediaRef = useRef<HTMLMediaElement>(null); // Ref for audio/video playback
  const bgVideoRef = useRef<HTMLVideoElement>(null); // Ref for background video loop
  const bgMusicRef = useRef<HTMLAudioElement>(null); // Ref for background music (Intro)
  const bgRef = useRef<HTMLDivElement>(null); // Ref for background pulse
  const progressBarRef = useRef<HTMLDivElement>(null); // Ref for progress bar
  
  const audioBufferRef = useRef<AudioBuffer | null>(null); // Ref to store raw audio for re-analysis
  const audioDurationRef = useRef<number>(0); // Duration in seconds

  const noiseBufferRef = useRef<AudioBuffer | null>(null); // Ref to cache noise buffer for performance
  
  // Touch Input State
  const laneContainerRef = useRef<HTMLDivElement>(null);
  const touchedLanesRef = useRef<Set<number>>(new Set());
  
  const lastPauseTitleClickRef = useRef<number>(0);

  // Visual State for React Render
  const [renderNotes, setRenderNotes] = useState<NoteType[]>([]);

  // Detect Mobile on Mount
  useEffect(() => {
    const checkMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    setIsMobile(checkMobile);
    if (checkMobile) {
        setShowMobileStart(true);
    }
  }, []);

  // LOAD PERSISTED SONGS ON START
  useEffect(() => {
      const loadSongs = async () => {
          try {
              const songs = await getAllSongsFromDB();
              if (songs.length > 0) {
                  setSongList(songs);
              }
          } catch (e) {
              console.error("Failed to load songs from DB", e);
          }
      };
      loadSongs();
  }, []);

  // Scroll to Game Start button on mobile setup open
  useEffect(() => {
    if (showMobileSetup && mobileSetupStartBtnRef.current) {
        setTimeout(() => {
            mobileSetupStartBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 100);
    }
  }, [showMobileSetup]);

  // Stop Preview Helper (Defined early for usage in effect)
  const stopPreview = useCallback(() => {
    if (previewTimeoutRef.current) {
        clearInterval(previewTimeoutRef.current as any); 
        previewTimeoutRef.current = null;
    }

    if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.currentTime = 0;
    }
    setIsPlayingPreview(false);
  }, []);

  // Toggle Pause (Defined early)
  const togglePause = useCallback(() => {
    if (statusRef.current === GameStatus.PLAYING) {
        setStatus(GameStatus.PAUSED);
        pauseTimeRef.current = performance.now();
        if (mediaRef.current) mediaRef.current.pause();
        if (audioCtxRef.current) audioCtxRef.current.suspend();
        if (bgVideoRef.current) bgVideoRef.current.pause(); // Sync BG
    } else if (statusRef.current === GameStatus.PAUSED) {
        setStatus(GameStatus.PLAYING);
        const pauseDuration = performance.now() - pauseTimeRef.current;
        totalPauseDurationRef.current += pauseDuration;
        
        // Only resume media if we are past the start offset
        const currentRefTime = performance.now() - startTimeRef.current - totalPauseDurationRef.current;
        if (currentRefTime >= START_OFFSET_MS) {
            if (mediaRef.current) mediaRef.current.play().catch(() => {});
        }
        
        if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {}); // Sync BG
        if (audioCtxRef.current) audioCtxRef.current.resume();
    }
  }, []); // Empty dep array because we rely on statusRef

  // Listen for Visibility Change to Pause/Mute
  useEffect(() => {
      const handleVisibilityChange = () => {
          if (document.hidden) {
              // App is minimized or switched away
              if (statusRef.current === GameStatus.PLAYING) {
                  togglePause(); 
              }
              
              // FORCE STOP PREVIEW
              if (isPlayingPreview) {
                  stopPreview();
              }

              // Mute all audio contexts/elements
              if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
                  audioCtxRef.current.suspend();
              }
              if (bgMusicRef.current) bgMusicRef.current.pause();
              if (bgVideoRef.current) bgVideoRef.current.pause();
              if (mediaRef.current) mediaRef.current.pause();
          } else {
              // App returned to foreground
              if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
                  audioCtxRef.current.resume();
              }
              // Resume BGM if needed
              if ((statusRef.current === GameStatus.TITLE || statusRef.current === GameStatus.MENU) && !isPlayingPreview && !showMobileStart) {
                   if (bgMusicRef.current) bgMusicRef.current.play().catch(()=>{});
                   if (bgVideoRef.current) bgVideoRef.current.play().catch(()=>{});
              }
          }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
          document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
  }, [isPlayingPreview, togglePause, stopPreview, showMobileStart]);

  const handleMobileEnter = async () => {
    // 1. Trigger Full Screen
    const docEl = document.documentElement;

    // Attempt to lock orientation to portrait (if supported)
    // @ts-ignore
    if (screen.orientation && screen.orientation.lock) {
        try {
            // @ts-ignore
            await screen.orientation.lock('portrait');
        } catch (e) {
            console.log("Orientation lock not supported or denied");
        }
    }

    try {
        if (docEl.requestFullscreen) {
            // @ts-ignore
            await docEl.requestFullscreen({ navigationUI: "hide" });
        } else if ((docEl as any).webkitRequestFullscreen) {
            await (docEl as any).webkitRequestFullscreen();
        } else if ((docEl as any).webkitEnterFullscreen) {
             await (docEl as any).webkitEnterFullscreen();
        }
    } catch (err) {
        console.log("Fullscreen request denied", err);
    }
    
    // 1.5 REQUEST WAKE LOCK (Prevent screen dimming)
    if ('wakeLock' in navigator) {
        try {
            // @ts-ignore
            const wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
             console.log("Wake Lock failed", err);
        }
    }

    // 2. Init Audio immediately on user interaction
    initAudio();
    
    // 3. Play UI Sound AND PRIME VIBRATION
    playUiSound('select');
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
            navigator.vibrate(200); // 200ms vibration to unlock Android permission
        } catch (e) { console.log("Vibrate failed", e); }
    }

    // 4. Hide Overlay
    setShowMobileStart(false);
  };

  const handlePauseTitleClick = () => {
      const now = Date.now();
      if (now - lastPauseTitleClickRef.current < 500) {
          // Double Tap Detected
          setIsAutoPlay(prev => {
              const newState = !prev;
              setFeedback({ 
                  text: newState ? "AUTO PILOT ENGAGED" : "MANUAL CONTROL", 
                  color: "text-fuchsia-400", 
                  id: Date.now() 
              });
              return newState;
          });
          playUiSound('select');
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([50, 50, 50]);
          lastPauseTitleClickRef.current = 0; // Reset
      } else {
          lastPauseTitleClickRef.current = now;
      }
  };

  // Update ref and media volume when state changes
  useEffect(() => {
      audioSettingsRef.current = audioSettings;
      
      // Update Gameplay Media Volume
      if (mediaRef.current) {
          mediaRef.current.volume = audioSettings.masterVolume;
      }

      // Update Background Music Volume
      if (bgMusicRef.current) {
          const effectiveVolume = isBgMusicMuted ? 0 : (audioSettings.masterVolume * audioSettings.musicVolume);
          bgMusicRef.current.volume = effectiveVolume;
      }
  }, [audioSettings, isBgMusicMuted]);

  // Handle Background Music Playback
  useEffect(() => {
    if (bgMusicRef.current) {
        // Only play BGM if in Title/Menu AND NOT playing a song preview
        if ((status === GameStatus.TITLE || status === GameStatus.MENU) && !isPlayingPreview && !showMobileStart) {
            bgMusicRef.current.play().catch(e => {
                // Autoplay might be blocked until interaction
            });
        } else {
            bgMusicRef.current.pause();
            if (status === GameStatus.PLAYING) {
                bgMusicRef.current.currentTime = 0;
            }
        }
    }
  }, [status, isPlayingPreview, showMobileStart]);

  // Play Preview Helper
  const playPreview = (src: string) => {
    stopPreview(); // Stop existing

    if (!previewAudioRef.current) {
        previewAudioRef.current = new Audio();
    }

    const audio = previewAudioRef.current;
    audio.src = src;
    
    // Apply volume mixing: Master * Music
    const musicVol = audioSettings.musicVolume ?? 1.0;
    const targetVolume = audioSettings.masterVolume * musicVol;
    audio.volume = targetVolume;
    
    audio.play()
        .then(() => {
            setIsPlayingPreview(true);
            
            // Loop Logic: Play 15s, Fade out last 3s, Loop back to 0
            const LOOP_LIMIT = 15; // 15 seconds
            const FADE_START = 12; // Start fading at 12s

            audio.loop = true; // Ensure basic looping is enabled

            previewTimeoutRef.current = setInterval(() => {
                if (!audio) return;
                
                const t = audio.currentTime;

                // 1. Loop Reset
                if (t >= LOOP_LIMIT || audio.ended) {
                    audio.currentTime = 0;
                    audio.volume = targetVolume;
                    if (audio.paused) audio.play().catch(()=>{});
                    return;
                }

                // 2. Fade Out
                if (t >= FADE_START) {
                    const remaining = LOOP_LIMIT - t;
                    const fadeDuration = LOOP_LIMIT - FADE_START;
                    const ratio = Math.max(0, remaining / fadeDuration);
                    audio.volume = targetVolume * (ratio * ratio);
                } else {
                     if (Math.abs(audio.volume - targetVolume) > 0.01) {
                         audio.volume = targetVolume;
                     }
                }

            }, 100); 
        })
        .catch(err => console.warn("Preview playback failed", err));
  };

  // Cleanup Preview on Unmount or Game Start
  useEffect(() => {
      if (status === GameStatus.PLAYING) {
          stopPreview();
      }
      return () => stopPreview();
  }, [status, stopPreview]);

  // Load Persistence Data (Same as before...)
  useEffect(() => {
      const storedKeys = localStorage.getItem('djbig_key_config');
      if (storedKeys) {
          try { 
              const parsed = JSON.parse(storedKeys);
              if (parsed[4] && parsed[4].length > 0 && parsed[4][0].length === 1) {
                   setKeyMappings(DEFAULT_KEY_MAPPINGS);
              } else {
                   setKeyMappings(parsed);
              }
          } catch (e) { console.error("Failed to load keys", e); }
      }

      const storedStats = localStorage.getItem('djbig_player_stats');
      if (storedStats) {
          try { setPlayerStats(JSON.parse(storedStats)); } catch (e) { console.error("Failed to load stats", e); }
      }

      const storedActiveTheme = localStorage.getItem('djbig_active_theme');
      if (storedActiveTheme && ['neon', 'ignore', 'titan', 'queen'].includes(storedActiveTheme)) {
          setCurrentThemeId(storedActiveTheme as ThemeId);
      } else {
          setCurrentThemeId('ignore');
      }

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

  const activeThemeObj = useMemo(() => {
      return GAME_THEMES.find(t => t.id === currentThemeId) || GAME_THEMES[0];
  }, [currentThemeId]);

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

  const activeLaneConfig: LaneConfig[] = useMemo(() => {
      let baseConfig: LaneConfig[] = [];
      if (keyMode === 4) baseConfig = LANE_CONFIGS_4;
      else if (keyMode === 5) baseConfig = LANE_CONFIGS_5;
      else baseConfig = LANE_CONFIGS_7;

      const currentKeys = keyMappings[keyMode];
      return baseConfig.map((lane, idx) => ({
          ...lane,
          key: currentKeys[idx] || lane.key, 
          label: codeToLabel(currentKeys[idx] || lane.key)
      }));
  }, [keyMode, keyMappings]);

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
    if (bgMusicRef.current && (status === GameStatus.TITLE || status === GameStatus.MENU)) {
        if (!isPlayingPreview && !showMobileStart) bgMusicRef.current.play().catch(()=>{});
    }
    return audioCtxRef.current;
  };

  const getNoiseBuffer = (ctx: AudioContext) => {
    if (!noiseBufferRef.current) {
      const bufferSize = ctx.sampleRate * 2.0; 
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      noiseBufferRef.current = buffer;
    }
    return noiseBufferRef.current;
  };

  const getVol = (baseVol: number) => {
      return baseVol * audioSettingsRef.current.masterVolume * audioSettingsRef.current.sfxVolume;
  };

  const playUiSound = (type: 'hover' | 'select' | 'back' | 'scratch') => {
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      const t = ctx.currentTime;
      const gain = ctx.createGain();
      
      if (type === 'hover') {
          const osc = ctx.createOscillator();
          osc.frequency.setValueAtTime(400, t);
          osc.frequency.exponentialRampToValueAtTime(200, t + 0.05);
          gain.gain.setValueAtTime(getVol(0.05), t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
          osc.type = 'sine';
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.1);
      } else if (type === 'scratch') {
          // HEAVY IMPACT / SCRATCH - BOOSTED VOLUME
          const noise = ctx.createBufferSource();
          noise.buffer = getNoiseBuffer(ctx);
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1000, t);
          filter.frequency.exponentialRampToValueAtTime(100, t + 0.5);
          
          // Boosted gain from 0.8 to 1.5 to ensure audibility
          gain.gain.setValueAtTime(getVol(1.5), t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
          
          noise.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          noise.start(t);
          noise.stop(t + 0.5);
      } else {
          // SELECT
          const noise = ctx.createBufferSource();
          noise.buffer = getNoiseBuffer(ctx);
          noise.loop = true;
          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.Q.value = 2.0;
          filter.frequency.setValueAtTime(400, t);
          filter.frequency.linearRampToValueAtTime(1500, t + 0.05);
          filter.frequency.linearRampToValueAtTime(100, t + 0.15);
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(getVol(0.6), t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
          noise.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          noise.start(t);
          noise.stop(t + 0.2);
      }
  };

  // ASYNC ANALYSIS WRAPPER TO PREVENT STUTTER
  const performAnalysis = async (buffer: AudioBuffer) => {
      setIsAnalyzing(true);
      // Use setTimeout to yield to main thread so UI updates to "Analyzing" first
      setTimeout(async () => {
          try {
            // Pass START_OFFSET_MS to analysis
            const notes = await analyzeAudioAndGenerateNotes(buffer, level, keyMode, START_OFFSET_MS);
            setAnalyzedNotes(notes);
          } catch (error) {
            console.error("Analysis failed");
          } finally {
            setIsAnalyzing(false);
          }
      }, 50);
  };

  const loadDemoTrack = async (filename: string, id: string) => {
    playUiSound('select');
    const ctx = initAudio();
    setIsAnalyzing(true);
    setLocalFileName(id);
    setAnalyzedNotes(null);
    
    let demoTitle = t.PLAY_DEMO_01;
    if (id === 'DEMO_TRACK_02') demoTitle = t.PLAY_DEMO_02;
    if (id === 'DEMO_TRACK_03') demoTitle = t.PLAY_DEMO_03;
    if (id === 'DEMO_TRACK_04') demoTitle = t.PLAY_DEMO_04;

    const absolutePath = filename.startsWith('/') ? filename : `/${filename}`;
    
    try {
        const response = await fetch(absolutePath);
        if (!response.ok) throw new Error("Demo file not found");
        
        const videoBlob = await response.blob();
        const videoUrl = URL.createObjectURL(videoBlob);
        
        // GENERATE THUMBNAIL FOR DISC
        let thumbUrl = null;
        try {
            const tempFile = new File([videoBlob], "demo_thumb_gen.mp4", { type: "video/mp4" });
            thumbUrl = await generateVideoThumbnail(tempFile);
        } catch (e) {
            console.warn("Failed to generate demo thumbnail", e);
        }

        setCurrentSongMetadata({
            id: id,
            file: new File([], id),
            name: demoTitle,
            thumbnailUrl: thumbUrl,
            type: 'video'
        });

        setLocalVideoSrc(videoUrl);
        setMediaType('video');
        setSoundProfile('rock');

        playPreview(videoUrl);

        const arrayBuffer = await videoBlob.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        audioBufferRef.current = audioBuffer;
        audioDurationRef.current = audioBuffer.duration;
        
        // Pass Offset
        const notes = await analyzeAudioAndGenerateNotes(audioBuffer, level, keyMode, START_OFFSET_MS);
        setAnalyzedNotes(notes);
        setIsAnalyzing(false);
    } catch (e) {
        console.warn("Demo file missing or fetch error. Using generated fallback audio.");
        
        const audioBuf = generateRockDemo(ctx);
        audioBufferRef.current = audioBuf;
        audioDurationRef.current = audioBuf.duration;
        
        const wavBlob = bufferToWave(audioBuf, audioBuf.length);
        const audioUrl = URL.createObjectURL(wavBlob);
        
        // Fallback metadata without custom thumb
        setCurrentSongMetadata({
            id: id,
            file: new File([], id),
            name: demoTitle,
            thumbnailUrl: null,
            type: 'audio'
        });

        setLocalVideoSrc(audioUrl);
        setMediaType('audio'); 
        setSoundProfile('rock');
        playPreview(audioUrl);

        const notes = await analyzeAudioAndGenerateNotes(audioBuf, level, keyMode, START_OFFSET_MS);
        setAnalyzedNotes(notes);
        setIsAnalyzing(false);
    }
  };

  const handleFileSelect = async (file: File, meta?: SongMetadata) => {
    if (file) {
      initAudio();
      
      if (localVideoSrc) URL.revokeObjectURL(localVideoSrc);
      const url = URL.createObjectURL(file);
      setLocalVideoSrc(url);
      setLocalFileName(file.name);
      
      if (meta) {
          setCurrentSongMetadata(meta);
      } else {
          const isVideo = file.type.startsWith('video') || !!file.name.match(/\.(mp4|webm|ogg|mov|m4v)$/i);
          setCurrentSongMetadata({
              id: `temp-${Date.now()}`,
              file: file,
              name: file.name,
              thumbnailUrl: null,
              type: isVideo ? 'video' : 'audio'
          });
      }
      
      playPreview(url);

      const hash = file.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const profiles: ('electronic' | 'rock' | 'chiptune')[] = ['electronic', 'rock', 'chiptune'];
      const selectedProfile = profiles[hash % profiles.length];
      setSoundProfile(selectedProfile);

      const isVideo = file.type.startsWith('video') || !!file.name.match(/\.(mp4|webm|ogg|mov|m4v)$/i);
      setMediaType(isVideo ? 'video' : 'audio');

      setAnalyzedNotes(null); 
      
      try {
        setIsAnalyzing(true);
        const arrayBuffer = await file.arrayBuffer();
        const ctx = initAudio();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        audioBufferRef.current = audioBuffer; 
        audioDurationRef.current = audioBuffer.duration;
        
        await performAnalysis(audioBuffer);
      } catch (error) {
        console.error("Audio decode failed");
        alert("Could not analyze audio file.");
        setIsAnalyzing(false);
      }
    }
  };

  const handleSingleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const isVideo = file.type.startsWith('video') || !!file.name.match(/\.(mp4|webm|ogg|mov|m4v)$/i);
          let thumb: string | null = null;
          if (isVideo) {
             try { thumb = await generateVideoThumbnail(file); } catch (err) {}
          }
          const newSong: SongMetadata = {
              id: `single-${Date.now()}`,
              file: file,
              name: file.name,
              thumbnailUrl: thumb,
              type: isVideo ? 'video' : 'audio'
          };
          setSongList(prev => [...prev, newSong]); 
          // SAVE TO INDEXED DB
          saveSongToDB(newSong).catch(e => console.error("Save failed", e)); 
          handleFileSelect(file, newSong);
      }
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setIsLoadingFolder(true);
      const validExtensions = ['.mp4', '.mp3', '.m4a', '.wav', '.ogg', '.m4v', '.webm'];
      const loadedSongs: SongMetadata[] = [];
      for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const lowerName = file.name.toLowerCase();
          const isValid = validExtensions.some(ext => lowerName.endsWith(ext));
          if (isValid) {
              const isVideo = lowerName.endsWith('.mp4') || lowerName.endsWith('.m4v') || lowerName.endsWith('.webm') || lowerName.endsWith('.mov');
              let thumb: string | null = null;
              if (isVideo) {
                 try { thumb = await generateVideoThumbnail(file); } catch (err) {}
              }
              const song: SongMetadata = {
                  id: `${Date.now()}-${i}-${file.name}`,
                  file: file,
                  name: file.name,
                  thumbnailUrl: thumb,
                  type: isVideo ? 'video' : 'audio'
              };
              loadedSongs.push(song);
              // SAVE EACH SONG TO DB
              saveSongToDB(song).catch(e => console.error("Save failed", e));
          }
      }
      setSongList(prev => [...prev, ...loadedSongs]);
      setIsLoadingFolder(false);
  };

  const handleClearPlaylist = async () => {
      // 1. Force Clear State IMMEDIATELY
      setSongList([]);
      setLocalFileName("");
      setAnalyzedNotes(null);
      setCurrentSongMetadata(null);
      
      // Stop Audio
      stopPreview();
      
      if (localVideoSrc) {
           try { URL.revokeObjectURL(localVideoSrc); } catch(e) {}
      }
      setLocalVideoSrc("");

      if (mediaRef.current) {
          try {
              mediaRef.current.pause();
              mediaRef.current.src = "";
          } catch(e) {}
      }
      
      try {
          playUiSound('select');
          // 2. Clear DB background
          await clearAllSongsFromDB();
      } catch (e) {
          console.error("Clear playlist error", e);
      }
  };

  // Re-analyze when level/key changes
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

  const playHitSound = (laneIndex: number | 'select' | 'hover') => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const t = ctx.currentTime;
    
    // 1. UI SOUNDS
    if (laneIndex === 'hover') {
          playUiSound('hover'); return;
    } 
    if (laneIndex === 'select') {
          playUiSound('select'); return;
    }

    // 2. GAMEPLAY SOUNDS: SOFT DRUM KIT (Kick, Tom, Hat) - VOLUME REDUCED 70%
    if (typeof laneIndex === 'number') {
        // Determine Instrument based on lane
        let type = 'tom';
        if (keyMode === 7) {
            if (laneIndex === 3) type = 'kick';
            else if (laneIndex === 0 || laneIndex === 6) type = 'hat';
            else type = 'tom';
        } else if (keyMode === 5) {
            if (laneIndex === 2) type = 'kick';
            else if (laneIndex === 0 || laneIndex === 4) type = 'hat';
            else type = 'tom';
        } else {
            if (laneIndex === 1 || laneIndex === 2) type = 'kick';
            else type = 'hat';
        }

        const gain = ctx.createGain();
        gain.connect(ctx.destination);

        if (type === 'kick') {
            // SOFT KICK / LOW TOM
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(80, t);
            osc.frequency.exponentialRampToValueAtTime(30, t + 0.15);
            
            // Soft Attack/Decay - VOLUME 0.12 (30% of 0.4)
            gain.gain.setValueAtTime(getVol(0.12), t); 
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
            
            osc.connect(gain);
            osc.start(t);
            osc.stop(t + 0.15);
        } else if (type === 'hat') {
            // SOFT HAT (Closed Tsk)
            const noise = ctx.createBufferSource();
            noise.buffer = getNoiseBuffer(ctx);
            
            const filter = ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.setValueAtTime(6000, t); 
            
            // Very soft - VOLUME 0.045 (30% of 0.15)
            gain.gain.setValueAtTime(getVol(0.045), t); 
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
            
            noise.connect(filter);
            filter.connect(gain);
            noise.start(t);
            noise.stop(t + 0.05);
        } else {
            // SOFT TOM / MUFFLED SNARE
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(120, t);
            osc.frequency.linearRampToValueAtTime(60, t + 0.1);
            
            const noise = ctx.createBufferSource();
            noise.buffer = getNoiseBuffer(ctx);
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.value = 800;
            
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.1, t);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
            
            // Overall Volume - VOLUME 0.075 (30% of 0.25)
            gain.gain.setValueAtTime(getVol(0.075), t); 
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
            
            osc.connect(gain);
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(gain);
            
            osc.start(t);
            osc.stop(t + 0.15);
            noise.start(t);
            noise.stop(t + 0.15);
        }
    }
  };

  const playOutroSound = () => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const t = ctx.currentTime;
    
    // Impact Sound
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.frequency.setValueAtTime(50, t);
    osc.frequency.exponentialRampToValueAtTime(10, t + 2.0);
    
    gain.gain.setValueAtTime(getVol(1.0), t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 2.0);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 2);
  };

  const triggerOutro = useCallback(() => {
      setStatus(GameStatus.OUTRO);
      initAudio(); 
      playOutroSound();
       if (mediaRef.current) mediaRef.current.pause();
       if (bgVideoRef.current) bgVideoRef.current.pause(); 
      if (!isAutoPlay) {
          checkUnlocks(score, maxCombo, perfectCount);
      }
      setTimeout(() => setStatus(GameStatus.FINISHED), 3000);
  }, [score, maxCombo, perfectCount, isAutoPlay, playerStats]);

  // CORE GAME LOGIC
  const triggerLane = useCallback((laneIndex: number) => {
    if (status !== GameStatus.PLAYING || isAutoPlay) return; 
    
    // 1. Game Logic (Fast Ref)
    if (activeKeysRef.current[laneIndex]) return;
    activeKeysRef.current[laneIndex] = true;

    // 2. Visual Update (Forces Re-render immediately)
    setActiveLanesState(prev => {
        const next = [...prev];
        next[laneIndex] = true;
        return next;
    });

    playHitSound(laneIndex);

    // HAPTIC FEEDBACK FOR TOUCH (Mobile App Vibrate Fix)
    if (isMobile && typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(50); } catch(e) {}
    }

    // TIME SYNC FIX (UPDATED FOR START OFFSET)
    let elapsed = 0;
    if (mediaRef.current && !mediaRef.current.paused) {
        elapsed = mediaRef.current.currentTime * 1000 + START_OFFSET_MS;
    } else {
        const now = performance.now();
        elapsed = now - startTimeRef.current - totalPauseDurationRef.current;
    }

    const adjustedTime = elapsed - audioSettingsRef.current.audioOffset;
    
    const notesInLane = notesRef.current.filter(n => n.laneIndex === laneIndex && !n.hit && !n.missed);
    notesInLane.sort((a, b) => Math.abs(a.timestamp - adjustedTime) - Math.abs(b.timestamp - adjustedTime));
    
    const targetNote = notesInLane[0];

    if (targetNote) {
        const timeDelta = Math.abs(targetNote.timestamp - adjustedTime);
        const PERFECT_WINDOW = 50;
        const GOOD_WINDOW = 120;
        const BAD_WINDOW = 200;

        let hitType: ScoreRating | null = null;

        if (timeDelta < PERFECT_WINDOW) hitType = ScoreRating.PERFECT;
        else if (timeDelta < GOOD_WINDOW) hitType = ScoreRating.GOOD;
        else if (timeDelta < BAD_WINDOW) hitType = ScoreRating.BAD;

        if (hitType !== null) {
            targetNote.hit = true;
            
            const newEffect: HitEffectData = {
                id: Date.now() + Math.random(),
                laneIndex: laneIndex,
                rating: hitType,
                timestamp: performance.now()
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
                setFeedback({ text: "10%", color: "text-yellow-400", id: Date.now() });
            }

            setCombo(c => {
                const newC = c + 1;
                setMaxCombo(prev => Math.max(prev, newC));
                return newC;
            });
        }
    } 
  }, [status, isAutoPlay, combo, maxCombo, soundProfile, speedMod]);

  const releaseLane = useCallback((laneIndex: number) => {
    activeKeysRef.current[laneIndex] = false;
    setActiveLanesState(prev => {
        const next = [...prev];
        next[laneIndex] = false;
        return next;
    });
  }, []);

  const handleTouch = useCallback((e: React.TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    if (!laneContainerRef.current) return;
    
    const rect = laneContainerRef.current.getBoundingClientRect();
    const laneWidth = rect.width / keyMode;
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

    if (bgRef.current) {
         const time = Date.now() / 1000;
         const scale = 1 + Math.sin(time * 2) * 0.01;
         bgRef.current.style.transform = `scale(${scale})`;
    }

    // --- TIME SYNC WITH DELAY START LOGIC ---
    let elapsed = 0;
    const now = performance.now();
    const timeSinceStart = now - startTimeRef.current - totalPauseDurationRef.current;

    if (timeSinceStart < START_OFFSET_MS) {
        // WARMUP PHASE: Media is paused, notes scroll based on clock
        elapsed = timeSinceStart;
        if (mediaRef.current && !mediaRef.current.paused) mediaRef.current.pause(); 
    } else {
        // PLAYING PHASE: Media should be running
        if (mediaType === 'video' && mediaRef.current) {
             if (mediaRef.current.paused && !mediaRef.current.ended) {
                 mediaRef.current.play().catch(() => {});
             }
             // Sync to media time + offset
             elapsed = mediaRef.current.currentTime * 1000 + START_OFFSET_MS;
        } else {
             // Audio Mode (Buffer fallback) or just using clock
             elapsed = timeSinceStart;
             // We handle buffer playback start in the 'startGame' or specific buffer logic separately
             // For consistency in this snippet, we assume mediaRef handles primary time
        }
    }
    
    // Apply User Offset
    const adjustedTime = elapsed - audioSettingsRef.current.audioOffset;
    
    if (progressBarRef.current && audioDurationRef.current > 0) {
        const durationMs = audioDurationRef.current * 1000;
        const progress = Math.min(100, ((elapsed - START_OFFSET_MS) / durationMs) * 100);
        progressBarRef.current.style.width = `${Math.max(0, progress)}%`;
    }

    if (audioDurationRef.current > 0 && elapsed > audioDurationRef.current * 1000 + START_OFFSET_MS + 1000) {
        triggerOutro();
        return;
    }
    
    const currentFallSpeed = BASE_FALL_SPEED_MS / speedMod;
    const hitLineY = 90;

    notesRef.current.forEach(note => {
      // Calculate position relative to target time (note.timestamp includes offset now)
      const timeDelta = adjustedTime - note.timestamp; 
      const position = hitLineY + ((timeDelta / currentFallSpeed) * hitLineY);

      note.y = position;

      // AUTO PLAY
      if (isAutoPlay && !note.hit && !note.missed) {
          if (timeDelta >= 0) {
            note.hit = true;
            // Visual feedback for autoplay
            setActiveLanesState(prev => { const n = [...prev]; n[note.laneIndex] = true; return n; });
            setTimeout(() => { 
                setActiveLanesState(prev => { const n = [...prev]; n[note.laneIndex] = false; return n; });
            }, 50);
            
            playHitSound(note.laneIndex);
            setHitEffects(prev => [...prev, { id: Date.now() + Math.random(), laneIndex: note.laneIndex, rating: ScoreRating.PERFECT, timestamp: performance.now() }]);
            setFeedback({ text: t.AUTO_PILOT, color: "text-fuchsia-500", id: Date.now() });
            setCombo(c => {
                    const newC = c + 1;
                    setMaxCombo(prev => Math.max(prev, newC));
                    return newC;
            });
          }
      }

      // MISS
      const missThresholdTime = 250; 
      if (!note.hit && !note.missed && timeDelta > missThresholdTime) {
        note.missed = true;
        setMissCount(c => c + 1);
        setCombo(0);
        setHealth(h => Math.max(0, h - 4));
        setFeedback({ text: "MISS", color: "text-red-500", id: Date.now() });
        setIsShaking(true);
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(200);
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
  }, [status, health, speedMod, isAutoPlay, combo, maxCombo, triggerOutro, soundProfile, t, mediaType]);

  useEffect(() => {
    if (status === GameStatus.PLAYING) {
      frameRef.current = requestAnimationFrame(update);
      // Removed immediate media play here; handled in update loop for delay
      if (bgVideoRef.current) {
        bgVideoRef.current.play().catch(() => {});
      }
    }
    return () => cancelAnimationFrame(frameRef.current);
  }, [status, update]);

  // ... (Input Handling: handleExit, handleKeyDown, handleKeyUp - Identical) ...
  const handleExit = () => { try { window.close(); } catch (e) {} window.location.href = "about:blank"; };
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((showKeyConfig) && e.key === 'Escape') { setShowKeyConfig(false); return; }
    if (e.key === 'Escape') {
        if (status === GameStatus.TITLE) { handleExit(); } 
        else if (status === GameStatus.MENU) { setStatus(GameStatus.TITLE); playUiSound('select'); } 
        else { togglePause(); }
        return;
    }
    if (status === GameStatus.MENU || status === GameStatus.TITLE) {
        const laneIndex = activeLaneConfig.findIndex(l => l.key === e.code);
        if (laneIndex !== -1 && activeLaneConfig.length > 0 && audioCtxRef.current) playHitSound(laneIndex);
        return;
    }
    if (e.key === 'F1') { e.preventDefault(); setSpeedMod(prev => Math.max(1.0, prev - 0.5)); setFeedback({ text: "SPEED DOWN", color: "text-white", id: Date.now() }); }
    if (e.key === 'F2') { e.preventDefault(); setSpeedMod(prev => Math.min(10.0, prev + 0.5)); setFeedback({ text: "SPEED UP", color: "text-white", id: Date.now() }); }
    if (e.key === 'F4') { e.preventDefault(); setIsAutoPlay(prev => !prev); setFeedback({ text: isAutoPlay ? "AUTO OFF" : "AUTO ON", color: "text-fuchsia-400", id: Date.now() }); }
    if (e.key === 'F8') { e.preventDefault(); const isMuted = audioSettingsRef.current.masterVolume === 0; setAudioSettings(prev => ({ ...prev, masterVolume: isMuted ? 0.5 : 0 })); setFeedback({ text: isMuted ? "SOUND ON" : "MUTED", color: "text-white", id: Date.now() }); }
    if (e.key === 'F9') { e.preventDefault(); triggerOutro(); return; }
    const laneIndex = activeLaneConfig.findIndex(l => l.key === e.code);
    if (laneIndex !== -1) triggerLane(laneIndex);
  }, [status, triggerLane, triggerOutro, togglePause, isAutoPlay, activeLaneConfig, showKeyConfig]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    const laneIndex = activeLaneConfig.findIndex(l => l.key === e.code);
    if (laneIndex !== -1) releaseLane(laneIndex);
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
    stopPreview(); 
    
    // Close Mobile Setup if open
    setShowMobileSetup(false);

    if (!localVideoSrc) { alert("Please select a track first."); return; }
    if (!analyzedNotes) { alert("Please wait for analysis to complete."); return; }

    // FORCE UNPAUSE if needed
    if (status === GameStatus.PAUSED) {
        // Just reset pause vars
        pauseTimeRef.current = 0;
        totalPauseDurationRef.current = 0;
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
            startGame(false);
        }
    }, 1000);
  }

  const startGame = (useBufferPlayback: boolean, notesOverride?: NoteType[]) => {
    const notesToUse = notesOverride || analyzedNotes;
    if (notesToUse) {
        notesRef.current = notesToUse.map(n => ({
            id: Number(n.id),
            laneIndex: Number(n.laneIndex),
            timestamp: Number(n.timestamp), // Already includes OFFSET from analyzer
            y: Number(n.y),
            hit: Boolean(n.hit),
            missed: Boolean(n.missed)
        }));
    } else {
        notesRef.current = [];
    }

    activeKeysRef.current = new Array(keyMode).fill(false);
    setActiveLanesState(new Array(keyMode).fill(false)); // Reset visual state
    setScore(0); setCombo(0); setMaxCombo(0); setHealth(100);
    setMissCount(0); setPerfectCount(0); setGoodCount(0);
    setHitEffects([]); setIsAutoPlay(false);
    setFeedback(null); // RESET FEEDBACK
    setIsShaking(false); // RESET SHAKE
    totalPauseDurationRef.current = 0;
    
    setStatus(GameStatus.PLAYING);
    startTimeRef.current = performance.now(); // Mark start time

    // For buffer playback (generated audio), we need to delay it manually too
    if (useBufferPlayback && audioBufferRef.current && audioCtxRef.current) {
        // We will start this in the update loop when time > 3000
    }
    
    // Pause media immediately to ensure delay works
    if (mediaRef.current) {
        mediaRef.current.pause();
        mediaRef.current.currentTime = 0;
    }
  };

  const quitGame = () => { playUiSound('select'); setStatus(GameStatus.MENU); setHitEffects([]); };
  const DIFFICULTY_OPTIONS = [ { label: t.EASY, value: 7, color: 'bg-green-500 shadow-green-500/50' }, { label: t.NORMAL, value: 8, color: 'bg-yellow-500 shadow-yellow-500/50' }, { label: t.HARD, value: 9, color: 'bg-orange-500 shadow-orange-500/50' }, { label: t.EXPERT, value: 10, color: 'bg-red-500 shadow-red-500/50' } ];
  
  // Reusable Settings Component to avoid duplication between Desktop Right Column and Mobile Modal
  const SettingsPanelContent = () => (
      <div className="flex flex-col space-y-4">
         <div className="bg-slate-900/80 border border-slate-700 p-4 rounded-lg backdrop-blur-md shadow-lg flex flex-col space-y-2">
             <div><div className={`text-xs font-bold text-slate-500 mb-2 tracking-widest ${fontClass}`}>{t.LEVEL}</div><div className="flex gap-2 h-10">{DIFFICULTY_OPTIONS.map((diff) => { const active = level === diff.value; return ( <button key={diff.value} onClick={() => { setLevel(diff.value); playUiSound('select'); }} className={`flex-1 flex flex-col justify-end p-1 rounded transition-all relative overflow-hidden group border ${active ? 'border-white/50' : 'border-transparent'}`}><div className={`absolute inset-0 opacity-20 ${diff.color}`}></div><div className={`w-full transition-all duration-300 ${active ? 'h-full opacity-100' : 'h-1/3 opacity-40 group-hover:h-1/2'} ${diff.color}`}></div><span className={`relative z-10 text-[10px] md:text-xs font-bold text-center mt-1 truncate ${active ? 'text-white' : 'text-slate-500'} ${fontClass}`}>{diff.label}</span></button> ) })}</div></div>
             <div><div className={`text-xs font-bold text-slate-500 mb-2 tracking-widest ${fontClass}`}>{t.KEY_MODE_LABEL || "KEY CONFIGURATION"}</div><div className="flex gap-2 h-10">{[4, 5, 7].map((k) => { const active = keyMode === k; return ( <button key={k} onClick={()=>{setKeyMode(k as any);playUiSound('select')}} className={`flex-1 relative overflow-hidden rounded border transition-all duration-200 flex items-center justify-center ${active ? 'bg-cyan-900/50 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.3)]' : 'bg-slate-800 border-slate-700 hover:border-cyan-600'}`}><div className={`text-xl font-black italic ${active ? 'text-white' : 'text-slate-500 group-hover:text-cyan-200'}`}>{k}Key</div><div className={`text-[10px] ml-1 font-bold ${active ? 'text-cyan-400' : 'text-slate-600'}`}>MODE</div></button> ); })}</div></div>
             <div><div className={`text-xs font-bold text-slate-500 mb-1 ${fontClass}`}>{t.SCROLL_SPEED}</div><div className="flex items-center bg-black rounded border border-slate-700 p-1"><button onClick={()=>{setSpeedMod(Math.max(1,speedMod-0.5));playUiSound('select')}} className="w-10 h-8 bg-slate-800 text-slate-400 hover:text-white font-bold rounded">-</button><div className="flex-1 text-center font-mono text-cyan-400 font-bold text-lg">{speedMod.toFixed(1)}</div><button onClick={()=>{setSpeedMod(Math.min(10,speedMod+0.5));playUiSound('select')}} className="w-10 h-8 bg-slate-800 text-slate-400 hover:text-white font-bold rounded">+</button></div></div>
         </div>
         <button ref={mobileSetupStartBtnRef} onClick={startCountdownSequence} disabled={isAnalyzing || !analyzedNotes} onMouseEnter={() => playUiSound('hover')} className={`group relative w-full h-14 flex flex-col items-center justify-center transform transition-all duration-200 active:scale-95 ${(isAnalyzing || !analyzedNotes) ? 'opacity-50 grayscale cursor-not-allowed' : 'cursor-pointer'}`}><div className="absolute inset-0 bg-gradient-to-r from-cyan-600 to-blue-600 transform -skew-x-2 border-2 border-white/20 shadow-[0_0_30px_rgba(6,182,212,0.5)] group-hover:shadow-[0_0_60px_rgba(6,182,212,0.8)] transition-shadow rounded"></div><div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-30 mix-blend-overlay"></div><div className="relative z-10 text-center transform -skew-x-2">{isAnalyzing ? ( <div className="flex items-center gap-4"><div className="text-xl font-black text-white animate-pulse">SYSTEM ANALYZING</div><div className="w-24 h-2 bg-black/50 rounded-full overflow-hidden"><div className="h-full bg-white animate-progress"></div></div></div> ) : ( <><div className={`text-2xl font-black italic text-white tracking-tighter drop-shadow-lg ${fontClass}`}>{t.GAME_START}</div></> )}</div></button>
      </div>
  );

  const renderLanes = () => (
    <div 
        ref={laneContainerRef}
        className="relative flex-1 bg-black/10 backdrop-blur-sm flex perspective-1000 outline-none overflow-hidden h-full"
        onTouchStart={handleTouch}
        onTouchMove={handleTouch}
        onTouchEnd={handleTouch}
        onTouchCancel={handleTouch}
    >
        <div className="absolute top-0 left-0 w-full h-1 bg-slate-800 z-40">
             <div ref={progressBarRef} className="h-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]" style={{ width: '0%' }}></div>
        </div>
        {activeLaneConfig.map((lane, index) => (
            <Lane key={index} config={lane} active={activeLanesState[index]} onTrigger={() => triggerLane(index)} onRelease={() => releaseLane(index)} theme={activeThemeObj} />
        ))}
        <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none z-10"></div>
        {currentThemeId !== 'ignore' && (
            <button onClick={(e) => { e.stopPropagation(); togglePause(); playUiSound('select'); }} className="absolute bottom-0 right-0 z-50 w-10 h-10 flex items-center justify-center bg-slate-900/80 border-t border-l border-slate-600 rounded-tl-lg hover:bg-red-900/50 hover:border-red-400 transition-all active:scale-95 group">
                <div className="flex flex-col space-y-1"><div className="w-5 h-0.5 bg-slate-400 group-hover:bg-red-400"></div><div className="w-5 h-0.5 bg-slate-400 group-hover:bg-red-400"></div><div className="w-5 h-0.5 bg-slate-400 group-hover:bg-red-400"></div></div>
            </button>
        )}
        {currentThemeId === 'ignore' ? ( <div className="absolute bottom-24 left-0 w-full h-1 bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.9)] z-20 opacity-80 pointer-events-none"></div> ) : currentThemeId === 'titan' ? ( <div className="absolute bottom-20 left-0 w-full h-[2px] bg-amber-500/80 shadow-[0_0_10px_rgba(245,158,11,0.5)] z-20 pointer-events-none"></div> ) : currentThemeId === 'queen' ? ( <div className="absolute bottom-16 left-0 w-full h-[2px] bg-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.8)] z-20 pointer-events-none"></div> ) : ( <div className="absolute bottom-20 left-0 w-full h-px bg-white/20 pointer-events-none z-20"></div> )}
        {hitEffects.map(effect => { const width = 100 / keyMode; const left = effect.laneIndex * width; return ( <HitEffect key={effect.id} x={`${left}%`} width={`${width}%`} rating={effect.rating} /> ); })}
        {renderNotes.map((note) => { const config = activeLaneConfig[note.laneIndex]; if (!config) return null; return ( <Note key={note.id} note={note} totalLanes={keyMode} color={config.color} theme={activeThemeObj} /> ); })}
        <div className="absolute top-[30%] left-0 right-0 flex flex-col items-center pointer-events-none z-50">
            {isAutoPlay && ( <div className={`text-xl ${fontClass} font-bold text-fuchsia-500 animate-pulse mb-2 border border-fuchsia-500 px-2 bg-black/50`}>{t.AUTO_PILOT}</div> )}
            <div className="flex flex-col items-center">
                <div className={`text-sm font-bold text-slate-500/50 tracking-[0.3em] mb-[-10px] ${fontClass}`}>{t.COMBO}</div>
                <div key={combo} className={`text-9xl font-display font-black italic tracking-tighter opacity-20 ${combo > 0 ? 'animate-cyber-slam' : ''}`}>{combo}</div>
            </div>
            {feedback && ( <div key={feedback.id} className={`mt-8 text-5xl font-black font-display italic ${feedback.color} animate-bounce-short drop-shadow-[0_0_10px_rgba(0,0,0,1)] stroke-black`}>{feedback.text}</div> )}
        </div>
    </div>
  );

  const renderGameFrame = () => {
    if (currentThemeId === 'ignore') {
        return (
            <div className="relative h-full md:max-w-lg w-full flex-shrink-0 z-20 overflow-hidden border-x-[4px] border-slate-300 bg-slate-900/40 backdrop-blur-md shadow-[0_0_60px_rgba(0,0,0,0.9)] flex flex-col">
                <div className="relative flex-1 flex w-full">
                    <div className="w-4 bg-slate-800/80 border-r border-slate-700 relative"><div className="absolute bottom-20 left-1 w-2 h-32 bg-red-900/50 rounded-full animate-pulse"></div></div>
                    {renderLanes()}
                    <div className="w-6 bg-slate-900/80 border-l border-slate-700 relative flex flex-col justify-end p-0.5"><div className={`absolute top-2 left-0 w-full text-[10px] text-center font-bold text-slate-500 vertical-text ${fontClass}`}>{t.GROOVE}</div><div className="w-full bg-slate-800 rounded-sm overflow-hidden h-[80%] relative border border-slate-700"><div className="absolute bottom-0 left-0 w-full transition-all duration-200 bg-gradient-to-t from-red-500 via-yellow-400 to-green-500" style={{ height: `${health}%` }}></div></div><div className={`mt-1 w-full h-1 ${health > 90 ? 'bg-cyan-400 animate-pulse' : 'bg-slate-700'}`}></div></div>
                </div>
                <div className="h-16 bg-gradient-to-b from-slate-200 to-slate-400 relative flex items-center justify-between px-4 border-t-4 border-slate-400 shadow-inner pb-[env(safe-area-inset-bottom)]">
                        <div className="flex flex-col items-center bg-slate-800/80 p-1 rounded border border-slate-600 shadow-inner scale-75 origin-left">
                            <div className={`text-[8px] text-slate-400 font-bold ${fontClass}`}>{t.SCROLL_SPEED}</div><div className="text-sm font-display text-white">{speedMod.toFixed(2)}</div>
                        </div>
                        <div className="flex flex-col items-center bg-black px-3 py-1 rounded border-2 border-slate-500 shadow-[inset_0_0_10px_rgba(0,0,0,0.8)]">
                            <div className={`text-[8px] text-red-900 font-bold tracking-widest w-full text-center ${fontClass}`}>{t.SCORE}</div><div className="font-mono text-2xl text-red-600 font-bold tracking-widest drop-shadow-[0_0_5px_rgba(220,38,38,0.8)]">{score.toString().padStart(7, '0')}</div>
                        </div>
                        <div className="scale-90 origin-right"><button onClick={(e) => { e.stopPropagation(); togglePause(); playUiSound('select'); }} className="w-10 h-10 flex items-center justify-center bg-slate-300 border border-slate-400 rounded shadow-[0_2px_0_rgba(0,0,0,0.2)] hover:bg-white active:scale-95 transition-all group"><div className="flex flex-col space-y-1"><div className="w-5 h-0.5 bg-slate-500 group-hover:bg-slate-800"></div><div className="w-5 h-0.5 bg-slate-500 group-hover:bg-slate-800"></div><div className="w-5 h-0.5 bg-slate-500 group-hover:bg-slate-800"></div></div></button></div>
                </div>
            </div>
        );
    } else if (currentThemeId === 'titan') {
        return (
             <div className="relative h-full md:max-w-lg w-full flex-shrink-0 z-20 overflow-hidden bg-slate-900/40 backdrop-blur-md shadow-[0_0_60px_rgba(245,158,11,0.1)] flex flex-col border-x-8 border-slate-800/50">
                <div className="w-full h-16 bg-slate-800/80 border-b-2 border-amber-600/50 flex items-center justify-between px-4 relative pt-[env(safe-area-inset-top)]"><div className="absolute bottom-0 left-0 w-full h-1 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,#f59e0b_10px,#f59e0b_20px)] opacity-50"></div><div className="flex flex-col"><div className={`text-[10px] text-amber-500 font-bold tracking-widest ${fontClass}`}>{t.SYSTEM_INTEGRITY}</div><div className="w-32 h-3 bg-slate-950 border border-slate-600 mt-1"><div className={`h-full transition-all duration-200 ${health < 30 ? 'bg-red-500' : 'bg-amber-500'}`} style={{width: `${health}%`}}></div></div></div><div className="text-right"><div className={`text-[10px] text-amber-500 font-bold tracking-widest ${fontClass}`}>{t.SCORE_OUTPUT}</div><div className="text-2xl font-mono font-bold text-amber-100">{score.toString().padStart(7, '0')}</div></div></div>
                <div className="flex-1 relative bg-slate-900/10 border-l border-r border-slate-800"><div className="absolute inset-0 opacity-10" style={{backgroundImage: 'radial-gradient(circle, #78716c 1px, transparent 1px)', backgroundSize: '20px 20px'}}></div>{renderLanes()}</div>
                <div className="h-4 bg-slate-800/80 border-t-2 border-amber-600/30 flex justify-center pb-[env(safe-area-inset-bottom)]"><div className="w-1/3 h-full bg-slate-700/80 rounded-b-lg"></div></div>
            </div>
        );
    } else if (currentThemeId === 'queen') {
        return (
            <div className="relative h-full md:max-w-lg w-full flex-shrink-0 z-20 overflow-hidden bg-gradient-to-b from-black/50 via-purple-950/40 to-pink-900/40 backdrop-blur-md shadow-[0_0_60px_rgba(236,72,153,0.3)] flex flex-col border-x-4 border-pink-800/50">
                <div className="w-full py-4 px-6 flex justify-between items-center bg-black/40 backdrop-blur-md border-b border-pink-800 pt-[calc(1rem+env(safe-area-inset-top))]"><div className="flex flex-col"><div className={`text-[10px] text-pink-400 font-serif tracking-widest uppercase ${fontClass}`}>{t.GRACE}</div><div className="w-32 h-2 bg-purple-950 border border-purple-700 rounded-full mt-1 overflow-hidden"><div className={`h-full transition-all duration-200 bg-gradient-to-r from-purple-600 to-pink-500`} style={{width: `${health}%`}}></div></div></div><div className="flex flex-col items-end"><div className={`text-[10px] text-pink-400 font-serif tracking-widest uppercase ${fontClass}`}>{t.POWER}</div><div className="text-3xl font-display font-bold text-pink-100 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)]">{score.toString().padStart(7, '0')}</div></div></div>
                <div className="flex-1 relative flex"><div className="w-2 h-full bg-gradient-to-b from-purple-900/50 via-pink-900/50 to-purple-900/50"></div><div className="flex-1 relative bg-black/10"><div className="absolute inset-0 opacity-10" style={{backgroundImage: 'linear-gradient(135deg, #be185d 25%, transparent 25%), linear-gradient(225deg, #be185d 25%, transparent 25%), linear-gradient(45deg, #be185d 25%, transparent 25%), linear-gradient(315deg, #be185d 25%, transparent 25%)', backgroundPosition: '10px 0, 10px 0, 0 0, 0 0', backgroundSize: '20px 20px', backgroundRepeat: 'repeat'}}></div>{renderLanes()}</div><div className="w-2 h-full bg-gradient-to-b from-purple-900/50 via-pink-900/50 to-purple-900/50"></div></div>
                 <div className="h-2 w-full bg-gradient-to-r from-purple-900 via-pink-600 to-purple-900 mb-[env(safe-area-inset-bottom)]"></div>
            </div>
        );
    } else {
        return (
            <div className="relative h-full md:max-w-lg w-full flex-shrink-0 z-20 overflow-hidden border-x-[4px] border-slate-800/50 bg-black/30 backdrop-blur-md shadow-[0_0_60px_rgba(6,182,212,0.2)] flex flex-col">
                <div className="w-full flex justify-between items-start p-4 bg-gradient-to-b from-slate-900/80 to-transparent z-30 pointer-events-none border-b border-white/10 pt-[calc(1rem+env(safe-area-inset-top))]"><div className="w-1/3"><div className={`text-xs text-cyan-400 font-bold ${fontClass}`}>{t.INTEGRITY}</div><div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-600"><div className={`h-full transition-all duration-200 ${health < 30 ? 'bg-red-500' : 'bg-cyan-500'}`} style={{width: `${health}%`}}></div></div></div><div className="w-1/3 text-right"><div className={`text-xs text-cyan-400 font-bold ${fontClass}`}>{t.SCORE}</div><div className="text-4xl font-mono text-white glow-text">{score.toString().padStart(7, '0')}</div></div></div>
                <div className="flex-1 relative bg-black/10 backdrop-blur-sm">{renderLanes()}</div>
                <div className="h-2 bg-gradient-to-r from-cyan-500 to-blue-500 w-full shadow-[0_0_20px_rgba(6,182,212,0.5)] mb-[env(safe-area-inset-bottom)]"></div>
            </div>
        );
    }
  };

  const getPositionClass = () => {
    if (layoutSettings.lanePosition === 'left') return 'justify-start';
    if (layoutSettings.lanePosition === 'right') return 'justify-end';
    return 'justify-center';
  };

  return (
    <div className={`fixed inset-0 w-full h-[100dvh] bg-black overflow-hidden text-slate-100 select-none touch-none ${isShaking ? 'animate-[shake_0.2s_ease-in-out]' : ''}`}>
      {showMobileStart && (
         <div className="absolute inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-8 pb-[env(safe-area-inset-bottom)] text-center cursor-pointer" onClick={handleMobileEnter}>
            <div className="relative w-24 h-24 mb-8"><div className="absolute inset-0 border-4 border-cyan-500 rounded-full animate-ping opacity-50"></div><div className="absolute inset-0 border-4 border-cyan-400 rounded-full flex items-center justify-center bg-cyan-900/20 backdrop-blur-md"><span className="text-3xl">👆</span></div></div>
            <h1 className={`text-2xl md:text-3xl font-black italic text-white mb-4 animate-pulse tracking-widest ${fontClass}`}>{t.WELCOME_TITLE}</h1>
            <div className="max-w-md bg-slate-900/50 border border-slate-700 p-4 rounded-lg mb-8 backdrop-blur-sm"><p className={`text-slate-300 text-sm md:text-base whitespace-pre-line leading-relaxed ${fontClass}`}>{t.WELCOME_DESC}</p></div>
            <div className="text-xs text-slate-600 font-mono border border-slate-800 px-4 py-2 rounded">TAP TO INITIALIZE SYSTEM</div>
         </div>
      )}

      <audio ref={bgMusicRef} src="/musicbg.mp3" loop />

      <div className="absolute inset-0 z-0 pointer-events-auto overflow-hidden bg-slate-900" ref={bgRef} style={{ transition: 'transform 0.05s, filter 0.05s' }}>
        {(status === GameStatus.TITLE || status === GameStatus.MENU) && (
            <div className="absolute inset-0 z-10 pointer-events-none">
                {layoutSettings.enableMenuBackground ? (
                    <>
                        <video src="/background.mp4" autoPlay loop muted playsInline 
                            // @ts-ignore
                            webkit-playsinline="true" disablePictureInPicture className="absolute inset-0 w-full h-full object-cover pointer-events-none touch-none" />
                        <div className="absolute inset-0 led-screen-filter"></div>
                    </>
                ) : ( <div className="absolute inset-0 bg-slate-950"></div> )}
            </div>
        )}
        {(status === GameStatus.PLAYING || status === GameStatus.PAUSED || status === GameStatus.OUTRO) && (
            <>
                {mediaType === 'video' ? (
                    <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={localVideoSrc} className="absolute inset-0 w-full h-full object-cover z-20 pointer-events-none touch-none" onEnded={triggerOutro} playsInline 
                        // @ts-ignore
                        webkit-playsinline="true" disablePictureInPicture />
                ) : (
                    <div className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm"><audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={localVideoSrc} onEnded={triggerOutro} /></div>
                )}
            </>
        )}
      </div>

      <div className="scanlines z-50 pointer-events-none opacity-40"></div>
      
      {(status === GameStatus.TITLE || status === GameStatus.MENU) && !showMobileStart && (
        <button onClick={() => setIsBgMusicMuted(!isBgMusicMuted)} className="absolute bottom-4 right-4 z-[70] p-2 bg-black/50 hover:bg-black/80 text-cyan-400 border border-cyan-500 rounded-full transition-all active:scale-95 mb-[env(safe-area-inset-bottom)] mr-[env(safe-area-inset-right)]" title="Toggle Intro Music">
            {isBgMusicMuted ? ( <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg> ) : ( <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg> )}
        </button>
      )}

      {showKeyConfig && ( <KeyConfigMenu currentKeyMode={keyMode} mappings={keyMappings} audioSettings={audioSettings} onAudioSettingsChange={setAudioSettings} layoutSettings={layoutSettings} onLayoutSettingsChange={handleLayoutChange} onSave={saveKeyMappings} onClose={() => setShowKeyConfig(false)} onPlaySound={playUiSound} t={t} fontClass={fontClass} /> )}
      {startCountdown !== null && ( <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"><div className="text-[15rem] font-black font-display text-cyan-400 animate-ping">{startCountdown}</div></div> )}
      
      {status === GameStatus.OUTRO && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black animate-fade-in duration-1000">
              <div className="flex flex-col items-center animate-bounce-short">
                  <h1 className="text-9xl font-display font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-cyan-500 filter drop-shadow-[0_0_50px_rgba(6,182,212,0.8)]">DJ<span className="text-cyan-400">BIG</span></h1>
                  <div className={`text-2xl font-mono text-cyan-200 tracking-[1em] mt-4 animate-pulse ${fontClass}`}>{t.MISSION_RESULTS}</div>
              </div>
          </div>
      )}

      {status === GameStatus.TITLE && !showMobileStart && (
          <div className="relative z-30 h-full w-full flex flex-col items-center justify-center overflow-hidden">
              <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"><div className="absolute w-[600px] h-[600px] border-[2px] border-dashed border-cyan-500/20 rounded-full animate-[spin_20s_linear_infinite]"></div><div className="absolute w-[500px] h-[500px] border border-cyan-500/10 rounded-full animate-[spin-ccw_30s_linear_infinite]"></div></div>
              <div className="relative z-10 text-center transform hover:scale-105 transition-transform duration-500 cursor-default mb-12 mt-[-100px]"><div className="flex items-end justify-center leading-none mb-4 animate-pulse"><span className="text-8xl md:text-[10rem] font-black font-display text-white italic drop-shadow-[5px_5px_0px_rgba(6,182,212,1)] tracking-tighter" style={{textShadow: '4px 4px 0px #0891b2'}}>DJ</span><span className="text-8xl md:text-[10rem] font-black font-display text-cyan-400 italic drop-shadow-[0_0_30px_rgba(34,211,238,0.8)] ml-2" style={{textShadow: '0 0 20px cyan'}}>BIG</span></div><div className="inline-block bg-black/80 px-4 py-1 border-x-2 border-cyan-500 backdrop-blur-sm"><p className={`text-cyan-200 font-bold tracking-[0.5em] text-sm md:text-xl font-display uppercase`}>CYBER RHYTHM ACTION</p></div></div>
              <div className="flex flex-col items-center space-y-4 w-full max-w-md z-20">
                  <button onClick={() => { setStatus(GameStatus.MENU); playUiSound('select'); initAudio(); }} onMouseEnter={() => playUiSound('hover')} className="group relative w-80 h-20 bg-gradient-to-r from-cyan-900/80 via-cyan-600 to-cyan-900/80 border-x-4 border-cyan-400 transform -skew-x-12 hover:scale-105 transition-all duration-200 overflow-hidden shadow-[0_0_30px_rgba(6,182,212,0.3)]"><div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-20 transition-opacity"></div><div className="flex flex-col items-center justify-center h-full transform skew-x-12"><span className={`text-3xl font-black italic text-white group-hover:text-cyan-100 ${fontClass}`}>{t.START}</span><span className="text-[10px] font-mono text-cyan-300 tracking-[0.3em]">INITIATE SEQUENCE</span></div></button>
                  <button onClick={() => { setShowKeyConfig(true); playUiSound('select'); }} onMouseEnter={() => playUiSound('hover')} className="group relative w-64 h-14 bg-gradient-to-r from-slate-800/80 via-yellow-900 to-slate-800/80 border-x-4 border-yellow-500 transform -skew-x-12 hover:scale-105 transition-all duration-200 overflow-hidden"><div className="flex flex-col items-center justify-center h-full transform skew-x-12"><span className={`text-xl font-bold text-slate-300 group-hover:text-yellow-200 ${fontClass}`}>{t.SETTING}</span></div></button>
                  <button onClick={() => window.location.reload()} onMouseEnter={() => playUiSound('hover')} className="group relative w-64 h-14 bg-gradient-to-r from-slate-800/80 via-red-900 to-slate-800/80 border-x-4 border-red-500 transform -skew-x-12 hover:scale-105 transition-all duration-200 overflow-hidden"><div className="flex flex-col items-center justify-center h-full transform skew-x-12"><span className={`text-lg font-bold text-slate-300 group-hover:text-red-200 ${fontClass}`}>{t.EXIT}</span></div></button>
               </div>
              <div className="absolute bottom-8 w-full text-center pb-[env(safe-area-inset-bottom)]"><p className="text-xs text-slate-500 font-mono">VER 2.5.0 // CREATED BY : IGNORE</p><p className="text-xs text-slate-600 font-mono mt-1">© 2024 DJBIG PROJECT. ALL RIGHTS RESERVED.</p></div>
          </div>
      )}

      {status === GameStatus.MENU && !startCountdown && (
        <div className="relative z-30 w-full h-full flex flex-col md:flex-row animate-fade-in bg-slate-900/40 backdrop-blur-md overflow-hidden">
          <div className="md:hidden w-full min-h-[4rem] bg-slate-900 flex items-center justify-between px-4 z-50 border-b border-slate-700 shrink-0 pt-[max(2rem,env(safe-area-inset-top))] pb-2">
             <button onClick={() => { setStatus(GameStatus.TITLE); stopPreview(); }} className="text-white font-bold text-sm flex items-center gap-1">← {t.BACK}</button>
             <div className="flex items-center gap-3">
                {songList.length > 0 && (
                     <button onClick={handleClearPlaylist} className={`text-[10px] text-red-400 font-bold border border-red-900/50 px-2 py-1 rounded bg-red-900/10 hover:bg-red-900/30 ${fontClass}`}>
                        {t.CLEAR_PLAYLIST}
                     </button>
                )}
                <div className="text-cyan-400 font-bold text-sm hidden sm:block">MUSIC SELECT</div>
            </div>
          </div>
          <div className={`w-full ${isMobile ? 'flex-1 min-h-0' : 'md:w-[55%] h-full'} flex flex-col bg-slate-950/80 border-r border-slate-700/50 relative shrink-0 overflow-hidden`}>
             <div className="hidden md:flex h-24 items-end justify-between pb-4 px-8 border-b border-cyan-500/30 bg-gradient-to-b from-slate-900 to-transparent shrink-0">
                <h2 className={`text-4xl font-black italic text-white tracking-tighter ${fontClass} drop-shadow-md`}>SELECT <span className="text-cyan-400">MUSIC</span></h2>
                {songList.length > 0 && (
                    <button onClick={handleClearPlaylist} className={`text-xs font-bold text-red-500 hover:text-red-300 transition-colors tracking-widest border border-red-900/50 hover:border-red-500 px-3 py-1 rounded uppercase bg-slate-900/50 ${fontClass}`}>
                        {t.CLEAR_PLAYLIST}
                    </button>
                )}
             </div>
             <div className="w-full flex-1 overflow-y-auto custom-scrollbar p-0 space-y-1 pb-48 md:pb-0">
                 {/* Demo Tracks */}
                 <div onClick={(e) => { loadDemoTrack('/demoplay.mp4', 'DEMO_TRACK_01'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${localFileName === "DEMO_TRACK_01" ? 'bg-gradient-to-r from-green-900/80 to-transparent border-green-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-green-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}>
                    <div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${localFileName === "DEMO_TRACK_01" ? 'border-white animate-spin-slow' : 'border-slate-600'} bg-black overflow-hidden shadow-lg shrink-0`}>
                        <div className="w-4 h-4 bg-slate-900 rounded-full absolute z-10 border border-slate-600"></div>
                        <div className={`w-full h-full bg-gradient-to-tr from-green-500 to-emerald-700 opacity-80`}></div>
                        <span className="absolute text-[8px] font-black text-black/50 z-0 rotate-45">DJBIG</span>
                    </div>
                    <div className="flex-1 min-w-0"><MarqueeText text={t.PLAY_DEMO_01} className={`text-lg font-bold ${fontClass} ${localFileName === "DEMO_TRACK_01" ? 'text-white' : 'text-slate-400 group-hover:text-green-200'}`} /><div className="text-xs font-mono text-green-600/70">HIGH SPEED ROCK // 175 BPM</div></div>{localFileName === "DEMO_TRACK_01" && <div className="text-green-400 text-xl animate-pulse">◀</div>}
                 </div>
                 
                 <div onClick={(e) => { loadDemoTrack('/demoplay02.mp4', 'DEMO_TRACK_02'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${localFileName === "DEMO_TRACK_02" ? 'bg-gradient-to-r from-amber-900/80 to-transparent border-amber-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-amber-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}>
                    <div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${localFileName === "DEMO_TRACK_02" ? 'border-white animate-spin-slow' : 'border-slate-600'} bg-black overflow-hidden shadow-lg shrink-0`}>
                        <div className="w-4 h-4 bg-slate-900 rounded-full absolute z-10 border border-slate-600"></div>
                        <div className={`w-full h-full bg-gradient-to-tr from-amber-500 to-orange-700 opacity-80`}></div>
                        <span className="absolute text-[8px] font-black text-black/50 z-0 rotate-45">DJBIG</span>
                    </div>
                    <div className="flex-1 min-w-0"><MarqueeText text={t.PLAY_DEMO_02} className={`text-lg font-bold ${fontClass} ${localFileName === "DEMO_TRACK_02" ? 'text-white' : 'text-slate-400 group-hover:text-amber-200'}`} /><div className="text-xs font-mono text-amber-600/70">ALTERNATIVE MIX // 140 BPM</div></div>{localFileName === "DEMO_TRACK_02" && <div className="text-amber-400 text-xl animate-pulse">◀</div>}
                 </div>

                 <div onClick={(e) => { loadDemoTrack('/demoplay03.mp4', 'DEMO_TRACK_03'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${localFileName === "DEMO_TRACK_03" ? 'bg-gradient-to-r from-purple-900/80 to-transparent border-purple-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-purple-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}>
                    <div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${localFileName === "DEMO_TRACK_03" ? 'border-white animate-spin-slow' : 'border-slate-600'} bg-black overflow-hidden shadow-lg shrink-0`}>
                        <div className="w-4 h-4 bg-slate-900 rounded-full absolute z-10 border border-slate-600"></div>
                        <div className={`w-full h-full bg-gradient-to-tr from-purple-500 to-fuchsia-700 opacity-80`}></div>
                        <span className="absolute text-[8px] font-black text-black/50 z-0 rotate-45">DJBIG</span>
                    </div>
                    <div className="flex-1 min-w-0"><MarqueeText text={t.PLAY_DEMO_03} className={`text-lg font-bold ${fontClass} ${localFileName === "DEMO_TRACK_03" ? 'text-white' : 'text-slate-400 group-hover:text-purple-200'}`} /><div className="text-xs font-mono text-purple-600/70">ELECTRONIC CORE // 150 BPM</div></div>{localFileName === "DEMO_TRACK_03" && <div className="text-purple-400 text-xl animate-pulse">◀</div>}
                 </div>

                 <div onClick={(e) => { loadDemoTrack('/demoplay04.mp4', 'DEMO_TRACK_04'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${localFileName === "DEMO_TRACK_04" ? 'bg-gradient-to-r from-rose-900/80 to-transparent border-rose-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-rose-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}>
                    <div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${localFileName === "DEMO_TRACK_04" ? 'border-white animate-spin-slow' : 'border-slate-600'} bg-black overflow-hidden shadow-lg shrink-0`}>
                        <div className="w-4 h-4 bg-slate-900 rounded-full absolute z-10 border border-slate-600"></div>
                        <div className={`w-full h-full bg-gradient-to-tr from-rose-500 to-pink-700 opacity-80`}></div>
                        <span className="absolute text-[8px] font-black text-black/50 z-0 rotate-45">DJBIG</span>
                    </div>
                    <div className="flex-1 min-w-0"><MarqueeText text={t.PLAY_DEMO_04} className={`text-lg font-bold ${fontClass} ${localFileName === "DEMO_TRACK_04" ? 'text-white' : 'text-slate-400 group-hover:text-rose-200'}`} /><div className="text-xs font-mono text-rose-600/70">CYBER PUNK ROCK // 160 BPM</div></div>{localFileName === "DEMO_TRACK_04" && <div className="text-rose-400 text-xl animate-pulse">◀</div>}
                 </div>
                 
                 {songList.map((song, idx) => {
                     const isActive = localFileName === song.name;
                     return (
                        <div key={song.id} onClick={(e) => { handleFileSelect(song.file, song); playUiSound('select'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${isActive ? 'bg-gradient-to-r from-cyan-900/80 to-transparent border-cyan-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-cyan-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}>
                            <div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${isActive ? 'border-white animate-spin-slow' : 'border-slate-700'} bg-black/50 overflow-hidden shrink-0 shadow-lg`}>
                                {song.thumbnailUrl ? (
                                    <img src={song.thumbnailUrl} className="w-full h-full object-cover" alt="Cover" />
                                ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center">
                                        <div className="text-[8px] font-bold text-slate-400 text-center leading-none rotate-45">DJ<br/>BIG</div>
                                    </div>
                                )}
                                <div className="absolute w-3 h-3 bg-slate-900 rounded-full border border-slate-600 z-10"></div>
                            </div>
                            <div className="flex-1 min-w-0 overflow-hidden"><MarqueeText text={song.name} className={`text-lg font-bold ${fontClass} ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-cyan-200'}`} /><div className="text-xs font-mono text-slate-600 group-hover:text-cyan-600/70 uppercase">{song.type.toUpperCase()} FILE</div></div>
                        </div>
                     );
                 })}
             </div>

             {/* MOBILE FIXED BOTTOM BAR (STICKY) */}
             {isMobile && !showMobileSetup && (
                <div className="fixed bottom-0 left-0 w-full z-50 bg-slate-950/95 border-t border-slate-700 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
                    {/* Floating Play Button (Integrated into bottom area) */}
                    {currentSongMetadata && (
                        <div className="px-4 pt-2 pb-2">
                            <button 
                                onClick={() => { 
                                    playUiSound('select'); 
                                    if (typeof navigator !== 'undefined' && navigator.vibrate) {
                                        try { navigator.vibrate(50); } catch(e) {}
                                    }
                                    setShowMobileSetup(true); 
                                }}
                                className="w-full h-14 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.6)] flex items-center justify-center border-2 border-white/20 animate-bounce-short hover:scale-105 transition-transform"
                            >
                                <span className={`text-xl font-black italic text-white mr-2 ${fontClass}`}>PLAY</span>
                                <span className="text-white/80 font-mono text-xs truncate max-w-[200px]">{currentSongMetadata.name}</span>
                            </button>
                        </div>
                    )}

                    {/* Footer Buttons */}
                    <div className="flex gap-2 p-2 pt-0">
                        <label className="flex-1 h-10 bg-slate-800 hover:bg-cyan-900/50 border border-slate-600 hover:border-cyan-500 rounded flex items-center justify-center cursor-pointer transition-colors group">
                            <span className={`text-[10px] font-bold text-slate-400 group-hover:text-cyan-400 ${fontClass}`}>+ {t.LOAD_SINGLE}</span>
                            <input type="file" accept="video/*,audio/*" onChange={handleSingleFileUpload} className="hidden" />
                        </label>
                        <label className="flex-1 h-10 bg-slate-800 hover:bg-fuchsia-900/50 border border-slate-600 hover:border-fuchsia-500 rounded flex items-center justify-center cursor-pointer transition-colors group">
                            <span className={`text-[10px] font-bold text-slate-400 group-hover:text-fuchsia-400 ${fontClass}`}>+ {t.LOAD_FOLDER}</span>
                            <input type="file" multiple onChange={handleFolderSelect} className="hidden" {...({ webkitdirectory: "", directory: "" } as any)} />
                        </label>
                    </div>
                </div>
             )}
             
             {/* FOOTER BUTTONS (DESKTOP ONLY) */}
             {!isMobile && (
                <div className="bg-black/80 p-4 border-t border-slate-700 flex gap-2 shrink-0 z-40 relative pb-[calc(1rem+env(safe-area-inset-bottom))]">
                    <label className="flex-1 h-12 bg-slate-800 hover:bg-cyan-900/50 border border-slate-600 hover:border-cyan-500 rounded flex items-center justify-center cursor-pointer transition-colors group"><span className={`text-xs font-bold text-slate-400 group-hover:text-cyan-400 ${fontClass}`}>+ {t.LOAD_SINGLE}</span><input type="file" accept="video/*,audio/*" onChange={handleSingleFileUpload} className="hidden" /></label>
                    <label className="flex-1 h-12 bg-slate-800 hover:bg-fuchsia-900/50 border border-slate-600 hover:border-fuchsia-500 rounded flex items-center justify-center cursor-pointer transition-colors group"><span className={`text-xs font-bold text-slate-400 group-hover:text-fuchsia-400 ${fontClass}`}>+ {t.LOAD_FOLDER}</span><input type="file" multiple onChange={handleFolderSelect} className="hidden" {...({ webkitdirectory: "", directory: "" } as any)} /></label>
                </div>
             )}
          </div>
          
          {/* Right Column (Desktop) */}
          {!isMobile && (
            <div className="w-full md:w-[45%] h-auto md:h-full relative flex flex-col p-4 md:p-6 justify-between shrink-0 md:overflow-hidden pb-32 md:pb-6">
                 <div className="hidden md:flex w-full justify-between items-start mb-4 z-20 shrink-0"><button onClick={() => { setStatus(GameStatus.TITLE); playUiSound('select'); stopPreview(); }} className="flex items-center space-x-2 text-slate-500 hover:text-white transition-colors group"><div className="w-8 h-8 rounded-full border border-slate-600 group-hover:border-white flex items-center justify-center">←</div><span className={`font-bold tracking-widest ${fontClass}`}>{t.BACK}</span></button><div className="flex space-x-4"><button onClick={() => { setShowKeyConfig(true); playUiSound('select'); }} className="text-slate-500 hover:text-yellow-400 font-bold text-sm tracking-widest">{t.SETTING}</button></div></div>
                 <div className="hidden md:flex absolute inset-0 items-center justify-center opacity-30 pointer-events-none z-0"><div className="w-[80vw] h-[80vw] md:w-[600px] md:h-[600px] border border-cyan-500/20 rounded-full animate-[spin_60s_linear_infinite] border-dashed"></div><div className="absolute w-[60vw] h-[60vw] md:w-[450px] md:h-[450px] border border-white/5 rounded-full animate-[spin-ccw_40s_linear_infinite]"></div></div>
                 <div className="relative z-10 flex flex-col items-center justify-center flex-1 my-8 md:my-0 min-h-0">
                     <div className="relative w-40 h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 mb-6 group shrink-0"><div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-xl animate-pulse"></div><div className="relative w-full h-full rounded-full border-4 border-slate-800 bg-black overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-[spin_10s_linear_infinite]">{currentSongMetadata?.thumbnailUrl ? ( <img src={currentSongMetadata.thumbnailUrl} className="w-full h-full object-cover opacity-80" alt="Cover" /> ) : ( <div className="w-full h-full bg-gradient-to-tr from-slate-800 to-slate-900 flex items-center justify-center"><div className="w-1/3 h-1/3 bg-cyan-500 rounded-full blur-md"></div></div> )}<div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none"></div></div><div className="absolute top-1/2 left-1/2 w-8 h-8 bg-slate-900 rounded-full transform -translate-x-1/2 -translate-y-1/2 border-2 border-slate-600 z-20"></div></div>
                     <div className="text-center w-full max-w-lg shrink-0"><h1 className={`text-3xl md:text-5xl font-black italic text-white tracking-tighter drop-shadow-[0_0_20px_rgba(6,182,212,0.8)] mb-2 ${fontClass}`}>{localFileName ? ( <MarqueeText text={localFileName} /> ) : t.SELECT_SOURCE}</h1>{localFileName && ( <div className="inline-block bg-cyan-900/30 border border-cyan-500/30 px-4 py-1 rounded-full text-cyan-400 font-mono text-sm tracking-widest">{isPlayingPreview ? 'PREVIEWING...' : 'READY TO START'}</div> )}</div>
                 </div>
                 <div className="relative z-20 mt-4 md:mt-0 space-y-4 pb-8 md:pb-0 shrink-0">
                     <SettingsPanelContent />
                 </div>
            </div>
          )}
          
          {/* MOBILE POPUP SETUP MODAL */}
          {showMobileSetup && isMobile && (
              <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-xl flex flex-col p-6 animate-fade-in overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                  <button onClick={() => setShowMobileSetup(false)} className="absolute top-4 right-4 text-white p-2 z-50 bg-black/50 rounded-full border border-slate-600 mt-[env(safe-area-inset-top)] mr-[env(safe-area-inset-right)]">✕</button>
                  
                  <div className="flex flex-col items-center mb-6 mt-8 pt-[env(safe-area-inset-top)]">
                       <div className="w-32 h-32 rounded-full border-4 border-cyan-500/50 overflow-hidden shadow-[0_0_30px_rgba(6,182,212,0.4)] mb-4 animate-[spin_20s_linear_infinite]">
                           {currentSongMetadata?.thumbnailUrl ? (
                               <img src={currentSongMetadata.thumbnailUrl} className="w-full h-full object-cover" alt="Cover" />
                           ) : (
                               <div className="w-full h-full bg-slate-800 flex items-center justify-center"><span className="text-cyan-500 font-bold">DJBIG</span></div>
                           )}
                       </div>
                       <h2 className={`text-2xl font-black italic text-white text-center leading-none ${fontClass}`}>{currentSongMetadata?.name}</h2>
                       <div className="text-cyan-400 text-xs font-mono mt-1">SETUP CONFIGURATION</div>
                  </div>

                  <div className="flex-1 w-full max-w-md mx-auto">
                      <SettingsPanelContent />
                  </div>
              </div>
          )}

        </div>
      )}

      {(status === GameStatus.PLAYING || status === GameStatus.PAUSED) && ( 
          <>
            <div className={`absolute bottom-8 z-30 hidden md:flex flex-col pointer-events-none transition-all duration-500 ${layoutSettings.lanePosition === 'right' ? 'left-8 items-start' : 'right-8 items-end'}`}>
                <div className="text-[5rem] font-black font-display italic tracking-tighter leading-none select-none mb-[-1rem] transform -skew-x-12 opacity-80"
                     style={{
                         backgroundImage: 'linear-gradient(to bottom, #22d3ee 0%, #3b82f6 50%, #9333ea 100%)',
                         WebkitBackgroundClip: 'text',
                         WebkitTextFillColor: 'transparent',
                         filter: 'drop-shadow(0 4px 0px rgba(0,0,0,0.5))'
                     }}>
                    IGNORE <span className="text-white" style={{ WebkitTextFillColor: 'white' }}>PROTOCOL</span>
                </div>
                <div className={`flex flex-col relative w-64 ${layoutSettings.lanePosition === 'right' ? 'items-start' : 'items-end'}`}>
                    <MarqueeText 
                        text={currentSongMetadata?.name?.replace(/\.[^/.]+$/, "") || "UNKNOWN TRACK"} 
                        className={`text-3xl font-black italic text-white tracking-tighter drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] uppercase ${fontClass}`}
                    />
                    <div className="flex gap-2 mt-1">
                        <span className="px-2 py-0.5 bg-black/60 border border-white/20 text-[10px] font-mono text-cyan-400 rounded">LV.{level}</span>
                        <span className="px-2 py-0.5 bg-black/60 border border-white/20 text-[10px] font-mono text-fuchsia-400 rounded">{keyMode}Key</span>
                    </div>
                </div>
            </div>

            <div className={`absolute inset-0 z-40 flex items-center ${getPositionClass()}`}>{renderGameFrame()}</div>
          </> 
      )}
      {status === GameStatus.PAUSED && ( <PauseMenu onResume={togglePause} onRestart={startCountdownSequence} onSettings={() => setShowKeyConfig(true)} onQuit={quitGame} t={t} fontClass={fontClass} onTitleClick={handlePauseTitleClick} /> )}
      {status === GameStatus.FINISHED && ( <EndScreen stats={{ perfect: perfectCount, good: goodCount, miss: missCount, maxCombo: maxCombo, score: score }} fileName={currentSongMetadata?.name || "UNKNOWN"} onRestart={startCountdownSequence} onMenu={quitGame} t={t} fontClass={fontClass} onPlaySound={playUiSound} /> )}
    </div>
  );
};

export default App;
