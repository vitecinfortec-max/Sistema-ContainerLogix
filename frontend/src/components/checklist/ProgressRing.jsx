import { motion } from '../Motion';
import { cn } from '../../lib/utils';

const TONES = {
  primary: 'text-primary',
  emerald: 'text-emerald-500',
  red: 'text-red-500',
  slate: 'text-slate-400',
};

/** Anel de progresso (0 a 1) que anima até o valor; `children` vai no centro. */
export default function ProgressRing({ value, size = 44, stroke = 4, tone = 'primary', className, children }) {
  const radius = (size - stroke) / 2;
  const fraction = Math.min(1, Math.max(0, value || 0));
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-slate-200 dark:stroke-slate-700" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="currentColor"
          className={cn('transition-colors duration-300', TONES[tone] || TONES.primary)}
          pathLength={1}
          strokeDasharray="1 1"
          initial={{ strokeDashoffset: 1 }}
          animate={{ strokeDashoffset: 1 - fraction }}
          transition={{ type: 'spring', stiffness: 90, damping: 20 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
