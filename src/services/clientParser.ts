import { FixedSchedule } from '../types';

// Arabic Weekday Mapping (standard + shape-joined Presentation Forms-B variations)
const WEEKDAY_MAP: Record<string, number> = {
  "السبت": 0, "ﺖﺒﺴﻟا": 0, "السبت ": 0,
  "الأحد": 1, "ﺪﺣﻷا": 1, "الأحد ": 1, "ﺪﺣأ": 1,
  "الاثنين": 2, "الإثنين": 2, "ﻦﯿﻨﺛﻹا": 2, "ﻦﯿﻨﺛﻻا": 2,
  "الثلاثاء": 3, "ءﺎﺛﻼﺜﻟا": 3,
  "الأربعاء": 4, "ءﺎﻌﺑرﻷا": 4,
  "الخميس": 5, "ﺲﯿﻤﺨﻟا": 5,
  "الجمعة": 6, "ﺔﻌﻤﺠﻟا": 6, "الجمعة ": 6
};

// 2-period lecture block time map.
// Odd periods (1,3,5...) = block START times; even periods (2,4,6...) = block END times.
// Each block is 100 minutes (1h40m) with 20-minute breaks between blocks.
export const PERIOD_TIME_MAP: Record<number, string> = {
  1:  "08:30",
  2:  "10:10",
  3:  "10:30",
  4:  "12:10",
  5:  "12:30",
  6:  "14:10",
  7:  "14:30",
  8:  "16:10",
  9:  "16:30",
  10: "18:10",
  11: "18:30",
  12: "20:10",
  13: "20:30",
  14: "22:10",
  15: "22:30",
  16: "00:10",
};

// Aliases so other code can import these names without breakage
export const PERIOD_START_MAP = PERIOD_TIME_MAP;
export const PERIOD_END_MAP   = PERIOD_TIME_MAP;

/**
 * Normalize Arabic-Indic numerals to standard western digits.
 */
function translateArabicDigits(text: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const englishDigits = "0123456789";
  return text.split('').map(char => {
    const idx = arabicDigits.indexOf(char);
    return idx !== -1 ? englishDigits[idx] : char;
  }).join('');
}

/**
 * Interpolate period columns (1 to 16) dynamically.
 */
function interpolatePeriodCenters(detectedCenters: Record<number, number>, pageWidth: number): number[] {
  const centers = new Array(17).fill(null);
  for (const [pStr, x] of Object.entries(detectedCenters)) {
    const p = Number(pStr);
    if (p >= 1 && p <= 16) {
      centers[p] = x;
    }
  }

  const knownPeriods = Object.keys(detectedCenters).map(Number).filter(p => p >= 1 && p <= 16).sort((a, b) => a - b);

  if (knownPeriods.length === 0) {
    const leftMargin = 35.0;
    const rightMargin = 770.0;
    const colWidth = (rightMargin - leftMargin) / 16;
    for (let p = 1; p <= 16; p++) {
      centers[p] = rightMargin - (p - 0.5) * colWidth;
    }
    return centers;
  }

  // Estimate column width dynamically from known periods
  let colWidth = 45.0;
  if (knownPeriods.length >= 2) {
    const diffs: number[] = [];
    for (let idx = 0; idx < knownPeriods.length - 1; idx++) {
      const p1 = knownPeriods[idx];
      const p2 = knownPeriods[idx + 1];
      const diff = Math.abs(detectedCenters[p2] - detectedCenters[p1]) / (p2 - p1);
      if (diff > 10) {
        diffs.push(diff);
      }
    }
    if (diffs.length > 0) {
      colWidth = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }
  }

  if (knownPeriods.length === 1) {
    const k = knownPeriods[0];
    const val = detectedCenters[k];
    for (let p = 1; p <= 16; p++) {
      centers[p] = val - (p - k) * colWidth;
    }
    return centers;
  }

  for (let p = 1; p <= 16; p++) {
    if (centers[p] !== null) continue;
    const smaller = knownPeriods.filter(kp => kp < p);
    const larger = knownPeriods.filter(kp => kp > p);

    if (smaller.length > 0 && larger.length > 0) {
      const k1 = smaller[smaller.length - 1];
      const k2 = larger[0];
      const x1 = detectedCenters[k1];
      const x2 = detectedCenters[k2];
      centers[p] = x1 + (p - k1) * (x2 - x1) / (k2 - k1);
    } else if (smaller.length > 0) {
      const k1 = smaller.length >= 2 ? smaller[smaller.length - 2] : smaller[smaller.length - 1];
      const k2 = smaller[smaller.length - 1];
      const x1 = detectedCenters[k1];
      const x2 = detectedCenters[k2];
      if (k2 === k1) {
        centers[p] = x2 - (p - k2) * colWidth;
      } else {
        centers[p] = x2 + (p - k2) * (x2 - x1) / (k2 - k1);
      }
    } else {
      const k1 = larger[0];
      const k2 = larger.length >= 2 ? larger[1] : larger[0];
      const x1 = detectedCenters[k1];
      const x2 = detectedCenters[k2];
      if (k2 === k1) {
        centers[p] = x1 + (k1 - p) * colWidth;
      } else {
        centers[p] = x1 - (k1 - p) * (x2 - x1) / (k2 - k1);
      }
    }
  }
  return centers;
}

