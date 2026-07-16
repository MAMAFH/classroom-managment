/**
 * @file serverParser.ts
 * Server-side (Node.js) compatible timetable page parser.
 *
 * Pure TypeScript — zero browser globals (no window, document, DOM).
 * Designed to run inside a Vercel Serverless Function alongside pdfjs-dist.
 *
 * The algorithm is a faithful TypeScript port of scripts/parse_pdf.py:
 *  - 50-minute individual period slot times (PERIOD_START_MAP / PERIOD_END_MAP)
 *  - No forced 2-period block snapping
 *  - Same spatial geometry: period column interpolation, weekday row detection,
 *    word clustering with divider-aware gap detection
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpatialWord {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface ParsedScheduleEntry {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  courseCode: string;
  professor: string;
  originalText: string;
}

export interface ParsedPageResult {
  pageNumber: number;
  room: {
    roomCode: string;
    roomType: 'lab' | 'classroom';
    originalText: string;
  };
  schedules: ParsedScheduleEntry[];
  diagnostics: {
    weekdayRowsDetected: number;
    periodColsDetected: number;
    blocksExtracted: number;
  };
}

// ---------------------------------------------------------------------------
// Constants (mirror parse_pdf.py exactly)
// ---------------------------------------------------------------------------

/** Arabic weekday labels → 0-indexed day (Saturday = 0) */
const WEEKDAY_MAP: Record<string, number> = {
  "السبت": 0,  "ﺖﺒﺴﻟا": 0,  "السبت ": 0,
  "الأحد": 1,  "ﺪﺣﻷا": 1,   "الأحد ": 1,  "ﺪﺣأ": 1,
  "الاثنين": 2, "الإثنين": 2, "ﻦﯿﻨﺛﻹا": 2, "ﻦﯿﻨﺛﻻا": 2,
  "الثلاثاء": 3, "ءﺎﺛﻼﺜﻟا": 3,
  "الأربعاء": 4, "ءﺎﻌﺑرﻷا": 4,
  "الخميس": 5, "ﺲﯿﻤﺨﻟا": 5,
  "الجمعة": 6,  "ﺔﻌﻤﺠﻟا": 6,  "الجمعة ": 6,
};

/** Individual 50-minute period start times (periods 1–16) */
const PERIOD_START_MAP: Record<number, string> = {
  1:  "08:30", 2:  "09:20", 3:  "10:30", 4:  "11:20",
  5:  "12:30", 6:  "13:20", 7:  "14:30", 8:  "15:20",
  9:  "16:30", 10: "17:20", 11: "18:30", 12: "19:20",
  13: "20:30", 14: "21:20", 15: "22:30", 16: "23:20",
};

/** Individual 50-minute period end times (periods 1–16) */
const PERIOD_END_MAP: Record<number, string> = {
  1:  "09:20", 2:  "10:10", 3:  "11:20", 4:  "12:10",
  5:  "13:20", 6:  "14:10", 7:  "15:20", 8:  "16:10",
  9:  "17:20", 10: "18:10", 11: "19:20", 12: "20:10",
  13: "21:20", 14: "22:10", 15: "23:20", 16: "00:10",
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Convert Arabic-Indic numerals (٠١٢...) to ASCII digits (012...) */
function translateArabicDigits(text: string): string {
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const en = "0123456789";
  return text.split('').map(c => {
    const i = ar.indexOf(c);
    return i !== -1 ? en[i] : c;
  }).join('');
}

/** Normalise common Arabic letter variations (Alef, Teh Marbuta, Yeh) */
function normalizeArabicLetters(text: string): string {
  if (!text) return "";
  return text
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ی/g, 'ي')
    .trim();
}

// ---------------------------------------------------------------------------
// Column interpolation: estimate all 16 period X-centres from known detections
// ---------------------------------------------------------------------------

