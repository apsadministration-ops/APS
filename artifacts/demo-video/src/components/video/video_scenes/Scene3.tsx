import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 0.8 }}
    >
      <motion.div
        className="relative w-[300px] h-[600px] bg-[#0F172A] rounded-[40px] border-[8px] border-gray-800 overflow-hidden shadow-2xl"
        initial={{ x: -50, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 1 }}
      >
        <div className="p-6 bg-slate-900 h-full">
          <h3 className="text-white font-bold font-display text-xl mb-6">Request Service</h3>
          
          <div className="space-y-4">
            <div className="bg-slate-800 p-4 rounded-xl border border-blue-500/50">
              <p className="text-sm text-blue-400 font-bold">Diagnostic</p>
            </div>
            
            <motion.div
              className="bg-slate-800 p-4 rounded-xl"
              initial={{ height: 40 }}
              animate={phase >= 1 ? { height: 100 } : { height: 40 }}
            >
              {phase >= 1 && (
                <motion.p
                  className="text-gray-300 text-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  "Check engine light + hesitation when accelerating"
                </motion.p>
              )}
            </motion.div>
            
            <motion.div
              className="bg-blue-600 p-4 rounded-xl mt-8 flex justify-center"
              initial={{ scale: 1 }}
              animate={phase >= 2 ? { scale: [1, 0.95, 1], backgroundColor: '#2563EB' } : {}}
            >
              <span className="text-white font-bold">Confirm Request</span>
            </motion.div>

            {phase >= 3 && (
              <motion.div
                className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="w-16 h-16 rounded-full border-4 border-blue-500 border-t-transparent animate-spin mb-4" />
                <p className="text-blue-400 font-bold">Finding mechanic...</p>
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>

      <div className="w-[40vw]">
        <motion.h2
          className="text-5xl font-display font-bold text-white leading-tight"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
        >
          Describe the problem.
        </motion.h2>
        <motion.p
          className="text-2xl text-gray-400 mt-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          We'll find the right expert.
        </motion.p>
      </div>
    </motion.div>
  );
}
