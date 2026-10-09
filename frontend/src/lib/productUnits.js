// Unidades de medida dos produtos do Almoxarifado. A NF-e traz a unidade
// abreviada do jeito do fornecedor ("UN", "PC", "CX"...): `normalizeUnit` leva
// pra unidade do cadastro. Mesma tabela de PRODUCT_UNIT_ALIASES em
// backend/models.py - se mudar uma, mudar a outra.

export const PRODUCT_UNITS = [
  ['UNIDADE', 'Unidade', 'un'],
  ['PECA', 'Peça', 'pç'],
  ['PAR', 'Par', 'par'],
  ['CAIXA', 'Caixa', 'cx'],
  ['KG', 'Kg', 'kg'],
  ['TON', 'Tonelada', 't'],
  ['LITRO', 'Litro', 'L'],
  ['METRO', 'Metro', 'm'],
  ['M3', 'm³', 'm³'],
  ['PALLET', 'Pallet', 'plt'],
];

const ALIASES = {
  UN: 'UNIDADE', UND: 'UNIDADE', UNID: 'UNIDADE', UNI: 'UNIDADE',
  PC: 'PECA', 'PÇ': 'PECA', PCA: 'PECA', 'PEÇA': 'PECA',
  PR: 'PAR', CX: 'CAIXA', KGS: 'KG', QUILO: 'KG',
  T: 'TON', TONELADA: 'TON',
  L: 'LITRO', LT: 'LITRO', LTS: 'LITRO',
  M: 'METRO', MT: 'METRO', MTS: 'METRO', 'M³': 'M3',
  PL: 'PALLET', PLT: 'PALLET',
};

const SHORT = Object.fromEntries(PRODUCT_UNITS.map(([value, , short]) => [value, short]));

/** "UN" -> "UNIDADE", "cx" -> "CAIXA"; o que não for conhecido fica como veio (em maiúsculas). */
export function normalizeUnit(unit) {
  const key = (unit || '').trim().toUpperCase();
  return ALIASES[key] || key;
}

/** Abreviação pra mostrar ao lado de uma quantidade: "18 par", "2,5 kg". */
export function unitShort(unit) {
  const normalized = normalizeUnit(unit);
  if (!normalized) return '';
  return SHORT[normalized] || normalized.toLowerCase();
}

/** Opções do campo Unidade de Medida; uma unidade fora da lista (vinda de NF-e antiga) entra junto, pra não sumir. */
export function unitOptionsFor(current) {
  const normalized = normalizeUnit(current);
  const options = PRODUCT_UNITS.map(([value, label]) => [value, label]);
  if (normalized && !options.some(([value]) => value === normalized)) options.push([normalized, normalized]);
  return options;
}

export const fmtQty = (value) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Quantidade com a unidade: "18 par". */
export const qtyWithUnit = (value, unit) => `${fmtQty(value)}${unitShort(unit) ? ` ${unitShort(unit)}` : ''}`;
