import { Car, Container, Truck } from 'lucide-react';

// O que as telas do Checklist de Veículo compartilham (lista, formulário,
// detalhes e impressão): tipos de veículo, posições de foto e a regra do
// resultado.

export const VEHICLE_TYPE_OPTIONS = [
  { value: 'CAMINHAO', label: 'Caminhão', hint: 'Cavalo mecânico ou caminhão', icon: Truck },
  { value: 'CARRETA', label: 'Carreta', hint: 'Semirreboque', icon: Container },
  { value: 'CARRO', label: 'Carro', hint: 'Veículo leve', icon: Car },
];
export const VEHICLE_TYPE_LABELS = VEHICLE_TYPE_OPTIONS.reduce((acc, { value, label }) => { acc[value] = label; return acc; }, {});
export const VEHICLE_TYPE_ICONS = VEHICLE_TYPE_OPTIONS.reduce((acc, { value, icon }) => { acc[value] = icon; return acc; }, {});

// Tipo do cadastro de veículos -> tipo de checklist
const REGISTRY_TYPE_TO_CHECKLIST = { 'CAMINHÃO': 'CAMINHAO', CAVALO: 'CAMINHAO', CARRETA: 'CARRETA' };
export const checklistTypeForVehicle = (vehicle) => REGISTRY_TYPE_TO_CHECKLIST[vehicle?.vehicle_type] || null;

// Posições de foto. `hint` diz o que precisa aparecer; `hints` troca o texto
// pra um tipo de veículo específico.
export const CHECKLIST_PHOTO_TYPES = [
  {
    value: 'front', label: 'Frente', hint: 'Veículo inteiro de frente, com a placa visível',
    hints: { CARRETA: 'Frente da carreta: engate, mangueiras e cabos' },
  },
  { value: 'back', label: 'Traseira', hint: 'Traseira inteira, com a placa e as lanternas' },
  {
    value: 'left_side', label: 'Lateral Esquerda', hint: 'Lado do motorista, de ponta a ponta',
    hints: { CARRETA: 'Lado esquerdo, de ponta a ponta' },
  },
  {
    value: 'right_side', label: 'Lateral Direita', hint: 'Lado do passageiro, de ponta a ponta',
    hints: { CARRETA: 'Lado direito, de ponta a ponta' },
  },
  { value: 'speedometer', label: 'Velocímetro', hint: 'Painel ligado, com o hodômetro legível' },
  { value: 'tires', label: 'Pneus', hint: 'Banda de rodagem e lateral dos pneus' },
];
export const CHECKLIST_PHOTO_LABELS = CHECKLIST_PHOTO_TYPES.reduce((acc, { value, label }) => { acc[value] = label; return acc; }, {});
export const MAX_VEHICLE_CHECKLIST_PHOTOS = 24;

/** Posições de foto pedidas pra um tipo de veículo. Carreta não tem painel:
 *  o velocímetro só aparece se o checklist já tiver foto dele. */
export function photoSlotsFor(vehicleType, photos = []) {
  return CHECKLIST_PHOTO_TYPES
    .filter(({ value }) => value !== 'speedometer' || vehicleType !== 'CARRETA' || photos.some((p) => p.type === value))
    .map((slot) => ({ ...slot, hint: slot.hints?.[vehicleType] || slot.hint }));
}

const LEGACY_ITEM_FIELDS = [
  'documentos_items', 'vehicle_condition_items', 'epi_items', 'kit_items', 'tank_items', 'post_loading_items',
];

/** Todos os itens de verificação do checklist (modelo atual e modelo antigo). */
export function checklistItems(checklist) {
  return [
    ...LEGACY_ITEM_FIELDS.flatMap((field) => checklist?.[field] || []),
    ...(checklist?.checklist_sections || []).flatMap((section) => section.items || []),
  ];
}

export function countAnswers(items) {
  const ok = items.filter((item) => item.answer === 'SIM').length;
  const failed = items.filter((item) => item.answer === 'NAO').length;
  const total = items.length;
  return { total, ok, failed, answered: ok + failed, pending: total - ok - failed };
}

// Reprovado se algum item foi marcado NÃO, aprovado se todos foram marcados
// SIM, senão pendente. Mesma regra de vehicle_checklist_result() no backend
// (routers/frota.py), que alimenta os indicadores e o filtro da lista - se
// mudar uma, mudar a outra.
export function resultFromCounts({ total, ok, failed }) {
  if (failed > 0) return 'REPROVADO';
  if (total > 0 && ok === total) return 'APROVADO';
  return 'PENDENTE';
}
export const checklistResult = (checklist) => resultFromCounts(countAnswers(checklistItems(checklist)));

export const RESULT_META = {
  APROVADO: { label: 'Aprovado', tone: 'emerald' },
  REPROVADO: { label: 'Reprovado', tone: 'red' },
  PENDENTE: { label: 'Pendente', tone: 'slate' },
};

/** Código do documento (o mesmo do código de barras da impressão). */
export const checklistCode = (number) => `CK${String(number ?? 0).padStart(6, '0')}`;

export const formatKm = (km) => (km !== null && km !== undefined && km !== '' ? `${Number(km).toLocaleString('pt-BR')} km` : '-');
