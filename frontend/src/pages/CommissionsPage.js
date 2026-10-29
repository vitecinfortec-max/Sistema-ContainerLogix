import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, PeriodFilterFields, SearchInput, DataCard, Toolbar, ToolbarButton,
  ToolbarPrimary, ToolbarDivider, StatusPill, EmptyState, TablePagination, usePagination,
} from '../components/DataPage';
import { Field } from '../components/FormKit';
import { Autocomplete } from '../components/Autocomplete';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { downloadBlob } from '../lib/fiscal';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import {
  AlertTriangle, CheckCircle2, Clock, Edit, FileCheck, FileDown, HandCoins, Loader2, Percent, Plus, RotateCcw, Trash2, Truck, Users, Wallet, X,
} from 'lucide-react';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v) => `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const fmtDate = (v) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '-');
const toNumber = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const toMoneyInput = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
const moneyMask = (v) => v.replace(/[^\d,.]/g, '');
const today = () => format(new Date(), 'yyyy-MM-dd');
const monthPeriod = () => [format(startOfMonth(new Date()), 'yyyy-MM-dd'), format(endOfMonth(new Date()), 'yyyy-MM-dd')];
const fmtPeriod = (start, end) => {
  if (!start && !end) return '-';
  // Mesmo ano: "01/10 a 31/10/2026", para caber na lista
  const from = start && end && start.slice(0, 4) === end.slice(0, 4) ? fmtDate(start).slice(0, 5) : (start ? fmtDate(start) : '...');
  return `${from} a ${end ? fmtDate(end) : '...'}`;
};
const sumBy = (items, key) => items.reduce((s, x) => s + (x[key] || 0), 0);
// Situação do filtro (lançamento) -> situação do adiantamento
const ADVANCE_STATUS = { PENDENTE: 'PENDENTE', PAGO: 'DESCONTADO' };

const DOCUMENT_TYPES = [['CTE', 'CT-e'], ['NF', 'Nota fiscal'], ['FATURA', 'Fatura'], ['OUTRO', 'Outro']];
const DOC_LABELS = Object.fromEntries(DOCUMENT_TYPES);
// Descontos mais comuns antes do cálculo da comissão
const DISCOUNT_PRESETS = ['Impostos', 'Pedágio', 'Seguro', 'Descarga', 'Avaria'];

const emptyForm = () => ({
  client_id: null, client_name: '', document_type: 'CTE', document_number: '', billing_date: today(),
  period_start: monthPeriod()[0], period_end: monthPeriod()[1],
  freight_value: '', discounts: [], use_table: true, commission_percentage: '', observations: '',
});

const toForm = (e) => ({
  client_id: e.client_id, client_name: e.client_name, document_type: e.document_type || 'CTE',
  document_number: e.document_number || '', billing_date: e.billing_date, freight_value: toMoneyInput(e.freight_value),
  period_start: e.period_start || '', period_end: e.period_end || '',
  discounts: (e.discounts || []).map((d) => ({ description: d.description, value: toMoneyInput(d.value) })),
  use_table: !e.percentage_overridden, commission_percentage: String(e.commission_percentage).replace('.', ','),
  observations: e.observations || '',
});

/** Mesma conta do servidor: base = frete - descontos; comissão = base x %. */
function calculate(form, link) {
  const freight = toNumber(form.freight_value) || 0;
  const discount = form.discounts.reduce((sum, d) => sum + (toNumber(d.value) || 0), 0);
  const base = Math.max(freight - discount, 0);
  const pct = form.use_table ? (link?.commission_percentage ?? null) : toNumber(form.commission_percentage);
  return { freight, discount, base, pct, commission: pct === null ? null : Math.round(base * pct) / 100 };
}

// Lançamento por representante: rows = { client_id: valor faturado }
const emptyBatch = () => ({
  representative_id: '', period_start: monthPeriod()[0], period_end: monthPeriod()[1],
  rows: {}, advances: [{ value: '', advance_date: '' }],
});
const emptyAdvance = () => ({ representative_id: '', advance_date: today(), value: '', description: '' });

// Saldo negativo de uma baixa anterior, lançado sozinho para a próxima comissão
const isCarried = (a) => a.origin === 'SALDO_NEGATIVO';

export default function CommissionsPage() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState([]);
  const [representatives, setRepresentatives] = useState([]);
  const [links, setLinks] = useState([]);
  const [search, setSearch] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [period, setPeriod] = useState(() => [format(startOfMonth(new Date()), 'yyyy-MM-dd'), format(endOfMonth(new Date()), 'yyyy-MM-dd')]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ payment_date: today(), payment_notes: '' });
  const [cteOpen, setCteOpen] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [cteIds, setCteIds] = useState(() => new Set());
  const [busy, setBusy] = useState('');
  const [advances, setAdvances] = useState([]);
  const [advOpen, setAdvOpen] = useState(false);
  const [advEditingId, setAdvEditingId] = useState(null);
  const [advForm, setAdvForm] = useState(emptyAdvance());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batch, setBatch] = useState(emptyBatch());
  const [batchPendingAdv, setBatchPendingAdv] = useState([]);
  const [payAdvances, setPayAdvances] = useState([]);
  const [payAdvIds, setPayAdvIds] = useState(() => new Set());
  const debounceRef = useRef(null);

  const params = useMemo(() => {
    const p = {};
    if (search.trim()) p.search = search.trim();
    if (repFilter) p.representative_id = repFilter;
    if (statusFilter) p.status = statusFilter;
    if (period[0]) p.start_date = period[0];
    if (period[1]) p.end_date = period[1];
    return p;
  }, [search, repFilter, statusFilter, period]);
  const hasFilters = !!(search || repFilter || statusFilter || period[0] || period[1]);
  const { pageItems, paginationProps } = usePagination(entries, { resetKey: JSON.stringify(params) });

  useEffect(() => {
    api.getClients().then((r) => setClients((r.data || []).filter((c) => c.status !== 'INATIVO'))).catch(() => {});
    api.getRepresentatives().then((r) => setRepresentatives(r.data || [])).catch(() => {});
    api.getClientRepresentativeLinks().then((r) => setLinks((r.data || []).filter((l) => l.status === 'ATIVO'))).catch(() => {});
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadList(); }, 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const loadList = async () => {
    if (period[0] && period[1] && period[0] > period[1]) return;
    setLoading(true);
    try {
      const advParams = { ...params, status: ADVANCE_STATUS[params.status] };
      const [r, a] = await Promise.all([api.getCommissionEntries(params), api.getCommissionAdvances(advParams)]);
      setEntries(r.data || []);
      setAdvances(a.data || []);
      setSelectedIds((prev) => new Set([...prev].filter((id) => (r.data || []).some((e) => e.id === id))));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao carregar as comissões');
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    const pending = entries.filter((e) => e.status === 'PENDENTE');
    const advPending = advances.filter((a) => a.status === 'PENDENTE');
    const byRep = {};
    const repOf = (id, name) => byRep[id] || (byRep[id] = { name, count: 0, freight: 0, commission: 0, pending: 0, advances: 0 });
    entries.forEach((e) => {
      const r = repOf(e.representative_id, e.representative_name);
      r.count += 1;
      r.freight += e.freight_value || 0;
      r.commission += e.commission_value || 0;
      if (e.status === 'PENDENTE') r.pending += e.commission_value || 0;
    });
    advPending.forEach((a) => { repOf(a.representative_id, a.representative_name).advances += a.value; });
    return {
      freight: sumBy(entries, 'freight_value'), discount: sumBy(entries, 'discount_total'),
      pending: sumBy(pending, 'commission_value'), paid: sumBy(entries, 'commission_value') - sumBy(pending, 'commission_value'),
      advances: sumBy(advPending, 'value'),
      byRep: Object.values(byRep).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [entries, advances]);

  const selected = entries.filter((e) => selectedIds.has(e.id));
  const single = selected.length === 1 ? selected[0] : null;
  const selectedPending = selected.filter((e) => e.status === 'PENDENTE');
  const selectedPaid = selected.filter((e) => e.status === 'PAGO');
  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllOnPage = () => setSelectedIds((prev) => {
    const all = pageItems.every((e) => prev.has(e.id));
    const next = new Set(prev);
    pageItems.forEach((e) => (all ? next.delete(e.id) : next.add(e.id)));
    return next;
  });

  // ----- lançamento -----
  const link = links.find((l) => l.client_id === form.client_id) || null;
  const calc = calculate(form, link);
  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const setDiscount = (i, patch) => setForm((prev) => ({ ...prev, discounts: prev.discounts.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));

  const openCreate = () => { setEditingId(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (e) => {
    if (e.status === 'PAGO') { toast.info('Lançamento pago: estorne o pagamento para alterar'); return; }
    setEditingId(e.id); setForm(toForm(e)); setDialogOpen(true);
  };
  const openDuplicate = (e) => {
    setEditingId(null);
    setForm({ ...toForm(e), document_number: '', billing_date: today(), freight_value: '', observations: '' });
    setDialogOpen(true);
  };

  const formIssues = [];
  if (!form.client_id) formIssues.push('Escolha o cliente na lista');
  else if (!link) formIssues.push('Cliente sem representante vinculado (Comercial > Vínculo de Clientes)');
  if (!(calc.freight > 0)) formIssues.push('Informe o valor do frete faturado');
  if (calc.discount > calc.freight) formIssues.push('Os descontos passam do valor do frete');
  if (form.discounts.some((d) => toNumber(d.value) && !(d.description || '').trim())) formIssues.push('Informe a descrição de cada desconto');
  if (!form.use_table && (calc.pct === null || calc.pct < 0 || calc.pct > 100)) formIssues.push('Percentual de comissão entre 0 e 100');
  if (!form.billing_date) formIssues.push('Informe a data do faturamento');
  if (form.period_start && form.period_end && form.period_start > form.period_end) formIssues.push('O início do período não pode ser depois do fim');

  const save = async ({ again = false } = {}) => {
    if (formIssues.length) { toast.error(formIssues[0]); return; }
    setSaving(true);
    try {
      const payload = {
        client_id: form.client_id, document_type: form.document_type, document_number: form.document_number.trim() || null,
        billing_date: form.billing_date, freight_value: calc.freight,
        period_start: form.period_start || null, period_end: form.period_end || null,
        discounts: form.discounts.filter((d) => (d.description || '').trim() || toNumber(d.value))
          .map((d) => ({ description: d.description.trim(), value: toNumber(d.value) || 0 })),
        commission_percentage: form.use_table ? null : calc.pct, observations: form.observations.trim() || null,
      };
      if (editingId) await api.updateCommissionEntry(editingId, payload); else await api.createCommissionEntry(payload);
      toast.success(`Comissão de ${fmtMoney(calc.commission)} ${editingId ? 'atualizada' : 'lançada'} para ${link.representative_name}`);
      loadList();
      if (again) {
        // Próximo frete do mesmo cliente: mantém cliente, tipo e descontos usuais
        setEditingId(null);
        setForm((prev) => ({ ...prev, document_number: '', freight_value: '', observations: '' }));
      } else {
        setDialogOpen(false);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar o lançamento');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (items) => {
    const deletable = items.filter((e) => e.status === 'PENDENTE');
    if (!deletable.length) { toast.info('Lançamentos pagos não podem ser excluídos (estorne antes)'); return; }
    if (!(await confirm(`Excluir ${deletable.length} lançamento(s) de comissão?`))) return;
    for (const e of deletable) {
      try { await api.deleteCommissionEntry(e.id); } catch (err) { toast.error(err.response?.data?.detail || 'Erro ao excluir'); }
    }
    setSelectedIds(new Set());
    loadList();
  };

  // ----- pagamento -----
  const payCommission = sumBy(selectedPending, 'commission_value');
  const payAdvTotal = sumBy(payAdvances.filter((a) => payAdvIds.has(a.id)), 'value');
  // Por representante: o que os adiantamentos passam da comissão vai para a próxima
  const payCarry = [...new Set(selectedPending.map((e) => e.representative_id))].map((id) => {
    const commission = sumBy(selectedPending.filter((e) => e.representative_id === id), 'commission_value');
    const advanced = sumBy(payAdvances.filter((a) => payAdvIds.has(a.id) && a.representative_id === id), 'value');
    return { id, name: selectedPending.find((e) => e.representative_id === id).representative_name, commission, advanced };
  }).filter((r) => r.advanced > r.commission + 0.005);
  const payNet = payCommission - payAdvTotal + sumBy(payCarry.map((r) => ({ v: r.advanced - r.commission })), 'v');
  const openPay = async () => {
    setPayForm({ payment_date: today(), payment_notes: '' });
    setPayAdvances([]);
    setPayAdvIds(new Set());
    setPayOpen(true);
    try {
      const reps = new Set(selectedPending.map((e) => e.representative_id));
      const r = await api.getCommissionAdvances({ status: 'PENDENTE' });
      const list = (r.data || []).filter((a) => reps.has(a.representative_id));
      setPayAdvances(list);
      setPayAdvIds(new Set(list.map((a) => a.id)));
    } catch (e) {
      toast.error('Erro ao buscar os adiantamentos do representante');
    }
  };
  const pay = async () => {
    setBusy('pay');
    try {
      const r = await api.payCommissionEntries({ ids: selectedPending.map((e) => e.id), ...payForm, advance_ids: [...payAdvIds] });
      toast.success(`${r.data.paid} lançamento(s) baixado(s) como pago(s)${r.data.advances_deducted
        ? ` · ${fmtMoney(r.data.advances_deducted)} de adiantamento descontado · líquido ${fmtMoney(r.data.net)}` : ''}`);
      r.data.carried_over.forEach((c) => toast.info(`${c.representative_name}: saldo negativo de ${fmtMoney(c.value)} lançado para descontar na próxima comissão`, { duration: 8000 }));
      setPayOpen(false);
      setSelectedIds(new Set());
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao registrar o pagamento');
    } finally {
      setBusy('');
    }
  };
  const unpay = async () => {
    if (!(await confirm(`Estornar o pagamento de ${selectedPaid.length} lançamento(s)? Eles voltam para pendente.`))) return;
    try {
      const r = await api.unpayCommissionEntries(selectedPaid.map((e) => e.id));
      toast.success(`${r.data.reverted} pagamento(s) estornado(s)${r.data.advances_reverted
        ? ` · ${r.data.advances_reverted} adiantamento(s) voltaram a ficar a descontar` : ''}`);
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao estornar');
    }
  };

  // ----- CT-es -----
  const openCtes = async () => {
    setCteOpen(true);
    setBusy('ctes');
    try {
      const r = await api.getCommissionCteCandidates({ start_date: period[0] || undefined, end_date: period[1] || undefined });
      setCandidates(r.data || []);
      setCteIds(new Set((r.data || []).filter((c) => c.client_id && c.representative_name).map((c) => c.cte_id)));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao buscar os CT-es');
    } finally {
      setBusy('');
    }
  };
  const launchCtes = async () => {
    setBusy('launch');
    try {
      const r = await api.createCommissionFromCtes([...cteIds]);
      if (r.data.created.length) toast.success(`${r.data.created.length} comissão(ões) lançada(s) a partir dos CT-es`);
      r.data.skipped.forEach((s) => toast.warning(`CT-e ${s.numero || ''}: ${s.reason}`));
      setCteOpen(false);
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao lançar as comissões');
    } finally {
      setBusy('');
    }
  };

  const downloadPdf = async () => {
    setBusy('pdf');
    try {
      const r = await api.downloadCommissionStatementPdf(params);
      downloadBlob(r.data, `Prestacao_Contas_Comissao_${period[0] || 'inicio'}_${period[1] || 'hoje'}.pdf`);
    } catch (e) {
      toast.error('Erro ao gerar a prestação de contas');
    } finally {
      setBusy('');
    }
  };

  const selectedCandidates = candidates.filter((c) => cteIds.has(c.cte_id));

  // ----- lançamento por representante -----
  const batchLinks = links.filter((l) => l.representative_id === batch.representative_id)
    .sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''));
  const batchRows = batchLinks.map((l) => {
    const freight = toNumber(batch.rows[l.client_id]) || 0;
    return { link: l, freight, commission: Math.round(freight * l.commission_percentage) / 100 };
  });
  const batchFilled = batchRows.filter((r) => r.freight > 0);
  const batchNewAdv = batch.advances.filter((a) => toNumber(a.value));
  const batchTotals = {
    freight: batchFilled.reduce((s, r) => s + r.freight, 0),
    commission: batchFilled.reduce((s, r) => s + r.commission, 0),
    advances: batchNewAdv.reduce((s, a) => s + (toNumber(a.value) || 0), 0) + sumBy(batchPendingAdv, 'value'),
  };
  const batchIssues = [];
  if (!batch.representative_id) batchIssues.push('Escolha o representante');
  else if (!batchLinks.length) batchIssues.push('Representante sem clientes no Vínculo de Clientes');
  if (!batch.period_start || !batch.period_end) batchIssues.push('Informe o período de pagamento da comissão');
  else if (batch.period_start > batch.period_end) batchIssues.push('O início do período não pode ser depois do fim');
  if (batchNewAdv.some((a) => !(toNumber(a.value) > 0) || !a.advance_date)) batchIssues.push('Informe o dia de cada adiantamento');
  if (batch.representative_id && !batchFilled.length && !batchNewAdv.length) batchIssues.push('Informe o valor faturado de pelo menos um cliente');

  const setBatchAdv = (i, patch) => setBatch((p) => ({ ...p, advances: p.advances.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));
  const openBatch = () => {
    setBatch({ ...emptyBatch(), representative_id: repFilter || '', ...(period[0] && period[1] ? { period_start: period[0], period_end: period[1] } : {}) });
    setBatchOpen(true);
  };
  useEffect(() => {
    setBatchPendingAdv([]);
    if (!batchOpen || !batch.representative_id) return;
    api.getCommissionAdvances({ representative_id: batch.representative_id, status: 'PENDENTE' })
      .then((r) => setBatchPendingAdv(r.data || [])).catch(() => {});
  }, [batchOpen, batch.representative_id]);

  const saveBatch = async () => {
    if (batchIssues.length) { toast.error(batchIssues[0]); return; }
    setBusy('batch');
    try {
      const r = await api.createCommissionBatch({
        // A comissão fecha no fim do período de pagamento
        representative_id: batch.representative_id, billing_date: batch.period_end, document_type: 'FATURA',
        period_start: batch.period_start, period_end: batch.period_end,
        items: batchFilled.map((x) => ({ client_id: x.link.client_id, freight_value: x.freight })),
        advances: batchNewAdv.map((a) => ({ representative_id: batch.representative_id, advance_date: a.advance_date, value: toNumber(a.value) })),
      });
      const { created, advances: adv } = r.data;
      toast.success([created.length && `${created.length} lançamento(s) · comissão de ${fmtMoney(sumBy(created, 'commission_value'))}`,
        adv.length && `${adv.length} adiantamento(s) de ${fmtMoney(sumBy(adv, 'value'))}`].filter(Boolean).join(' · '));
      setBatchOpen(false);
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar o lançamento');
    } finally {
      setBusy('');
    }
  };

  // ----- adiantamentos -----
  const openAdvance = (a = null) => {
    if (a && a.status !== 'PENDENTE') { toast.info('Adiantamento já descontado: estorne o pagamento para alterar'); return; }
    if (a && isCarried(a)) { toast.info('Saldo negativo lançado automaticamente: para desfazer, estorne o pagamento que o gerou'); return; }
    setAdvEditingId(a?.id || null);
    setAdvForm(a ? { representative_id: a.representative_id, advance_date: a.advance_date, value: toMoneyInput(a.value), description: a.description || '' }
      : { ...emptyAdvance(), representative_id: repFilter || '' });
    setAdvOpen(true);
  };
  const saveAdvance = async () => {
    const value = toNumber(advForm.value);
    if (!advForm.representative_id || !advForm.advance_date || !(value > 0)) { toast.error('Informe o representante, a data e o valor'); return; }
    setBusy('advance');
    try {
      const payload = { ...advForm, value, description: advForm.description.trim() || null };
      if (advEditingId) await api.updateCommissionAdvance(advEditingId, payload); else await api.createCommissionAdvance(payload);
      toast.success(`Adiantamento de ${fmtMoney(value)} ${advEditingId ? 'atualizado' : 'lançado'}`);
      setAdvOpen(false);
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar o adiantamento');
    } finally {
      setBusy('');
    }
  };
  const removeAdvance = async (a) => {
    if (a.status !== 'PENDENTE') { toast.info('Adiantamento já descontado: estorne o pagamento antes de excluir'); return; }
    if (!(await confirm(`Excluir o adiantamento de ${fmtMoney(a.value)} de ${a.representative_name}?`))) return;
    try {
      await api.deleteCommissionAdvance(a.id);
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao excluir');
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="commissions-page">
        <PageHeader
          icon={Percent}
          title="Comissão"
          subtitle="Frete faturado por cliente, comissão pelo Vínculo de Clientes e prestação de contas por representante"
          actions={(
            <Button variant="outline" size="sm" onClick={() => navigate('/comercial/vinculo-clientes')}>
              <Percent className="w-4 h-4 mr-1.5" /> Vínculo de Clientes
            </Button>
          )}
        />

        <StatGrid>
          <StatCard label="Frete faturado" value={fmtMoney(totals.freight)} icon={Truck} tone="blue"
            hint={`${entries.length} lançamento(s)${totals.discount ? ` · descontos ${fmtMoney(totals.discount)}` : ''}`} />
          <StatCard label="Comissão a pagar" value={fmtMoney(totals.pending)} icon={Clock} tone="amber" hint={`Paga: ${fmtMoney(totals.paid)}`} />
          <StatCard label="Adiantamentos a descontar" value={fmtMoney(totals.advances)} icon={HandCoins} tone="violet" testId="commission-stat-advances" />
          <StatCard label="Líquido a pagar" value={fmtMoney(totals.pending - totals.advances)} icon={CheckCircle2} tone="primary" testId="commission-stat-net" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setRepFilter(''); setStatusFilter(''); setPeriod(['', '']); }}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Cliente, representante, documento ou observação" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="commission-search" />
            </FilterField>
            <FilterField label="Representante">
              <Select value={repFilter || '_all'} onValueChange={(v) => setRepFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="commission-rep-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {representatives.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Situação">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="commission-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  <SelectItem value="PENDENTE">A pagar</SelectItem>
                  <SelectItem value="PAGO">Pagas</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <PeriodFilterFields value={period} onChange={setPeriod} testIdPrefix="commission" />
          </div>
          {period[0] && period[1] && period[0] > period[1] && <p className="mt-2 text-xs text-red-600">A data inicial não pode ser depois da data final.</p>}
        </FilterCard>

        {(totals.byRep.length > 1 || totals.advances > 0) && (
          <DataCard title="Resumo por representante" count={totals.byRep.length} testId="commission-rep-summary">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Representante</th><th className="!text-right">Lançamentos</th><th className="!text-right">Frete faturado</th><th className="!text-right">Comissão</th>
                    <th className="!text-right">A pagar</th><th className="!text-right">(-) Adiantamentos</th><th className="!text-right">Líquido a pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.byRep.map((r) => (
                    <tr key={r.name}>
                      <td className="cell-strong">{r.name}</td>
                      <td className="text-right tabular-nums">{r.count}</td>
                      <td className="text-right tabular-nums">{fmtMoney(r.freight)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(r.commission)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(r.pending)}</td>
                      <td className="text-right tabular-nums">{r.advances ? fmtMoney(r.advances) : '-'}</td>
                      <td className={`text-right tabular-nums font-semibold ${r.pending - r.advances < 0 ? 'text-red-600' : ''}`}>{fmtMoney(r.pending - r.advances)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataCard>
        )}

        <DataCard
          title="Lançamentos de comissão"
          count={loading ? '...' : entries.length}
          footer={<TablePagination {...paginationProps} />}
          toolbar={(
            <Toolbar selectedCount={selectedIds.size} primary={<ToolbarPrimary icon={Plus} label="Novo lançamento" onClick={openBatch} testId="commission-batch-btn" />}>
              <ToolbarButton icon={Users} label="Lançamento avulso (um cliente, com descontos)" tone="violet" onClick={openCreate} testId="commission-new-btn" />
              <ToolbarButton icon={FileCheck} label="Lançar de CT-es" tone="violet" onClick={openCtes} testId="commission-from-ctes-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => openEdit(single)} disabled={!single || single.status !== 'PENDENTE'} testId="commission-edit-btn" />
              <ToolbarButton icon={Plus} label="Duplicar" tone="blue" onClick={() => openDuplicate(single)} disabled={!single} testId="commission-duplicate-btn" />
              <ToolbarButton icon={Wallet} label={`Baixar pagamento${selectedPending.length ? ` (${selectedPending.length})` : ''}`} tone="emerald"
                onClick={openPay} disabled={!selectedPending.length} testId="commission-pay-btn" />
              <ToolbarButton icon={RotateCcw} label="Estornar pagamento" tone="slate" onClick={unpay} disabled={!selectedPaid.length} testId="commission-unpay-btn" />
              <ToolbarButton icon={FileDown} label="Prestação de contas (PDF)" tone="red" onClick={downloadPdf} disabled={!entries.length || !!busy} testId="commission-pdf-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => remove(selected)} disabled={!selectedPending.length} testId="commission-delete-btn" />
            </Toolbar>
          )}
        >
          {loading && !entries.length ? (
            <EmptyState loading />
          ) : entries.length === 0 ? (
            <EmptyState icon={Percent} title="Nenhum lançamento de comissão" hint="Use Novo lançamento ou Lançar de CT-es (os filtros de período também valem aqui)" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0"><Checkbox checked={pageItems.length > 0 && pageItems.every((e) => selectedIds.has(e.id))} onCheckedChange={toggleAllOnPage} /></th>
                    <th>Data / Período</th>
                    <th>Situação</th>
                    <th>Documento</th>
                    <th>Cliente</th>
                    <th>Representante</th>
                    <th className="!text-right">Frete</th>
                    <th className="!text-right">Descontos</th>
                    <th className="!text-right">Base</th>
                    <th className="!text-right">%</th>
                    <th className="!text-right">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((e) => (
                    <tr key={e.id} onClick={() => toggleSelect(e.id)} onDoubleClick={() => openEdit(e)} data-selected={selectedIds.has(e.id)}
                      className="cursor-pointer" data-testid={`commission-row-${e.id}`}>
                      <td className="pr-0" onClick={(ev) => ev.stopPropagation()}><Checkbox checked={selectedIds.has(e.id)} onCheckedChange={() => toggleSelect(e.id)} /></td>
                      <td className="whitespace-nowrap tabular-nums">
                        <div>{fmtDate(e.billing_date)}</div>
                        {(e.period_start || e.period_end) && <div className="text-[11px] text-slate-500" title="Período referente">{fmtPeriod(e.period_start, e.period_end)}</div>}
                      </td>
                      <td className="whitespace-nowrap">
                        {e.status === 'PAGO'
                          ? <StatusPill tone="emerald" title={`Paga em ${fmtDate(e.payment_date)}${e.payment_notes ? ` · ${e.payment_notes}` : ''}`}>Paga</StatusPill>
                          : <StatusPill tone="amber">A pagar</StatusPill>}
                      </td>
                      <td className="whitespace-nowrap">{DOC_LABELS[e.document_type] || ''} {e.document_number || ''}</td>
                      <td>
                        <div className="max-w-[190px] truncate cell-strong" title={e.client_name}>{e.client_name}</div>
                        {e.observations && <div className="max-w-[190px] truncate text-[11px] text-slate-500" title={e.observations}>{e.observations}</div>}
                      </td>
                      <td><div className="max-w-[140px] truncate" title={e.representative_name}>{e.representative_name}</div></td>
                      <td className="text-right tabular-nums">{fmtMoney(e.freight_value)}</td>
                      <td className="text-right tabular-nums" title={(e.discounts || []).map((d) => `${d.description}: ${fmtMoney(d.value)}`).join('\n')}>
                        {e.discount_total ? fmtMoney(e.discount_total) : '-'}
                      </td>
                      <td className="text-right tabular-nums">{fmtMoney(e.calculation_base)}</td>
                      <td className="text-right tabular-nums" title={e.percentage_overridden ? `Ajustado no lançamento (vínculo: ${fmtPct(e.table_percentage)})` : 'Do Vínculo de Clientes'}>
                        {fmtPct(e.commission_percentage)}{e.percentage_overridden && <span className="text-amber-600">*</span>}
                      </td>
                      <td className="text-right tabular-nums font-semibold">{fmtMoney(e.commission_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        <DataCard
          title="Adiantamentos"
          count={advances.length}
          meta={<span className="text-[11px] text-slate-500">descontados da comissão na baixa do pagamento</span>}
          testId="commission-advances"
          toolbar={<Toolbar primary={<ToolbarPrimary icon={Plus} label="Novo adiantamento" onClick={() => openAdvance()} testId="commission-advance-new-btn" />} />}
        >
          {advances.length === 0 ? (
            <EmptyState icon={HandCoins} title="Nenhum adiantamento" hint="Valores adiantados ao representante, com a data, para descontar no total da comissão" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Data</th><th>Situação</th><th>Representante</th><th>Descrição</th><th className="!text-right">Valor</th><th className="w-20" /></tr>
                </thead>
                <tbody>
                  {advances.map((a) => (
                    <tr key={a.id} onDoubleClick={() => openAdvance(a)} data-testid={`commission-advance-${a.id}`}>
                      <td className="whitespace-nowrap tabular-nums">{fmtDate(a.advance_date)}</td>
                      <td className="whitespace-nowrap">
                        {a.status === 'DESCONTADO'
                          ? <StatusPill tone="emerald" title={`Descontado na baixa de ${fmtDate(a.deducted_on)}`}>Descontado</StatusPill>
                          : <StatusPill tone="violet">A descontar</StatusPill>}
                        {isCarried(a) && <StatusPill tone="amber" className="ml-1" title="Lançado sozinho na baixa em que os adiantamentos passaram da comissão">Saldo anterior</StatusPill>}
                      </td>
                      <td className="cell-strong">{a.representative_name}</td>
                      <td><div className="max-w-[420px] whitespace-normal text-[13px]">{a.description || '-'}</div></td>
                      <td className="text-right tabular-nums font-semibold">{fmtMoney(a.value)}</td>
                      <td className="text-right whitespace-nowrap">
                        {a.status === 'PENDENTE' && !isCarried(a) && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editar" onClick={() => openAdvance(a)}><Edit className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-red-600" aria-label="Excluir" onClick={() => removeAdvance(a)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      {/* Lançamento */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="commission-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Percent className="w-5 h-5 text-primary" />{editingId ? 'Editar lançamento de comissão' : 'Novo lançamento de comissão'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <Field label="Cliente" required className="md:col-span-7">
                <Autocomplete value={form.client_name} options={clients} displayField="name"
                  onChange={(t) => setForm((p) => ({ ...p, client_name: t, client_id: null }))}
                  onSelect={(c) => setForm((p) => ({ ...p, client_name: c.name, client_id: c.id }))} testId="commission-client" />
              </Field>
              <Field label="Data do faturamento" required className="md:col-span-5">
                <Input type="date" value={form.billing_date} onChange={(e) => set('billing_date', e.target.value)} data-testid="commission-date" />
              </Field>
            </div>
            {form.client_id && (
              link ? (
                <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="commission-link">
                  Representante: <b>{link.representative_name}</b> · comissão de <b>{fmtPct(link.commission_percentage)}</b> no Vínculo de Clientes
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-300" data-testid="commission-no-link">
                  <AlertTriangle className="w-4 h-4" /> Cliente sem representante vinculado.
                  <button type="button" className="underline" onClick={() => navigate('/comercial/vinculo-clientes')}>Vincular</button>
                </p>
              )
            )}
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
              <Field label="Documento" className="md:col-span-3">
                <Select value={form.document_type} onValueChange={(v) => set('document_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DOCUMENT_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Número" className="md:col-span-4">
                <Input value={form.document_number} maxLength={30} onChange={(e) => set('document_number', e.target.value)} data-testid="commission-doc-number" />
              </Field>
              <Field label="Frete faturado (R$)" required className="col-span-2 md:col-span-5">
                <Input inputMode="decimal" value={form.freight_value} onChange={(e) => set('freight_value', moneyMask(e.target.value))} className="text-right font-semibold" data-testid="commission-freight" />
              </Field>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
              <Field label="Período referente: de" className="md:col-span-4">
                <Input type="date" value={form.period_start} onChange={(e) => set('period_start', e.target.value)} data-testid="commission-period-start" />
              </Field>
              <Field label="até" className="md:col-span-4">
                <Input type="date" value={form.period_end} onChange={(e) => set('period_end', e.target.value)} data-testid="commission-period-end" />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Descontos <span className="text-xs font-normal text-slate-500">(saem da base da comissão)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {DISCOUNT_PRESETS.filter((p) => !form.discounts.some((d) => d.description === p)).map((p) => (
                    <Button key={p} type="button" variant="outline" size="sm" onClick={() => setForm((prev) => ({ ...prev, discounts: [...prev.discounts, { description: p, value: '' }] }))}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> {p}
                    </Button>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm((prev) => ({ ...prev, discounts: [...prev.discounts, { description: '', value: '' }] }))} data-testid="commission-add-discount">
                    <Plus className="w-3.5 h-3.5 mr-1" /> Outro
                  </Button>
                </div>
              </div>
              {form.discounts.map((d, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={d.description} placeholder="Descrição" maxLength={60} onChange={(e) => setDiscount(i, { description: e.target.value })} className="flex-1" aria-label="Descrição do desconto" />
                  <Input inputMode="decimal" value={d.value} placeholder="0,00" onChange={(e) => setDiscount(i, { value: moneyMask(e.target.value) })} className="w-36 text-right" aria-label="Valor do desconto" data-testid={`commission-discount-${i}`} />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:text-red-600" aria-label="Remover"
                    onClick={() => setForm((prev) => ({ ...prev, discounts: prev.discounts.filter((_, j) => j !== i) }))}><X className="w-4 h-4" /></Button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-7 space-y-1.5">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form.use_table} onCheckedChange={(c) => setForm((p) => ({ ...p, use_table: !!c, commission_percentage: c ? '' : String(link?.commission_percentage ?? '').replace('.', ',') }))} data-testid="commission-use-table" />
                  Usar o percentual do Vínculo de Clientes
                </label>
                {!form.use_table && (
                  <div className="flex items-center gap-2">
                    <Input inputMode="decimal" value={form.commission_percentage} onChange={(e) => set('commission_percentage', moneyMask(e.target.value))} className="w-28 text-right" data-testid="commission-pct" />
                    <span className="text-sm text-slate-500">% (ajustado só neste lançamento)</span>
                  </div>
                )}
              </div>
              <dl className="md:col-span-5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-sm space-y-1" data-testid="commission-calc">
                <div className="flex justify-between"><dt className="text-slate-500">Frete</dt><dd className="tabular-nums">{fmtMoney(calc.freight)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">(-) Descontos</dt><dd className="tabular-nums">{fmtMoney(calc.discount)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Base de cálculo</dt><dd className="tabular-nums">{fmtMoney(calc.base)}</dd></div>
                <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1 font-semibold">
                  <dt>Comissão {calc.pct !== null && `(${fmtPct(calc.pct)})`}</dt>
                  <dd className="tabular-nums text-primary" data-testid="commission-value">{calc.commission === null ? '-' : fmtMoney(calc.commission)}</dd>
                </div>
              </dl>
            </div>

            <Field label="Observações">
              <Textarea value={form.observations} rows={2} maxLength={1000} onChange={(e) => set('observations', e.target.value)} />
            </Field>
            {formIssues.length > 0 && (form.client_id || form.freight_value) && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="w-3.5 h-3.5" /> {formIssues[0]}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Fechar</Button>
            {!editingId && (
              <Button variant="outline" onClick={() => save({ again: true })} disabled={saving} data-testid="commission-save-again">Salvar e lançar outro</Button>
            )}
            <Button onClick={() => save()} disabled={saving} data-testid="commission-save">
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Baixa do pagamento */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md" data-testid="commission-pay-dialog">
          <DialogHeader><DialogTitle>Baixar pagamento da comissão</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {selectedPending.length} lançamento(s) · comissão de <b>{fmtMoney(payCommission)}</b>
              {new Set(selectedPending.map((e) => e.representative_id)).size > 1 && <span className="block text-xs text-amber-700 dark:text-amber-300">Atenção: mais de um representante selecionado.</span>}
            </p>
            {payAdvances.length > 0 && (
              <div className="space-y-1.5" data-testid="commission-pay-advances">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Descontos (adiantamentos e saldo anterior)</p>
                {payAdvances.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={payAdvIds.has(a.id)} onCheckedChange={() => setPayAdvIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                      return next;
                    })} />
                    <span className="tabular-nums">{fmtDate(a.advance_date)}</span>
                    <span className="flex-1 truncate text-slate-500" title={a.description || ''}>{isCarried(a) ? 'Saldo negativo anterior' : (a.description || 'Adiantamento')}</span>
                    <span className="tabular-nums font-medium">{fmtMoney(a.value)}</span>
                  </label>
                ))}
                <dl className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-sm space-y-1">
                  <div className="flex justify-between"><dt className="text-slate-500">Comissão</dt><dd className="tabular-nums">{fmtMoney(payCommission)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">(-) Descontos</dt><dd className="tabular-nums">{fmtMoney(payAdvTotal)}</dd></div>
                  <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1 font-semibold">
                    <dt>Líquido a pagar</dt><dd className="tabular-nums text-primary" data-testid="commission-pay-net">{fmtMoney(payNet)}</dd>
                  </div>
                </dl>
                {payCarry.map((r) => (
                  <p key={r.id} className="flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300" data-testid="commission-pay-carry">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Saldo negativo{payCarry.length > 1 ? ` de ${r.name}` : ''}: os descontos ({fmtMoney(r.advanced)}) passam da comissão ({fmtMoney(r.commission)}).
                      A baixa fecha com líquido zero e <b>{fmtMoney(r.advanced - r.commission)}</b> serão descontados automaticamente na próxima comissão.</span>
                  </p>
                ))}
              </div>
            )}
            <Field label="Data do pagamento" required>
              <Input type="date" value={payForm.payment_date} onChange={(e) => setPayForm((p) => ({ ...p, payment_date: e.target.value }))} data-testid="commission-pay-date" />
            </Field>
            <Field label="Observação do pagamento" hint="Ex.: PIX, nº do comprovante, recibo">
              <Input value={payForm.payment_notes} maxLength={200} onChange={(e) => setPayForm((p) => ({ ...p, payment_notes: e.target.value }))} />
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button>
            <Button onClick={pay} disabled={!payForm.payment_date || busy === 'pay'} data-testid="commission-pay-confirm">
              {busy === 'pay' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Wallet className="w-4 h-4 mr-1.5" />} Confirmar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lançar a partir dos CT-es */}
      <Dialog open={cteOpen} onOpenChange={setCteOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="commission-cte-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileCheck className="w-5 h-5 text-primary" />Lançar comissão a partir dos CT-es</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">
            CT-es autorizados {period[0] || period[1] ? `de ${fmtDate(period[0])} a ${fmtDate(period[1])} ` : ''}que ainda não têm comissão.
            O frete é o total da prestação e o cliente é quem paga o frete.
          </p>
          {busy === 'ctes' ? <EmptyState loading /> : candidates.length === 0 ? (
            <EmptyState icon={FileCheck} title="Nenhum CT-e para lançar" hint="Todos os CT-es autorizados do período já têm comissão" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0"><Checkbox
                      checked={candidates.filter((c) => c.client_id && c.representative_name).every((c) => cteIds.has(c.cte_id))}
                      onCheckedChange={(v) => setCteIds(v ? new Set(candidates.filter((c) => c.client_id && c.representative_name).map((c) => c.cte_id)) : new Set())} /></th>
                    <th>CT-e</th><th>Data</th><th>Pagador do frete</th><th>Representante</th><th className="!text-right">Frete</th><th className="!text-right">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const ok = c.client_id && c.representative_name;
                    return (
                      <tr key={c.cte_id} data-testid={`commission-cte-${c.cte_id}`} className={ok ? '' : 'opacity-70'}>
                        <td className="pr-0"><Checkbox disabled={!ok} checked={cteIds.has(c.cte_id)} onCheckedChange={() => setCteIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.cte_id)) next.delete(c.cte_id); else next.add(c.cte_id);
                          return next;
                        })} /></td>
                        <td className="cell-strong tabular-nums">{c.numero || '-'}</td>
                        <td className="tabular-nums">{fmtDate(c.billing_date)}</td>
                        <td><div className="max-w-[220px] truncate" title={c.client_name || c.payer_name}>{c.client_name || c.payer_name || '-'}</div>
                          {!c.client_id && <div className="text-[11px] text-amber-600">não está no cadastro de clientes</div>}</td>
                        <td>{c.representative_name || (c.client_id ? <span className="text-[11px] text-amber-600">sem vínculo</span> : '-')}</td>
                        <td className="text-right tabular-nums">{fmtMoney(c.freight_value)}</td>
                        <td className="text-right tabular-nums">{ok ? `${fmtMoney(Math.round((c.freight_value || 0) * c.commission_percentage) / 100)} (${fmtPct(c.commission_percentage)})` : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCteOpen(false)}>Fechar</Button>
            <Button onClick={launchCtes} disabled={!cteIds.size || busy === 'launch'} data-testid="commission-cte-launch">
              {busy === 'launch' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Lançar {selectedCandidates.length} comissão(ões)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Lançamento por representante */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="commission-batch-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Percent className="w-5 h-5 text-primary" />Lançamento de comissão</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
              <Field label="Representante" required className="col-span-2 md:col-span-6">
                <Select value={batch.representative_id || undefined} onValueChange={(v) => setBatch((p) => ({ ...p, representative_id: v, rows: {} }))}>
                  <SelectTrigger data-testid="commission-batch-rep"><SelectValue placeholder="Escolha o representante" /></SelectTrigger>
                  <SelectContent>
                    {representatives.filter((r) => r.status !== 'INATIVO' || r.id === batch.representative_id)
                      .map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Período de pagamento da comissão" required className="col-span-2 md:col-span-6">
                <div className="flex items-center gap-2">
                  <Input type="date" value={batch.period_start} onChange={(e) => setBatch((p) => ({ ...p, period_start: e.target.value }))} aria-label="Período de pagamento: início" data-testid="commission-batch-period-start" />
                  <span className="text-sm text-slate-500">a</span>
                  <Input type="date" value={batch.period_end} onChange={(e) => setBatch((p) => ({ ...p, period_end: e.target.value }))} aria-label="Período de pagamento: fim" data-testid="commission-batch-period-end" />
                </div>
              </Field>
            </div>

            {batch.representative_id && (
              batchLinks.length === 0 ? (
                <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4" /> Nenhum cliente vinculado a este representante.
                  <button type="button" className="underline" onClick={() => navigate('/comercial/vinculo-clientes')}>Vincular</button>
                </p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Clientes</p>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="data-table">
                      <thead>
                        <tr><th>Cliente</th><th className="!text-right">Valor faturado (R$)</th><th className="!text-right">Percentual</th><th className="!text-right">Comissão</th></tr>
                      </thead>
                      <tbody>
                        {batchRows.map(({ link: l, commission, freight }) => (
                          <tr key={l.client_id} data-testid={`commission-batch-row-${l.client_id}`}>
                            <td><div className="max-w-[260px] truncate cell-strong" title={l.client_name}>{l.client_name}</div></td>
                            <td><Input inputMode="decimal" value={batch.rows[l.client_id] || ''} placeholder="0,00" className="h-8 w-36 ml-auto text-right font-semibold" aria-label={`Valor faturado de ${l.client_name}`}
                              onChange={(e) => { const v = moneyMask(e.target.value); setBatch((p) => ({ ...p, rows: { ...p.rows, [l.client_id]: v } })); }}
                              data-testid={`commission-batch-freight-${l.client_id}`} /></td>
                            <td className="text-right tabular-nums" title="Cadastrado no Vínculo de Clientes">{fmtPct(l.commission_percentage)}</td>
                            <td className="text-right tabular-nums font-semibold">{freight > 0 ? fmtMoney(commission) : '-'}</td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <td>Total</td>
                          <td className="text-right tabular-nums">{fmtMoney(batchTotals.freight)}</td>
                          <td />
                          <td className="text-right tabular-nums" data-testid="commission-batch-total">{fmtMoney(batchTotals.commission)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}

            {batch.representative_id && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Adiantamento <span className="text-xs font-normal text-slate-500">(se houver; é descontado do total da comissão)</span></p>
                {batch.advances.map((a, i) => (
                  <div key={i} className="grid grid-cols-12 gap-3 items-end">
                    <Field label="Valor do adiantamento (R$)" className="col-span-6 md:col-span-4">
                      <Input inputMode="decimal" value={a.value} placeholder="0,00" className="text-right"
                        onChange={(e) => { const v = moneyMask(e.target.value); setBatchAdv(i, { value: v, advance_date: a.advance_date || (v ? today() : '') }); }}
                        data-testid={`commission-batch-advance-${i}`} />
                    </Field>
                    <Field label="Dia do adiantamento" className="col-span-5 md:col-span-4">
                      <Input type="date" value={a.advance_date} onChange={(e) => setBatchAdv(i, { advance_date: e.target.value })} data-testid={`commission-batch-advance-date-${i}`} />
                    </Field>
                    {batch.advances.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="col-span-1 h-9 w-9 text-slate-400 hover:text-red-600" aria-label="Remover adiantamento"
                        onClick={() => setBatch((p) => ({ ...p, advances: p.advances.filter((_, j) => j !== i) }))}><X className="w-4 h-4" /></Button>
                    )}
                  </div>
                ))}
                <button type="button" className="text-xs font-medium text-primary hover:underline" data-testid="commission-batch-add-advance"
                  onClick={() => setBatch((p) => ({ ...p, advances: [...p.advances, { value: '', advance_date: '' }] }))}>
                  + Outro adiantamento
                </button>
                {batchPendingAdv.length > 0 && (
                  <p className="text-xs text-slate-500" data-testid="commission-batch-pending-adv">
                    Também serão descontados:{' '}
                    {batchPendingAdv.map((a) => (isCarried(a) ? `saldo negativo anterior ${fmtMoney(a.value)} (${a.description})`
                      : `adiantamento de ${fmtDate(a.advance_date)} ${fmtMoney(a.value)}`)).join(' · ')}
                  </p>
                )}
              </div>
            )}

            {batch.representative_id && (
              <dl className="ml-auto max-w-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-sm space-y-1" data-testid="commission-batch-calc">
                <div className="flex justify-between"><dt className="text-slate-500">Total da comissão</dt><dd className="tabular-nums">{fmtMoney(batchTotals.commission)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">(-) Adiantamento{batchPendingAdv.some(isCarried) ? ' e saldo anterior' : ''}</dt><dd className="tabular-nums">{fmtMoney(batchTotals.advances)}</dd></div>
                <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1 font-semibold">
                  <dt>Líquido a pagar</dt>
                  <dd className={`tabular-nums ${batchTotals.commission - batchTotals.advances < 0 ? 'text-red-600' : 'text-primary'}`} data-testid="commission-batch-net">{fmtMoney(batchTotals.commission - batchTotals.advances)}</dd>
                </div>
              </dl>
            )}
            {batchIssues.length > 0 && batch.representative_id && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="w-3.5 h-3.5" /> {batchIssues[0]}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBatchOpen(false)}>Fechar</Button>
            <Button onClick={saveBatch} disabled={busy === 'batch'} data-testid="commission-batch-save">
              {busy === 'batch' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adiantamento */}
      <Dialog open={advOpen} onOpenChange={setAdvOpen}>
        <DialogContent className="max-w-md" data-testid="commission-advance-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><HandCoins className="w-5 h-5 text-primary" />{advEditingId ? 'Editar adiantamento' : 'Novo adiantamento'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Representante" required>
              <Select value={advForm.representative_id || undefined} onValueChange={(v) => setAdvForm((p) => ({ ...p, representative_id: v }))}>
                <SelectTrigger data-testid="commission-advance-rep"><SelectValue placeholder="Escolha o representante" /></SelectTrigger>
                <SelectContent>{representatives.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data" required>
                <Input type="date" value={advForm.advance_date} onChange={(e) => setAdvForm((p) => ({ ...p, advance_date: e.target.value }))} data-testid="commission-advance-date" />
              </Field>
              <Field label="Valor (R$)" required>
                <Input inputMode="decimal" value={advForm.value} onChange={(e) => setAdvForm((p) => ({ ...p, value: moneyMask(e.target.value) }))} className="text-right font-semibold" data-testid="commission-advance-value" />
              </Field>
            </div>
            <Field label="Descrição" hint="Ex.: PIX, vale, nº do recibo">
              <Input value={advForm.description} maxLength={100} onChange={(e) => setAdvForm((p) => ({ ...p, description: e.target.value }))} />
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAdvOpen(false)}>Cancelar</Button>
            <Button onClick={saveAdvance} disabled={busy === 'advance'} data-testid="commission-advance-save">
              {busy === 'advance' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
