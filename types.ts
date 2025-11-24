
export enum GameStatus {
    MENU,
    PLAYING,
    PAUSED,
    OUTRO,
    FINISHED
}

export enum ScoreRating {
    PERFECT,
    GOOD,
    BAD,
    MISS
}

export interface LaneColor {
    base: string;
    border: string;
    shadow: string;
    text: string;
    bg: string;
    noteShadow: string;
}

export interface LaneConfig {
    index: number;
    key: string; // Keyboard key
    color: LaneColor; 
    label: string;
}

export interface Note {
    id: number;
    laneIndex: number;
    timestamp: number; // ms from start of song
    y: number; // current vertical position (0-100%)
    hit: boolean;
    missed: boolean;
}

export interface HitEffectData {
    id: number;
    laneIndex: number;
    rating: ScoreRating;
    timestamp: number;
}

export interface GameState {
    status: GameStatus;
    score: number;
    combo: number;
    maxCombo: number;
    health: number;
}

export interface HighScore {
    playerName: string;
    score: number;
    maxCombo: number;
    missCount: number;
    timestamp: number;
}

export interface GameStats {
    perfect: number;
    good: number;
    miss: number;
    maxCombo: number;
    score: number;
}

export interface SongMetadata {
    id: string;
    file: File;
    name: string;
    thumbnailUrl: string | null;
    type: 'video' | 'audio';
    duration?: string;
}

export interface KeyMapping {
    4: string[];
    5: string[];
    7: string[];
}
