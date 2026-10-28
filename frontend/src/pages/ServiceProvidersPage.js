import { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, PeriodFilterFields, SearchInput, DataCard, Toolbar, ToolbarButton,
  ToolbarPrimary, ToolbarDivider, StatusPill, EmptyState, TablePagination, usePagination,
} from '../components/DataPage';
import { Field } from '../components/FormKit';
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
  AlertTriangle, Ban, CheckCircle2, ClipboardList, Clock, Edit, Eye, FileDown, HandCoins, HardHat, Loader2, Plus,
  Receipt, RotateCcw, Trash2, Users, Wallet, X,
} from 'lucide-react';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (v) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '-');
const fmtQty = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const toNumber = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const toMoneyInput = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
const moneyMask = (v) => v.replace(/[^\d,.]/g, '');
const today = () => format(new Date(), 'yyyy-MM-dd');
const monthPeriod = () => [format(startOfMonth(new Date()), 'yyyy-MM-dd'), format(endOfMonth(new Date()), 'yyyy-MM-dd')];
const sumBy = (items, key) => items.reduce((s, x) => s + (x[key] || 0), 0);
const round2 = (v) => Math.round(v * 100) / 100;

const UNITS = [['DIARIA', 'Diária'], ['HORA', 'Hora'], ['SERVICO', 'Serviço'], ['MES', 'Mês']];
const UNIT_LABELS = Object.fromEntries(UNITS);
const UNIT_PLURALS = { DIARIA: 'diárias', HORA: 'horas', SERVICO: 'serviços', MES: 'meses' };
// Ex.: 1 diária, 2,5 diárias
const fmtUnits = (qty, unit) => `${fmtQty(qty)} ${Number(qty) > 1 ? UNIT_PLURALS[unit] || '' : (UNIT_LABELS[unit] || '').toLowerCase()}`;
const PAYMENT_METHODS = ['PIX', 'Dinheiro', 'Transferência', 'Cheque'];
const TABS = [
  ['closings', 'Fechamentos', Receipt], ['entries', 'Serviços / Diárias', ClipboardList],
  ['advances', 'Vales', HandCoins], ['providers', 'Prestadores', Users],
];
// Saldo negativo de um fechamento anterior, lançado sozinho como vale
const isCarried = (a) => a.origin === 'SALDO_NEGATIVO';

const emptyProvider = () => ({
  name: '', document: '', role: '', payment_unit: 'DIARIA', default_rate: '', phone: '', pix_key: '', bank_info: '', status: 'ATIVO', observations: '',
});
const emptyEntry = () => ({ provider_id: '', date: today(), description: '', quantity: '1', unit: '', unit_value: '' });
const emptyAdvance = () => ({ provider_id: '', date: today(), value: '', description: '' });
const emptyClosing = () => ({
  provider_id: '', period_start: monthPeriod()[0], period_end: monthPeriod()[1], entry_ids: new Set(), new_entries: [],
  advance_ids: new Set(), new_advances: [{ value: '', date: '', description: '' }], discounts: [], observations: '',
});

