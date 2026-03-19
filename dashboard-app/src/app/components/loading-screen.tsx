import { motion } from 'motion/react';
import { Sparkles } from 'lucide-react';

export function LoadingScreen() {
  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--bg-primary)]"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Neural mesh background */}
      <div className="neural-mesh pointer-events-none absolute inset-0 opacity-30" />

      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Logo */}
        <motion.div
          className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--gold)] to-[var(--gold-bright)] shadow-[var(--shadow-gold)]"
          animate={{
            boxShadow: [
              '0 0 20px rgba(201, 168, 76, 0.3)',
              '0 0 40px rgba(201, 168, 76, 0.6)',
              '0 0 20px rgba(201, 168, 76, 0.3)',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <span className="font-mono text-3xl font-bold text-black">SM</span>
        </motion.div>

        {/* Text */}
        <div className="text-center">
          <motion.h1
            className="mb-2 text-2xl font-bold text-[var(--text)]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            STANDME OS
          </motion.h1>
          <motion.p
            className="text-sm text-[var(--text-muted)]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            Operations Intelligence Platform
          </motion.p>
        </div>

        {/* Loading indicator */}
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <motion.div
            className="h-2 w-2 rounded-full bg-[var(--gold)]"
            animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity, delay: 0 }}
          />
          <motion.div
            className="h-2 w-2 rounded-full bg-[var(--gold)]"
            animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
          />
          <motion.div
            className="h-2 w-2 rounded-full bg-[var(--gold)]"
            animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
          />
        </motion.div>

        {/* Status text */}
        <motion.p
          className="text-xs text-[var(--text-muted)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          Connecting to StandMe OS...
        </motion.p>
      </div>
    </motion.div>
  );
}
