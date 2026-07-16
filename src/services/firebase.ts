import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  writeBatch,
  query,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';
import { Room, Booking, FixedSchedule, ImportSession } from '../types';

// ─── Firebase Configuration ──────────────────────────────────────────────────
// All keys come from Vite environment variables (VITE_* prefix required).
// Set them in .env.local for local dev, and in Vercel dashboard for production.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID || '',
};

const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.storageBucket &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId
);

let db: any = null;

if (isFirebaseConfigured) {
  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    db = getFirestore(app);
  } catch (error) {
    console.warn('Firebase init skipped:', error);
  }
}

export { db };

function ensureDb() {
  if (!db) {
    throw new Error('Firebase is not configured. Set the VITE_FIREBASE_* environment variables.');
  }
  return db;
}

// ─── Collection references ────────────────────────────────────────────────────
const roomsCol          = () => collection(ensureDb(), 'rooms');
const bookingsCol       = () => collection(ensureDb(), 'bookings');
const fixedSchedulesCol = () => collection(ensureDb(), 'fixedSchedules');
const importSessionsCol = () => collection(ensureDb(), 'importSessions');

// ─── Helper: snapshot → typed array ──────────────────────────────────────────
function snapshotToArray<T>(snap: QuerySnapshot<DocumentData>): T[] {
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
}

// ─── ROOMS ───────────────────────────────────────────────────────────────────

export async function getRooms(): Promise<Room[]> {
  if (!db) return [];
  const snap = await getDocs(roomsCol());
  return snapshotToArray<Room>(snap);
}

/** Upsert a single room using its id as the document key. */
export async function saveRoom(room: Room): Promise<void> {
  if (!db) return;
  const { id, ...data } = room;
  await setDoc(doc(ensureDb(), 'rooms', id), data);
}

/** Upsert an entire rooms array (batch write). */
export async function saveAllRooms(rooms: Room[]): Promise<void> {
  if (!db) return;
  const batch = writeBatch(ensureDb());
  rooms.forEach(room => {
    const { id, ...data } = room;
    batch.set(doc(ensureDb(), 'rooms', id), data);
  });
  await batch.commit();
}

export async function deleteRoom(id: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(ensureDb(), 'rooms', id));
}

// ─── BOOKINGS ─────────────────────────────────────────────────────────────────

export async function getBookings(): Promise<Booking[]> {
  if (!db) return [];
  const snap = await getDocs(bookingsCol());
  return snapshotToArray<Booking>(snap);
}

/** Add a new booking. Uses the pre-generated id as the Firestore document key. */
export async function addBookingToFirebase(booking: Booking): Promise<void> {
  if (!db) return;
  const { id, ...data } = booking;
  await setDoc(doc(ensureDb(), 'bookings', id), data);
}

export async function deleteBookingFromFirebase(id: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(ensureDb(), 'bookings', id));
}

export async function updateBookingInFirebase(id: string, data: Omit<Booking, 'id'>): Promise<void> {
  if (!db) return;
  await updateDoc(doc(ensureDb(), 'bookings', id), data);
}

export async function deleteBookingsFromFirebase(ids: string[]): Promise<void> {
  if (!db) return;
  const batch = writeBatch(ensureDb());
  ids.forEach(id => batch.delete(doc(ensureDb(), 'bookings', id)));
  await batch.commit();
}

// ─── FIXED SCHEDULES ─────────────────────────────────────────────────────────

export async function getFixedSchedules(): Promise<FixedSchedule[]> {
  const snap = await getDocs(fixedSchedulesCol());
  return snapshotToArray<FixedSchedule>(snap);
}

/** Batch-upsert fixed schedules (used after PDF import). */
export async function saveFixedSchedules(schedules: FixedSchedule[]): Promise<void> {
  if (!db) return;
  // Firestore batch limit is 500 writes — chunk if needed
  const chunkSize = 490;
  for (let i = 0; i < schedules.length; i += chunkSize) {
    const chunk = schedules.slice(i, i + chunkSize);
    const batch = writeBatch(ensureDb());
    chunk.forEach(s => {
      const { id, ...data } = s;
      batch.set(doc(ensureDb(), 'fixedSchedules', id), data);
    });
    await batch.commit();
  }
}

