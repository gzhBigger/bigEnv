import type { Settings } from '../shared/types';
import { readJson, writeJsonAtomic } from './fsx';
import { createLogger } from './logger';
import { appPaths, defaultSettings, normalizeDir } from './paths';

const log = createLogger('store');

let settings: Settings = defaultSettings();
let pathSdksExplicit = false;
const listeners = new Set<(value: Settings) => void>();

function sanitize(input: Partial<Settings>, base: Settings): Settings {
  const merged: Settings = { ...base, ...input };
  // Drop keys retired from the schema so settings.json does not keep stale switches around.
  delete (merged as unknown as Record<string, unknown>).shellEnabled;
  merged.installRoot = merged.installRoot ? normalizeDir(merged.installRoot) : base.installRoot;
  merged.metaBase = (merged.metaBase || base.metaBase).replace(/\/+$/, '');
  merged.mirror = merged.mirror === 'cn' ? 'cn' : 'off';
  merged.proxy = (merged.proxy ?? '').trim();
  merged.concurrency = Math.min(6, Math.max(1, Math.round(Number(merged.concurrency) || 2)));
  merged.showUnsupported = merged.showUnsupported !== false;
  merged.pathMode = merged.pathMode === 'user' || merged.pathMode === 'machine' ? merged.pathMode : 'off';
  merged.pathSdks = Array.isArray(merged.pathSdks)
    ? merged.pathSdks.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const projects = Array.isArray(merged.projects) ? merged.projects : [];
  const seen = new Set<string>();
  merged.projects = projects
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => normalizeDir(item))
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  merged.theme = merged.theme === 'light' || merged.theme === 'dark' ? merged.theme : 'system';
  return merged;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(appPaths().settingsFile);
  pathSdksExplicit = Array.isArray(stored?.pathSdks);
  settings = sanitize(stored ?? {}, defaultSettings());
  if (stored && 'shellEnabled' in stored) {
    // Rewrite once so the retired key disappears from settings.json.
    await writeJsonAtomic(appPaths().settingsFile, settings);
  }
  log.info('settings loaded', { installRoot: settings.installRoot, metaBase: settings.metaBase });
  return settings;
}

/**
 * Whether the settings file already carried an explicit `pathSdks` list.
 *
 * Settings written before per-SDK PATH selection existed have no such key; only then does the runtime
 * seed it from the installed runtimes, so an upgrade keeps the previous "everything is on PATH" behaviour
 * instead of silently dropping it.
 */
export function hasExplicitPathSdks(): boolean {
  return pathSdksExplicit;
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
