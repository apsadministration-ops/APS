import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2400),
      setTimeout(() => setPhase(4), 3600),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 0.8 }}
    >
      <div className="z-10 w-1/2">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-[#10B981] font-mono text-sm tracking-widest mb-4 uppercase"
        >
          03 // Mechanic (Technician Tier)
        </motion.div>
        
        <h1 className="text-[4vw] font-bold leading-tight">
          <motion.span className="block"
            initial={{ opacity: 0, x: -50 }}
            animate={phase >= 1 ? { opacity: 1, x: 0 } : {}}
            transition={{ type: 'spring', damping: 20, stiffness: 100 }}
          >
            Pre-Inspection &
          </motion.span>
          <motion.span className="block text-gradient"
            initial={{ opacity: 0, x: -50 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : {}}
            transition={{ type: 'spring', damping: 20, stiffness: 100 }}
            style={{ backgroundImage: 'linear-gradient(to right, #10B981, #34D399)' }}
          >
            Bay Booking
          </motion.span>
        </h1>
        
        <motion.p className="text-[#94A3B8] mt-6 text-[1.5vw] max-w-md"
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : {}}
          transition={{ duration: 0.6 }}
        >
          Logs 78,420 mi at pickup. Checks for existing damage. Books Bay #1 for 2 hours and transports the vehicle.
        </motion.p>
      </div>

      <div className="z-10 w-[40vw]">
        <motion.div className="relative bg-[#1E293B] border-[6px] border-[#0F172A] rounded-[40px] w-full max-w-[320px] h-[600px] overflow-hidden shadow-2xl mx-auto"
          initial={{ y: -50, opacity: 0, rotateY: 15 }}
          animate={{ y: 0, opacity: 1, rotateY: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 100 }}
          style={{ perspective: 1000 }}
        >
          <div className="bg-[#0F172A] text-white p-6 pt-10">
            <h2 className="text-xl font-bold">Active Job</h2>
          </div>

          <div className="p-4 space-y-4">
            <motion.div className="bg-white/5 p-4 rounded-2xl border border-white/10"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={phase >= 1 ? { opacity: 1, scale: 1 } : {}}
            >
              <div className="flex justify-between items-center mb-2">
                <div className="font-bold text-white">Pre-Inspection</div>
                <div className="text-xs bg-[#10B981] px-2 py-1 rounded-full text-white">Done</div>
              </div>
              <div className="flex gap-2">
                 <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
                 <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
                 <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
              </div>
              <div className="mt-2 text-xs text-[#94A3B8]">Mileage: 78,420</div>
            </motion.div>

            {phase >= 2 && (
               <motion.div className="bg-white/5 p-4 rounded-2xl border border-white/10"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <div className="font-bold text-white mb-2">Booked Bay</div>
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-full bg-[#0EA5E9]/20 flex items-center justify-center text-[#0EA5E9]">B1</div>
                   <div>
                     <div className="text-sm font-bold text-white">Lift City Garage</div>
                     <div className="text-xs text-[#94A3B8]">2 hours • IN_PROGRESS</div>
                   </div>
                </div>
              </motion.div>
            )}
            
            {phase >= 3 && (
              <motion.div className="bg-[#10B981]/20 border border-[#10B981]/50 p-4 rounded-2xl text-center text-[#10B981] font-bold"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                En Route to Shop
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}