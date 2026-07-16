import { Booking, FixedSchedule } from './types';

export const generateId = () => Math.random().toString(36).substring(2, 9);

export const getLocalDateString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const getCustomDayOfWeek = (dateStr: string): number => {
  if (!dateStr) return 0;
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    return (d.getDay() + 1) % 7;
  }
  const d = new Date(dateStr);
  return (d.getDay() + 1) % 7;
};

export const isRoomCurrentlyBooked = (
  roomId: string, 
  bookings: Booking[], 
  fixedSchedules: FixedSchedule[] = []
): boolean => {
  const now = new Date();
  const currentDate = getLocalDateString();
  const jsDay = now.getDay();
  const customDay = (jsDay + 1) % 7;
  
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;

  // 1. Check manual bookings
  const isBookedManual = bookings.some(b => 
    b.roomId === roomId && 
    b.date === currentDate && 
    b.startTime <= currentTime && 
    b.endTime > currentTime
  );
  if (isBookedManual) return true;

  // 2. Check active recurring schedules
  const isBookedFixed = fixedSchedules.some(fs => 
    fs.roomId === roomId && 
    !fs.disabled && 
    fs.dayOfWeek === customDay && 
    fs.startTime <= currentTime && 
    fs.endTime > currentTime
  );
  return isBookedFixed;
};

export const hasOverlap = (
  roomId: string, 
  date: string, 
  startTime: string, 
  endTime: string, 
  bookings: Booking[],
  fixedSchedules: FixedSchedule[] = [],
  excludeBookingId?: string
): boolean => {
  // 1. Check manual bookings
  const hasManualOverlap = bookings.some(b => 
    b.roomId === roomId &&
    b.id !== excludeBookingId &&
    b.date === date &&
    startTime < b.endTime && 
    endTime > b.startTime
  );
  if (hasManualOverlap) return true;

  // 2. Check active recurring schedules
  const customDay = getCustomDayOfWeek(date);
  const hasFixedOverlap = fixedSchedules.some(fs =>
    fs.roomId === roomId &&
    !fs.disabled &&
    fs.dayOfWeek === customDay &&
    startTime < fs.endTime &&
    endTime > fs.startTime
  );
  return hasFixedOverlap;
};

export const formatTime12Hour = (time24: string): string => {
  if (!time24) return '';
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'م' : 'ص'; // Using Arabic AM/PM (ص/م) to match rtl interface
  const displayHours = hours % 12 || 12;
  return `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period === 'م' ? 'PM' : 'AM'}`;
};

export const cleanArabicText = (text: string): string => {
  if (!text) return "";
  return text
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[\s\-_\(\)]/g, '')
    .toLowerCase();
};

export const calculateLevenshteinDistance = (a: string, b: string): number => {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          )
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

export const calculateFuzzyMatchScore = (str1: string, str2: string): number => {
  const s1 = cleanArabicText(str1);
  const s2 = cleanArabicText(str2);
  if (s1 === s2) return 100;
  
  // Extract only numbers to see if they match exactly (very high confidence for room numbers)
  const num1 = s1.replace(/\D/g, '');
  const num2 = s2.replace(/\D/g, '');
  if (num1 && num2 && num1 === num2) {
    return 95; // Extremely strong confidence if the numerical room code is identical (e.g. 102 in both)
  }
  
  if (s1.includes(s2) || s2.includes(s1)) return 85;
  
  // Levenshtein distance matching
  const distance = calculateLevenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  if (maxLength === 0) return 0;
  return Math.round((1 - distance / maxLength) * 100);
};

export const fixArabicText = (text: string): string => {
  if (!text) return "";
  
  // Normalize Presentation Forms-A and Forms-B to standard Arabic letters
  const normalized = text.normalize('NFKC');
  
  // Identify standard Arabic characters in Unicode block U+0600 - U+06FF
  const isArabicChar = (ch: string) => /[\u0600-\u06FF]/.test(ch);
  
  const len = normalized.length;
  const isArabicIndex = new Array(len).fill(false);
  
  // First pass: mark all indexes containing Arabic characters
  for (let i = 0; i < len; i++) {
    if (isArabicChar(normalized[i])) {
      isArabicIndex[i] = true;
    }
  }
  
  // Second pass: include spaces and common punctuation (like dots, slashes, brackets) 
  // that are strictly between Arabic characters
  for (let i = 0; i < len; i++) {
    if (!isArabicIndex[i] && /[\s\.\-\/\(\)]/.test(normalized[i])) {
      let hasArabicLeft = false;
      for (let j = i - 1; j >= 0; j--) {
        if (isArabicIndex[j]) { hasArabicLeft = true; break; }
        if (!/[\s\.\-\/\(\)]/.test(normalized[j])) break; // stopped by non-Arabic
      }
      let hasArabicRight = false;
      for (let j = i + 1; j < len; j++) {
        if (isArabicIndex[j]) { hasArabicRight = true; break; }
        if (!/[\s\.\-\/\(\)]/.test(normalized[j])) break; // stopped by non-Arabic
      }
      if (hasArabicLeft && hasArabicRight) {
        isArabicIndex[i] = true;
      }
    }
  }
  
  // Reconstruct the string by reversing only the Arabic runs
  let result = "";
  let currentRun = "";
  let currentIsArabic = isArabicIndex[0];
  
  for (let i = 0; i < len; i++) {
    if (isArabicIndex[i] === currentIsArabic) {
      currentRun += normalized[i];
    } else {
      if (currentIsArabic) {
        result += currentRun.split("").reverse().join("");
      } else {
        result += currentRun;
      }
      currentRun = normalized[i];
      currentIsArabic = isArabicIndex[i];
    }
  }
  
  if (currentRun) {
    if (currentIsArabic) {
      result += currentRun.split("").reverse().join("");
    } else {
      result += currentRun;
    }
  }
  
  return result;
};
