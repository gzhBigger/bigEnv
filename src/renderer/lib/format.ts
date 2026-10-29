import type { JobPhase } from '../../shared/types';

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : digits)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond)) return '';
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

const PHASE_TEXT: Record<JobPhase, string> = {
  queued: '排队中',
  downloading: '下载中',
  verifying: '校验中',
  extracting: '解压中',
  finalizing: '写入中',
  done: '完成',
  error: '失败',
  canceled: '已取消',
};

export function phaseText(phase: JobPhase): string {
  return PHASE_TEXT[phase] ?? phase;
}

export function glyphOf(name: string, id: string): string {
  const clean = name.replace(/[^A-Za-z0-9]/g, '');
  if (clean.length >= 2) return clean.slice(0, 2);
  return id.slice(0, 2);
}

export function percent(progress: number): string {
  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}