/** Delete all fixed schedules belonging to a specific semester (before re-import). */
export async function deleteFixedSchedulesBySemester(semesterId: string): Promise<void> {
  if (!db) return;
  const snap = await getDocs(fixedSchedulesCol());
  const toDelete = snap.docs.filter(d => (d.data() as FixedSchedule).semesterId === semesterId);
  const chunkSize = 490;
  for (let i = 0; i < toDelete.length; i += chunkSize) {
    const batch = writeBatch(ensureDb());
    toDelete.slice(i, i + chunkSize).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

export async function deleteFixedSchedulesByIds(ids: string[]): Promise<void> {
  if (!db) return;
  const chunkSize = 490;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = writeBatch(ensureDb());
    ids.slice(i, i + chunkSize).forEach(id => batch.delete(doc(ensureDb(), 'fixedSchedules', id)));
    await batch.commit();
  }
}

export async function toggleFixedScheduleInFirebase(id: string, disabled: boolean): Promise<void> {
  if (!db) return;
  await updateDoc(doc(ensureDb(), 'fixedSchedules', id), { disabled });
}

// ─── IMPORT SESSIONS ──────────────────────────────────────────────────────────

export async function getImportSessions(): Promise<ImportSession[]> {
  if (!db) return [];
  const snap = await getDocs(importSessionsCol());
  return snapshotToArray<ImportSession>(snap);
}

export async function saveImportSession(session: ImportSession): Promise<void> {
  if (!db) return;
  const { id, ...data } = session;
  await setDoc(doc(ensureDb(), 'importSessions', id), data);
}

/** Delete an import session AND all its associated fixed schedules atomically. */
export async function deleteImportSessionWithSchedules(sessionId: string): Promise<void> {
  if (!db) return;
  const snap = await getDocs(fixedSchedulesCol());
  const toDelete = snap.docs.filter(
    d => (d.data() as FixedSchedule).importSessionId === sessionId
  );
  // Delete in chunks
  const chunkSize = 489; // leave 1 slot for the session doc
  for (let i = 0; i < toDelete.length; i += chunkSize) {
    const batch = writeBatch(db);
    toDelete.slice(i, i + chunkSize).forEach(d => batch.delete(d.ref));
    if (i + chunkSize >= toDelete.length) {
      // Last chunk — also delete the session itself
      batch.delete(doc(ensureDb(), 'importSessions', sessionId));
    }
    await batch.commit();
  }
  // Edge case: no schedules existed, still delete session
  if (toDelete.length === 0) {
    await deleteDoc(doc(ensureDb(), 'importSessions', sessionId));
  }
}

/** Delete import sessions for a given semester (used before re-import). */
export async function deleteImportSessionsBySemester(semesterId: string): Promise<void> {
  if (!db) return;
  const snap = await getDocs(importSessionsCol());
  const batch = writeBatch(ensureDb());
  snap.docs.forEach(d => {
    if ((d.data() as ImportSession).semesterId === semesterId) {
      batch.delete(d.ref);
    }
  });
  await batch.commit();
}

// ─── BULK CLEAR OPERATIONS ────────────────────────────────────────────────────

export async function clearAllData(seedRooms: Room[]): Promise<void> {
  if (!db) return;
  const [bSnap, fsSnap, isSnap, rSnap] = await Promise.all([
    getDocs(bookingsCol()),
    getDocs(fixedSchedulesCol()),
    getDocs(importSessionsCol()),
    getDocs(roomsCol()),
  ]);
  const batch = writeBatch(db);
  bSnap.docs.forEach(d => batch.delete(d.ref));
  fsSnap.docs.forEach(d => batch.delete(d.ref));
  isSnap.docs.forEach(d => batch.delete(d.ref));
  rSnap.docs.forEach(d => batch.delete(d.ref));
  // Reset rooms back to seeds
  seedRooms.forEach(room => {
    const { id, ...data } = room;
    batch.set(doc(db, 'rooms', id), data);
  });
  await batch.commit();
}

export async function clearAllSchedules(): Promise<void> {
  if (!db) return;
  const [bSnap, fsSnap, isSnap] = await Promise.all([
    getDocs(bookingsCol()),
    getDocs(fixedSchedulesCol()),
    getDocs(importSessionsCol()),
  ]);
  const batch = writeBatch(db);
  bSnap.docs.forEach(d => batch.delete(d.ref));
  fsSnap.docs.forEach(d => batch.delete(d.ref));
  isSnap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

export async function clearAllRoomsAndData(): Promise<void> {
  if (!db) return;
  const [rSnap, bSnap, fsSnap, isSnap] = await Promise.all([
    getDocs(roomsCol()),
    getDocs(bookingsCol()),
    getDocs(fixedSchedulesCol()),
    getDocs(importSessionsCol()),
  ]);
  const batch = writeBatch(db);
  rSnap.docs.forEach(d => batch.delete(d.ref));
  bSnap.docs.forEach(d => batch.delete(d.ref));
  fsSnap.docs.forEach(d => batch.delete(d.ref));
  isSnap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// ─── REAL-TIME LISTENER ───────────────────────────────────────────────────────

export interface AppData {
  rooms: Room[];
  bookings: Booking[];
  fixedSchedules: FixedSchedule[];
  importSessions: ImportSession[];
}

/**
 * Subscribes to all four Firestore collections simultaneously.
 * Calls `callback` immediately with current data and on every subsequent update.
 * Returns an unsubscribe function — call it in useEffect cleanup to avoid memory leaks.
 */
export function subscribeToAllData(callback: (data: AppData) => void): () => void {
  if (!db) {
    callback({ rooms: [], bookings: [], fixedSchedules: [], importSessions: [] });
    return () => {};
  }

  // Local state mirrors — updated independently as each collection fires
  let rooms: Room[]                   = [];
  let bookings: Booking[]             = [];
  let fixedSchedules: FixedSchedule[] = [];
  let importSessions: ImportSession[] = [];

  const notify = () =>
    callback({ rooms, bookings, fixedSchedules, importSessions });

  const unsubRooms = onSnapshot(query(roomsCol()), snap => {
    rooms = snapshotToArray<Room>(snap);
    notify();
  });

  const unsubBookings = onSnapshot(query(bookingsCol()), snap => {
    bookings = snapshotToArray<Booking>(snap);
    notify();
  });

  const unsubFixed = onSnapshot(query(fixedSchedulesCol()), snap => {
    fixedSchedules = snapshotToArray<FixedSchedule>(snap);
    notify();
  });

  const unsubSessions = onSnapshot(query(importSessionsCol()), snap => {
    importSessions = snapshotToArray<ImportSession>(snap);
    notify();
  });

  // Return a single cleanup function that unsubscribes all listeners
  return () => {
    unsubRooms();
    unsubBookings();
    unsubFixed();
    unsubSessions();
  };
}
