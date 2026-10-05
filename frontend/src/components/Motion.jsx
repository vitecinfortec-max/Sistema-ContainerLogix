import { useLayoutEffect, useMemo, useRef } from 'react';
import { MotionConfig, animate, motion, useReducedMotion } from 'motion/react';

// Movimento do sistema - tudo sutil e rápido (0,15 a 0,3 s), pra dar fluidez
// sem atrasar quem usa as telas o dia inteiro. As peças das telas de listagem
// (components/DataPage.jsx) já usam o que está aqui, então a maioria das telas
// ganha o movimento sem precisar de código próprio.
//
// Usa `motion` (e não `m` + LazyMotion) de propósito: um componente `m`
// renderizado fora do provider ficaria parado no estado inicial (invisível).
// Quem prefere menos movimento no sistema operacional ("reduzir movimento")
// é respeitado pelo MotionConfig do MotionProvider.

export const EASE = [0.22, 1, 0.36, 1];
export const DURATION = { fast: 0.16, base: 0.24, slow: 0.4 };

export function MotionProvider({ children }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DURATION.base, ease: EASE }}>
      {children}
    </MotionConfig>
  );
}

/** Entrada padrão de um bloco: sobe alguns pixels enquanto aparece. */
export const riseIn = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

/** Pai que solta os filhos (com `variants={riseIn}`) um após o outro. */
export const staggerParent = (stagger = 0.05, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

/** Conteúdo da tela: aparece suavemente a cada troca de página. */
export function PageTransition({ children, className }) {
  return (
    <motion.div className={className} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
      {children}
    </motion.div>
  );
}

/** Um bloco que entra sozinho (sem depender de um pai com stagger). */
export function Reveal({ children, delay = 0, y = 10, as = 'div', ...props }) {
  const Comp = motion[as] || motion.div;
  return (
    <Comp initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DURATION.base, ease: EASE, delay }} {...props}>
      {children}
    </Comp>
  );
}

/** Grupo cujos <StaggerItem> entram em sequência. */
export function Stagger({ children, stagger = 0.05, delay = 0, as = 'div', ...props }) {
  const Comp = motion[as] || motion.div;
  return (
    <Comp variants={staggerParent(stagger, delay)} initial="hidden" animate="show" {...props}>
      {children}
    </Comp>
  );
}

export function StaggerItem({ children, as = 'div', ...props }) {
  const Comp = motion[as] || motion.div;
  return <Comp variants={riseIn} {...props}>{children}</Comp>;
}

// ---- Número que conta até o valor ----
// Aceita número ou texto com UM número no formato brasileiro e qualquer
// prefixo/sufixo sem dígitos ("R$ 1.234,56", "45%", "5,2 km/L", "#12").
// Textos com mais de um número ("12 / 30", datas) não são animados.
const NUMBER_RE = /^(\D*?)(-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?)(\D*)$/;

function parseAnimatable(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const decimals = Number.isInteger(value) ? 0 : Math.min(2, (String(value).split('.')[1] || '').length);
    return { target: value, format: (v) => (decimals ? v.toFixed(decimals) : String(Math.round(v))) };
  }
  if (typeof value !== 'string') return null;
  const match = value.match(NUMBER_RE);
  if (!match) return null;
  const [, prefix, num, suffix] = match;
  const decimals = num.includes(',') ? num.split(',')[1].length : 0;
  const grouping = /\.\d{3}/.test(num);
  const target = parseFloat(num.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(target)) return null;
  const format = (v) => prefix + v.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping,
  }) + suffix;
  return { target, format };
}

function CountingText({ value }) {
  const ref = useRef(null);
  const shown = useRef(0); // último número exibido - ponto de partida da próxima contagem
  const reduce = useReducedMotion();
  const parsed = useMemo(() => parseAnimatable(value), [value]);

  // Layout effect: o texto inicial entra antes da primeira pintura (sem piscar
  // o valor final e depois voltar pro zero).
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const finalText = String(value);
    if (!parsed || reduce || shown.current === parsed.target) {
      node.textContent = finalText;
      if (parsed) shown.current = parsed.target;
      return undefined;
    }
    node.textContent = parsed.format(shown.current);
    const controls = animate(shown.current, parsed.target, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { shown.current = v; node.textContent = parsed.format(v); },
      // No fim, o texto exato que a tela passou (mesma formatação de sempre)
      onComplete: () => { shown.current = parsed.target; node.textContent = finalText; },
    });
    return () => controls.stop();
  }, [value, parsed, reduce]);

  return <span ref={ref} />;
}

/** Mostra `value` contando do valor anterior (ou do zero) até ele. */
export function AnimatedNumber({ value }) {
  if (typeof value !== 'string' && typeof value !== 'number') return value ?? null;
  return <CountingText value={value} />;
}

export { motion };
