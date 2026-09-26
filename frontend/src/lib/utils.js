import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Normaliza a digitação de um campo numérico decimal digitado como texto -
// usado no lugar de <input type="number"> em campos de KM, porque esse
// input nativo deixa o navegador aceitar "," como separador decimal
// conforme o idioma configurado, o que já causou leitura de KM salva errada
// (ex: "84,477" virando 84.477 em vez de 84477). Sempre converte "," pra "."
// e só aceita dígitos e um único ponto. Retorna null se o valor digitado
// não é um número válido (o chamador então ignora a tecla).
export function sanitizeKmInput(rawValue) {
  const normalized = rawValue.replace(',', '.');
  return /^\d*\.?\d*$/.test(normalized) ? normalized : null;
}
