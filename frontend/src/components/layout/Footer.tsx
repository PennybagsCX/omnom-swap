export default function Footer() {
  return (
    <footer className="bg-surface-container-lowest border-t border-outline-variant/15 relative z-10 w-full mt-auto">
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
  );
}
