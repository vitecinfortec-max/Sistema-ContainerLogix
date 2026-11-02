import { addDays, format } from 'date-fns';
import { todayISO } from './dates';

// Regras e formatos do Orçamento de Reparo, usados pela lista
// (pages/RepairEstimatesPage) e pelo formulário (pages/RepairEstimateFormPage)

export const ESTIMATE_STATUS = {
  EM_ABERTO: { label: 'Em aberto', tone: 'blue' },
  APROVADO: { label: 'Aprovado', tone: 'emerald' },
  REPROVADO: { label: 'Reprovado', tone: 'red' },
  CANCELADO: { label: 'Cancelado', tone: 'slate' },
};

export const SIZE_TYPES = ['20DC', '20RF', '20OT', '20FR', '40HC', '40RF', '40OT', '40FR', '40DRY'];

export const formatMoney = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const estimateCode = (number) => `OR${String(number || 0).padStart(6, '0')}`;
export const vistoriaCode = (number) => `VC${String(number || 0).padStart(6, '0')}`;
export const toNumber = (value) => {
  const parsed = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

// Validade conta da data de emissão (dia de Brasília, igual ao backend)
export const validUntil = (estimate) => addDays(new Date(estimate.created_at), estimate.validity_days || 0);
export const isExpired = (estimate) => estimate.status === 'EM_ABERTO' && format(validUntil(estimate), 'yyyy-MM-dd') < todayISO();
