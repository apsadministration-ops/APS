import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene2() {
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
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
      transition={{ duration: 0.8 }}
    >
      <div className="z-10 w-[40vw]">
        {/* Phone Mockup */}
        <motion.div className="relative bg-[#1E293B] border-[6px] border-[#0F172A] rounded-[40px] w-full max-w-[320px] h-[600px] overflow-hidden shadow-2xl mx-auto"
          initial={{ y: 50, opacity: 0, rotateY: -15 }}
          animate={{ y: 0, opacity: 1, rotateY: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 100 }}
          style={{ perspective: 1000 }}
        >
          {/* Header */}
          <div className="bg-[#0F172A] text-white p-6 pt-10">
            <h2 className="text-xl font-bold">2018 Subaru Outback</h2>
            <p className="text-[#94A3B8] text-sm">VIN: JF2SJAEC9JH...</p>
          </div>

          <div className="p-4 space-y-4">
            <motion.div className="bg-white/5 p-4 rounded-2xl border border-white/10"
              initial={{ opacity: 0, x: -20 }}
              animate={phase >= 1 ? { opacity: 1, x: 0 } : {}}
            >
              <div className="font-bold mb-1 text-white">Issue</div>
              <div className="text-[#94A3B8] text-sm leading-snug">Front-left CV axle clicking on hard-left turns. Needs lift to drop subframe.</div>
            </motion.div>

            {phase >= 2 && (
              <motion.div className="bg-[#0EA5E9]/20 border border-[#0EA5E9]/50 p-4 rounded-2xl text-center"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring' }}
              >
                <div className="font-bold text-[#0EA5E9] mb-1">Ghost Garage</div>
                <div className="text-sm text-white/80">Transport + Bay Repair</div>
              </motion.div>
            )}

            {phase >= 3 && (
              <motion.div className="bg-[#10B981] p-4 rounded-2xl text-center text-white font-bold"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                Transport Approved
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>

      <div className="z-10 w-1/2 text-right">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-[#F59E0B] font-mono text-sm tracking-widest mb-4 uppercase"
        >
          02 // Customer
        </motion.div>
        
        <h1 className="text-[4vw] font-bold leading-tight">
          <motion.span className="block"
            initial={{ opacity: 0, x: 50 }}
            animate={phase >= 1 ? { opacity: 1, x: 0 } : {}}
            transition={{ type: 'spring', damping: 20, stiffness: 100 }}
          >
            Ghost Garage
          </motion.span>
          <motion.span className="block text-gradient"
            initial={{ opacity: 0, x: 50 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : {}}
            transition={{ type: 'spring', damping: 20, stiffness: 100 }}
            style={{ backgroundImage: 'linear-gradient(to right, #F59E0B, #FBBF24)' }}
          >
            Request
          </motion.span>
        </h1>
        
        <motion.p className="text-[#94A3B8] mt-6 text-[1.5vw] max-w-md ml-auto"
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : {}}
          transition={{ duration: 0.6 }}
        >
          Customer needs a major repair but has no lift. 
          They approve transport to a Ghost Bay in one tap.
        </motion.p>
      </div>
    </motion.div>
  );
}