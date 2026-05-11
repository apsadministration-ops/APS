import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
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
      className="absolute inset-0 flex items-center justify-center px-[10vw]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
      transition={{ duration: 0.8 }}
    >
      <div className="w-full flex justify-between items-center z-10">
        
        <div className="w-[40vw]">
          <motion.div className="relative bg-[#1E293B] border-[6px] border-[#0F172A] rounded-[40px] w-full max-w-[320px] h-[600px] overflow-hidden shadow-2xl mx-auto"
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 25, stiffness: 100 }}
          >
            <div className="bg-[#0F172A] text-white p-6 pt-10 border-b border-white/10">
              <h2 className="text-xl font-bold">Diagnostic Work Log</h2>
            </div>
            
            <div className="p-4 space-y-3">
              <motion.div className="bg-white/5 p-3 rounded-xl border border-white/10"
                initial={{ opacity: 0, x: -20 }}
                animate={phase >= 1 ? { opacity: 1, x: 0 } : {}}
              >
                <div className="text-xs text-[#94A3B8] mb-1">Post-Inspection</div>
                <div className="text-sm text-white">78,431 mi. No new damage.</div>
              </motion.div>

              {phase >= 2 && (
                <motion.div className="bg-white/5 p-3 rounded-xl border border-white/10"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <div className="text-xs text-[#94A3B8] mb-1">Root Cause</div>
                  <div className="text-sm text-white font-mono leading-tight bg-[#0F172A] p-2 rounded">Inner CV joint had play causing the click on left turns.</div>
                </motion.div>
              )}

              {phase >= 3 && (
                <motion.div className="bg-white/5 p-3 rounded-xl border border-white/10"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <div className="text-xs text-[#94A3B8] mb-1">Parts & Labor</div>
                  <div className="flex justify-between text-sm text-white border-b border-white/10 pb-1 mb-1">
                    <span>GSP NCV23568 Axle</span>
                    <span>$165</span>
                  </div>
                  <div className="flex justify-between text-sm text-white">
                    <span>Labor (1.75 hr)</span>
                    <span>$220</span>
                  </div>
                </motion.div>
              )}

              {phase >= 4 && (
                <motion.div className="bg-[#10B981] p-3 rounded-xl text-center text-white font-bold shadow-lg"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  Submit Log
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>

        <div className="w-1/2 text-right">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-[#10B981] font-mono text-sm tracking-widest mb-4 uppercase"
          >
            03 // Mechanic (Continued)
          </motion.div>
          
          <h1 className="text-[4vw] font-bold leading-tight">
            <motion.span className="block"
              initial={{ opacity: 0, x: 50 }}
              animate={phase >= 1 ? { opacity: 1, x: 0 } : {}}
              transition={{ type: 'spring', damping: 20, stiffness: 100 }}
            >
              Repair &
            </motion.span>
            <motion.span className="block text-gradient"
              initial={{ opacity: 0, x: 50 }}
              animate={phase >= 2 ? { opacity: 1, x: 0 } : {}}
              transition={{ type: 'spring', damping: 20, stiffness: 100 }}
              style={{ backgroundImage: 'linear-gradient(to right, #10B981, #34D399)' }}
            >
              Documentation
            </motion.span>
          </h1>
          
          <motion.p className="text-[#94A3B8] mt-6 text-[1.5vw] max-w-md ml-auto"
            initial={{ opacity: 0 }}
            animate={phase >= 3 ? { opacity: 1 } : {}}
            transition={{ duration: 0.6 }}
          >
            Completes the repair on the lift. Submits a diagnostic-rich Phase-3 work log with root cause analysis.
          </motion.p>
        </div>

      </div>
    </motion.div>
  );
}