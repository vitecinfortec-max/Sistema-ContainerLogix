import { useEffect, useState } from 'react';
import { ArrowUpRight, Megaphone } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/utils';
import { prefersReducedMotion } from '../lib/reducedMotion';

// Painel de avisos da tela de login (referência: Bsoft). Os avisos são
// cadastrados pelo administrador em Dados da Empresa; com mais de um, eles
// se revezam sozinhos (parando quando o mouse está em cima) e os pontinhos
// trocam na mão. `variant`: 'hero' sobre a cena 3D (computador) ou 'card'
// compacto abaixo do formulário (celular).
const ROTATE_MS = 8000;

export default function LoginNotices({ notices, variant = 'hero' }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = notices.length;

  useEffect(() => {
    if (count < 2 || paused || prefersReducedMotion()) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(timer);
  }, [count, paused]);

  if (count === 0) return null;
  const notice = notices[Math.min(index, count - 1)];
  const hero = variant === 'hero';

  return (
    <section
      aria-label="Avisos"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        'pointer-events-auto',
        hero
          ? 'rounded-2xl bg-black/45 backdrop-blur-md ring-1 ring-white/15 p-7 xl:p-8 text-white shadow-2xl'
          : 'rounded-xl border border-primary/20 bg-primary/[0.04] dark:bg-primary/10 p-4 text-slate-800 dark:text-slate-100',
      )}
      data-testid={hero ? 'login-notices' : 'login-notices-mobile'}
    >
      <p className={cn('flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]', hero ? 'text-amber-300' : 'text-primary')}>
        <Megaphone className="w-3.5 h-3.5" />
        Aviso{count > 1 ? ` ${index + 1} de ${count}` : ''}
      </p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={notice.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <h2 className={cn('font-black tracking-tight leading-tight mt-2', hero ? 'text-3xl xl:text-4xl' : 'text-lg')} data-testid="login-notice-title">
            {notice.title}
          </h2>
          {notice.message && (
            <p className={cn('mt-3 whitespace-pre-line', hero ? 'text-base xl:text-lg text-white/85 leading-relaxed' : 'text-sm text-slate-600 dark:text-slate-300')}>
              {notice.message}
            </p>
          )}
          {notice.link_url && (
            <a
              href={notice.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'mt-5 inline-flex items-center gap-2 rounded-lg font-semibold transition-colors',
                hero ? 'bg-primary hover:bg-primary/90 text-white px-5 py-3 text-base' : 'text-primary hover:underline text-sm mt-3',
              )}
              data-testid="login-notice-link"
            >
              {notice.link_label || 'Saiba mais'}
              <ArrowUpRight className="w-4 h-4" />
            </a>
          )}
        </motion.div>
      </AnimatePresence>
      {count > 1 && (
        <div className="flex items-center gap-1.5 mt-5">
          {notices.map((n, i) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Ver aviso ${i + 1}`}
              aria-current={i === index}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === index ? 'w-6' : 'w-1.5',
                hero ? (i === index ? 'bg-white' : 'bg-white/40 hover:bg-white/70') : (i === index ? 'bg-primary' : 'bg-primary/30'),
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
