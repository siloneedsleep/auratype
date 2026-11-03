import { create } from 'zustand';
import { ExportableSettings } from '../services/dataTransfer';
import { SoundProfile } from '../utils/soundFX';
import { Language, PassageLength, Topic } from '../utils/text';

export const SETTINGS_SCHEMA_VERSION = 1;
const SETTINGS_STORAGE_KEY = 'auratype_settings_v1';

export interface SettingsState extends ExportableSettings {
  schemaVersion: number;
  virtualKeyboardEnabled: boolean;
  reducedMotionSystem: boolean;
  hydrated: boolean;
  targetWpm: number;
  setTargetWpm: (value: number) => void;
  setReducedMotion: (value: boolean) => void;

  hydrateSettings: () => void;
  setFxMode: (mode: 'lite' | 'ultra') => void;
  setGhostEnabled: (enabled: boolean) => void;
  setScreenShakeEnabled: (enabled: boolean) => void;
  setCometTrailEnabled: (enabled: boolean) => void;
  setVirtualKeyboardEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSoundProfile: (profile: SoundProfile) => void;
  setSoundVolume: (volume: number) => void;
  setLanguage: (lang: Language) => void;
  setTopic: (topic: Topic) => void;
  setLength: (length: PassageLength) => void;
  setPersonalCooldownSec: (sec: number) => void;
  applyImportedSettings: (partial?: Partial<ExportableSettings>) => void;
  resetSettingsToDefault: () => void;
}

export const DEFAULT_SETTINGS: ExportableSettings & {
  virtualKeyboardEnabled: boolean;
} = {
  fxMode: 'lite', // Per Section 6: Mặc định FX nhẹ, âm thanh tắt. Ultra Juice là tùy chọn.
  ghostEnabled: true,
  screenShakeEnabled: false,
  cometTrailEnabled: true,
  virtualKeyboardEnabled: false,
  soundEnabled: false,
  soundProfile: 'creamy',
  soundVolume: 70,
  language: 'vi',
  topic: 'philosophy',
  length: 'short',
  personalCooldownSec: 30, // 30-60s range (no 15s per Section 10.3)
};

function validateAndSanitizeSettings(
  raw: unknown,
  prefersReducedMotion: boolean
): ExportableSettings & { virtualKeyboardEnabled: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ...DEFAULT_SETTINGS,
      fxMode: 'lite',
      screenShakeEnabled: false,
    };
  }

  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    return {
      ...DEFAULT_SETTINGS,
      fxMode: 'lite',
      screenShakeEnabled: false,
    };
  }

  const fxMode =
    obj.fxMode === 'ultra' && !prefersReducedMotion ? 'ultra' : 'lite';
  const ghostEnabled =
    typeof obj.ghostEnabled === 'boolean' ? obj.ghostEnabled : true;
  const screenShakeEnabled =
    typeof obj.screenShakeEnabled === 'boolean'
      ? obj.screenShakeEnabled
      : false;
  const cometTrailEnabled =
    typeof obj.cometTrailEnabled === 'boolean' ? obj.cometTrailEnabled : true;
  const virtualKeyboardEnabled =
    typeof obj.virtualKeyboardEnabled === 'boolean'
      ? obj.virtualKeyboardEnabled
      : false;
  const soundEnabled =
    typeof obj.soundEnabled === 'boolean' ? obj.soundEnabled : false;
  const soundProfile: SoundProfile =
    obj.soundProfile === 'thock' || obj.soundProfile === 'typewriter'
      ? obj.soundProfile
      : 'creamy';
  const soundVolume =
    typeof obj.soundVolume === 'number' && Number.isFinite(obj.soundVolume)
      ? Math.max(0, Math.min(100, Math.round(obj.soundVolume)))
      : 70;
  const language: Language = obj.language === 'en' ? 'en' : 'vi';
  const topic: Topic =
    obj.topic === 'code' || obj.topic === 'scifi' ? obj.topic : 'philosophy';
  const length: PassageLength =
    obj.length === 'medium' || obj.length === 'long' ? obj.length : 'short';
  const personalCooldownSec =
    typeof obj.personalCooldownSec === 'number' &&
    Number.isFinite(obj.personalCooldownSec)
      ? Math.max(30, Math.min(60, Math.round(obj.personalCooldownSec)))
      : 30;

  return {
    fxMode,
    ghostEnabled,
    screenShakeEnabled,
    cometTrailEnabled,
    virtualKeyboardEnabled,
    soundEnabled,
    soundProfile,
    soundVolume,
    language,
    topic,
    length,
    personalCooldownSec,
  };
}

