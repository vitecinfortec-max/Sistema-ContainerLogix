// Cor de destaque da empresa ("Dados da Empresa") nas telas: sobrescreve as
// variáveis do tema por uma <style> própria, para valer também no modo escuro.
const STYLE_ID = 'brand-accent';
const STORAGE_KEY = 'brandAccent';

function toHsl(hex) {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  if (!delta) return [0, 0, Math.round(l * 100)];
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / delta + 6) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

function writeStyle(hex) {
  document.getElementById(STYLE_ID)?.remove();
  if (!hex) return;
  const [h, s, l] = toHsl(hex);
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    :root { --primary: ${h} ${s}% ${l}%; --ring: ${h} ${s}% ${l}%; --accent: ${h} 30% 96%; }
    .dark { --primary: ${h} ${Math.min(s, 70)}% 55%; --ring: ${h} ${Math.min(s, 70)}% 55%; --accent: ${h} 30% 18%; }
  `;
  document.head.appendChild(style);
}

export function applyBrandAccent(hex) {
  if (hex) sessionStorage.setItem(STORAGE_KEY, hex);
  else sessionStorage.removeItem(STORAGE_KEY);
  writeStyle(hex);
}

// Evita piscar a cor padrão ao recarregar a página já logado
writeStyle(sessionStorage.getItem(STORAGE_KEY));
