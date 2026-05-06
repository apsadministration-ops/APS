import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';

const SCENE_DURATIONS = {
  hook: 5000,
  addVehicle: 6000,
  requestService: 6000,
  mechanicEnRoute: 6000,
  workLog: 6000,
  closure: 6000,
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="w-full h-screen overflow-hidden relative bg-[#020617]">
      {/* Global Background Layer */}
      <div className="absolute inset-0 z-0">
        <motion.div
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[100px] opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--color-accent), transparent)' }}
          animate={{
            x: currentScene % 2 === 0 ? '-20%' : '40%',
            y: currentScene % 3 === 0 ? '-10%' : '30%',
            scale: currentScene === 0 ? 1 : 1.2,
          }}
          transition={{ duration: 3, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-[60vw] h-[60vw] rounded-full blur-[80px] opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #38bdf8, transparent)' }}
          animate={{
            x: currentScene % 2 !== 0 ? '60%' : '10%',
            y: currentScene % 2 === 0 ? '60%' : '10%',
          }}
          transition={{ duration: 4, ease: 'easeInOut' }}
        />
      </div>

      <AnimatePresence mode="popLayout">
        {currentScene === 0 && <Scene1 key="hook" />}
        {currentScene === 1 && <Scene2 key="addVehicle" />}
        {currentScene === 2 && <Scene3 key="requestService" />}
        {currentScene === 3 && <Scene4 key="mechanicEnRoute" />}
        {currentScene === 4 && <Scene5 key="workLog" />}
        {currentScene === 5 && <Scene6 key="closure" />}
      </AnimatePresence>
    </div>
  );
}
