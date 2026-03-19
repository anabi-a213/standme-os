import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { useState, useEffect } from 'react';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  autoDismiss?: boolean;
}

interface ToastSystemProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastSystem({ toasts, onDismiss }: ToastSystemProps) {
  const getIcon = (type: Toast['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="h-4 w-4" />;
      case 'error':
        return <XCircle className="h-4 w-4" />;
      case 'info':
        return <Info className="h-4 w-4" />;
    }
  };

  const getColors = (type: Toast['type']) => {
    switch (type) {
      case 'success':
        return 'border-l-[var(--success)] bg-[var(--success-dim)] text-[var(--success)]';
      case 'error':
        return 'border-l-[var(--error)] bg-[var(--error-dim)] text-[var(--error)]';
      case 'info':
        return 'border-l-[var(--gold)] bg-[var(--gold-dim)] text-[var(--gold)]';
    }
  };

  return (
    <div className="pointer-events-none fixed right-6 top-20 z-[150] flex flex-col gap-3">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={onDismiss}
            icon={getIcon(toast.type)}
            colors={getColors(toast.type)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
  icon: React.ReactNode;
  colors: string;
}

function ToastItem({ toast, onDismiss, icon, colors }: ToastItemProps) {
  useEffect(() => {
    if (toast.autoDismiss !== false && toast.type !== 'error') {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, toast.type === 'success' ? 4000 : 3000);
      return () => clearTimeout(timer);
    }
  }, [toast, onDismiss]);

  return (
    <motion.div
      className={`pointer-events-auto flex items-center gap-3 rounded-lg border-l-4 bg-[var(--surface-2)] p-4 shadow-[var(--shadow-xl)] backdrop-blur-xl ${colors}`}
      initial={{ opacity: 0, x: 100, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.9 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      layout
    >
      <div className="flex-shrink-0">{icon}</div>
      <p className="flex-1 text-sm text-[var(--text)]">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}
