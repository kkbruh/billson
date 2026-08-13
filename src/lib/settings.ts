import { DEFAULT_EXTRACTION, type ExtractionOptions } from './lifecycle';

/**
 * App settings. Kept in localStorage per browser for now — when these need to be
 * shared across a team they move to a settings table in the app database.
 */
export interface AppSettings {
  /** When on, bills arriving from a connected source parse without the review gate. */
  autoParse: boolean;
  /** Global extraction defaults; overridable per bill in the Parse queue. */
  extraction: ExtractionOptions;
}

const KEY = 'billparser.settings.v1';

export const DEFAULT_SETTINGS: AppSettings = {
  autoParse: false,
  extraction: DEFAULT_EXTRACTION,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      autoParse: parsed.autoParse === true,
      extraction: {
        textLayer: parsed.extraction?.textLayer ?? DEFAULT_EXTRACTION.textLayer,
        accuracy: parsed.extraction?.accuracy ?? DEFAULT_EXTRACTION.accuracy,
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* a full or blocked storage shouldn't break the app */
  }
}
