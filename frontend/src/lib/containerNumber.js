// Cálculo do dígito verificador de número de contêiner (padrão ISO 6346):
// 4 letras (código do proprietário + identificador de categoria) + 6 dígitos
// de série + 1 dígito verificador, ex: CSQU3054383 -> "CSQU305438-3".
const LETTER_VALUES = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

function charValue(ch) {
  return ch >= '0' && ch <= '9' ? Number(ch) : LETTER_VALUES[ch];
}

export function calculateContainerCheckDigit(first10) {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += charValue(first10[i]) * Math.pow(2, i);
  }
  const remainder = sum % 11;
  return remainder === 10 ? 0 : remainder;
}

// Formata um número de contêiner digitado no padrão "XXXX999999-9",
// calculando e acrescentando automaticamente o dígito verificador sempre que
// ele estiver ausente (ou incorreto) - qualquer coisa digitada além dos 10
// primeiros caracteres válidos é descartada, já que o 11º dígito nunca é
// livre, é sempre derivado dos 10 primeiros.
export function formatContainerNumber(raw) {
  const clean = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const first10 = clean.slice(0, 10);

  if (!/^[A-Z]{4}[0-9]{6}$/.test(first10)) {
    // Ainda digitando, ou não segue o padrão 4 letras + 6 dígitos - não dá
    // pra calcular o dígito verificador ainda, mantém só o texto em maiúsculas.
    return clean;
  }

  const checkDigit = calculateContainerCheckDigit(first10);
  return `${first10}-${checkDigit}`;
}
