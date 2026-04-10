import { ReactNode } from 'react';

export default function GlassPanel({ children, className = '' }: { children: ReactNode, className?: string }) {
  return (
    <div className={`glass-panel p-1 shadow-[0_0_40px_rgba(255,215,0,0.08)] border border-primary/20 ${className}`}>
      {children}
    </div>
  );
}
