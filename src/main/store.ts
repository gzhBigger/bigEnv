import type { Settings } from '../shared/types';
import { readJson, writeJsonAtomic } from './fsx';
import { createLogger } from './logger';
import { appPaths, defaultSettings, normalizeDir } from './paths';

const log = createLogger('store');

let settings: Settings = defaultSettings();
const listeners = new Set<(value: Settings) => void>();

function sanitize(input: Partial<Settings>, base: Settings): Settings {
  const merged: Settings = { ...base, ...input };
  merged.installRoot = merged.installRoot ? normalizeDir(merged.installRoot) : base.installRoot;
  merged.metaBase = (merged.metaBase || base.metaBase).replace(/\/+$/, '');
  merged.mirror = merged.mirror === 'cn' ? 'cn' : 'off';
  merged.proxy = (merged.proxy ?? '').trim();
  merged.concurrency = Math.min(6, Math.max(1, Math.round(Number(merged.concurrency) || 2)));
  merged.showUnsupported = merged.showUnsupported !== false;
  merged.shellEnabled = merged.shellEnabled === true;
  merged.pathMode = merged.pathMode === 'user' || merged.pathMode === 'machine' ? merged.pathMode : 'off';
  return merged;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(appPaths().settingsFile);
  settings = sanitize(stored ?? {}, defaultSettings());
  log.info('settings loaded', { installRoot: settings.installRoot, metaBase: settings.metaBase });
  return settings;
}

export function getSettings(): Settings {
  return settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = sanitize(patch, settings);
  settings = next;
  await writeJsonAtomic(appPaths().settingsFile, next);
  for (const listener of listeners) listener(next);
  return next;
}

export function onSettingsChange(listener: (value: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
