import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene4() {
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
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 0.8 }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/tech-map.png`}
        className="absolute inset-0 w-full h-full object-cover opacity-40"
        animate={{ scale: 1.2, x: -50 }}
        transition={{ duration: 10, ease: 'linear' }}
      />
      
      <div className="relative z-10 flex items-center justify-between w-full px-[10vw]">
        <div className="w-[40vw]">
          <motion.div
            className="bg-slate-800/80 backdrop-blur-xl p-6 rounded-2xl border border-slate-700 inline-block mb-6"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <div className="flex items-center gap-4">
              <img src={`${import.meta.env.BASE_URL}images/mechanic-profile.png`} className="w-16 h-16 rounded-full" />
              <div>
                <h4 className="text-xl font-bold text-white">Mike Wrench</h4>
                <p className="text-blue-400">Senior ASE Certified</p>
              </div>
            </div>
          </motion.div>
          <motion.h2
            className="text-5xl font-display font-bold text-white leading-tight"
            initial={{ opacity: 0 }}
            animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
          >
            Help is on the way.
          </motion.h2>
          <motion.p
            className="text-2xl text-gray-400 mt-4"
            initial={{ opacity: 0 }}
            animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          >
            Track your mechanic live.
          </motion.p>
        </div>

        <motion.div
          className="relative w-[300px] h-[600px] bg-[#0F172A] rounded-[40px] border-[8px] border-gray-800 overflow-hidden shadow-2xl"
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
        >
          <div className="relative h-2/3 bg-slate-800 overflow-hidden">
            <img src={`${import.meta.env.BASE_URL}images/tech-map.png`} className="w-[200%] h-[200%] max-w-none object-cover opacity-80 -ml-[50%] -mt-[50%]" />
            {phase >= 1 && (
              <motion.div
                className="absolute w-8 h-8 bg-blue-500 rounded-full border-4 border-white shadow-lg z-10"
                initial={{ top: '80%', left: '80%' }}
                animate={{ top: '40%', left: '50%' }}
                transition={{ duration: 4, ease: 'linear' }}
              />
            )}
             <div className="absolute top-[40%] left-[50%] w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow-lg z-0" />
          </div>
          <div className="h-1/3 bg-slate-900 p-6 flex flex-col justify-center">
            <p className="text-gray-400 text-sm">Status</p>
            <h3 className="text-2xl font-bold text-blue-400">EN ROUTE</h3>
            <p className="text-white mt-2">Arriving in 12 mins</p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
