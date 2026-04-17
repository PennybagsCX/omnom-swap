import { ExternalLink } from 'lucide-react';
import type { TabType } from '../App';

interface FooterProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export function Footer({ activeTab, setActiveTab }: FooterProps) {
  return (
    <footer className="bg-surface-container-lowest border-t border-outline-variant/15 relative z-10">
      <div className="flex flex-col md:flex-row justify-between items-center px-6 md:px-8 py-4 md:py-6 w-full max-w-[1920px] mx-auto">
        <div className="font-body text-[10px] uppercase tracking-[0.2em] font-medium text-on-surface-variant">
          $OMNOM: Unleash the Beast. Defend the Doge. <span className="text-primary">Devour the Rest.</span>
        </div>
        <div className="flex flex-wrap justify-center gap-4 md:gap-6 mt-3 md:mt-0 font-body text-[10px] uppercase tracking-[0.2em] font-medium">
          <button
            onClick={() => setActiveTab('DISCLOSURES')}
            className={`transition-colors cursor-pointer ${
              activeTab === 'DISCLOSURES'
                ? 'text-primary'
                : 'text-on-surface-variant hover:text-primary'
            }`}
          >
            DISCLOSURES
          </button>
          <a
            href="https://x.com/omnomtoken"
            target="_blank"
            rel="noopener noreferrer"
            className="text-on-surface-variant hover:text-primary transition-colors inline-flex items-center gap-1"
          >
            X (Twitter)
          </a>
          <a
            href="https://t.me/omnomtoken_dc"
            target="_blank"
            rel="noopener noreferrer"
            className="text-on-surface-variant hover:text-primary transition-colors inline-flex items-center gap-1"
          >
            Telegram
          </a>
          <a
            href="https://github.com/PennybagsCX/omnom-swap"
            target="_blank"
            rel="noopener noreferrer"
            className="text-on-surface-variant hover:text-primary transition-colors inline-flex items-center gap-1"
          >
            Docs <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>
      <div className="h-1 bg-primary w-full opacity-10"></div>
    </footer>
  );
}
