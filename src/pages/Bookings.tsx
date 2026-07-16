import React, { useState } from 'react';
import { Room, Booking, FixedSchedule } from '../types';
import { Trash2, CalendarX2, Layers, Sliders, Edit2 } from 'lucide-react';
import { formatTime12Hour } from '../utils';
import EditBookingModal from '../components/EditBookingModal';

interface Props {
  bookings: Booking[];
  rooms: Room[];
  fixedSchedules: FixedSchedule[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Omit<Booking, 'id'>) => Promise<{ success: boolean; message?: string }>;
  onToggleFixed: (id: string) => void;
}

export default function Bookings({ 
  bookings, rooms, fixedSchedules, 
  onDelete, onUpdate, onToggleFixed
}: Props) {
  const sortedBookings = [...bookings].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const [activeSubTab, setActiveSubTab] = useState<'manual' | 'recurring'>('manual');
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);

  const WEEK_DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 font-sans">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gold-500/30 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-gold-500 border-r-4 border-gold-500 pr-3">سجل المواعيد والحجوزات</h2>
          <span className="text-[10px] text-gold-500/60 font-mono tracking-widest">RESERVATIONS &amp; TIMETABLE</span>
        </div>
      </div>

      <div className="flex border-b border-white/5 pb-0.5">
        <button onClick={() => setActiveSubTab('manual')} className={`px-6 py-3 font-bold text-sm border-b-2 transition-all flex items-center gap-2 ${activeSubTab === 'manual' ? 'border-gold-500 text-gold-500' : 'border-transparent text-gray-400 hover:text-white'}`}><Sliders size={16} /> الحجوزات اليدوية ({bookings.length})</button>
        <button onClick={() => setActiveSubTab('recurring')} className={`px-6 py-3 font-bold text-sm border-b-2 transition-all flex items-center gap-2 ${activeSubTab === 'recurring' ? 'border-gold-500 text-gold-500' : 'border-transparent text-gray-400 hover:text-white'}`}><Layers size={16} /> الجداول المستمرة ({fixedSchedules.length})</button>
      </div>

      {activeSubTab === 'manual' && (
        <div className="bg-[#111] border border-white/5 rounded-3xl overflow-hidden shadow-2xl mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead className="bg-[#161616] border-b border-white/5">
                <tr>
                  <th className="p-5 text-gray-400 font-bold text-sm">رقم الحجز</th>
                  <th className="p-5 text-gray-400 font-bold text-sm">اسم القاعة</th>
                  <th className="p-5 text-gray-400 font-bold text-sm">تاريخ الحجز</th>
                  <th className="p-5 text-gray-400 font-bold text-sm text-center">البداية</th>
                  <th className="p-5 text-gray-400 font-bold text-sm text-center">النهاية</th>
                  <th className="p-5 text-gray-400 font-bold text-sm text-center w-28">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 leading-relaxed font-medium">
                {sortedBookings.length === 0 ? (
                  <tr><td colSpan={6} className="p-16 text-center text-gray-500 bg-[#111]"><div className="flex flex-col items-center gap-3"><CalendarX2 size={40} className="text-gray-700" /><span className="font-bold">لا توجد حجوزات يدوية حالياً.</span></div></td></tr>
                ) : sortedBookings.map(booking => {
                  const room = rooms.find(r => r.id === booking.roomId);
                  return (
                    <tr key={booking.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-5"><span className="bg-[#222] text-gray-300 border border-white/5 font-mono px-3 py-1 rounded-lg text-xs tracking-wider">#{booking.id.substring(0,5).toUpperCase()}</span></td>
                      <td className="p-5 font-bold text-white whitespace-nowrap">{room?.name || 'غير معروف'}</td>
                      <td className="p-5 text-gray-300 font-mono">{booking.date}</td>
                      <td className="p-5 text-gray-300 font-mono text-center">{formatTime12Hour(booking.startTime)}</td>
                      <td className="p-5 text-gray-300 font-mono text-center">{formatTime12Hour(booking.endTime)}</td>
                      <td className="p-5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setEditingBooking(booking)} className="p-2 text-gold-400 hover:text-gold-500 rounded-lg transition-colors hover:bg-white/5" title="تعديل الحجز"><Edit2 size={18} /></button>
                          <button onClick={() => onDelete(booking.id)} className="p-2 text-red-400 hover:text-red-500 rounded-lg transition-colors hover:bg-white/5" title="إلغاء الحجز"><Trash2 size={18} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'recurring' && (
        <div className="mt-4">
          <div className="bg-[#111] border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead className="bg-[#161616] border-b border-white/5">
                  <tr>
                    <th className="p-5 text-gray-400 font-bold text-sm">اسم القاعة</th>
                    <th className="p-5 text-gray-400 font-bold text-sm">اليوم</th>
                    <th className="p-5 text-gray-400 font-bold text-sm">رمز المادة</th>
                    <th className="p-5 text-gray-400 font-bold text-sm">عضو هيئة التدريس</th>
                    <th className="p-5 text-gray-400 font-bold text-sm text-center">البداية</th>
                    <th className="p-5 text-gray-400 font-bold text-sm text-center">النهاية</th>
                    <th className="p-5 text-gray-400 font-bold text-sm text-center">الحالة</th>
                    <th className="p-5 text-gray-400 font-bold text-sm text-center w-28">التحكم اليدوي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 leading-relaxed font-medium">
                  {fixedSchedules.length === 0 ? (
                    <tr><td colSpan={8} className="p-16 text-center text-gray-500"><div className="flex flex-col items-center gap-3"><CalendarX2 size={40} className="text-gray-700" /><span className="font-bold">لا توجد جداول مستمرة.</span></div></td></tr>
                  ) : fixedSchedules.map(fs => {
                    const room = rooms.find(r => r.id === fs.roomId);
                    return (
                      <tr key={fs.id} className={`hover:bg-white/5 transition-colors ${fs.disabled ? 'opacity-40 line-through' : ''}`}>
                        <td className="p-5 font-bold text-white whitespace-nowrap">{room?.name || 'غير معروف'}</td>
                        <td className="p-5 text-gray-300">{WEEK_DAYS[fs.dayOfWeek]}</td>
                        <td className="p-5 font-bold text-white">{fs.courseCode || 'بدون رمز'}</td>
                        <td className="p-5 text-gray-300">{fs.professor || '-'}</td>
                        <td className="p-5 text-gray-300 font-mono text-center">{formatTime12Hour(fs.startTime)}</td>
                        <td className="p-5 text-gray-300 font-mono text-center">{formatTime12Hour(fs.endTime)}</td>
                        <td className="p-5 text-center"><span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${fs.disabled ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-green-500/10 text-green-500 border-green-500/30'}`}>{fs.disabled ? 'معطل مؤقتاً' : 'نشط مستمر'}</span></td>
                        <td className="p-5 text-center"><button onClick={() => onToggleFixed(fs.id)} className="bg-[#222] border border-white/10 hover:border-gold-500 hover:text-gold-500 text-gray-300 px-3 py-1.5 rounded-lg text-xs transition-colors">{fs.disabled ? 'تفعيل' : 'تعطيل'}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {editingBooking && (
        <EditBookingModal
          booking={editingBooking}
          roomName={rooms.find(r => r.id === editingBooking.roomId)?.name || 'غير معروف'}
          onClose={() => setEditingBooking(null)}
          onSave={(updates) => onUpdate(editingBooking.id, updates)}
        />
      )}
    </div>
  );
}
