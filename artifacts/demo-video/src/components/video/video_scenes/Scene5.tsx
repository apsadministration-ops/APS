import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene5() {
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
      className="absolute inset-0 flex flex-col items-center justify-center px-[10vw]"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, filter: 'blur(10px)' }}
      transition={{ duration: 0.8 }}
    >
      <motion.h2
        className="text-5xl font-display font-bold text-white mb-12 text-center"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        Everything documented. Forever.
      </motion.h2>

      <div className="flex gap-12 w-full max-w-5xl">
        <motion.div
          className="flex-1 bg-slate-800/80 backdrop-blur-md p-8 rounded-3xl border border-slate-700"
          initial={{ opacity: 0, x: -30 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
        >
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-700">
            <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center text-blue-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white">Digital Work Log</h3>
              <p className="text-gray-400">Mike Wrench • Oct 24, 2023</p>
            </div>
          </div>

          <div className="space-y-4">
            {phase >= 2 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-900 p-4 rounded-xl"
              >
                <p className="text-sm text-gray-400 mb-1">Service Performed</p>
                <p className="text-white font-medium">Replaced Front Brake Pads</p>
              </motion.div>
            )}
            {phase >= 2 && (
               <motion.div
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: 0.2 }}
               className="bg-slate-900 p-4 rounded-xl"
             >
               <p className="text-sm text-gray-400 mb-1">Parts Used</p>
               <p className="text-white font-medium">Ceramic Brake Pads (OEM)</p>
             </motion.div>
            )}
            
            {phase >= 3 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-blue-500/10 border border-blue-500/30 p-4 rounded-xl mt-4"
              >
                <p className="text-sm text-blue-400 mb-1">Mechanic Notes</p>
                <p className="text-gray-300 italic">"Customer should expect light squeak for first 50 miles during pad bedding."</p>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
