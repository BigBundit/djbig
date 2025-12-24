
import React, { useEffect, useState, useMemo, memo } from 'react';
import { ScoreRating } from '../types';

interface HitEffectProps {
    x: string;
    width: string;
    rating: ScoreRating;
}

export const HitEffect: React.FC<HitEffectProps> = memo(({ x, width, rating }) => {
    const [visible, setVisible] = useState(true);

    const sparks = useMemo(() => {
        return Array.from({ length: 6 }).map((_, i) => {
            const angle = (Math.random() * 360) * (Math.PI / 180);
            const dist = 40 + Math.random() * 60; 
            const tx = Math.cos(angle) * dist;
            const ty = Math.sin(angle) * dist;
            const size = 2 + Math.random() * 2;
            const delay = Math.random() * 0.05;
            return { id: i, tx, ty, size, delay };
        });
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => setVisible(false), 300);
        return () => clearTimeout(timer);
    }, []);

    if (!visible) return null;

    let fireColors = '';
    let sparkColor = '';
    
    if (rating === ScoreRating.PERFECT) {
        fireColors = 'from-white via-cyan-300 to-transparent';
        sparkColor = 'bg-cyan-200';
    } else if (rating === ScoreRating.GOOD) {
        fireColors = 'from-white via-green-300 to-transparent';
        sparkColor = 'bg-green-200';
    } else {
        fireColors = 'from-white via-yellow-300 to-transparent';
        sparkColor = 'bg-yellow-200';
    }

    return (
        <div 
            className="absolute bottom-[8%] z-50 pointer-events-none flex justify-center items-center"
            style={{ left: x, width: width, height: '10%' }}
        >
            <div className={`absolute w-full pt-[100%] rounded-full border-white/50 opacity-0 animate-[explosion-ring_0.3s_ease-out_forwards]`}></div>
            <div className={`absolute w-[100%] pt-[100%] rounded-full bg-[radial-gradient(circle,_var(--tw-gradient-stops))] ${fireColors} opacity-0 mix-blend-screen animate-[explosion-core_0.3s_ease-out_forwards]`}></div>
            <div className={`absolute w-[40%] pt-[40%] rounded-full bg-white opacity-0 mix-blend-screen animate-[flash_0.15s_ease-out_forwards]`}></div>
            {sparks.map((s) => (
                <div 
                    key={s.id}
                    className={`absolute rounded-full ${sparkColor} animate-[spark-fly_0.3s_ease-out_forwards]`}
                    style={{
                        width: `${s.size}px`,
                        height: `${s.size}px`,
                        '--tx': `${s.tx}px`,
                        '--ty': `${s.ty}px`,
                        animationDelay: `${s.delay}s`
                    } as React.CSSProperties}
                ></div>
            ))}
        </div>
    );
});
