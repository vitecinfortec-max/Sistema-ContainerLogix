// Densidade da tela por usuário (10/11/2026): Compacto / Normal / Confortável.
// Ajusta a escala base do sistema (variável --density em index.css) e fica
// salva no perfil (PUT /auth/me/preferences), valendo em qualquer computador.
// Uma cópia no navegador aplica a escolha antes do login carregar, para a
// tela não "pular" de tamanho ao abrir.

export const DENSITIES = [
  { value: 'compact', label: 'Compacto', hint: 'Mais informação na tela' },
  { value: 'normal', label: 'Normal', hint: 'Padrão do sistema' },
  { value: 'comfortable', label: 'Confortável', hint: 'Letras e campos maiores' },
];

const STORAGE_KEY = 'density';
const VALID = new Set(DENSITIES.map((d) => d.value));

export function normalizeDensity(value) {
  return VALID.has(value) ? value : 'normal';
}

export function applyDensity(value) {
  const density = normalizeDensity(value);
  const root = document.documentElement;
  if (density === 'normal') delete root.dataset.density;
  else root.dataset.density = density;
  try { localStorage.setItem(STORAGE_KEY, density); } catch { /* sem storage */ }
  return density;
}

export function readSavedDensity() {
  try { return normalizeDensity(localStorage.getItem(STORAGE_KEY)); } catch { return 'normal'; }
}
