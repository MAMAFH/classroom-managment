import React, { useState, useEffect } from 'react';
import { Booking } from '../types';
import { X, XCircle, CheckCircle2 } from 'lucide-react';

interface Props {
  booking: Booking;
  roomName: string;
  onClose: () => void;
  onSave: (updates: Omit<Booking, 'id'>) => Promise<{ success: boolean; message?: string }>;
}

export default function EditBookingModal({ booking, roomName, onClose, onSave }: Props) {
  const [date, setDate] = useState(booking.date);
  const [startTime, setStartTime] = useState(booking.startTime);
  const [endTime, setEndTime] = useState(booking.endTime);
  const [courseCode, setCourseCode] = useState(booking.courseCode || '');
  const [professor, setProfessor] = useState(booking.professor || '');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDate(booking.date);
    setStartTime(booking.startTime);
    setEndTime(booking.endTime);
    setCourseCode(booking.courseCode || '');
    setProfessor(booking.professor || '');
    setError('');
    setSuccess('');
  }, [booking]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!date || !startTime || !endTime) {
      setError('يرجى تعبئة جميع الحقول المطلوبة.');
      return;
    }
    if (startTime >= endTime) {
      setError('وقت النهاية يجب أن يكون أكبر من وقت البداية.');
      return;
    }
    if (endTime > '20:30') {
      setError('الجامعة تغلق أبوابها الساعة 8:30 مساءً. لا يمكن الحجز بعد هذا الوقت.');
      return;
    }

    setSaving(true);
    const res = await onSave({
      roomId: booking.roomId,
      date,
      startTime,
      endTime,
      courseCode: courseCode.trim(),
      professor: professor.trim(),
    });
    setSaving(false);

    if (res.success) {
      setSuccess('تم تحديث الحجز بنجاح!');
      setTimeout(onClose, 1200);
    } else {
      setError(res.message || 'فشل تحديث الحجز.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="bg-[#111] border border-gold-500/50 w-full max-w-md rounded-2xl p-6 shadow-[0_0_50px_rgba(212,175,55,0.1)] animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h4 className="text-lg font-bold text-gold-500">تعديل الحجز اليدوي</h4>
            <p className="text-xs text-gray-500 mt-1">{roomName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2 text-gray-400 hover:text-white bg-[#222] hover:bg-[#333] rounded-full transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-gray-400">تاريخ الحجز</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-[#222] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-gold-500 font-mono"
              style={{ colorScheme: 'dark' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-400">من</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-[#222] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-gold-500 font-mono"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">إلى</label>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-[#222] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-gold-500 font-mono"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-400">رمز المادة (اختياري)</label>
            <input
              type="text"
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
              className="w-full bg-[#222] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-gold-500"
              placeholder="مثال: CS101"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-400">عضو هيئة التدريس (اختياري)</label>
            <input
              type="text"
              value={professor}
              onChange={(e) => setProfessor(e.target.value)}
              className="w-full bg-[#222] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-gold-500"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-500 p-3 rounded-xl flex items-start gap-2">
              <XCircle size={14} className="shrink-0 mt-0.5" />
              <p className="text-xs">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-500/10 border border-green-500/30 text-green-500 p-3 rounded-xl flex items-start gap-2">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              <p className="text-xs">{success}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-gold-500 text-black font-bold py-2.5 rounded-xl hover:bg-gold-400 transition-colors disabled:opacity-50"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 bg-[#222] hover:bg-[#333] text-gray-300 border border-white/5 py-2.5 rounded-xl transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
