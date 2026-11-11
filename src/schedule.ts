import { clamp } from './motion';

export interface Period { id: string; start: number; end: number }
export const DEFAULT_PERIODS: Period[] = [
  { id: 'period-1', start: 480, end: 720 },
  { id: 'period-2', start: 870, end: 1050 },
];
export const normalized = (minutes: number): number => ((minutes % 1440) + 1440) % 1440;
export function systemMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
}
export function formatTime(minutes: number, endpoint = false): string {
  if (endpoint && minutes >= 1440) return '24:00';
  const whole = Math.floor(normalized(minutes));
  return String(Math.floor(whole / 60)).padStart(2, '0') + ':' + String(whole % 60).padStart(2, '0');
}
export function parseTime(text: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const [h, m] = text.split(':').map(Number);
  return h! < 24 && m! < 60 ? h! * 60 + m! : null;
}
export function validPeriods(value: unknown): value is Period[] {
  return Array.isArray(value) && value.length <= 6 && value.every(p => p && typeof p.id === 'string' &&
    Number.isInteger(p.start) && Number.isInteger(p.end) && p.start >= 0 && p.start < 1440 && p.end >= 0 && p.end < 1440 && p.start !== p.end);
}
export function isScheduled(minutes: number, periods: readonly Period[]): boolean {
  const now = normalized(minutes);
  return periods.some(p => p.start < p.end ? now >= p.start && now < p.end : now >= p.start || now < p.end);
}
export function nextStart(minutes: number, periods: readonly Period[]): string {
  if (!periods.length) return '尚未设置敲击时段';
  const now = normalized(minutes);
  const next = [...periods].sort((a, b) => normalized(a.start - now) - normalized(b.start - now))[0]!;
  return (next.start <= now ? '明日 ' : '') + formatTime(next.start) + ' 开始';
}
export function clockLight(minutes: number): number {
  const now = normalized(minutes);
  const smooth = (v: number): number => { const x = clamp(v); return x * x * (3 - 2 * x); };
  if (now < 360 || now >= 1200) return 0;
  if (now < 480) return smooth((now - 360) / 120);
  if (now < 1020) return 1;
  return 1 - smooth((now - 1020) / 180);
}
