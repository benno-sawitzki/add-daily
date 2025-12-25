import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";

interface Particle {
  id: number;
  x: number;
  y: number;
  angle: number;
  distance: number;
}

interface MicroConfettiProps {
  triggerKey?: number | string; // Changes to trigger animation
  isActive?: boolean; // Alternative trigger
  onComplete?: () => void;
  position?: { x: number; y: number }; // Position relative to trigger element
}

const PARTICLE_COUNT = 10;
const ANIMATION_DURATION = 0.8; // seconds
const PARTICLE_DISTANCE = 60; // pixels

export default function MicroConfetti({
  triggerKey,
  isActive,
  onComplete,
  position = { x: 0, y: 0 },
}: MicroConfettiProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  
  // Check for reduced motion preference
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if ((triggerKey !== undefined && triggerKey > 0) || isActive) {
      // Generate particles
      const baseX = typeof position.x === 'number' ? position.x : 0;
      const baseY = typeof position.y === 'number' ? position.y : 0;
      const newParticles: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
        id: i,
        x: baseX,
        y: baseY,
        angle: (i / PARTICLE_COUNT) * Math.PI * 2, // Distribute evenly in circle
        distance: PARTICLE_DISTANCE + Math.random() * 20, // Slight variation
      }));
      
      setParticles(newParticles);
      setShouldAnimate(true);
      
      // Reset after animation
      const timer = setTimeout(() => {
        setShouldAnimate(false);
        setParticles([]);
        if (onComplete) onComplete();
      }, ANIMATION_DURATION * 1000);
      
      return () => clearTimeout(timer);
    }
  }, [triggerKey, isActive, position.x, position.y, onComplete]);

  // Reduced motion fallback: show simple checkmark flash
  if (prefersReducedMotion) {
    return (
      <AnimatePresence>
        {shouldAnimate && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.3 }}
            className="absolute pointer-events-none"
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {shouldAnimate && (
        <div className="absolute pointer-events-none inset-0 overflow-visible z-[100]">
          {particles.map((particle) => {
            const baseX = typeof position.x === 'number' ? position.x : 0;
            const baseY = typeof position.y === 'number' ? position.y : 0;
            const endX = baseX + Math.cos(particle.angle) * particle.distance;
            const endY = baseY + Math.sin(particle.angle) * particle.distance;
            
            return (
              <motion.div
                key={particle.id}
                initial={{
                  x: baseX,
                  y: baseY,
                  opacity: 1,
                  scale: 0.8,
                }}
                animate={{
                  x: endX,
                  y: endY,
                  opacity: 0,
                  scale: 0.3,
                }}
                exit={{
                  opacity: 0,
                }}
                transition={{
                  duration: ANIMATION_DURATION,
                  ease: "easeOut",
                }}
                className="absolute"
                style={{
                  left: `${baseX}px`,
                  top: `${baseY}px`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <Sparkles className="w-4 h-4 text-primary" />
              </motion.div>
            );
          })}
        </div>
      )}
    </AnimatePresence>
  );
}

