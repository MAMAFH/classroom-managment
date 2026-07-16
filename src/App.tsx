import React, { useState, useEffect, useCallback } from 'react';
import { Room, Booking, FixedSchedule, ImportSession } from './types';
import Dashboard from './pages/Dashboard';
import Rooms from './pages/Rooms';
import Bookings from './pages/Bookings';
import { hasOverlap, generateId } from './utils';
import { LayoutDashboard, DoorOpen, CalendarDays, Loader2 } from 'lucide-react';
import {
  subscribeToAllData,
  saveAllRooms,
  addBookingToFirebase,
  updateBookingInFirebase,
  deleteBookingFromFirebase,
  deleteBookingsFromFirebase,
  deleteFixedSchedulesByIds,
  saveFixedSchedules,
  saveImportSession,
  deleteFixedSchedulesBySemester,
  deleteImportSessionsBySemester,
  toggleFixedScheduleInFirebase,
  deleteImportSessionWithSchedules,
  clearAllData as fbClearAllData,
  clearAllRoomsAndData as fbClearAllRooms,
  clearAllSchedules as fbClearAllSchedules,
} from './services/firebase';

const SEED_ROOMS: Room[] = [
  // Old Building
  { id: 'old_001', name: 'قاعة 001', capacity: 40, building: 'old', type: 'classroom' },
  { id: 'old_002', name: 'قاعة 002', capacity: 40, building: 'old', type: 'classroom' },
  { id: 'old_101', name: 'قاعة 101', capacity: 20, building: 'old', type: 'classroom' },
  { id: 'old_102', name: 'روم 102', capacity: 40, building: 'old', type: 'classroom' },
  { id: 'old_103', name: 'قاعة 103', capacity: 25, building: 'old', type: 'classroom' },
  { id: 'old_107', name: 'معمل 107', capacity: 25, building: 'old', type: 'lab' },
  { id: 'old_108', name: 'قاعة 108', capacity: 15, building: 'old', type: 'classroom' },
  { id: 'old_201', name: 'معمل 201', capacity: 15, building: 'old', type: 'lab' },
  { id: 'old_209', name: 'روم 209', capacity: 25, building: 'old', type: 'classroom' },
  { id: 'old_218', name: 'روم 218', capacity: 40, building: 'old', type: 'classroom' },
  { id: 'old_221', name: 'روم 221', capacity: 30, building: 'old', type: 'classroom' },
  { id: 'old_224', name: 'روم 224', capacity: 25, building: 'old', type: 'classroom' },
  { id: 'old_301', name: 'روم 301', capacity: 25, building: 'old', type: 'classroom' },
  { id: 'old_302', name: 'قاعة الرسم 302', capacity: 20, building: 'old', type: 'classroom' },
  { id: 'old_303', name: 'قاعة الرسم 303', capacity: 20, building: 'old', type: 'classroom' },
  { id: 'old_305', name: 'روم 305', capacity: 40, building: 'old', type: 'classroom' },
  // New Building
  { id: 'new_A103', name: 'معمل A103', capacity: 20, building: 'new', type: 'lab' },
  { id: 'new_A104', name: 'روم A104', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A105', name: 'روم A105', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A202', name: 'روم A202', capacity: 25, building: 'new', type: 'classroom' },
  { id: 'new_A203', name: 'روم A203', capacity: 25, building: 'new', type: 'classroom' },
  { id: 'new_A204', name: 'روم A204', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A205', name: 'روم A205', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A206', name: 'روم A206', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A207', name: 'روم A207', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A208', name: 'روم A208', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A209', name: 'روم A209', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A210', name: 'روم A210', capacity: 46, building: 'new', type: 'classroom' },
  { id: 'new_A211', name: 'روم A211', capacity: 46, building: 'new', type: 'classroom' },
  { id: 'new_A302', name: 'روم A302', capacity: 25, building: 'new', type: 'classroom' },
  { id: 'new_A303', name: 'روم A303', capacity: 25, building: 'new', type: 'classroom' },
  { id: 'new_A305', name: 'روم A305', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A306', name: 'روم A306', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A307', name: 'روم A307', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A308', name: 'روم A308', capacity: 30, building: 'new', type: 'classroom' },
  { id: 'new_A309', name: 'روم A309', capacity: 46, building: 'new', type: 'classroom' },
  { id: 'new_A310', name: 'روم A310', capacity: 46, building: 'new', type: 'classroom' },
  { id: 'new_A402', name: 'روم A402', capacity: 31, building: 'new', type: 'classroom' },
  { id: 'new_A403', name: 'روم A403', capacity: 31, building: 'new', type: 'classroom' },
  { id: 'new_A404', name: 'قاعة رسم A404', capacity: 31, building: 'new', type: 'classroom' },
  { id: 'new_A405', name: 'معمل A405', capacity: 10, building: 'new', type: 'lab' },
  { id: 'new_A406', name: 'معمل A406', capacity: 10, building: 'new', type: 'lab' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'rooms' | 'bookings'>('dashboard');

  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [fixedSchedules, setFixedSchedules] = useState<FixedSchedule[]>([]);
  const [importSessions, setImportSessions] = useState<ImportSession[]>([]);

  // True once Firestore has sent at least one snapshot for every collection
  const [dbReady, setDbReady] = useState(false);
  const [firstLoad, setFirstLoad] = useState({ rooms: false, bookings: false, fixed: false, sessions: false });

  // ─── Firebase real-time subscription ───────────────────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeToAllData((data) => {
      setRooms(data.rooms);
      setBookings(data.bookings);
      setFixedSchedules(data.fixedSchedules);
      setImportSessions(data.importSessions);
      setDbReady(true);
    });
    return unsubscribe;
  }, []);

  // Seed rooms on first ever load when Firestore rooms collection is empty
  useEffect(() => {
    if (dbReady && rooms.length === 0) {
      saveAllRooms(SEED_ROOMS).catch(console.error);
    }
  }, [dbReady]);

  // ─── 1. Add manual booking ──────────────────────────────────────────────────
  const addBooking = useCallback(
    async (newBooking: Omit<Booking, 'id'>): Promise<{ success: boolean; message?: string }> => {
      if (hasOverlap(newBooking.roomId, newBooking.date, newBooking.startTime, newBooking.endTime, bookings, fixedSchedules)) {
        return { success: false, message: 'هذه القاعة محجوزة خلال الوقت المحدد (يوجد تعارض مع حجز آخر أو جدول مستمر).' };
      }
      const b: Booking = { ...newBooking, id: generateId() };
      await addBookingToFirebase(b);
      return { success: true };
    },
    [bookings, fixedSchedules]
  );

  // ─── 2. Update manual booking ───────────────────────────────────────────────
  const updateBooking = useCallback(
    async (id: string, updates: Omit<Booking, 'id'>): Promise<{ success: boolean; message?: string }> => {
      if (hasOverlap(updates.roomId, updates.date, updates.startTime, updates.endTime, bookings, fixedSchedules, id)) {
        return { success: false, message: 'هذه القاعة محجوزة خلال الوقت المحدد (يوجد تعارض مع حجز آخر أو جدول مستمر).' };
      }
      await updateBookingInFirebase(id, updates);
      return { success: true };
    },
    [bookings, fixedSchedules]
  );

  // ─── 3. Delete bookings ─────────────────────────────────────────────────────
  const deleteBooking = useCallback(async (id: string) => {
    await deleteBookingFromFirebase(id);
  }, []);

  const deleteBookings = useCallback(async (ids: string[]) => {
    await deleteBookingsFromFirebase(ids);
  }, []);

  // ─── 4. Delete fixed schedules ──────────────────────────────────────────────
  const deleteFixedSchedules = useCallback(async (ids: string[]) => {
    await deleteFixedSchedulesByIds(ids);
  }, []);

  // ─── 5. Clear one room's bookings + schedules ───────────────────────────────
  const clearRoomSchedule = useCallback(
    async (roomId: string) => {
      const bookingIds = bookings.filter(b => b.roomId === roomId).map(b => b.id);
      const scheduleIds = fixedSchedules.filter(fs => fs.roomId === roomId).map(fs => fs.id);
      await Promise.all([
        bookingIds.length > 0 ? deleteBookingsFromFirebase(bookingIds) : Promise.resolve(),
        scheduleIds.length > 0 ? deleteFixedSchedulesByIds(scheduleIds) : Promise.resolve(),
      ]);
    },
    [bookings, fixedSchedules]
  );

  // ─── 5. Import PDF schedules (idempotent: overwrites same semester) ─────────
  const importSchedules = useCallback(
    async (session: ImportSession, newSchedules: FixedSchedule[], newRooms: Room[] = []) => {
      // Delete old data for this semester first
      await Promise.all([
        deleteFixedSchedulesBySemester(session.semesterId),
        deleteImportSessionsBySemester(session.semesterId),
      ]);

      // Merge any newly discovered rooms that don't already exist
      if (newRooms.length > 0) {
        const toAdd = newRooms.filter(nr => !rooms.some(r => r.name === nr.name));
        if (toAdd.length > 0) {
          await saveAllRooms([...rooms, ...toAdd]);
        }
      }

      await Promise.all([
        saveFixedSchedules(newSchedules),
        saveImportSession(session),
      ]);
    },
    [rooms]
  );

  // ─── 6. Toggle fixed schedule disabled state ────────────────────────────────
  const toggleFixedSchedule = useCallback(
    async (id: string) => {
      const fs = fixedSchedules.find(s => s.id === id);
      if (!fs) return;
      await toggleFixedScheduleInFirebase(id, !fs.disabled);
    },
    [fixedSchedules]
  );

  // ─── 7. Delete an import session + its schedules ────────────────────────────
  const deleteImportSession = useCallback(async (sessionId: string) => {
    await deleteImportSessionWithSchedules(sessionId);
  }, []);

  // ─── 8. Clear all data ──────────────────────────────────────────────────────
  const clearAllData = useCallback(async () => {
    await fbClearAllData(SEED_ROOMS);
  }, []);

  const clearAllRooms = useCallback(async () => {
    await fbClearAllRooms();
  }, []);

  const clearAllSchedules = useCallback(async () => {
    await fbClearAllSchedules();
  }, []);

  // ─── Loading screen while Firestore connects ────────────────────────────────
  if (!dbReady) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#0A0A0A]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="text-amber-500 animate-spin" />
          <p className="text-gray-400 text-sm font-medium">جارٍ الاتصال بقاعدة البيانات…</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="h-screen w-full flex flex-col md:flex-row bg-[#0A0A0A] font-sans text-white selection:bg-gold-500/30 selection:text-gold-400 overflow-hidden">
      
      {/* Sidebar (Desktop) */}
      <aside className="w-64 bg-[#111111] border-l border-gold-500/30 flex-col hidden md:flex shrink-0">
        <div className="p-6 border-b border-gold-500/30 flex flex-col justify-center h-24">
          <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-l from-gold-400 to-amber-600">
            إدارة القاعات
          </h1>
          <p className="text-gold-500/60 font-bold text-xs mt-2 tracking-wide uppercase">نظام الحجز الموحد</p>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-xl font-bold transition-all ${activeTab === 'dashboard' ? 'bg-gold-500 text-black shadow-[0_4px_20px_-4px_rgba(212,175,55,0.4)]' : 'text-gray-400 hover:text-white hover:bg-[#222]'}`}>
            <LayoutDashboard size={20} className={activeTab === 'dashboard' ? 'text-black' : 'text-gray-500'} />
            الرئيسية
          </button>
          <button onClick={() => setActiveTab('rooms')} className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-xl font-bold transition-all ${activeTab === 'rooms' ? 'bg-gold-500 text-black shadow-[0_4px_20px_-4px_rgba(212,175,55,0.4)]' : 'text-gray-400 hover:text-white hover:bg-[#222]'}`}>
            <DoorOpen size={20} className={activeTab === 'rooms' ? 'text-black' : 'text-gray-500'} />
            تصفح القاعات
          </button>
          <button onClick={() => setActiveTab('bookings')} className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-xl font-bold transition-all ${activeTab === 'bookings' ? 'bg-gold-500 text-black shadow-[0_4px_20px_-4px_rgba(212,175,55,0.4)]' : 'text-gray-400 hover:text-white hover:bg-[#222]'}`}>
            <CalendarDays size={20} className={activeTab === 'bookings' ? 'text-black' : 'text-gray-500'} />
            سجل الحجوزات
          </button>
        </nav>
      </aside>
 
      {/* Mobile Header (Mobile only) */}
      <header className="md:hidden bg-[#111111] border-b border-gold-500/30 p-4 flex items-center justify-between sticky top-0 z-10 w-full shrink-0">
        <h1 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-l from-gold-400 to-gold-500">إدارة القاعات</h1>
        <div className="flex bg-[#0A0A0A] border border-white/5 rounded-lg p-1 gap-1">
          <button onClick={() => setActiveTab('dashboard')} className={`p-2 rounded-md transition-colors ${activeTab === 'dashboard' ? 'bg-gold-500 text-black shadow' : 'text-gray-400 hover:text-white'}`}><LayoutDashboard size={18}/></button>
          <button onClick={() => setActiveTab('rooms')} className={`p-2 rounded-md transition-colors ${activeTab === 'rooms' ? 'bg-gold-500 text-black shadow' : 'text-gray-400 hover:text-white'}`}><DoorOpen size={18}/></button>
          <button onClick={() => setActiveTab('bookings')} className={`p-2 rounded-md transition-colors ${activeTab === 'bookings' ? 'bg-gold-500 text-black shadow' : 'text-gray-400 hover:text-white'}`}><CalendarDays size={18}/></button>
        </div>
      </header>
 
      {/* Main Content Pane */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12 relative w-full">
        <div className="max-w-6xl mx-auto pb-24 w-full">
          {activeTab === 'dashboard' && (
            <Dashboard 
              rooms={rooms} 
              bookings={bookings} 
              fixedSchedules={fixedSchedules} 
            />
          )}
          {activeTab === 'rooms' && (
            <Rooms 
              rooms={rooms} 
              bookings={bookings} 
              fixedSchedules={fixedSchedules}
              addBooking={addBooking} 
              onDeleteBooking={deleteBooking}
              onDeleteBookings={deleteBookings}
              onUpdateBooking={updateBooking}
              onDeleteFixedSchedules={deleteFixedSchedules}
              onClearRoomSchedule={clearRoomSchedule}
              onClearAllRooms={clearAllRooms}
            />
          )}
          {activeTab === 'bookings' && (
            <Bookings 
              rooms={rooms} 
              bookings={bookings} 
              fixedSchedules={fixedSchedules}
              onDelete={deleteBooking} 
              onUpdate={updateBooking}
              onToggleFixed={toggleFixedSchedule}
            />
          )}
        </div>
      </main>
      
    </div>
  );
}
