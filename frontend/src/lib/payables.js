// Contas a Pagar: rótulos e contas que a lista e o formulário dividem
// (regras do servidor em backend/routers/payables.py).

export const PAYABLE_STATUS = {
  ABERTO: { label: 'Em aberto', tone: 'blue' },
  VENCIDO: { label: 'Vencida', tone: 'red' },
  PAGO: { label: 'Paga', tone: 'emerald' },
  CANCELADO: { label: 'Cancelada', tone: 'slate' },
};

// Mesmas chaves de PAYMENT_METHODS no servidor
export const PAYMENT_METHODS = {
  PIX: 'PIX', BOLETO: 'Boleto', TRANSFERENCIA: 'Transferência', DINHEIRO: 'Dinheiro',
  CHEQUE: 'Cheque', CARTAO: 'Cartão', DEBITO_AUTOMATICO: 'Débito automático',
};

export const RECURRENCE = { UNICA: 'Única', PARCELADA: 'Parcelada', RECORRENTE: 'Recorrente (mensal)' };

export const formatMoney = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatDay = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '-');

// "1.500,50", "1500,5" e "1500.50" viram 1500.5; vazio vira null
export const parseMoney = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const brazilian = text.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(text);
  const n = Number(brazilian ? text.replace(/\./g, '').replace(',', '.') : text);
  return Number.isFinite(n) ? n : NaN;
};

export const payableLabel = (p) => `Nº ${p.payable_number}${p.installments_total > 1 ? ` - ${p.installment}/${p.installments_total}` : ''}`;

export const payableStatus = (p) => (p.status === 'ABERTO' && p.overdue ? 'VENCIDO' : p.status);

// Contas a Receber: títulos avulsos (backend/routers/receivable_titles.py)
export const RECEIVABLE_STATUS = {
  ABERTO: { label: 'Em aberto', tone: 'blue' },
  VENCIDO: { label: 'Vencido', tone: 'red' },
  RECEBIDO: { label: 'Recebido', tone: 'emerald' },
  CANCELADO: { label: 'Cancelado', tone: 'slate' },
};

export const receivableLabel = (t) => `Nº ${t.receivable_number}${t.installments_total > 1 ? ` - ${t.installment}/${t.installments_total}` : ''}`;

// Mesmo dia do mês seguinte; dia 31 em mês curto cai no último dia dele
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Parcelas mensais a partir do 1º vencimento. Parcelada divide o total (os
 * centavos que sobram vão na última); recorrente repete o valor todo mês.
 */
export function buildInstallments({ recurrence, count, firstDue, amount }) {
  const n = recurrence === 'UNICA' ? 1 : Math.max(1, Math.min(120, Number(count) || 1));
  if (!firstDue || !(amount > 0)) return [];
  const cents = Math.round(amount * 100);
  const each = recurrence === 'PARCELADA' ? Math.floor(cents / n) : cents;
  return Array.from({ length: n }, (_, i) => ({
    due_date: addMonths(firstDue, i),
    amount: ((recurrence === 'PARCELADA' && i === n - 1 ? cents - each * (n - 1) : each) / 100).toFixed(2).replace('.', ','),
  }));
}
