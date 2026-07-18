import React, { useState, useMemo, useEffect } from 'react';
import { Room, Booking, FixedSchedule } from '../types';
import { isRoomCurrentlyBooked, getLocalDateString, hasOverlap, formatTime12Hour, getCustomDayOfWeek } from '../utils';
import { Search, Users, CalendarDays, Clock, X, XCircle, CheckCircle2, Trash2, Edit2 } from 'lucide-react';
import EditBookingModal from '../components/EditBookingModal';
import { PERIOD_RANGES } from '../config/periods';

interface Props {
  rooms: Room[];
  bookings: Booking[];
  fixedSchedules?: FixedSchedule[];
  addBooking: (b: Omit<Booking, 'id'>) => Promise<{ success: boolean; message?: string }>;
  onDeleteBooking: (id: string) => void;
  onDeleteBookings: (ids: string[]) => void;
  onUpdateBooking: (id: string, updates: Omit<Booking, 'id'>) => Promise<{ success: boolean; message?: string }>;
  onDeleteFixedSchedules: (ids: string[]) => void;
  onClearRoomSchedule: (roomId: string) => void;
  onClearAllRooms: () => void;
}

const TIME_SLOTS = PERIOD_RANGES.map(p => ({
  label: `${p.periodStart} - ${p.periodEnd}`,
  start: p.start,
  end: p.end,
}));

const CALENDAR_START_MIN = 8 * 60 + 30;  // 08:30
const CALENDAR_END_MIN = 20 * 60 + 10;   // 20:10
const ROW_HEIGHT_PX = 56;
const CALENDAR_HEIGHT_PX = TIME_SLOTS.length * ROW_HEIGHT_PX;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function timeRangeToStyle(startTime: string, endTime: string) {
  const startMin = Math.max(timeToMinutes(startTime), CALENDAR_START_MIN);
  const endMin = Math.min(timeToMinutes(endTime), CALENDAR_END_MIN);
  if (endMin <= CALENDAR_START_MIN || startMin >= CALENDAR_END_MIN) return null;

  const top = ((startMin - CALENDAR_START_MIN) / (CALENDAR_END_MIN - CALENDAR_START_MIN)) * CALENDAR_HEIGHT_PX;
  const height = Math.max(((endMin - startMin) / (CALENDAR_END_MIN - CALENDAR_START_MIN)) * CALENDAR_HEIGHT_PX, 18);
  return { top, height };
}

const DAYS_AR = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

