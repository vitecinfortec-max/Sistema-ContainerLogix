import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination, usePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useConfirm } from '../hooks/useConfirm';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { api } from '../lib/api';
import { todayISO } from '../lib/dates';
import { ContractPicker, errorDetail, fmtDate, fmtNumber, formatMoney, saveBlob, useContracts } from '../components/HRKit';
import { toast } from 'sonner';
import {
  TreePalm, CalendarPlus, Pencil, Trash2, CheckCircle2, RotateCcw, Ban, FileText, Receipt, Save, AlertTriangle, Clock, Users, Plane,
} from 'lucide-react';

const STATUS_LABELS = { PROGRAMADA: 'Programada', PAGA: 'Paga', CANCELADA: 'Cancelada' };
const STATUS_TONES = { PROGRAMADA: 'amber', PAGA: 'emerald', CANCELADA: 'red' };
const PERIOD_LABELS = { VENCIDO: 'Vencido', A_VENCER: 'A vencer', DISPONIVEL: 'Disponível', QUITADO: 'Quitado', EM_AQUISICAO: 'Em aquisição' };
const PERIOD_TONES = { VENCIDO: 'red', A_VENCER: 'amber', DISPONIVEL: 'blue', QUITADO: 'emerald', EM_AQUISICAO: 'slate' };

const EMPTY = { contract_id: '', acquisition_start: '', start_date: '', days: 30, sell_days: 0, advance_13th: false, payment_date: '', observations: '' };

