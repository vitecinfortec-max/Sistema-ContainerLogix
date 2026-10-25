import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Autocomplete } from './Autocomplete';
import { api } from '../lib/api';

// Peças comuns das telas do RH (Folha, Férias, Ocorrências, Banco de Horas,
// Documentos...): formatação, rótulos e o seletor de contrato.

export const formatMoney = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtDate = (v) => (v ? format(new Date(`${String(v).slice(0, 10)}T00:00:00`), 'dd/MM/yyyy') : '-');
export const fmtNumber = (v, digits = 2) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits });

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const competenceLabel = (c) => {
  if (!c) return '-';
  const [y, m] = c.split('-');
  return `${MONTHS[Number(m) - 1].replace(/^./, (x) => x.toUpperCase())}/${y}`;
};

export const CONTRACT_STATUS = { ATIVO: 'Ativo', AFASTADO: 'Afastado', DESLIGADO: 'Desligado' };
export const CONTRACT_STATUS_TONES = { ATIVO: 'emerald', AFASTADO: 'amber', DESLIGADO: 'slate' };
export const PERSON_TYPES = { MOTORISTA: 'Motorista', FUNCIONARIO: 'Funcionário' };

/** Minutos com sinal -> "H:MM" (ex.: -90 -> "-1:30"). */
export function fmtMinutes(minutes) {
  const m = Number(minutes) || 0;
  const abs = Math.abs(m);
  return `${m < 0 ? '-' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** "H:MM" ou "H" -> minutos; null se inválido. */
export function parseHours(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const match = t.match(/^(\d{1,3})(?::(\d{1,2}))?$/);
  if (!match) return null;
  const minutes = match[2] ? Number(match[2]) : 0;
  if (minutes > 59) return null;
  return Number(match[1]) * 60 + minutes;
}

/** Salva o PDF/planilha recebido como blob; erro do backend vem dentro do blob. */
export async function saveBlob(request, filename) {
  try {
    const response = await request();
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    let detail = null;
    try { detail = JSON.parse(await e?.response?.data?.text())?.detail; } catch (_) { /* resposta não é JSON */ }
    toast.error(detail || 'Erro ao gerar o arquivo');
  }
}

export const errorDetail = (e, fallback) => {
  const detail = e?.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg).join('; ');
  return detail || fallback;
};

/** Listas do RH (tipos de contrato, ocorrência, documento, eventos da folha...). */
export function useHRMeta() {
  const [meta, setMeta] = useState({
    contract_types: [], termination_types: [], notice_types: [], occurrence_types: [], document_types: [], run_types: [], events: [],
  });
  useEffect(() => {
    api.getHRMeta().then((r) => setMeta(r.data)).catch(() => toast.error('Erro ao carregar as listas do RH'));
  }, []);
  const label = (list, value) => (meta[list] || []).find((o) => o.value === value)?.label || value || '-';
  return { meta, label };
}

/** Contratos do RH (vigentes por padrão) para os seletores. */
export function useContracts(includeTerminated = false) {
  const [contracts, setContracts] = useState([]);
  const load = () => api.getHRContracts(includeTerminated ? {} : { status: 'VIGENTE' })
    .then((r) => setContracts(r.data || []))
    .catch(() => toast.error('Erro ao carregar os contratos'));
  useEffect(() => { load(); }, [includeTerminated]); // eslint-disable-line react-hooks/exhaustive-deps
  return { contracts, reload: load };
}

export const contractLabel = (c) => (c ? `${c.person_name}${c.position_name ? ` - ${c.position_name}` : ''} (Mat. ${c.contract_number})` : '');

/** Busca de funcionário (contrato) por digitação. */
export function ContractPicker({ contracts, value, onChange, disabled, testId }) {
  const selected = contracts.find((c) => c.id === value);
  const [text, setText] = useState(contractLabel(selected));
  // Só acompanha quando há um contrato escolhido: ao digitar, o valor é
  // limpo e o texto digitado precisa continuar no campo.
  useEffect(() => {
    const c = contracts.find((x) => x.id === value);
    if (c) setText(contractLabel(c));
  }, [value, contracts]);
  if (disabled) {
    return <div className="h-9 px-3 flex items-center rounded-md border border-input bg-muted text-sm truncate">{text || '-'}</div>;
  }
  return (
    <Autocomplete
      value={text}
      onChange={(v) => { setText(v); if (value) onChange(''); }}
      onSelect={(c) => onChange(c.id)}
      options={contracts}
      displayField={contractLabel}
      className="text-sm"
      testId={testId}
    />
  );
}