function interpolatePeriodCenters(
  detectedCenters: Record<number, number>,
  pageWidth: number
): (number | null)[] {
  const centers: (number | null)[] = new Array(17).fill(null);
  for (const [pStr, x] of Object.entries(detectedCenters)) {
    const p = Number(pStr);
    if (p >= 1 && p <= 16) centers[p] = x;
  }

  const known = Object.keys(detectedCenters).map(Number)
    .filter(p => p >= 1 && p <= 16).sort((a, b) => a - b);

  if (known.length === 0) {
    const left = 35.0, right = 770.0;
    const colW = (right - left) / 16;
    for (let p = 1; p <= 16; p++) {
      centers[p] = right - (p - 0.5) * colW;
    }
    return centers;
  }

  let colWidth = 45.0;
  if (known.length >= 2) {
    const diffs: number[] = [];
    for (let i = 0; i < known.length - 1; i++) {
      const diff = Math.abs(detectedCenters[known[i + 1]] - detectedCenters[known[i]]) / (known[i + 1] - known[i]);
      if (diff > 10) diffs.push(diff);
    }
    if (diffs.length > 0) colWidth = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }

  if (known.length === 1) {
    const k = known[0], val = detectedCenters[k];
    for (let p = 1; p <= 16; p++) centers[p] = val - (p - k) * colWidth;
    return centers;
  }

  for (let p = 1; p <= 16; p++) {
    if (centers[p] !== null) continue;
    const smaller = known.filter(k => k < p);
    const larger  = known.filter(k => k > p);

    if (smaller.length > 0 && larger.length > 0) {
      const k1 = smaller[smaller.length - 1], k2 = larger[0];
      const x1 = detectedCenters[k1],         x2 = detectedCenters[k2];
      centers[p] = x1 + (p - k1) * (x2 - x1) / (k2 - k1);
    } else if (smaller.length > 0) {
      const k1 = smaller.length >= 2 ? smaller[smaller.length - 2] : smaller[smaller.length - 1];
      const k2 = smaller[smaller.length - 1];
      const x1 = detectedCenters[k1], x2 = detectedCenters[k2];
      centers[p] = k2 === k1 ? x2 - (p - k2) * colWidth
                              : x2 + (p - k2) * (x2 - x1) / (k2 - k1);
    } else {
      const k1 = larger[0];
      const k2 = larger.length >= 2 ? larger[1] : larger[0];
      const x1 = detectedCenters[k1], x2 = detectedCenters[k2];
      centers[p] = k2 === k1 ? x1 + (k1 - p) * colWidth
                              : x1 - (k1 - p) * (x2 - x1) / (k2 - k1);
    }
  }
  return centers;
}

// ---------------------------------------------------------------------------
// Row interpolation: estimate all 7 weekday Y-centres from known detections
// ---------------------------------------------------------------------------

function interpolateWeekdayCenters(
  detectedWeekdays: Record<number, number>
): [number[], number] {
  const centers: (number | null)[] = new Array(7).fill(null);
  for (const [dStr, y] of Object.entries(detectedWeekdays)) {
    const d = Number(dStr);
    if (d >= 0 && d <= 6) centers[d] = y;
  }

  const known = Object.keys(detectedWeekdays).map(Number)
    .filter(d => d >= 0 && d <= 6).sort((a, b) => a - b);

  let rowHeight = 55.46;
  if (known.length >= 2) {
    const diffs: number[] = [];
    for (let i = 0; i < known.length - 1; i++) {
      const diff = (detectedWeekdays[known[i + 1]] - detectedWeekdays[known[i]]) / (known[i + 1] - known[i]);
      if (diff > 10) diffs.push(diff);
    }
    if (diffs.length > 0) rowHeight = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }

  if (known.length === 0) {
    for (let d = 0; d <= 6; d++) centers[d] = 120.0 + d * rowHeight;
    return [centers as number[], rowHeight];
  }

  if (known.length === 1) {
    const k = known[0], val = detectedWeekdays[k];
    for (let d = 0; d <= 6; d++) centers[d] = val + (d - k) * rowHeight;
    return [centers as number[], rowHeight];
  }

  for (let d = 0; d <= 6; d++) {
    if (centers[d] !== null) continue;
    const smaller = known.filter(k => k < d);
    const larger  = known.filter(k => k > d);

    if (smaller.length > 0 && larger.length > 0) {
      const k1 = smaller[smaller.length - 1], k2 = larger[0];
      const y1 = detectedWeekdays[k1],         y2 = detectedWeekdays[k2];
      centers[d] = y1 + (d - k1) * (y2 - y1) / (k2 - k1);
    } else if (smaller.length > 0) {
      const k1 = smaller.length >= 2 ? smaller[smaller.length - 2] : smaller[smaller.length - 1];
      const k2 = smaller[smaller.length - 1];
      const y1 = detectedWeekdays[k1], y2 = detectedWeekdays[k2];
      centers[d] = k2 === k1 ? y2 + (d - k2) * rowHeight
                              : y2 + (d - k2) * (y2 - y1) / (k2 - k1);
    } else {
      const k1 = larger[0];
      const k2 = larger.length >= 2 ? larger[1] : larger[0];
      const y1 = detectedWeekdays[k1], y2 = detectedWeekdays[k2];
      centers[d] = k2 === k1 ? y1 - (k1 - d) * rowHeight
                              : y1 - (k1 - d) * (y2 - y1) / (k2 - k1);
    }
  }
  return [centers as number[], rowHeight];
}