export default function HRVacationsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const { contracts } = useContracts();
  const [tab, setTab] = useState('saldos');
  const [balances, setBalances] = useState([]);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const listKey = `${debouncedSearch}|${statusFilter}|${dateFrom}|${dateTo}`;
  const { pageItems, paginationProps } = usePagination(list, { resetKey: listKey });
  const filteredBalances = balances.filter((b) => !debouncedSearch || (b.person_name || '').toLowerCase().includes(debouncedSearch.toLowerCase()));
  const balancePage = usePagination(filteredBalances, { resetKey: debouncedSearch });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [saving, setSaving] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payDate, setPayDate] = useState(todayISO());

  useEffect(() => { loadBalances(); }, []);
  useEffect(() => { setSelectedIds(new Set()); loadList(); }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadBalances = () => api.getVacationBalances().then((r) => setBalances(r.data || [])).catch(() => toast.error('Erro ao carregar os saldos'));
  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      setList((await api.getVacations(params)).data || []);
    } catch (e) {
      toast.error('Erro ao carregar as férias');
    } finally {
      setLoading(false);
    }
  };
  const reload = () => { setSelectedIds(new Set()); loadList(); loadBalances(); };

  const toggle = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const single = selectedIds.size === 1 ? list.find((v) => selectedIds.has(v.id)) : null;

  // ===== Formulário com cálculo ao vivo =====
  const contractPeriods = useMemo(() => {
    const b = balances.find((x) => x.contract_id === form.contract_id);
    const periods = (b?.periods || []).filter((p) => p.complete && (p.balance > 0 || p.start === form.acquisition_start));
    return periods;
  }, [balances, form.contract_id, form.acquisition_start]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const debouncedForm = useDebouncedValue(form, 400);
  useEffect(() => {
    if (!dialogOpen) return;
    const f = debouncedForm;
    setPreview(null);
    setPreviewError('');
    if (!f.contract_id || !f.acquisition_start || !f.start_date || !f.days) return;
    let cancelled = false;
    api.previewVacation(payloadOf(f), editingId)
      .then((r) => { if (!cancelled) setPreview(r.data); })
      .catch((e) => { if (!cancelled) setPreviewError(errorDetail(e, 'Não foi possível calcular')); });
    return () => { cancelled = true; };
  }, [debouncedForm, dialogOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const payloadOf = (f) => ({
    contract_id: f.contract_id, acquisition_start: f.acquisition_start, start_date: f.start_date,
    days: Number(f.days) || 0, sell_days: Number(f.sell_days) || 0, advance_13th: f.advance_13th,
    payment_date: f.payment_date || null, observations: f.observations || null,
  });

  const openCreate = (balance) => {
    const first = balance?.periods?.find((p) => p.complete && p.balance > 0);
    setForm({ ...EMPTY, contract_id: balance?.contract_id || '', acquisition_start: first?.start || '', days: first ? Math.min(30, first.balance) : 30 });
    setEditingId(null);
    setDialogOpen(true);
  };
  const openEdit = (v) => {
    setForm({
      contract_id: v.contract_id, acquisition_start: v.acquisition_start, start_date: v.start_date, days: v.days, sell_days: v.sell_days || 0,
      advance_13th: !!v.advance_13th, payment_date: v.payment_date || '', observations: v.observations || '',
    });
    setEditingId(v.id);
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.contract_id || !form.acquisition_start || !form.start_date) { toast.error('Informe funcionário, período aquisitivo e início'); return; }
    setSaving(true);
    try {
      if (editingId) await api.updateVacation(editingId, payloadOf(form));
      else await api.createVacation(payloadOf(form));
      toast.success(editingId ? 'Férias atualizadas' : 'Férias programadas');
      setDialogOpen(false);
      setTab('ferias');
      reload();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar as férias'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!single || !(await confirm(`Excluir as férias Nº ${single.vacation_number} de ${single.person_name}?`))) return;
    try { await api.deleteVacation(single.id); toast.success('Férias excluídas'); reload(); } catch (e) { toast.error(errorDetail(e, 'Erro ao excluir')); }
  };
  const changeStatus = async (status) => {
    const msg = status === 'PROGRAMADA' ? `Estornar o pagamento das férias Nº ${single.vacation_number}?` : `Cancelar as férias Nº ${single.vacation_number}?`;
    if (!(await confirm(msg))) return;
    try { await api.updateVacationStatus(single.id, status); toast.success('Situação atualizada'); reload(); } catch (e) { toast.error(errorDetail(e, 'Erro ao atualizar')); }
  };
  const pay = async () => {
    try {
      await api.payVacation(single.id, { payment_date: payDate });
      toast.success('Pagamento registrado');
      setPayOpen(false);
      reload();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao registrar o pagamento'));
    }
  };

  const today = todayISO();
  const onVacation = list.filter((v) => v.status !== 'CANCELADA' && v.start_date <= today && v.end_date >= today).length;
  const hasFilters = !!(search || statusFilter || dateFrom || dateTo);

  return (
    <Layout>
      <div className="space-y-4" data-testid="hr-vacations-page">
        <PageHeader icon={TreePalm} title="Férias" subtitle="Períodos aquisitivos, programação, aviso e recibo de férias com o cálculo de INSS e IRRF" />

        <StatGrid>
          <StatCard label="Períodos vencidos" value={balances.reduce((a, b) => a + b.overdue, 0)} icon={AlertTriangle} tone="red" hint="passaram do prazo: férias em dobro" />
          <StatCard label="Vencendo em 60 dias" value={balances.reduce((a, b) => a + b.due_soon, 0)} icon={Clock} tone="amber" />
          <StatCard label="Em férias hoje" value={onVacation} icon={Plane} tone="blue" />
          <StatCard label="Funcionários" value={balances.length} icon={Users} tone="slate" hint="com direito a férias CLT" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setStatusFilter(''); setDateFrom(''); setDateTo(''); }}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Funcionário" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="hr-vacations-search" />
            </FilterField>
            {tab === 'ferias' && (
              <>
                <FilterField label="Situação">
                  <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">Todas</SelectItem>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="Início - de">
                  <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </FilterField>
                <FilterField label="até">
                  <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </FilterField>
              </>
            )}
          </div>
        </FilterCard>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="saldos" data-testid="hr-vacations-tab-balances">Saldos por funcionário</TabsTrigger>
            <TabsTrigger value="ferias" data-testid="hr-vacations-tab-list">Férias programadas</TabsTrigger>
          </TabsList>

          <TabsContent value="saldos" className="pt-3">
            <DataCard title="Saldos" count={filteredBalances.length} footer={<TablePagination {...balancePage.paginationProps} />}>
              {filteredBalances.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Funcionário</th>
                        <th>Admissão</th>
                        <th>Períodos aquisitivos</th>
                        <th className="!text-center">Dias disponíveis</th>
                        <th>Conceder até</th>
                        <th className="!text-right" />
                      </tr>
                    </thead>
                    <tbody>
                      {balancePage.pageItems.map((b) => (
                        <tr key={b.contract_id} data-testid={`hr-vacation-balance-${b.contract_number}`}>
                          <td className="cell-strong">{b.person_name}<span className="block text-[11px] font-normal text-slate-500">{b.position_name || ''}</span></td>
                          <td className="tabular-nums">{fmtDate(b.admission_date)}</td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {b.periods.slice(-3).map((p) => (
                                <StatusPill key={p.start} tone={PERIOD_TONES[p.status]} dot={false} className="text-[10px]"
                                  title={`${fmtDate(p.start)} a ${fmtDate(p.end)} · direito ${fmtNumber(p.entitled, 1)} · usado ${p.used}`}>
                                  {fmtDate(p.start).slice(3)}: {PERIOD_LABELS[p.status]}{p.status !== 'QUITADO' ? ` (${fmtNumber(p.balance, 1)}d)` : ''}
                                </StatusPill>
                              ))}
                            </div>
                          </td>
                          <td className="text-center tabular-nums cell-strong">{b.available_days}</td>
                          <td className="tabular-nums">{b.next_deadline ? fmtDate(b.next_deadline) : '-'}</td>
                          <td className="text-right">
                            <Button size="sm" variant="outline" className="h-8" disabled={!b.available_days} onClick={() => openCreate(b)}>
                              <CalendarPlus className="w-4 h-4 mr-1" />Programar
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon={TreePalm} title="Nenhum funcionário" hint="Os saldos aparecem para os contratos cadastrados em Admissão e Contratos" />
              )}
            </DataCard>
          </TabsContent>

          <TabsContent value="ferias" className="pt-3">
            <DataCard
              title="Férias"
              count={loading ? '...' : list.length}
              footer={<TablePagination {...paginationProps} />}
              toolbar={(
                <Toolbar selectedCount={selectedIds.size} primary={<ToolbarPrimary icon={CalendarPlus} label="Programar férias" onClick={() => openCreate(null)} testId="hr-vacation-new-btn" />}>
                  <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && openEdit(single)} disabled={!single || single.status !== 'PROGRAMADA'} />
                  <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={remove} disabled={!single || single.status === 'PAGA'} />
                  <ToolbarDivider />
                  <ToolbarButton icon={CheckCircle2} label="Registrar pagamento" tone="emerald" disabled={!single || single.status !== 'PROGRAMADA'}
                    onClick={() => { setPayDate(single.payment_date || todayISO()); setPayOpen(true); }} testId="hr-vacation-pay-btn" />
                  <ToolbarButton icon={RotateCcw} label="Estornar pagamento" tone="amber" disabled={!single || single.status !== 'PAGA'} onClick={() => changeStatus('PROGRAMADA')} />
                  <ToolbarButton icon={Ban} label="Cancelar" tone="red" disabled={!single || single.status !== 'PROGRAMADA'} onClick={() => changeStatus('CANCELADA')} />
                  <ToolbarDivider />
                  <ToolbarButton icon={FileText} label="Aviso de férias (PDF)" tone="primary" disabled={!single || single.status === 'CANCELADA'}
                    onClick={() => saveBlob(() => api.getVacationNoticePDF(single.id), `Aviso_Ferias_${single.person_name}.pdf`)} />
                  <ToolbarButton icon={Receipt} label="Recibo de férias (PDF)" tone="emerald" disabled={!single || single.status === 'CANCELADA'}
                    onClick={() => saveBlob(() => api.getVacationReceiptPDF(single.id), `Recibo_Ferias_${single.person_name}.pdf`)} />
                </Toolbar>
              )}
            >
              {list.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="w-10 pr-0" />
                        <th>Nº</th>
                        <th>Funcionário</th>
                        <th>Aquisitivo</th>
                        <th>Gozo</th>
                        <th className="!text-center">Dias</th>
                        <th className="!text-right">Líquido</th>
                        <th>Situação</th>
                        <th>Pagamento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((v) => (
                        <tr key={v.id} onClick={() => toggle(v.id)} data-selected={selectedIds.has(v.id)} className="cursor-pointer" data-testid={`hr-vacation-row-${v.vacation_number}`}>
                          <td className="pr-0" onClick={(e) => e.stopPropagation()}><Checkbox checked={selectedIds.has(v.id)} onCheckedChange={() => toggle(v.id)} /></td>
                          <td className="tabular-nums cell-strong">#{v.vacation_number}</td>
                          <td className="cell-strong">{v.person_name}</td>
                          <td className="tabular-nums whitespace-nowrap">{fmtDate(v.acquisition_start)} a {fmtDate(v.acquisition_end)}</td>
                          <td className="tabular-nums whitespace-nowrap">
                            {fmtDate(v.start_date)} a {fmtDate(v.end_date)}
                            {v.late && <span className="block text-[11px] text-red-600">fora do prazo (em dobro)</span>}
                          </td>
                          <td className="text-center tabular-nums">{v.days}{v.sell_days ? ` + ${v.sell_days} abono` : ''}</td>
                          <td className="text-right tabular-nums cell-strong">{formatMoney(v.calc?.net)}</td>
                          <td><StatusPill tone={STATUS_TONES[v.status]}>{STATUS_LABELS[v.status]}</StatusPill></td>
                          <td className="tabular-nums">{v.paid_at ? fmtDate(v.paid_at) : <span className="text-slate-400">até {fmtDate(v.payment_date)}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon={TreePalm} loading={loading} title={hasFilters ? 'Nenhuma férias encontrada' : 'Nenhuma férias programada'}
                  hint={loading ? undefined : 'Programe pela aba Saldos ou pelo botão "Programar férias"'} />
              )}
            </DataCard>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(v) => !saving && setDialogOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="hr-vacation-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base"><TreePalm className="w-5 h-5 text-primary" />{editingId ? 'Editar Férias' : 'Programar Férias'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Funcionário *</Label>
              <ContractPicker contracts={contracts} value={form.contract_id} disabled={!!editingId} testId="hr-vacation-contract"
                onChange={(id) => setForm((f) => ({ ...f, contract_id: id, acquisition_start: '' }))} />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Período aquisitivo *</Label>
              <Select value={form.acquisition_start || undefined} onValueChange={(v) => setField('acquisition_start', v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="hr-vacation-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {contractPeriods.map((p) => (
                    <SelectItem key={p.start} value={p.start}>
                      {fmtDate(p.start)} a {fmtDate(p.end)} · saldo {fmtNumber(p.balance, 1)} dias · {PERIOD_LABELS[p.status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.contract_id && !contractPeriods.length && <p className="text-[11px] text-amber-600 mt-1">Nenhum período aquisitivo completo com saldo.</p>}
            </div>
            <div>
              <Label className="mb-1.5 block">Início do gozo *</Label>
              <Input type="date" value={form.start_date} onChange={(e) => setField('start_date', e.target.value)} className="h-9 text-sm" data-testid="hr-vacation-start" />
            </div>
            <div>
              <Label className="mb-1.5 block">Dias de férias (5 a 30) *</Label>
              <Input type="number" min="5" max="30" value={form.days} onChange={(e) => setField('days', e.target.value)} className="h-9 text-sm" data-testid="hr-vacation-days" />
            </div>
            <div>
              <Label className="mb-1.5 block">Abono pecuniário (dias vendidos)</Label>
              <Input type="number" min="0" max="10" value={form.sell_days} onChange={(e) => setField('sell_days', e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1.5 block">Data do pagamento</Label>
              <Input type="date" value={form.payment_date} onChange={(e) => setField('payment_date', e.target.value)} className="h-9 text-sm" />
              <p className="text-[11px] text-slate-500 mt-1">Vazio: 2 dias antes do início (art. 145 da CLT).</p>
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <Switch checked={form.advance_13th} onCheckedChange={(v) => setField('advance_13th', v)} />
              <span className="text-sm">Adiantar a 1ª parcela do 13º junto com as férias</span>
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Observações</Label>
              <Textarea value={form.observations} onChange={(e) => setField('observations', e.target.value)} className="text-sm min-h-[50px]" />
            </div>
          </div>

          {previewError && <p className="text-sm text-destructive" data-testid="hr-vacation-preview-error">{previewError}</p>}
          {preview && (
            <div className="space-y-2" data-testid="hr-vacation-preview">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                <div className="rounded-md bg-muted p-2"><div className="text-slate-500">Gozo</div><div className="font-semibold">{fmtDate(preview.start_date)} a {fmtDate(preview.end_date)}</div></div>
                <div className="rounded-md bg-muted p-2"><div className="text-slate-500">Retorno</div><div className="font-semibold">{fmtDate(preview.return_date)}</div></div>
                <div className="rounded-md bg-muted p-2"><div className="text-slate-500">Avisar até</div><div className="font-semibold">{fmtDate(preview.notice_date)}</div></div>
                <div className="rounded-md bg-muted p-2"><div className="text-slate-500">Pagar até</div><div className="font-semibold">{fmtDate(preview.payment_date)}</div></div>
              </div>
              <table className="data-table">
                <tbody>
                  {preview.calc.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.label}</td>
                      <td className={`text-right tabular-nums ${it.kind === 'D' ? 'text-destructive' : ''}`}>{it.kind === 'D' ? '- ' : ''}{formatMoney(it.value)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Líquido</td><td className="text-right tabular-nums">{formatMoney(preview.calc.net)}</td></tr></tfoot>
              </table>
              {preview.late && <p className="text-[12px] text-red-600">O prazo de concessão deste período já passou: a lei manda pagar as férias em dobro (art. 137 da CLT). Confira com a contabilidade.</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !preview} data-testid="hr-vacation-save-btn"><Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Registrar Pagamento</DialogTitle>
            <DialogDescription>{single?.person_name} · líquido {formatMoney(single?.calc?.net)}</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block">Data do pagamento *</Label>
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="h-9 text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button>
            <Button onClick={pay}><CheckCircle2 className="w-4 h-4 mr-2" />Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
