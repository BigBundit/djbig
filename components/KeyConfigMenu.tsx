
import React, { useState, useEffect } from 'react';
import { KeyMapping, LaneConfig, AudioSettings, LayoutSettings } from '../types';
import { LANE_CONFIGS_4, LANE_CONFIGS_5, LANE_CONFIGS_7 } from '../constants';

interface KeyConfigMenuProps {
    currentKeyMode: 4 | 5 | 7;
    mappings: KeyMapping;
    audioSettings: AudioSettings;
    onAudioSettingsChange: (settings: AudioSettings) => void;
    layoutSettings: LayoutSettings;
    onLayoutSettingsChange: (settings: LayoutSettings) => void;
    onSave: (newMappings: KeyMapping) => void;
    onClose: () => void;
    t: any;
    fontClass: string;
}

export const KeyConfigMenu: React.FC<KeyConfigMenuProps> = ({ 
    currentKeyMode, 
    mappings, 
    audioSettings,
    onAudioSettingsChange,
    layoutSettings,
    onLayoutSettingsChange,
    onSave, 
    onClose,
    t,
    fontClass
}) => {
    const [localMappings, setLocalMappings] = useState<KeyMapping>(JSON.parse(JSON.stringify(mappings)));
    const [activeMode, setActiveMode] = useState<4 | 5 | 7>(currentKeyMode);
    const [bindingIndex, setBindingIndex] = useState<number | null>(null);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

    useEffect(() => {
        setIsFullscreen(!!document.fullscreenElement);
        const handleFsChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFsChange);
        return () => document.removeEventListener('fullscreenchange', handleFsChange);
    }, []);

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
            const currentKeys = localMappings[activeMode];
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
         setLocalMappings({
            4: ['d', 'f', 'j', 'k'],
            5: ['d', 'f', ' ', 'j', 'k'],
            7: ['s', 'd', 'f', ' ', 'j', 'k', 'l']
         });
    };

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`Error enabling full-screen mode: ${err.message}`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    const handleVolumeChange = (type: 'master' | 'sfx', value: number) => {
        onAudioSettingsChange({
            ...audioSettings,
            [type === 'master' ? 'masterVolume' : 'sfxVolume']: value
        });
    };

    const activeConfig = getBaseConfig(activeMode);
    const currentBoundKeys = localMappings[activeMode];

    // Helper Component for Sci-Fi Sliders
    const CyberSlider = ({ label, value, onChange }: { label: string, value: number, onChange: (v: number) => void }) => (
        <div className="w-full">
            <div className="flex justify-between items-center mb-1">
                <span className={`text-xs font-bold text-cyan-500 tracking-wider ${fontClass}`}>{label}</span>
                <span className="text-cyan-400 font-mono text-xs bg-black/50 px-2 rounded border border-cyan-500/30">
                    {Math.round(value * 100)}%
                </span>
            </div>
            <div className="relative h-6 w-full flex items-center group">
                {/* Track Background */}
                <div className="absolute w-full h-2 bg-slate-800 border border-slate-600 skew-x-[-10deg]"></div>
                {/* Filled Track */}
                <div 
                    className="absolute h-2 bg-cyan-500 shadow-[0_0_10px_cyan] skew-x-[-10deg] transition-all duration-75" 
                    style={{ width: `${value * 100}%` }}
                ></div>
                {/* Input */}
                <input 
                    type="range" min="0" max="1" step="0.05" 
                    value={value}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="absolute w-full h-full opacity-0 cursor-pointer"
                />
            </div>
        </div>
    );

    // Helper for Toggles
    const CyberToggle = ({ label, isActive, onClick, subLabels }: { label: string, isActive: boolean, onClick: () => void, subLabels?: [string, string] }) => (
        <div className="flex justify-between items-center bg-slate-800/40 p-2 rounded border-l-2 border-slate-600 hover:border-cyan-400 hover:bg-slate-800/60 transition-colors">
            <div className={`text-slate-300 font-bold text-sm ${fontClass}`}>{label}</div>
            <button
                onClick={onClick}
                className={`
                    relative w-14 h-6 transition-all duration-300 transform skew-x-[-10deg] border
                    ${isActive ? 'bg-cyan-900/50 border-cyan-500' : 'bg-slate-900 border-slate-600'}
                `}
            >
                <div className={`
                    absolute top-0.5 bottom-0.5 w-6 bg-current transition-all duration-300 shadow-md
                    ${isActive ? 'right-0.5 bg-cyan-400 shadow-[0_0_10px_cyan]' : 'left-0.5 bg-slate-500'}
                `}></div>
                {subLabels && (
                    <div className="absolute inset-0 flex items-center justify-between px-1 pointer-events-none">
                        <span className={`text-[8px] font-bold ${!isActive ? 'text-white' : 'text-slate-600'} ${fontClass}`}>{subLabels[0]}</span>
                        <span className={`text-[8px] font-bold ${isActive ? 'text-white' : 'text-slate-600'} ${fontClass}`}>{subLabels[1]}</span>
                    </div>
                )}
            </button>
        </div>
    );

    return (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in p-4 lg:p-10">
            {/* MAIN HUD CONTAINER */}
            <div className="relative w-full max-w-5xl h-full lg:h-auto lg:max-h-[90vh] flex flex-col bg-slate-900/90 border border-slate-700 shadow-[0_0_100px_rgba(6,182,212,0.1)] overflow-hidden">
                
                {/* DECORATIVE CORNERS */}
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-cyan-500 z-10"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-cyan-500 z-10"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-cyan-500 z-10"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-cyan-500 z-10"></div>
                
                {/* HEADER */}
                <div className="relative w-full h-16 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-cyan-500/30 flex items-center justify-between px-6 flex-shrink-0">
                     <div className="flex items-center gap-4">
                        <div className="w-3 h-3 bg-cyan-500 animate-pulse rounded-full"></div>
                        <div>
                            <h2 className={`text-2xl font-black italic text-white tracking-widest ${fontClass} drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]`}>
                                {t.SYSTEM_SETTINGS}
                            </h2>
                            <div className="text-[10px] font-mono text-cyan-600 tracking-[0.5em]">CONFIG_MODULE_V2</div>
                        </div>
                     </div>
                </div>

                {/* CONTENT GRID */}
                <div className="flex-1 overflow-y-auto lg:overflow-visible grid grid-cols-1 lg:grid-cols-12 gap-0 lg:divide-x divide-slate-700/50">
                    
                    {/* LEFT COLUMN: DISPLAY & AUDIO (5 Cols) */}
                    <div className="lg:col-span-5 p-6 space-y-8 bg-gradient-to-b from-slate-900 to-slate-900/50">
                        
                        {/* SECTION: DISPLAY */}
                        <div className="space-y-4">
                             <div className="flex items-center gap-2 border-b border-slate-700 pb-2 mb-4">
                                <span className="text-cyan-500 text-lg">■</span>
                                <h3 className={`text-white font-bold tracking-wider ${fontClass}`}>{t.DISPLAY}</h3>
                             </div>

                             <div className="space-y-3">
                                <CyberToggle 
                                    label={t.FULL_SCREEN} 
                                    isActive={isFullscreen} 
                                    onClick={toggleFullScreen} 
                                />
                                <CyberToggle 
                                    label={t.MENU_BG} 
                                    isActive={!!layoutSettings.enableMenuBackground} 
                                    onClick={() => onLayoutSettingsChange({...layoutSettings, enableMenuBackground: !layoutSettings.enableMenuBackground})} 
                                />
                                <CyberToggle 
                                    label={t.LANGUAGE} 
                                    isActive={layoutSettings.language === 'en'} 
                                    onClick={() => onLayoutSettingsChange({...layoutSettings, language: layoutSettings.language === 'en' ? 'th' : 'en'})}
                                    subLabels={['TH', 'EN']}
                                />
                             </div>

                             {/* LANE POSITION GRAPHICAL */}
                             <div className="mt-4">
                                <div className={`text-xs font-bold text-slate-400 mb-2 ${fontClass}`}>{t.LANE_POS}</div>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['left', 'center', 'right'] as const).map((pos) => {
                                        const active = layoutSettings.lanePosition === pos;
                                        return (
                                            <button
                                                key={pos}
                                                onClick={() => onLayoutSettingsChange({...layoutSettings, lanePosition: pos})}
                                                className={`
                                                    h-16 border rounded bg-slate-800/50 relative overflow-hidden group transition-all
                                                    ${active ? 'border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.2)]' : 'border-slate-700 hover:border-slate-500'}
                                                `}
                                            >
                                                {/* Mini UI Representation */}
                                                <div className={`absolute top-2 bottom-2 w-2 bg-slate-600 group-hover:bg-slate-500 transition-colors
                                                    ${pos === 'left' ? 'left-2' : pos === 'right' ? 'right-2' : 'left-1/2 -translate-x-1/2'}
                                                    ${active ? 'bg-cyan-500 shadow-[0_0_10px_cyan]' : ''}
                                                `}></div>
                                                <div className={`absolute bottom-1 w-full text-[8px] font-bold uppercase ${active ? 'text-cyan-400' : 'text-slate-500'}`}>
                                                    {pos}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                             </div>
                        </div>

                        {/* SECTION: AUDIO */}
                        <div className="space-y-4">
                             <div className="flex items-center gap-2 border-b border-slate-700 pb-2 mb-4">
                                <span className="text-yellow-500 text-lg">■</span>
                                <h3 className={`text-white font-bold tracking-wider ${fontClass}`}>{t.AUDIO}</h3>
                             </div>
                             
                             <div className="space-y-6">
                                <CyberSlider 
                                    label={t.MASTER_VOL} 
                                    value={audioSettings.masterVolume} 
                                    onChange={(v) => handleVolumeChange('master', v)} 
                                />
                                <CyberSlider 
                                    label={t.SFX_VOL} 
                                    value={audioSettings.sfxVolume} 
                                    onChange={(v) => handleVolumeChange('sfx', v)} 
                                />
                             </div>
                        </div>

                        {/* Resolution Setting - NEW */}
                        <div className="space-y-4">
                             <div className="flex items-center gap-2 border-b border-slate-700 pb-2 mb-4">
                                <span className="text-purple-500 text-lg">■</span>
                                <h3 className={`text-white font-bold tracking-wider ${fontClass}`}>RESOLUTION</h3>
                             </div>
                             {/* Since specific resolution props weren't passed in this snippet, adding a placeholder or assuming generic logic */}
                             <div className="p-2 bg-slate-800/30 rounded border border-slate-700 text-center text-xs text-slate-500 font-mono">
                                AUTO-DETECTED
                             </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: CONTROLS (7 Cols) */}
                    <div className="lg:col-span-7 p-6 bg-slate-950/50 flex flex-col relative">
                         {/* Background Grid */}
                         <div className="absolute inset-0 opacity-10" 
                              style={{ backgroundImage: 'linear-gradient(slate-700 1px, transparent 1px), linear-gradient(90deg, slate-700 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
                         </div>

                         <div className="relative z-10 flex-1 flex flex-col">
                            <div className="flex items-center justify-between border-b-2 border-slate-700 pb-4 mb-6">
                                <h3 className={`text-2xl text-white font-black italic tracking-widest ${fontClass}`}>{t.CONTROLS}</h3>
                                <div className="flex space-x-2">
                                    {[4, 5, 7].map((mode) => (
                                        <button
                                            key={mode}
                                            onClick={() => { setActiveMode(mode as 4|5|7); setBindingIndex(null); }}
                                            className={`
                                                px-4 py-1 text-sm font-bold font-display skew-x-[-10deg] transition-all border
                                                ${activeMode === mode 
                                                    ? 'bg-cyan-600 border-cyan-400 text-white shadow-[0_0_15px_cyan]' 
                                                    : 'bg-slate-800 border-slate-600 text-slate-500 hover:text-white hover:border-slate-400'}
                                            `}
                                        >
                                            <span className="skew-x-[10deg] inline-block">{mode}K MODE</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* KEY VISUALIZER AREA */}
                            <div className="flex-1 flex flex-col items-center justify-center min-h-[300px] border border-slate-800 bg-slate-900/80 rounded-lg relative overflow-hidden p-8 shadow-inner">
                                {/* Decor */}
                                <div className="absolute top-4 left-4 text-[10px] font-mono text-cyan-700">INPUT_DIAGNOSTIC_TOOL</div>
                                <div className="absolute bottom-4 right-4 text-[10px] font-mono text-cyan-700">STATUS: CALIBRATING</div>
                                
                                {/* Keys Container */}
                                <div className="flex items-end justify-center w-full h-40 gap-1 md:gap-2">
                                    {activeConfig.map((lane, idx) => {
                                        const isBinding = bindingIndex === idx;
                                        const keyLabel = currentBoundKeys[idx] === ' ' ? 'SPC' : currentBoundKeys[idx].toUpperCase();
                                        
                                        return (
                                            <button 
                                                key={idx}
                                                onClick={() => setBindingIndex(idx)}
                                                className={`
                                                    relative group flex-1 max-w-[80px] h-full flex flex-col justify-end items-center 
                                                    transition-all duration-200
                                                `}
                                            >
                                                {/* Lane Beam */}
                                                <div className={`
                                                    absolute bottom-0 w-full transition-all duration-300
                                                    ${isBinding ? `h-full bg-${lane.color.base}-500/20` : 'h-1/3 bg-slate-800/30 group-hover:h-1/2'}
                                                `}></div>

                                                {/* Key Cap */}
                                                <div className={`
                                                    relative z-10 w-full aspect-square flex items-center justify-center
                                                    border-2 rounded transition-all duration-200
                                                    ${isBinding 
                                                        ? 'bg-cyan-500 text-black border-white scale-110 shadow-[0_0_20px_cyan]' 
                                                        : `bg-slate-900 text-slate-400 border-slate-700 group-hover:border-${lane.color.base}-500 group-hover:text-white`}
                                                `}>
                                                    <span className="text-xl md:text-2xl font-black font-mono">
                                                        {isBinding ? '?' : keyLabel}
                                                    </span>
                                                </div>

                                                {/* Label */}
                                                <div className="mt-2 text-[10px] font-bold text-slate-600 font-mono group-hover:text-cyan-400">
                                                    TRK_{idx + 1}
                                                </div>
                                                
                                                {/* Connection Line */}
                                                <div className={`
                                                    absolute bottom-12 w-[1px] bg-slate-700 h-20 -z-10
                                                    ${isBinding ? 'bg-cyan-400 shadow-[0_0_10px_cyan]' : ''}
                                                `}></div>
                                            </button>
                                        );
                                    })}
                                </div>
                                
                                {bindingIndex !== null && (
                                    <div className={`mt-8 text-cyan-400 font-bold animate-pulse text-lg ${fontClass}`}>
                                        [{t.PRESS_KEY}]
                                    </div>
                                )}
                            </div>

                            <div className="mt-6 flex gap-4">
                                <button 
                                    onClick={resetToDefault}
                                    className={`
                                        flex-1 py-4 border border-red-900/50 bg-red-900/10 hover:bg-red-900/30 hover:border-red-500
                                        text-red-400 font-bold tracking-widest uppercase rounded clip-path-angle transition-all ${fontClass}
                                    `}
                                    style={{ clipPath: 'polygon(10% 0, 100% 0, 100% 100%, 0 100%, 0 25%)' }}
                                >
                                    {t.RESET}
                                </button>
                                <button 
                                    onClick={handleSave}
                                    className={`
                                        flex-[2] py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500
                                        text-white font-black tracking-widest uppercase rounded shadow-[0_0_20px_rgba(6,182,212,0.4)]
                                        transform hover:-translate-y-1 transition-all ${fontClass}
                                    `}
                                    style={{ clipPath: 'polygon(0 0, 100% 0, 100% 75%, 90% 100%, 0 100%)' }}
                                >
                                    {t.SAVE_CLOSE}
                                </button>
                            </div>
                         </div>
                    </div>
                </div>
                
                {/* FOOTER DECOR */}
                <div className="h-2 w-full bg-slate-900 border-t border-slate-700 flex">
                    <div className="w-1/3 h-full bg-cyan-900/50"></div>
                    <div className="w-1/3 h-full bg-transparent"></div>
                    <div className="w-1/3 h-full bg-cyan-900/50"></div>
                </div>

            </div>
        </div>
    );
};
