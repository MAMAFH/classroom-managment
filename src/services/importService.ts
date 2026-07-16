import { Room, Booking, FixedSchedule, ImportSession } from '../types';
import { calculateFuzzyMatchScore, getCustomDayOfWeek } from '../utils';

export interface FuzzyMatchResult {
  roomId: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
}

export interface PreviewScheduleItem extends FixedSchedule {
  roomName: string;
  hasConflict: boolean;
}

/**
 * Perform robust fuzzy room matching between extracted PDF header text and database rooms
 * using Levenshtein distance metric.
 */
export function fuzzyMatchRoom(extractedText: string, rooms: Room[]): FuzzyMatchResult {
  let bestRoomId = '';
  let highestScore = 0;

  rooms.forEach(r => {
    const score = calculateFuzzyMatchScore(extractedText, r.name);
    if (score > highestScore) {
      highestScore = score;
      bestRoomId = r.id;
    }
  });

  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (highestScore >= 90) {
    confidence = 'high';
  } else if (highestScore >= 75) {
    confidence = 'medium';
  }

  // Only auto-select if confidence is high or solid medium (score >= 75), otherwise require manual mapping
  const roomId = highestScore >= 75 ? bestRoomId : '';

  return {
    roomId,
    confidence,
    score: highestScore
  };
}

/**
 * Cross-references raw parsed PDF schedules with manual bookings and recurring schedules
 * to calculate real-timestamp overlaps and conflicts.
 */
export function checkTimetableConflicts(
  parsedData: any[],
  roomMatches: Record<string, string>,
  rooms: Room[],
  bookings: Booking[],
  fixedSchedules: FixedSchedule[],
  semesterId: string
): PreviewScheduleItem[] {
  const previewList: PreviewScheduleItem[] = [];

  parsedData.forEach((page: any) => {
    const originalText = page.room.originalText;
    const roomId = roomMatches[originalText];
    if (!roomId) return;

    const roomObj = rooms.find(r => r.id === roomId);
    const roomName = roomObj ? roomObj.name : originalText;

    page.schedules.forEach((s: any) => {
      // 1. Check conflict with manual dean bookings
      // Recurring dayOfWeek matches JS day mappings via getCustomDayOfWeek
      // Wait, manual bookings are tied to absolute dates (YYYY-MM-DD), 
      // but recurring schedules are weekly (dayOfWeek).
      // So a conflict occurs if ANY manual booking on the same room falls on the same dayOfWeek 
      // and has overlapping real-time intervals.
      const hasBookingConflict = bookings.some(b => {
        if (b.roomId !== roomId) return false;
        
        // Convert booking date YYYY-MM-DD to customDayOfWeek (Saturday = 0, Sunday = 1, etc.) in a timezone-safe manner
        const bookingCustomDay = getCustomDayOfWeek(b.date);
        
        return (
          bookingCustomDay === s.dayOfWeek &&
          s.startTime < b.endTime &&
          s.endTime > b.startTime
        );
      });

      // 2. Check conflict with existing recurring schedules for the same semester
      const hasFixedConflict = fixedSchedules.some(fs => 
        fs.roomId === roomId &&
        !fs.disabled &&
        fs.semesterId === semesterId &&
        fs.dayOfWeek === s.dayOfWeek &&
        s.startTime < fs.endTime &&
        s.endTime > fs.startTime
      );

      previewList.push({
        id: `preview_${Math.random().toString(36).substring(2, 9)}`,
        roomId,
        roomName,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        courseCode: s.cleanedCourseCode || s.courseCode,
        professor: s.cleanedProfessor || s.professor || '',
        source: 'pdf',
        recurring: true,
        semesterId,
        importSessionId: 'preview_session',
        hasConflict: hasBookingConflict || hasFixedConflict
      });
    });
  });

  return previewList;
}

/**
 * Generate standard, finalized FixedSchedule array ready for persistence.
 */
export function buildFinalFixedSchedules(
  previewSchedules: PreviewScheduleItem[],
  semesterId: string,
  sessionId: string
): FixedSchedule[] {
  return previewSchedules.map(p => ({
    id: `fs_${Math.random().toString(36).substring(2, 9)}`,
    roomId: p.roomId,
    dayOfWeek: p.dayOfWeek,
    startTime: p.startTime,
    endTime: p.endTime,
    courseCode: p.courseCode,
    professor: p.professor,
    source: 'pdf',
    recurring: true,
    semesterId,
    importSessionId: sessionId
  }));
}

/**
 * Generate a deterministic checksum hash of the schedules to prevent duplicate imports.
 */
export function calculateSchedulesChecksum(schedules: Omit<FixedSchedule, 'id' | 'importSessionId'>[]): string {
  const sorted = [...schedules].sort((a, b) => {
    const keyA = `${a.roomId}_${a.dayOfWeek}_${a.startTime}_${a.endTime}_${a.courseCode || ''}_${a.professor || ''}`;
    const keyB = `${b.roomId}_${b.dayOfWeek}_${b.startTime}_${b.endTime}_${b.courseCode || ''}_${b.professor || ''}`;
    return keyA.localeCompare(keyB);
  });
  
  const content = sorted.map(s => `${s.roomId}-${s.dayOfWeek}-${s.startTime}-${s.endTime}-${s.courseCode || ''}-${s.professor || ''}`).join('|');
  
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `hash_${Math.abs(hash).toString(16)}`;
}

/**
 * Create a robust, idempotent ImportSession metadata element.
 */
export function createImportSession(
  fileName: string,
  semesterId: string,
  totalSchedules: number,
  checksum: string
): ImportSession {
  return {
    id: `session_${Math.random().toString(36).substring(2, 9)}`,
    fileName,
    importedAt: new Date().toISOString(),
    checksum,
    semesterId,
    totalSchedules
  };
}
