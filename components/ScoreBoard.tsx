
import React from 'react';

interface ScoreBoardProps {
    score: number;
    combo: number;
    health: number;
    maxCombo: number;
}

export const ScoreBoard: React.FC<ScoreBoardProps> = ({ score, combo, health, maxCombo }) => {
    return (
        <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start z-30 pointer-events-none">
            {/* Left: Health */}
            <div className="w-64 space-y-1">
                <div className="flex justify-between text-xs text-cyan-400 font-display tracking-widest">
                    <span>INTEGRITY</span>
                    <span>{Math.round(health)}%</span>
                </div>
                <div className="w-full h-4 bg-slate-900 border border-cyan-900 skew-x-12 overflow-hidden">
                    <div 
                        className={`h-full transition-all duration-200 ${health < 30 ? 'bg-red-500 animate-pulse' : 'bg-cyan-500'}`}
                        style={{ width: `${health}%` }}
                    ></div>
                </div>
            </div>

            {/* Center: Combo */}
            <div className="flex flex-col items-center">
                <div className={`text-6xl font-black font-display italic tracking-tighter transition-all duration-100 ${combo > 10 ? 'text-yellow-400 scale-110 drop-shadow-[0_0_15px_rgba(250,204,21,0.6)]' : 'text-slate-600'}`}>
                    {combo}
                </div>
                {combo > 0 && (
                    <div className="text-sm font-bold text-white tracking-widest bg-slate-800 px-2 rounded whitespace-nowrap">
                        COMBO LINK
                    </div>
                )}
            </div>

            {/* Right: Score */}
            <div className="w-64 text-right space-y-1">
                <div className="text-xs text-cyan-400 font-display tracking-widest">
                    SCORE
                </div>
                <div className="text-4xl font-bold font-mono text-white tabular-nums glow-text">
                    {score.toString().padStart(7, '0')}
                </div>
            </div>
        </div>
    );
};
