import { EnvManager } from './envManager';
import { appPaths } from './paths';
import { createLogger, initLogger } from './logger';
import { Registry } from './registry';
import { getSettings, loadSettings } from './store';

/**
 * Argument that turns the executable into a one-shot elevated helper:
 * the UAC prompt is raised by the main process, and this process only touches the
 * machine-scope PATH and exits with a status code. No window, no IPC.
 */
export const ELEVATION_FLAG = '--bigenv-elevated-path';

export type ElevatedAction = 'apply' | 'strip';

export const EXIT_ELEVATION_OK = 0;
export const EXIT_ELEVATION_FAILED = 1;
export const EXIT_ELEVATION_STALE = 4;

/** Reads `<flag>=<action>` from argv; returns null when the flag is absent or malformed. */
export function elevatedAction(argv: readonly string[]): ElevatedAction | null {
  for (const arg of argv) {
    if (!arg.startsWith(`${ELEVATION_FLAG}=`)) continue;
    const value = arg.slice(ELEVATION_FLAG.length + 1);
    if (value === 'apply' || value === 'strip') return value;
  }
  return null;
}

/**
 * Runs in the elevated copy of bigEnv started by `AppRuntime.applyMachinePathElevated`.
 * `apply` writes the current selection into HKLM; `strip` removes bigEnv's entries there
 * (needed when leaving machine mode, because HKLM cannot be edited without elevation).
 */
export async function runElevatedPathWrite(action: ElevatedAction): Promise<number> {
  initLogger(appPaths().logDir);
  const log = createLogger('elevated');
  try {
    await loadSettings();
    const settings = getSettings();
    if (action === 'apply' && settings.pathMode !== 'machine') {
      log.warn('elevated write skipped, mode changed meanwhile', { pathMode: settings.pathMode });
      return EXIT_ELEVATION_STALE;
    }
    const registry = new Registry(() => getSettings().installRoot);
    await registry.scan();
    const env = new EnvManager(registry, getSettings);
    if (action === 'apply') {
      await env.writePathScope('machine');
      log.info('elevated machine path written', { sdks: settings.pathSdks.length });
    } else {
      await env.stripPathScope('machine', { throwOnError: true });
      log.info('elevated machine path stripped');
    }
    return EXIT_ELEVATION_OK;
  } catch (error) {
    log.error('elevated path operation failed', error);
    return EXIT_ELEVATION_FAILED;
  }
}
