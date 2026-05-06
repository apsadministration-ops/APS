import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-[40vw]">
        <motion.h2
          className="text-5xl font-display font-bold text-white leading-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        >
          Add your vehicle once.
        </motion.h2>
        <motion.p
          className="text-2xl text-gray-400 mt-4"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        >
          Scan the VIN. We handle the rest.
        </motion.p>
      </div>

      <motion.div
        className="relative w-[300px] h-[600px] bg-[#0F172A] rounded-[40px] border-[8px] border-gray-800 overflow-hidden shadow-2xl"
        initial={{ y: 50, opacity: 0, rotateY: 20 }}
        animate={{ y: 0, opacity: 1, rotateY: 0 }}
        transition={{ duration: 1, ease: 'easeOut' }}
        style={{ perspective: 1000 }}
      >
        <div className="p-6 bg-slate-900 h-full flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <span className="text-white font-bold font-display">Garage</span>
            <span className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white">+</span>
          </div>
          
          {phase >= 3 && (
            <motion.div
              className="bg-slate-800 rounded-xl p-4 shadow-lg border border-slate-700"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <div className="h-32 bg-slate-700 rounded-lg mb-4 overflow-hidden relative">
                <img src={`${import.meta.env.BASE_URL}images/honda-accord.png`} className="w-full h-full object-cover" />
              </div>
              <h3 className="text-xl font-bold text-white">2018 Honda Accord</h3>
              <p className="text-sm text-gray-400 mt-1">VIN: 1HGCM82633A123456</p>
              <p className="text-sm text-gray-400">Plate: DEMO-001</p>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