export default function ServiceProvidersPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [tab, setTab] = useState('closings');
  const [providers, setProviders] = useState([]);
  const [roles, setRoles] = useState([]);
  const [closings, setClosings] = useState([]);
  const [entries, setEntries] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [period, setPeriod] = useState(monthPeriod);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState('');
  const debounceRef = useRef(null);

  const [providerOpen, setProviderOpen] = useState(false);
  const [providerForm, setProviderForm] = useState(emptyProvider());
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState(emptyEntry());
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceForm, setAdvanceForm] = useState(emptyAdvance());
  const [editingId, setEditingId] = useState(null);
  const [closingOpen, setClosingOpen] = useState(false);
  const [closing, setClosing] = useState(emptyClosing());
  const [openEntries, setOpenEntries] = useState([]);
  const [pendingAdvances, setPendingAdvances] = useState([]);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ payment_date: today(), payment_method: 'PIX', payment_notes: '' });
  const [detail, setDetail] = useState(null);

  const params = useMemo(() => {
    const p = {};
    if (search.trim()) p.search = search.trim();
    if (providerFilter) p.provider_id = providerFilter;
    if (period[0]) p.start_date = period[0];
    if (period[1]) p.end_date = period[1];
    return p;
  }, [search, providerFilter, period]);
  const hasFilters = !!(search || providerFilter || statusFilter || period[0] || period[1]);

  const loadProviders = () => {
    api.getServiceProviders().then((r) => setProviders(r.data || [])).catch(() => {});
    api.getServiceProviderRoles().then((r) => setRoles(r.data || [])).catch(() => {});
  };
  useEffect(loadProviders, []);

  const loadLists = async () => {
    if (period[0] && period[1] && period[0] > period[1]) return;
    setLoading(true);
    try {
      const [c, e, a] = await Promise.all([
        api.getServiceProviderClosings({ ...params, status: statusFilter || undefined }),
        api.getServiceProviderEntries(params), api.getServiceProviderAdvances(params),
      ]);
      setClosings(c.data || []);
      setEntries(e.data || []);
      setAdvances(a.data || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao carregar os prestadores de serviço');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(loadLists, 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, statusFilter]);
  useEffect(() => { setSelectedId(null); }, [tab]);

  const reload = () => { loadLists(); loadProviders(); };
  const providerById = useMemo(() => Object.fromEntries(providers.map((p) => [p.id, p])), [providers]);
  const activeProviders = providers.filter((p) => p.status !== 'INATIVO');
  const shownProviders = providers.filter((p) => (!providerFilter || p.id === providerFilter)
    && (!search.trim() || `${p.name} ${p.role} ${p.document || ''}`.toLowerCase().includes(search.trim().toLowerCase())));

  const rows = { closings, entries, advances, providers: shownProviders }[tab];
  const { pageItems, paginationProps } = usePagination(rows, { resetKey: `${tab}${JSON.stringify(params)}${statusFilter}` });
  const selected = rows.find((x) => x.id === selectedId) || null;

  const totals = {
    open: sumBy(entries.filter((e) => e.status === 'ABERTO'), 'total'),
    toPay: sumBy(closings.filter((c) => c.status === 'FECHADO'), 'net_total'),
    paid: sumBy(closings.filter((c) => c.status === 'PAGO'), 'net_total'),
    advances: sumBy(advances.filter((a) => a.status === 'PENDENTE'), 'value'),
  };

  const run = async (key, fn, success) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      return true;
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Não foi possível concluir');
      return false;
    } finally {
      setBusy('');
    }
  };

  // ----- prestadores -----
  const openProvider = (p = null) => {
    setEditingId(p?.id || null);
    setProviderForm(p ? { ...emptyProvider(), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ''])), default_rate: toMoneyInput(p.default_rate) } : emptyProvider());
    setProviderOpen(true);
  };
  const saveProvider = async () => {
    if (!providerForm.name.trim() || !providerForm.role.trim()) { toast.error('Informe o nome e a função'); return; }
    const payload = { ...providerForm, default_rate: toNumber(providerForm.default_rate) };
    const ok = await run('provider', () => (editingId ? api.updateServiceProvider(editingId, payload) : api.createServiceProvider(payload)),
      `Prestador ${editingId ? 'atualizado' : 'cadastrado'}`);
    if (ok) { setProviderOpen(false); reload(); }
  };

  // ----- serviços -----
  const entryProvider = providerById[entryForm.provider_id];
  const entryTotal = round2((toNumber(entryForm.quantity) || 0) * (toNumber(entryForm.unit_value) || 0));
  const openEntry = (e = null) => {
    if (e && e.status !== 'ABERTO') { toast.info('Serviço já fechado: cancele o fechamento para alterar'); return; }
    setEditingId(e?.id || null);
    setEntryForm(e ? { provider_id: e.provider_id, date: e.date, description: e.description || '', quantity: String(e.quantity).replace('.', ','), unit: e.unit, unit_value: toMoneyInput(e.unit_value) }
      : { ...emptyEntry(), provider_id: providerFilter || '' });
    setEntryOpen(true);
  };
  const pickEntryProvider = (id) => {
    const p = providerById[id];
    setEntryForm((f) => ({ ...f, provider_id: id, unit: p?.payment_unit || 'DIARIA', unit_value: f.unit_value || toMoneyInput(p?.default_rate) }));
  };
  const saveEntry = async () => {
    if (!entryForm.provider_id || !(entryTotal > 0)) { toast.error('Informe o prestador, a quantidade e o valor'); return; }
    const payload = { ...entryForm, quantity: toNumber(entryForm.quantity), unit_value: toNumber(entryForm.unit_value), unit: entryForm.unit || null };
    const ok = await run('entry', () => (editingId ? api.updateServiceProviderEntry(editingId, payload) : api.createServiceProviderEntry(payload)),
      `Serviço de ${fmtMoney(entryTotal)} ${editingId ? 'atualizado' : 'lançado'}`);
    if (ok) { setEntryOpen(false); loadLists(); }
  };

  // ----- vales -----
  const openAdvance = (a = null) => {
    if (a && a.status !== 'PENDENTE') { toast.info('Vale já descontado: cancele o fechamento para alterar'); return; }
    if (a && isCarried(a)) { toast.info('Saldo negativo lançado automaticamente: para desfazer, cancele o fechamento que o gerou'); return; }
    setEditingId(a?.id || null);
    setAdvanceForm(a ? { provider_id: a.provider_id, date: a.date, value: toMoneyInput(a.value), description: a.description || '' }
      : { ...emptyAdvance(), provider_id: providerFilter || '' });
    setAdvanceOpen(true);
  };
  const saveAdvance = async () => {
    const value = toNumber(advanceForm.value);
    if (!advanceForm.provider_id || !advanceForm.date || !(value > 0)) { toast.error('Informe o prestador, o dia e o valor'); return; }
    const payload = { ...advanceForm, value };
    const ok = await run('advance', () => (editingId ? api.updateServiceProviderAdvance(editingId, payload) : api.createServiceProviderAdvance(payload)),
      `Vale de ${fmtMoney(value)} ${editingId ? 'atualizado' : 'lançado'}`);
    if (ok) { setAdvanceOpen(false); loadLists(); }
  };

  const removeSelected = async () => {
    if (!selected) return;
    const what = { entries: ['serviço', api.deleteServiceProviderEntry], advances: ['vale', api.deleteServiceProviderAdvance], providers: ['prestador', api.deleteServiceProvider] }[tab];
    if (!(await confirm(`Excluir este ${what[0]}?`))) return;
    if (await run('delete', () => what[1](selected.id), `${what[0][0].toUpperCase()}${what[0].slice(1)} excluído`)) { setSelectedId(null); reload(); }
  };

  // ----- fechamento -----
  const closingProvider = providerById[closing.provider_id];
  const setC = (patch) => setClosing((c) => ({ ...c, ...patch }));
  const openClosing = () => {
    setClosing({ ...emptyClosing(), provider_id: providerFilter || '', ...(period[0] && period[1] ? { period_start: period[0], period_end: period[1] } : {}) });
    setClosingOpen(true);
  };
  useEffect(() => {
    setOpenEntries([]);
    setPendingAdvances([]);
    if (!closingOpen || !closing.provider_id) return;
    Promise.all([
      api.getServiceProviderEntries({ provider_id: closing.provider_id, status: 'ABERTO' }),
      api.getServiceProviderAdvances({ provider_id: closing.provider_id, status: 'PENDENTE' }),
    ]).then(([e, a]) => {
      const list = (e.data || []).sort((x, y) => x.date.localeCompare(y.date));
      setOpenEntries(list);
      setPendingAdvances(a.data || []);
      // Já marca os serviços até o fim do período e todos os vales pendentes
      setClosing((c) => ({ ...c, entry_ids: new Set(list.filter((x) => x.date <= c.period_end).map((x) => x.id)), advance_ids: new Set((a.data || []).map((x) => x.id)) }));
    }).catch(() => toast.error('Erro ao buscar os serviços do prestador'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closingOpen, closing.provider_id]);

  const toggleIn = (key, id) => setClosing((c) => {
    const next = new Set(c[key]);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...c, [key]: next };
  });
  const setLine = (key, i, patch) => setClosing((c) => ({ ...c, [key]: c[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const removeLine = (key, i) => setClosing((c) => ({ ...c, [key]: c[key].filter((_, j) => j !== i) }));
  const newEntryTotal = (l) => round2((toNumber(l.quantity) || 0) * (toNumber(l.unit_value) || 0));

  const filledNewEntries = closing.new_entries.filter((l) => newEntryTotal(l) > 0);
  const filledNewAdvances = closing.new_advances.filter((a) => toNumber(a.value) > 0);
  const filledDiscounts = closing.discounts.filter((d) => toNumber(d.value) > 0);
  const closingCalc = {
    gross: round2(sumBy(openEntries.filter((e) => closing.entry_ids.has(e.id)), 'total') + filledNewEntries.reduce((s, l) => s + newEntryTotal(l), 0)),
    advances: round2(sumBy(pendingAdvances.filter((a) => closing.advance_ids.has(a.id)), 'value') + filledNewAdvances.reduce((s, a) => s + toNumber(a.value), 0)),
    discounts: round2(filledDiscounts.reduce((s, d) => s + toNumber(d.value), 0)),
  };
  closingCalc.balance = round2(closingCalc.gross - closingCalc.advances - closingCalc.discounts);
  const closingIssues = [];
  if (!closing.provider_id) closingIssues.push('Escolha o prestador');
  if (!closing.period_start || !closing.period_end) closingIssues.push('Informe o período do fechamento');
  else if (closing.period_start > closing.period_end) closingIssues.push('O início do período não pode ser depois do fim');
  if (closing.provider_id && !closing.entry_ids.size && !filledNewEntries.length) closingIssues.push('Marque ou lance pelo menos um serviço');
  if (filledNewEntries.some((l) => !l.date)) closingIssues.push('Informe a data de cada serviço');
  if (filledNewAdvances.some((a) => !a.date)) closingIssues.push('Informe o dia de cada vale');
  if (filledDiscounts.some((d) => !d.description.trim())) closingIssues.push('Informe a descrição de cada desconto');

  const saveClosing = async () => {
    if (closingIssues.length) { toast.error(closingIssues[0]); return; }
    let created;
    const ok = await run('closing', async () => {
      const r = await api.createServiceProviderClosing({
        provider_id: closing.provider_id, period_start: closing.period_start, period_end: closing.period_end,
        entry_ids: [...closing.entry_ids],
        new_entries: filledNewEntries.map((l) => ({ date: l.date, description: l.description.trim() || null, quantity: toNumber(l.quantity), unit_value: toNumber(l.unit_value) })),
        advance_ids: [...closing.advance_ids],
        new_advances: filledNewAdvances.map((a) => ({ provider_id: closing.provider_id, date: a.date, value: toNumber(a.value), description: a.description.trim() || null })),
        discounts: filledDiscounts.map((d) => ({ description: d.description.trim(), value: toNumber(d.value) })),
        observations: closing.observations.trim() || null,
      });
      created = r.data;
    });
    if (!ok) return;
    toast.success(`Fechamento nº ${created.number} · líquido a pagar ${fmtMoney(created.net_total)}`);
    if (created.carried_over) toast.info(`Saldo negativo de ${fmtMoney(created.carried_over)} lançado para descontar no próximo fechamento`, { duration: 8000 });
    setClosingOpen(false);
    setTab('closings');
    setSelectedId(created.id);
    loadLists();
  };

  const showDetail = async (c) => {
    try { setDetail((await api.getServiceProviderClosing(c.id)).data); } catch (err) { toast.error('Erro ao abrir o fechamento'); }
  };
  const pay = async () => {
    if (await run('pay', () => api.payServiceProviderClosing(selected.id, payForm), `Fechamento nº ${selected.number} pago`)) { setPayOpen(false); loadLists(); }
  };
  const unpay = async () => {
    if (!(await confirm(`Estornar o pagamento do fechamento nº ${selected.number}? Ele volta para "a pagar".`))) return;
    if (await run('unpay', () => api.unpayServiceProviderClosing(selected.id), 'Pagamento estornado')) loadLists();
  };
  const cancelClosing = async () => {
    if (!(await confirm(`Cancelar o fechamento nº ${selected.number}? Os serviços voltam para "em aberto" e os vales para "a descontar".`))) return;
    if (await run('cancel', () => api.cancelServiceProviderClosing(selected.id), 'Fechamento cancelado')) { setSelectedId(null); loadLists(); }
  };
  const receipt = async (c) => {
    await run('receipt', async () => {
      const r = await api.downloadServiceProviderReceipt(c.id);
      downloadBlob(r.data, `Recibo_${(c.provider_name || 'prestador').replace(/\W+/g, '_')}_${c.number}.pdf`);
    });
  };
  const report = async () => {
    await run('report', async () => {
      const r = await api.downloadServiceProviderReport({ ...params, status: statusFilter || undefined });
      downloadBlob(r.data, `Fechamentos_Prestadores_${period[0] || 'inicio'}_${period[1] || 'hoje'}.pdf`);
    });
  };

  const providerSelect = (value, onChange, testId, list = activeProviders) => (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger data-testid={testId}><SelectValue placeholder="Escolha o prestador" /></SelectTrigger>
      <SelectContent>{list.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.role}</SelectItem>)}</SelectContent>
    </Select>
  );
  const rowProps = (x) => ({
    onClick: () => setSelectedId(x.id === selectedId ? null : x.id), 'data-selected': x.id === selectedId, className: 'cursor-pointer',
  });

  const toolbar = {
    closings: (
      <Toolbar primary={<ToolbarPrimary icon={Plus} label="Novo fechamento" onClick={openClosing} testId="sp-closing-new" />}>
        <ToolbarButton icon={Eye} label="Ver fechamento" tone="blue" onClick={() => showDetail(selected)} disabled={!selected} testId="sp-closing-view" />
        <ToolbarButton icon={Wallet} label="Baixar pagamento" tone="emerald" disabled={selected?.status !== 'FECHADO'} testId="sp-closing-pay"
          onClick={() => { setPayForm({ payment_date: today(), payment_method: 'PIX', payment_notes: '' }); setPayOpen(true); }} />
        <ToolbarButton icon={RotateCcw} label="Estornar pagamento" tone="slate" onClick={unpay} disabled={selected?.status !== 'PAGO'} testId="sp-closing-unpay" />
        <ToolbarButton icon={Receipt} label="Recibo (PDF)" tone="red" onClick={() => receipt(selected)} disabled={!selected || !!busy} testId="sp-closing-receipt" />
        <ToolbarDivider />
        <ToolbarButton icon={FileDown} label="Relatório dos fechamentos (PDF)" tone="red" onClick={report} disabled={!closings.length || !!busy} testId="sp-closing-report" />
        <ToolbarButton icon={Ban} label="Cancelar fechamento" tone="red" onClick={cancelClosing} disabled={selected?.status !== 'FECHADO'} testId="sp-closing-cancel" />
      </Toolbar>
    ),
    entries: (
      <Toolbar primary={<ToolbarPrimary icon={Plus} label="Novo serviço" onClick={() => openEntry()} testId="sp-entry-new" />}>
        <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => openEntry(selected)} disabled={selected?.status !== 'ABERTO'} />
        <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={removeSelected} disabled={selected?.status !== 'ABERTO'} />
      </Toolbar>
    ),
    advances: (
      <Toolbar primary={<ToolbarPrimary icon={Plus} label="Novo vale" onClick={() => openAdvance()} testId="sp-advance-new" />}>
        <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => openAdvance(selected)} disabled={selected?.status !== 'PENDENTE' || isCarried(selected)} />
        <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={removeSelected} disabled={selected?.status !== 'PENDENTE' || isCarried(selected)} />
      </Toolbar>
    ),
    providers: (
      <Toolbar primary={<ToolbarPrimary icon={Plus} label="Novo prestador" onClick={() => openProvider()} testId="sp-provider-new" />}>
        <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => openProvider(selected)} disabled={!selected} />
        <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={removeSelected} disabled={!selected} />
      </Toolbar>
    ),
  }[tab];

  return (
    <Layout>
      <div className="space-y-4" data-testid="service-providers-page">
        <PageHeader icon={HardHat} title="Prestadores de Serviço"
          subtitle="Soldador, Pintor, Ajudante Geral, Vigia, Motorista... serviços, vales, fechamentos, pagamentos e recibos" />

        <StatGrid>
          <StatCard label="Serviços em aberto" value={fmtMoney(totals.open)} icon={ClipboardList} tone="blue" hint="ainda sem fechamento" />
          <StatCard label="Fechamentos a pagar" value={fmtMoney(totals.toPay)} icon={Clock} tone="amber" />
          <StatCard label="Pago" value={fmtMoney(totals.paid)} icon={CheckCircle2} tone="primary" />
          <StatCard label="Vales a descontar" value={fmtMoney(totals.advances)} icon={HandCoins} tone="violet" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setProviderFilter(''); setStatusFilter(''); setPeriod(['', '']); }}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Prestador, função ou descrição" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="sp-search" />
            </FilterField>
            <FilterField label="Prestador">
              <Select value={providerFilter || '_all'} onValueChange={(v) => setProviderFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Situação do fechamento">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  <SelectItem value="FECHADO">A pagar</SelectItem>
                  <SelectItem value="PAGO">Pagos</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <PeriodFilterFields value={period} onChange={setPeriod} testIdPrefix="sp" />
          </div>
          {period[0] && period[1] && period[0] > period[1] && <p className="mt-2 text-xs text-red-600">A data inicial não pode ser depois da data final.</p>}
        </FilterCard>

        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-card p-1 w-fit" role="tablist">
          {TABS.map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`sp-tab-${key}`}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === key
                ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        <DataCard title={TABS.find((t) => t[0] === tab)[1]} count={loading ? '...' : rows.length} toolbar={toolbar} footer={<TablePagination {...paginationProps} />}>
          {loading && !rows.length ? <EmptyState loading /> : rows.length === 0 ? (
            <EmptyState icon={HardHat} title="Nada por aqui" hint={tab === 'providers' ? 'Cadastre os prestadores em Novo prestador'
              : 'Ajuste os filtros de período e prestador, ou use o botão verde para lançar'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                {tab === 'closings' && (
                  <>
                    <thead><tr><th>Nº</th><th>Prestador</th><th>Período</th><th className="!text-right">Serviços</th><th className="!text-right">Vales e descontos</th>
                      <th className="!text-right">Líquido</th><th>Situação</th></tr></thead>
                    <tbody>
                      {pageItems.map((c) => (
                        <tr key={c.id} {...rowProps(c)} onDoubleClick={() => showDetail(c)} data-testid={`sp-closing-${c.number}`}>
                          <td className="cell-strong tabular-nums">{c.number}</td>
                          <td><div className="cell-strong">{c.provider_name}</div><div className="text-[11px] text-slate-500">{c.role}</div></td>
                          <td className="whitespace-nowrap tabular-nums">{fmtDate(c.period_start)} a {fmtDate(c.period_end)}</td>
                          <td className="text-right tabular-nums">{fmtMoney(c.gross_total)} <span className="text-[11px] text-slate-500">({c.entries_count})</span></td>
                          <td className="text-right tabular-nums">{fmtMoney(c.advances_total + c.discount_total)}</td>
                          <td className="text-right tabular-nums font-semibold">{fmtMoney(c.net_total)}
                            {c.carried_over > 0 && <div className="text-[11px] font-normal text-amber-600">saldo −{fmtMoney(c.carried_over)} p/ próximo</div>}</td>
                          <td className="whitespace-nowrap">
                            {c.status === 'PAGO'
                              ? <StatusPill tone="emerald" title={[c.payment_method, c.payment_notes].filter(Boolean).join(' · ')}>Pago em {fmtDate(c.payment_date)}</StatusPill>
                              : <StatusPill tone="amber">A pagar</StatusPill>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
                {tab === 'entries' && (
                  <>
                    <thead><tr><th>Data</th><th>Prestador</th><th>Descrição</th><th className="!text-right">Qtd.</th><th className="!text-right">Valor unit.</th>
                      <th className="!text-right">Total</th><th>Situação</th></tr></thead>
                    <tbody>
                      {pageItems.map((e) => (
                        <tr key={e.id} {...rowProps(e)} onDoubleClick={() => openEntry(e)}>
                          <td className="whitespace-nowrap tabular-nums">{fmtDate(e.date)}</td>
                          <td><div className="cell-strong">{e.provider_name}</div><div className="text-[11px] text-slate-500">{e.role}</div></td>
                          <td><div className="max-w-[280px] truncate" title={e.description || ''}>{e.description || '-'}</div></td>
                          <td className="text-right tabular-nums whitespace-nowrap">{fmtUnits(e.quantity, e.unit)}</td>
                          <td className="text-right tabular-nums">{fmtMoney(e.unit_value)}</td>
                          <td className="text-right tabular-nums font-semibold">{fmtMoney(e.total)}</td>
                          <td>{e.status === 'ABERTO' ? <StatusPill tone="blue">Em aberto</StatusPill> : <StatusPill tone="emerald">Fechado</StatusPill>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
                {tab === 'advances' && (
                  <>
                    <thead><tr><th>Data</th><th>Prestador</th><th>Descrição</th><th className="!text-right">Valor</th><th>Situação</th></tr></thead>
                    <tbody>
                      {pageItems.map((a) => (
                        <tr key={a.id} {...rowProps(a)} onDoubleClick={() => openAdvance(a)}>
                          <td className="whitespace-nowrap tabular-nums">{fmtDate(a.date)}</td>
                          <td className="cell-strong">{a.provider_name}</td>
                          <td><div className="max-w-[420px] whitespace-normal text-[13px]">{a.description || '-'}</div></td>
                          <td className="text-right tabular-nums font-semibold">{fmtMoney(a.value)}</td>
                          <td className="whitespace-nowrap">
                            {a.status === 'PENDENTE' ? <StatusPill tone="violet">A descontar</StatusPill> : <StatusPill tone="emerald">Descontado</StatusPill>}
                            {isCarried(a) && <StatusPill tone="amber" className="ml-1">Saldo anterior</StatusPill>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
                {tab === 'providers' && (
                  <>
                    <thead><tr><th>Nome</th><th>Função</th><th>CPF/CNPJ</th><th>Cobrança</th><th className="!text-right">Valor padrão</th><th>Telefone</th><th>PIX</th><th>Situação</th></tr></thead>
                    <tbody>
                      {pageItems.map((p) => (
                        <tr key={p.id} {...rowProps(p)} onDoubleClick={() => openProvider(p)}>
                          <td className="cell-strong">{p.name}</td>
                          <td>{p.role}</td>
                          <td className="tabular-nums">{p.document || '-'}</td>
                          <td>{UNIT_LABELS[p.payment_unit]}</td>
                          <td className="text-right tabular-nums">{p.default_rate ? fmtMoney(p.default_rate) : '-'}</td>
                          <td className="tabular-nums">{p.phone || '-'}</td>
                          <td><div className="max-w-[160px] truncate" title={p.pix_key || ''}>{p.pix_key || '-'}</div></td>
                          <td>{p.status === 'INATIVO' ? <StatusPill tone="slate">Inativo</StatusPill> : <StatusPill tone="emerald">Ativo</StatusPill>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          )}
        </DataCard>
      </div>

      {/* Fechamento */}
      <Dialog open={closingOpen} onOpenChange={setClosingOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="sp-closing-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Receipt className="w-5 h-5 text-primary" />Fechamento do prestador</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
              <Field label="Prestador" required className="col-span-2 md:col-span-6">
                {providerSelect(closing.provider_id, (v) => setC({ provider_id: v, new_entries: [] }), 'sp-closing-provider')}
              </Field>
              <Field label="Período do fechamento" required className="col-span-2 md:col-span-6">
                <div className="flex items-center gap-2">
                  <Input type="date" value={closing.period_start} onChange={(e) => setC({ period_start: e.target.value })} aria-label="Período: início" data-testid="sp-closing-start" />
                  <span className="text-sm text-slate-500">a</span>
                  <Input type="date" value={closing.period_end} onChange={(e) => setC({ period_end: e.target.value })} aria-label="Período: fim" data-testid="sp-closing-end" />
                </div>
              </Field>
            </div>
            {closingProvider && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {closingProvider.role} · cobrança por <b>{UNIT_LABELS[closingProvider.payment_unit]?.toLowerCase()}</b>
                {closingProvider.default_rate ? <> de <b>{fmtMoney(closingProvider.default_rate)}</b></> : null}
                {closingProvider.pix_key && <> · PIX {closingProvider.pix_key}</>}
              </p>
            )}

            {closingProvider && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Serviços</p>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="data-table">
                    <thead><tr><th className="w-10 pr-0" /><th>Data</th><th>Descrição</th><th className="!text-right">Qtd.</th><th className="!text-right">Valor unit. (R$)</th><th className="!text-right">Total</th><th className="w-10" /></tr></thead>
                    <tbody>
                      {openEntries.map((e) => (
                        <tr key={e.id} className={closing.entry_ids.has(e.id) ? '' : 'opacity-60'} data-testid={`sp-closing-entry-${e.id}`}>
                          <td className="pr-0"><Checkbox checked={closing.entry_ids.has(e.id)} onCheckedChange={() => toggleIn('entry_ids', e.id)} /></td>
                          <td className="tabular-nums whitespace-nowrap">{fmtDate(e.date)}{e.date > closing.period_end && <span className="block text-[10px] text-amber-600">depois do período</span>}</td>
                          <td>{e.description || '-'}</td>
                          <td className="text-right tabular-nums whitespace-nowrap">{fmtUnits(e.quantity, e.unit)}</td>
                          <td className="text-right tabular-nums">{fmtMoney(e.unit_value)}</td>
                          <td className="text-right tabular-nums font-semibold">{fmtMoney(e.total)}</td>
                          <td />
                        </tr>
                      ))}
                      {closing.new_entries.map((l, i) => (
                        <tr key={`n${i}`}>
                          <td />
                          <td><Input type="date" value={l.date} className="h-8 w-36" aria-label="Data do serviço" onChange={(e) => setLine('new_entries', i, { date: e.target.value })} /></td>
                          <td><Input value={l.description} className="h-8 min-w-[160px]" placeholder="Descrição" maxLength={120} aria-label="Descrição do serviço"
                            onChange={(e) => setLine('new_entries', i, { description: e.target.value })} /></td>
                          <td><Input inputMode="decimal" value={l.quantity} className="h-8 w-20 ml-auto text-right" aria-label="Quantidade"
                            onChange={(e) => setLine('new_entries', i, { quantity: moneyMask(e.target.value) })} data-testid={`sp-new-entry-qty-${i}`} /></td>
                          <td><Input inputMode="decimal" value={l.unit_value} className="h-8 w-28 ml-auto text-right" placeholder="0,00" aria-label="Valor unitário"
                            onChange={(e) => setLine('new_entries', i, { unit_value: moneyMask(e.target.value) })} data-testid={`sp-new-entry-value-${i}`} /></td>
                          <td className="text-right tabular-nums font-semibold">{newEntryTotal(l) ? fmtMoney(newEntryTotal(l)) : '-'}</td>
                          <td><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600" aria-label="Remover serviço"
                            onClick={() => removeLine('new_entries', i)}><X className="w-4 h-4" /></Button></td>
                        </tr>
                      ))}
                      {!openEntries.length && !closing.new_entries.length && (
                        <tr><td colSpan={7} className="text-center text-sm text-slate-500">Nenhum serviço em aberto. Lance abaixo os serviços do período.</td></tr>
                      )}
                      <tr className="font-semibold">
                        <td /><td colSpan={4}>Total dos serviços</td>
                        <td className="text-right tabular-nums" data-testid="sp-closing-gross">{fmtMoney(closingCalc.gross)}</td><td />
                      </tr>
                    </tbody>
                  </table>
                </div>
                <button type="button" className="text-xs font-medium text-primary hover:underline" data-testid="sp-closing-add-entry"
                  onClick={() => setC({ new_entries: [...closing.new_entries, { date: closing.period_end || today(), description: '', quantity: '1', unit_value: toMoneyInput(closingProvider.default_rate) }] })}>
                  + Serviço
                </button>
              </div>
            )}

            {closingProvider && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Vales <span className="text-xs font-normal text-slate-500">(adiantamentos; descontados do total)</span></p>
                {pendingAdvances.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={closing.advance_ids.has(a.id)} onCheckedChange={() => toggleIn('advance_ids', a.id)} />
                    <span className="tabular-nums">{fmtDate(a.date)}</span>
                    <span className="flex-1 truncate text-slate-500" title={a.description || ''}>{isCarried(a) ? `Saldo negativo anterior — ${a.description}` : (a.description || 'Vale')}</span>
                    <span className="tabular-nums font-medium">{fmtMoney(a.value)}</span>
                  </label>
                ))}
                {closing.new_advances.map((a, i) => (
                  <div key={i} className="grid grid-cols-12 gap-3 items-end">
                    <Field label="Valor do vale (R$)" className="col-span-6 md:col-span-3">
                      <Input inputMode="decimal" value={a.value} placeholder="0,00" className="text-right" data-testid={`sp-new-advance-${i}`}
                        onChange={(e) => { const v = moneyMask(e.target.value); setLine('new_advances', i, { value: v, date: a.date || (v ? today() : '') }); }} />
                    </Field>
                    <Field label="Dia do vale" className="col-span-6 md:col-span-3">
                      <Input type="date" value={a.date} onChange={(e) => setLine('new_advances', i, { date: e.target.value })} data-testid={`sp-new-advance-date-${i}`} />
                    </Field>
                    <Field label="Descrição" className="col-span-11 md:col-span-5">
                      <Input value={a.description} maxLength={100} placeholder="Ex.: PIX, dinheiro" onChange={(e) => setLine('new_advances', i, { description: e.target.value })} />
                    </Field>
                    {closing.new_advances.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="col-span-1 h-9 w-9 text-slate-400 hover:text-red-600" aria-label="Remover vale"
                        onClick={() => removeLine('new_advances', i)}><X className="w-4 h-4" /></Button>
                    )}
                  </div>
                ))}
                <button type="button" className="text-xs font-medium text-primary hover:underline"
                  onClick={() => setC({ new_advances: [...closing.new_advances, { value: '', date: '', description: '' }] })}>+ Outro vale</button>
              </div>
            )}

            {closingProvider && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Outros descontos <span className="text-xs font-normal text-slate-500">(se houver)</span></p>
                {closing.discounts.map((d, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={d.description} placeholder="Descrição (ex.: falta, material, avaria)" maxLength={100} className="flex-1" aria-label="Descrição do desconto"
                      onChange={(e) => setLine('discounts', i, { description: e.target.value })} />
                    <Input inputMode="decimal" value={d.value} placeholder="0,00" className="w-36 text-right" aria-label="Valor do desconto"
                      onChange={(e) => setLine('discounts', i, { value: moneyMask(e.target.value) })} />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:text-red-600" aria-label="Remover desconto"
                      onClick={() => removeLine('discounts', i)}><X className="w-4 h-4" /></Button>
                  </div>
                ))}
                <button type="button" className="text-xs font-medium text-primary hover:underline"
                  onClick={() => setC({ discounts: [...closing.discounts, { description: '', value: '' }] })}>+ Desconto</button>
              </div>
            )}

            {closingProvider && (
              <>
                <Field label="Observações">
                  <Textarea rows={2} maxLength={1000} value={closing.observations} onChange={(e) => setC({ observations: e.target.value })} />
                </Field>
                <dl className="ml-auto max-w-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-sm space-y-1" data-testid="sp-closing-calc">
                  <div className="flex justify-between"><dt className="text-slate-500">Total dos serviços</dt><dd className="tabular-nums">{fmtMoney(closingCalc.gross)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">(-) Vales</dt><dd className="tabular-nums">{fmtMoney(closingCalc.advances)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">(-) Descontos</dt><dd className="tabular-nums">{fmtMoney(closingCalc.discounts)}</dd></div>
                  <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1 font-semibold">
                    <dt>Líquido a pagar</dt><dd className="tabular-nums text-primary" data-testid="sp-closing-net">{fmtMoney(Math.max(closingCalc.balance, 0))}</dd>
                  </div>
                </dl>
                {closingCalc.balance < 0 && (
                  <p className="flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300" data-testid="sp-closing-carry">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Saldo negativo: vales e descontos passam dos serviços. O fechamento fica com líquido zero e <b>{fmtMoney(-closingCalc.balance)}</b> serão
                      descontados automaticamente no próximo fechamento.</span>
                  </p>
                )}
              </>
            )}
            {closingIssues.length > 0 && closing.provider_id && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="w-3.5 h-3.5" /> {closingIssues[0]}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setClosingOpen(false)}>Fechar</Button>
            <Button onClick={saveClosing} disabled={busy === 'closing'} data-testid="sp-closing-save">
              {busy === 'closing' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Salvar fechamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalhe do fechamento */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="sp-detail-dialog">
          {detail && (
            <>
              <DialogHeader><DialogTitle>Fechamento nº {detail.number} · {detail.provider_name}</DialogTitle></DialogHeader>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {detail.role} · {fmtDate(detail.period_start)} a {fmtDate(detail.period_end)} ·{' '}
                {detail.status === 'PAGO' ? `pago em ${fmtDate(detail.payment_date)}${detail.payment_method ? ` (${detail.payment_method})` : ''}` : 'a pagar'}
              </p>
              <table className="data-table">
                <thead><tr><th>Data</th><th>Serviço</th><th className="!text-right">Qtd.</th><th className="!text-right">Valor unit.</th><th className="!text-right">Total</th></tr></thead>
                <tbody>
                  {detail.entries.map((e) => (
                    <tr key={e.id}><td className="tabular-nums">{fmtDate(e.date)}</td><td>{e.description || '-'}</td>
                      <td className="text-right tabular-nums">{fmtUnits(e.quantity, e.unit)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(e.unit_value)}</td><td className="text-right tabular-nums font-semibold">{fmtMoney(e.total)}</td></tr>
                  ))}
                </tbody>
              </table>
              {(detail.advances.length > 0 || detail.discounts.length > 0) && (
                <div className="space-y-1 text-sm">
                  {detail.advances.map((a) => (
                    <div key={a.id} className="flex justify-between gap-3"><span className="text-slate-500">{fmtDate(a.date)} · {a.description || 'Vale'}</span><span className="tabular-nums">− {fmtMoney(a.value)}</span></div>
                  ))}
                  {detail.discounts.map((d, i) => (
                    <div key={i} className="flex justify-between gap-3"><span className="text-slate-500">{d.description}</span><span className="tabular-nums">− {fmtMoney(d.value)}</span></div>
                  ))}
                </div>
              )}
              <dl className="ml-auto w-full max-w-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-sm space-y-1">
                <div className="flex justify-between"><dt className="text-slate-500">Total dos serviços</dt><dd className="tabular-nums">{fmtMoney(detail.gross_total)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">(-) Vales e descontos</dt><dd className="tabular-nums">{fmtMoney(detail.advances_total + detail.discount_total)}</dd></div>
                <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1 font-semibold"><dt>Líquido</dt><dd className="tabular-nums text-primary">{fmtMoney(detail.net_total)}</dd></div>
              </dl>
              {detail.observations && <p className="text-sm text-slate-600 dark:text-slate-300"><b>Observações:</b> {detail.observations}</p>}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDetail(null)}>Fechar</Button>
                <Button onClick={() => receipt(detail)} disabled={busy === 'receipt'}><Receipt className="w-4 h-4 mr-1.5" /> Recibo (PDF)</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Pagamento */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md" data-testid="sp-pay-dialog">
          <DialogHeader><DialogTitle>Baixar pagamento</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">Fechamento nº {selected.number} · {selected.provider_name} · <b>{fmtMoney(selected.net_total)}</b></p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data do pagamento" required>
                  <Input type="date" value={payForm.payment_date} onChange={(e) => setPayForm((p) => ({ ...p, payment_date: e.target.value }))} data-testid="sp-pay-date" />
                </Field>
                <Field label="Forma de pagamento">
                  <Select value={payForm.payment_method} onValueChange={(v) => setPayForm((p) => ({ ...p, payment_method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Observação" hint="Ex.: nº do comprovante">
                <Input value={payForm.payment_notes} maxLength={200} onChange={(e) => setPayForm((p) => ({ ...p, payment_notes: e.target.value }))} />
              </Field>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button>
            <Button onClick={pay} disabled={!payForm.payment_date || busy === 'pay'} data-testid="sp-pay-confirm">
              {busy === 'pay' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Wallet className="w-4 h-4 mr-1.5" />} Confirmar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Prestador */}
      <Dialog open={providerOpen} onOpenChange={setProviderOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="sp-provider-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><HardHat className="w-5 h-5 text-primary" />{editingId ? 'Editar prestador' : 'Novo prestador'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
            <Field label="Nome" required className="col-span-2 md:col-span-8">
              <Input value={providerForm.name} maxLength={120} onChange={(e) => setProviderForm((f) => ({ ...f, name: e.target.value }))} data-testid="sp-provider-name" />
            </Field>
            <Field label="CPF/CNPJ" className="col-span-2 md:col-span-4">
              <Input value={providerForm.document} maxLength={20} onChange={(e) => setProviderForm((f) => ({ ...f, document: e.target.value }))} />
            </Field>
            <Field label="Função" required className="col-span-2 md:col-span-4" hint="Escolha na lista ou digite outra">
              <Input list="sp-roles" value={providerForm.role} maxLength={60} onChange={(e) => setProviderForm((f) => ({ ...f, role: e.target.value }))} data-testid="sp-provider-role" />
              <datalist id="sp-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
            <Field label="Cobrança por" className="md:col-span-4">
              <Select value={providerForm.payment_unit} onValueChange={(v) => setProviderForm((f) => ({ ...f, payment_unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={`Valor da ${UNIT_LABELS[providerForm.payment_unit]?.toLowerCase()} (R$)`} className="md:col-span-4">
              <Input inputMode="decimal" value={providerForm.default_rate} className="text-right" onChange={(e) => setProviderForm((f) => ({ ...f, default_rate: moneyMask(e.target.value) }))} data-testid="sp-provider-rate" />
            </Field>
            <Field label="Telefone" className="md:col-span-4">
              <Input value={providerForm.phone} maxLength={30} onChange={(e) => setProviderForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="Chave PIX" className="md:col-span-4">
              <Input value={providerForm.pix_key} maxLength={100} onChange={(e) => setProviderForm((f) => ({ ...f, pix_key: e.target.value }))} />
            </Field>
            <Field label="Situação" className="col-span-2 md:col-span-4">
              <Select value={providerForm.status} onValueChange={(v) => setProviderForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ATIVO">Ativo</SelectItem><SelectItem value="INATIVO">Inativo</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Dados bancários" className="col-span-2 md:col-span-12">
              <Input value={providerForm.bank_info} maxLength={200} placeholder="Banco, agência e conta" onChange={(e) => setProviderForm((f) => ({ ...f, bank_info: e.target.value }))} />
            </Field>
            <Field label="Observações" className="col-span-2 md:col-span-12">
              <Textarea rows={2} maxLength={1000} value={providerForm.observations} onChange={(e) => setProviderForm((f) => ({ ...f, observations: e.target.value }))} />
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setProviderOpen(false)}>Cancelar</Button>
            <Button onClick={saveProvider} disabled={busy === 'provider'} data-testid="sp-provider-save">
              {busy === 'provider' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Serviço */}
      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent className="max-w-xl" data-testid="sp-entry-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardList className="w-5 h-5 text-primary" />{editingId ? 'Editar serviço' : 'Novo serviço / diária'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
            <Field label="Prestador" required className="col-span-2 md:col-span-8">{providerSelect(entryForm.provider_id, pickEntryProvider, 'sp-entry-provider')}</Field>
            <Field label="Data" required className="col-span-2 md:col-span-4">
              <Input type="date" value={entryForm.date} onChange={(e) => setEntryForm((f) => ({ ...f, date: e.target.value }))} />
            </Field>
            <Field label="Descrição do serviço" className="col-span-2 md:col-span-12">
              <Input value={entryForm.description} maxLength={120} placeholder="Ex.: solda do chassi da carreta" onChange={(e) => setEntryForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
            <Field label="Unidade" className="md:col-span-3">
              <Select value={entryForm.unit || entryProvider?.payment_unit || 'DIARIA'} onValueChange={(v) => setEntryForm((f) => ({ ...f, unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Quantidade" className="md:col-span-3">
              <Input inputMode="decimal" value={entryForm.quantity} className="text-right" onChange={(e) => setEntryForm((f) => ({ ...f, quantity: moneyMask(e.target.value) }))} />
            </Field>
            <Field label="Valor unitário (R$)" required className="md:col-span-3">
              <Input inputMode="decimal" value={entryForm.unit_value} className="text-right" onChange={(e) => setEntryForm((f) => ({ ...f, unit_value: moneyMask(e.target.value) }))} data-testid="sp-entry-value" />
            </Field>
            <Field label="Total" className="md:col-span-3">
              <div className="h-9 flex items-center justify-end font-semibold tabular-nums text-primary">{fmtMoney(entryTotal)}</div>
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEntryOpen(false)}>Cancelar</Button>
            <Button onClick={saveEntry} disabled={busy === 'entry'} data-testid="sp-entry-save">
              {busy === 'entry' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vale */}
      <Dialog open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <DialogContent className="max-w-md" data-testid="sp-advance-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><HandCoins className="w-5 h-5 text-primary" />{editingId ? 'Editar vale' : 'Novo vale'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Prestador" required>{providerSelect(advanceForm.provider_id, (v) => setAdvanceForm((f) => ({ ...f, provider_id: v })), 'sp-advance-provider')}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor (R$)" required>
                <Input inputMode="decimal" value={advanceForm.value} className="text-right font-semibold" onChange={(e) => setAdvanceForm((f) => ({ ...f, value: moneyMask(e.target.value) }))} data-testid="sp-advance-value" />
              </Field>
              <Field label="Dia do vale" required>
                <Input type="date" value={advanceForm.date} onChange={(e) => setAdvanceForm((f) => ({ ...f, date: e.target.value }))} />
              </Field>
            </div>
            <Field label="Descrição" hint="Ex.: PIX, dinheiro, nº do recibo">
              <Input value={advanceForm.description} maxLength={100} onChange={(e) => setAdvanceForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAdvanceOpen(false)}>Cancelar</Button>
            <Button onClick={saveAdvance} disabled={busy === 'advance'} data-testid="sp-advance-save">
              {busy === 'advance' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
