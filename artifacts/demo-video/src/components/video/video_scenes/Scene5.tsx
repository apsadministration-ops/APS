import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 3000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(10px)' }}
      transition={{ duration: 0.8 }}
    >
      <div className="z-10 text-center mb-12">
        <motion.h1 className="text-[5vw] font-bold leading-none mb-4"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 100 }}
        >
          <span className="text-white">The Loop is </span>
          <span className="text-gradient">Complete.</span>
        </motion.h1>
        <motion.p className="text-[#94A3B8] text-[1.5vw]"
          initial={{ opacity: 0 }}
          animate={phase >= 1 ? { opacity: 1 } : {}}
        >
          Permanent service history. Total transparency.
        </motion.p>
      </div>

      <div className="z-10 flex gap-8 items-center">
        {/* Inspection Card 1 */}
        <motion.div className="bg-[#1E293B] border border-white/10 rounded-3xl p-6 w-[280px] shadow-2xl"
          initial={{ opacity: 0, x: -50, rotate: -5 }}
          animate={phase >= 2 ? { opacity: 1, x: 0, rotate: 0 } : {}}
          transition={{ type: 'spring' }}
        >
          <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2">
            <div className="text-white font-bold">Pre-Inspection</div>
            <div className="text-[#0EA5E9] text-sm">78,420 mi</div>
          </div>
          <div className="space-y-2">
             <div className="flex items-center text-sm text-[#94A3B8]"><span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span> No major damage</div>
             <div className="flex items-center text-sm text-[#94A3B8]"><span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span> Transport Pickup</div>
          </div>
        </motion.div>

        {/* Worklog Card */}
        <motion.div className="bg-[#0F172A] border border-[#0EA5E9]/50 rounded-3xl p-8 w-[320px] shadow-2xl z-20"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1 } : {}}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
           <div className="text-center mb-6">
              <div className="text-[#0EA5E9] font-bold text-xl mb-1">Work Log Submitted</div>
              <div className="text-[#94A3B8] text-sm">CV Axle Replacement</div>
           </div>
           <div className="bg-white/5 p-4 rounded-xl text-center">
              <div className="text-white font-mono text-xl">$385.00</div>
              <div className="text-xs text-[#94A3B8] mt-1">Paid securely</div>
           </div>
        </motion.div>

        {/* Inspection Card 2 */}
        <motion.div className="bg-[#1E293B] border border-white/10 rounded-3xl p-6 w-[280px] shadow-2xl"
          initial={{ opacity: 0, x: 50, rotate: 5 }}
          animate={phase >= 4 ? { opacity: 1, x: 0, rotate: 0 } : {}}
          transition={{ type: 'spring' }}
        >
          <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2">
            <div className="text-white font-bold">Post-Inspection</div>
            <div className="text-[#0EA5E9] text-sm">78,431 mi</div>
          </div>
          <div className="space-y-2">
             <div className="flex items-center text-sm text-[#94A3B8]"><span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span> Clean test drive</div>
             <div className="flex items-center text-sm text-[#94A3B8]"><span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span> Transport Return</div>
          </div>
        </motion.div>
      </div>

    </motion.div>
  );
}