/**
 * Interpolate weekday rows (Saturday to Thursday).
 */
function interpolateWeekdayCenters(detectedWeekdays: Record<number, number>): [number[], number] {
  const centers = new Array(7).fill(null);
  for (const [dStr, y] of Object.entries(detectedWeekdays)) {
    const d = Number(dStr);
    if (d >= 0 && d <= 6) {
      centers[d] = y;
    }
  }

  const knownDays = Object.keys(detectedWeekdays).map(Number).filter(d => d >= 0 && d <= 6).sort((a, b) => a - b);

  // Estimate row height dynamically from known days
  let rowHeight = 55.46;
  if (knownDays.length >= 2) {
    const diffs: number[] = [];
    for (let idx = 0; idx < knownDays.length - 1; idx++) {
      const d1 = knownDays[idx];
      const d2 = knownDays[idx + 1];
      const diff = (detectedWeekdays[d2] - detectedWeekdays[d1]) / (d2 - d1);
      if (diff > 10) {
        diffs.push(diff);
      }
    }
    if (diffs.length > 0) {
      rowHeight = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }
  }

  if (knownDays.length === 0) {
    for (let d = 0; d <= 6; d++) {
      centers[d] = 120.0 + d * rowHeight;
    }
    return [centers, rowHeight];
  }

  if (knownDays.length === 1) {
    const k = knownDays[0];
    const val = detectedWeekdays[k];
    for (let d = 0; d <= 6; d++) {
      centers[d] = val + (d - k) * rowHeight;
    }
    return [centers, rowHeight];
  }

  for (let d = 0; d <= 6; d++) {
    if (centers[d] !== null) continue;
    const smaller = knownDays.filter(kd => kd < d);
    const larger = knownDays.filter(kd => kd > d);

    if (smaller.length > 0 && larger.length > 0) {
      const k1 = smaller[smaller.length - 1];
      const k2 = larger[0];
      const y1 = detectedWeekdays[k1];
      const y2 = detectedWeekdays[k2];
      centers[d] = y1 + (d - k1) * (y2 - y1) / (k2 - k1);
    } else if (smaller.length > 0) {
      const k1 = smaller.length >= 2 ? smaller[smaller.length - 2] : smaller[smaller.length - 1];
      const k2 = smaller[smaller.length - 1];
      const y1 = detectedWeekdays[k1];
      const y2 = detectedWeekdays[k2];
      if (k2 === k1) {
        centers[d] = y2 + (d - k2) * rowHeight;
      } else {
        centers[d] = y2 + (d - k2) * (y2 - y1) / (k2 - k1);
      }
    } else {
      const k1 = larger[0];
      const k2 = larger.length >= 2 ? larger[1] : larger[0];
      const y1 = detectedWeekdays[k1];
      const y2 = detectedWeekdays[k2];
      if (k2 === k1) {
        centers[d] = y1 - (k1 - d) * rowHeight;
      } else {
        centers[d] = y1 - (k1 - d) * (y2 - y1) / (k2 - k1);
      }
    }
  }
  return [centers, rowHeight];
}

