
import React, { useState, useEffect } from 'react';
import { KeyMapping, LaneConfig } from '../types';
import { LANE_CONFIGS_4, LANE_CONFIGS_5, LANE_CONFIGS_7 } from '../constants';

interface KeyConfigMenuProps {
    currentKeyMode: 4 | 5 | 7;
    mappings: KeyMapping;
    onSave: (newMappings: KeyMapping) => void;
    onClose: () => void;
}

export const KeyConfigMenu: React.FC<KeyConfigMenuProps> = ({ currentKeyMode, mappings, onSave, onClose }) => {
    const [localMappings, setLocalMappings] = useState<KeyMapping>(JSON.parse(JSON.stringify(mappings)));
    const [activeMode, setActiveMode] = useState<4 | 5 | 7>(currentKeyMode);
    const [bindingIndex, setBindingIndex] = useState<number | null>(null);

    // Get base config for display purposes (colors, labels)
    const getBaseConfig = (mode: number) => {
        if (mode === 4) return LANE_CONFIGS_4;
        if (mode === 5) return LANE_CONFIGS_5;
        return LANE_CONFIGS_7;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (bindingIndex !== null) {
            e.preventDefault();
            e.stopPropagation();

            const newKey = e.key.toLowerCase();
            
            // Check for duplicates in current mode
            const currentKeys = localMappings[activeMode];
            if (currentKeys.includes(newKey) && currentKeys[bindingIndex] !== newKey) {
                // Optional: Could show error or swap
                // For now, just allow it or maybe block duplicates? 
                // Let's just set it.
            }

            const newKeys = [...currentKeys];
            newKeys[bindingIndex] = newKey === ' ' ? ' ' : newKey;

            setLocalMappings(prev => ({
                ...prev,
                [activeMode]: newKeys
            }));

            setBindingIndex(null);
        }
    };

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [bindingIndex, activeMode, localMappings]);

    const handleSave = () => {
        onSave(localMappings);
        onClose();
    };

    const resetToDefault = () => {
         // Hardcoded defaults from constants
         setLocalMappings({
            4: ['d', 'f', 'j', 'k'],
            5: ['d', 'f', ' ', 'j', 'k'],
            7: ['s', 'd', 'f', ' ', 'j', 'k', 'l']
         });
    };

    const activeConfig = getBaseConfig(activeMode);
    const currentBoundKeys = localMappings[activeMode];

    return (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-2xl bg-slate-900 border border-cyan-500/50 p-8 rounded-xl shadow-[0_0_50px_rgba(6,182,212,0.2)] flex flex-col items-center">
                <h2 className="text-3xl font-display font-bold text-white tracking-wider mb-6">KEY CONFIGURATION</h2>

                {/* Mode Select Tabs */}
                <div className="flex space-x-4 mb-8">
                    {[4, 5, 7].map((mode) => (
                        <button
                            key={mode}
                            onClick={() => { setActiveMode(mode as 4|5|7); setBindingIndex(null); }}
                            className={`px-6 py-2 rounded font-bold font-display transition-all ${
                                activeMode === mode 
                                ? 'bg-cyan-600 text-white shadow-[0_0_15px_rgba(34,211,238,0.5)]' 
                                : 'bg-slate-800 text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {mode} KEYS
                        </button>
                    ))}
                </div>

                {/* Visualizer for Keys */}
                <div className="flex justify-center items-end space-x-2 mb-8 h-40 w-full">
                    {activeConfig.map((lane, idx) => {
                        const isBinding = bindingIndex === idx;
                        const keyLabel = currentBoundKeys[idx] === ' ' ? 'SPACE' : currentBoundKeys[idx].toUpperCase();
                        
                        return (
                            <div 
                                key={idx}
                                onClick={() => setBindingIndex(idx)}
                                className={`
                                    relative h-full flex-1 max-w-[80px] rounded-t border-t border-x border-white/20 cursor-pointer transition-all group
                                    flex flex-col justify-end items-center pb-4
                                    ${isBinding ? 'bg-cyan-500/20 border-cyan-400 animate-pulse' : 'bg-slate-800/50 hover:bg-slate-700'}
                                `}
                            >
                                {/* Lane Color Indicator */}
                                <div className={`absolute top-0 w-full h-2 bg-${lane.color.base}-500/50`}></div>
                                
                                <div className="text-xs text-slate-500 mb-2 font-mono">TRACK {idx + 1}</div>
                                
                                <div className={`
                                    w-12 h-12 flex items-center justify-center rounded border-2 font-bold text-lg
                                    ${isBinding ? 'bg-cyan-500 text-white border-white' : `bg-slate-900 text-white ${lane.color.border}`}
                                `}>
                                    {isBinding ? '?' : keyLabel}
                                </div>

                                {isBinding && (
                                    <div className="absolute -bottom-8 text-cyan-400 text-xs font-bold whitespace-nowrap animate-bounce">PRESS KEY</div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="flex space-x-4 w-full">
                    <button 
                        onClick={resetToDefault}
                        className="flex-1 py-3 border border-red-500/50 text-red-400 hover:bg-red-500/10 rounded font-bold tracking-widest transition-colors"
                    >
                        RESET DEFAULTS
                    </button>
                    <button 
                        onClick={handleSave}
                        className="flex-[2] py-3 bg-cyan-700 hover:bg-cyan-600 text-white rounded font-bold tracking-widest transition-colors shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                    >
                        SAVE & CLOSE
                    </button>
                </div>
            </div>
        </div>
    );
};
