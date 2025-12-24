import React, { memo } from 'react';
import { Note as NoteType, LaneColor, Theme, GameModifiers } from '../types';

interface NoteProps {
    note: NoteType;
    totalLanes: number;
    color: LaneColor;
    theme: Theme;
    isOverdrive?: boolean;
    modifiers?: GameModifiers;
}

export const Note: React.FC<NoteProps> = memo(({ note, totalLanes, color, theme, isOverdrive, modifiers }) => {
    const widthPerc = 100 / totalLanes;
    const leftPos = `${note.laneIndex * widthPerc}%`;
    const showHighlight = theme.noteShape === 'rect' || theme.noteShape === 'square';
    
    let opacity = 1;
    if (modifiers) {
        if (modifiers.hidden) {
            if (note.y > 50) opacity = 0;
            else opacity = Math.max(0, 1 - ((note.y - 40) / 10)); 
        } else if (modifiers.sudden) {
            const threshold = 25;
            if (note.y < threshold) opacity = 0;
            else opacity = Math.min(1, (note.y - threshold) / 10);
        }
    }

    // Fixed: Always use standard lane colors even in Overdrive to reduce lag and improve visibility
    const colorClass = `${color.bg} ${color.noteShadow}`;
    let shapeClass = '';
    let innerContent = null;

    switch (theme.noteShape) {
        case 'circle':
            shapeClass = `rounded-full ${colorClass}`;
            break;
        case 'diamond':
            shapeClass = `rotate-45 scale-75 ${colorClass} rounded-sm`;
            break;
        case 'arrow':
            shapeClass = color.bg;
            break;
        case 'hex':
            shapeClass = `${colorClass}`;
            break;
        case 'star':
            shapeClass = `flex items-center justify-center text-2xl ${color.text} drop-shadow-md`;
            innerContent = '★';
            break;
        default: 
            shapeClass = `rounded-[2px] ${colorClass}`;
            break;
    }

    if (note.isHold) {
        const holdLength = (note as any).length || 0;
        const holdContainerStyle: React.CSSProperties = {
            left: leftPos,
            top: `${note.y - holdLength}%`,
            height: `${holdLength}%`,
            width: `${widthPerc}%`,
            position: 'absolute',
            zIndex: 15,
            opacity: opacity,
            padding: '0 2px', 
            display: 'flex',
            flexDirection: 'column'
        };
        
        // Fixed: Use standard lane colors for hold notes in Overdrive
        const barColor = `bg-${color.base}-600`;
        const borderColor = `border-${color.base}-400`;
        
        return (
            <div style={holdContainerStyle} className="pointer-events-none">
                <div className={`w-full h-full ${barColor} border-x-2 ${borderColor} rounded-sm relative overflow-hidden flex flex-col shadow-md`}>
                    <div className={`w-full h-[4px] bg-${color.base}-400`}></div>
                    <div className="flex-1 w-full relative">
                        {note.holding && <div className={`absolute inset-0 bg-white/40 animate-pulse`}></div>}
                        <div className={`absolute left-1/2 top-0 bottom-0 w-[2px] bg-${color.base}-400/50 -translate-x-1/2`}></div>
                    </div>
                    <div className={`w-full h-[4px] bg-${color.base}-400`}></div>
                </div>
                {note.holding && <div className={`absolute bottom-0 left-0 right-0 h-16 bg-${color.base}-400/60 blur-xl`}></div>}
            </div>
        );
    }

    const containerStyle: React.CSSProperties = {
        left: leftPos, 
        top: `${note.y}%`, 
        width: `${widthPerc}%`,
        height: '3%', 
        opacity: opacity,
        position: 'absolute',
        zIndex: 20,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0 2px'
    };

    if (theme.noteShape === 'hex' || theme.noteShape === 'circle' || theme.noteShape === 'diamond' || theme.noteShape === 'star') {
        containerStyle.height = '4%';
    }

    const getNoteExtraStyles = () => {
        // Fixed: Removed white drop shadow from arrow notes in Overdrive
        if (theme.noteShape === 'arrow') return { clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)', filter: `drop-shadow(0 0 10px ${color.base})` };
        if (theme.noteShape === 'hex') return { clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)' };
        return {};
    };

    return (
        <div className="absolute z-20 px-[2px] flex justify-center items-center pointer-events-none" style={containerStyle}>
            <div className={`w-full h-full relative ${shapeClass}`} style={getNoteExtraStyles()}>
                {showHighlight && <div className="absolute inset-x-0 top-0 h-[40%] bg-white/60 w-full"></div>}
                {innerContent}
            </div>
        </div>
    );
});