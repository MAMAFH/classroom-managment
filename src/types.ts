export interface Room {
  id: string;
  name: string;
  capacity: number;
  building?: 'old' | 'new';
  code?: string;
  type?: 'lab' | 'classroom';
  source?: 'pdf-import' | 'manual';
}

export interface Booking {
  id: string;
  roomId: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  courseCode?: string;
  professor?: string;
}

export interface FixedSchedule {
  id: string;
  roomId: string;
  dayOfWeek: number; // 0: Sat, 1: Sun, 2: Mon, 3: Tue, 4: Wed, 5: Thu, 6: Fri
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  courseCode?: string;
  professor?: string;
  sessionType?: string;
  source: 'pdf';
  recurring: true;
  semesterId: string;
  importSessionId: string;
  disabled?: boolean;
}

export interface ImportSession {
  id: string;
  fileName: string;
  importedAt: string; // ISO Date String
  checksum: string;
  semesterId: string;
  totalSchedules: number;
}
