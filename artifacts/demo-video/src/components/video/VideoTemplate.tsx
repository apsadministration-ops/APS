import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

export const SCENE_DURATIONS = {
  shopOwner: 5000,
  customer: 4500,
  mechanicPre: 5000,
  mechanicPost: 5000,
  completedLoop: 4500,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  shopOwner: Scene1,
  customer: Scene2,
  mechanicPre: Scene3,
  mechanicPost: Scene4,
  completedLoop: Scene5,
};

const SCENE_KEYS = Object.keys(SCENE_DURATIONS);

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const sceneIndex = SCENE_KEYS.indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    <div className="w-full h-screen overflow-hidden relative bg-[#0B0F19] text-white">
      {/* Global Background Layer */}
      <div className="absolute inset-0 z-0">
        {/* Dark Metal Texture */}
        <motion.div 
          className="absolute inset-0 opacity-20 bg-cover bg-center mix-blend-overlay"
          style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/dark-metal-bg.png)` }}
          animate={{
            scale: [1, 1.05, 1],
            rotate: [0, 1, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        />
        {/* Blueprint Texture */}
        <motion.div 
          className="absolute inset-0 opacity-15 bg-cover bg-center mix-blend-screen"
          style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/car-blueprint.png)` }}
          animate={{
            x: sceneIndex % 2 === 0 ? '-2%' : '2%',
            y: sceneIndex % 3 === 0 ? '-1%' : '1%',
          }}
          transition={{ duration: 4, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[100px] opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #0EA5E9, transparent)' }}
          animate={{
            x: sceneIndex % 2 === 0 ? '-20%' : '40%',
            y: sceneIndex % 3 === 0 ? '-10%' : '30%',
            scale: sceneIndex === 0 ? 1 : 1.2,
          }}
          transition={{ duration: 3, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-[60vw] h-[60vw] rounded-full blur-[80px] opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #F59E0B, transparent)' }}
          animate={{
            x: sceneIndex % 2 !== 0 ? '60%' : '10%',
            y: sceneIndex % 2 === 0 ? '60%' : '10%',
          }}
          transition={{ duration: 4, ease: 'easeInOut' }}
        />
      </div>

      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>
    </div>
  );
}
