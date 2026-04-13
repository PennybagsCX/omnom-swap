import { Component, ErrorInfo, ReactNode } from 'react';
import { TriangleAlert, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] font-body text-white relative overflow-hidden p-6">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-900/10 blur-[150px] rounded-none pointer-events-none"></div>
          <div className="max-w-xl w-full bg-surface-container-low border-2 border-red-900 p-8 relative z-10 shadow-[0_0_50px_rgba(255,0,0,0.15)] flex flex-col items-center">
            <TriangleAlert className="w-24 h-24 text-red-500 mb-6 animate-pulse" />
            <h1 className="font-headline font-black text-4xl uppercase tracking-tighter text-red-500 mb-2">SYSTEM FAILURE</h1>
            <h2 className="font-headline font-bold text-xl uppercase tracking-widest text-on-surface-variant mb-8 text-center">
              The Beast crashed into a critical exception.
            </h2>
            
            <div className="bg-surface-container-highest border border-outline-variant/30 p-4 w-full mb-8 font-mono text-xs text-red-300/80 overflow-x-auto whitespace-pre-wrap">
              {this.state.error?.message || "Unknown Core Panic"}
            </div>
            
            <button 
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-500 text-white flex items-center gap-2 font-headline font-black uppercase tracking-widest text-lg w-full justify-center py-5 shadow-[0_0_20px_rgba(255,0,0,0.4)] transition-all active:scale-[0.98]"
            >
              <RefreshCw className="w-5 h-5" /> REBOOT CORE
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}
