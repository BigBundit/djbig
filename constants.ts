
import { LaneConfig, KeyMapping } from './types';

export const BASE_FALL_SPEED_MS = 1500; 
export const HIT_WINDOW_PERFECT = 45;
export const HIT_WINDOW_GOOD = 90;
export const HIT_WINDOW_MISS = 130;
export const SONG_DURATION_MS = 305000;

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

export const DEFAULT_KEY_MAPPINGS: KeyMapping = {
    4: ['d', 'f', 'j', 'k'],
    5: ['d', 'f', ' ', 'j', 'k'],
    7: ['s', 'd', 'f', ' ', 'j', 'k', 'l']
};

// 4 KEYS: D, F, J, K
// Colors: D(Fuchsia), F(Cyan), J(Cyan), K(Fuchsia)
export const LANE_CONFIGS_4: LaneConfig[] = [
    { index: 0, key: 'd', label: 'D', color: COLOR_FUCHSIA },
    { index: 1, key: 'f', label: 'F', color: COLOR_CYAN },
    { index: 2, key: 'j', label: 'J', color: COLOR_CYAN },
    { index: 3, key: 'k', label: 'K', color: COLOR_FUCHSIA },
];

// 5 KEYS: D, F, SPACE, J, K
// Colors: D(Fuchsia), F(Cyan), SPACE(Yellow), J(Cyan), K(Fuchsia)
export const LANE_CONFIGS_5: LaneConfig[] = [
    { index: 0, key: 'd', label: 'D', color: COLOR_FUCHSIA },
    { index: 1, key: 'f', label: 'F', color: COLOR_CYAN },
    { index: 2, key: ' ', label: 'SPC', color: COLOR_YELLOW },
    { index: 3, key: 'j', label: 'J', color: COLOR_CYAN },
    { index: 4, key: 'k', label: 'K', color: COLOR_FUCHSIA },
];

// 7 KEYS: S, D, F, SPACE, J, K, L
// Colors: S(Cyan), D(Fuchsia), F(Cyan), SPACE(Yellow), J(Cyan), K(Fuchsia), L(Cyan)
export const LANE_CONFIGS_7: LaneConfig[] = [
    { index: 0, key: 's', label: 'S', color: COLOR_CYAN },
    { index: 1, key: 'd', label: 'D', color: COLOR_FUCHSIA },
    { index: 2, key: 'f', label: 'F', color: COLOR_CYAN },
    { index: 3, key: ' ', label: 'SPC', color: COLOR_YELLOW },
    { index: 4, key: 'j', label: 'J', color: COLOR_CYAN },
    { index: 5, key: 'k', label: 'K', color: COLOR_FUCHSIA },
    { index: 6, key: 'l', label: 'L', color: COLOR_CYAN },
];
