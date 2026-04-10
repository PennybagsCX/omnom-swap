import { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  isFullWidth?: boolean;
}

export default function Button({ children, variant = 'primary', isFullWidth = false, className = '', ...props }: ButtonProps) {
  const baseStyles = 'font-headline font-black uppercase tracking-tighter transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed';
  
  let shadow = '';
  if (variant === 'primary' && !props.disabled) shadow = 'shadow-[0_0_30px_rgba(255,215,0,0.3)] hover:shadow-[0_0_50px_rgba(255,215,0,0.5)]';
  if (variant === 'secondary' && !props.disabled) shadow = 'shadow-[0_0_30px_rgba(157,0,255,0.3)] hover:shadow-[0_0_50px_rgba(157,0,255,0.5)]';

  const variants = {
    primary: 'bg-primary text-on-primary hover:bg-white',
    secondary: 'bg-secondary text-white hover:bg-white hover:text-secondary',
    outline: 'border border-outline-variant/30 hover:border-primary text-on-surface-variant hover:text-primary shadow-none bg-surface-container-highest/50',
  };

  const width = isFullWidth ? 'w-full' : '';

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${width} ${shadow} py-4 px-6 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
