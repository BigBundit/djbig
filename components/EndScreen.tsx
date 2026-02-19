
import React, { useEffect, useState } from 'react';
import { HighScore, GameStats } from '../types';

interface EndScreenProps {
    stats: GameStats;
    opponentStats?: {
        name: string;
        score: number;
        maxCombo: number;
        miss: number;
        perfect: number;
        good: number;
    } | null;
    fileName: string;
    onRestart: () => void;
    onMenu: () => void;
    t: any;
    fontClass: string;
    onPlaySound?: (type: 'hover' | 'select' | 'back' | 'scratch') => void;
}

export const EndScreen: React.FC<EndScreenProps> = ({ stats, opponentStats, fileName, onRestart, onMenu, t, fontClass, onPlaySound }) => {
    const [highScoreData, setHighScoreData] = useState<HighScore | null>(null);
    const [isNewRecord, setIsNewRecord] = useState(false);
    const [playerName, setPlayerName] = useState("");
    const [nameSaved, setNameSaved] = useState(false);
    const [rank, setRank] = useState<string>('');
    
    // Animation States
    const [displayScore, setDisplayScore] = useState(0);
    const [opponentDisplayScore, setOpponentDisplayScore] = useState(0);
    const [showRank, setShowRank] = useState(false);

    // Safe key generation
    const getStorageKey = (fname: string) => {
        const safeName = String(fname || "unknown").replace(/\s+/g, '_');
        return `djbig_hs_${safeName}`;
    };

    useEffect(() => {
        // 1. Calculate Rank
        const totalNotes = stats.perfect + stats.good + stats.miss;
        const totalPotential = totalNotes * 100; // Assuming perfect = 100
        // Calculate weighted percentage (Perfect=100%, Good=50%)
        // Note: Actual score calculation in App.tsx adds bonuses, so this is an accuracy approximation
        const currentWeighted = (stats.perfect * 100) + (stats.good * 50);
        
        let accuracy = 0;
        if (totalPotential > 0) {
            accuracy = (currentWeighted / totalPotential) * 100;
        }

        let calculatedRank = 'F';
        if (accuracy >= 98) calculatedRank = 'S+';
        else if (accuracy >= 95) calculatedRank = 'S';
        else if (accuracy >= 90) calculatedRank = 'A';
        else if (accuracy >= 80) calculatedRank = 'B';
        else if (accuracy >= 70) calculatedRank = 'C';
        else if (accuracy >= 60) calculatedRank = 'D';
        
        setRank(calculatedRank);

        // 2. High Score Logic
        const storageKey = getStorageKey(fileName);
        const stored = localStorage.getItem(storageKey);
        
        let existingRecord: HighScore | null = null;
        if (stored) {
            try {
                existingRecord = JSON.parse(stored);
            } catch (e) {
                console.error("Failed to parse high score", e);
            }
        }

        if (!existingRecord || stats.score > existingRecord.score) {
            setIsNewRecord(true);
        } else {
            setHighScoreData(existingRecord);
        }

        // 3. Score Rolling Animation
        let start = 0;
        const end = stats.score;
        const duration = 1500; // 1.5s
        const startTime = performance.now();

        const animateScore = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Ease out quart
            const ease = 1 - Math.pow(1 - progress, 4);
            
            setDisplayScore(Math.floor(start + (end - start) * ease));
            
            if (opponentStats) {
                 setOpponentDisplayScore(Math.floor(0 + (opponentStats.score - 0) * ease));
            }

            if (progress < 1) {
                requestAnimationFrame(animateScore);
            } else {
                setShowRank(true); // Show rank after score finishes
                if (onPlaySound) onPlaySound('scratch'); // Trigger sound effect on completion
            }
        };

        requestAnimationFrame(animateScore);

    }, [stats, fileName, opponentStats]);

    const handleSaveName = () => {
        if (!playerName || !playerName.trim()) return;

        const newRecord: HighScore = {
            playerName: String(playerName).trim().toUpperCase(),
            score: Number(stats.score) || 0, 
            maxCombo: Number(stats.maxCombo) || 0, 
            missCount: Number(stats.miss) || 0,
            timestamp: Date.now()
        };

        const storageKey = getStorageKey(fileName);
        
        try {
            const jsonString = JSON.stringify(newRecord);
            localStorage.setItem(storageKey, jsonString);
            setHighScoreData(newRecord);
            setNameSaved(true);
            setIsNewRecord(false);
        } catch (e) {
            console.error("Failed to save high score:", e);
            alert("Could not save score. Storage might be full or data is invalid.");
        }
    };

    const getRankColor = (r: string) => {
        if (r.includes('S')) return 'text-yellow-400 drop-shadow-[0_0_30px_rgba(250,204,21,0.8)]';
        switch(r) {
            case 'A': return 'text-cyan-400 drop-shadow-[0_0_30px_rgba(34,211,238,0.8)]';
            case 'B': return 'text-green-400 drop-shadow-[0_0_20px_rgba(74,222,128,0.6)]';
            case 'C': return 'text-blue-400';
            case 'D': return 'text-orange-400';
            default: return 'text-gray-500';
        }
    };

    const isFullCombo = stats.miss === 0 && stats.score > 0;
    const isWin = opponentStats ? stats.score > opponentStats.score : true;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-2 md:p-4 overflow-y-auto">
            {/* Background Texture */}
            <div className="fixed inset-0 opacity-20 pointer-events-none">
                 <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-800 via-slate-950 to-black"></div>
                 <div className="absolute inset-0 pattern-grid-lg opacity-30"></div>
            </div>

            {/* MAIN CONTENT CONTAINER */}
            <div className="relative w-full max-w-6xl h-auto md:h-auto lg:h-[80vh] flex flex-col md:flex-row shadow-[0_0_50px_rgba(0,0,0,0.8)] bg-slate-900/95 backdrop-blur-xl border border-slate-700 rounded-lg overflow-hidden shrink-0 my-auto min-h-0">
                
                {/* DECORATIVE BARS */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent z-10"></div>
                <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-500 to-transparent z-10"></div>

                {/* LEFT PANEL: RANK & TITLE */}
                <div className="w-full md:w-[40%] relative flex flex-col justify-center items-center p-4 md:p-8 border-b md:border-b-0 md:border-r border-slate-700/50 bg-gradient-to-br from-slate-800/50 to-transparent min-h-[180px] md:min-h-0">
                    
                    {/* Song Name Badge */}
                    <div className="absolute top-2 left-2 md:top-6 md:left-6 z-10">
                         <div className="flex items-center gap-2">
                             <div className="w-1 h-6 bg-cyan-500"></div>
                             <div>
                                 <div className="text-[9px] md:text-[10px] text-cyan-400 font-mono tracking-widest uppercase">TRACK COMPLETE</div>
                                 <div className={`text-sm md:text-lg text-white font-bold tracking-wider max-w-[200px] truncate ${fontClass}`}>{fileName || "UNKNOWN TRACK"}</div>
                             </div>
                         </div>
                     </div>

                    {/* THE RANK */}
                    <div className={`transform transition-all duration-500 flex flex-col items-center mt-6 md:mt-0 ${showRank ? 'scale-100 opacity-100 translate-y-0' : 'scale-150 opacity-0 translate-y-10'}`}>
                        <h2 className={`text-lg md:text-2xl text-slate-400 font-black italic tracking-[0.5em] mb-0 md:mb-4 ${fontClass}`}>{opponentStats ? (isWin ? "VICTORY" : "DEFEAT") : t.MISSION_RESULTS}</h2>
                        <div className={`text-7xl md:text-[9rem] lg:text-[11rem] leading-[1.0] md:leading-[0.8] font-black font-display italic ${getRankColor(rank)}`}>
                            {rank}
                        </div>
                        
                        {/* Full Combo Badge */}
                        {isFullCombo && showRank && (
                            <div className="mt-2 md:mt-8 animate-bounce-short">
                                <div className="inline-block px-4 py-1 md:px-6 md:py-2 bg-gradient-to-r from-yellow-500 via-amber-300 to-yellow-500 text-black font-black text-sm md:text-xl italic transform -skew-x-12 shadow-[0_0_20px_rgba(251,191,36,0.6)]">
                                    FULL COMBO
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT PANEL: STATS & DATA */}
                <div className="flex-1 flex flex-col p-4 md:p-10 justify-center relative bg-black/20 overflow-y-auto">
                    
                    {/* Main Score */}
                    <div className="mb-4 md:mb-10 text-center md:text-left flex justify-between items-end">
                        <div>
                            <div className={`text-xs md:text-sm text-cyan-500 font-bold tracking-[0.3em] mb-1 md:mb-2 ${fontClass}`}>{t.TOTAL_SCORE}</div>
                            <div className="text-4xl md:text-6xl font-mono font-bold text-white tracking-tight drop-shadow-md">
                                {displayScore.toLocaleString()}
                            </div>
                        </div>
                        {opponentStats && (
                            <div className="text-right opacity-80">
                                <div className={`text-xs md:text-sm text-red-500 font-bold tracking-[0.3em] mb-1 md:mb-2 ${fontClass}`}>{opponentStats.name}</div>
                                <div className="text-2xl md:text-4xl font-mono font-bold text-slate-300 tracking-tight">
                                    {opponentDisplayScore.toLocaleString()}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Stats Grid */}
                    <div className="space-y-1 md:space-y-4 mb-4 md:mb-8">
                         {/* Perfect */}
                         <div className="flex items-center justify-between border-b border-slate-800 pb-1 md:pb-2">
                             <div className="flex items-center gap-2">
                                 <div className="w-2 h-2 bg-cyan-400 rounded-full"></div>
                                 <span className="text-slate-300 font-bold tracking-wider text-xs md:text-base">PERFECT</span>
                             </div>
                             <span className="text-base md:text-xl font-mono text-cyan-400">{stats.perfect}</span>
                         </div>
                         {/* Good */}
                         <div className="flex items-center justify-between border-b border-slate-800 pb-1 md:pb-2">
                             <div className="flex items-center gap-2">
                                 <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                                 <span className="text-slate-300 font-bold tracking-wider text-xs md:text-base">GOOD</span>
                             </div>
                             <span className="text-base md:text-xl font-mono text-green-400">{stats.good}</span>
                         </div>
                         {/* Miss */}
                         <div className="flex items-center justify-between border-b border-slate-800 pb-1 md:pb-2">
                             <div className="flex items-center gap-2">
                                 <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                                 <span className="text-slate-300 font-bold tracking-wider text-xs md:text-base">MISS</span>
                             </div>
                             <span className="text-base md:text-xl font-mono text-red-400">{stats.miss}</span>
                         </div>
                         {/* Max Combo */}
                         <div className="flex items-center justify-between border-b border-slate-800 pb-1 md:pb-2 mt-2 md:mt-4">
                             <span className={`text-yellow-500 font-bold tracking-wider text-xs md:text-base ${fontClass}`}>{t.COMBO}</span>
                             <span className="text-lg md:text-2xl font-display italic text-yellow-400">{stats.maxCombo}</span>
                         </div>
                    </div>

                    {/* Record Handling */}
                    {!opponentStats && isNewRecord && !nameSaved ? (
                         <div className="bg-gradient-to-r from-cyan-900/40 to-transparent border-l-4 border-cyan-500 p-2 md:p-4 mb-4 md:mb-8 animate-pulse-slow rounded-r">
                            <div className={`text-cyan-400 font-bold mb-2 flex items-center gap-2 text-xs md:text-base ${fontClass}`}>
                                <span className="text-lg">★</span> {t.NEW_RECORD}
                            </div>
                            <div className="flex gap-2 flex-col md:flex-row">
                                <input 
                                    type="text"
                                    maxLength={10}
                                    autoFocus
                                    placeholder="NAME"
                                    value={playerName}
                                    onChange={(e) => setPlayerName(e.target.value)}
                                    className={`bg-black/50 border border-slate-600 text-white px-3 py-2 font-mono outline-none focus:border-cyan-500 w-full text-sm ${fontClass}`}
                                />
                                <button 
                                    onClick={handleSaveName}
                                    className={`bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 font-bold uppercase transition-colors text-sm rounded ${fontClass}`}
                                >
                                    {t.SAVE}
                                </button>
                            </div>
                         </div>
                    ) : !opponentStats && highScoreData ? (
                        <div className="flex justify-between items-center text-xs md:text-sm font-mono text-slate-500 mb-4 md:mb-8 border border-slate-800 p-2 rounded bg-black/20">
                            <span>TOP: {highScoreData.playerName}</span>
                            <span>{highScoreData.score.toLocaleString()}</span>
                        </div>
                    ) : null}

                    {/* Action Buttons */}
                    <div className="flex gap-3 md:gap-4 mt-auto">
                        {!opponentStats && (
                            <button 
                                onClick={onRestart}
                                className={`flex-1 relative group h-12 md:h-14 bg-slate-800 border-2 border-slate-600 hover:border-cyan-400 transform hover:-translate-y-1 transition-all duration-200 overflow-hidden rounded ${fontClass}`}
                            >
                                <div className="absolute inset-0 bg-cyan-600 translate-y-full group-hover:translate-y-0 transition-transform duration-200"></div>
                                <div className="relative h-full flex items-center justify-center space-x-2 group-hover:text-white text-slate-300 font-black tracking-widest text-sm md:text-lg">
                                    <span>↺</span> <span>{t.RETRY}</span>
                                </div>
                            </button>
                        )}
                        
                        <button 
                            onClick={onMenu}
                            className={`flex-1 relative group h-12 md:h-14 bg-slate-800 border-2 border-slate-600 hover:border-purple-400 transform hover:-translate-y-1 transition-all duration-200 overflow-hidden rounded ${fontClass}`}
                        >
                             <div className="absolute inset-0 bg-purple-600 translate-y-full group-hover:translate-y-0 transition-transform duration-200"></div>
                            <div className="relative h-full flex items-center justify-center space-x-2 group-hover:text-white text-slate-300 font-black tracking-widest text-sm md:text-lg">
                                <span>≡</span> <span>{opponentStats ? "LOBBY" : t.MENU}</span>
                            </div>
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
};
