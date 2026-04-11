/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  PawPrint, Bitcoin, DollarSign, Zap, Shield, Users,
  Flame, Search, Settings, ChevronDown, ArrowDownUp, TriangleAlert, Coins,
  Info, X, Ghost
} from 'lucide-react';

const TOKENS = [
  { symbol: 'DOGE', name: 'Dogecoin', balance: 14200.69, icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD33Ssm2WE6hLYmOKHoQGa8bgIWiahDkvTIHWLsSoH4nr303LaV7pMAJoqpEy9xlEZHDBwLAuCEyodi7A31ysbQwltZJe2zu4TawtiwvEF13jQ_U5bDEBghLERSdxgO3PuV2ZXoiPtwgkZti4BK0WsZUQ9R-4o6H1HIdz1Nmnymlq1kLWUovyO8go9zoontFfDgSnPPUdprcHOWXncXjSywG7XsDQxJwB6c1gXbyeoXcY7Ibk1h6xH3jzo72x80PNC4xP8HSZ7KhKFp', isImage: true },
  { symbol: 'OMNOM', name: 'Omnom Token', balance: 0.00, icon: PawPrint, isImage: false },
  { symbol: 'WETH', name: 'Wrapped Ether', balance: 2.45, icon: Bitcoin, isImage: false },
  { symbol: 'USDT', name: 'Tether USD', balance: 150.00, icon: DollarSign, isImage: false }
];

const INITIAL_SWAP_HISTORY = [
  { id: 1, sellAmount: 1000, sellSymbol: 'DOGE', buyAmount: 420.69, buySymbol: 'OMNOM', time: '10 mins ago' },
  { id: 2, sellAmount: 50, sellSymbol: 'USDT', buyAmount: 118.2, buySymbol: 'OMNOM', time: '2 hours ago' },
  { id: 3, sellAmount: 0.5, sellSymbol: 'WETH', buyAmount: 15000, buySymbol: 'DOGE', time: '1 day ago' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'SWAP' | 'POOLS' | 'STATS'>('POOLS');

  return (
    <div className="min-h-screen flex flex-col font-body text-on-surface selection:bg-primary selection:text-on-primary">
      <div className="grain-overlay"></div>
      
      {/* Header */}
      <header className="bg-surface/90 backdrop-blur-md fixed top-0 left-0 right-0 z-40 border-b border-outline-variant/15 shadow-[0_4px_30px_rgba(255,215,0,0.05)]">
        <div className="flex justify-between items-center w-full px-6 py-4 max-w-[1920px] mx-auto relative">
          <div className="text-3xl font-black text-primary neon-text-glow [clip-path:polygon(0%_0%,100%_0%,100%_70%,95%_80%,100%_90%,100%_100%,0%_100%)] font-headline tracking-tighter uppercase cursor-pointer">
            $OMNOM
          </div>
          <nav className="hidden md:flex gap-8 font-headline font-bold tracking-tighter uppercase">
            {['SWAP', 'POOLS', 'STATS'].map((tab) => (
              <div key={tab} className="relative group">
                <button
                  onClick={() => setActiveTab(tab as any)}
                  className={`transition-all duration-150 px-2 py-1 ${
                    activeTab === tab 
                      ? 'text-primary border-b-2 border-primary pb-1' 
                      : 'text-white/60 hover:text-white hover:bg-surface-container-high hover:scale-105'
                  }`}
                >
                  {tab}
                </button>
                {tab === 'POOLS' && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-max px-3 py-2 bg-surface-container-highest border border-primary/30 text-[10px] text-white normal-case tracking-normal shadow-[0_0_20px_rgba(255,215,0,0.15)] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                    Learn about liquidity pools in our <a href="#" className="text-primary hover:underline">Documentation</a>.
                  </div>
                )}
              </div>
            ))}
          </nav>
          <button className="bg-primary text-on-primary font-headline font-black px-6 py-2 hover:bg-white hover:text-black transition-all active:scale-95 uppercase tracking-tighter shadow-[0_0_20px_rgba(255,215,0,0.3)]">
            JOIN THE PACK
          </button>
          <div className="bg-gradient-to-r from-primary via-primary-dim to-transparent h-[1px] w-full absolute bottom-0 left-0 opacity-40"></div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow pt-24 pb-12 px-6 max-w-[1920px] mx-auto w-full relative z-10">
        {activeTab === 'POOLS' && <PoolsScreen />}
        {activeTab === 'STATS' && <StatsScreen />}
        {activeTab === 'SWAP' && <SwapScreen />}
      </main>

      {/* Footer */}
      <footer className="bg-surface-container-lowest border-t border-outline-variant/15 relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-center px-8 py-6 w-full max-w-[1920px] mx-auto">
          <div className="font-body text-[10px] uppercase tracking-[0.2em] font-medium text-on-surface-variant">
            $OMNOM: Unleash the Beast. Defend the Doge. <span className="text-primary">Devour the Rest.</span>
          </div>
          <div className="flex gap-8 mt-4 md:mt-0 font-body text-[10px] uppercase tracking-[0.2em] font-medium">
            <a href="#" className="text-on-surface-variant hover:text-primary transition-colors">X (Twitter)</a>
            <a href="#" className="text-on-surface-variant hover:text-primary transition-colors">Telegram</a>
            <a href="#" className="text-on-surface-variant hover:text-primary transition-colors">Docs</a>
          </div>
        </div>
        <div className="h-1 bg-primary w-full opacity-10"></div>
      </footer>
    </div>
  );
}

const LP_HISTORY = [
  { id: 1, action: 'DEPOSIT', amount1: '1000', symbol1: 'OMNOM', amount2: '500', symbol2: 'DOGE', time: '2 hours ago', status: 'CONFIRMED' },
  { id: 2, action: 'WITHDRAW', amount1: '250', symbol1: 'OMNOM', amount2: '125', symbol2: 'WETH', time: '1 day ago', status: 'CONFIRMED' },
];

function PoolsScreen() {
  const [managePool, setManagePool] = useState<{ id: string, t1: string, t2: string } | null>(null);
  const [showCreatePool, setShowCreatePool] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="max-w-7xl mx-auto pt-16">
      {/* Hero Section */}
      <section className="mb-20 relative">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div>
            <h2 className="font-headline font-black text-6xl md:text-9xl tracking-tighter uppercase leading-none mb-6 text-white">
              THE <span className="text-primary neon-glow">FEEDING</span> GROUNDS
            </h2>
            <p className="font-body text-on-surface-variant max-w-xl text-lg border-l-4 border-primary pl-8 py-2">
              Provide liquidity to earn rewards. Feed the beast and watch the APR explode. Industrial grade rewards for the elite pack members.
            </p>
          </div>
          <div className="bg-surface-container-high p-6 flex flex-col items-end border-r-4 border-primary neon-border">
            <span className="font-headline text-xs text-primary tracking-[0.3em] uppercase mb-2">GLOBAL TOTAL VALUE LOCKED</span>
            <span className="font-headline text-4xl font-bold text-white tabular-nums mb-4">$420,690,133.70</span>
            <button 
              onClick={() => setShowCreatePool(true)}
              className="bg-primary text-on-primary px-6 py-2 font-headline font-bold uppercase tracking-widest text-sm hover:bg-white hover:text-black transition-colors active:scale-95"
            >
              + Create Pool
            </button>
          </div>
        </div>
      </section>

      {/* Liquidity Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Pool Item 1: OMNOM/WETH */}
        <div className="md:col-span-8 bg-surface-container-low p-8 group relative overflow-hidden transition-all duration-300 hover:bg-surface-container-high hover:-translate-y-1 hover:border-primary/30 border border-outline-variant/15">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] font-headline text-[12rem] font-black select-none pointer-events-none text-primary leading-none">01</div>
          <div className="flex items-start justify-between mb-16 relative z-10">
            <div className="flex items-center gap-6">
              <div className="flex -space-x-4">
                <div className="w-20 h-20 shrink-0 bg-primary flex items-center justify-center border-4 border-surface shadow-[6px_6px_0px_#111111]">
                  <PawPrint className="text-on-primary w-10 h-10" fill="currentColor" />
                </div>
                <div className="w-20 h-20 shrink-0 bg-surface-container-highest flex items-center justify-center border-4 border-surface shadow-[6px_6px_0px_#111111]">
                  <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuD33Ssm2WE6hLYmOKHoQGa8bgIWiahDkvTIHWLsSoH4nr303LaV7pMAJoqpEy9xlEZHDBwLAuCEyodi7A31ysbQwltZJe2zu4TawtiwvEF13jQ_U5bDEBghLERSdxgO3PuV2ZXoiPtwgkZti4BK0WsZUQ9R-4o6H1HIdz1Nmnymlq1kLWUovyO8go9zoontFfDgSnPPUdprcHOWXncXjSywG7XsDQxJwB6c1gXbyeoXcY7Ibk1h6xH3jzo72x80PNC4xP8HSZ7KhKFp" alt="DOGE" className="w-10 h-10 grayscale-[0.5]" />
                </div>
              </div>
              <div>
                <h3 className="font-headline text-4xl font-black text-white uppercase tracking-tighter">OMNOM / DOGE</h3>
                <span className="text-xs font-headline tracking-[0.3em] text-on-surface-variant uppercase">PRECISION POOL V3</span>
              </div>
            </div>
            <div className="text-right">
              <span className="block text-[11px] font-headline text-on-surface-variant tracking-widest uppercase mb-1">CURRENT APR</span>
              <span className="font-headline text-6xl font-black text-secondary beast-mode-glow">694.20%</span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10 relative z-10">
            <div>
              <span className="block text-[10px] text-on-surface-variant font-headline uppercase tracking-widest mb-2">Liquidity</span>
              <span className="font-headline text-2xl text-white">$12.4M</span>
            </div>
            <div>
              <span className="block text-[10px] text-on-surface-variant font-headline uppercase tracking-widest mb-2">Volume 24H</span>
              <span className="font-headline text-2xl text-white">$2.8M</span>
            </div>
            <div>
              <span className="block text-[10px] text-on-surface-variant font-headline uppercase tracking-widest mb-2">My Stake</span>
              <span className="font-headline text-2xl text-primary">$0.00</span>
            </div>
            <div>
              <span className="block text-[10px] text-on-surface-variant font-headline uppercase tracking-widest mb-2">Pool Weight</span>
              <span className="font-headline text-2xl text-white">40X</span>
            </div>
          </div>
          <div className="flex gap-4 relative z-10">
            <button 
              onClick={() => setManagePool({ id: 'OMNOM/DOGE', t1: 'OMNOM', t2: 'DOGE' })}
              className="flex-1 bg-primary text-on-primary h-16 font-headline font-black tracking-widest uppercase transition-all duration-150 hover:bg-white hover:text-black active:scale-95 flex items-center justify-center gap-3"
            >
              <UtensilsIcon className="w-6 h-6" />
              FEED THE POOL
            </button>
            <button className="px-10 border border-outline-variant hover:border-primary transition-all font-headline font-bold text-sm tracking-widest uppercase text-white hover:text-primary">
              DETAILS
            </button>
          </div>
        </div>

        {/* Pool Item 2: OMNOM/USDT */}
        <div className="md:col-span-4 bg-surface-container-low p-8 relative overflow-hidden transition-all duration-300 hover:bg-surface-container-high hover:-translate-y-1 hover:border-primary/30 border border-outline-variant/15">
          <div className="flex flex-col h-full justify-between">
            <div>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-14 h-14 shrink-0 bg-primary flex items-center justify-center border-2 border-surface">
                  <PawPrint className="text-on-primary w-6 h-6" fill="currentColor" />
                </div>
                <div className="w-14 h-14 shrink-0 flex items-center justify-center border-2 border-surface bg-surface-container-highest">
                  <DollarSign className="text-white w-6 h-6" />
                </div>
              </div>
              <h3 className="font-headline text-3xl font-black text-white uppercase tracking-tighter mb-2">OMNOM / USDT</h3>
              <div className="text-secondary beast-mode-glow font-headline text-4xl font-black mb-8">412.05% <span className="text-xs uppercase tracking-normal font-medium">APR</span></div>
              <div className="space-y-4 mb-10">
                <div className="flex justify-between text-xs font-headline border-b border-outline-variant/30 pb-3">
                  <span className="text-on-surface-variant uppercase">TVL</span>
                  <span className="text-white font-bold">$8.1M</span>
                </div>
                <div className="flex justify-between text-xs font-headline border-b border-outline-variant/30 pb-3">
                  <span className="text-on-surface-variant uppercase">FEES 24H</span>
                  <span className="text-white font-bold">$14.2K</span>
                </div>
              </div>
            </div>
            <button 
              onClick={() => setManagePool({ id: 'OMNOM/USDT', t1: 'OMNOM', t2: 'USDT' })}
              className="w-full bg-primary text-on-primary py-5 font-headline font-black tracking-widest uppercase transition-all duration-150 hover:bg-white hover:text-black active:scale-95"
            >
              FEED THE POOL
            </button>
          </div>
        </div>

        {/* Pool Item 3: OMNOM/DOGE */}
        <div className="md:col-span-4 bg-surface-container-low p-8 relative overflow-hidden transition-all duration-300 hover:bg-surface-container-high hover:-translate-y-1 hover:border-primary/30 border border-outline-variant/15">
          <div className="flex flex-col h-full justify-between">
            <div>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-14 h-14 shrink-0 bg-primary flex items-center justify-center border-2 border-surface">
                  <PawPrint className="text-on-primary w-6 h-6" fill="currentColor" />
                </div>
                <div className="w-14 h-14 shrink-0 bg-surface-container-highest flex items-center justify-center border-2 border-surface">
                  <span className="text-white text-2xl font-black font-headline">Ð</span>
                </div>
              </div>
              <h3 className="font-headline text-3xl font-black text-white uppercase tracking-tighter mb-2">OMNOM / DOGE</h3>
              <div className="text-secondary beast-mode-glow font-headline text-4xl font-black mb-8">285.90% <span className="text-xs uppercase tracking-normal font-medium">APR</span></div>
              <div className="space-y-4 mb-10">
                <div className="flex justify-between text-xs font-headline border-b border-outline-variant/30 pb-3">
                  <span className="text-on-surface-variant uppercase">TVL</span>
                  <span className="text-white font-bold">$5.4M</span>
                </div>
                <div className="flex justify-between text-xs font-headline border-b border-outline-variant/30 pb-3">
                  <span className="text-on-surface-variant uppercase">FEES 24H</span>
                  <span className="text-white font-bold">$9.1K</span>
                </div>
              </div>
            </div>
            <button 
              onClick={() => setManagePool({ id: 'OMNOM/DOGE', t1: 'OMNOM', t2: 'DOGE' })}
              className="w-full bg-primary text-on-primary py-5 font-headline font-black tracking-widest uppercase transition-all duration-150 hover:bg-white hover:text-black active:scale-95"
            >
              FEED THE POOL
            </button>
          </div>
        </div>

        {/* Promotional Area / Beast Mode Alert */}
        <div className="md:col-span-8 bg-surface-container relative p-8 border-l-4 flex items-center overflow-hidden border-secondary">
          <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l to-transparent pointer-events-none from-secondary/10"></div>
          <div className="relative z-10 grid md:grid-cols-2 gap-10 items-center w-full">
            <div>
              <div className="inline-flex items-center gap-2 bg-secondary/10 px-3 py-1 mb-4">
                <span className="w-2 h-2 rounded-none bg-secondary animate-pulse"></span>
                <h4 className="font-headline text-secondary text-xs tracking-[0.4em] uppercase font-bold">ACTIVE EVENT</h4>
              </div>
              <h3 className="font-headline text-5xl font-black text-white uppercase tracking-tighter mb-6">BEAST MODE ENGAGED</h3>
              <p className="text-on-surface-variant font-body mb-8 leading-relaxed">Stake into the OMNOM/WETH pool for the next 24 hours to receive triple weight on reward distribution. No cooldown. Maximum efficiency.</p>
              <div className="flex items-center gap-8">
                <div className="flex flex-col">
                  <span className="font-headline text-white text-3xl font-bold tabular-nums whitespace-nowrap">14 : 22 : 09</span>
                  <span className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-1">Time Remaining</span>
                </div>
                <div className="h-12 w-[1px] bg-outline-variant/50"></div>
                <div className="flex flex-col">
                  <span className="font-headline text-secondary text-3xl font-bold">3X BOOST</span>
                  <span className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-1">Multiplier</span>
                </div>
              </div>
            </div>
            <div className="hidden md:block">
              <div className="aspect-square w-full bg-surface-container-high border border-outline-variant/15 relative overflow-hidden group">
                <img 
                  className="w-full h-full object-cover mix-blend-overlay opacity-30 group-hover:scale-110 transition-transform duration-1000" 
                  alt="Abstract cybernetic dog wolf silhouette" 
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAx31yEHg-juntLfULySufs-6jnshAoSUmeBQBnSthAj2IlvSaKcxTe5IKKVz7MY0XilwOFFfp1ISDBxItTHA1jnb-cuEZejFXH4xGLIE4u6OjjGnH-bzkOsInHEGvuUfAXZcZGkWOqNm24YoFh38hl_GqkUqVxwSWBw3sRbwhOiabf8CV-6fV83myiPWSdvmevNq1CgIr_FA87BcnyXSNTh8bVB1xV34VC98M9HblLuOlE-LVkMkRVIneflttgYS0QO2s8OBxn00PE" 
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <TriangleAlert className="text-primary w-32 h-32 neon-glow opacity-20" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* LP History */}
      <div className="mt-16 w-full relative z-10 max-w-3xl mx-auto">
        <button 
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between p-4 glass-panel shadow-[0_0_20px_rgba(0,0,0,0.2)] border border-outline-variant/15 hover:border-primary/30 transition-colors"
        >
          <span className="font-headline font-bold uppercase text-sm text-white">Liquidity History</span>
          <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform ${showHistory ? 'rotate-180' : ''}`} />
        </button>
        
        {showHistory && (
          <div className="mt-2 glass-panel border border-outline-variant/15 p-4 space-y-3">
            {LP_HISTORY.map(tx => (
              <div key={tx.id} className="flex justify-between items-center text-sm border-b border-outline-variant/10 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-4">
                  <div className={`text-[10px] font-bold px-2 py-1 uppercase tracking-widest ${tx.action === 'DEPOSIT' ? 'bg-primary/20 text-primary' : 'bg-secondary/20 text-secondary'}`}>
                    {tx.action}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{tx.amount1} {tx.symbol1}</span>
                    <span className="text-on-surface-variant">+</span>
                    <span className="font-bold text-white">{tx.amount2} {tx.symbol2}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-primary font-bold">{tx.status}</div>
                  <div className="text-[10px] text-on-surface-variant uppercase">{tx.time}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tooltip Section / FAQ Links */}
      <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-16 text-center md:text-left border-t border-outline-variant/15 pt-16">
        <div>
          <Zap className="text-primary w-10 h-10 mb-6 mx-auto md:mx-0" />
          <h5 className="font-headline text-white text-lg font-bold uppercase tracking-[0.2em] mb-3">Instant Rewards</h5>
          <p className="text-on-surface-variant text-sm font-body leading-relaxed max-w-xs mx-auto md:mx-0">Rewards accrue in real-time. Harvest whenever the beast is hungry. No lock-up periods for standard pools.</p>
        </div>
        <div>
          <Shield className="text-primary w-10 h-10 mb-6 mx-auto md:mx-0" />
          <h5 className="font-headline text-white text-lg font-bold uppercase tracking-[0.2em] mb-3">Audited Contracts</h5>
          <p className="text-on-surface-variant text-sm font-body leading-relaxed max-w-xs mx-auto md:mx-0">Military grade security protocols. Fully audited by top tier security firms. Your assets are fortified.</p>
        </div>
        <div>
          <Users className="text-primary w-10 h-10 mb-6 mx-auto md:mx-0" />
          <h5 className="font-headline text-white text-lg font-bold uppercase tracking-[0.2em] mb-3">Pack Governance</h5>
          <p className="text-on-surface-variant text-sm font-body leading-relaxed max-w-xs mx-auto md:mx-0">Pool weights are determined by the pack. Vote on $OMNOM governance to steer the future of the ecosystem.</p>
        </div>
      </div>

      {managePool && <LiquidityModal pool={managePool} onClose={() => setManagePool(null)} />}
      {showCreatePool && <CreatePoolModal onClose={() => setShowCreatePool(false)} />}
    </div>
  );
}

function StatsScreen() {
  return (
    <div className="industrial-bg min-h-full">
      {/* Dashboard Header */}
      <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6 pt-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-6 bg-primary shadow-[0_0_10px_rgba(255,215,0,0.8)]"></span>
            <span className="font-headline text-sm uppercase tracking-widest text-primary">Network Status: Aggressive</span>
          </div>
          <h1 className="text-6xl md:text-8xl font-black font-headline uppercase leading-none tracking-tighter">
            FEEDING<br/><span className="text-primary drop-shadow-[0_0_15px_rgba(255,215,0,0.4)]">FRENZY</span>
          </h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="font-headline text-xs text-on-surface-variant uppercase">Last Update: Block #19,420,069</div>
          <div className="flex gap-4">
            <div className="p-4 bg-surface-container-low border-l-4 border-secondary text-right w-40 h-40 flex flex-col justify-center">
              <div className="text-[10px] uppercase text-on-surface-variant tracking-tighter">Current Multiplier</div>
              <div className="text-2xl font-black font-headline text-secondary tracking-tighter drop-shadow-[0_0_8px_rgba(157,0,255,0.4)]">8.42X</div>
            </div>
            <div className="p-4 bg-surface-container-low border-l-4 border-primary text-right w-40 h-40 flex flex-col justify-center">
              <div className="text-[10px] uppercase text-on-surface-variant tracking-tighter">Pack Power</div>
              <div className="text-2xl font-black font-headline text-primary tracking-tighter">98.2%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bento Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-1 mb-1 bg-outline-variant/15">
        {/* Global Burn Stats */}
        <div className="md:col-span-8 bg-surface-container-low p-8 relative overflow-hidden border border-outline-variant/15">
          <div className="absolute top-0 right-0 p-4 font-headline text-[10px] text-primary opacity-30">REF: FF-TR-01</div>
          <h2 className="font-headline font-bold text-xl uppercase tracking-tighter mb-8 flex items-center gap-2">
            <Flame className="text-primary w-6 h-6" />
            Aggregated Combustion
          </h2>
          <div className="flex flex-col md:flex-row gap-12 items-end">
            <div className="flex-1">
              <div className="text-7xl font-black font-headline tracking-tighter text-on-surface mb-2">1,240,492,001</div>
              <div className="text-sm uppercase tracking-widest text-on-surface-variant">$OMNOM Burned since inception</div>
            </div>
            <div className="w-full md:w-64 h-32 flex items-end gap-1">
              <div className="flex-1 bg-primary/20 h-[30%]"></div>
              <div className="flex-1 bg-primary/40 h-[45%]"></div>
              <div className="flex-1 bg-primary/30 h-[40%]"></div>
              <div className="flex-1 bg-primary/60 h-[65%] shadow-[0_0_15px_rgba(255,215,0,0.2)]"></div>
              <div className="flex-1 bg-primary/80 h-[85%] shadow-[0_0_20px_rgba(255,215,0,0.3)]"></div>
              <div className="flex-1 bg-primary h-[100%] shadow-[0_0_25px_rgba(255,215,0,0.5)]"></div>
            </div>
          </div>
        </div>

        {/* Kinetic Actions */}
        <div className="md:col-span-4 bg-surface-container-high p-8 flex flex-col justify-between border border-outline-variant/15">
          <div>
            <h3 className="font-headline font-bold text-sm uppercase tracking-[0.2em] mb-4 text-on-surface-variant">Manual Triggers</h3>
            <div className="space-y-4">
              <button className="w-full group flex items-center justify-between p-4 bg-primary text-on-primary hover:bg-white hover:text-black transition-all shadow-[0_0_30px_rgba(255,215,0,0.2)]">
                <span className="font-headline font-black text-xl uppercase tracking-tighter">Mega Bite</span>
                <Zap className="group-hover:scale-125 transition-transform w-6 h-6" fill="currentColor" />
              </button>
              <button className="w-full group flex items-center justify-between p-4 bg-surface-container-highest text-on-surface border border-outline-variant/30 hover:border-primary transition-all">
                <span className="font-headline font-black text-xl uppercase tracking-tighter">Scavenge</span>
                <Search className="group-hover:text-primary transition-colors w-6 h-6" />
              </button>
            </div>
          </div>
          <div className="mt-8 pt-4 border-t border-outline-variant/15">
            <div className="flex justify-between text-[10px] uppercase font-bold tracking-widest text-on-surface-variant mb-1">
              <span>Frenzy Threshold</span>
              <span className="text-secondary">82%</span>
            </div>
            <div className="h-1 bg-surface-container-lowest w-full overflow-hidden">
              <div className="h-full bg-secondary w-[82%] shadow-[0_0_10px_rgba(157,0,255,1)]"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Secondary Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-1 bg-outline-variant/15">
        <div className="bg-surface-container-low p-6 border border-outline-variant/15">
          <div className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-4 font-bold">24H Volume</div>
          <div className="text-3xl font-black font-headline tracking-tighter text-primary">$4.2M</div>
          <div className="text-primary/70 text-xs mt-1">+12.4% vs prev</div>
        </div>
        <div className="bg-surface-container-low p-6 border border-outline-variant/15">
          <div className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-4 font-bold">Total Predators</div>
          <div className="text-3xl font-black font-headline tracking-tighter">12,842</div>
          <div className="text-on-surface-variant text-xs mt-1">Unique Wallets</div>
        </div>
        <div className="bg-surface-container-low p-6 border border-outline-variant/15">
          <div className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-4 font-bold">Treasury Vault</div>
          <div className="text-3xl font-black font-headline tracking-tighter">482.1k <span className="text-sm font-light text-primary">DOGE</span></div>
          <div className="text-on-surface-variant text-xs mt-1">Secured in Cold Storage</div>
        </div>
        <div className="bg-surface-container-low p-6 border border-outline-variant/15">
          <div className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-4 font-bold">Buyback Velocity</div>
          <div className="text-3xl font-black font-headline tracking-tighter text-secondary">0.82 <span className="text-sm font-light text-on-surface">b/m</span></div>
          <div className="text-secondary/70 text-xs mt-1 font-bold">High Intensity</div>
        </div>
      </div>

      {/* Feed Log */}
      <div className="mt-12 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-headline font-black text-2xl uppercase tracking-tighter flex items-center gap-2">
              <span className="w-1 h-6 bg-primary"></span>
              Recent Feeding Log
            </h3>
            <span className="bg-secondary/10 border border-secondary/20 text-secondary px-3 py-1 text-[10px] font-bold uppercase tracking-widest animate-pulse">Live Updates</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-4 bg-surface-container p-4 hover:bg-surface-container-high transition-colors group">
              <UtensilsIcon className="text-primary group-hover:scale-110 transition-transform w-6 h-6" />
              <div className="flex-1">
                <div className="text-sm font-bold uppercase tracking-tight">Whale Mega Bite detected</div>
                <div className="text-[10px] text-on-surface-variant uppercase">0x482...e92f • 2 minutes ago</div>
              </div>
              <div className="text-right">
                <div className="font-headline font-black text-primary tracking-tighter">+42,000 OMNOM</div>
                <div className="text-[10px] uppercase text-on-surface-variant">Frenzy Multiplier Applied</div>
              </div>
            </div>
            <div className="flex items-center gap-4 bg-surface-container p-4 hover:bg-surface-container-high transition-colors group">
              <Search className="text-secondary w-6 h-6" />
              <div className="flex-1">
                <div className="text-sm font-bold uppercase tracking-tight">Vault Scavenge Protocol initiated</div>
                <div className="text-[10px] text-on-surface-variant uppercase">SYSTEM • 14 minutes ago</div>
              </div>
              <div className="text-right">
                <div className="font-headline font-black text-on-surface tracking-tighter">-1,200 OMNOM</div>
                <div className="text-[10px] uppercase text-on-surface-variant">Burned & Removed</div>
              </div>
            </div>
            <div className="flex items-center gap-4 bg-surface-container p-4 hover:bg-surface-container-high transition-colors group">
              <Zap className="text-primary w-6 h-6" fill="currentColor" />
              <div className="flex-1">
                <div className="text-sm font-bold uppercase tracking-tight">Retail Nibble Sequence</div>
                <div className="text-[10px] text-on-surface-variant uppercase">0x11a...33cc • 42 minutes ago</div>
              </div>
              <div className="text-right">
                <div className="font-headline font-black text-primary tracking-tighter">+8,122 OMNOM</div>
                <div className="text-[10px] uppercase text-on-surface-variant">Pool Participation</div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="lg:col-span-4 flex flex-col gap-1">
          <div className="bg-primary p-6 text-on-primary shadow-[0_0_40px_rgba(255,215,0,0.15)] border border-primary/20">
            <h4 className="font-black font-headline text-3xl uppercase tracking-tighter leading-none mb-4">Beast Mode <br/>Imminent</h4>
            <p className="text-xs uppercase tracking-wider mb-6 font-bold leading-relaxed">The current burn velocity indicates a massive supply squeeze within 24 hours.</p>
            <div className="aspect-square bg-black/40 flex items-center justify-center border border-on-primary/10 overflow-hidden relative group">
              <img 
                alt="Cyberpunk dog silhouette" 
                className="opacity-80 grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700 ease-out" 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDBaoL2wTIuXPvu4rCWFE98SNqck7HdyXQ1NJnc3TMjDLIVXZ5kOWt5rwig1K9KC2qphWJoJWDew4ZDXzb-HWViDHsmWtqSchxe_wGGPhsHtRwEiEAiMuiRnRwzjb0pluuFgEXxVGOni2AdoHAKruV7u9pKbOungBp_oRabcOXs-72O0jHOxxRnp5Z2biovj29_-0PxXj25ZFqlRFrGoVwINsV2oHioIwjvk-lgsjQswYVNttb-yCoXtphiCxXmKMMYx1L-6vE37tpF"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-primary/60 to-transparent"></div>
              <div className="absolute bottom-4 left-4 right-4">
                <div className="text-xs font-black uppercase tracking-widest border-b border-on-primary/40 pb-1 mb-1">Alert Matrix</div>
                <div className="text-[10px] uppercase font-bold">Scanning for victims...</div>
              </div>
            </div>
          </div>
          <div className="bg-surface-container-highest p-6 border border-outline-variant/15">
            <h4 className="font-headline font-bold text-xs uppercase tracking-widest mb-4">Industrial Ledger</h4>
            <div className="space-y-3 font-mono text-[10px] text-on-surface-variant">
              <div className="flex justify-between"><span>CONTRACT_ID</span><span className="text-on-surface">V2_FEED_001</span></div>
              <div className="flex justify-between"><span>GAS_OPTIMIZER</span><span className="text-secondary font-bold">ENABLED</span></div>
              <div className="flex justify-between"><span>REFLECTIONS</span><span className="text-on-surface">12.2%</span></div>
              <div className="flex justify-between"><span>LIQUIDITY_LOCK</span><span className="text-on-surface">PERMANENT</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SwapScreen() {
  const [sellAmount, setSellAmount] = useState<string>('1000');
  const [sellToken, setSellToken] = useState(TOKENS[0]);
  const [buyToken, setBuyToken] = useState(TOKENS[1]);
  const [exchangeRate, setExchangeRate] = useState(0.42069);
  const [tokenModalSide, setTokenModalSide] = useState<'sell' | 'buy' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTooltip, setShowTooltip] = useState(false);
  const [slippage, setSlippage] = useState<string>('0.5');
  const [showHistory, setShowHistory] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [buttonHovered, setButtonHovered] = useState(false);
  const [swapHistory, setSwapHistory] = useState(INITIAL_SWAP_HISTORY);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);

  const filteredTokens = TOKENS.filter(t => 
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Real-time price updates simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setExchangeRate(prev => {
        const jitter = (Math.random() - 0.5) * 0.001;
        return Math.max(0.00001, prev + jitter);
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const parsedSell = parseFloat(sellAmount) || 0;
  const parsedSlippage = parseFloat(slippage) || 0;
  const buyAmount = (parsedSell * exchangeRate).toFixed(5);
  const minReceived = (parsedSell * exchangeRate * (1 - parsedSlippage / 100)).toFixed(5);

  let buttonText = "CHOMP THE SWAP";
  let isDisabled = false;

  if (!sellAmount || parsedSell <= 0) {
    buttonText = "ENTER AMOUNT";
    isDisabled = true;
  } else if (parsedSell > sellToken.balance) {
    buttonText = "INSUFFICIENT BALANCE";
    isDisabled = true;
  }

  const handleSwapTokens = () => {
    const temp = sellToken;
    setSellToken(buyToken);
    setBuyToken(temp);
    setSellAmount(parsedSell > 0 ? buyAmount : '');
    setExchangeRate(1 / exchangeRate);
  };

  const handleTokenSelect = (token: typeof TOKENS[0]) => {
    if (tokenModalSide === 'sell') {
      if (token.symbol === buyToken.symbol) {
        handleSwapTokens();
      } else {
        setSellToken(token);
      }
    } else if (tokenModalSide === 'buy') {
      if (token.symbol === sellToken.symbol) {
        handleSwapTokens();
      } else {
        setBuyToken(token);
      }
    }
    setTokenModalSide(null);
  };

  const handleSellAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setSellAmount(val);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] relative">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 blur-[120px] rounded-none pointer-events-none"></div>
      
      <div className="w-full max-w-[480px] relative z-10">
        {/* Frenzy Badge */}
        <div className="flex justify-center mb-6">
          <div className="border border-secondary/50 px-4 py-1 flex items-center gap-2 bg-secondary/10">
            <Zap className="text-secondary w-4 h-4" fill="currentColor" />
            <span className="font-headline font-bold text-secondary text-xs uppercase tracking-widest">Savage Mode</span>
          </div>
        </div>

        {/* Swap Card */}
        <div className="glass-panel p-1 shadow-[0_0_40px_rgba(255,215,0,0.08)] border border-primary/20">
          <div className="bg-surface p-6 flex flex-col gap-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-headline font-bold text-xl uppercase tracking-tight text-white">Swap Assets</h2>
              <div className="relative group">
                <button className="text-on-surface-variant hover:text-primary transition-colors">
                  <Settings className="w-5 h-5" />
                </button>
                <div className="absolute bottom-full right-0 mb-2 w-max px-3 py-2 bg-surface-container-highest border border-outline-variant/30 text-[10px] text-white normal-case tracking-normal shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  Transaction Settings
                </div>
              </div>
            </div>

            {/* Input Section */}
            <div className="bg-surface-container-low p-5 border-l-4 border-primary">
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                <span>You Sell</span>
                <div className="flex items-center gap-2">
                  <span>Balance: {sellToken.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</span>
                  <button 
                    onClick={() => setSellAmount(sellToken.balance.toString())}
                    className="text-primary hover:text-white transition-colors px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-[10px] active:scale-95"
                  >
                    MAX
                  </button>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <input 
                  type="text" 
                  value={sellAmount}
                  onChange={handleSellAmountChange}
                  className="bg-transparent border-none p-0 text-3xl font-headline font-bold text-white focus:ring-0 w-2/3 outline-none" 
                  placeholder="0.00" 
                />
                <button 
                  onClick={() => setTokenModalSide('sell')}
                  className="bg-surface-container-high px-3 py-2 flex items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors"
                >
                  <div className="w-6 h-6 bg-surface-container-highest flex items-center justify-center">
                    {sellToken.isImage ? (
                      <img className="w-5 h-5 grayscale-[0.5]" alt={sellToken.symbol} src={sellToken.icon as string} />
                    ) : (
                      <sellToken.icon className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <span className="font-headline font-bold">{sellToken.symbol}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Swap Divider */}
            <div className="flex justify-center -my-6 relative z-20">
              <button 
                onClick={handleSwapTokens}
                className="bg-primary text-on-primary p-2 hover:rotate-180 transition-transform duration-500 shadow-[0_0_15px_rgba(255,215,0,0.5)]"
              >
                <ArrowDownUp className="w-6 h-6" />
              </button>
            </div>

            {/* Output Section */}
            <div className="bg-surface-container-low p-5 border-l-4 border-outline-variant/30">
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                <span>You Buy</span>
                <span>Balance: {buyToken.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</span>
              </div>
              <div className="flex justify-between items-center">
                <input 
                  type="text" 
                  value={parsedSell > 0 ? buyAmount : ''}
                  readOnly
                  className="bg-transparent border-none p-0 text-3xl font-headline font-bold text-white focus:ring-0 w-2/3 outline-none opacity-80" 
                  placeholder="0.00" 
                />
                <button 
                  onClick={() => setTokenModalSide('buy')}
                  className="bg-surface-container-high px-3 py-2 flex items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors"
                >
                  <div className="w-6 h-6 bg-primary flex items-center justify-center">
                    {buyToken.isImage ? (
                      <img className="w-5 h-5" alt={buyToken.symbol} src={buyToken.icon as string} />
                    ) : (
                      <buyToken.icon className="w-4 h-4 text-on-primary" />
                    )}
                  </div>
                  <span className="font-headline font-bold">{buyToken.symbol}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="space-y-2 mt-2">
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Exchange Rate</span>
                <span className="text-white">1 {sellToken.symbol} = {exchangeRate.toFixed(5)} {buyToken.symbol}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-headline text-on-surface-variant uppercase relative">
                <span className="flex items-center gap-1">
                  Slippage Tolerance
                  <div 
                    className="relative flex items-center"
                    onMouseEnter={() => setShowTooltip(true)}
                    onMouseLeave={() => setShowTooltip(false)}
                  >
                    <Info className="w-3 h-3 cursor-help hover:text-primary transition-colors" />
                    {showTooltip && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-4 bg-surface-container-highest border border-primary/30 text-[10px] text-white normal-case tracking-normal shadow-[0_0_20px_rgba(255,215,0,0.15)] z-20">
                        <div className="flex items-center gap-3 mb-3 pb-2 border-b border-outline-variant/30">
                          <div className="flex gap-1 items-end h-4">
                            <div className="w-1.5 bg-primary h-full animate-pulse"></div>
                            <div className="w-1.5 bg-secondary h-2/3 animate-pulse delay-75"></div>
                            <div className="w-1.5 bg-primary h-1/3 animate-pulse delay-150"></div>
                          </div>
                          <span className="font-bold uppercase tracking-widest text-primary">Market Volatility</span>
                        </div>
                        Slippage is the difference between the expected price of a trade and the price at which the trade is executed due to market movement.
                      </div>
                    )}
                  </div>
                </span>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => {
                      const base = 0.1;
                      const sizeFactor = parsedSell > 1000 ? 0.4 : 0.1;
                      const volatility = Math.random() * 0.3;
                      setSlippage((base + sizeFactor + volatility).toFixed(2));
                    }}
                    className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 hover:bg-primary hover:text-on-primary transition-colors mr-1"
                  >
                    Auto
                  </button>
                  <input
                    type="number"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    className="bg-surface-container-highest border border-outline-variant/30 text-secondary text-right w-16 px-1 py-0.5 focus:border-secondary outline-none"
                  />
                  <span className="text-secondary">%</span>
                </div>
              </div>
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Min. Received</span>
                <span className="text-white">{minReceived} {buyToken.symbol}</span>
              </div>
              <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                <span>Network Fee</span>
                <span className="text-white">~$4.20</span>
              </div>
            </div>

            {/* Action Button */}
            <div 
              className="relative w-full mt-4"
              onMouseEnter={() => setButtonHovered(true)}
              onMouseLeave={() => setButtonHovered(false)}
            >
              <button 
                disabled={isDisabled}
                onClick={() => setShowConfirmModal(true)}
                className={`w-full font-headline font-black text-xl py-5 uppercase tracking-tighter transition-all relative overflow-hidden ${
                  isDisabled 
                    ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed border border-outline-variant/30' 
                    : 'bg-primary text-on-primary shadow-[0_0_30px_rgba(255,215,0,0.3)] hover:bg-white hover:text-black hover:shadow-[0_0_50px_rgba(255,215,0,0.5)] active:scale-[0.98]'
                }`}
              >
                {slippage === '0.5' && !isDisabled && (
                  <div className="absolute top-0 right-0 bg-white text-black text-[8px] px-2 py-1 font-bold tracking-widest animate-pulse">
                    AUTO SLIPPAGE
                  </div>
                )}
                {buttonText}
              </button>
              {isDisabled && buttonHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-3 py-2 bg-surface-container-highest border border-outline-variant/50 text-xs text-white shadow-lg z-20">
                  {parsedSell <= 0 ? "Please enter an amount greater than 0 to proceed." : "You do not have enough balance for this transaction."}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Swap History */}
        <div className="mt-4 w-full relative z-10">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between p-4 glass-panel shadow-[0_0_20px_rgba(0,0,0,0.2)] border border-outline-variant/15 hover:border-primary/30 transition-colors"
          >
            <span className="font-headline font-bold uppercase text-sm text-white">Recent Swaps</span>
            <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
          
          {showHistory && (
            <div className="mt-2 glass-panel border border-outline-variant/15 p-4 space-y-3">
              <div className="relative mb-3">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-on-surface-variant" />
                <input 
                  type="text" 
                  placeholder="Search history..." 
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant/30 text-white pl-7 pr-3 py-2 focus:border-primary outline-none font-body text-xs"
                />
              </div>
              {swapHistory.filter(tx => 
                tx.sellSymbol.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                tx.buySymbol.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                tx.sellAmount.toString().includes(historySearchQuery) ||
                tx.buyAmount.toString().includes(historySearchQuery)
              ).length > 0 ? (
                <>
                  {swapHistory.filter(tx => 
                    tx.sellSymbol.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                    tx.buySymbol.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                    tx.sellAmount.toString().includes(historySearchQuery) ||
                    tx.buyAmount.toString().includes(historySearchQuery)
                  ).map(tx => (
                    <div key={tx.id} className="flex justify-between items-center text-sm border-b border-outline-variant/10 pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{tx.sellAmount} {tx.sellSymbol}</span>
                        <ArrowDownUp className="w-3 h-3 text-on-surface-variant rotate-90" />
                        <span className="font-bold text-primary">{tx.buyAmount} {tx.buySymbol}</span>
                      </div>
                      <div className="text-xs text-on-surface-variant">{tx.time}</div>
                    </div>
                  ))}
                  <button 
                    onClick={() => setSwapHistory([])}
                    className="w-full mt-2 py-2 text-xs font-headline uppercase tracking-widest text-on-surface-variant hover:text-secondary border border-outline-variant/15 hover:border-secondary/30 transition-colors"
                  >
                    Clear History
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant">
                  <Ghost className="w-12 h-12 mb-3 opacity-20 animate-bounce" />
                  <div className="text-sm font-headline uppercase tracking-widest text-white mb-1">No Swaps Found</div>
                  <div className="text-[10px] uppercase tracking-wider opacity-60">The void remains empty</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Price Chart Preview (Asymmetric Accent) */}
        <div className="mt-8 flex gap-4 overflow-x-auto pb-4 no-scrollbar">
          <div className="bg-surface-container-low min-w-[140px] p-4 border-b-2 border-primary shadow-[0_4px_10px_rgba(255,215,0,0.1)]">
            <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">DOGE Price</p>
            <p className="font-headline font-bold text-white">$0.1842</p>
            <p className="text-[10px] font-headline text-primary">+4.2%</p>
          </div>
          <div className="bg-surface-container-low min-w-[140px] p-4 border-b-2 border-secondary">
            <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">OMNOM Market Cap</p>
            <p className="font-headline font-bold text-white">$8.2M</p>
            <p className="text-[10px] font-headline text-secondary">BEAST MODE</p>
          </div>
          <div className="bg-surface-container-low min-w-[140px] p-4 border-b-2 border-outline-variant/50">
            <p className="text-[10px] font-headline uppercase text-on-surface-variant mb-1">24h Vol</p>
            <p className="font-headline font-bold text-white">$1.4M</p>
            <p className="text-[10px] font-headline text-on-surface-variant">NORMAL</p>
          </div>
        </div>
      </div>

      {/* Token Selection Modal */}
      {tokenModalSide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-container-low border border-primary/30 w-full max-w-md shadow-[0_0_50px_rgba(255,215,0,0.15)] flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center p-4 border-b border-outline-variant/15 shrink-0">
              <h3 className="font-headline font-bold text-xl uppercase tracking-tight text-white">Select Token</h3>
              <button onClick={() => { setTokenModalSide(null); setSearchQuery(''); }} className="text-on-surface-variant hover:text-primary transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-4 border-b border-outline-variant/15 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                <input 
                  type="text" 
                  placeholder="Search by name or symbol" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant/30 text-white pl-10 pr-4 py-3 focus:border-primary outline-none font-body text-sm"
                />
              </div>
            </div>

            <div className="p-2 overflow-y-auto flex-1">
              {filteredTokens.length > 0 ? filteredTokens.map((token) => (
                <button 
                  key={token.symbol}
                  onClick={() => { handleTokenSelect(token); setSearchQuery(''); }}
                  className="w-full flex items-center justify-between p-4 hover:bg-surface-container-high transition-colors border-b border-outline-variant/5 last:border-0 group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-surface-container-highest flex items-center justify-center border border-outline-variant/30 group-hover:border-primary/50 transition-colors">
                      {token.isImage ? (
                        <img src={token.icon as string} alt={token.symbol} className="w-6 h-6 grayscale-[0.5] group-hover:grayscale-0" />
                      ) : (
                        <token.icon className="w-5 h-5 text-white group-hover:text-primary transition-colors" />
                      )}
                    </div>
                    <div className="text-left">
                      <div className="font-headline font-bold text-white uppercase">{token.symbol}</div>
                      <div className="text-xs text-on-surface-variant">{token.name}</div>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <div className="font-headline font-bold text-white">{token.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</div>
                    <div className="text-[10px] text-on-surface-variant uppercase">Balance</div>
                  </div>
                </button>
              )) : (
                <div className="text-center py-8 text-on-surface-variant text-sm font-headline uppercase tracking-widest">
                  No tokens found
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-container-low border border-primary/30 w-full max-w-md shadow-[0_0_50px_rgba(255,215,0,0.15)] p-6">
            {isSwapping ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="relative w-24 h-24 mb-6">
                  <div className="absolute inset-0 border-4 border-outline-variant/30 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-primary rounded-full border-t-transparent animate-spin"></div>
                  <ArrowDownUp className="absolute inset-0 m-auto w-8 h-8 text-primary animate-pulse" />
                </div>
                <h3 className="font-headline font-black text-2xl uppercase tracking-tighter text-white mb-2 animate-pulse">EXECUTING SWAP</h3>
                <p className="text-on-surface-variant text-sm font-body">Chomping through the blockchain...</p>
              </div>
            ) : (
              <>
                <h3 className="font-headline font-black text-2xl uppercase tracking-tighter text-white mb-6 border-b border-outline-variant/15 pb-4">Confirm Swap</h3>
                
                <div className="space-y-4 mb-8">
                  <div className="flex justify-between items-center bg-surface-container p-4">
                    <span className="text-xs font-headline uppercase text-on-surface-variant">You Sell</span>
                    <span className="font-headline font-bold text-xl text-white">{sellAmount} {sellToken.symbol}</span>
                  </div>
                  <div className="flex justify-center -my-6 relative z-10">
                    <div className="bg-surface-container-highest p-2 rounded-full border border-outline-variant/15">
                      <ArrowDownUp className="w-4 h-4 text-primary" />
                    </div>
                  </div>
                  <div className="flex justify-between items-center bg-surface-container p-4">
                    <span className="text-xs font-headline uppercase text-on-surface-variant">You Buy</span>
                    <span className="font-headline font-bold text-xl text-primary">{buyAmount} {buyToken.symbol}</span>
                  </div>
                </div>

                <div className="space-y-2 mb-8 p-4 border border-outline-variant/15 bg-surface-container-highest/50">
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Rate</span>
                    <span className="text-white">1 {sellToken.symbol} = {exchangeRate.toFixed(5)} {buyToken.symbol}</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Slippage</span>
                    <span className="text-secondary">{slippage}%</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Min. Received</span>
                    <span className="text-white">{minReceived} {buyToken.symbol}</span>
                  </div>
                  <div className="flex justify-between text-xs font-headline text-on-surface-variant uppercase">
                    <span>Network Fee</span>
                    <span className="text-white">~$4.20</span>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 py-3 font-headline font-bold uppercase tracking-widest text-on-surface-variant border border-outline-variant/30 hover:bg-surface-container-highest transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      setIsSwapping(true);
                      setTimeout(() => {
                        setIsSwapping(false);
                        setShowConfirmModal(false);
                        setSwapHistory([{
                          id: Date.now(),
                          sellAmount: parsedSell,
                          sellSymbol: sellToken.symbol,
                          buyAmount: parseFloat(buyAmount),
                          buySymbol: buyToken.symbol,
                          time: 'Just now'
                        }, ...swapHistory]);
                        setSellAmount('');
                      }, 2000);
                    }}
                    className="flex-1 py-3 font-headline font-black uppercase tracking-widest bg-primary text-on-primary hover:bg-white hover:text-black transition-colors shadow-[0_0_20px_rgba(255,215,0,0.2)]"
                  >
                    Confirm
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper icon for Utensils since it wasn't imported at the top
function UtensilsIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </svg>
  );
}

function LiquidityModal({ pool, onClose }: { pool: { id: string, t1: string, t2: string }, onClose: () => void }) {
  const [tab, setTab] = useState<'ADD' | 'REMOVE' | 'HARVEST'>('ADD');
  const [amount1, setAmount1] = useState('');
  const [amount2, setAmount2] = useState('');
  const [removePercent, setRemovePercent] = useState(0);

  // Mock balances
  const bal1 = 10000;
  const bal2 = 5000;
  const lpBalance = 420.69;
  const pendingRewards = 14.5; // Mock rewards in OMNOM
  const currentApr = "412.05%";
  const ratio = "1 " + pool.t1 + " = 0.5 " + pool.t2;

  const handleAddMax = () => {
    setAmount1(bal1.toString());
    setAmount2((bal1 * 0.5).toString()); // Mock ratio
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-surface-container-low border border-primary/30 w-full max-w-lg shadow-[0_0_50px_rgba(255,215,0,0.15)] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-outline-variant/15">
          <h3 className="font-headline font-black text-2xl uppercase tracking-tighter text-white">
            MANAGE <span className="text-primary">{pool.id}</span>
          </h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-primary transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-outline-variant/15">
          <button 
            onClick={() => setTab('ADD')}
            className={`flex-1 py-4 font-headline font-bold uppercase tracking-widest text-sm transition-colors ${tab === 'ADD' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-on-surface-variant hover:text-white hover:bg-surface-container-high'}`}
          >
            Deposit
          </button>
          <button 
            onClick={() => setTab('REMOVE')}
            className={`flex-1 py-4 font-headline font-bold uppercase tracking-widest text-sm transition-colors ${tab === 'REMOVE' ? 'text-secondary border-b-2 border-secondary bg-secondary/5' : 'text-on-surface-variant hover:text-white hover:bg-surface-container-high'}`}
          >
            Withdraw
          </button>
          <button 
            onClick={() => setTab('HARVEST')}
            className={`flex-1 py-4 font-headline font-bold uppercase tracking-widest text-sm transition-colors ${tab === 'HARVEST' ? 'text-white border-b-2 border-white bg-white/5' : 'text-on-surface-variant hover:text-white hover:bg-surface-container-high'}`}
          >
            Harvest
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {tab === 'ADD' ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-surface-container-highest/30 p-3 border border-outline-variant/15 text-xs font-headline uppercase">
                <div className="text-on-surface-variant">Current Ratio: <span className="text-white font-bold">{ratio}</span></div>
                <div className="text-on-surface-variant">Pool APR: <span className="text-primary font-bold">{currentApr}</span></div>
              </div>

              {/* Token 1 Input */}
              <div className="bg-surface-container p-4 border-l-4 border-primary">
                <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                  <span>Input {pool.t1}</span>
                  <span>Balance: {bal1.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <input 
                    type="number" 
                    value={amount1}
                    onChange={(e) => {
                      setAmount1(e.target.value);
                      setAmount2((parseFloat(e.target.value || '0') * 0.5).toString());
                    }}
                    className="bg-transparent border-none p-0 text-3xl font-headline font-bold text-white focus:ring-0 w-2/3 outline-none" 
                    placeholder="0.00" 
                  />
                  <div className="flex items-center gap-2">
                    <button onClick={handleAddMax} className="text-primary hover:text-white transition-colors px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-[10px] active:scale-95 font-bold">MAX</button>
                    <span className="font-headline font-bold text-white">{pool.t1}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-center -my-2 relative z-10">
                <div className="bg-surface-container-highest p-2 rounded-full border border-outline-variant/15">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
              </div>

              {/* Token 2 Input */}
              <div className="bg-surface-container p-4 border-l-4 border-outline-variant/30">
                <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                  <span>Input {pool.t2}</span>
                  <span>Balance: {bal2.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <input 
                    type="number" 
                    value={amount2}
                    onChange={(e) => {
                      setAmount2(e.target.value);
                      setAmount1((parseFloat(e.target.value || '0') * 2).toString());
                    }}
                    className="bg-transparent border-none p-0 text-3xl font-headline font-bold text-white focus:ring-0 w-2/3 outline-none" 
                    placeholder="0.00" 
                  />
                  <span className="font-headline font-bold text-white">{pool.t2}</span>
                </div>
              </div>

              <div className="pt-4">
                <button 
                  onClick={() => {
                    alert("Liquidity Added!");
                    onClose();
                  }}
                  className="w-full bg-primary text-on-primary font-headline font-black text-xl py-5 uppercase tracking-tighter shadow-[0_0_30px_rgba(255,215,0,0.3)] hover:bg-white hover:text-black hover:shadow-[0_0_50px_rgba(255,215,0,0.5)] active:scale-[0.98] transition-all"
                >
                  AUTHORIZE & FEED
                </button>
              </div>
            </div>
          ) : tab === 'REMOVE' ? (
            <div className="space-y-6">
              <div className="bg-surface-container p-6 text-center border border-outline-variant/15">
                <div className="text-xs font-headline uppercase text-on-surface-variant mb-2">Your LP Tokens</div>
                <div className="text-4xl font-headline font-black text-white">{lpBalance}</div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-4">
                  <span>Remove Amount</span>
                  <span className="text-secondary">{removePercent}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={removePercent}
                  onChange={(e) => setRemovePercent(parseInt(e.target.value))}
                  className="w-full accent-secondary h-2 bg-surface-container-highest appearance-none cursor-pointer"
                />
                <div className="flex justify-between mt-4 gap-2">
                  {[25, 50, 75, 100].map(pct => (
                    <button 
                      key={pct}
                      onClick={() => setRemovePercent(pct)}
                      className={`flex-1 py-2 text-xs font-headline font-bold uppercase border transition-colors ${removePercent === pct ? 'border-secondary text-secondary bg-secondary/10' : 'border-outline-variant/30 text-on-surface-variant hover:border-secondary/50'}`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-surface-container-highest/50 p-4 border border-outline-variant/15 space-y-2">
                <div className="text-xs font-headline uppercase text-on-surface-variant mb-2">You Will Receive</div>
                <div className="flex justify-between items-center">
                  <span className="font-headline text-white">{(10000 * (removePercent/100)).toFixed(2)}</span>
                  <span className="font-headline font-bold text-on-surface-variant">{pool.t1}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-headline text-white">{(5000 * (removePercent/100)).toFixed(2)}</span>
                  <span className="font-headline font-bold text-on-surface-variant">{pool.t2}</span>
                </div>
              </div>

              <button 
                disabled={removePercent === 0}
                onClick={() => {
                  alert("Liquidity Removed!");
                  onClose();
                }}
                className={`w-full font-headline font-black text-xl py-5 uppercase tracking-tighter transition-all ${removePercent === 0 ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed border border-outline-variant/30' : 'bg-secondary text-white shadow-[0_0_30px_rgba(157,0,255,0.3)] hover:shadow-[0_0_50px_rgba(157,0,255,0.5)] active:scale-[0.98]'}`}
              >
                {removePercent === 0 ? 'SELECT AMOUNT' : 'WITHDRAW LIQUIDITY'}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-surface-container p-8 text-center border border-outline-variant/15 flex flex-col items-center justify-center">
                <Flame className="w-12 h-12 text-primary mb-4 animate-pulse" />
                <div className="text-xs font-headline uppercase text-on-surface-variant mb-2">Pending Rewards</div>
                <div className="text-5xl font-headline font-black text-white mb-2">{pendingRewards} <span className="text-2xl text-primary">OMNOM</span></div>
                <div className="text-xs text-on-surface-variant uppercase tracking-widest">~$12.45 USD</div>
              </div>

              <button 
                onClick={() => {
                  alert("Rewards Harvested!");
                  onClose();
                }}
                className="w-full bg-white text-black font-headline font-black text-xl py-5 uppercase tracking-tighter shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(255,255,255,0.5)] active:scale-[0.98] transition-all"
              >
                HARVEST REWARDS
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreatePoolModal({ onClose }: { onClose: () => void }) {
  const [token1, setToken1] = useState(TOKENS[1]);
  const [token2, setToken2] = useState(TOKENS[0]);
  const [amount1, setAmount1] = useState('');
  const [amount2, setAmount2] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-surface-container-low border border-primary/30 w-full max-w-lg shadow-[0_0_50px_rgba(255,215,0,0.15)] flex flex-col">
        <div className="flex justify-between items-center p-6 border-b border-outline-variant/15">
          <h3 className="font-headline font-black text-2xl uppercase tracking-tighter text-white">
            CREATE <span className="text-primary">NEW POOL</span>
          </h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-primary transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-surface-container-highest/30 p-4 border border-outline-variant/15 text-sm font-body text-on-surface-variant">
            Creating a new pool requires setting the initial ratio. This ratio will determine the starting price.
          </div>

          <div className="space-y-4">
            {/* Token 1 */}
            <div className="bg-surface-container p-4 border-l-4 border-primary">
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                <span>First Token</span>
                <span>Balance: {token1.balance.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <input 
                  type="number" 
                  value={amount1}
                  onChange={(e) => setAmount1(e.target.value)}
                  className="bg-transparent border-none p-0 text-3xl font-headline font-bold text-white focus:ring-0 w-1/2 outline-none" 
                  placeholder="0.00" 
                />
                <button className="bg-surface-container-high px-3 py-2 flex items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors">
                  <span className="font-headline font-bold">{token1.symbol}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex justify-center -my-4 relative z-10">
              <div className="bg-surface-container-highest p-2 rounded-full border border-outline-variant/15">
                <Zap className="w-4 h-4 text-primary" />
              </div>
            </div>

            {/* Token 2 */}
            <div className="bg-surface-container p-4 border-l-4 border-outline-variant/30">
              <div className="flex justify-between text-xs font-headline uppercase text-on-surface-variant mb-2">
                <span>Second Token</span>
                <span>Balance: {token2.balance.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <input 
                  type="number" 
                  value={amount2}
                  onChange={(e) => setAmount2(e.target.value)}
                  className="bg-transparent border-none p-0 text-3xl font-headline font-bold text-white focus:ring-0 w-1/2 outline-none" 
                  placeholder="0.00" 
                />
                <button className="bg-surface-container-high px-3 py-2 flex items-center gap-2 border border-outline-variant/15 hover:border-primary/50 transition-colors">
                  <span className="font-headline font-bold">{token2.symbol}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="bg-surface-container-highest/50 p-4 border border-outline-variant/15">
            <div className="text-xs font-headline uppercase text-on-surface-variant mb-2">Initial Ratio</div>
            <div className="font-headline text-white">
              {amount1 && amount2 ? `1 ${token1.symbol} = ${(parseFloat(amount2) / parseFloat(amount1)).toFixed(5)} ${token2.symbol}` : 'Enter amounts to see ratio'}
            </div>
          </div>

          <button 
            disabled={!amount1 || !amount2}
            onClick={() => {
              alert("Pool Created!");
              onClose();
            }}
            className={`w-full font-headline font-black text-xl py-5 uppercase tracking-tighter transition-all ${(!amount1 || !amount2) ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed border border-outline-variant/30' : 'bg-primary text-on-primary shadow-[0_0_30px_rgba(255,215,0,0.3)] hover:bg-white hover:text-black hover:shadow-[0_0_50px_rgba(255,215,0,0.5)] active:scale-[0.98]'}`}
          >
            INITIALIZE POOL
          </button>
        </div>
      </div>
    </div>
  );
}