// ---------------------------------------------------------------------------
// Word clustering: group horizontally-adjacent words into visual cells
// ---------------------------------------------------------------------------

interface ClusteredCell {
  words: SpatialWord[];
  x0: number; x1: number;
  top: number; bottom: number;
}

function clusterWordsInRow(
  rowWords: SpatialWord[],
  dividers: number[] = [],
  horizontalTolerance = 35
): ClusteredCell[] {
  if (rowWords.length === 0) return [];

  // Sort right-to-left (RTL Arabic reading order)
  const sorted = [...rowWords].sort((a, b) => b.x0 - a.x0);
  const cells: ClusteredCell[] = [];

  for (const w of sorted) {
    let merged = false;
    for (const cell of cells) {
      const gap = Math.max(0, w.x0 - cell.x1, cell.x0 - w.x1);
      if (gap <= horizontalTolerance) {
        const wLeft   = Math.min(w.x0, w.x1);
        const wRight  = Math.max(w.x0, w.x1);
        const xMin = Math.min(wRight, cell.x0);
        const xMax = Math.max(wLeft,  cell.x1);
        const hasDivider = dividers.some(x => xMin < x && x < xMax);
        if (hasDivider) continue;

        cell.words.push(w);
        cell.x0     = Math.min(cell.x0, w.x0);
        cell.x1     = Math.max(cell.x1, w.x1);
        cell.top    = Math.min(cell.top, w.top);
        cell.bottom = Math.max(cell.bottom, w.bottom);
        merged = true;
        break;
      }
    }
    if (!merged) {
      cells.push({ words: [w], x0: w.x0, x1: w.x1, top: w.top, bottom: w.bottom });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Main page parser
// ---------------------------------------------------------------------------

/**
 * Parse one PDF page worth of pre-extracted words into a structured schedule.
 *
 * @param words       Word objects with text + bounding-box coordinates
 * @param pageWidth   Page width in PDF user-space points
 * @param pageNumber  1-based page index (used as fallback room code)
 */
export function parseTimetablePage(
  words: SpatialWord[],
  pageWidth: number,
  pageNumber: number
): ParsedPageResult | null {
  if (words.length === 0) return null;

  // ── 1. Room detection ────────────────────────────────────────────────────

  // Room keyword lives in the top header area (top < 75 pt)
  const headerWords = words.filter(w => w.top < 75);

  let roomText   = "";
  let roomCode   = `قاعة ${pageNumber}`;
  let roomType: 'lab' | 'classroom' = 'classroom';

  const ROOM_KEYWORDS = ["معمل", "ﻞﻤﻌﻣ", "فصل", "ﻞﺼﻓ", "قاعة", "ﺔﻋﺎﻗ"];
  const roomKeyword = headerWords.find(w => ROOM_KEYWORDS.some(kw => w.text.includes(kw)));

  if (roomKeyword) {
    // Collect all words on the same horizontal line as the keyword
    const lineY   = roomKeyword.top;
    const lineWds = headerWords.filter(w => Math.abs(w.top - lineY) <= 4)
                               .sort((a, b) => b.x0 - a.x0); // RTL
    roomText = lineWds.map(w => w.text).join(" ").trim();

    if (roomText.includes("معمل") || roomText.includes("ﻞﻤﻌﻣ")) roomType = 'lab';

    const match = roomText.match(/(فصل|معمل|قاعة)\s+([A-Za-z0-9\u0660-\u0669\-_]+)/);
    if (match) {
      roomCode = match[2].trim();
    } else {
      const numMatch = roomText.match(/([A-Za-z0-9\u0660-\u0669\-_]+)/);
      if (numMatch) roomCode = numMatch[1].trim();
    }
  } else if (headerWords.length > 0) {
    const topWord = [...headerWords].sort((a, b) => a.top - b.top)[0];
    roomText = topWord.text;
    roomCode = roomText.replace(/\D/g, '') || `${pageNumber}`;
  }

  // ── 2. Weekday row detection ─────────────────────────────────────────────

  const detectedWeekdays: Record<number, number[]> = {};
  for (const w of words) {
    const normText = normalizeArabicLetters(w.text);
    for (const [dayName, dayIdx] of Object.entries(WEEKDAY_MAP)) {
      if (normalizeArabicLetters(dayName) === normText || normText.includes(normalizeArabicLetters(dayName))) {
        if (!detectedWeekdays[dayIdx]) detectedWeekdays[dayIdx] = [];
        detectedWeekdays[dayIdx].push((w.top + w.bottom) / 2);
        break;
      }
    }
  }

  const finalWeekdays: Record<number, number> = {};
  for (const [dStr, ys] of Object.entries(detectedWeekdays)) {
    finalWeekdays[Number(dStr)] = ys.reduce((a, b) => a + b, 0) / ys.length;
  }

  const [yCenters, rowHeight] = interpolateWeekdayCenters(finalWeekdays);

  const rowBounds: Record<number, [number, number]> = {};
  for (let d = 0; d <= 6; d++) {
    rowBounds[d] = [yCenters[d] - rowHeight / 2 - 2, yCenters[d] + rowHeight / 2 + 2];
  }

  // ── 3. Period column detection ───────────────────────────────────────────

  const detectedPeriods: Record<number, number[]> = {};
  for (const w of words) {
    if (w.top > 105) continue; // period headers are always near top
    const text = translateArabicDigits(w.text);

    if (/^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 16) {
      const val = Number(text);
      if (!detectedPeriods[val]) detectedPeriods[val] = [];
      detectedPeriods[val].push((w.x0 + w.x1) / 2);
    } else {
      // Handle concatenated numbers e.g. "161514131211" rendered as one token
      const matches = text.match(/(16|15|14|13|12|11|10|[1-9])/g);
      if (matches && matches.join("") === text) {
        const width = w.x1 - w.x0;
        const colW  = width / matches.length;
        matches.forEach((ns, idx) => {
          const val = Number(ns);
          if (!detectedPeriods[val]) detectedPeriods[val] = [];
          detectedPeriods[val].push(w.x0 + (idx + 0.5) * colW);
        });
      }
    }
  }

  const finalPeriods: Record<number, number> = {};
  for (const [pStr, xs] of Object.entries(detectedPeriods)) {
    finalPeriods[Number(pStr)] = xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  const colCenters = interpolatePeriodCenters(finalPeriods, pageWidth);

  // Column boundaries: midpoints between adjacent centres
  const midpoints: Record<number, number> = {};
  for (let p = 1; p <= 15; p++) {
    midpoints[p] = ((colCenters[p] ?? 0) + (colCenters[p + 1] ?? 0)) / 2;
  }
  const colBounds: Record<number, [number, number]> = {};
  for (let p = 1; p <= 16; p++) {
    colBounds[p] = [
      p === 16 ? 0         : midpoints[p],
      p === 1  ? pageWidth : midpoints[p - 1],
    ];
  }

  // ── 4. Header filtering ──────────────────────────────────────────────────

  const tableTop    = 90;
  const tableBottom = Math.max(...Object.values(rowBounds).map(([, r]) => r), 0) + 10;

  const isHeader = (w: SpatialWord): boolean => {
    const norm = normalizeArabicLetters(w.text);
    for (const dayName of Object.keys(WEEKDAY_MAP)) {
      if (norm.includes(normalizeArabicLetters(dayName))) return true;
    }
    const clean = translateArabicDigits(w.text);
    if (/^\d+$/.test(clean) && Number(clean) >= 1 && Number(clean) <= 16) return true;
    if (/^(16|15|14|13|12|11|10|[1-9])+$/.test(clean)) return true;
    if (w.top < tableTop || w.top > tableBottom) return true;
    if (roomText && roomText.split(" ").some(part => part && w.text.includes(part))) return true;
    return false;
  };

  const courseWords = words.filter(w => !isHeader(w));

  // ── 5. Assign course words to weekday rows ───────────────────────────────

  const rowWordsMap: Record<number, SpatialWord[]> = {};
  for (let d = 0; d <= 6; d++) rowWordsMap[d] = [];

  for (const w of courseWords) {
    const yMid = (w.top + w.bottom) / 2;
    for (let d = 0; d <= 6; d++) {
      const [lo, hi] = rowBounds[d];
      if (lo <= yMid && yMid <= hi) {
        rowWordsMap[d].push(w);
        break;
      }
    }
  }

  // ── 6. Cluster words and extract schedule entries ─────────────────────────

  const schedules: ParsedScheduleEntry[] = [];

  for (let d = 0; d <= 6; d++) {
    // Even-period midpoints act as virtual dividers between 2-period blocks
    const blockDividers = [2, 4, 6, 8, 10, 12, 14]
      .filter(p => midpoints[p] !== undefined)
      .map(p => midpoints[p]);

    const cells = clusterWordsInRow(rowWordsMap[d], blockDividers);

    for (const cell of cells) {
      const occupied = new Set<number>();
      for (const w of cell.words) {
        const wMidX = (w.x0 + w.x1) / 2;
        for (let p = 1; p <= 16; p++) {
          const [lo, hi] = colBounds[p];
          if (lo <= wMidX && wMidX <= hi) {
            occupied.add(p);
            break;
          }
        }
      }
      if (occupied.size === 0) continue;

      const sortedP = Array.from(occupied).sort((a, b) => a - b);
      const pStart  = sortedP[0];
      const pEnd    = sortedP[sortedP.length - 1];

      // Use individual 50-min slot maps (no forced snapping — mirrors parse_pdf.py)
      let startTime = PERIOD_START_MAP[pStart];
      let endTime   = PERIOD_END_MAP[pEnd];

      if (!startTime) {
        const h = Math.floor((pStart - 1) / 2) * 2 + 8;
        startTime = `${String(h % 24).padStart(2, '0')}:${pStart % 2 === 1 ? '30' : '20'}`;
      }
      if (!endTime) {
        const h = Math.floor((pEnd - 2) / 2) * 2 + 8;
        endTime = `${String((h + 2) % 24).padStart(2, '0')}:${pEnd % 2 === 0 ? '10' : '20'}`;
      }

      // Reconstruct cell text line-by-line (top-down), words RTL within each line
      const linesMap: Record<number, SpatialWord[]> = {};
      for (const w of cell.words) {
        const lineY = Math.round(w.top);
        let key: number | null = null;
        for (const lyStr of Object.keys(linesMap)) {
          if (Math.abs(lineY - Number(lyStr)) <= 4) { key = Number(lyStr); break; }
        }
        if (key === null) { linesMap[lineY] = []; key = lineY; }
        linesMap[key].push(w);
      }

      const lines: string[] = Object.keys(linesMap)
        .map(Number).sort((a, b) => a - b)
        .map(ly => linesMap[ly].sort((a, b) => b.x0 - a.x0).map(x => x.text).join(" ").trim())
        .filter(Boolean);

      const fullText = lines.join(" / ");

      // Extract English course codes (e.g. EBA1110) and Arabic codes (e.g. نال 101)
      const engCodes   = fullText.match(/\b([A-Za-z]{2,4}\d{3,4}[A-Za-z]?)\b/g) ?? [];
      const arabCodes  = fullText.match(/[\u0600-\u06FF]{2,4}\s*\d{3,4}/g) ?? [];

      let courseCode = "";
      if (engCodes.length > 0) {
        courseCode = Array.from(new Set(engCodes)).sort().join(" / ");
      } else if (arabCodes.length > 0) {
        courseCode = Array.from(new Set(arabCodes)).sort().join(" / ");
      }

      // Extract Arabic professor name from remaining parts
      let professor = "";
      const parts = fullText.split("/").map(p => p.trim()).filter(Boolean);
      for (const part of parts) {
        if (engCodes.some(c => part.includes(c))) continue;
        if (arabCodes.some(c => part.includes(c))) continue;
        if (["طالب", "sec", "lec", "lab"].some(kw => part.toLowerCase().includes(kw))) continue;
        if (/^\d+\s*طالب$/.test(part.toLowerCase())) continue;
        if (/[\u0600-\u06FF]/.test(part) && part.length > 3) {
          professor = part;
          break;
        }
      }

      schedules.push({ dayOfWeek: d, startTime, endTime, courseCode, professor, originalText: fullText });
    }
  }

  // ── 7. Deduplicate and sort ──────────────────────────────────────────────

  const seen = new Set<string>();
  const deduped = schedules.filter(s => {
    const key = `${s.dayOfWeek}|${s.startTime}|${s.endTime}|${s.courseCode}|${s.professor}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) =>
    a.dayOfWeek !== b.dayOfWeek
      ? a.dayOfWeek - b.dayOfWeek
      : a.startTime.localeCompare(b.startTime)
  );

  return {
    pageNumber,
    room: { roomCode, roomType, originalText: roomText },
    schedules: deduped,
    diagnostics: {
      weekdayRowsDetected: Object.keys(finalWeekdays).length,
      periodColsDetected:  Object.keys(finalPeriods).length,
      blocksExtracted:     courseWords.length,
    },
  };
}
