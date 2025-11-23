
import React from 'react';
import { Note as NoteType, LaneColor } from '../types';

interface NoteProps {
    note: NoteType;
    totalLanes: number;
    color: LaneColor;
}

export const Note: React.FC<NoteProps> = ({ note, totalLanes, color }) => {
    const widthPerc = 100 / totalLanes;
    const leftPos = `${note.laneIndex * widthPerc}%`;
    
    // Construct styles from the LaneColor object passed in
    const colorClass = `${color.bg} ${color.noteShadow}`;

    return (
        <div 
            className="absolute z-20 will-change-transform px-[2px]"
            style={{ 
                left: leftPos, 
                top: `${note.y}%`,
                width: `${widthPerc}%`,
                height: '2.5%' 
            }}
        >
            {/* Note Head */}
            <div className={`w-full h-full rounded-[2px] ${colorClass} relative`}>
                <div className="absolute inset-x-0 top-0 h-[40%] bg-white/60"></div>
            </div>
        </div>
    );
};
