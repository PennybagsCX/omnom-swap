import GlassPanel from '../components/ui/GlassPanel';

export default function StatsScreen() {
  return (
    <div className="w-full max-w-7xl mx-auto py-8">
      <h1 className="text-5xl font-headline font-black uppercase tracking-tighter text-primary mb-8 neon-text-glow">Aggregated Combustion</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <GlassPanel className="p-6 bg-surface-container">
          <div className="text-sm text-on-surface-variant uppercase tracking-wider mb-2">Total Value Locked</div>
          <div className="text-4xl font-mono text-white">$45,210,420</div>
        </GlassPanel>
        <GlassPanel className="p-6 bg-surface-container">
          <div className="text-sm text-on-surface-variant uppercase tracking-wider mb-2">24h Volume</div>
          <div className="text-4xl font-mono text-primary">$12,300,500</div>
        </GlassPanel>
        <GlassPanel className="p-6 bg-surface-container border-secondary/30">
          <div className="text-sm text-on-surface-variant uppercase tracking-wider mb-2">Total OMNOM Burned</div>
          <div className="text-4xl font-mono text-secondary">1,000,000,000</div>
        </GlassPanel>
      </div>

      <GlassPanel className="h-[400px] bg-surface-container p-6 flex flex-col">
        <h3 className="text-xl font-headline font-bold mb-4">Volume Over Time (Coming Soon)</h3>
        <div className="flex-grow flex items-center justify-center border border-dashed border-outline-variant/30 rounded-xl relative overflow-hidden">
             <div className="industrial-bg absolute inset-0 opacity-20"></div>
             <p className="font-mono text-on-surface-variant relative z-10">[ Chart Data Placeholder ]</p>
        </div>
      </GlassPanel>
    </div>
  );
}
