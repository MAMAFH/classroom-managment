import { GoogleGenAI } from '@google/genai';

export interface GeminiValidationResult {
  pageNumber: number;
  room: {
    roomCode: string;
    roomType: 'lab' | 'classroom';
    originalText: string;
    cleanedName: string;
    suggestedRoomId?: string;
  };
  schedules: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    courseCode: string;
    professor?: string;
    originalText: string;
    cleanedCourseCode: string;
    cleanedCourseName: string;
    cleanedProfessor?: string;
  }>;
  validation: {
    pageConfidence: number; // 0 - 100
    roomConfidence: number; // 0 - 100
    status: 'ready' | 'review' | 'problem';
    warnings: string[];
    anomalies: string[];
    layoutChanged: boolean;
    gapsDetected: string[];
  };
}

export interface GeminiResponse {
  pages: GeminiValidationResult[];
  globalWarnings: string[];
  vocabulary?: {
    professors: string[];
    courseCodes: string[];
    rooms: string[];
  };
}

/**
 * Validates, cleans, and enriches deterministic parser outputs using Gemini AI.
 * Processes all pages in a single request to build a master vocabulary and prevent rate limits.
 */
export async function cleanupAndValidateWithGemini(
  parsedData: any[],
  dbRooms: any[],
  apiKey?: string
): Promise<GeminiResponse> {
  const activeKey = apiKey || process.env.GEMINI_API_KEY;

  if (!activeKey || activeKey === 'MY_GEMINI_API_KEY') {
    console.warn("⚠️ Gemini API Key not set or default. Skipping AI validation layer.");
    return generateFallbackValidation(parsedData, dbRooms);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: activeKey });

    const prompt = `
You are an intelligent validation and quality-assurance system for academic timetables.
We have parsed a PDF containing multiple pages of timetable grids using a deterministic coordinate-based geometry parser.

Your tasks are:
1. **Master Vocabularies Extraction (Reference Lists)**:
   - Extract a master list of all unique professor/instructor names (in Arabic, correctly cleaned of typos and spacing).
   - Extract a master list of all unique course codes (e.g. BIS2103 or Arabic like نال 101, properly formatted).
   - Extract a master list of all unique room names/codes.
     **CRITICAL ROOM FORMATTING RULE**:
     - Rooms in the new building MUST be formatted with "A-" prefix (e.g. "A-305", "A-102").
     - Rooms in the old building MUST NOT have "A-" prefix (e.g. "102", "204").
     - Categorize and clean room names accordingly.

2. **Schedules Correction & Alignment**:
   - Clean up and correct all schedule pages.
   - For every schedule cell, resolve and clean its courseCode, professor name, and room using the master lists you extracted above. Snapping each to the most appropriate item in the master list!
   - Follow standard time rules: standard blocks of 1h40m (e.g., 08:30-10:10, 10:30-12:10, 12:30-14:10, 14:30-16:10, 16:30-18:10, 18:30-20:10). If parsed times are zero-duration or wrong, correct them.

Database Rooms (for ID reference):
${JSON.stringify(dbRooms.map(r => ({ id: r.id, name: r.name, code: r.code, type: r.type })), null, 2)}

Input Raw Parsed PDF Data (All Pages):
${JSON.stringify(parsedData, null, 2)}

Return a single JSON object matching this schema:
{
  "vocabulary": {
    "professors": ["Instructor Name 1", "Instructor Name 2", ...],
    "courseCodes": ["Course Code 1", "Course Code 2", ...],
    "rooms": ["A-305", "102", ...]
  },
  "pages": [
    {
      "pageNumber": 1,
      "room": {
        "roomCode": "cleaned room code (e.g. A-305 or 102)",
        "roomType": "lab or classroom",
        "originalText": "original extracted text",
        "cleanedName": "fully cleaned name (e.g. A-305)",
        "suggestedRoomId": "suggested database room id if matched"
      },
      "schedules": [
        {
          "dayOfWeek": 0,
          "startTime": "HH:MM",
          "endTime": "HH:MM",
          "courseCode": "original course code",
          "professor": "original parsed professor name",
          "originalText": "original cell text",
          "cleanedCourseCode": "cleaned course code matching one in vocabulary.courseCodes",
          "cleanedCourseName": "cleaned course name",
          "cleanedProfessor": "cleaned professor name matching one in vocabulary.professors"
        }
      ],
      "validation": {
        "pageConfidence": 95,
        "roomConfidence": 90,
        "status": "ready", // 'ready' | 'review' | 'problem'
        "warnings": ["Warning details here"],
        "anomalies": ["Anomaly details here"],
        "layoutChanged": false,
        "gapsDetected": []
      }
    }
  ]
}
Output ONLY valid JSON. No markdown backticks or explanations.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const cleanedText = response.text?.trim();
    if (cleanedText) {
      const parsedRes = JSON.parse(cleanedText);
      return {
        pages: parsedRes.pages,
        globalWarnings: [],
        vocabulary: parsedRes.vocabulary
      };
    }
    throw new Error("Empty response from Gemini");

  } catch (error) {
    console.error("❌ Gemini validation failed, falling back to deterministic parser output:", error);
    return generateFallbackValidation(parsedData, dbRooms);
  }
}

/**
 * Local fallback generator if Gemini is unavailable or fails.
 */
export function generateFallbackValidation(parsedData: any[], dbRooms: any[]): GeminiResponse {
  const professorsSet = new Set<string>();
  const courseCodesSet = new Set<string>();
  const roomsSet = new Set<string>();

  const pages: GeminiValidationResult[] = parsedData.map((page: any) => {
    const originalText = page.room.originalText || '';
    
    // Quick regex-based basic cleanup
    let cleanedRoomName = originalText
      .replace(/[\s\-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Fix Arabic OCR typos (e.g. الاثنيـن -> الاثنين)
    cleanedRoomName = cleanedRoomName.replace(/ الاثنيـن /g, ' الاثنين ');

    // Apply the "A-" building room formatting rule locally too
    if (cleanedRoomName.includes('جديد') || /^[a-zA-Z]\s*\d+/.test(cleanedRoomName)) {
      const match = cleanedRoomName.match(/([a-zA-Z])\s*(\d+)/);
      if (match) {
        cleanedRoomName = `${match[1].toUpperCase()}-${match[2]}`;
      } else if (!cleanedRoomName.startsWith('A-')) {
        const numOnly = cleanedRoomName.replace(/\D/g, '');
        if (numOnly) cleanedRoomName = `A-${numOnly}`;
      }
    } else {
      // Old building room - no "A-"
      cleanedRoomName = cleanedRoomName.replace(/[a-zA-Z]\-?/g, '').trim();
    }

    roomsSet.add(cleanedRoomName);

    // Basic course cleanups
    const schedules = (page.schedules || []).map((s: any) => {
      const cleanText = (s.originalText || '')
        .replace(/\s+/g, ' ')
        .trim();
      
      const courseCodeClean = (s.courseCode || '')
        .replace(/\s+/g, '')
        .trim();

      const profClean = (s.professor || '').trim();

      if (courseCodeClean) courseCodesSet.add(courseCodeClean);
      if (profClean) professorsSet.add(profClean);

      return {
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        courseCode: s.courseCode,
        professor: s.professor || '',
        originalText: s.originalText,
        cleanedCourseCode: courseCodeClean,
        cleanedCourseName: cleanText,
        cleanedProfessor: profClean
      };
    });

    // Detect basic anomalies deterministically
    const warnings: string[] = [];
    const anomalies: string[] = [];

    // 1. Completion check
    const expectedBlocks = page.diagnostics?.blocksExtracted || 0;
    const actualBlocks = schedules.length;
    let pageConfidence = 100;
    
    if (expectedBlocks > 0 && actualBlocks < expectedBlocks / 2) {
      pageConfidence = 60;
      warnings.push(`عدد الخلايا المستخرجة (${actualBlocks}) أقل بكثير من المتوقع (${expectedBlocks}). يرجى مراجعة الصفحة.`);
    }

    // 2. Schedule checks
    schedules.forEach((s: any) => {
      if (s.startTime >= s.endTime) {
        anomalies.push(`وقت غير منطقي: وقت البداية ${s.startTime} أكبر من أو يساوي وقت النهاية ${s.endTime}`);
        pageConfidence = Math.min(pageConfidence, 50);
      }
      if (s.startTime < '08:30' || s.endTime > '20:10') {
        anomalies.push(`خارج ساعات العمل: وقت المحاضرة (${s.startTime} - ${s.endTime}) خارج فترات العمل الرسمية.`);
        pageConfidence = Math.min(pageConfidence, 80);
      }
    });

    // 3. Status determination
    let status: 'ready' | 'review' | 'problem' = 'ready';
    if (pageConfidence < 70 || anomalies.length > 0) {
      status = 'problem';
    } else if (pageConfidence < 90 || warnings.length > 0) {
      status = 'review';
    }

    return {
      pageNumber: page.pageNumber,
      room: {
        roomCode: page.room.roomCode || '',
        roomType: page.room.roomType || 'classroom',
        originalText,
        cleanedName: cleanedRoomName,
      },
      schedules,
      validation: {
        pageConfidence,
        roomConfidence: 100,
        status,
        warnings,
        anomalies,
        layoutChanged: false,
        gapsDetected: []
      }
    };
  });

  return {
    pages,
    globalWarnings: [],
    vocabulary: {
      professors: Array.from(professorsSet),
      courseCodes: Array.from(courseCodesSet),
      rooms: Array.from(roomsSet)
    }
  };
}
