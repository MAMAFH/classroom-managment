export interface PeriodRange {
  periodStart: number;
  periodEnd: number;
  start: string;
  end: string;
}

// Configurable lecture blocks (1-16 periods)
export const PERIOD_RANGES: PeriodRange[] = [
  { periodStart: 1, periodEnd: 2, start: "08:30", end: "10:10" },
  { periodStart: 3, periodEnd: 4, start: "10:30", end: "12:10" },
  { periodStart: 5, periodEnd: 6, start: "12:30", end: "14:10" },
  { periodStart: 7, periodEnd: 8, start: "14:30", end: "16:10" },
  { periodStart: 9, periodEnd: 10, start: "16:30", end: "18:10" },
  { periodStart: 11, periodEnd: 12, start: "18:30", end: "20:10" },
];

// Single period to 24h start time mapping
export const PERIOD_TIME_MAP: Record<number, string> = {
  1: "08:30",
  2: "10:10",
  3: "10:30",
  4: "12:10",
  5: "12:30",
  6: "14:10",
  7: "14:30",
  8: "16:10",
  9: "16:30",
  10: "18:10",
  11: "18:30",
  12: "20:10",
};

/**
 * Safe, dynamic recovery function for unknown/evening periods (e.g. 13-16).
 * Ensures future-proofing and prevents hard crashes.
 */
export function getFallbackTimeForPeriod(period: number, isEnd: boolean): string {
  const blockIndex = Math.floor((period - 1) / 2);
  const startHour = 8 + blockIndex * 2;
  const startMin = 30;
  
  if (isEnd) {
    const endHour = startHour + 1;
    const endMin = (startMin + 40) % 60;
    const finalHour = endHour + Math.floor((startMin + 40) / 60);
    return `${String(finalHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
  } else {
    return `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
  }
}
