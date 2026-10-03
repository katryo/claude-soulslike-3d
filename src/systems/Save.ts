import { BASE_STATS, type PlayerStats } from './Stats';

export interface SaveData {
  version: 1;
  stats: PlayerStats;
  souls: number;
  flasksMax: number;
  litBonfires: string[];
  lastBonfire: string;
  bossDefeated: boolean;
  itemsTaken: string[];
  bloodstain: { x: number; z: number; souls: number } | null;
  deaths: number;
  settings: { volume: number; sensitivity: number; invertY: boolean };
}

const KEY = 'ashen-hollow-save-v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    stats: { ...BASE_STATS },
    souls: 0,
    flasksMax: 3,
    litBonfires: ['shrine'],
    lastBonfire: 'shrine',
    bossDefeated: false,
    itemsTaken: [],
    bloodstain: null,
    deaths: 0,
    settings: { volume: 0.8, sensitivity: 1, invertY: false },
  };
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 1) return null;
    return { ...defaultSave(), ...d, settings: { ...defaultSave().settings, ...d.settings } };
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: progress is kept for this session only */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
