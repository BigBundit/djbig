import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { StatusBar } from '@capacitor/status-bar';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
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
  LayoutSettings,
  GameModifiers
} from './types';
import { 
  LANE_CONFIGS_4,
  LANE_CONFIGS_5,
  LANE_CONFIGS_7,
  BASE_FALL_SPEED_MS,
  DEFAULT_KEY_MAPPINGS,
  GAME_THEMES,
  HOLD_TICK_SCORE
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
import { saveSongToDB, getAllSongsFromDB, clearAllSongsFromDB, deleteSongFromDB } from './utils/songStorage';
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
    lanePosition: 'center',
    enableMenuBackground: true,
    language: 'en',
    enableVibration: true,
    graphicsQuality: 'high'
};

const START_OFFSET_MS = 5000; // เวลาดีเลย์รวม (นับถอยหลัง 3 วิ + เตรียมพร้อม 2 วิ)
const PRE_ROLL_MS = 3000; // ระยะเวลา padding เพื่อให้โน้ตไหลลงมาทันก่อนเพลงเริ่ม

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

const codeToLabel = (code: string) => {
    if (code === 'Space') return 'SPC';
    if (code.startsWith('Key')) return code.replace('Key', '');
    if (code.startsWith('Digit')) return code.replace('Digit', '');
    return code.toUpperCase().slice(0,3);
};

