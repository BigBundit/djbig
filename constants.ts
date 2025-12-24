
import { LaneConfig, KeyMapping, Theme } from './types';

export const BASE_FALL_SPEED_MS = 2500; // เพิ่มเวลาเพื่อให้โน้ตไหลลงมาได้นานขึ้นและเห็นจากด้านบนชัดเจน
export const HIT_WINDOW_PERFECT = 45;
export const HIT_WINDOW_GOOD = 90;
export const HIT_WINDOW_MISS = 130;
export const SONG_DURATION_MS = 305000;
export const HOLD_TICK_SCORE = 20; // Score per frame while holding

// Color Definitions (Tailwind classes)
const COLOR_CYAN = {
    base: 'cyan',
    border: 'border-cyan-500',
    shadow: 'shadow-cyan-500/50',
    text: 'text-cyan-400',
    bg: 'bg-cyan-400',
    noteShadow: 'shadow-[0_0_15px_rgba(34,211,238,0.6)]'
};

const COLOR_FUCHSIA = {
    base: 'fuchsia',
    border: 'border-fuchsia-500',
    shadow: 'shadow-fuchsia-500/50',
    text: 'text-fuchsia-400',
    bg: 'bg-fuchsia-400',
    noteShadow: 'shadow-[0_0_15px_rgba(232,121,249,0.6)]'
};

const COLOR_YELLOW = {
    base: 'yellow',
    border: 'border-yellow-400',
    shadow: 'shadow-yellow-500/50',
    text: 'text-yellow-400',
    bg: 'bg-yellow-400',
    noteShadow: 'shadow-[0_0_15px_rgba(250,204,21,0.8)]'
};

// UPDATED TO USE PHYSICAL KEY CODES
export const DEFAULT_KEY_MAPPINGS: KeyMapping = {
    4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
    5: ['KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK'],
    7: ['KeyS', 'KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK', 'KeyL']
};

// 4 KEYS: D, F, J, K
export const LANE_CONFIGS_4: LaneConfig[] = [
    { index: 0, key: 'KeyD', label: 'D', color: COLOR_FUCHSIA },
    { index: 1, key: 'KeyF', label: 'F', color: COLOR_CYAN },
    { index: 2, key: 'KeyJ', label: 'J', color: COLOR_CYAN },
    { index: 3, key: 'KeyK', label: 'K', color: COLOR_FUCHSIA },
];

// 5 KEYS: D, F, SPACE, J, K
export const LANE_CONFIGS_5: LaneConfig[] = [
    { index: 0, key: 'KeyD', label: 'D', color: COLOR_FUCHSIA },
    { index: 1, key: 'KeyF', label: 'F', color: COLOR_CYAN },
    { index: 2, key: 'Space', label: 'SPC', color: COLOR_YELLOW },
    { index: 3, key: 'KeyJ', label: 'J', color: COLOR_CYAN },
    { index: 4, key: 'KeyK', label: 'K', color: COLOR_FUCHSIA },
];

// 7 KEYS: S, D, F, SPACE, J, K, L
export const LANE_CONFIGS_7: LaneConfig[] = [
    { index: 0, key: 'KeyS', label: 'S', color: COLOR_CYAN },
    { index: 1, key: 'KeyD', label: 'D', color: COLOR_FUCHSIA },
    { index: 2, key: 'KeyF', label: 'F', color: COLOR_CYAN },
    { index: 3, key: 'Space', label: 'SPC', color: COLOR_YELLOW },
    { index: 4, key: 'KeyJ', label: 'J', color: COLOR_CYAN },
    { index: 5, key: 'KeyK', label: 'K', color: COLOR_FUCHSIA },
    { index: 6, key: 'KeyL', label: 'L', color: COLOR_CYAN },
];

// --- THEMES ---

export const GAME_THEMES: Theme[] = [
    {
        id: 'ignore',
        name: 'IGNORE PROTOCOL',
        description: 'Advanced Handheld Simulation with tactical HUD.',
        unlockDescription: 'Unlocked Default',
        noteShape: 'rect',
        receptorStyle: 'button'
    },
    {
        id: 'neon',
        name: 'NEON CORE',
        description: 'The Classic Interface. Optimized for pure visibility.',
        unlockDescription: 'Unlocked via Customization',
        noteShape: 'rect',
        receptorStyle: 'line'
    },
    {
        id: 'titan',
        name: 'TITAN CONSTRUCT',
        description: 'Heavy industrial interface with reinforced inputs.',
        unlockDescription: 'Unlocked via Customization',
        noteShape: 'hex',
        receptorStyle: 'bracket'
    },
    {
        id: 'queen',
        name: 'QUEEN PROTOCOL',
        description: 'Sophisticated royal interface in violet and gold.',
        unlockDescription: 'Unlocked via Customization',
        noteShape: 'diamond',
        receptorStyle: 'button'
    }
];
