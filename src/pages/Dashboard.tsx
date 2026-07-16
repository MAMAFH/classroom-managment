import React from 'react';
import { Room, Booking, FixedSchedule } from '../types';
import { isRoomCurrentlyBooked } from '../utils';
import { Home, CheckCircle2, XCircle } from 'lucide-react';

interface Props {
  rooms: Room[];
  bookings: Booking[];
  fixedSchedules?: FixedSchedule[];
}

export default function Dashboard({ rooms, bookings, fixedSchedules = [] }: Props) {
  const total = rooms.length;
  const bookedRooms = rooms.filter(r => isRoomCurrentlyBooked(r.id, bookings, fixedSchedules)).length;
  const availableRooms = total - bookedRooms;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <h2 className="text-2xl font-bold text-gold-500 border-b border-gold-500/30 pb-2">الرئيسية (الإحصائيات)</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
        
        <div className="bg-[#161616] border border-white/5 p-6 rounded-2xl flex items-center justify-between shadow-lg hover:border-gold-500/50 transition-colors">
          <div>
            <p className="text-gray-400 text-sm mb-1 font-semibold">إجمالي القاعات</p>
            <p className="text-4xl font-bold text-gold-500">{total}</p>
          </div>
          <div className="p-4 bg-gold-500/10 rounded-full text-gold-500 shadow-inner">
            <Home size={32} />
          </div>
        </div>

        <div className="bg-[#161616] border border-white/5 p-6 rounded-2xl flex items-center justify-between shadow-lg hover:border-green-500/50 transition-colors">
          <div>
            <p className="text-green-400/80 text-sm mb-1 font-semibold">القاعات المتاحة (الآن)</p>
            <p className="text-4xl font-bold text-green-500">{availableRooms}</p>
          </div>
          <div className="p-4 bg-green-500/10 rounded-full text-green-500 shadow-inner">
            <CheckCircle2 size={32} />
          </div>
        </div>

        <div className="bg-[#161616] border border-white/5 p-6 rounded-2xl flex items-center justify-between shadow-lg hover:border-red-500/50 transition-colors">
          <div>
            <p className="text-red-400/80 text-sm mb-1 font-semibold">القاعات المحجوزة (الآن)</p>
            <p className="text-4xl font-bold text-red-500">{bookedRooms}</p>
          </div>
          <div className="p-4 bg-red-500/10 rounded-full text-red-500 shadow-inner">
            <XCircle size={32} />
          </div>
        </div>

      </div>
    </div>
  );
}
