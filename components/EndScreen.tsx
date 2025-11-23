
import React, { useEffect, useState } from 'react';
import { HighScore, GameStats } from '../types';

interface EndScreenProps {
    stats: GameStats;
    fileName: string;
    onRestart: () => void;
    onMenu: () => void;
}

export const EndScreen: React.FC<EndScreenProps> = ({ stats, fileName, onRestart, onMenu }) => {
    const [highScoreData, setHighScoreData] = useState<HighScore | null>(null);
    const [isNewRecord, setIsNewRecord] = useState(false);
    const [playerName, setPlayerName] = useState("");
    const [nameSaved, setNameSaved] = useState(false);
    const [rank, setRank] = useState<string>('');

    // Safe key generation
    const getStorageKey = (fname: string) => {
        const safeName = String(fname || "unknown").replace(/\s+/g, '_');
        return `djbig_hs_${safeName}`;
    };

    useEffect(() => {
        // Calculate Rank based on Accuracy approximation
        // (Perfect * 100 + Good * 50) / Total Potential Score * 100
        // Total Notes approx = perfect + good + miss
        const totalNotes = stats.perfect + stats.good + stats.miss;
        const totalPotential = totalNotes * 100;
        const currentWeighted = (stats.perfect * 100) + (stats.good * 50);
        
        let accuracy = 0;
        if (totalPotential > 0) {
            accuracy = (currentWeighted / totalPotential) * 100;
        }

        let calculatedRank = 'F';
        if (accuracy >= 95) calculatedRank = 'S';
        else if (accuracy >= 90) calculatedRank = 'A';
        else if (accuracy >= 80) calculatedRank = 'B';
        else if (accuracy >= 70) calculatedRank = 'C';
        else if (accuracy >= 60) calculatedRank = 'D';
        
        setRank(calculatedRank);

        // High Score Logic
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
    }, [stats, fileName]);

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
        switch(r) {
            case 'S': return 'text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)]';
            case 'A': return 'text-cyan-400 drop-shadow-[0_0_20px_rgba(34,211,238,0.8)]';
            case 'B': return 'text-green-400';
            case 'C': return 'text-blue-400';
            case 'D': return 'text-orange-400';
            default: return 'text-gray-500';
        }
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md animate-fade-in">
            <div className="max-w-4xl w-full bg-slate-900 border border-cyan-500/30 p-8 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.2)] flex flex-col md:flex-row gap-8 items-center">
                
                {/* LEFT: RANK BIG DISPLAY */}
                <div className="flex-1 flex flex-col items-center justify-center border-r border-white/10 pr-8">
                    <div className="text-sm text-slate-400 tracking-widest font-display mb-4">OVERALL RANK</div>
                    <div className={`text-[10rem] leading-none font-black font-display ${getRankColor(rank)} animate-bounce-short`}>
                        {rank}
                    </div>
                    <div className="mt-4 text-center">
                        <div className="text-xs text-slate-500 mb-1">TOTAL SCORE</div>
                        <div className="text-3xl font-mono font-bold text-white">{stats.score.toLocaleString()}</div>
                    </div>
                </div>

                {/* RIGHT: DETAILED STATS */}
                <div className="flex-[2] flex flex-col space-y-6 w-full">
                    <h2 className="text-3xl font-display font-bold text-white tracking-tighter text-center md:text-left">
                        MISSION RESULTS
                    </h2>
                    
                    <div className="grid grid-cols-2 gap-4 w-full">
                        <div className="bg-slate-800/50 p-3 rounded border border-slate-700 flex justify-between items-center">
                            <span className="text-cyan-200 text-xs tracking-widest">PERFECT</span>
                            <span className="text-xl font-bold text-cyan-400">{stats.perfect}</span>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded border border-slate-700 flex justify-between items-center">
                            <span className="text-green-200 text-xs tracking-widest">GOOD</span>
                            <span className="text-xl font-bold text-green-400">{stats.good}</span>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded border border-slate-700 flex justify-between items-center">
                            <span className="text-red-200 text-xs tracking-widest">MISS</span>
                            <span className="text-xl font-bold text-red-400">{stats.miss}</span>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded border border-slate-700 flex justify-between items-center">
                            <span className="text-yellow-200 text-xs tracking-widest">MAX COMBO</span>
                            <span className="text-xl font-bold text-yellow-400">{stats.maxCombo}</span>
                        </div>
                    </div>

                    {/* NEW RECORD INPUT */}
                    {isNewRecord && !nameSaved && (
                        <div className="w-full bg-cyan-900/30 border border-cyan-500 p-4 rounded-lg text-center animate-pulse-slow mt-4">
                            <h3 className="text-lg font-display font-bold text-yellow-400 mb-2">
                                ★ NEW RECORD HOLDER ★
                            </h3>
                            <div className="flex space-x-2 justify-center">
                                <input 
                                    type="text"
                                    maxLength={10}
                                    placeholder="ENTER NAME"
                                    value={playerName}
                                    onChange={(e) => setPlayerName(e.target.value)}
                                    className="bg-black/50 border-b-2 border-cyan-400 text-center text-xl text-white font-mono p-1 focus:outline-none uppercase w-40"
                                />
                                <button 
                                    onClick={handleSaveName}
                                    className="px-4 py-1 bg-yellow-500 text-black font-bold font-display uppercase text-sm hover:bg-yellow-400 transition-colors rounded"
                                >
                                    SAVE
                                </button>
                            </div>
                        </div>
                    )}

                    {/* LEADERBOARD MINI */}
                    {!isNewRecord && highScoreData && (
                        <div className="w-full bg-black/40 border border-white/10 p-3 rounded flex justify-between items-center px-6">
                            <span className="text-xs font-bold text-slate-400 uppercase">Record Holder</span>
                            <div className="flex items-center space-x-2">
                                <span className="text-lg font-display font-bold text-white">{highScoreData.playerName}</span>
                                <span className="text-sm font-mono text-cyan-400">{highScoreData.score.toLocaleString()}</span>
                            </div>
                        </div>
                    )}

                    <div className="flex space-x-4 mt-4 justify-center md:justify-start">
                        <button 
                            onClick={onRestart}
                            className="px-6 py-3 bg-cyan-700 hover:bg-cyan-600 text-white font-bold tracking-widest transition-colors shadow-[0_0_15px_rgba(6,182,212,0.4)] flex-1 rounded"
                        >
                            RETRY
                        </button>
                        <button 
                            onClick={onMenu}
                            className="px-6 py-3 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white font-bold tracking-widest transition-colors flex-1 rounded"
                        >
                            MENU
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
