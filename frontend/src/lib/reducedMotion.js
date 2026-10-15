// Política única para quem pede "reduzir movimento" no sistema operacional
// (Windows: Configurações > Acessibilidade > Efeitos visuais > Efeitos de
// animação desligado; celular: "Reduzir movimento"/"Remover animações").
// Com a preferência ligada:
//   - CSS (index.css, fim do arquivo): animações e transições ficam
//     instantâneas, exceto o indicador de carregamento girando; as entradas
//     de linhas e cartões nem começam.
//   - Motion: MotionConfig reducedMotion="user" (components/Motion.jsx) e os
//     números deixam de contar (CountingText).
//   - Gráficos (components/Charts.jsx): desenhados já prontos, sem animação.
//   - 3D (components/three/Stage3D.jsx, components/LoginScene3D.jsx): cena
//     parada, sem o laço de animação.
//   - Rolagens: pulam direto em vez de deslizar (scrollBehavior abaixo).
const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches;
}

/** Valor de `behavior` para scrollTo/scrollIntoView. */
export function scrollBehavior() {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
