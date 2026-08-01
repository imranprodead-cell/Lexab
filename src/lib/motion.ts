/* Скопировано дословно из эталона "new design/lib/motion.ts". */
export const EASE = [0.16, 1, 0.3, 1] as const;

export const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 26 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: EASE, delay },
});