interface SpatialWord {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

interface ClusteredCell {
  words: SpatialWord[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

/**
 * Cluster words horizontally on a given weekday row.
 */
function clusterWordsInRow(rowWords: SpatialWord[], dividers: number[] = [], horizontalTolerance = 35): ClusteredCell[] {
  if (rowWords.length === 0) return [];

  // Sort right-to-left (descending X0)
  const sortedWords = [...rowWords].sort((a, b) => b.x0 - a.x0);

  const cells: ClusteredCell[] = [];
  for (const w of sortedWords) {
    let merged = false;
    for (const cell of cells) {
      const gap = Math.max(0, w.x0 - cell.x1, cell.x0 - w.x1);
      if (gap <= horizontalTolerance) {
        // Check if there is a vertical divider between the word and the cell
        const wLeft = Math.min(w.x0, w.x1);
        const wRight = Math.max(w.x0, w.x1);
        const cellLeft = cell.x0;
        const cellRight = cell.x1;

        const xMin = Math.min(wRight, cellLeft);
        const xMax = Math.max(wLeft, cellRight);

        const dividersBetween = dividers.filter(x => xMin < x && x < xMax);
        if (dividersBetween.length > 0) {
          continue;
        }

        cell.words.push(w);
        cell.x0 = Math.min(cell.x0, w.x0);
        cell.x1 = Math.max(cell.x1, w.x1);
        cell.top = Math.min(cell.top, w.top);
        cell.bottom = Math.max(cell.bottom, w.bottom);
        merged = true;
        break;
      }
    }
    if (!merged) {
      cells.push({
        words: [w],
        x0: w.x0,
        x1: w.x1,
        top: w.top,
        bottom: w.bottom
      });
    }
  }
  return cells;
}

/**
 * Load PDF.js from CDN dynamically if not already loaded.
 */
function loadPdfJS(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      const pdfjsLib = (window as any).pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(pdfjsLib);
    };
    script.onerror = () => {
      reject(new Error('فشل تحميل مكتبة قارئ ملفات PDF (PDF.js). تأكد من اتصالك بالإنترنت.'));
    };
    document.head.appendChild(script);
  });
}

/**
 * Parses a single PDF page on the client side using the visual grid algorithm.
 */
