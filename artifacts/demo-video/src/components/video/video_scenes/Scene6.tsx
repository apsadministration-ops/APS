import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 3500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#020617]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      {phase < 3 ? (
        <motion.div
          className="relative w-[300px] bg-[#0F172A] rounded-[40px] border-[8px] border-gray-800 overflow-hidden shadow-2xl p-6"
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
        >
          <div className="text-center mb-8">
            <h3 className="text-gray-400 font-medium">Total Paid</h3>
            <p className="text-4xl font-bold text-white mt-2">$295.50</p>
          </div>

          {phase >= 1 && (
            <motion.div
              className="space-y-4 text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <p className="text-white font-medium">Rate Mike Wrench</p>
              <div className="flex justify-center gap-2 text-yellow-400 text-2xl">
                ★★★★★
              </div>
              <div className="bg-emerald-500/20 text-emerald-400 p-3 rounded-xl text-sm font-bold mt-4">
                +100 Loyalty Points
              </div>
            </motion.div>
          )}
        </motion.div>
      ) : (
        <motion.div
          className="text-center"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        >
          <h1 className="text-8xl font-black font-display text-white tracking-tighter mb-6">
            APS
          </h1>
          <p className="text-3xl text-blue-400 font-medium tracking-wide">
            One VIN. Every service. Forever.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