function persistSettings(state: SettingsState): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      fxMode: state.fxMode,
      targetWpm: state.targetWpm,
      ghostEnabled: state.ghostEnabled,
      screenShakeEnabled: state.screenShakeEnabled,
      cometTrailEnabled: state.cometTrailEnabled,
      virtualKeyboardEnabled: state.virtualKeyboardEnabled,
      soundEnabled: state.soundEnabled,
      soundProfile: state.soundProfile,
      soundVolume: state.soundVolume,
      language: state.language,
      topic: state.topic,
      length: state.length,
      personalCooldownSec: state.personalCooldownSec,
    };
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage quota or privacy errors
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  ...DEFAULT_SETTINGS,
  reducedMotionSystem: false,
  hydrated: false,
  targetWpm: 0,
  setTargetWpm: (value) => {
    set({
      targetWpm: Number.isFinite(value)
        ? Math.max(0, Math.min(150, Math.round(value)))
        : 0,
    });
    persistSettings(get());
  },
  setReducedMotion: (reducedMotionSystem) => set({ reducedMotionSystem }),

  hydrateSettings: () => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const prefersReduced = Boolean(mql?.matches);

    let parsed: unknown = null;
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        parsed = JSON.parse(raw);
      }
    } catch {
      parsed = null;
    }

    const sanitized = validateAndSanitizeSettings(parsed, prefersReduced);
    set({
      ...sanitized,
      reducedMotionSystem: prefersReduced,
      hydrated: true,
      targetWpm:
        parsed &&
        typeof parsed === 'object' &&
        'targetWpm' in parsed &&
        typeof parsed.targetWpm === 'number' &&
        Number.isFinite(parsed.targetWpm)
          ? Math.max(0, Math.min(150, Math.round(parsed.targetWpm)))
          : 0,
    });
    persistSettings(get());
  },

  setFxMode: (fxMode) => {
    set({ fxMode });
    persistSettings(get());
  },
  setGhostEnabled: (ghostEnabled) => {
    set({ ghostEnabled });
    persistSettings(get());
  },
  setScreenShakeEnabled: (screenShakeEnabled) => {
    set({ screenShakeEnabled });
    persistSettings(get());
  },
  setCometTrailEnabled: (cometTrailEnabled) => {
    set({ cometTrailEnabled });
    persistSettings(get());
  },
  setVirtualKeyboardEnabled: (virtualKeyboardEnabled) => {
    set({ virtualKeyboardEnabled });
    persistSettings(get());
  },
  setSoundEnabled: (soundEnabled) => {
    set({ soundEnabled });
    persistSettings(get());
  },
  setSoundProfile: (soundProfile) => {
    set({ soundProfile });
    persistSettings(get());
  },
  setSoundVolume: (soundVolume) => {
    const clamped = Math.max(0, Math.min(100, Math.round(soundVolume)));
    set({ soundVolume: clamped });
    persistSettings(get());
  },
  setLanguage: (language) => {
    set({ language });
    persistSettings(get());
  },
  setTopic: (topic) => {
    set({ topic });
    persistSettings(get());
  },
  setLength: (length) => {
    set({ length });
    persistSettings(get());
  },
  setPersonalCooldownSec: (sec) => {
    const clamped = Math.max(30, Math.min(60, Math.round(sec)));
    set({ personalCooldownSec: clamped });
    persistSettings(get());
  },
  applyImportedSettings: (partial) => {
    if (!partial) return;
    const current = get();
    const merged = validateAndSanitizeSettings(
      {
        ...current,
        ...partial,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
      },
      current.reducedMotionSystem
    );
    set({ ...merged });
    persistSettings(get());
  },
  resetSettingsToDefault: () => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
    set({
      ...DEFAULT_SETTINGS,
      screenShakeEnabled: false,
      targetWpm: 0,
    });
    persistSettings(get());
  },
}));