const App: React.FC = () => {
  const [status, setStatus] = useState<GameStatus>(GameStatus.TITLE);
  const [score, setScore] = useState<number>(0);
  const [combo, setCombo] = useState<number>(0);
  const [maxCombo, setMaxCombo] = useState<number>(0);
  const [health, setHealth] = useState<number>(100);
  
  const [overdrive, setOverdrive] = useState<number>(0); 
  const [isOverdrive, setIsOverdrive] = useState<boolean>(false);
  
  const [perfectCount, setPerfectCount] = useState<number>(0);
  const [goodCount, setGoodCount] = useState<number>(0);
  const [missCount, setMissCount] = useState<number>(0);
  
  const [currentRank, setCurrentRank] = useState<string>('SSS');

  const [feedback, setFeedback] = useState<{ text: string; color: string; id: number } | null>(null);
  const [isAutoPlay, setIsAutoPlay] = useState<boolean>(false);
  
  const [startCountdown, setStartCountdown] = useState<number | null>(null);
  const [resumeCountdown, setResumeCountdown] = useState<number | null>(null); 

  const [hitEffects, setHitEffects] = useState<HitEffectData[]>([]);

  const [localVideoSrc, setLocalVideoSrc] = useState<string>('');
  const [localFileName, setLocalFileName] = useState<string>('');
  const [mediaType, setMediaType] = useState<'audio' | 'video'>('video');
  const [currentSongMetadata, setCurrentSongMetadata] = useState<SongMetadata | null>(null);
  
  const [soundProfile, setSoundProfile] = useState<'electronic' | 'rock' | 'chiptune'>('electronic');

  const [songList, setSongList] = useState<SongMetadata[]>([]);
  const [isLoadingFolder, setIsLoadingFolder] = useState<boolean>(false);
  
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analyzedNotes, setAnalyzedNotes] = useState<NoteType[] | null>(null);

  const [level, setLevel] = useState<number>(() => {
      const saved = localStorage.getItem('djbig_level');
      return saved ? parseInt(saved, 10) : 7;
  });
  
  const [speedMod, setSpeedMod] = useState<number>(() => {
      const saved = localStorage.getItem('djbig_speed');
      return saved ? parseFloat(saved) : 1.5;
  });
  
  const [keyMode, setKeyMode] = useState<4 | 5 | 7>(() => {
      const saved = localStorage.getItem('djbig_keymode');
      if (saved) {
          const parsed = parseInt(saved, 10);
          if ([4, 5, 7].includes(parsed)) return parsed as 4 | 5 | 7;
      }
      return 4;
  });

  const [modifiers, setModifiers] = useState<GameModifiers>(() => {
      const saved = localStorage.getItem('djbig_modifiers');
      return saved ? JSON.parse(saved) : { mirror: false, sudden: false, hidden: false };
  });

  const [keyMappings, setKeyMappings] = useState<KeyMapping>(DEFAULT_KEY_MAPPINGS);
  const [showKeyConfig, setShowKeyConfig] = useState<boolean>(false);

  const [audioSettings, setAudioSettings] = useState<AudioSettings>({ masterVolume: 0.5, sfxVolume: 1.0, musicVolume: 0.5, audioOffset: 0 });
  const [isBgMusicMuted, setIsBgMusicMuted] = useState<boolean>(false);
  
  const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>(DEFAULT_LAYOUT);

  const [currentThemeId, setCurrentThemeId] = useState<ThemeId>('ignore');
  const [playerStats, setPlayerStats] = useState<PlayerStats>(DEFAULT_STATS);

  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [showMobileStart, setShowMobileStart] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [showMobileSetup, setShowMobileSetup] = useState<boolean>(false);
  
  // --- Auth & Multiplayer State ---
  const [user, setUser] = useState<{ name: string; picture: string } | null>(null);
  const [showMultiplayerMenu, setShowMultiplayerMenu] = useState<boolean>(false);
  const [multiplayerRoomId, setMultiplayerRoomId] = useState<string>('');
  const [isMultiplayer, setIsMultiplayer] = useState<boolean>(false);
  const [opponentState, setOpponentState] = useState<{ score: number; health: number; combo: number; name: string } | null>(null);
  const [mpStatus, setMpStatus] = useState<'LOBBY' | 'WAITING' | 'READY' | 'PLAYING' | 'FINISHED'>('LOBBY');
  const wsRef = useRef<WebSocket | null>(null);
  const [joinRoomIdInput, setJoinRoomIdInput] = useState('');
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [guestNameInput, setGuestNameInput] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [isGuestReady, setIsGuestReady] = useState(false);
  const [showLobbySongSelect, setShowLobbySongSelect] = useState(false);
  const [isOpponentFinished, setIsOpponentFinished] = useState(false);
  const [opponentFinalScore, setOpponentFinalScore] = useState<number | null>(null);

  // --- WebRTC ---
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const [transferProgress, setTransferProgress] = useState<number | null>(null);
  const [transferStatus, setTransferStatus] = useState<string>('');
  const fileChunksRef = useRef<ArrayBuffer[]>([]);
  const receivedSizeRef = useRef<number>(0);
  const expectedSizeRef = useRef<number>(0);
  const currentFileNameRef = useRef<string>('');
  const currentFileTypeRef = useRef<string>('');

  const mobileSetupStartBtnRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const t = TRANSLATIONS[layoutSettings.language];
  const fontClass = layoutSettings.language === 'th' ? 'font-thai' : 'font-display';

  const audioSettingsRef = useRef<AudioSettings>(audioSettings);

  const frameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const totalPauseDurationRef = useRef<number>(0);
  
  const statusRef = useRef<GameStatus>(GameStatus.TITLE);
  
  const notesRef = useRef<NoteType[]>([]);
  const activeKeysRef = useRef<boolean[]>(new Array(7).fill(false)); 
  
  const [activeLanesState, setActiveLanesState] = useState<boolean[]>(new Array(7).fill(false));

  const mediaRef = useRef<HTMLMediaElement>(null); 
  const bgVideoRef = useRef<HTMLVideoElement>(null); 
  const bgMusicRef = useRef<HTMLAudioElement>(null); 
  const bgRef = useRef<HTMLDivElement>(null); 
  const progressBarRef = useRef<HTMLDivElement>(null); 
  
  const audioBufferRef = useRef<AudioBuffer | null>(null); 
  const audioDurationRef = useRef<number>(0); 

  const noiseBufferRef = useRef<AudioBuffer | null>(null); 
  
  const laneContainerRef = useRef<HTMLDivElement>(null);
  const touchedLanesRef = useRef<Set<number>>(new Set());
  
  const lastPauseTitleClickRef = useRef<number>(0);

  const [renderNotes, setRenderNotes] = useState<NoteType[]>([]);
  const noteRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const visibleNoteIdsRef = useRef<Set<number>>(new Set());
  const holdingNoteIdsRef = useRef<Set<number>>(new Set());

  const isLowQuality = layoutSettings.graphicsQuality === 'low';

  useEffect(() => {
    const initCapacitor = async () => {
        try {
            await StatusBar.hide();
        } catch (e) {
            console.log("StatusBar/Capacitor not available or failed to hide");
        }
    };
    initCapacitor();
  }, []);
  
  const triggerHaptic = useCallback((intensity: 'light' | 'medium' | 'heavy' = 'light') => {
      if (layoutSettings.enableVibration === false) return;

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
          const ms = intensity === 'heavy' ? 40 : (intensity === 'medium' ? 20 : 10);
          try { navigator.vibrate(ms); } catch(e) {}
      }

      try {
          let style = ImpactStyle.Light;
          if (intensity === 'medium') style = ImpactStyle.Medium;
          if (intensity === 'heavy') style = ImpactStyle.Heavy;
          Haptics.impact({ style }).catch(() => {});
      } catch (e) {
      }
  }, [layoutSettings.enableVibration]);

  useEffect(() => {
    const checkMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    setIsMobile(checkMobile);
    if (checkMobile) {
        setShowMobileStart(true);
    }
  }, []);

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

  useEffect(() => {
    if (showMobileSetup && mobileSetupStartBtnRef.current) {
        setTimeout(() => {
            mobileSetupStartBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 100);
    }
  }, [showMobileSetup]);

  const handleLogin = async () => {
    try {
      const response = await fetch('/api/auth/google/url');
      const { url } = await response.json();
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(url, 'google_login', `width=${width},height=${height},left=${left},top=${top}`);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleMetaMaskLogin = async () => {
      if (typeof (window as any).ethereum !== 'undefined') {
          try {
              const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
              if (accounts.length > 0) {
                  setUser({ name: `ETH: ${accounts[0].slice(0, 6)}...`, picture: '' });
                  playUiSound('select');
              }
          } catch (error) {
              console.error("MetaMask connection failed", error);
              setFeedback({ text: "METAMASK ERROR", color: "text-red-500", id: Date.now() });
          }
      } else {
          setFeedback({ text: "METAMASK NOT FOUND", color: "text-red-500", id: Date.now() });
          window.open('https://metamask.io/download/', '_blank');
      }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'OAUTH_AUTH_SUCCESS') {
        setUser(event.data.user);
        playUiSound('select');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const initWebRTC = (isInitiator: boolean, targetId?: string) => {
      const peer = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      peer.onicecandidate = (event) => {
          if (event.candidate && wsRef.current) {
              wsRef.current.send(JSON.stringify({
                  type: 'SIGNAL',
                  targetId: targetId || 'HOST', // If guest, target is host (implicit)
                  signal: { type: 'candidate', candidate: event.candidate }
              }));
          }
      };

      if (isInitiator) {
          const channel = peer.createDataChannel('fileTransfer');
          setupDataChannel(channel);
          dataChannelRef.current = channel;
          
          peer.createOffer().then(offer => {
              peer.setLocalDescription(offer);
              if (wsRef.current) {
                  wsRef.current.send(JSON.stringify({
                      type: 'SIGNAL',
                      targetId: targetId,
                      signal: { type: 'offer', sdp: offer }
                  }));
              }
          });
      } else {
          peer.ondatachannel = (event) => {
              setupDataChannel(event.channel);
              dataChannelRef.current = event.channel;
          };
      }

      peerRef.current = peer;
  };

  const setupDataChannel = (channel: RTCDataChannel) => {
      channel.onopen = () => {
          console.log('Data channel open');
          if (peerRef.current && peerRef.current.localDescription?.type === 'offer') {
               // Host side: Ready to send if requested
          }
      };

      channel.onmessage = (event) => {
          const data = event.data;
          if (typeof data === 'string') {
              const msg = JSON.parse(data);
              if (msg.type === 'FILE_START') {
                  setTransferStatus(`Receiving ${msg.name}...`);
                  setTransferProgress(0);
                  fileChunksRef.current = [];
                  receivedSizeRef.current = 0;
                  expectedSizeRef.current = msg.size;
                  currentFileNameRef.current = msg.name;
                  currentFileTypeRef.current = msg.fileType;
              } else if (msg.type === 'FILE_END') {
                  setTransferStatus('Processing file...');
                  const blob = new Blob(fileChunksRef.current, { type: currentFileTypeRef.current });
                  const file = new File([blob], currentFileNameRef.current, { type: currentFileTypeRef.current });
                  handleFileSelect(file); // Load the received song!
                  setTransferProgress(null);
                  setTransferStatus('Download Complete!');
                  setTimeout(() => setTransferStatus(''), 3000);
              }
          } else {
              // Binary chunk
              fileChunksRef.current.push(data);
              receivedSizeRef.current += data.byteLength;
              if (expectedSizeRef.current > 0) {
                  setTransferProgress((receivedSizeRef.current / expectedSizeRef.current) * 100);
              }
          }
      };
  };

  const sendFile = async () => {
      if (!currentSongMetadata?.file || !dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
      
      const file = currentSongMetadata.file;
      const CHUNK_SIZE = 16384; // 16KB
      
      dataChannelRef.current.send(JSON.stringify({
          type: 'FILE_START',
          name: file.name,
          size: file.size,
          fileType: file.type
      }));

      const buffer = await file.arrayBuffer();
      let offset = 0;

      while (offset < buffer.byteLength) {
          const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
          dataChannelRef.current.send(chunk);
          offset += CHUNK_SIZE;
          
          // Yield to main thread occasionally to prevent UI freeze
          if (offset % (CHUNK_SIZE * 100) === 0) await new Promise(r => setTimeout(r, 0));
      }

      dataChannelRef.current.send(JSON.stringify({ type: 'FILE_END' }));
  };

  const startCountdownSequenceRef = useRef<() => void>(() => {});

  useEffect(() => {
      startCountdownSequenceRef.current = startCountdownSequence;
  });

  const handleGuestLogin = () => {
      if (!guestNameInput.trim()) return;
      setUser({ name: guestNameInput.trim(), picture: '' });
      setShowNamePrompt(false);
      // Automatically open multiplayer menu after setting name
      setTimeout(() => initMultiplayer(), 100);
  };

  const initMultiplayer = () => {
    if (!user) { 
        setShowNamePrompt(true); 
        return; 
    }
    setShowMultiplayerMenu(true);
    
    if (!wsRef.current) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}`);
        
        ws.onopen = () => {
            console.log('Connected to Multiplayer Server');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'ROOM_CREATED':
                    setMultiplayerRoomId(data.roomId);
                    setMpStatus('WAITING');
                    setIsHost(true);
                    break;
                case 'PLAYER_JOINED':
                    setMpStatus('READY');
                    const opponent = data.players.find((p: any) => p.name !== user.name);
                    if (opponent) {
                        setOpponentState({ name: opponent.name, score: 0, health: 100, combo: 0 });
                        // Host initiates WebRTC connection
                        if (data.players[0].name === user.name) {
                            initWebRTC(true, opponent.id);
                            setIsHost(true);
                        } else {
                            setIsHost(false);
                        }
                    }
                    break;
                case 'PLAYER_READY':
                    setIsGuestReady(data.ready);
                    break;
                case 'SIGNAL':
                    if (!peerRef.current) initWebRTC(false, data.senderId);
                    const signal = data.signal;
                    if (signal.type === 'offer') {
                        peerRef.current?.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                        peerRef.current?.createAnswer().then(answer => {
                            peerRef.current?.setLocalDescription(answer);
                            wsRef.current?.send(JSON.stringify({
                                type: 'SIGNAL',
                                targetId: data.senderId,
                                signal: { type: 'answer', sdp: answer }
                            }));
                        });
                    } else if (signal.type === 'answer') {
                        peerRef.current?.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                    } else if (signal.type === 'candidate') {
                        peerRef.current?.addIceCandidate(new RTCIceCandidate(signal.candidate));
                    }
                    break;
                case 'GAME_START':
                    setMpStatus('PLAYING');
                    setIsMultiplayer(true);
                    setShowMultiplayerMenu(false); // Close the lobby menu
                    setIsOpponentFinished(false); // Reset for new game
                    setOpponentFinalScore(null);
                    startCountdownSequenceRef.current(); // Start the game sequence via ref to avoid stale closure
                    break;
                case 'OPPONENT_UPDATE':
                    setOpponentState(prev => ({ ...prev!, score: data.score, health: data.health, combo: data.combo }));
                    break;
                case 'OPPONENT_FINISHED':
                    setIsOpponentFinished(true);
                    setOpponentFinalScore(data.score);
                    setFeedback({ text: `${opponentState?.name} FINISHED!`, color: 'text-yellow-400', id: Date.now() });
                    
                    // If we are already waiting for opponent, go to finished screen now
                    if (statusRef.current === GameStatus.WAITING_MULTI_RESULT) {
                        setTimeout(() => setStatus(GameStatus.FINISHED), 1000);
                    }
                    break;
                case 'OPPONENT_DISCONNECTED':
                    alert('Opponent disconnected');
                    setIsMultiplayer(false);
                    setShowMultiplayerMenu(false);
                    setMpStatus('LOBBY');
                    break;
            }
        };
        wsRef.current = ws;
    }
  };

  const createRoom = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'CREATE_ROOM', name: user?.name }));
      }
  };

  const joinRoom = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && joinRoomIdInput) {
          wsRef.current.send(JSON.stringify({ type: 'JOIN_ROOM', roomId: joinRoomIdInput, name: user?.name }));
      }
  };

  const startGameMultiplayer = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'START_GAME' }));
      }
  };

  const handleReadyToggle = () => {
      if (!analyzedNotes) {
          setFeedback({ text: "ANALYZING...", color: "text-yellow-400", id: Date.now() });
          return;
      }
      const newReadyState = !isGuestReady;
      setIsGuestReady(newReadyState);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'PLAYER_READY', ready: newReadyState }));
      }
  };

  const handleLobbySongSelect = (song: Song) => {
      handleFileSelect(song.file, song);
      setShowLobbySongSelect(false);
      // Notify guest about new song
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
              type: 'SONG_METADATA',
              metadata: { name: song.name, size: song.file.size, type: song.file.type }
          }));
      }
  };

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

  const togglePause = useCallback(() => {
    if (statusRef.current === GameStatus.PLAYING) {
        setStatus(GameStatus.PAUSED);
        pauseTimeRef.current = performance.now();
        if (mediaRef.current) mediaRef.current.pause();
        if (audioCtxRef.current) audioCtxRef.current.suspend();
        if (bgVideoRef.current) bgVideoRef.current.pause();
    } else if (statusRef.current === GameStatus.PAUSED) {
        setStatus(GameStatus.RESUMING);
        setResumeCountdown(2);

        if (mediaRef.current) {
             const newTime = Math.max(0, mediaRef.current.currentTime - 2);
             mediaRef.current.currentTime = newTime;
        }
    }
  }, []);

  useEffect(() => {
    if (status === GameStatus.RESUMING && resumeCountdown !== null) {
        if (resumeCountdown > 0) {
            const timer = setTimeout(() => {
                setResumeCountdown(resumeCountdown - 1);
            }, 1000);
            return () => clearTimeout(timer);
        } else {
            setResumeCountdown(null);
            
            const now = performance.now();
            let mediaTimeMs = 0;
            if (mediaRef.current) {
                mediaTimeMs = mediaRef.current.currentTime * 1000;
            }
            
            totalPauseDurationRef.current = 0;
            pauseTimeRef.current = 0;
            // SYNC FIX: Re-align startTime based on media currentTime + offsets
            startTimeRef.current = now - mediaTimeMs - (START_OFFSET_MS + PRE_ROLL_MS);
            
            setStatus(GameStatus.PLAYING);
            if (mediaRef.current) mediaRef.current.play().catch(() => {});
            if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {});
            if (audioCtxRef.current) audioCtxRef.current.resume();
        }
    }
  }, [status, resumeCountdown]);

  useEffect(() => {
      const handleVisibilityChange = () => {
          if (document.hidden) {
              if (statusRef.current === GameStatus.PLAYING || statusRef.current === GameStatus.RESUMING) {
                   setStatus(GameStatus.PAUSED);
                   pauseTimeRef.current = performance.now();
                   if (mediaRef.current) mediaRef.current.pause();
                   if (audioCtxRef.current) audioCtxRef.current.suspend();
                   if (bgVideoRef.current) bgVideoRef.current.pause();
              }
              
              if (isPlayingPreview) {
                  stopPreview();
              }

              if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
                  audioCtxRef.current.suspend();
              }
              if (bgMusicRef.current) bgMusicRef.current.pause();
              if (bgVideoRef.current) bgVideoRef.current.pause();
              if (mediaRef.current) mediaRef.current.pause();
          } else {
              if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
                  audioCtxRef.current.resume();
              }
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
    const docEl = document.documentElement;

    if (screen.orientation && (screen.orientation as any).lock) {
        try {
            await (screen.orientation as any).lock('portrait');
        } catch (e) {}
    }

    try {
        if (docEl.requestFullscreen) {
            await docEl.requestFullscreen({ navigationUI: "hide" });
        } else if ((docEl as any).webkitRequestFullscreen) {
            await (docEl as any).webkitRequestFullscreen();
        }
    } catch (err) {}
    
    if ('wakeLock' in navigator) {
        try {
            await (navigator as any).wakeLock.request('screen');
        } catch (err) {}
    }

    initAudio();
    playUiSound('select');
    triggerHaptic('heavy'); 
    setShowMobileStart(false);
  };

  const handlePauseTitleClick = () => {
      const now = Date.now();
      if (now - lastPauseTitleClickRef.current < 500) {
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
          triggerHaptic('medium'); 
          lastPauseTitleClickRef.current = 0; 
      } else {
          lastPauseTitleClickRef.current = now;
      }
  };

  useEffect(() => {
      audioSettingsRef.current = audioSettings;
      if (mediaRef.current) {
          mediaRef.current.volume = audioSettings.masterVolume;
      }
      if (bgMusicRef.current) {
          const effectiveVolume = isBgMusicMuted ? 0 : (audioSettings.masterVolume * audioSettings.musicVolume);
          bgMusicRef.current.volume = effectiveVolume;
      }
  }, [audioSettings, isBgMusicMuted]);

  useEffect(() => {
    if (bgMusicRef.current) {
        if ((status === GameStatus.TITLE || status === GameStatus.MENU) && !isPlayingPreview && !showMobileStart) {
            bgMusicRef.current.play().catch(e => {});
        } else {
            bgMusicRef.current.pause();
            if (status === GameStatus.PLAYING) {
                bgMusicRef.current.currentTime = 0;
            }
        }
    }
  }, [status, isPlayingPreview, showMobileStart]);

  const playPreview = (src: string) => {
    stopPreview(); 

    if (!previewAudioRef.current) {
        previewAudioRef.current = new Audio();
    }

    const audio = previewAudioRef.current;
    audio.src = src;
    
    const musicVol = audioSettings.musicVolume ?? 1.0;
    const targetVolume = audioSettings.masterVolume * musicVol;
    audio.volume = targetVolume;
    
    audio.play()
        .then(() => {
            setIsPlayingPreview(true);
            const LOOP_LIMIT = 15; 
            const FADE_START = 12; 

            audio.loop = true; 

            previewTimeoutRef.current = setInterval(() => {
                if (!audio) return;
                
                const t = audio.currentTime;

                if (t >= LOOP_LIMIT || audio.ended) {
                    audio.currentTime = 0;
                    audio.volume = targetVolume;
                    if (audio.paused) audio.play().catch(()=>{});
                    return;
                }

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

  useEffect(() => {
      if (status === GameStatus.PLAYING) {
          stopPreview();
      }
      return () => stopPreview();
  }, [status, stopPreview]);

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

  useEffect(() => { localStorage.setItem('djbig_level', level.toString()); }, [level]);
  useEffect(() => { localStorage.setItem('djbig_speed', speedMod.toString()); }, [speedMod]);
  useEffect(() => { localStorage.setItem('djbig_keymode', keyMode.toString()); }, [keyMode]);
  
  useEffect(() => { localStorage.setItem('djbig_modifiers', JSON.stringify(modifiers)); }, [modifiers]);

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
          const noise = ctx.createBufferSource();
          noise.buffer = getNoiseBuffer(ctx);
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1000, t);
          filter.frequency.exponentialRampToValueAtTime(100, t + 0.5);
          gain.gain.setValueAtTime(getVol(1.5), t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
          noise.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          noise.start(t);
          noise.stop(t + 0.5);
      } else {
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

  const performAnalysis = async (buffer: AudioBuffer) => {
      setIsAnalyzing(true);
      setTimeout(async () => {
          try {
            // Note: Use combined offset for analysis to match gameplay timeline
            const notes = await analyzeAudioAndGenerateNotes(buffer, level, keyMode, START_OFFSET_MS + PRE_ROLL_MS);
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
    if (id === 'DEMO_TRACK_00') demoTitle = t.PLAY_DEMO_00;
    if (id === 'DEMO_TRACK_02') demoTitle = t.PLAY_DEMO_02;
    if (id === 'DEMO_TRACK_03') demoTitle = t.PLAY_DEMO_03;
    if (id === 'DEMO_TRACK_04') demoTitle = t.PLAY_DEMO_04;

    const absolutePath = filename.startsWith('/') ? filename : `/${filename}`;
    
    try {
        const response = await fetch(absolutePath);
        if (!response.ok) throw new Error("Demo file not found");
        const videoBlob = await response.blob();
        const videoUrl = URL.createObjectURL(videoBlob);
        let thumbUrl = null;
        try {
            const tempFile = new File([videoBlob], "demo_thumb_gen.mp4", { type: "video/mp4" });
            thumbUrl = await generateVideoThumbnail(tempFile);
        } catch (e) {}
        setCurrentSongMetadata({ id, file: new File([], id), name: demoTitle, thumbnailUrl: thumbUrl, type: 'video' });
        setLocalVideoSrc(videoUrl);
        setMediaType('video');
        setSoundProfile('rock');
        playPreview(videoUrl);
        const arrayBuffer = await videoBlob.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        audioBufferRef.current = audioBuffer;
        audioDurationRef.current = audioBuffer.duration;
        const notes = await analyzeAudioAndGenerateNotes(audioBuffer, level, keyMode, START_OFFSET_MS + PRE_ROLL_MS);
        setAnalyzedNotes(notes);
        setIsAnalyzing(false);
    } catch (e) {
        const audioBuf = generateRockDemo(ctx);
        audioBufferRef.current = audioBuf;
        audioDurationRef.current = audioBuf.duration;
        const wavBlob = bufferToWave(audioBuf, audioBuf.length);
        const audioUrl = URL.createObjectURL(wavBlob);
        setCurrentSongMetadata({ id, file: new File([], id), name: demoTitle, thumbnailUrl: null, type: 'audio' });
        setLocalVideoSrc(audioUrl);
        setMediaType('audio'); 
        setSoundProfile('rock');
        playPreview(audioUrl);
        const notes = await analyzeAudioAndGenerateNotes(audioBuf, level, keyMode, START_OFFSET_MS + PRE_ROLL_MS);
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
      
      let newMeta = meta;
      if (!newMeta) {
          const isVideo = file.type.startsWith('video') || !!file.name.match(/\.(mp4|webm|ogg|mov|m4v)$/i);
          newMeta = { id: `temp-${Date.now()}`, file, name: file.name, thumbnailUrl: null, type: isVideo ? 'video' : 'audio' };
      }
      setCurrentSongMetadata(newMeta);

      playPreview(url);
      const hash = file.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const profiles: ('electronic' | 'rock' | 'chiptune')[] = ['electronic', 'rock', 'chiptune'];
      setSoundProfile(profiles[hash % profiles.length]);
      const isVideo = file.type.startsWith('video') || !!file.name.match(/\.(mp4|webm|ogg|mov|m4v)$/i);
      setMediaType(isVideo ? 'video' : 'audio');
      setAnalyzedNotes(null); 
      
      try {
        setIsAnalyzing(true);
        const arrayBuffer = await file.arrayBuffer();
        const ctx = initAudio(); // Ensure context is ready
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        audioBufferRef.current = audioBuffer; 
        audioDurationRef.current = audioBuffer.duration;
        
        // In multiplayer, we don't want to auto-analyze immediately if we are the guest receiving a file
        // But for simplicity, we analyze it so it's ready.
        const notes = await analyzeAudioAndGenerateNotes(audioBuffer, level, keyMode, START_OFFSET_MS + PRE_ROLL_MS);
        setAnalyzedNotes(notes);
        setIsAnalyzing(false);
      } catch (error) {
        console.error("Analysis failed", error);
        setIsAnalyzing(false);
      }
    }
  };

  const handleSingleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const isVideo = file.type.startsWith('video') || !!file.name.match(/\.(mp4|webm|ogg|mov|m4v)$/i);
          let thumb: string | null = null;
          if (isVideo) { try { thumb = await generateVideoThumbnail(file); } catch (err) {} }
          const newSong: SongMetadata = { id: `single-${Date.now()}`, file, name: file.name, thumbnailUrl: thumb, type: isVideo ? 'video' : 'audio' };
          setSongList(prev => [...prev, newSong]); 
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
              if (isVideo) { try { thumb = await generateVideoThumbnail(file); } catch (err) {} }
              const song: SongMetadata = { id: `${Date.now()}-${i}-${file.name}`, file, name: file.name, thumbnailUrl: thumb, type: isVideo ? 'video' : 'audio' };
              loadedSongs.push(song);
              saveSongToDB(song).catch(e => console.error("Save failed", e));
          }
      }
      setSongList(prev => [...prev, ...loadedSongs]);
      setIsLoadingFolder(false);
  };

  const handleDeleteSong = async (e: React.MouseEvent, songId: string) => {
      e.stopPropagation(); 
      if (confirm("Delete this track?")) {
          setSongList(prev => prev.filter(s => s.id !== songId));
          await deleteSongFromDB(songId);
          if (currentSongMetadata?.id === songId) {
               if (localVideoSrc) URL.revokeObjectURL(localVideoSrc);
               setLocalVideoSrc("");
               setCurrentSongMetadata(null);
               setAnalyzedNotes(null);
               stopPreview();
          }
      }
  };

  const handleClearPlaylist = async () => {
      setSongList([]);
      setLocalFileName("");
      setAnalyzedNotes(null);
      setCurrentSongMetadata(null);
      stopPreview();
      if (localVideoSrc) { try { URL.revokeObjectURL(localVideoSrc); } catch(e) {} }
      setLocalVideoSrc("");
      if (mediaRef.current) { try { mediaRef.current.pause(); mediaRef.current.src = ""; } catch(e) {} }
      try { playUiSound('select'); await clearAllSongsFromDB(); } catch (e) {}
  };

  useEffect(() => {
    setAnalyzedNotes(null);
    if (audioBufferRef.current && !isAnalyzing) {
       const timeoutId = setTimeout(() => {
           if (audioBufferRef.current) performAnalysis(audioBufferRef.current);
       }, 100);
       return () => clearTimeout(timeoutId);
    }
  }, [level, keyMode]);

  const playHitSound = (laneIndex: number | 'select' | 'hover') => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const t = ctx.currentTime;
    if (laneIndex === 'hover') { playUiSound('hover'); return; } 
    if (laneIndex === 'select') { playUiSound('select'); return; }
    if (typeof laneIndex === 'number') {
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
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(80, t);
            osc.frequency.exponentialRampToValueAtTime(30, t + 0.15);
            gain.gain.setValueAtTime(getVol(0.12), t); 
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
            osc.connect(gain);
            osc.start(t);
            osc.stop(t + 0.15);
        } else if (type === 'hat') {
            const noise = ctx.createBufferSource();
            noise.buffer = getNoiseBuffer(ctx);
            const filter = ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.setValueAtTime(6000, t); 
            gain.gain.setValueAtTime(getVol(0.045), t); 
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
            noise.connect(filter);
            filter.connect(gain);
            noise.start(t);
            noise.stop(t + 0.05);
        } else {
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
      if (!isAutoPlay) checkUnlocks(score, maxCombo, perfectCount);
      
      if (isMultiplayer) {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'GAME_FINISHED', score: score }));
          }
          // In multiplayer, wait for opponent to finish before showing results
          if (isOpponentFinished) {
              setTimeout(() => setStatus(GameStatus.FINISHED), 3000);
          } else {
              // Stay in WAITING state
              setTimeout(() => setStatus(GameStatus.WAITING_MULTI_RESULT), 3000); 
          }
      } else {
          setTimeout(() => setStatus(GameStatus.FINISHED), 3000);
      }
  }, [score, maxCombo, perfectCount, isAutoPlay, level, speedMod, isMultiplayer, isOpponentFinished]);

  const updateRank = useCallback(() => {
    const totalHits = perfectCount + goodCount + missCount;
    if (totalHits === 0) { setCurrentRank('SSS'); return; }
    const weightedScore = (perfectCount * 100) + (goodCount * 50);
    const maxPotential = totalHits * 100;
    const accuracy = (weightedScore / maxPotential) * 100;
    if (accuracy >= 99) setCurrentRank('SSS');
    else if (accuracy >= 98) setCurrentRank('SS');
    else if (accuracy >= 95) setCurrentRank('S');
    else if (accuracy >= 90) setCurrentRank('A');
    else if (accuracy >= 80) setCurrentRank('B');
    else if (accuracy >= 70) setCurrentRank('C');
    else setCurrentRank('D');
  }, [perfectCount, goodCount, missCount]);

  useEffect(() => { updateRank(); }, [perfectCount, goodCount, missCount, updateRank]);

  const triggerLane = useCallback((laneIndex: number) => {
    if (status !== GameStatus.PLAYING || isAutoPlay) return; 
    if (activeKeysRef.current[laneIndex]) return;
    activeKeysRef.current[laneIndex] = true;
    setActiveLanesState(prev => {
        const next = [...prev];
        next[laneIndex] = true;
        return next;
    });
    playHitSound(laneIndex);
    triggerHaptic('light'); 
    
    // SYNC FIX: Consistent adjustedTime calculation
    let elapsed = 0;
    const now = performance.now();
    const timeSinceStart = now - startTimeRef.current - totalPauseDurationRef.current;
    
    if (timeSinceStart < START_OFFSET_MS) {
        elapsed = timeSinceStart + PRE_ROLL_MS; // Consistent with update loop
    } else {
        if (mediaRef.current && !mediaRef.current.paused) {
            elapsed = (mediaRef.current.currentTime * 1000) + START_OFFSET_MS + PRE_ROLL_MS;
        } else {
            elapsed = timeSinceStart + PRE_ROLL_MS;
        }
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
            if (targetNote.isHold) targetNote.holding = true;
            setHitEffects(prev => [...prev, { id: Date.now() + Math.random(), laneIndex, rating: hitType!, timestamp: performance.now() }]);
            const multiplier = isOverdrive ? 2 : 1;
            if (hitType === ScoreRating.PERFECT) {
                setScore(s => s + (100 * multiplier) + (combo > 10 ? 10 : 0));
                setPerfectCount(c => c + 1);
                setHealth(h => Math.min(100, h + 0.5));
                setFeedback({ text: isOverdrive ? "PERFECT x2" : "PERFECT", color: isOverdrive ? "text-amber-300" : "text-amber-100", id: Date.now() });
                if (!isOverdrive) setOverdrive(o => Math.min(100, o + 2.5));
            } else if (hitType === ScoreRating.GOOD) {
                setScore(s => s + (50 * multiplier));
                setGoodCount(c => c + 1);
                setHealth(h => Math.min(100, h + 0.1));
                setFeedback({ text: isOverdrive ? "GOOD x2" : "GOOD", color: "text-green-400", id: Date.now() });
                if (!isOverdrive) setOverdrive(o => Math.min(100, o + 1.0));
            } else {
                setScore(s => s + (10 * multiplier));
                setFeedback({ text: "BAD", color: "text-yellow-400", id: Date.now() });
                if (!isOverdrive) setOverdrive(o => Math.max(0, o - 5));
            }
            setCombo(c => {
                const newC = c + 1;
                setMaxCombo(prev => Math.max(prev, newC));
                return newC;
            });
        }
    } else {
        if (!isOverdrive) setOverdrive(o => Math.max(0, o - 2));
    }
  }, [status, isAutoPlay, combo, maxCombo, soundProfile, speedMod, triggerHaptic, isOverdrive]);

  const releaseLane = useCallback((laneIndex: number) => {
    activeKeysRef.current[laneIndex] = false;
    setActiveLanesState(prev => {
        const next = [...prev];
        next[laneIndex] = false;
        return next;
    });
    if (statusRef.current === GameStatus.PLAYING && !isAutoPlay) {
         const holdingNote = notesRef.current.find(n => n.laneIndex === laneIndex && n.holding && !n.holdCompleted);
         if (holdingNote) {
             holdingNote.holding = false;
             let elapsed = 0;
             const now = performance.now();
             const timeSinceStart = now - startTimeRef.current - totalPauseDurationRef.current;
             if (timeSinceStart < START_OFFSET_MS) {
                 elapsed = timeSinceStart + PRE_ROLL_MS;
             } else {
                 if (mediaRef.current && !mediaRef.current.paused) {
                     elapsed = (mediaRef.current.currentTime * 1000) + START_OFFSET_MS + PRE_ROLL_MS;
                 } else {
                     elapsed = timeSinceStart + PRE_ROLL_MS;
                 }
             }
             const adjustedTime = elapsed - audioSettingsRef.current.audioOffset;
             const endTime = holdingNote.timestamp + holdingNote.duration;
             if (adjustedTime < endTime - 200) {
                 holdingNote.missed = true;
                 holdingNote.holdCompleted = true; 
                 setCombo(0);
                 setMissCount(c => c + 1);
                 setHealth(h => Math.max(0, h - 5));
                 setFeedback({ text: "MISS", color: "text-red-500", id: Date.now() });
             }
         }
    }
  }, [status, isAutoPlay, audioSettings]);

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
            if (laneIndex >= 0 && laneIndex < keyMode) currentTouchLanes.add(laneIndex);
        }
    }
    currentTouchLanes.forEach(laneIdx => { if (!touchedLanesRef.current.has(laneIdx)) triggerLane(laneIdx); });
    touchedLanesRef.current.forEach(laneIdx => { if (!currentTouchLanes.has(laneIdx)) releaseLane(laneIdx); });
    touchedLanesRef.current = currentTouchLanes;
  }, [triggerLane, releaseLane, keyMode]);

  const update = useCallback(() => {
    if (statusRef.current !== GameStatus.PLAYING) return;

    if (bgRef.current) {
         const time = Date.now() / 1000;
         const scale = 1 + Math.sin(time * 2) * 0.01;
         bgRef.current.style.transform = `scale(${scale})`;
    }

    if (overdrive >= 100 && !isOverdrive) {
        setIsOverdrive(true);
        if (!isLowQuality) playUiSound('scratch'); 
        triggerHaptic('heavy');
        setFeedback({ text: t.LIMIT_BREAK, color: "text-amber-400", id: Date.now() });
    }

    if (isOverdrive) {
        setOverdrive(prev => {
            const next = prev - 0.15;
            if (next <= 0) { setIsOverdrive(false); return 0; }
            return next;
        });
    }

    let elapsed = 0;
    const now = performance.now();
    const timeSinceStart = now - startTimeRef.current - totalPauseDurationRef.current;

    // SYNC FIX: Master clock synchronization logic
    if (timeSinceStart < START_OFFSET_MS) {
        // Still in the initial countdown phase - shift clock forward by PRE_ROLL to see notes
        elapsed = timeSinceStart + PRE_ROLL_MS;
        if (mediaRef.current && !mediaRef.current.paused) mediaRef.current.pause(); 
    } else {
        // Main playing phase
        if (mediaRef.current) {
             if (mediaRef.current.paused && !mediaRef.current.ended) mediaRef.current.play().catch(() => {});
             elapsed = (mediaRef.current.currentTime * 1000) + START_OFFSET_MS + PRE_ROLL_MS;
        } else {
            elapsed = timeSinceStart + PRE_ROLL_MS;
        }
    }
    
    const adjustedTime = elapsed - audioSettingsRef.current.audioOffset;
    if (progressBarRef.current && audioDurationRef.current > 0) {
        const durationMs = audioDurationRef.current * 1000;
        const progress = Math.min(100, ((elapsed - (START_OFFSET_MS + PRE_ROLL_MS)) / durationMs) * 100);
        progressBarRef.current.style.width = `${Math.max(0, progress)}%`;
    }

    if (audioDurationRef.current > 0 && elapsed > (audioDurationRef.current * 1000) + START_OFFSET_MS + PRE_ROLL_MS + 1000) {
        triggerOutro(); return;
    }
    
    const currentFallSpeed = BASE_FALL_SPEED_MS / speedMod;
    const hitLineY = 90;
    const visibleWindow = currentFallSpeed * 2.5; 

    const visibleNotesList: NoteType[] = [];
    const currentVisibleIds = new Set<number>();
    const currentHoldingIds = new Set<number>();
    let shouldUpdateRender = false;

    notesRef.current.forEach(note => {
      const timeDelta = adjustedTime - note.timestamp; 
      
      if (timeDelta < -visibleWindow || timeDelta > 600) {
          if (!note.hit && !note.missed && timeDelta > 250) {
              note.missed = true;
              setMissCount(c => c + 1);
              setCombo(0);
              setHealth(h => Math.max(0, h - 4));
              setFeedback({ text: "MISS", color: "text-red-500", id: Date.now() });
              triggerHaptic('heavy'); 
              if (isOverdrive) setIsOverdrive(false);
              setOverdrive(o => Math.max(0, o - 20));
          }
          return;
      }

      note.y = hitLineY + ((timeDelta / currentFallSpeed) * hitLineY);

      // Direct DOM Update
      const el = noteRefs.current.get(note.id);
      if (el) {
          if (note.isHold) {
              const holdLength = (note.duration / currentFallSpeed) * 90;
              el.style.top = `${note.y - holdLength}%`;
              el.style.height = `${holdLength}%`;
          } else {
              el.style.top = `${note.y}%`;
          }
          
          // Update Opacity for Hidden/Sudden
          if (modifiers.hidden) {
              if (note.y > 50) el.style.opacity = '0';
              else el.style.opacity = String(Math.max(0, 1 - ((note.y - 40) / 10)));
          } else if (modifiers.sudden) {
              if (note.y < 25) el.style.opacity = '0';
              else el.style.opacity = String(Math.min(1, (note.y - 25) / 10));
          } else {
              el.style.opacity = '1';
          }
      }

      if (note.isHold && note.holding && !note.holdCompleted) {
          const endTime = note.timestamp + note.duration;
          setScore(s => s + (HOLD_TICK_SCORE * (isOverdrive ? 2 : 1)));
          if (adjustedTime >= endTime) {
              note.holdCompleted = true;
              note.holding = false;
              setScore(s => s + (200 * (isOverdrive ? 2 : 1)));
              setCombo(c => {
                 const newC = c + 1;
                 setMaxCombo(prev => Math.max(prev, newC));
                 return newC;
              });
              setFeedback({ text: "PERFECT", color: "text-cyan-300", id: Date.now() });
              setHitEffects(prev => [...prev, { id: Date.now() + Math.random(), laneIndex: note.laneIndex, rating: ScoreRating.PERFECT, timestamp: performance.now() }]);
          }
      }

      if (isAutoPlay && !note.hit && !note.missed && timeDelta >= 0) {
            note.hit = true;
            if (note.isHold) note.holding = true;
            setActiveLanesState(prev => { const n = [...prev]; n[note.laneIndex] = true; return n; });
            if (!note.isHold) setTimeout(() => { setActiveLanesState(prev => { const n = [...prev]; n[note.laneIndex] = false; return n; }); }, 50);
            playHitSound(note.laneIndex);
            if (!note.isHold) setHitEffects(prev => [...prev, { id: Date.now() + Math.random(), laneIndex: note.laneIndex, rating: ScoreRating.PERFECT, timestamp: performance.now() }]);
            setFeedback({ text: t.AUTO_PILOT, color: "text-fuchsia-500", id: Date.now() });
            setCombo(c => {
                const newC = c + 1;
                setMaxCombo(prev => Math.max(prev, newC));
                return newC;
            });
            if (!isOverdrive) setOverdrive(o => Math.min(100, o + 0.5));
      }
      
      if (isAutoPlay && note.isHold && note.holding && !note.holdCompleted && adjustedTime >= note.timestamp + note.duration) {
          note.holdCompleted = true;
          note.holding = false;
          setActiveLanesState(prev => { const n = [...prev]; n[note.laneIndex] = false; return n; });
          setHitEffects(prev => [...prev, { id: Date.now() + Math.random(), laneIndex: note.laneIndex, rating: ScoreRating.PERFECT, timestamp: performance.now() }]);
      }

      if (!note.hit && !note.missed && timeDelta > 250) {
        note.missed = true;
        setMissCount(c => c + 1);
        setCombo(0);
        setHealth(h => Math.max(0, h - 4));
        setFeedback({ text: "MISS", color: "text-red-500", id: Date.now() });
        triggerHaptic('heavy'); 
        if (isOverdrive) setIsOverdrive(false);
        setOverdrive(o => Math.max(0, o - 20));
      }

      // ปรับเงื่อนไขการแสดงผลเพื่อให้เห็นโน้ตที่หล่นมาจากด้านบนได้ไกลขึ้น
      if (note.y > -250 && note.y < 120 && !note.hit) {
          if (note.isHold && !note.holdCompleted && !note.missed) {
              const lengthPerc = (note.duration / currentFallSpeed) * 90;
              (note as any).length = lengthPerc;
              visibleNotesList.push(note);
              currentVisibleIds.add(note.id);
              if (note.holding) currentHoldingIds.add(note.id);
          } else if (!note.isHold) {
              visibleNotesList.push(note);
              currentVisibleIds.add(note.id);
          }
      } else if (note.isHold && note.holding && !note.holdCompleted) {
          const lengthPerc = (note.duration / currentFallSpeed) * 90;
          (note as any).length = lengthPerc;
          visibleNotesList.push(note);
          currentVisibleIds.add(note.id);
          currentHoldingIds.add(note.id);
      }
    });

    // Check for changes in visibility or holding state to trigger React render
    if (currentVisibleIds.size !== visibleNoteIdsRef.current.size || 
        currentHoldingIds.size !== holdingNoteIdsRef.current.size) {
        shouldUpdateRender = true;
    } else {
        for (const id of currentVisibleIds) {
            if (!visibleNoteIdsRef.current.has(id)) { shouldUpdateRender = true; break; }
        }
        if (!shouldUpdateRender) {
            for (const id of currentHoldingIds) {
                if (!holdingNoteIdsRef.current.has(id)) { shouldUpdateRender = true; break; }
            }
        }
    }

    if (shouldUpdateRender) {
        visibleNoteIdsRef.current = currentVisibleIds;
        holdingNoteIdsRef.current = currentHoldingIds;
        setRenderNotes(visibleNotesList); 
    }

    if (health <= 0) { triggerOutro(); return; }
    
    if (isMultiplayer && wsRef.current && wsRef.current.readyState === WebSocket.OPEN && frameRef.current % 10 === 0) {
        wsRef.current.send(JSON.stringify({
            type: 'UPDATE_SCORE',
            score,
            health,
            combo
        }));
    }

    if (hitEffects.length > 0) {
        setHitEffects(prev => {
            const nowTime = Date.now();
            const next = prev.filter(e => nowTime - e.id < 500);
            return next.length === prev.length ? prev : next;
        });
    }
    frameRef.current = requestAnimationFrame(update);
  }, [health, speedMod, isAutoPlay, combo, maxCombo, triggerOutro, soundProfile, t, triggerHaptic, isOverdrive, overdrive, hitEffects.length, isLowQuality, modifiers]);

  useEffect(() => {
    if (status === GameStatus.PLAYING) {
      frameRef.current = requestAnimationFrame(update);
      if (bgVideoRef.current && !isLowQuality) bgVideoRef.current.play().catch(() => {});
    }
    return () => cancelAnimationFrame(frameRef.current);
  }, [status, update, isLowQuality]);

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
    setShowMobileSetup(false);
    if (!localVideoSrc) { alert("Please select a track first."); return; }
    if (!analyzedNotes) { alert("Please wait for analysis to complete."); return; }
    
    if (analyzedNotes) {
        notesRef.current = analyzedNotes.map(n => ({
            id: Number(n.id), laneIndex: Number(n.laneIndex), timestamp: Number(n.timestamp), y: -150, hit: false, missed: false,
            duration: Number(n.duration) || 0, isHold: Boolean(n.isHold), holding: false, holdCompleted: false
        }));
    }
    activeKeysRef.current = new Array(keyMode).fill(false);
    setActiveLanesState(new Array(keyMode).fill(false));
    setScore(0); setCombo(0); setMaxCombo(0); setHealth(100);
    setOverdrive(0); setIsOverdrive(false);
    setMissCount(0); setPerfectCount(0); setGoodCount(0);
    setHitEffects([]); setIsAutoPlay(false);
    setFeedback(null); 
    totalPauseDurationRef.current = 0;
    setCurrentRank('SSS');
    
    if (mediaRef.current) { mediaRef.current.pause(); mediaRef.current.currentTime = 0; }
    
    // เริ่มโหมดเล่นทันทีเพื่อให้ Update Loop ทำงานและแสดงโน้ตหล่นในช่วงนับถอยหลัง
    setStatus(GameStatus.PLAYING);
    startTimeRef.current = performance.now();
    
    setStartCountdown(3);
    let count = 3;
    const timer = setInterval(() => {
        count--;
        if (count > 0) setStartCountdown(count);
        else { clearInterval(timer); setStartCountdown(null); }
    }, 1000);
  }

  const startGame = (useBufferPlayback: boolean, notesOverride?: NoteType[]) => {
    let notesToUse = notesOverride || analyzedNotes;
    if (notesToUse && modifiers.mirror) notesToUse = notesToUse.map(n => ({ ...n, laneIndex: (keyMode - 1) - Number(n.laneIndex) }));
    if (notesToUse) {
        notesRef.current = notesToUse.map(n => ({
            id: Number(n.id), laneIndex: Number(n.laneIndex), timestamp: Number(n.timestamp), y: -150, hit: Boolean(n.hit), missed: Boolean(n.missed),
            duration: Number(n.duration) || 0, isHold: Boolean(n.isHold), holding: false, holdCompleted: false
        }));
    } else notesRef.current = [];
    activeKeysRef.current = new Array(keyMode).fill(false);
    setActiveLanesState(new Array(keyMode).fill(false));
    setScore(0); setCombo(0); setMaxCombo(0); setHealth(100);
    setOverdrive(0); setIsOverdrive(false);
    setMissCount(0); setPerfectCount(0); setGoodCount(0);
    setHitEffects([]); setIsAutoPlay(false);
    setFeedback(null); 
    totalPauseDurationRef.current = 0;
    setCurrentRank('SSS');
    setStatus(GameStatus.PLAYING);
    startTimeRef.current = performance.now();
    if (mediaRef.current) { mediaRef.current.pause(); mediaRef.current.currentTime = 0; }
  };

  const quitGame = () => {
    playUiSound('select');
    setHitEffects([]);
    stopPreview();
    if (mediaRef.current) { mediaRef.current.pause(); mediaRef.current.src = ""; }
    if (bgVideoRef.current) bgVideoRef.current.pause();

    if (isMultiplayer) {
        setMpStatus('READY');
        setShowMultiplayerMenu(true);
        setStatus(GameStatus.TITLE);
        setIsOpponentFinished(false);
        setOpponentFinalScore(null);
    } else {
        setStatus(GameStatus.TITLE);
    }
  };
  
  const DIFFICULTY_OPTIONS = [ { label: t.EASY, value: 7, color: 'bg-green-500 shadow-green-500/50' }, { label: t.NORMAL, value: 8, color: 'bg-yellow-500 shadow-yellow-500/50' }, { label: t.HARD, value: 9, color: 'bg-orange-500 shadow-orange-500/50' }, { label: t.EXPERT, value: 10, color: 'bg-red-500 shadow-red-500/50' } ];
  
  const SettingsPanelContent = () => (
      <div className="flex flex-col space-y-4">
         <div className="bg-slate-900/80 border border-slate-700 p-4 rounded-lg backdrop-blur-md shadow-lg flex flex-col space-y-2">
             <div><div className={`text-[10px] font-bold text-slate-500 mb-2 tracking-widest ${fontClass}`}>{t.LEVEL}</div><div className="flex gap-2 h-10">{DIFFICULTY_OPTIONS.map((diff) => { const active = level === diff.value; return ( <button key={diff.value} onClick={() => { setLevel(diff.value); playUiSound('select'); }} className={`flex-1 flex flex-col justify-end p-1 rounded transition-all relative overflow-hidden group border ${active ? 'border-white/50' : 'border-transparent'}`}><div className={`absolute inset-0 opacity-20 ${diff.color}`}></div><div className={`w-full transition-all duration-300 ${active ? 'h-full opacity-100' : 'h-1/3 opacity-40 group-hover:h-1/2'} ${diff.color}`}></div><span className={`relative z-10 text-[9px] font-bold text-center mt-1 truncate ${active ? 'text-white' : 'text-slate-500'} ${fontClass}`}>{diff.label}</span></button> ) })}</div></div>
             <div><div className={`text-[10px] font-bold text-slate-500 mb-2 tracking-widest ${fontClass}`}>{t.KEY_MODE_LABEL || "KEY CONFIGURATION"}</div><div className="flex gap-2 h-10">{[4, 5, 7].map((k) => { const active = keyMode === k; return ( <button key={k} onClick={()=>{setKeyMode(k as any);playUiSound('select')}} className={`flex-1 relative overflow-hidden rounded border transition-all duration-200 flex items-center justify-center ${active ? 'bg-cyan-900/50 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.3)]' : 'bg-slate-800 border-slate-700 hover:border-cyan-600'}`}><div className={`text-xl font-black italic ${active ? 'text-white' : 'text-slate-500 group-hover:text-cyan-200'}`}>{k}Key</div><div className={`text-[9px] ml-1 font-bold ${active ? 'text-cyan-400' : 'text-slate-600'}`}>MODE</div></button> ); })}</div></div>
             <div><div className={`text-[10px] font-bold text-slate-500 mb-1 ${fontClass}`}>{t.SCROLL_SPEED}</div><div className="flex items-center bg-black rounded border border-slate-700 p-1"><button onClick={()=>{setSpeedMod(Math.max(1,speedMod-0.5));playUiSound('select')}} className="w-10 h-8 bg-slate-800 text-slate-400 hover:text-white font-bold rounded">-</button><div className="flex-1 text-center font-mono text-cyan-400 font-bold text-lg">{speedMod.toFixed(1)}</div><button onClick={()=>{setSpeedMod(Math.min(10,speedMod+0.5));playUiSound('select')}} className="w-10 h-8 bg-slate-800 text-slate-400 hover:text-white font-bold rounded">+</button></div></div>
             <div><div className={`text-[10px] font-bold text-slate-500 mb-1 tracking-widest ${fontClass}`}>{t.MODIFIERS}</div><div className="flex gap-2 h-8">
                    <button onClick={() => { setModifiers(m => ({...m, mirror: !m.mirror})); playUiSound('select'); }} className={`flex-1 rounded border text-[9px] font-bold transition-all ${modifiers.mirror ? 'bg-cyan-600 border-cyan-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-500 hover:border-slate-400'} ${fontClass}`}>{t.MOD_MIRROR}</button>
                    <button onClick={() => { setModifiers(m => ({...m, sudden: !m.sudden, hidden: false})); playUiSound('select'); }} className={`flex-1 rounded border text-[9px] font-bold transition-all ${modifiers.sudden ? 'bg-fuchsia-600 border-fuchsia-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-500 hover:border-slate-400'} ${fontClass}`}>{t.MOD_SUDDEN}</button>
                    <button onClick={() => { setModifiers(m => ({...m, hidden: !m.hidden, sudden: false})); playUiSound('select'); }} className={`flex-1 rounded border text-[9px] font-bold transition-all ${modifiers.hidden ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-500 hover:border-slate-400'} ${fontClass}`}>{t.MOD_HIDDEN}</button>
                </div></div>
         </div>
         <button ref={mobileSetupStartBtnRef} onClick={startCountdownSequence} disabled={isAnalyzing || !analyzedNotes} onMouseEnter={() => playUiSound('hover')} className={`group relative w-full h-14 flex flex-col items-center justify-center transform transition-all duration-200 active:scale-95 ${(isAnalyzing || !analyzedNotes) ? 'opacity-50 grayscale cursor-not-allowed' : 'cursor-pointer'}`}><div className="absolute inset-0 bg-gradient-to-r from-cyan-600 to-blue-600 transform -skew-x-2 border-2 border-white/20 shadow-[0_0_30px_rgba(6,182,212,0.5)] group-hover:shadow-[0_0_60px_rgba(6,182,212,0.8)] transition-shadow rounded"></div><div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-30 mix-blend-overlay"></div><div className="relative z-10 text-center transform -skew-x-2">{isAnalyzing ? ( <div className="flex items-center gap-4"><div className="text-xl font-black text-white animate-pulse">SYSTEM ANALYZING</div><div className="w-24 h-2 bg-black/50 rounded-full overflow-hidden"><div className="h-full bg-white animate-progress"></div></div></div> ) : ( <><div className={`text-2xl font-black italic text-white tracking-tighter drop-shadow-lg ${fontClass}`}>{t.GAME_START}</div></> )}</div></button>
      </div>
  );

  const renderLanes = () => (
    <div ref={laneContainerRef} className="relative flex-1 bg-black/10 backdrop-blur-sm flex perspective-1000 outline-none overflow-hidden h-full" onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch} onTouchCancel={handleTouch}>
        <div className="absolute top-0 left-0 w-full h-1 bg-slate-800 z-40"><div ref={progressBarRef} className="h-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]" style={{ width: '0%' }}></div></div>
        {activeLaneConfig.map((lane, index) => (
            <Lane key={index} config={lane} active={activeLanesState[index]} onTrigger={() => triggerLane(index)} onRelease={() => releaseLane(index)} theme={activeThemeObj} isOverdrive={isOverdrive} graphicsQuality={layoutSettings.graphicsQuality} />
        ))}
        <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none z-10"></div>
        {currentThemeId !== 'ignore' && (
            <button onClick={(e) => { e.stopPropagation(); togglePause(); playUiSound('select'); }} className="absolute bottom-0 right-0 z-50 w-10 h-10 flex items-center justify-center bg-slate-900/80 border-t border-l border-slate-600 rounded-tl-lg hover:bg-red-900/50 hover:border-red-400 transition-all active:scale-95 group">
                <div className="flex flex-col space-y-1"><div className="w-5 h-0.5 bg-slate-400 group-hover:bg-red-400"></div><div className="w-5 h-0.5 bg-slate-400 group-hover:bg-red-400"></div><div className="w-5 h-0.5 bg-slate-400 group-hover:bg-red-400"></div></div>
            </button>
        )}
        {currentThemeId === 'ignore' ? ( <div className="absolute bottom-24 left-0 w-full h-1 bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.9)] z-20 opacity-80 pointer-events-none"></div> ) : currentThemeId === 'titan' ? ( <div className="absolute bottom-20 left-0 w-full h-[2px] bg-amber-500/80 shadow-[0_0_10px_rgba(245,158,11,0.5)] z-20 pointer-events-none"></div> ) : currentThemeId === 'queen' ? ( <div className="absolute bottom-16 left-0 w-full h-[2px] bg-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.8)] z-20 pointer-events-none"></div> ) : ( <div className="absolute bottom-20 left-0 w-full h-px bg-white/20 pointer-events-none z-20"></div> )}
        {hitEffects.map(effect => { const width = 100 / keyMode; const left = effect.laneIndex * width; return ( <HitEffect key={effect.id} x={`${left}%`} width={`${width}%`} rating={effect.rating} graphicsQuality={layoutSettings.graphicsQuality} /> ); })}
        {renderNotes.map((note) => { 
            const config = activeLaneConfig[note.laneIndex]; 
            if (!config) return null; 
            return ( 
                <Note 
                    key={note.id} 
                    ref={(el) => { 
                        if (el) noteRefs.current.set(note.id, el); 
                        else noteRefs.current.delete(note.id); 
                    }}
                    note={note} 
                    totalLanes={keyMode} 
                    color={config.color} 
                    theme={activeThemeObj} 
                    isOverdrive={isOverdrive} 
                    modifiers={modifiers} 
                    graphicsQuality={layoutSettings.graphicsQuality} 
                    isHolding={note.holding}
                /> 
            ); 
        })}
        <div className="absolute top-[25%] left-0 right-0 flex flex-col items-center pointer-events-none z-50">
            <div className="flex flex-col items-center mb-1">
                {isAutoPlay && ( <div className={`text-lg ${fontClass} font-bold text-fuchsia-500 animate-pulse mb-1 border border-fuchsia-500 px-2 bg-black/50 whitespace-nowrap`}>{t.AUTO_PILOT}</div> )}
                {isOverdrive && !isLowQuality && ( <div className="flex flex-col items-center"><div className={`text-xl md:text-2xl ${fontClass} font-black italic text-amber-500 drop-shadow-[0_0_8px_rgba(0,0,0,1)] whitespace-nowrap animate-rainbow-text`}>{t.LIMIT_BREAK}</div><div className={`text-2xl md:text-4xl ${fontClass} font-black italic text-amber-400 tracking-widest whitespace-nowrap`} style={{textShadow: '0 0 10px #fbbf24'}}>{t.X2_BONUS}</div></div> )}
                {isOverdrive && isLowQuality && ( <div className={`text-xl md:text-2xl ${fontClass} font-black italic text-amber-500 drop-shadow-[0_0_8px_rgba(0,0,0,1)] whitespace-nowrap`}>{t.LIMIT_BREAK} (X2)</div> )}
            </div>
            <div className="flex flex-col items-center"><div className={`text-xl font-black text-slate-500/50 tracking-[0.3em] mb-[-10px] ${fontClass}`}>{t.COMBO}</div><div key={combo} className={`text-8xl font-display font-black italic tracking-tighter transition-all duration-100 pr-4 ${!isLowQuality && combo > 0 ? 'animate-cyber-slam' : 'opacity-20'} ${combo >= 200 ? 'combo-tier-3' : combo >= 100 ? 'combo-tier-2' : combo >= 50 ? 'combo-tier-1' : 'combo-tier-0'}`}>{combo}</div></div>
            {feedback && ( <div key={feedback.id} className={`mt-4 text-4xl font-black font-display italic ${feedback.color} animate-bounce-short drop-shadow-[0_0_10px_rgba(0,0,0,1)] stroke-black whitespace-nowrap`}>{feedback.text}</div> )}
            {currentThemeId === 'ignore' && ( <div className="mt-4 w-48 h-6 bg-slate-900/80 border border-slate-500 rounded-full relative overflow-hidden backdrop-blur-sm"><div className={`absolute inset-0 transition-all duration-100 ${isOverdrive && !isLowQuality ? 'animate-rainbow' : isOverdrive ? 'bg-amber-500' : 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]'}`} style={{ width: `${overdrive}%` }}></div><div className="absolute inset-0 flex items-center justify-center z-10 mix-blend-difference"><span className={`text-[9px] md:text-[10px] font-black italic tracking-[0.2em] ${fontClass} text-white`}>OVERDRIVE</span></div></div> )}
        </div>
    </div>
  );

  const renderGameFrame = () => {
    const frameClass = isOverdrive && !isLowQuality ? 'border-amber-400 overdrive-border' : (isOverdrive ? 'border-amber-500' : '');
    
    // Logic: 
    // - On Mobile: Portrait is full-width (w-full), Landscape is fixed 400px (landscape:max-w-[400px])
    // - On Desktop: Max-width is fixed at 400px
    const frameWidthClass = isMobile 
        ? "w-full landscape:max-w-[400px]" 
        : "w-full max-w-[400px]";
    
    const borderResponsiveClass = isMobile 
        ? "border-x-0 landscape:border-x-[4px]" 
        : "border-x-[4px]";

    if (currentThemeId === 'ignore') {
        return (
            <div className={`relative h-full ${frameWidthClass} flex-shrink-0 z-20 overflow-hidden ${borderResponsiveClass} border-slate-300 bg-slate-900/40 backdrop-blur-md shadow-[0_0_60px_rgba(0,0,0,0.9)] flex flex-col transition-all duration-300 ${frameClass}`}>
                <div className="relative flex-1 flex w-full">
                    {renderLanes()}
                    <div className="w-6 bg-slate-900/80 border-l border-slate-700 relative flex flex-col justify-end p-0.5">
                        <div className={`absolute top-2 left-0 w-full text-[9px] text-center font-bold text-slate-500 vertical-text ${fontClass}`}>{t.GROOVE}</div>
                        <div className="w-full bg-slate-800 rounded-sm overflow-hidden h-[80%] relative border border-slate-700"><div className={`absolute bottom-0 left-0 w-full transition-all duration-200 ${isOverdrive && !isLowQuality ? 'animate-rainbow' : isOverdrive ? 'bg-amber-500' : 'bg-gradient-to-t from-red-500 via-yellow-400 to-green-500'}`} style={{ height: `${health}%` }}></div></div>
                        <div className={`mt-1 w-full h-1 ${health > 90 ? 'bg-cyan-400 animate-pulse' : 'bg-slate-700'}`}></div>
                    </div>
                </div>
                <div className="h-16 bg-gradient-to-b from-slate-200 to-slate-400 relative flex items-center justify-between px-4 border-t-4 border-slate-400 shadow-inner pb-[env(safe-area-inset-bottom)]">
                        <div className="flex flex-col items-center bg-slate-800/80 p-1 rounded border border-slate-600 shadow-inner scale-75 origin-left"><div className={`text-[7px] text-slate-400 font-bold ${fontClass}`}>{t.SCROLL_SPEED}</div><div className="text-xs font-display text-white">{speedMod.toFixed(2)}</div></div>
                        <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center bg-black px-6 py-1 rounded-xl border-2 border-slate-500 shadow-[inset_0_0_10px_rgba(0,0,0,0.8)] z-10"><div className={`text-[7px] text-red-900 font-bold tracking-widest w-full text-center ${fontClass}`}>{t.SCORE}</div><div className="font-mono text-2xl text-red-600 font-bold tracking-widest drop-shadow-[0_0_5px_rgba(220,38,38,0.8)]">{score.toString().padStart(7, '0')}</div></div>
                        <div className="scale-90 origin-right"><button onClick={(e) => { e.stopPropagation(); togglePause(); playUiSound('select'); }} className="w-10 h-10 flex items-center justify-center bg-slate-300 border border-slate-400 rounded shadow-[0_2px_0_rgba(0,0,0,0.2)] hover:bg-white active:scale-95 transition-all group"><div className="flex flex-col space-y-1"><div className="w-5 h-0.5 bg-slate-500 group-hover:bg-slate-800"></div><div className="w-5 h-0.5 bg-slate-500 group-hover:bg-slate-800"></div><div className="w-5 h-0.5 bg-slate-500 group-hover:bg-slate-800"></div></div></button></div>
                </div>
            </div>
        );
    } else if (currentThemeId === 'titan') {
        return (
             <div className={`relative h-full ${frameWidthClass} flex-shrink-0 z-20 overflow-hidden bg-slate-900/40 backdrop-blur-md shadow-[0_0_60px_rgba(245,158,11,0.1)] flex flex-col ${borderResponsiveClass} border-slate-800/50 transition-all ${frameClass}`}>
                <div className="w-full h-16 bg-slate-800/80 border-b-2 border-amber-600/50 flex items-center justify-between px-4 relative pt-[env(safe-area-inset-top)]"><div className="absolute bottom-0 left-0 w-full h-1 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,#f59e0b_10px,#f59e0b_20px)] opacity-50"></div><div className="flex flex-col"><div className={`text-[9px] text-amber-500 font-bold tracking-widest ${fontClass}`}>{t.SYSTEM_INTEGRITY}</div><div className="w-32 h-3 bg-slate-950 border border-slate-600 mt-1 flex"><div className={`h-full transition-all duration-200 ${isOverdrive && !isLowQuality ? 'animate-rainbow' : (isOverdrive ? 'bg-amber-500' : (health < 30 ? 'bg-red-500' : 'bg-amber-500'))}`} style={{width: `${health}%`}}></div><div className={`h-full transition-all duration-200 ${isOverdrive && !isLowQuality ? 'animate-rainbow' : (isOverdrive ? 'bg-amber-500' : 'bg-transparent')}`} style={{width: `${overdrive}%`, opacity: 0.5}}></div></div></div><div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2"><div className={`text-2xl font-black italic opacity-50 ${currentRank === 'SSS' ? 'text-amber-100' : 'text-slate-600'}`}>{currentRank}</div></div><div className="text-right"><div className={`text-[9px] text-amber-500 font-bold tracking-widest ${fontClass}`}>{t.SCORE_OUTPUT}</div><div className="text-xl font-mono font-bold text-amber-100">{score.toString().padStart(7, '0')}</div></div></div>
                <div className="flex-1 relative bg-slate-900/10 border-l-0 border-r-0 border-slate-800"><div className="absolute inset-0 opacity-10" style={{backgroundImage: 'radial-gradient(circle, #78716c 1px, transparent 1px)', backgroundSize: '20px 20px'}}></div>{renderLanes()}</div>
                <div className="h-4 bg-slate-800/80 border-t-2 border-amber-600/30 flex justify-center pb-[env(safe-area-inset-bottom)]"><div className="w-1/3 h-full bg-slate-700/80 rounded-b-lg"></div></div>
            </div>
        );
    } else if (currentThemeId === 'queen') {
        return (
            <div className={`relative h-full ${frameWidthClass} flex-shrink-0 z-20 overflow-hidden bg-gradient-to-b from-black/50 via-purple-950/40 to-pink-900/40 backdrop-blur-md shadow-[0_0_60px_rgba(236,72,153,0.3)] flex flex-col ${borderResponsiveClass} border-pink-800/50 transition-all ${frameClass}`}>
                <div className="w-full py-4 px-6 flex justify-between items-center bg-black/40 backdrop-blur-md border-b border-pink-800 pt-[calc(1rem+env(safe-area-inset-top))]"><div className="flex flex-col"><div className={`text-[9px] text-pink-400 font-serif tracking-widest uppercase ${fontClass}`}>{t.GRACE}</div><div className="w-32 h-2 bg-purple-950 border border-purple-700 rounded-full mt-1 overflow-hidden relative"><div className={`h-full transition-all duration-200 ${isOverdrive && !isLowQuality ? 'animate-rainbow' : (isOverdrive ? 'bg-amber-500' : 'bg-gradient-to-r from-purple-600 to-pink-500')}`} style={{width: `${health}%`}}></div><div className={`absolute top-0 left-0 h-full transition-all duration-200 ${isOverdrive && !isLowQuality ? 'animate-rainbow opacity-50' : (isOverdrive ? 'bg-amber-400 opacity-30' : '')}`} style={{width: `${overdrive}%`}}></div></div></div><div className="flex flex-col items-end"><div className={`text-[9px] text-pink-400 font-serif tracking-widest uppercase ${fontClass}`}>{t.POWER}</div><div className="text-2xl font-display font-bold text-pink-100 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)]">{score.toString().padStart(7, '0')}</div></div></div>
                <div className="flex-1 relative flex"><div className="w-2 h-full bg-gradient-to-b from-purple-900/50 via-pink-900/50 to-purple-900/50"></div><div className="flex-1 relative bg-black/10"><div className="absolute inset-0 opacity-10" style={{backgroundImage: 'linear-gradient(135deg, #be185d 25%, transparent 25%), linear-gradient(225deg, #be185d 25%, transparent 25%), linear-gradient(45deg, #be185d 25%, transparent 25%), linear-gradient(315deg, #be185d 25%, transparent 25%)', backgroundPosition: '10px 0, 10px 0, 0 0, 0 0', backgroundSize: '20px 20px', backgroundRepeat: 'repeat'}}></div>{renderLanes()}</div><div className="w-2 h-full bg-gradient-to-b from-purple-900/50 via-pink-900/50 to-purple-900/50"></div></div>
                 <div className="h-2 w-full bg-gradient-to-r from-purple-900 via-pink-600 to-purple-900 mb-[env(safe-area-inset-bottom)]"></div>
            </div>
        );
    } else {
        return (
            <div className={`relative h-full ${frameWidthClass} flex-shrink-0 z-20 overflow-hidden ${borderResponsiveClass} border-slate-800/50 bg-black/30 backdrop-blur-md shadow-[0_0_60px_rgba(6,182,212,0.2)] flex flex-col transition-all ${frameClass}`}>
                <div className="w-full flex justify-between items-start p-4 bg-gradient-to-b from-slate-900/80 to-transparent z-30 pointer-events-none border-b border-white/10 pt-[calc(1rem+env(safe-area-inset-top))]">
                    <div className="w-1/3"><div className={`text-[10px] text-cyan-400 font-bold ${fontClass}`}>{t.INTEGRITY}</div><div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-600 mb-1"><div className={`h-full transition-all duration-200 ${isOverdrive && !isLowQuality ? 'animate-rainbow' : (isOverdrive ? 'bg-amber-500' : (health < 30 ? 'bg-red-500' : 'bg-cyan-500'))}`} style={{width: `${health}%`}}></div></div><div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden"><div className={`h-full transition-all duration-200 ${isOverdrive && !isLowQuality ? 'animate-rainbow' : (isOverdrive ? 'bg-amber-600' : 'bg-amber-600/30')}`} style={{width: `${overdrive}%` }}></div></div></div>
                    <div className="w-1/3 text-right"><div className={`text-[10px] text-cyan-400 font-bold ${fontClass}`}>{t.SCORE}</div><div className="text-3xl font-mono text-white glow-text">{score.toString().padStart(7, '0')}</div></div>
                </div>
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
    <div className={`fixed inset-0 w-full h-[100dvh] bg-black overflow-hidden text-slate-100 select-none touch-none`}>
      {showMobileStart && (
         <div className="absolute inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-8 pb-[env(safe-area-inset-bottom)] text-center cursor-pointer" onClick={handleMobileEnter}>
            <div className="relative w-24 h-24 mb-8"><div className="absolute inset-0 border-4 border-cyan-500 rounded-full animate-ping opacity-50"></div><div className="absolute inset-0 border-4 border-cyan-400 rounded-full flex items-center justify-center bg-cyan-900/20 backdrop-blur-md"><span className="text-3xl">👆</span></div></div>
            <h1 className={`text-2xl md:text-3xl font-black italic text-white mb-4 animate-pulse tracking-widest ${fontClass}`}>{t.WELCOME_TITLE}</h1>
            <div className="max-w-md bg-slate-900/50 border border-slate-700 p-4 rounded-lg mb-8 backdrop-blur-sm"><p className={`text-slate-300 text-sm md:text-base whitespace-pre-line leading-relaxed ${fontClass}`}>{t.WELCOME_DESC}</p></div>
            <div className="text-[10px] text-slate-600 font-mono border border-slate-800 px-4 py-2 rounded">TAP TO INITIALIZE SYSTEM</div>
         </div>
      )}

      <audio ref={bgMusicRef} src="/musicbg.mp3" loop />
      <div className={`absolute inset-0 z-0 pointer-events-auto overflow-hidden bg-slate-900`} ref={bgRef} style={{ transition: 'transform 0.05s, filter 0.05s' }}>
        {status === GameStatus.PLAYING && !isLowQuality && <div className={`absolute inset-0 z-10 pointer-events-none overflow-hidden transition-opacity duration-200 ${isOverdrive ? 'opacity-100' : 'opacity-0'}`}><div className="absolute inset-0 bg-white/5 mix-blend-overlay"></div></div>}
        {(status === GameStatus.TITLE || status === GameStatus.MENU) && <div className="absolute inset-0 z-10 pointer-events-none">{layoutSettings.enableMenuBackground ? (<>{!isLowQuality && <video src="/background.mp4" autoPlay loop muted playsInline webkit-playsinline="true" disablePictureInPicture className="absolute inset-0 w-full h-full object-cover pointer-events-none touch-none" />}<div className={`absolute inset-0 ${!isLowQuality ? 'led-screen-filter' : 'bg-slate-950'}`}></div></>) : ( <div className="absolute inset-0 bg-slate-950"></div> )}</div>}
        {(status === GameStatus.PLAYING || status === GameStatus.PAUSED || status === GameStatus.RESUMING || status === GameStatus.OUTRO) && (<>{mediaType === 'video' && !isLowQuality ? (<video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={localVideoSrc || undefined} className={`absolute inset-0 w-full h-full object-cover z-20 pointer-events-none touch-none`} onEnded={triggerOutro} playsInline webkit-playsinline="true" disablePictureInPicture />) : (<div className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm"><audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={localVideoSrc || undefined} onEnded={triggerOutro} />{!isLowQuality && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-[300px] h-[300px] border-4 border-cyan-500/20 rounded-full animate-[spin_10s_linear_infinite]"></div><div className="absolute w-[200px] h-[200px] border-2 border-fuchsia-500/20 rounded-full animate-[spin-ccw_15s_linear_infinite]"></div></div>}</div>)}{isOverdrive && !isLowQuality && <div className="absolute inset-0 z-20 bg-amber-500/10 mix-blend-overlay pointer-events-none"></div>}</>)}
      </div>

      <div className="scanlines z-50 pointer-events-none opacity-40"></div>
      
      {(status === GameStatus.TITLE || status === GameStatus.MENU) && !showMobileStart && (
        <button onClick={() => setIsBgMusicMuted(!isBgMusicMuted)} className="absolute bottom-4 right-4 z-[70] p-2 bg-black/50 hover:bg-black/80 text-cyan-400 border border-cyan-500 rounded-full transition-all active:scale-95 mb-[env(safe-area-inset-bottom)] mr-[env(safe-area-inset-right)]" title="Toggle Intro Music">{isBgMusicMuted ? ( <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg> ) : ( <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg> )}</button>
      )}

      {showKeyConfig && ( <KeyConfigMenu currentKeyMode={keyMode} mappings={keyMappings} audioSettings={audioSettings} onAudioSettingsChange={setAudioSettings} layoutSettings={layoutSettings} onLayoutSettingsChange={handleLayoutChange} onSave={saveKeyMappings} onClose={() => setShowKeyConfig(false)} onPlaySound={playUiSound} t={t} fontClass={fontClass} /> )}
      {startCountdown !== null && ( <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"><div className="text-[15rem] font-black font-display text-cyan-400 animate-ping">{startCountdown}</div></div> )}
      {status === GameStatus.RESUMING && resumeCountdown !== null && ( <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm"><div className="text-3xl text-cyan-400 font-bold mb-4 animate-pulse">RESUMING</div><div className="text-[10rem] font-black font-display text-white animate-ping">{resumeCountdown > 0 ? resumeCountdown : "GO!"}</div></div> )}
      
      {status === GameStatus.OUTRO && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black animate-fade-in duration-1000"><div className="flex flex-col items-center animate-bounce-short"><h1 className="text-5xl md:text-9xl font-display font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-cyan-500 filter drop-shadow-[0_0_50px_rgba(6,182,212,0.8)]">DJ<span className="text-cyan-400">BIG</span></h1><div className={`text-lg md:text-2xl font-mono text-cyan-200 tracking-[1em] mt-4 animate-pulse ${fontClass} text-center`}>{t.MISSION_RESULTS}</div></div></div>
      )}

      {status === GameStatus.TITLE && !showMobileStart && (
          <div className="relative z-30 h-full w-full flex flex-col items-center justify-center overflow-hidden">
              {!isLowQuality && <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"><div className="absolute w-[600px] h-[600px] border-[2px] border-dashed border-cyan-500/20 rounded-full animate-[spin_20s_linear_infinite]"></div><div className="absolute w-[500px] h-[500px] border border-cyan-500/10 rounded-full animate-[spin-ccw_30s_linear_infinite]"></div></div>}
              <div className="relative z-10 text-center transform hover:scale-105 transition-transform duration-500 cursor-default mb-12 mt-[-100px]"><div className="flex items-end justify-center leading-none mb-4 animate-pulse"><span className="text-8xl md:text-[10rem] font-black font-display text-white italic drop-shadow-[5px_5px_0px_rgba(6,182,212,1)] tracking-tighter" style={{textShadow: '4px 4px 0px #0891b2'}}>DJ</span><span className="text-8xl md:text-[10rem] font-black font-display text-cyan-400 italic drop-shadow-[0_0_30px_rgba(34,211,238,0.8)] ml-2" style={{textShadow: '0 0 20px cyan'}}>BIG</span></div><div className="inline-block bg-black/80 px-4 py-1 border-x-2 border-cyan-500 backdrop-blur-sm"><p className={`text-cyan-200 font-bold tracking-[0.5em] text-sm md:text-xl font-display uppercase`}>RHYTHM MUSIC EMULATOR</p></div></div>
              <div className="flex flex-col items-center space-y-4 w-full max-w-md z-20">
                  <button onClick={() => { setStatus(GameStatus.MENU); playUiSound('select'); initAudio(); }} onMouseEnter={() => playUiSound('hover')} className="group relative w-80 h-20 bg-gradient-to-r from-cyan-900/80 via-cyan-600 to-cyan-900/80 border-x-4 border-cyan-400 transform -skew-x-12 hover:scale-105 transition-all duration-200 overflow-hidden shadow-[0_0_30px_rgba(6,182,212,0.3)]"><div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-20 transition-opacity"></div><div className="flex flex-col items-center justify-center h-full transform skew-x-12"><span className={`text-3xl font-black italic text-white group-hover:text-cyan-100 ${fontClass}`}>{t.START}</span><span className="text-[10px] font-mono text-cyan-300 tracking-[0.3em]">INITIATE SEQUENCE</span></div></button>
                  <button onClick={initMultiplayer} onMouseEnter={() => playUiSound('hover')} className="group relative w-64 h-14 bg-gradient-to-r from-slate-800/80 via-green-900 to-slate-800/80 border-x-4 border-green-500 transform -skew-x-12 hover:scale-105 transition-all duration-200 overflow-hidden"><div className="flex flex-col items-center justify-center h-full transform skew-x-12"><span className={`text-lg font-bold text-slate-300 group-hover:text-green-200 ${fontClass}`}>ONLINE MODE</span>{user && <span className="text-[8px] font-mono text-green-400">LOGGED IN AS {user.name.toUpperCase()}</span>}</div></button>
                  <button onClick={() => { setShowKeyConfig(true); playUiSound('select'); }} onMouseEnter={() => playUiSound('hover')} className="group relative w-64 h-14 bg-gradient-to-r from-slate-800/80 via-yellow-900 to-slate-800/80 border-x-4 border-yellow-500 transform -skew-x-12 hover:scale-105 transition-all duration-200 overflow-hidden"><div className="flex flex-col items-center justify-center h-full transform skew-x-12"><span className={`text-xl font-bold text-slate-300 group-hover:text-yellow-200 ${fontClass}`}>{t.SETTING}</span></div></button>
                  <button onClick={() => window.location.reload()} onMouseEnter={() => playUiSound('hover')} className="group relative w-64 h-14 bg-gradient-to-r from-slate-800/80 via-red-900 to-slate-800/80 border-x-4 border-red-500 transform -skew-x-12 hover:scale-105 transition-all duration-200 overflow-hidden"><div className="flex flex-col items-center justify-center h-full transform skew-x-12"><span className={`text-lg font-bold text-slate-300 group-hover:text-red-200 ${fontClass}`}>{t.EXIT}</span></div></button>
               </div>
              <div className="absolute bottom-8 w-full text-center pb-[env(safe-area-inset-bottom)]"><p className="text-[10px] text-slate-500 font-mono">VER 2.5.0 // CREATED BY : IGNORE</p><p className="text-[10px] text-slate-600 font-mono mt-1">© 2024 DJBIG PROJECT. ALL RIGHTS RESERVED.</p></div>
          </div>
      )}

      {showNamePrompt && (
          <div className="fixed inset-0 z-[90] bg-black/90 backdrop-blur-xl flex items-center justify-center animate-fade-in">
              <div className="bg-slate-900 border border-cyan-500 p-8 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.5)] max-w-md w-full relative">
                  <button onClick={() => setShowNamePrompt(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white">✕</button>
                  <h2 className={`text-2xl font-black italic text-white mb-6 text-center ${fontClass}`}>ENTER PLAYER NAME</h2>
                  <div className="flex flex-col gap-4">
                      <input type="text" placeholder="YOUR NAME" value={guestNameInput} onChange={(e) => setGuestNameInput(e.target.value)} className="bg-black border border-slate-600 text-white px-4 py-3 rounded font-mono text-lg text-center" autoFocus />
                      <button onClick={handleGuestLogin} className="w-full h-12 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded">CONTINUE</button>
                  </div>
              </div>
          </div>
      )}

      {showMultiplayerMenu && (
          <div className="fixed inset-0 z-[80] bg-black/95 backdrop-blur-xl flex items-center justify-center animate-fade-in p-4">
              <div className="bg-slate-900/90 border border-cyan-500/50 p-0 rounded-2xl shadow-[0_0_100px_rgba(6,182,212,0.3)] max-w-2xl w-full relative overflow-hidden flex flex-col md:flex-row min-h-[500px]">
                  
                  {/* Sidebar / User Info */}
                  <div className="w-full md:w-1/3 bg-slate-950/50 border-b md:border-b-0 md:border-r border-slate-800 p-6 flex flex-col items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-b from-cyan-900/20 to-transparent pointer-events-none"></div>
                      <div className="relative z-10 flex flex-col items-center">
                          <div className="w-24 h-24 rounded-full border-4 border-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.5)] overflow-hidden mb-4 bg-black">
                              {user?.picture ? (
                                  <img src={user.picture} alt="Avatar" className="w-full h-full object-cover" />
                              ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-slate-800 text-cyan-400 font-bold text-3xl">{user?.name?.charAt(0).toUpperCase()}</div>
                              )}
                          </div>
                          <div className="text-slate-400 text-xs font-bold tracking-widest mb-1">PLAYER PROFILE</div>
                          <h3 className={`text-2xl font-black italic text-white text-center leading-none ${fontClass}`}>{user?.name}</h3>
                          <div className="mt-6 w-full space-y-2">
                              <div className="flex justify-between text-xs text-slate-500 font-mono border-b border-slate-800 pb-1"><span>STATUS</span><span className="text-green-400">ONLINE</span></div>
                              <div className="flex justify-between text-xs text-slate-500 font-mono border-b border-slate-800 pb-1"><span>SERVER</span><span className="text-cyan-400">ASIA-1</span></div>
                          </div>
                      </div>
                      <button onClick={() => { setShowMultiplayerMenu(false); if (wsRef.current) { wsRef.current.close(); wsRef.current = null; } setMpStatus('LOBBY'); setIsMultiplayer(false); }} className="mt-auto md:mt-8 text-xs text-red-400 hover:text-red-300 flex items-center gap-2 px-4 py-2 rounded border border-red-900/30 hover:bg-red-900/20 transition-colors">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                          DISCONNECT
                      </button>
                  </div>

                  {/* Main Content Area */}
                  <div className="flex-1 p-8 flex flex-col relative">
                      <div className="absolute top-0 right-0 p-4 opacity-20 pointer-events-none">
                          <div className="text-[8rem] leading-none font-black text-white italic transform -rotate-12">VS</div>
                      </div>

                      <h2 className={`text-4xl font-black italic text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 mb-8 relative z-10 ${fontClass}`}>MULTIPLAYER <span className="text-cyan-400">LOBBY</span></h2>
                      
                      {mpStatus === 'LOBBY' && (
                          <div className="flex flex-col gap-6 flex-1 justify-center z-10">
                              <div className="group relative">
                                  <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-lg blur opacity-30 group-hover:opacity-75 transition duration-200"></div>
                                  <button onClick={createRoom} className="relative w-full h-20 bg-slate-900 rounded-lg flex items-center px-6 border border-slate-700 group-hover:border-cyan-500 transition-all">
                                      <div className="w-12 h-12 rounded-full bg-cyan-900/50 flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
                                          <svg className="w-6 h-6 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                      </div>
                                      <div className="text-left">
                                          <div className={`text-xl font-bold text-white ${fontClass}`}>CREATE ROOM</div>
                                          <div className="text-xs text-slate-400">Host a new game and invite a friend</div>
                                      </div>
                                  </button>
                              </div>

                              <div className="relative">
                                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div>
                                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-500">Or Join Existing</span></div>
                              </div>

                              <div className="flex gap-2">
                                  <div className="relative flex-1">
                                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                          <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                                      </div>
                                      <input type="text" placeholder="ENTER ROOM ID" value={joinRoomIdInput} onChange={(e) => setJoinRoomIdInput(e.target.value.toUpperCase())} className="block w-full pl-10 h-14 bg-black border border-slate-700 focus:border-green-500 rounded-lg text-white font-mono text-lg uppercase tracking-widest focus:ring-1 focus:ring-green-500 outline-none transition-all" />
                                  </div>
                                  <button onClick={joinRoom} disabled={!joinRoomIdInput} className={`px-8 h-14 rounded-lg font-bold text-white transition-all ${joinRoomIdInput ? 'bg-green-600 hover:bg-green-500 shadow-[0_0_20px_rgba(34,197,94,0.4)]' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}>JOIN</button>
                              </div>
                          </div>
                      )}

                      {mpStatus === 'WAITING' && (
                          <div className="flex flex-col items-center justify-center flex-1 z-10">
                              <div className="w-full bg-black/50 border border-cyan-900/50 rounded-xl p-6 text-center mb-8 relative overflow-hidden">
                                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent animate-scan"></div>
                                  <div className="text-xs text-cyan-500 font-mono mb-2 tracking-widest">ROOM ID GENERATED</div>
                                  <div className="text-5xl font-mono font-bold text-white tracking-[0.2em] mb-4 drop-shadow-[0_0_10px_rgba(6,182,212,0.8)] select-all">{multiplayerRoomId}</div>
                                  <button onClick={() => { navigator.clipboard.writeText(multiplayerRoomId); setFeedback({ text: "COPIED!", color: "text-green-400", id: Date.now() }); }} className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-1 rounded border border-slate-600 transition-colors">COPY TO CLIPBOARD</button>
                              </div>
                              <div className="flex items-center gap-3">
                                  <div className="w-3 h-3 bg-cyan-400 rounded-full animate-ping"></div>
                                  <div className="text-slate-300 font-mono animate-pulse">WAITING FOR OPPONENT...</div>
                              </div>
                          </div>
                      )}

                      {mpStatus === 'READY' && (
                          <div className="flex flex-col flex-1 z-10">
                              <div className="flex-1 flex flex-col items-center justify-center">
                                  <div className="flex items-center gap-8 mb-8">
                                      <div className="flex flex-col items-center">
                                          <div className="w-20 h-20 rounded-full border-4 border-cyan-500 bg-black mb-2 overflow-hidden"><img src={user?.picture || undefined} className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display='none'} /><div className="w-full h-full flex items-center justify-center bg-slate-800 text-cyan-400 font-bold text-xl" style={{display: user?.picture ? 'none' : 'flex'}}>{user?.name?.charAt(0)}</div></div>
                                          <div className="text-white font-bold text-sm">{user?.name}</div>
                                      </div>
                                      <div className="text-4xl font-black italic text-red-500">VS</div>
                                      <div className="flex flex-col items-center">
                                          <div className="w-20 h-20 rounded-full border-4 border-red-500 bg-black mb-2 flex items-center justify-center overflow-hidden">
                                              <span className="text-3xl">😈</span>
                                          </div>
                                          <div className="text-white font-bold text-sm">{opponentState?.name}</div>
                                      </div>
                                  </div>

                                  {transferProgress !== null && (
                                      <div className="w-full max-w-md mb-6 bg-slate-900 p-4 rounded-lg border border-slate-700">
                                          <div className="flex justify-between text-xs text-cyan-400 mb-2 font-mono">
                                              <span>{transferStatus}</span>
                                              <span>{Math.round(transferProgress)}%</span>
                                          </div>
                                          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                                              <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-200" style={{ width: `${transferProgress}%` }}></div>
                                          </div>
                                      </div>
                                  )}

                                  {/* Host Controls */}
                                  {isHost ? (
                                      <div className="w-full max-w-md bg-slate-800/50 rounded-lg border border-slate-700 p-4 mb-6">
                                          <div className="flex items-center justify-between mb-4">
                                              <div className="flex items-center gap-3 overflow-hidden">
                                                  <div className="w-10 h-10 bg-black rounded flex items-center justify-center shrink-0 text-slate-500">🎵</div>
                                                  <div className="min-w-0">
                                                      <div className="text-[10px] text-slate-400 font-bold tracking-wider">SELECTED TRACK</div>
                                                      <div className="text-white font-bold truncate text-sm">{currentSongMetadata?.name || "NO TRACK SELECTED"}</div>
                                                  </div>
                                              </div>
                                              <button onClick={() => setShowLobbySongSelect(true)} className="text-[10px] bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded font-bold transition-colors">CHANGE</button>
                                          </div>
                                          
                                          {currentSongMetadata && (
                                              <button onClick={sendFile} className="w-full text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-md font-bold shadow-lg hover:shadow-blue-500/20 transition-all mb-2">SYNC TRACK TO GUEST</button>
                                          )}

                                          <div className="flex items-center justify-between text-xs font-mono bg-black/30 p-2 rounded">
                                              <span className="text-slate-400">GUEST STATUS:</span>
                                              <span className={isGuestReady ? "text-green-400 font-bold animate-pulse" : "text-red-400 font-bold"}>{isGuestReady ? "READY" : "NOT READY"}</span>
                                          </div>
                                      </div>
                                  ) : (
                                      <div className="w-full max-w-md bg-slate-800/50 rounded-lg border border-slate-700 p-4 mb-6">
                                          <div className="flex items-center gap-3 overflow-hidden mb-4">
                                              <div className="w-10 h-10 bg-black rounded flex items-center justify-center shrink-0 text-slate-500">🎵</div>
                                              <div className="min-w-0">
                                                  <div className="text-[10px] text-slate-400 font-bold tracking-wider">HOST TRACK</div>
                                                  <div className="text-white font-bold truncate text-sm">{currentSongMetadata?.name || "WAITING FOR HOST..."}</div>
                                              </div>
                                          </div>
                                          <div className="text-center text-xs text-slate-500 font-mono">WAITING FOR HOST TO START</div>
                                      </div>
                                  )}
                              </div>

                              {isHost ? (
                                  <button onClick={startGameMultiplayer} disabled={!isGuestReady} className={`w-full h-16 font-black text-2xl italic tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 group ${isGuestReady ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white shadow-[0_0_30px_rgba(220,38,38,0.4)] hover:shadow-[0_0_50px_rgba(220,38,38,0.6)] transform hover:scale-[1.02] active:scale-[0.98] cursor-pointer' : 'bg-slate-800 text-slate-500 cursor-not-allowed grayscale'}`}>
                                      <span>START BATTLE</span>
                                      {isGuestReady && <svg className="w-6 h-6 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>}
                                  </button>
                              ) : (
                                  <button onClick={handleReadyToggle} className={`w-full h-16 font-black text-2xl italic tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 group ${isGuestReady ? 'bg-green-600 hover:bg-green-500 text-white shadow-[0_0_30px_rgba(34,197,94,0.4)]' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
                                      <span>{isGuestReady ? "READY!" : "CLICK TO READY"}</span>
                                  </button>
                              )}
                          </div>
                      )}
                  </div>
              </div>

              {/* Lobby Song Select Modal */}
              {showLobbySongSelect && (
                  <div className="absolute inset-0 z-[90] bg-black/90 backdrop-blur-xl flex flex-col p-8 animate-fade-in">
                      <div className="flex justify-between items-center mb-6">
                          <h2 className={`text-3xl font-black italic text-white ${fontClass}`}>SELECT TRACK</h2>
                          <button onClick={() => setShowLobbySongSelect(false)} className="text-slate-400 hover:text-white">CLOSE</button>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-2">
                          <div onClick={() => fileInputRef.current?.click()} className="p-4 border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-lg flex items-center justify-center cursor-pointer transition-colors group">
                              <div className="text-slate-500 group-hover:text-cyan-400 font-bold flex items-center gap-2">
                                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                  UPLOAD NEW TRACK
                              </div>
                              <input 
                                  type="file" 
                                  ref={fileInputRef} 
                                  onChange={(e) => {
                                      if (e.target.files && e.target.files[0]) {
                                          const file = e.target.files[0];
                                          // Create a temporary song object
                                          const tempSong: SongMetadata = {
                                              id: Date.now().toString(),
                                              name: file.name,
                                              file: file,
                                              type: file.type.startsWith('video') ? 'video' : 'audio',
                                              duration: 0,
                                              bpm: 0,
                                              thumbnailUrl: ''
                                          };
                                          handleLobbySongSelect(tempSong);
                                      }
                                  }} 
                                  className="hidden" 
                                  accept="audio/*,video/*"
                              />
                          </div>
                          {songList.map(song => (
                              <div key={song.id} onClick={() => handleLobbySongSelect(song)} className="p-4 bg-slate-800/50 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer flex items-center gap-4 transition-colors">
                                  <div className="w-12 h-12 bg-black rounded overflow-hidden shrink-0">
                                      {song.thumbnailUrl ? <img src={song.thumbnailUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-900"></div>}
                                  </div>
                                  <div className="min-w-0">
                                      <div className="text-white font-bold truncate">{song.name}</div>
                                      <div className="text-xs text-slate-500 uppercase">{song.type} FILE</div>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              )}
          </div>
      )}

      {status === GameStatus.MENU && !startCountdown && (
        <div className="relative z-30 w-full h-full flex flex-col md:flex-row animate-fade-in bg-slate-900/40 backdrop-blur-md overflow-hidden">
          <div className="md:hidden w-full min-h-[4rem] bg-slate-900 flex items-center justify-between px-4 z-50 border-b border-slate-700 shrink-0 pt-[max(2rem,env(safe-area-inset-top))] pb-2"><button onClick={() => { setStatus(GameStatus.TITLE); stopPreview(); }} className="text-white font-bold text-sm flex items-center gap-1">← {t.BACK}</button><div className="flex items-center gap-3">{songList.length > 0 && ( <button onClick={handleClearPlaylist} className={`text-[9px] text-red-400 font-bold border border-red-900/50 px-2 py-1 rounded bg-red-900/10 hover:bg-red-900/30 ${fontClass}`}>{t.CLEAR_PLAYLIST}</button> )}<div className="text-cyan-400 font-bold text-xs hidden sm:block">MUSIC SELECT</div></div></div>
          <div className={`w-full ${isMobile ? 'flex-1 min-h-0' : 'md:w-[55%] h-full'} flex flex-col bg-slate-950/80 border-r border-slate-700/50 relative shrink-0 overflow-hidden`}><div className="hidden md:flex h-24 items-end justify-between pb-4 px-8 border-b border-cyan-500/30 bg-gradient-to-b from-slate-900 to-transparent shrink-0"><h2 className={`text-4xl font-black italic text-white tracking-tighter ${fontClass} drop-shadow-md`}>SELECT <span className="text-cyan-400">MUSIC</span></h2>{songList.length > 0 && ( <button onClick={handleClearPlaylist} className={`text-[10px] font-bold text-red-500 hover:text-red-300 transition-colors tracking-widest border border-red-900/50 hover:border-red-500 px-3 py-1 rounded uppercase bg-slate-900/50 ${fontClass}`}>{t.CLEAR_PLAYLIST}</button> )}</div>
             <div className="w-full flex-1 overflow-y-auto custom-scrollbar p-0 space-y-1 pb-48 md:pb-0">
                 <div onClick={(e) => { loadDemoTrack('/demoplay00.mp4', 'DEMO_TRACK_00'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${localFileName === "DEMO_TRACK_00" ? 'bg-gradient-to-r from-cyan-900/80 to-transparent border-cyan-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-cyan-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}><div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${localFileName === "DEMO_TRACK_00" ? 'border-white animate-spin-slow' : 'border-slate-600'} bg-black overflow-hidden shadow-lg shrink-0`}><div className="w-4 h-4 bg-slate-900 rounded-full absolute z-10 border border-slate-600"></div><div className={`w-full h-full bg-gradient-to-tr from-cyan-500 to-blue-700 opacity-80`}></div><span className="absolute text-[8px] font-black text-black/50 z-0 rotate-45">DJBIG</span></div><div className="flex-1 min-w-0"><MarqueeText text={t.PLAY_DEMO_00} className={`text-lg font-bold ${fontClass} ${localFileName === "DEMO_TRACK_00" ? 'text-white' : 'text-slate-400 group-hover:text-cyan-200'}`} /><div className="text-[10px] font-mono text-cyan-600/70">PROTOTYPE MIX // 130 BPM</div></div>{localFileName === "DEMO_TRACK_00" && <div className="text-cyan-400 text-xl animate-pulse">◀</div>}</div>
                 <div onClick={(e) => { loadDemoTrack('/demoplay.mp4', 'DEMO_TRACK_01'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${localFileName === "DEMO_TRACK_01" ? 'bg-gradient-to-r from-green-900/80 to-transparent border-green-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-green-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}><div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${localFileName === "DEMO_TRACK_01" ? 'border-white animate-spin-slow' : 'border-slate-600'} bg-black overflow-hidden shadow-lg shrink-0`}><div className="w-4 h-4 bg-slate-900 rounded-full absolute z-10 border border-slate-600"></div><div className={`w-full h-full bg-gradient-to-tr from-green-500 to-emerald-700 opacity-80`}></div><span className="absolute text-[8px] font-black text-black/50 z-0 rotate-45">DJBIG</span></div><div className="flex-1 min-w-0"><MarqueeText text={t.PLAY_DEMO_01} className={`text-lg font-bold ${fontClass} ${localFileName === "DEMO_TRACK_01" ? 'text-white' : 'text-slate-400 group-hover:text-green-200'}`} /><div className="text-[10px] font-mono text-green-600/70">HIGH SPEED ROCK // 175 BPM</div></div>{localFileName === "DEMO_TRACK_01" && <div className="text-green-400 text-xl animate-pulse">◀</div>}</div>
                 <div onClick={(e) => { loadDemoTrack('/demoplay02.mp4', 'DEMO_TRACK_02'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${localFileName === "DEMO_TRACK_02" ? 'bg-gradient-to-r from-amber-900/80 to-transparent border-amber-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-amber-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}><div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${localFileName === "DEMO_TRACK_02" ? 'border-white animate-spin-slow' : 'border-slate-600'} bg-black overflow-hidden shadow-lg shrink-0`}><div className="w-4 h-4 bg-slate-900 rounded-full absolute z-10 border border-slate-600"></div><div className={`w-full h-full bg-gradient-to-tr from-amber-500 to-orange-700 opacity-80`}></div><span className="absolute text-[8px] font-black text-black/50 z-0 rotate-45">DJBIG</span></div><div className="flex-1 min-w-0"><MarqueeText text={t.PLAY_DEMO_02} className={`text-lg font-bold ${fontClass} ${localFileName === "DEMO_TRACK_02" ? 'text-white' : 'text-slate-400 group-hover:text-amber-200'}`} /><div className="text-[10px] font-mono text-amber-600/70">ALTERNATIVE MIX // 140 BPM</div></div>{localFileName === "DEMO_TRACK_02" && <div className="text-amber-400 text-xl animate-pulse">◀</div>}</div>
                 <div onClick={(e) => { loadDemoTrack('/demoplay03.mp4', 'DEMO_TRACK_03'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${localFileName === "DEMO_TRACK_03" ? 'bg-gradient-to-r from-purple-900/80 to-transparent border-purple-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-purple-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}><div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${localFileName === "DEMO_TRACK_03" ? 'border-white animate-spin-slow' : 'border-slate-600'} bg-black overflow-hidden shadow-lg shrink-0`}><div className="w-4 h-4 bg-slate-900 rounded-full absolute z-10 border border-slate-600"></div><div className={`w-full h-full bg-gradient-to-tr from-purple-500 to-fuchsia-700 opacity-80`}></div><span className="absolute text-[8px] font-black text-black/50 z-0 rotate-45">DJBIG</span></div><div className="flex-1 min-w-0"><MarqueeText text={t.PLAY_DEMO_03} className={`text-lg font-bold ${fontClass} ${localFileName === "DEMO_TRACK_03" ? 'text-white' : 'text-slate-400 group-hover:text-purple-200'}`} /><div className="text-[10px] font-mono text-purple-600/70">ELECTRONIC CORE // 150 BPM</div></div>{localFileName === "DEMO_TRACK_03" && <div className="text-purple-400 text-xl animate-pulse">◀</div>}</div>
                 <div onClick={(e) => { loadDemoTrack('/demoplay04.mp4', 'DEMO_TRACK_04'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${localFileName === "DEMO_TRACK_04" ? 'bg-gradient-to-r from-rose-900/80 to-transparent border-rose-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-rose-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}><div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${localFileName === "DEMO_TRACK_04" ? 'border-white animate-spin-slow' : 'border-slate-600'} bg-black overflow-hidden shadow-lg shrink-0`}><div className="w-4 h-4 bg-slate-900 rounded-full absolute z-10 border border-slate-600"></div><div className={`w-full h-full bg-gradient-to-tr from-rose-500 to-pink-700 opacity-80`}></div><span className="absolute text-[8px] font-black text-black/50 z-0 rotate-45">DJBIG</span></div><div className="flex-1 min-w-0"><MarqueeText text={t.PLAY_DEMO_04} className={`text-lg font-bold ${fontClass} ${localFileName === "DEMO_TRACK_04" ? 'text-white' : 'text-slate-400 group-hover:text-rose-200'}`} /><div className="text-[10px] font-mono text-rose-600/70">CYBER PUNK ROCK // 160 BPM</div></div>{localFileName === "DEMO_TRACK_04" && <div className="text-rose-400 text-xl animate-pulse">◀</div>}</div>
                 {songList.map((song, idx) => {
                     const isActive = localFileName === song.name;
                     return (
                        <div key={song.id} onClick={(e) => { handleFileSelect(song.file, song); playUiSound('select'); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} onMouseEnter={() => playUiSound('hover')} className={`group relative h-20 w-full flex items-center px-6 cursor-pointer transition-all border-l-8 overflow-hidden ${isActive ? 'bg-gradient-to-r from-cyan-900/80 to-transparent border-cyan-400' : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800 hover:border-cyan-600'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0% 100%)' }}><div className={`mr-4 w-12 h-12 rounded-full flex items-center justify-center border-4 ${isActive ? 'border-white animate-spin-slow' : 'border-slate-700'} bg-black/50 overflow-hidden shrink-0 shadow-lg`}>{song.thumbnailUrl ? ( <img src={song.thumbnailUrl} className="w-full h-full object-cover" alt="Cover" /> ) : ( <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center"><div className="text-[8px] font-bold text-slate-400 text-center leading-none rotate-45">DJ<br/>BIG</div></div> )}<div className="absolute w-3 h-3 bg-slate-900 rounded-full border border-slate-600 z-10"></div></div><div className="flex-1 min-w-0 overflow-hidden"><MarqueeText text={song.name} className={`text-lg font-bold ${fontClass} ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-cyan-200'}`} /><div className="text-[10px] font-mono text-slate-600 group-hover:text-cyan-600/70 uppercase">{song.type.toUpperCase()} FILE</div></div><button onClick={(e) => handleDeleteSong(e, song.id)} className="ml-2 w-8 h-8 flex items-center justify-center text-slate-500 hover:text-red-500 bg-slate-800 hover:bg-red-900/30 rounded border border-slate-700 hover:border-red-500 transition-colors z-20 group-hover:opacity-100" title="Delete">✕</button></div>
                     );
                 })}
             </div>
             {isMobile && !showMobileSetup && (
                <div className="fixed bottom-0 left-0 w-full z-50 bg-slate-950/95 border-t border-slate-700 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">{currentSongMetadata && ( <div className="px-4 pt-2 pb-2"><button onClick={() => { playUiSound('select'); if (typeof navigator !== 'undefined' && (navigator as any).vibrate) { try { (navigator as any).vibrate(50); } catch(e) {} } setShowMobileSetup(true); }} className="w-full h-14 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.6)] flex items-center justify-center border-2 border-white/20 animate-bounce-short hover:scale-105 transition-transform"><span className={`text-xl font-black italic text-white mr-2 ${fontClass}`}>PLAY</span><span className="text-white/80 font-mono text-xs truncate max-w-[200px]">{currentSongMetadata.name}</span></button></div> )}<div className="flex gap-2 p-2 pt-0"><label className="flex-1 h-10 bg-slate-800 hover:bg-cyan-900/50 border border-slate-600 hover:border-cyan-500 rounded flex items-center justify-center cursor-pointer transition-colors group"><span className={`text-[9px] font-bold text-slate-400 group-hover:text-cyan-400 ${fontClass}`}>+ {t.LOAD_SINGLE}</span><input type="file" accept="video/*,audio/*" onChange={handleSingleFileUpload} className="hidden" /></label><label className="flex-1 h-10 bg-slate-800 hover:bg-fuchsia-900/50 border border-slate-600 hover:border-fuchsia-500 rounded flex items-center justify-center cursor-pointer transition-colors group"><span className={`text-[9px] font-bold text-slate-400 group-hover:text-fuchsia-400 ${fontClass}`}>+ {t.ADD_MULTIPLE}</span><input type="file" multiple onChange={handleFolderSelect} className="hidden" /></label></div></div>
             )}
             {!isMobile && ( <div className="bg-black/80 p-4 border-t border-slate-700 flex gap-2 shrink-0 z-40 relative pb-[calc(1rem+env(safe-area-inset-bottom))]"><label className="flex-1 h-12 bg-slate-800 hover:bg-cyan-900/50 border border-slate-600 hover:border-cyan-500 rounded flex items-center justify-center cursor-pointer transition-colors group"><span className={`text-xs font-bold text-slate-400 group-hover:text-cyan-400 ${fontClass}`}>+ {t.LOAD_SINGLE}</span><input type="file" accept="video/*,audio/*" onChange={handleSingleFileUpload} className="hidden" /></label><label className="flex-1 h-12 bg-slate-800 hover:bg-fuchsia-900/50 border border-slate-600 hover:border-fuchsia-500 rounded flex items-center justify-center cursor-pointer transition-colors group"><span className={`text-xs font-bold text-slate-400 group-hover:text-fuchsia-400 ${fontClass}`}>+ {t.LOAD_FOLDER}</span><input type="file" multiple onChange={handleFolderSelect} className="hidden" {...({ webkitdirectory: "", directory: "" } as any)} /></label></div> )}
          </div>
          {!isMobile && (
            <div className="w-full md:w-[45%] h-auto md:h-full relative flex flex-col p-4 md:p-6 justify-between shrink-0 md:overflow-hidden pb-32 md:pb-6">
                 <div className="hidden md:flex w-full justify-between items-start mb-4 z-20 shrink-0"><button onClick={() => { setStatus(GameStatus.TITLE); playUiSound('select'); stopPreview(); }} className="flex items-center space-x-2 text-slate-500 hover:text-white transition-colors group"><div className="w-8 h-8 rounded-full border border-slate-600 group-hover:border-white flex items-center justify-center">←</div><span className={`font-bold tracking-widest ${fontClass}`}>{t.BACK}</span></button><div className="flex space-x-4"><button onClick={() => { setShowKeyConfig(true); playUiSound('select'); }} className="text-slate-500 hover:text-yellow-400 font-bold text-xs tracking-widest">{t.SETTING}</button></div></div>
                 {!isLowQuality && <div className="hidden md:flex absolute inset-0 items-center justify-center opacity-30 pointer-events-none z-0"><div className="w-[80vw] h-[80vw] md:w-[600px] md:h-[600px] border border-cyan-500/20 rounded-full animate-[spin_60s_linear_infinite] border-dashed"></div><div className="absolute w-[60vw] h-[60vw] md:w-[450px] md:h-[450px] border border-white/5 rounded-full animate-[spin-ccw_40s_linear_infinite]"></div></div>}
                 <div className="relative z-10 flex flex-col items-center justify-center flex-1 my-8 md:my-0 min-h-0"><div className="relative w-40 h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 mb-6 group shrink-0"><div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-xl animate-pulse"></div><div className={`relative w-full h-full rounded-full border-4 border-slate-800 bg-black overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] ${!isLowQuality ? 'animate-[spin_10s_linear_infinite]' : ''}`}>{currentSongMetadata?.thumbnailUrl ? ( <img src={currentSongMetadata.thumbnailUrl} className="w-full h-full object-cover opacity-80" alt="Cover" /> ) : ( <div className="w-full h-full bg-gradient-to-tr from-slate-800 to-slate-900 flex items-center justify-center"><div className="w-1/3 h-1/3 bg-cyan-500 rounded-full blur-md"></div></div> )}<div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none"></div></div><div className="absolute top-1/2 left-1/2 w-8 h-8 bg-slate-900 rounded-full transform -translate-x-1/2 -translate-y-1/2 border-2 border-slate-600 z-20"></div></div>
                     <div className="text-center w-full max-w-lg shrink-0"><h1 className={`text-3xl md:text-5xl font-black italic text-white tracking-tighter drop-shadow-[0_0_20px_rgba(6,182,212,0.8)] mb-2 ${fontClass}`}>{localFileName ? ( <MarqueeText text={localFileName} /> ) : t.SELECT_SOURCE}</h1>{localFileName && ( <div className="inline-block bg-cyan-900/30 border border-cyan-500/30 px-4 py-1 rounded-full text-cyan-400 font-mono text-xs tracking-widest">{isPlayingPreview ? 'PREVIEWING...' : 'READY TO START'}</div> )}</div>
                 </div>
                 <div className="relative z-20 mt-4 md:mt-0 space-y-4 pb-8 md:pb-0 shrink-0"><SettingsPanelContent /></div>
            </div>
          )}
          {showMobileSetup && isMobile && (
              <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-xl flex flex-col p-6 animate-fade-in overflow-y-auto pb-[env(safe-area-inset-bottom)]"><button onClick={() => setShowMobileSetup(false)} className="absolute top-4 right-4 text-white p-2 z-50 bg-black/50 rounded-full border border-slate-600 mt-[env(safe-area-inset-top)] mr-[env(safe-area-inset-right)]">✕</button><div className="flex flex-col items-center mb-6 mt-8 pt-[env(safe-area-inset-top)]"><div className={`w-32 h-32 rounded-full border-4 border-cyan-500/50 overflow-hidden shadow-[0_0_30px_rgba(6,182,212,0.4)] mb-4 ${!isLowQuality ? 'animate-[spin_20s_linear_infinite]' : ''}`}>{currentSongMetadata?.thumbnailUrl ? ( <img src={currentSongMetadata.thumbnailUrl} className="w-full h-full object-cover" alt="Cover" /> ) : ( <div className="w-full h-full bg-slate-800 flex items-center justify-center"><span className="text-cyan-500 font-bold">DJBIG</span></div> )}</div><h2 className={`text-2xl font-black italic text-white text-center leading-none ${fontClass}`}>{currentSongMetadata?.name}</h2><div className="text-cyan-400 text-[10px] font-mono mt-1">SETUP CONFIGURATION</div></div><div className="flex-1 w-full max-w-md mx-auto"><SettingsPanelContent /></div></div>
          )}
        </div>
      )}

      {(status === GameStatus.PLAYING || status === GameStatus.PAUSED || status === GameStatus.RESUMING || status === GameStatus.OUTRO || status === GameStatus.WAITING_MULTI_RESULT) && ( 
          <>
            {status === GameStatus.WAITING_MULTI_RESULT && (
                <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                        <div className={`text-2xl font-black italic text-white tracking-widest ${fontClass}`}>WAITING FOR OPPONENT...</div>
                    </div>
                </div>
            )}
            <div className="absolute top-1 left-1/2 transform -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none pt-[env(safe-area-inset-top)]"><div className="bg-black/60 backdrop-blur px-4 py-1 border-b border-cyan-500 shadow-[0_2px_8px_rgba(6,182,212,0.3)] rounded-b-md flex flex-col items-center"><div className={`text-[7px] text-cyan-400 font-bold tracking-[0.3em] mb-0.5 ${fontClass}`}>{t.SCORE}</div><div className="text-xl font-mono text-white font-bold leading-none tracking-widest drop-shadow-[0_0_5px_rgba(255,255,255,0.5)]">{score.toString().padStart(7, '0')}</div></div></div>
            <div className={`absolute bottom-8 z-30 hidden md:flex flex-col pointer-events-none transition-all duration-500 ${layoutSettings.lanePosition === 'right' ? 'left-8 items-start' : 'right-8 items-end'}`}><div className="text-[4rem] font-black font-display italic tracking-tighter leading-none select-none mb-[-0.8rem] transform -skew-x-12 opacity-80" style={{ backgroundImage: 'linear-gradient(to bottom, #22d3ee 0%, #3b82f6 50%, #9333ea 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'drop-shadow(0 4px 0px rgba(0,0,0,0.5))' }}>IGNORE <span className="text-white" style={{ WebkitTextFillColor: 'white' }}>PROTOCOL</span></div><div className={`flex flex-col relative w-64 ${layoutSettings.lanePosition === 'right' ? 'items-start' : 'items-end'}`}><MarqueeText text={currentSongMetadata?.name?.replace(/\.[^/.]+$/, "") || "UNKNOWN TRACK"} className={`text-2xl font-black italic text-white tracking-tighter drop-shadow0_2px_10px_rgba(0,0,0,0.8)] uppercase ${fontClass}`} /><div className="flex gap-2 mt-1"><span className="px-2 py-0.5 bg-black/60 border border-white/20 text-[9px] font-mono text-cyan-400 rounded">LV.{level}</span><span className="px-2 py-0.5 bg-black/60 border border-white/20 text-[9px] font-mono text-fuchsia-400 rounded">{keyMode}Key</span></div></div></div>
            
            {isMultiplayer && opponentState && (
                <div className="absolute top-20 left-4 z-50 bg-black/60 backdrop-blur border border-red-500/50 p-2 rounded w-48 pointer-events-none">
                    <div className="text-[10px] text-red-400 font-bold mb-1">OPPONENT: {opponentState.name}</div>
                    <div className="flex justify-between text-white font-mono text-sm mb-1">
                        <span>SCORE</span>
                        <span>{opponentState.score.toString().padStart(7, '0')}</span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 transition-all duration-300" style={{ width: `${opponentState.health}%` }}></div>
                    </div>
                </div>
            )}

            <div className={`absolute inset-0 z-40 flex items-center ${getPositionClass()}`}>{renderGameFrame()}</div>
          </> 
      )}
      {status === GameStatus.PAUSED && ( <PauseMenu onResume={togglePause} onRestart={startCountdownSequence} onSettings={() => setShowKeyConfig(true)} onQuit={quitGame} t={t} fontClass={fontClass} onTitleClick={handlePauseTitleClick} /> )}
      {status === GameStatus.FINISHED && ( <EndScreen stats={{ perfect: perfectCount, good: goodCount, miss: missCount, maxCombo, score }} opponentStats={isMultiplayer && opponentState && opponentFinalScore !== null ? { ...opponentState, score: opponentFinalScore, miss: 0, perfect: 0, good: 0, maxCombo: opponentState.combo } : null} fileName={currentSongMetadata?.name || "UNKNOWN"} onRestart={startCountdownSequence} onMenu={quitGame} t={t} fontClass={fontClass} onPlaySound={playUiSound} /> )}
    </div>
  );
};

export default App;
