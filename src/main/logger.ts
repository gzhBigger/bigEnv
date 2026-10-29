import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

let logFile: string | null = null;

export function initLogger(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'bigenv.log');
  } catch {
    logFile = null;
  }
}

function format(level: Level, scope: string, message: string, extra?: unknown): string {
  const time = new Date().toISOString();
  const tail = extra === undefined ? '' : ` ${safeStringify(extra)}`;
  return `${time} [${level.toUpperCase()}] [${scope}] ${message}${tail}\n`;
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  const line = format(level, scope, message, extra);
  if (level === 'error') console.error(line.trimEnd());
  else if (level === 'warn') console.warn(line.trimEnd());
  else console.log(line.trimEnd());
  if (!logFile) return;
  try {
    appendFileSync(logFile, line, 'utf8');
  } catch {
    /* logging must never break the app */
  }
}

export interface Logger {
  debug(message: string, extra?: unknown): void;
  info(message: string, extra?: unknown): void;
  warn(message: string, extra?: unknown): void;
  error(message: string, extra?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, e) => write('debug', scope, m, e),
    info: (m, e) => write('info', scope, m, e),
    warn: (m, e) => write('warn', scope, m, e),
    error: (m, e) => write('error', scope, m, e),
  };
}