export default function Rooms({ 
  rooms, 
  bookings, 
  fixedSchedules = [], 
  addBooking,
  onDeleteBooking,
  onDeleteBookings,
  onUpdateBooking,
  onDeleteFixedSchedules,
  onClearRoomSchedule,
  onClearAllRooms
}: Props) {
  const [filter, setFilter] = useState<'all' | 'available' | 'booked'>('all');
  const [buildingFilter, setBuildingFilter] = useState<'all' | 'old' | 'new'>('all');
  const [search, setSearch] = useState('');
  
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  
  const [date, setDate] = useState(getLocalDateString());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [successCode, setSuccessCode] = useState('');

  // Advanced Filter States
  const [useTimeFilter, setUseTimeFilter] = useState(false);
  const [filterDate, setFilterDate] = useState(getLocalDateString());
  const [filterStartTime, setFilterStartTime] = useState('08:30');
  const [filterEndTime, setFilterEndTime] = useState('10:10');

  // Schedule Management States
  const [modalTab, setModalTab] = useState<'calendar' | 'manage'>('calendar');
  const [selectedBookings, setSelectedBookings] = useState<string[]>([]);
  const [selectedFixed, setSelectedFixed] = useState<string[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showClearAllRoomsConfirm, setShowClearAllRoomsConfirm] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);

  // Helper: Find what is occupying a room at a specific date and time range
  const getOccupyingSchedule = (
    roomId: string,
    targetDate: string,
    targetStart: string,
    targetEnd: string
  ) => {
    // 1. Check manual bookings
    const manual = bookings.find(b => 
      b.roomId === roomId && 
      b.date === targetDate && 
      targetStart < b.endTime && 
      targetEnd > b.startTime
    );
    if (manual) {
      return {
        type: 'manual',
        label: manual.courseCode || 'حجز يدوي',
        details: manual.professor ? `أ.د. ${manual.professor}` : ''
      };
    }

    // 2. Check fixed schedules
    const customDay = getCustomDayOfWeek(targetDate);
    const fixed = fixedSchedules.find(fs => 
      fs.roomId === roomId && 
      !fs.disabled && 
      fs.dayOfWeek === customDay && 
      targetStart < fs.endTime && 
      targetEnd > fs.startTime
    );
    if (fixed) {
      return {
        type: 'fixed',
        label: fixed.courseCode || 'جدول مستمر',
        details: fixed.professor ? `أ.د. ${fixed.professor}` : ''
      };
    }

    return null;
  };

  // Helper: Get status of a slot for selectedRoom on current form date
  const getSlotStatus = (start: string, end: string) => {
    if (!selectedRoom) return { isBooked: false, label: '' };
    const booked = hasOverlap(selectedRoom.id, date, start, end, bookings, fixedSchedules);
    if (!booked) return { isBooked: false, label: '' };
    const occ = getOccupyingSchedule(selectedRoom.id, date, start, end);
    return { isBooked: true, label: occ ? occ.label : 'محجوزة' };
  };

  const roomBookings = useMemo(() => {
    if (!selectedRoom) return [];
    return bookings.filter(b => b.roomId === selectedRoom.id);
  }, [bookings, selectedRoom?.id]);

  const roomFixed = useMemo(() => {
    if (!selectedRoom) return [];
    return fixedSchedules.filter(fs => fs.roomId === selectedRoom.id);
  }, [fixedSchedules, selectedRoom?.id]);

  useEffect(() => {
    setSelectedBookings([]);
    setSelectedFixed([]);
    setShowClearConfirm(false);
    setModalTab('calendar');
  }, [selectedRoom]);

  const weekDates = useMemo(() => {
    let d = new Date();
    if (date) {
      const [y, m, dNum] = date.split('-').map(Number);
      d = new Date(y, m - 1, dNum);
    }
    const day = d.getDay();
    const diff = day === 6 ? 0 : -(day + 1);
    const saturday = new Date(d);
    saturday.setDate(d.getDate() + diff);
    
    const week = [];
    for (let i = 0; i < 7; i++) { // Sat to Fri
      const nextDate = new Date(saturday);
      nextDate.setDate(saturday.getDate() + i);
      const yyyy = nextDate.getFullYear();
      const mm = String(nextDate.getMonth() + 1).padStart(2, '0');
      const dd = String(nextDate.getDate()).padStart(2, '0');
      week.push(`${yyyy}-${mm}-${dd}`);
    }
    return week;
  }, [date]);

  const WEEK_DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

  const filteredRooms = useMemo(() => {
    return rooms.filter(r => {
      const isBooked = useTimeFilter
        ? hasOverlap(r.id, filterDate, filterStartTime, filterEndTime, bookings, fixedSchedules)
        : isRoomCurrentlyBooked(r.id, bookings, fixedSchedules);
      const matchesSearch = r.name.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;
      
      if (buildingFilter !== 'all' && r.building !== buildingFilter) return false;
      
      if (filter === 'available') return !isBooked;
      if (filter === 'booked') return isBooked;
      return true;
    });
  }, [rooms, bookings, fixedSchedules, filter, search, buildingFilter, useTimeFilter, filterDate, filterStartTime, filterEndTime]);

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorCode('');
    setSuccessCode('');
    
    if (!date || !startTime || !endTime) {
      setErrorCode('يرجى تعبئة جميع الحقول.');
      return;
    }
    if (startTime >= endTime) {
      setErrorCode('وقت النهاية يجب أن يكون أكبر من وقت البداية.');
      return;
    }

    if (endTime > '20:30') {
      setErrorCode('الجامعة تغلق أبوابها الساعة 8:30 مساءً. لا يمكن الحجز بعد هذا الوقت.');
      return;
    }

    const res = await addBooking({
      roomId: selectedRoom!.id,
      date,
      startTime,
      endTime
    });

    if (res.success) {
      setSuccessCode('تم تأكيد الحجز بنجاح!');
      setTimeout(() => {
        setSelectedRoom(null);
        setDate(''); setStartTime(''); setEndTime('');
        setSuccessCode('');
      }, 1500);
    } else {
      setErrorCode(res.message || 'هذه القاعة محجوزة خلال الوقت المحدد.');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gold-500/30 pb-4">
        <h2 className="text-2xl font-bold text-gold-500">إدارة القاعات</h2>
        <div className="flex flex-col sm:flex-row gap-3 items-center w-full md:w-auto">
          <div className="flex bg-[#111] border border-white/5 p-1 rounded-xl w-full sm:w-auto justify-center">
            <button onClick={() => setBuildingFilter('all')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${buildingFilter === 'all' ? 'bg-[#333] text-white shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'text-gray-400 hover:bg-[#222]'}`}>كل المباني</button>
            <button onClick={() => setBuildingFilter('old')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${buildingFilter === 'old' ? 'bg-[#333] text-white shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'text-gray-400 hover:bg-[#222]'}`}>المبنى القديم</button>
            <button onClick={() => setBuildingFilter('new')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${buildingFilter === 'new' ? 'bg-[#333] text-white shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'text-gray-400 hover:bg-[#222]'}`}>المبنى الجديد</button>
          </div>
          <div className="flex bg-[#111] border border-white/5 p-1 rounded-xl w-full sm:w-auto justify-center">
             <button onClick={() => setFilter('all')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${filter === 'all' ? 'bg-gold-500 text-black shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'text-gray-300 hover:bg-[#222]'}`}>الكل</button>
             <button onClick={() => setFilter('available')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${filter === 'available' ? 'bg-gold-500 text-black shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'text-gray-300 hover:bg-[#222]'}`}>المتاحة</button>
             <button onClick={() => setFilter('booked')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${filter === 'booked' ? 'bg-gold-500 text-black shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'text-gray-300 hover:bg-[#222]'}`}>المحجوزة</button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch">
          <div className="relative flex-1">
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
            <input 
              type="text" 
              placeholder="ابحث عن قاعة باسمها..." 
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl py-3 pr-12 pl-4 text-white focus:outline-none focus:border-gold-500 transition-all font-medium placeholder:text-gray-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button 
            type="button"
            onClick={() => setUseTimeFilter(!useTimeFilter)}
            className={`px-5 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border ${
              useTimeFilter 
                ? 'bg-gold-500 text-black border-gold-500 shadow-[0_0_15px_rgba(212,175,55,0.3)]' 
                : 'bg-[#1a1a1a] text-gray-300 border-white/10 hover:border-gold-500/50'
            }`}
          >
            <Clock size={18} />
            <span>فلترة متقدمة بالوقت</span>
          </button>
        </div>

        {useTimeFilter && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-[#111] border border-gold-500/20 p-5 rounded-2xl animate-in slide-in-from-top-2 duration-200">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-bold">تاريخ التصفية</label>
              <input 
                type="date" 
                value={filterDate} 
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-gold-500 font-mono"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-bold">وقت البدء</label>
              <input 
                type="time" 
                value={filterStartTime} 
                onChange={(e) => setFilterStartTime(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-gold-500 font-mono"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-bold">وقت الانتهاء</label>
              <input 
                type="time" 
                value={filterEndTime} 
                onChange={(e) => setFilterEndTime(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-gold-500 font-mono"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredRooms.map(room => {
          const isBooked = useTimeFilter
            ? hasOverlap(room.id, filterDate, filterStartTime, filterEndTime, bookings, fixedSchedules)
            : isRoomCurrentlyBooked(room.id, bookings, fixedSchedules);

          const occupying = useTimeFilter
            ? getOccupyingSchedule(room.id, filterDate, filterStartTime, filterEndTime)
            : null;

          return (
            <div 
              key={room.id}
              onClick={() => {
                if (useTimeFilter && !isBooked) {
                  setDate(filterDate);
                  setStartTime(filterStartTime);
                  setEndTime(filterEndTime);
                }
                setSelectedRoom(room);
              }}
              className="bg-[#161616] overflow-hidden border border-white/5 rounded-2xl p-6 hover:bg-[#1a1a1a] hover:border-gold-500/50 hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] transition-all cursor-pointer group relative"
            >
              <div className="absolute top-0 right-0 w-1.5 h-full rounded-r-2xl bg-white/5 group-hover:bg-gold-500 transition-colors" />
              <div className="flex flex-col h-full justify-between gap-4">
                <div className="flex justify-between items-start">
                  <h3 className="text-xl font-bold text-white group-hover:text-gold-500 transition-colors pr-2">{room.name}</h3>
                  <div className={`flex items-center gap-2 px-2 py-1 rounded-full border whitespace-nowrap ${isBooked ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-green-500/10 text-green-500 border-green-500/30'}`}>
                     <span className={`w-2 h-2 rounded-full ${isBooked ? 'bg-red-500' : 'bg-green-500'}`}></span>
                     <span className="text-[10px] font-bold">{isBooked ? 'محجوزة' : 'متاحة'}</span>
                  </div>
                </div>

                {isBooked && occupying && (
                  <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-2.5 text-xs space-y-1">
                    <span className="text-red-400 font-bold block">{occupying.label}</span>
                    {occupying.details && <span className="text-gray-400 text-[10px] block">{occupying.details}</span>}
                  </div>
                )}

                {!isBooked && useTimeFilter && (
                  <div className="bg-green-500/5 border border-green-500/10 rounded-xl p-2.5 text-xs text-green-400 font-bold text-center">
                    متاحة للحجز في هذا الوقت ✨
                  </div>
                )}

                <div className="flex items-center text-gray-400 text-sm font-semibold gap-2 border-t border-white/5 pt-3">
                  <Users size={16} className="text-gray-500" />
                  <span>السعة: {room.capacity} شخص</span>
                </div>
              </div>
            </div>
          )
        })}
        {filteredRooms.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center text-gray-500 py-20 bg-[#161616] border border-white/5 border-dashed rounded-2xl gap-4">
            <Search size={48} className="text-gray-700" />
            <p className="text-lg font-bold">لا توجد قاعات مطابقة للبحث.</p>
          </div>
        )}
      </div>

      {/* Modal Overlay */}
      {selectedRoom && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-8 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" 
          onClick={(e) => { if(e.target === e.currentTarget) setSelectedRoom(null); }}
        >
            <div className="bg-[#111] border border-gold-500 w-[1100px] max-w-full lg:max-h-[85vh] flex flex-col lg:flex-row overflow-hidden rounded-3xl relative animate-in zoom-in-95 duration-200">
              
              {/* Left Side: Main Pane */}
              <div className="flex-1 bg-[#161616] flex flex-col p-6 overflow-hidden">
                {/* Modal Header & Tabs */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 shrink-0 pb-3 border-b border-white/5">
                   <div className="flex items-center gap-4">
                     <h4 className="text-xl font-bold text-gold-500 flex items-center gap-2">
                       <CalendarDays size={24}/>
                       {selectedRoom.name}
                     </h4>
                     
                     {/* Tab Toggle buttons */}
                     <div className="flex bg-[#111] border border-white/5 p-1 rounded-xl">
                       <button 
                         type="button"
                         onClick={() => setModalTab('calendar')} 
                         className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${modalTab === 'calendar' ? 'bg-gold-500 text-black shadow' : 'text-gray-400 hover:bg-[#222]'}`}
                       >
                         عرض الجدول
                       </button>
                       <button 
                         type="button"
                         onClick={() => setModalTab('manage')} 
                         className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${modalTab === 'manage' ? 'bg-gold-500 text-black shadow' : 'text-gray-400 hover:bg-[#222]'}`}
                       >
                         إدارة المواعيد
                       </button>
                     </div>
                   </div>
                   
                   <button onClick={() => setSelectedRoom(null)} className="lg:hidden p-2 text-gray-400 hover:text-white bg-[#222] rounded-full">
                     <X size={18} />
                   </button>
                </div>
                
                {modalTab === 'calendar' ? (
                  /* Existing Calendar view */
                  <div className="flex-1 overflow-x-auto overflow-y-auto rounded-xl border border-white/10 bg-[#111] scrollbar-hide">
                    <div className="flex min-w-[600px] relative">
                       {/* Time labels column — period slots */}
                       <div className="w-[72px] shrink-0 border-l border-white/10 bg-[#161616] sticky right-0 z-10">
                         <div className="h-10 border-b border-white/10"></div>
                         {TIME_SLOTS.map(slot => (
                           <div
                             key={slot.label}
                             className="border-b border-white/5 text-[9px] text-gray-500 flex flex-col items-center justify-center font-mono leading-tight px-1"
                             style={{ height: `${ROW_HEIGHT_PX}px` }}
                           >
                             <span className="text-gray-400 font-bold">{slot.label}</span>
                             <span>{slot.start}</span>
                             <span className="text-gray-600">{slot.end}</span>
                           </div>
                         ))}
                       </div>
                       {/* Days columns */}
                       {weekDates.map((dStr, i) => (
                         <div key={dStr} className={`flex-1 border-l border-white/5 relative min-w-[100px] ${dStr === date ? 'bg-gold-500/5' : ''}`}>
                            <div className={`h-10 border-b flex flex-col items-center justify-center sticky top-0 z-10 backdrop-blur-md ${dStr === date ? 'border-gold-500/50 bg-gold-500/10' : 'border-white/10 bg-[#1a1a1a]/90'}`}>
                              <span className={`text-xs font-bold ${dStr === date ? 'text-gold-500' : 'text-gray-300'}`}>{WEEK_DAYS[i]}</span>
                              <span className="text-[9px] text-gray-500 font-mono tracking-tighter">{dStr.slice(5)}</span>
                            </div>
                            <div className="relative" style={{ height: `${CALENDAR_HEIGHT_PX}px` }}>
                               {/* Period grid lines */}
                               {TIME_SLOTS.map((slot, idx) => (
                                 <div
                                   key={slot.label}
                                   className="border-b border-white/5 pointer-events-none absolute left-0 right-0"
                                   style={{ top: `${idx * ROW_HEIGHT_PX}px`, height: `${ROW_HEIGHT_PX}px` }}
                                 />
                               ))}
                               
                               {/* Manual Bookings (Gold outlined blocks) */}
                               {bookings.filter(b => b.roomId === selectedRoom.id && b.date === dStr).map(b => {
                                  const pos = timeRangeToStyle(b.startTime, b.endTime);
                                  if (!pos) return null;
                                  return (
                                    <div key={b.id} 
                                      className="absolute left-1 right-1 bg-gold-500/10 border-l-[3px] border-l-gold-500 border border-gold-500/30 rounded flex flex-col p-1.5 overflow-hidden hover:bg-gold-500/20 transition-colors z-20" 
                                      style={{ top: `${pos.top}px`, height: `${pos.height}px` }}
                                      title={`حجز يدوي: ${b.startTime} - ${b.endTime}`}
                                    >
                                      <span className="text-[9px] text-gold-500 font-bold whitespace-nowrap leading-none font-mono">{b.startTime} - {b.endTime}</span>
                                      {pos.height >= 24 && <span className="text-[9px] text-gray-300 truncate font-semibold mt-0.5">{b.courseCode || 'حجز يدوي'}</span>}
                                    </div>
                                  )
                               })}

                               {/* Recurring Fixed Schedules (Solid amber blocks) */}
                               {fixedSchedules.filter(fs => fs.roomId === selectedRoom.id && !fs.disabled && fs.dayOfWeek === i).map(fs => {
                                  const pos = timeRangeToStyle(fs.startTime, fs.endTime);
                                  if (!pos) return null;
                                  return (
                                     <div key={fs.id} 
                                       className="absolute left-1 right-1 bg-amber-500/25 border-l-[3px] border-l-amber-500 border border-amber-500/40 rounded flex flex-col p-1.5 overflow-hidden hover:bg-amber-500/35 transition-all z-20 shadow-md" 
                                       style={{ top: `${pos.top}px`, height: `${pos.height}px` }}
                                       title={`جدول مستمر: ${fs.courseCode || 'بدون رمز'}${fs.professor ? ` (الأستاذ: ${fs.professor})` : ''} (${fs.startTime} - ${fs.endTime})`}
                                     >
                                       <span className="text-[9px] text-amber-400 font-bold whitespace-nowrap leading-none font-mono">{fs.startTime} - {fs.endTime}</span>
                                       {pos.height >= 24 && (
                                         <span className="text-[9px] text-white/95 truncate font-bold mt-0.5 leading-tight block">
                                           {fs.courseCode || 'جدول مستمر'}
                                           {fs.professor && <span className="text-[8px] text-white/70 block font-normal truncate mt-0.5">{fs.professor}</span>}
                                         </span>
                                       )}
                                     </div>
                                  )
                               })}
                            </div>
                         </div>
                       ))}
                    </div>
                  </div>
                ) : (
                  /* Manage Schedules & Bookings view */
                  <div className="flex-1 overflow-y-auto space-y-6 pr-1 pl-1">
                     
                     {/* Room Info Card */}
                     <div className="bg-[#111] border border-white/5 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm font-medium">
                       <div>
                         <span className="text-gray-500 block text-xs">كود القاعة</span>
                         <span className="text-white mt-1 block font-mono">{selectedRoom.code || '-'}</span>
                       </div>
                       <div>
                         <span className="text-gray-500 block text-xs">نوع القاعة</span>
                         <span className="text-white mt-1 block">{selectedRoom.type === 'lab' ? 'معمل' : 'قاعة دراسية'}</span>
                       </div>
                       <div>
                         <span className="text-gray-500 block text-xs">السعة الاستيعابية</span>
                         <span className="text-white mt-1 block">{selectedRoom.capacity} فرد</span>
                       </div>
                       <div>
                         <span className="text-gray-500 block text-xs">المصدر</span>
                         <span className="text-white mt-1 block">
                           {selectedRoom.source === 'pdf-import'
                             ? 'استيراد PDF'
                             : selectedRoom.source === 'txt-import'
                               ? 'استيراد TXT'
                               : 'يدوي / نظام'}
                         </span>
                       </div>
                     </div>

                     {/* Action Bar for Bulk Deletion and Clear Room */}
                     <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center bg-[#111] border border-white/5 p-4 rounded-2xl">
                       <div className="flex gap-2">
                         <button
                           type="button"
                           disabled={selectedBookings.length === 0 && selectedFixed.length === 0}
                           onClick={() => {
                             if (selectedBookings.length > 0) {
                               onDeleteBookings(selectedBookings);
                               setSelectedBookings([]);
                             }
                             if (selectedFixed.length > 0) {
                               onDeleteFixedSchedules(selectedFixed);
                               setSelectedFixed([]);
                             }
                           }}
                           className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                             selectedBookings.length > 0 || selectedFixed.length > 0
                               ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 font-bold'
                               : 'bg-white/5 text-gray-600 border border-transparent cursor-not-allowed'
                           }`}
                         >
                           حذف المحددة ({(selectedBookings.length + selectedFixed.length)})
                         </button>
                       </div>
                       
                     </div>

                     {/* Lists of manual bookings and recurring schedules */}
                     <div className="space-y-6">
                       
                       {/* Section: Manual Bookings */}
                       <div className="space-y-3">
                         <h5 className="text-sm font-bold text-gold-500 flex items-center gap-2 border-r-2 border-gold-500 pr-2">
                           الحجوزات اليدوية ({roomBookings.length})
                         </h5>
                         
                         {roomBookings.length === 0 ? (
                           <div className="text-center py-6 bg-[#111] border border-white/5 rounded-xl text-xs text-gray-500">
                             لا توجد حجوزات يدوية نشطة لهذه القاعة
                           </div>
                         ) : (
                           <div className="border border-white/5 rounded-xl bg-[#111] overflow-hidden">
                             <table className="w-full text-right border-collapse text-xs">
                               <thead className="bg-[#161616] border-b border-white/5">
                                 <tr>
                                   <th className="p-3 w-10 text-center">
                                     <input 
                                       type="checkbox"
                                       checked={roomBookings.length > 0 && selectedBookings.length === roomBookings.length}
                                       onChange={(e) => {
                                         if (e.target.checked) {
                                           setSelectedBookings(roomBookings.map(b => b.id));
                                         } else {
                                           setSelectedBookings([]);
                                         }
                                       }}
                                       className="accent-gold-500"
                                     />
                                   </th>
                                   <th className="p-3">تاريخ الحجز</th>
                                   <th className="p-3">رمز المادة</th>
                                   <th className="p-3">عضو هيئة التدريس</th>
                                   <th className="p-3 text-center">الوقت</th>
                                   <th className="p-3 text-center w-16">إجراء</th>
                                 </tr>
                               </thead>
                               <tbody className="divide-y divide-white/5">
                                 {roomBookings.map(b => (
                                   <tr key={b.id} className="hover:bg-white/5">
                                     <td className="p-3 text-center">
                                       <input 
                                         type="checkbox"
                                         checked={selectedBookings.includes(b.id)}
                                         onChange={(e) => {
                                           if (e.target.checked) {
                                             setSelectedBookings([...selectedBookings, b.id]);
                                           } else {
                                             setSelectedBookings(selectedBookings.filter(id => id !== b.id));
                                           }
                                         }}
                                         className="accent-gold-500"
                                       />
                                     </td>
                                     <td className="p-3 font-mono">{b.date}</td>
                                     <td className="p-3 font-bold text-white">{b.courseCode || 'بدون رمز'}</td>
                                     <td className="p-3 text-gray-300">{b.professor || '-'}</td>
                                     <td className="p-3 text-center font-mono">{formatTime12Hour(b.startTime)} - {formatTime12Hour(b.endTime)}</td>
                                     <td className="p-3 text-center">
                                       <div className="flex items-center justify-center gap-1">
                                         <button
                                           type="button"
                                           onClick={() => setEditingBooking(b)}
                                           className="p-1.5 text-gold-400 hover:text-gold-500 rounded hover:bg-white/5"
                                           title="تعديل الحجز"
                                         >
                                           <Edit2 size={14} />
                                         </button>
                                         <button
                                           type="button"
                                           onClick={() => {
                                             onDeleteBooking(b.id);
                                             setSelectedBookings(selectedBookings.filter(id => id !== b.id));
                                           }}
                                           className="p-1.5 text-red-400 hover:text-red-500 rounded hover:bg-white/5"
                                         >
                                           <Trash2 size={14} />
                                         </button>
                                       </div>
                                     </td>
                                   </tr>
                                 ))}
                               </tbody>
                             </table>
                           </div>
                         )}
                       </div>

                       {/* Section: Recurring Schedules */}
                       <div className="space-y-3">
                         <h5 className="text-sm font-bold text-amber-500 flex items-center gap-2 border-r-2 border-amber-500 pr-2">
                           الجداول المستمرة والمستوردة ({roomFixed.length})
                         </h5>
                         
                         {roomFixed.length === 0 ? (
                           <div className="text-center py-6 bg-[#111] border border-white/5 rounded-xl text-xs text-gray-500">
                             لا توجد جداول مستمرة مستوردة لهذه القاعة
                           </div>
                         ) : (
                           <div className="border border-white/5 rounded-xl bg-[#111] overflow-hidden">
                             <table className="w-full text-right border-collapse text-xs">
                               <thead className="bg-[#161616] border-b border-white/5">
                                 <tr>
                                   <th className="p-3 w-10 text-center">
                                     <input 
                                       type="checkbox"
                                       checked={roomFixed.length > 0 && selectedFixed.length === roomFixed.length}
                                       onChange={(e) => {
                                      if (e.target.checked) {
                                           setSelectedFixed(roomFixed.map(fs => fs.id));
                                         } else {
                                           setSelectedFixed([]);
                                         }
                                       }}
                                       className="accent-gold-500"
                                     />
                                   </th>
                                   <th className="p-3">اليوم</th>
                                   <th className="p-3">رمز المادة</th>
                                   <th className="p-3">عضو هيئة التدريس</th>
                                   <th className="p-3 text-center">الوقت</th>
                                 </tr>
                               </thead>
                               <tbody className="divide-y divide-white/5">
                                 {roomFixed.map(fs => (
                                   <tr key={fs.id} className={`hover:bg-white/5 ${fs.disabled ? 'opacity-40 line-through' : ''}`}>
                                     <td className="p-3 text-center">
                                       <input 
                                         type="checkbox"
                                         checked={selectedFixed.includes(fs.id)}
                                         onChange={(e) => {
                                           if (e.target.checked) {
                                             setSelectedFixed([...selectedFixed, fs.id]);
                                           } else {
                                             setSelectedFixed(selectedFixed.filter(id => id !== fs.id));
                                           }
                                         }}
                                         className="accent-gold-500"
                                       />
                                     </td>
                                      <td className="p-3 font-semibold">{DAYS_AR[fs.dayOfWeek] || fs.dayOfWeek}</td>
                                      <td className="p-3 font-bold text-white">{fs.courseCode || 'بدون رمز'}</td>
                                      <td className="p-3 text-gray-300">{fs.professor || '-'}</td>
                                      <td className="p-3 text-center font-mono">{formatTime12Hour(fs.startTime)} - {formatTime12Hour(fs.endTime)}</td>
                                   </tr>
                                 ))}
                               </tbody>
                             </table>
                           </div>
                         )}
                       </div>

                     </div>

                  </div>
                )}
              </div>

              {/* Right Side: Form */}
              <div className="w-full lg:w-[400px] p-8 overflow-y-auto shrink-0 bg-[#0a0a0a] border-t lg:border-t-0 lg:border-r border-gold-500/30 relative">
                <button 
                  onClick={() => setSelectedRoom(null)} 
                  className="hidden lg:flex absolute top-6 left-6 p-2 text-gray-400 hover:text-white bg-[#222] hover:bg-[#333] rounded-full transition-colors z-10"
                >
                  <X size={18} />
                </button>
                <h4 className="text-xl font-bold text-white mb-6">
                   إنشاء حجز جديد
                </h4>
                
                <form onSubmit={handleBookingSubmit} className="space-y-4">
                   <div className="space-y-1">
                      <label className="text-xs text-gray-400">تاريخ الحجز</label>
                      <input type="date" required value={date} onChange={e=>setDate(e.target.value)} 
                        className="w-full bg-[#222] border border-white/10 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-gold-500 font-mono transition-colors" style={{ colorScheme: 'dark' }}/>
                   </div>
                   
                   <div className="space-y-3 pt-2">
                      <div>
                        <label className="text-xs text-gold-500/80 font-semibold mb-2 block font-sans">الفترات المتاحة (حسب اليوم المختار)</label>
                        <div className="flex flex-wrap gap-2">
                          {TIME_SLOTS.map(slot => {
                            const status = getSlotStatus(slot.start, slot.end);
                            return (
                              <button 
                                type="button" 
                                key={slot.label} 
                                disabled={status.isBooked}
                                onClick={() => {setStartTime(slot.start); setEndTime(slot.end);}} 
                                className={`text-[10px] px-2 py-1.5 rounded transition-all font-mono border flex flex-col items-center gap-0.5 ${
                                  status.isBooked
                                    ? 'bg-red-500/10 border-red-500/30 text-red-400/70 cursor-not-allowed'
                                    : 'bg-green-500/5 border-green-500/20 hover:border-green-500 text-green-300 hover:bg-green-500/15'
                                }`}
                                title={status.isBooked ? `محجوزة بواسطة: ${status.label}` : 'فترة شاغرة - انقر للحجز'}
                              >
                                <span className="text-[8px] text-gray-500">{slot.label}</span>
                                <span>{slot.start} - {slot.end}</span>
                                <span className={`text-[8px] font-bold ${status.isBooked ? 'text-red-400' : 'text-green-400'}`}>
                                  {status.isBooked ? status.label : 'شاغرة 🟢'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                   <div className="grid grid-cols-2 gap-4 pt-2">
                     <div className="space-y-1">
                        <label className="text-xs text-gray-400">من (مخصص)</label>
                        <input type="time" required value={startTime} onChange={e=>setStartTime(e.target.value)} 
                          className="w-full bg-[#222] border border-white/10 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-gold-500 font-mono transition-colors" style={{ colorScheme: 'dark' }}/>
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-gray-400">إلى (مخصص)</label>
                        <input type="time" required value={endTime} onChange={e=>setEndTime(e.target.value)} 
                          className="w-full bg-[#222] border border-white/10 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-gold-500 font-mono transition-colors" style={{ colorScheme: 'dark' }}/>
                     </div>
                   </div>
                   
                   {errorCode && (
                     <div className="bg-red-500/10 border border-red-500/30 text-red-500 p-4 rounded-xl flex items-start gap-3 mt-4">
                       <XCircle size={16} className="shrink-0 mt-0.5" />
                       <div>
                         <p className="text-xs font-bold text-red-500">تنبيه حجز</p>
                         <p className="text-[10px] text-red-400/90 leading-tight mt-1">{errorCode}</p>
                       </div>
                     </div>
                   )}

                   {successCode && (
                     <div className="bg-green-500/10 border border-green-500/30 text-green-500 p-4 rounded-xl flex items-start gap-3 mt-4">
                       <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                       <div>
                         <p className="text-xs font-bold text-green-500">نجاح الحجز</p>
                         <p className="text-[10px] text-green-400/90 leading-tight mt-1">{successCode}</p>
                       </div>
                     </div>
                   )}

                   <div className="flex gap-3 pt-6">
                      <button type="submit" className="flex-1 bg-gold-500 text-black font-bold py-3 rounded-xl transition-colors hover:bg-gold-400">
                        تأكيد الحجز
                      </button>
                      <button type="button" onClick={() => setSelectedRoom(null)} className="flex-1 bg-transparent border border-white/20 text-white py-3 rounded-xl hover:bg-white/5 transition-colors lg:hidden">
                        إلغاء
                      </button>
                   </div>
                </form>
              </div>
             </div>
         </div>
       )}

      {editingBooking && (
        <EditBookingModal
          booking={editingBooking}
          roomName={selectedRoom?.name || rooms.find(r => r.id === editingBooking.roomId)?.name || 'غير معروف'}
          onClose={() => setEditingBooking(null)}
          onSave={(updates) => onUpdateBooking(editingBooking.id, updates)}
        />
      )}

      {/* Clear Room Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-[#111] border border-red-500/50 w-full max-w-md rounded-2xl p-6 shadow-[0_0_50px_rgba(220,38,38,0.15)] text-center space-y-6 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto border border-red-500/30">
              <Trash2 size={28} />
            </div>
            
            <div className="space-y-2 text-right">
              <h4 className="text-lg font-bold text-white text-center">هل أنت متأكد؟</h4>
              <p className="text-sm text-gray-300 leading-relaxed text-center">
                سيتم حذف جميع الجداول والحجوزات الخاصة بهذه القاعة ({selectedRoom?.name}).
              </p>
              <p className="text-xs text-red-400 font-bold leading-relaxed text-center">
                لن يتم حذف القاعة نفسها.
              </p>
            </div>
            
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  if (selectedRoom) {
                    onClearRoomSchedule(selectedRoom.id);
                    setSelectedBookings([]);
                    setSelectedFixed([]);
                    setShowClearConfirm(false);
                  }
                }}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl transition-colors"
              >
                تأكيد الحذف
              </button>
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 bg-[#222] hover:bg-[#333] text-gray-300 border border-white/5 py-2.5 rounded-xl transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
     </div>
   );
}
