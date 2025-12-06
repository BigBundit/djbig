
import React from 'react';
import { Note as NoteType, LaneColor, Theme, GameModifiers } from '../types';

interface NoteProps {
    note: NoteType;
    totalLanes: number;
    color: LaneColor;
    theme: Theme;
    isOverdrive?: boolean;
    modifiers?: GameModifiers;
}

export const Note: React.FC<NoteProps> = ({ note, totalLanes, color, theme, isOverdrive, modifiers }) => {
    const widthPerc = 100 / totalLanes;
    const leftPos = `${note.laneIndex * widthPerc}%`;
    
    // Construct styles
    // We adjust height and visuals based on theme
    
    let shapeClass = '';
    let innerContent = null;
    let opacity = 1;

    // --- MODIFIER LOGIC (VISUALS) ---
    // Updated: Sudden now appears much earlier (at 25% instead of 50%)
    if (modifiers) {
        if (modifiers.hidden) {
            // HIDDEN: Visible Top (0-50%), Invisible Bottom (50-100%)
            if (note.y > 50) {
                opacity = 0;
            } else {
                opacity = Math.max(0, 1 - ((note.y - 40) / 10)); 
            }
        } else if (modifiers.sudden) {
            // SUDDEN: Invisible Top (0-25%), Visible Bottom (25-100%)
            // This gives "another half screen" of visibility compared to 50%
            const threshold = 25;
            if (note.y < threshold) {
                opacity = 0;
            } else {
                 // Fade in quickly
                opacity = Math.min(1, (note.y - threshold) / 10);
            }
        }
    }

    let containerStyle: React.CSSProperties = {
        left: leftPos, 
        top: `${note.y}%`,
        width: `${widthPerc}%`,
        height: '3%', // Default height
        transform: 'translateZ(0)', // Force GPU acceleration
        willChange: 'top, opacity', // Optimize for movement
        opacity: opacity
    };

    const colorClass = `${color.bg} ${color.noteShadow}`;

    switch (theme.noteShape) {
        case 'circle':
            shapeClass = `rounded-full ${colorClass}`;
            containerStyle.height = '4%'; // Slightly taller for circle aspect
            break;
        case 'diamond':
            shapeClass = `rotate-45 scale-75 ${colorClass} rounded-sm`;
            containerStyle.height = '4%';
            break;
        case 'arrow':
            shapeClass = `${color.bg}`;
            // CSS Triangle
            containerStyle.clipPath = 'polygon(0% 0%, 100% 0%, 50% 100%)';
            containerStyle.filter = `drop-shadow(0 0 10px ${color.base})`; // Drop shadow works differently with clip-path
            containerStyle.height = '4%';
            break;
        case 'hex':
            shapeClass = `${colorClass}`;
            containerStyle.clipPath = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
            containerStyle.height = '4.5%';
            break;
        case 'star':
            shapeClass = `flex items-center justify-center text-2xl ${color.text} drop-shadow-md`;
            innerContent = '★';
            containerStyle.height = '4%';
            break;
        case 'square':
            shapeClass = `${colorClass}`; // No rounding
            break;
        default: // rect
            shapeClass = `rounded-[2px] ${colorClass}`;
            break;
    }

    // Adjust for specific themes having standard inner highlights
    const showHighlight = theme.noteShape === 'rect' || theme.noteShape === 'circle' || theme.noteShape === 'square';

    return (
        <div 
            className="absolute z-20 px-[2px] flex justify-center items-center"
            style={containerStyle}
        >
            <div className={`w-full h-full relative transition-all ${shapeClass}`}>
                {showHighlight && <div className="absolute inset-x-0 top-0 h-[40%] bg-white/60 w-full"></div>}
                {innerContent}
            </div>
        </div>
    );
};
