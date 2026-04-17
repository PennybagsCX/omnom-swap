import { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'warning';
  title: string;
  message: string;
  link?: string;
}

interface ToastContextValue {
  addToast: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast notifications */}
      <div className="fixed top-20 right-4 z-[200] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
        {toasts.map(toast => (
          <div key={toast.id} className={`p-4 border-l-4 shadow-lg flex gap-3 items-start overflow-hidden ${
            toast.type === 'success' ? 'bg-green-900/80 border-green-400' :
            toast.type === 'error' ? 'bg-red-900/80 border-red-400' :
            'bg-yellow-900/80 border-yellow-400'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" /> :
             toast.type === 'error' ? <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" /> :
             <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0 overflow-hidden text-center">
              <div className="font-headline font-bold text-sm text-white uppercase tracking-tight">{toast.title}</div>
              <div className="text-xs text-white/70 mt-0.5 break-all">{toast.message}</div>
              {toast.link && (
                <a href={toast.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary mt-1 hover:text-white truncate max-w-full justify-center">
                  View on Explorer <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              )}
            </div>
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="text-white/50 hover:text-white shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
