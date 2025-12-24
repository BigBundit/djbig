
import React, { memo } from 'react';
import { LaneConfig, Theme } from '../types';

interface LaneProps {
    config: LaneConfig;
    active: boolean;
    onTrigger: () => void;
    onRelease: () => void;
    theme: Theme;
    isOverdrive?: boolean;
}

export const Lane: React.FC<LaneProps> = memo(({ config, active, onTrigger, onRelease, theme, isOverdrive }) => {
    const hitGradient = `from-${config.color.base}-500/60`;
    const bgGradient = active 
        ? `bg-gradient-to-t ${hitGradient} to-transparent`
        : 'bg-transparent';
        
    const renderReceptor = () => {
        if (theme.id === 'ignore') {
            const buttonBase = `absolute bottom-2 left-1 right-1 h-20 transition-all duration-75 rounded-lg flex items-center justify-center border-b-4 shadow-lg z-30`;
            let appearanceClasses = '';
            if (isOverdrive) {
                 appearanceClasses = `bg-amber-400 border-white/40 ${active ? 'translate-y-1 brightness-125' : 'opacity-100'}`;
            } else {
                 appearanceClasses = `bg-gradient-to-b from-slate-600 to-slate-900 ${active ? `border-${config.color.base}-400 translate-y-1 shadow-inner bg-opacity-100` : 'border-slate-500 bg-opacity-80 border-black/30'}`;
            }
            return (
                <div className={`${buttonBase} ${appearanceClasses}`}>
                    {!isOverdrive && <div className={`w-full h-full absolute inset-0 rounded-lg opacity-30 ${active ? `bg-${config.color.base}-500` : ''}`}></div>}
                    <div className="absolute top-0 left-0 right-0 h-1/2 bg-white/5 rounded-t-lg"></div>
                    {isOverdrive && <div className="absolute inset-0 bg-white/10 pointer-events-none"></div>}
                </div>
            );
        } else if (theme.id === 'titan') {
            const borderColor = isOverdrive ? 'border-amber-400' : (active ? `border-${config.color.base}-500` : 'border-slate-600');
            const glowColor = isOverdrive ? 'bg-amber-300' : (active ? `bg-${config.color.base}-500 shadow-[0_0_15px_currentColor]` : 'bg-slate-800');
            return (
                <div className={`absolute bottom-4 left-1 right-1 h-16 flex items-end justify-center transition-all duration-75 z-30 ${active ? 'scale-95' : ''}`}>
                    <div className={`absolute left-0 bottom-0 h-full w-2 border-l-4 border-b-4 border-t-2 ${borderColor} rounded-bl`}></div>
                    <div className={`absolute right-0 bottom-0 h-full w-2 border-r-4 border-b-4 border-t-2 ${borderColor} rounded-br`}></div>
                    <div className={`absolute bottom-1 left-2 right-2 h-2 ${glowColor}`}></div>
                </div>
            );
        } else if (theme.id === 'queen') {
             const bgClass = isOverdrive ? 'bg-amber-500 border-white' : (active ? 'border-pink-400 bg-pink-600' : 'border-pink-900 bg-slate-900');
             const shadowClass = isOverdrive ? 'shadow-[0_0_15px_rgba(251,191,36,0.5)]' : (active ? 'shadow-[0_0_30px_rgba(236,72,153,1)]' : 'shadow-[0_0_15px_rgba(236,72,153,0.3)]');
            return (
                <div className={`absolute bottom-3 left-1 right-1 h-16 flex items-end justify-center transition-all duration-75 z-30`}>
                    <div className={`relative w-full rounded-md border-b-4 transition-all duration-75 flex items-center justify-center overflow-hidden ${active ? 'h-14 translate-y-1' : 'h-14'} ${bgClass} ${shadowClass}`}>
                        {!isOverdrive && <div className={`absolute inset-0 bg-gradient-to-b ${active ? 'from-pink-400 to-pink-600' : 'from-slate-800 to-slate-900'}`}></div>}
                        <div className={`absolute inset-2 rounded blur-sm transition-opacity duration-75 ${active || isOverdrive ? 'bg-white opacity-40' : 'bg-pink-500 opacity-10'}`}></div>
                        <div className="absolute top-0 inset-x-0 h-1/2 bg-white/5 rounded-t-md"></div>
                    </div>
                </div>
            );
        } else {
            const lineClass = isOverdrive ? 'bg-amber-400 shadow-[0_0_10px_white]' : (active ? `bg-${config.color.base}-400 shadow-[0_0_20px_rgba(255,255,255,0.8)]` : `bg-slate-600/50 border-x border-${config.color.base}-500/30`);
            return (
                <div className={`absolute bottom-0 left-0 w-full h-full flex flex-col justify-end pointer-events-none z-30`}>
                    <div className={`w-full h-2 transition-all duration-75 ${lineClass}`}></div>
                </div>
            );
        }
    };

    return (
        <div className={`relative flex-1 h-full border-r border-white/5 last:border-r-0 transition-colors duration-50 ${bgGradient} touch-none select-none`} onPointerDown={(e) => { e.preventDefault(); onTrigger(); }} onPointerUp={(e) => { e.preventDefault(); onRelease(); }} onPointerLeave={(e) => { e.preventDefault(); onRelease(); }}>
            <div className="absolute inset-0 bg-black/20 pointer-events-none"></div>
            {renderReceptor()}
            {active && <div className={`absolute bottom-0 left-0 right-0 top-0 bg-gradient-to-t ${hitGradient} to-transparent opacity-40 pointer-events-none z-10`}></div>}
        </div>
    );
});