async function parseClientPage(page: any, pageNumber: number): Promise<any> {
  const textContent = await page.getTextContent();
  const rawElements: any[] = [];

  // PDF.js uses bottom-up coordinates. Standard landscape height is typically 594.96.
  const viewport = page.getViewport({ scale: 1.0 });
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;

  textContent.items.forEach((item: any) => {
    if (item.str && item.str.trim()) {
      const x = item.transform[4];
      const y = item.transform[5];
      // Convert to top-down coordinates: top=0 at very top, bottom=pageHeight at bottom
      const top = pageHeight - y - (item.height || 10);
      const bottom = pageHeight - y;

      rawElements.push({
        text: item.str,
        x0: x,
        x1: x + (item.width || 10),
        top: top,
        bottom: bottom
      });
    }
  });

  if (rawElements.length === 0) return null;

  // 1. Extract Room Code / Name from top header section (top < 75)
  const headerWords = rawElements.filter(w => w.top < 75);
  let roomText = "";
  let roomCode = `قاعة ${pageNumber}`;
  let roomType: 'lab' | 'classroom' = 'classroom';

  // Sort header words left-to-right
  const sortedHeader = [...headerWords].sort((a, b) => a.x0 - b.x0);
  const roomTokens: string[] = [];

  for (const w of sortedHeader) {
    const text = w.text;
    if (["معمل", "ﻞﻤﻌﻣ", "فصل", "ﻞﺼﻓ", "قاعة", "تﺎﻋﺎﻗ", "ﺔﻋﺎﻗ"].some(kw => text.includes(kw))) {
      if (text.includes("معمل") || text.includes("ﻞﻤﻌﻣ")) {
        roomType = 'lab';
      }
      roomTokens.push(text);
    } else if (/([A-Za-z0-9\u0660-\u0669\-_]+)/.test(text)) {
      const tokenClean = translateArabicDigits(text);
      if (/\d/.test(tokenClean)) { // must contain a digit
        roomCode = tokenClean.replace("-", "").trim();
        roomTokens.push(text);
      }
    }
  }

  if (roomTokens.length > 0) {
    roomText = roomTokens.join(" ");
  } else {
    const topWords = [...rawElements].sort((a, b) => a.top - b.top);
    if (topWords.length > 0) {
      roomText = topWords[0].text;
      roomCode = roomText.replace(/\D/g, '') || `${pageNumber}`;
    }
  }

  // 2. Detect Weekday Row Centers (Y coords)
  const detectedWeekdays: Record<number, number[]> = {};
  rawElements.forEach(w => {
    const text = w.text;
    for (const [dayName, dayIdx] of Object.entries(WEEKDAY_MAP)) {
      if (text === dayName || text.includes(dayName)) {
        if (!detectedWeekdays[dayIdx]) {
          detectedWeekdays[dayIdx] = [];
        }
        detectedWeekdays[dayIdx].push((w.top + w.bottom) / 2);
      }
    }
  });

  const finalWeekdays: Record<number, number> = {};
  for (const [dStr, coords] of Object.entries(detectedWeekdays)) {
    const d = Number(dStr);
    finalWeekdays[d] = coords.reduce((a, b) => a + b, 0) / coords.length;
  }

  // Interpolate missing weekdays
  const [yCenters, rowHeight] = interpolateWeekdayCenters(finalWeekdays);

  // Define vertical bounds for each weekday row
  const rowBounds: Record<number, [number, number]> = {};
  for (let d = 0; d <= 6; d++) {
    const yMid = yCenters[d];
    rowBounds[d] = [yMid - (rowHeight / 2) - 2, yMid + (rowHeight / 2) + 2];
  }

  // 3. Detect Period Column Centers (X coords, periods 1 to 16)
  const detectedPeriods: Record<number, number[]> = {};
  rawElements.forEach(w => {
    if (w.top > 105) return; // Headers are always near top
    const text = translateArabicDigits(w.text);
    if (/^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 16) {
      const val = Number(text);
      if (!detectedPeriods[val]) {
        detectedPeriods[val] = [];
      }
      detectedPeriods[val].push((w.x0 + w.x1) / 2);
    } else {
      // Match concatenated period headers e.g. "161514131211" or "16151413"
      const matches = text.match(/(16|15|14|13|12|11|10|[1-9])/g);
      if (matches && matches.join("") === text) {
        const width = w.x1 - w.x0;
        const n = matches.length;
        const colW = width / n;
        matches.forEach((numStr, idx) => {
          const val = Number(numStr);
          const centerX = w.x0 + (idx + 0.5) * colW;
          if (!detectedPeriods[val]) {
            detectedPeriods[val] = [];
          }
          detectedPeriods[val].push(centerX);
        });
      }
    }
  });

  const finalPeriods: Record<number, number> = {};
  for (const [pStr, centers] of Object.entries(detectedPeriods)) {
    const p = Number(pStr);
    finalPeriods[p] = centers.reduce((a, b) => a + b, 0) / centers.length;
  }

  // Interpolate all 16 period centers
  const colCenters = interpolatePeriodCenters(finalPeriods, pageWidth);

  // Calculate column boundaries using midpoints
  const colBounds: Record<number, [number, number]> = {};
  const midpoints: Record<number, number> = {};
  for (let p = 1; p <= 15; p++) {
    midpoints[p] = (colCenters[p] + colCenters[p + 1]) / 2;
  }

  for (let p = 1; p <= 16; p++) {
    const leftB = p === 16 ? 0 : midpoints[p];
    const rightB = p === 1 ? pageWidth : midpoints[p - 1];
    colBounds[p] = [leftB, rightB];
  }

  // 4. Filter out headers to leave course schedule text
  const isHeaderWord = (w: SpatialWord): boolean => {
    const text = w.text;
    if (Object.keys(WEEKDAY_MAP).some(day => text.includes(day))) return true;
    const cleanText = translateArabicDigits(text);
    if (/^\d+$/.test(cleanText) && Number(cleanText) >= 1 && Number(cleanText) <= 16) return true;
    if (/^(16|15|14|13|12|11|10|[1-9])+$/.test(cleanText)) return true;
    if (w.top < 90 || w.top > 440) return true;
    if (roomText && roomText.split(" ").some(part => text.includes(part))) return true;
    return false;
  };

  const courseWords = rawElements.filter(w => !isHeaderWord(w));

  // 5. Assign course words to weekday rows
  const rowWordsMap: Record<number, SpatialWord[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  courseWords.forEach(w => {
    const yMid = (w.top + w.bottom) / 2;
    for (let d = 0; d <= 6; d++) {
      const [l, r] = rowBounds[d];
      if (l <= yMid && yMid <= r) {
        rowWordsMap[d].push(w);
        break;
      }
    }
  });

  // 6. Cluster words on each row into visual cells & parse them
  const schedules: any[] = [];

  for (let d = 0; d <= 6; d++) {
    // Construct standard 2-period slot block dividers as virtual borders
    const blockDividers = [2, 4, 6, 8, 10, 12, 14]
      .filter(p => midpoints[p] !== undefined)
      .map(p => midpoints[p]);
      
    const cells = clusterWordsInRow(rowWordsMap[d], blockDividers);
    cells.forEach(cell => {
      const occupiedPeriods = new Set<number>();
      cell.words.forEach(w => {
        const wMidX = (w.x0 + w.x1) / 2;
        for (let p = 1; p <= 16; p++) {
          const [l, r] = colBounds[p];
          if (l <= wMidX && wMidX <= r) {
            occupiedPeriods.add(p);
          }
        }
      });

      if (occupiedPeriods.size === 0) return;

      const sortedPeriods = Array.from(occupiedPeriods).sort((a, b) => a - b);
      let pStart = sortedPeriods[0];
      let pEnd = sortedPeriods[sortedPeriods.length - 1];

      // Snap to 2-period lecture block boundaries:
      //   odd pStart → already the block open; even pStart → pull back to the odd opener
      //   even pEnd  → already the block close; odd pEnd  → push forward to the even closer
      if (pStart % 2 === 0) pStart = Math.max(1, pStart - 1);
      if (pEnd   % 2 === 1) pEnd   = Math.min(16, pEnd + 1);

      let startTime = PERIOD_TIME_MAP[pStart];
      let endTime   = PERIOD_TIME_MAP[pEnd];

      if (!startTime) {
        const h = Math.floor((pStart - 1) / 2) * 2 + 8;
        startTime = `${String(h % 24).padStart(2, '0')}:30`;
      }
      if (!endTime) {
        const h = Math.floor((pEnd - 2) / 2) * 2 + 8;
        endTime = `${String((h + 2) % 24).padStart(2, '0')}:10`;
      }

      // Reconstruct cell text preserving RTL Arabic layout
      const linesMap: Record<number, SpatialWord[]> = {};
      cell.words.forEach(w => {
        const lineY = Math.round(w.top);
        let matchedLine: number | null = null;
        for (const lyStr of Object.keys(linesMap)) {
          const ly = Number(lyStr);
          if (Math.abs(lineY - ly) <= 4) {
            matchedLine = ly;
            break;
          }
        }
        if (matchedLine === null) {
          linesMap[lineY] = [];
          matchedLine = lineY;
        }
        linesMap[matchedLine].push(w);
      });

      const reconstructedLines: string[] = [];
      const sortedKeys = Object.keys(linesMap).map(Number).sort((a, b) => a - b);
      sortedKeys.forEach(ly => {
        const sortedLineWords = [...linesMap[ly]].sort((a, b) => b.x0 - a.x0);
        const lineText = sortedLineWords.map(x => x.text).join(" ").trim();
        if (lineText) {
          reconstructedLines.push(lineText);
        }
      });

      const fullText = reconstructedLines.join(" / ");

      // Extract clean course codes (e.g. EBA1110, BFN3110)
      const courseCodesMatch = fullText.match(/\b([A-Za-z]{2,4}\d{3,4}[A-Za-z]?)\b/g);
      const arabicCodesMatch = fullText.match(/[\u0600-\u06FF]{2,4}\s*\d{3,4}/g);
      
      let courseCode = "";
      if (courseCodesMatch) {
        courseCode = Array.from(new Set(courseCodesMatch)).sort().join(" / ");
      } else if (arabicCodesMatch) {
        courseCode = Array.from(new Set(arabicCodesMatch)).sort().join(" / ");
      }

      // Extract professor name in Arabic
      let professor = "";
      const parts = fullText.split("/").map(p => p.trim());
      for (const part of parts) {
        if (!part) continue;
        if (courseCodesMatch && courseCodesMatch.some(c => part.includes(c))) continue;
        if (arabicCodesMatch && arabicCodesMatch.some(c => part.includes(c))) continue;
        
        const cleanPart = part.toLowerCase();
        if (["طالب", "sec", "lec", "lab"].some(kw => cleanPart.includes(kw))) continue;
        if (/^\d+\s*طالب$/.test(cleanPart)) continue;
        
        if (/[\u0600-\u06FF]/.test(part) && part.length > 3) {
          professor = part;
          break;
        }
      }

      schedules.push({
        dayOfWeek: d,
        startTime,
        endTime,
        courseCode,
        professor,
        originalText: fullText
      });
    });
  }

  // Deduplicate exact duplicate schedules (same day + time + course + professor)
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const s of schedules) {
    const key = `${s.dayOfWeek}|${s.startTime}|${s.endTime}|${s.courseCode}|${s.professor}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }

  // Sort schedules chronologically
  deduped.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startTime.localeCompare(b.startTime);
  });
  schedules.length = 0;
  deduped.forEach(s => schedules.push(s));

  return {
    room: {
      roomCode,
      roomType,
      originalText: roomText
    },
    schedules,
    diagnostics: {
      weekdayRowsDetected: Object.keys(finalWeekdays).length,
      periodColsDetected: Object.keys(finalPeriods).length,
      blocksExtracted: courseWords.length
    }
  };
}

/**
 * Parses a timetable PDF file 100% on the client-side (in-browser) using PDF.js.
 */
export async function parsePdfOnClient(file: File): Promise<any> {
  const pdfjsLib = await loadPdfJS();
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const arrayBuffer = e.target.result;
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pagesData: any[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const parsed = await parseClientPage(page, i);
          if (parsed) {
            parsed.pageNumber = i;
            pagesData.push(parsed);
          }
        }

        resolve({
          success: true,
          totalPages: pdf.numPages,
          parsedPages: pagesData.length,
          data: pagesData
        });

      } catch (err: any) {
        reject(new Error(`فشل تحليل ملف PDF محلياً: ${err.message}`));
      }
    };
    reader.onerror = () => {
      reject(new Error('فشل قراءة الملف المرفوع.'));
    };
    reader.readAsArrayBuffer(file);
  });
}
