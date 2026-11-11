import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, PlateTag, EmptyState, TablePagination, usePagination,
} from '../components/DataPage';
import { Field } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useUrlState } from '../hooks/useUrlState';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { downloadBlob } from '../lib/fiscal';
import { formatMoney } from '../lib/payables';
import { toast } from 'sonner';
import {
  CalendarClock, Plus, Pencil, Trash2, CheckCircle2, Clock, AlertTriangle, CircleDashed, History, Mail, ClipboardCheck,
  Printer, FileDown, ScanBarcode,
} from 'lucide-react';

const STATUS = {
  OVERDUE: { label: 'Vencido', tone: 'red' },
  DUE_SOON: { label: 'Vence em breve', tone: 'amber' },
  NO_HISTORY: { label: 'Sem execução', tone: 'slate' },
  OK: { label: 'Em dia', tone: 'emerald' },
};

const formatDay = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '-');
const formatKm = (km) => (km === null || km === undefined ? '-' : `${Number(km).toLocaleString('pt-BR')} km`);
const rowKey = (r) => `${r.vehicle_id}|${r.plan_id}|${r.item_id}`;

// Intervalo do item: "20.000 km ou 180 dias"
const intervalText = (item) => [
  item.interval_km ? formatKm(item.interval_km) : null,
  item.interval_days ? `${item.interval_days} dias` : null,
].filter(Boolean).join(' ou ');

// Quanto falta (ou passou) para vencer, por km e por dias
function remainingText(row) {
  const parts = [];
  if (row.km_remaining !== null && row.km_remaining !== undefined) {
    parts.push(row.km_remaining <= 0 ? `${formatKm(-row.km_remaining)} passados` : formatKm(row.km_remaining));
  }
  if (row.days_remaining !== null && row.days_remaining !== undefined) {
    parts.push(row.days_remaining < 0 ? `${-row.days_remaining} dia(s) de atraso` : `${row.days_remaining} dia(s)`);
  }
  return parts.join(' · ') || '-';
}

// Histórico das execuções de um item num veículo
function HistoryDialog({ row, onOpenChange, onChanged }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    if (!row) return;
    setLoading(true);
    api.getMaintenanceExecutions({ vehicle_id: row.vehicle_id, plan_id: row.plan_id, item_id: row.item_id, per_page: 100 })
      .then((r) => setItems(r.data.items || []))
      .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar o histórico')))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [row]);

  const remove = async (execution) => {
    if (!(await confirm(`Excluir a execução de ${formatDay(execution.executed_date)}?`))) return;
    try {
      await api.deleteMaintenanceExecution(execution.id);
      toast.success('Execução excluída');
      load();
      onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao excluir a execução'));
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico de execuções</DialogTitle>
          <DialogDescription>{row && `${row.item_name} · ${row.vehicle_plate}`}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <EmptyState loading />
        ) : items.length === 0 ? (
          <EmptyState icon={History} title="Nenhuma execução registrada" hint="Use Registrar execução quando o serviço for feito" />
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="data-table">
              <thead>
                <tr><th>Data</th><th className="!text-right">KM</th><th>OS</th><th>Observações</th><th>Registrado por</th><th aria-label="Ações" /></tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="tabular-nums whitespace-nowrap">{formatDay(e.executed_date)}</td>
                    <td className="text-right tabular-nums whitespace-nowrap">{formatKm(e.km)}</td>
                    <td>{e.service_order_number || '-'}</td>
                    <td><div className="max-w-[200px] truncate" title={e.notes || ''}>{e.notes || '-'}</div></td>
                    <td><div className="max-w-[140px] truncate">{e.created_by_name}</div></td>
                    <td>
                      <Button type="button" variant="ghost" size="icon" onClick={() => remove(e)} aria-label={`Excluir a execução de ${formatDay(e.executed_date)}`} title="Excluir execução">
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
      <ConfirmDialog />
    </Dialog>
  );
}

const EMAIL_SKIP_REASONS = {
  no_recipients: 'Informe pelo menos um e-mail',
  nothing_due: 'Nenhum item vencido ou vencendo agora: nada a enviar',
  module_disabled: 'Módulo desativado',
};

// E-mails que recebem o aviso diário das 07:00 (só administrador)
function EmailSettingsDialog({ open, onOpenChange }) {
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.getMaintenancePlanSettings().then((r) => setEmails(r.data.alert_emails || ''))
      .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar os e-mails')));
  }, [open]);

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.updateMaintenancePlanSettings({ alert_emails: emails });
      setEmails(data.alert_emails);
      toast.success('E-mails salvos');
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao salvar os e-mails'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    if (!(await save())) return;
    setBusy(true);
    try {
      const { data } = await api.sendMaintenancePlanEmail();
      if (data.sent) toast.success(`E-mail enviado para ${data.recipients.join(', ')}`);
      else toast.info(EMAIL_SKIP_REASONS[data.reason] || 'Nada a enviar');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao enviar o e-mail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Avisos por e-mail</DialogTitle>
          <DialogDescription>
            Todo dia às 07:00 os itens vencidos e vencendo são enviados para estes e-mails. Sem nada a avisar, nenhum e-mail sai.
          </DialogDescription>
        </DialogHeader>
        <Field label="E-mails" hint='Separe com ";" (ex.: oficina@empresa.com.br; frota@empresa.com.br)'>
          <Input value={emails} onChange={(e) => setEmails(e.target.value)} data-testid="plan-alert-emails" />
        </Field>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={sendNow} disabled={busy} data-testid="plan-send-email-btn">Salvar e enviar agora</Button>
          <Button type="button" onClick={async () => { if (await save()) onOpenChange(false); }} disabled={busy} data-testid="plan-save-emails-btn">Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Novo Registro de Manutenção; vindo de uma linha, já com o veículo e o item marcados
const newRecordPath = (row) => (row
  ? `/fleet/plano-manutencao/registro/new?vehicle=${row.vehicle_id}&plan=${row.plan_id}&item=${row.item_id}`
  : '/fleet/plano-manutencao/registro/new');

async function downloadPdf(request, filename) {
  try {
    const { data } = await request();
    downloadBlob(data, filename);
  } catch (error) {
    toast.error(apiErrorMessage(error, 'Erro ao gerar o PDF'));
  }
}

function StatusTab({ plans, isAdmin }) {
  const navigate = useNavigate();
  const [notInPlan, setNotInPlan] = useState(0);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useUrlState('status', '');
  const [planFilter, setPlanFilter] = useUrlState('plan', '');
  const [searchTerm, setSearchTerm] = useUrlState('term', '');
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState(null);
  const [emailsOpen, setEmailsOpen] = useState(false);

  const load = () => api.getMaintenancePlanStatus(planFilter ? { plan_id: planFilter } : {})
    .then((r) => { setRows(r.data.items || []); setSummary(r.data.summary || {}); setNotInPlan(r.data.vehicles_not_in_plan || 0); })
    .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar a situação do plano')))
    .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [planFilter]);

  // A frota inteira x itens do plano passa fácil de mil linhas: a busca espera
  // uma pausa na digitação e a tabela desenha 50 por página (clicar numa linha
  // redesenhava todas).
  const debouncedTerm = useDebouncedValue(searchTerm.trim().toUpperCase());
  const visible = useMemo(() => rows.filter((r) => (!statusFilter || r.status === statusFilter)
    && (!debouncedTerm || `${r.vehicle_plate} ${r.vehicle_model || ''} ${r.item_name}`.toUpperCase().includes(debouncedTerm))),
  [rows, statusFilter, debouncedTerm]);
  const { pageItems, paginationProps } = usePagination(visible, { pageSize: 50, resetKey: `${statusFilter}|${planFilter}|${debouncedTerm}` });
  const single = visible.find((r) => rowKey(r) === selected) || null;
  const toggle = (key) => setSelected((prev) => (prev === key ? null : key));

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Vencidos" value={summary.OVERDUE ?? 0} icon={AlertTriangle} tone="red" />
        <StatCard label="Vencendo em breve" value={summary.DUE_SOON ?? 0} icon={Clock} tone="amber" />
        <StatCard label="Sem execução registrada" value={summary.NO_HISTORY ?? 0} icon={CircleDashed} tone="blue" hint="registre a última feita" />
        <StatCard label="Em dia" value={summary.OK ?? 0} icon={CheckCircle2} tone="emerald" />
      </StatGrid>

      {notInPlan > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="vehicles-not-in-plan">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {notInPlan} veículo(s) ativo(s) do tipo de um plano não {notInPlan === 1 ? 'participa' : 'participam'} do Plano de Manutenção.
            Se {notInPlan === 1 ? 'for' : 'forem'} da frota própria, marque "Participa do Plano de Manutenção" no{' '}
            <button type="button" className="underline font-medium" onClick={() => navigate('/fleet')}>Cadastro de Veículos</button>.
          </span>
        </div>
      )}

      <FilterCard
        hasFilters={!!(searchTerm || statusFilter || planFilter)}
        onClear={() => { setSearchTerm(''); setStatusFilter(''); setPlanFilter(''); }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterField label="Placa, modelo ou item" className="sm:col-span-2">
            <SearchInput value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="search-plan-status" />
          </FilterField>
          <FilterField label="Plano">
            <Select value={planFilter || 'ALL'} onValueChange={(v) => setPlanFilter(v === 'ALL' ? '' : v)}>
              <SelectTrigger className="h-9 text-sm" data-testid="plan-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos</SelectItem>
                {plans.filter((p) => p.active).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Situação">
            <Select value={statusFilter || 'ALL'} onValueChange={(v) => setStatusFilter(v === 'ALL' ? '' : v)}>
              <SelectTrigger className="h-9 text-sm" data-testid="plan-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                {Object.entries(STATUS).map(([value, s]) => <SelectItem key={value} value={value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
        </div>
      </FilterCard>

      <DataCard
        title="Situação por veículo"
        count={visible.length.toLocaleString('pt-BR')}
        footer={<TablePagination {...paginationProps} />}
        toolbar={(
          <Toolbar
            selectedCount={single ? 1 : 0}
            primary={<ToolbarPrimary icon={ClipboardCheck} label="Registrar execução" onClick={() => navigate(newRecordPath(single))} testId="register-execution-btn" />}
          >
            <ToolbarButton icon={History} label="Histórico" onClick={() => single && setHistory(single)} disabled={!single} testId="execution-history-btn" />
            <ToolbarButton icon={Printer} label="Imprimir plano do veículo" disabled={!single} testId="print-vehicle-plan-btn"
              onClick={() => single && downloadPdf(() => api.getMaintenancePlanVehiclePdf(single.vehicle_id), `plano_manutencao_${single.vehicle_plate}.pdf`)} />
            {isAdmin && (
              <>
                <ToolbarDivider />
                <ToolbarButton icon={Mail} label="Avisos por e-mail" onClick={() => setEmailsOpen(true)} testId="plan-emails-btn" />
              </>
            )}
          </Toolbar>
        )}
      >
        {loading ? (
          <EmptyState loading />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={rows.length === 0 ? 'Nenhum veículo da frota coberto por um plano ativo' : 'Nenhum item encontrado'}
            hint={rows.length === 0 ? 'Cadastre um plano na aba Planos e marque "Participa do Plano de Manutenção" no cadastro dos veículos da frota' : 'Ajuste os filtros'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-10 pr-0" aria-label="Selecionar" />
                  <th>Placa</th>
                  <th>Item</th>
                  <th className="hidden 2xl:table-cell">Plano</th>
                  <th className="hidden lg:table-cell">Última execução</th>
                  <th className="hidden lg:table-cell">Próximo</th>
                  <th className="hidden sm:table-cell">Falta</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((r) => {
                  const key = rowKey(r);
                  const isSelected = selected === key;
                  return (
                    <tr key={key} onClick={() => toggle(key)} onDoubleClick={() => navigate(newRecordPath(r))} data-selected={isSelected} className="cursor-pointer">
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSelected} onCheckedChange={() => toggle(key)} aria-label={`Selecionar ${r.item_name} de ${r.vehicle_plate}`} />
                      </td>
                      <td>
                        <PlateTag>{r.vehicle_plate}</PlateTag>
                        {r.vehicle_model && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{r.vehicle_model}</div>}
                      </td>
                      <td>
                        <div className="cell-strong">{r.item_name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 whitespace-nowrap">a cada {intervalText(r)}</div>
                      </td>
                      <td className="hidden 2xl:table-cell">{r.plan_name}</td>
                      <td className="hidden lg:table-cell whitespace-nowrap tabular-nums">
                        {r.last_date ? formatDay(r.last_date) : '-'}
                        {r.last_km !== null && <span className="text-slate-400 dark:text-slate-500"> · {formatKm(r.last_km)}</span>}
                      </td>
                      <td className="hidden lg:table-cell whitespace-nowrap tabular-nums">
                        {[r.due_km !== null ? formatKm(r.due_km) : null, r.due_date ? formatDay(r.due_date) : null].filter(Boolean).join(' ou ') || '-'}
                      </td>
                      <td className="hidden sm:table-cell whitespace-nowrap tabular-nums">{remainingText(r)}</td>
                      <td><StatusPill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusPill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DataCard>

      <HistoryDialog row={history} onOpenChange={(open) => !open && setHistory(null)} onChanged={load} />
      {isAdmin && <EmailSettingsDialog open={emailsOpen} onOpenChange={setEmailsOpen} />}
    </div>
  );
}

const RECORD_TYPES = { PREVENTIVA: 'Preventiva', CORRETIVA: 'Corretiva' };

// Registros de Manutenção (MAN-000001): busca pelo número digitado ou lido
// pelo leitor de código de barras, reimpressão do PDF e exclusão
function RecordsTab() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useUrlState('rec', '');
  const [query, setQuery] = useState(search);
  const [selectedId, setSelectedId] = useState(null);

  const load = (term = query) => api.getMaintenanceRecords({ search: term.trim() || undefined, per_page: 100 })
    .then((r) => { setItems(r.data.items || []); setTotal(r.data.total || 0); })
    .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar os registros')))
    .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(query); }, [query]);
  // Digitando: busca depois de uma pausa; o leitor termina com Enter e busca na hora
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const single = items.find((r) => r.id === selectedId) || null;
  const toggle = (id) => setSelectedId((prev) => (prev === id ? null : id));
  const printRecord = (rec) => downloadPdf(() => api.getMaintenanceRecordPdf(rec.id), `${rec.record_code}.pdf`);

  const handleDelete = async () => {
    if (!single || !(await confirm(`Excluir o registro ${single.record_code}? Os itens do plano marcados nele voltam à situação anterior.`))) return;
    try {
      await api.deleteMaintenanceRecord(single.id);
      toast.success(`Registro ${single.record_code} excluído`);
      setSelectedId(null);
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao excluir o registro'));
    }
  };

  return (
    <div className="space-y-4">
      <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
        <FilterField label="Nº do registro (digite ou leia o código de barras), placa, oficina ou serviço">
          <div className="relative">
            <ScanBarcode className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setQuery(search); load(search); } }}
              className="h-9 text-sm pl-8"
              data-testid="search-maintenance-record"
            />
          </div>
        </FilterField>
      </FilterCard>

      <DataCard
        title="Registros de manutenção"
        count={total.toLocaleString('pt-BR')}
        toolbar={(
          <Toolbar
            selectedCount={single ? 1 : 0}
            primary={<ToolbarPrimary icon={Plus} label="Novo registro" onClick={() => navigate(newRecordPath(null))} testId="new-record-btn" />}
          >
            <ToolbarButton icon={FileDown} label="PDF do registro" onClick={() => single && printRecord(single)} disabled={!single} testId="record-pdf-btn" />
            <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={!single} testId="delete-record-btn" />
          </Toolbar>
        )}
      >
        {loading ? (
          <EmptyState loading />
        ) : items.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title={search ? 'Nenhum registro encontrado' : 'Nenhum registro de manutenção'} hint={search ? 'Confira o número ou a placa' : 'Use Novo registro quando um veículo passar pela oficina'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-10 pr-0" aria-label="Selecionar" />
                  <th>Nº</th>
                  <th>Data</th>
                  <th>Placa</th>
                  <th className="hidden md:table-cell">Tipo</th>
                  <th className="hidden lg:table-cell">Itens e serviços</th>
                  <th className="hidden xl:table-cell">Oficina / responsável</th>
                  <th className="hidden sm:table-cell !text-right">KM</th>
                  <th className="!text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const services = [...r.items.map((i) => i.item_name), ...(r.other_services ? r.other_services.split('\n').filter(Boolean) : [])];
                  return (
                    <tr key={r.id} onClick={() => toggle(r.id)} onDoubleClick={() => printRecord(r)} data-selected={selectedId === r.id} className="cursor-pointer">
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedId === r.id} onCheckedChange={() => toggle(r.id)} aria-label={`Selecionar o registro ${r.record_code}`} />
                      </td>
                      <td className="cell-strong tabular-nums whitespace-nowrap">{r.record_code}</td>
                      <td className="tabular-nums whitespace-nowrap">{formatDay(r.executed_date)}</td>
                      <td>
                        <PlateTag>{r.vehicle_plate}</PlateTag>
                        {r.vehicle_name && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{r.vehicle_name}</div>}
                      </td>
                      <td className="hidden md:table-cell">
                        <StatusPill tone={r.maintenance_type === 'CORRETIVA' ? 'amber' : 'blue'}>{RECORD_TYPES[r.maintenance_type] || r.maintenance_type}</StatusPill>
                      </td>
                      <td className="hidden lg:table-cell"><div className="max-w-[320px] truncate" title={services.join(', ')}>{services.join(', ') || '-'}</div></td>
                      <td className="hidden xl:table-cell"><div className="max-w-[200px] truncate">{r.workshop || '-'}</div></td>
                      <td className="hidden sm:table-cell text-right tabular-nums whitespace-nowrap">{r.km !== null && r.km !== undefined ? formatKm(r.km) : '-'}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{formatMoney(r.total_value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DataCard>
      <ConfirmDialog />
    </div>
  );
}

function PlansTab({ plans, vehicleTypes, loading, onChanged }) {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [selectedId, setSelectedId] = useState(null);
  const single = plans.find((p) => p.id === selectedId) || null;
  const typeLabel = (value) => vehicleTypes.find((t) => t.value === value)?.label || value;
  const toggle = (id) => setSelectedId((prev) => (prev === id ? null : id));

  const handleDelete = async () => {
    if (!single || !(await confirm(`Excluir o plano "${single.name}"?`))) return;
    try {
      await api.deleteMaintenancePlan(single.id);
      toast.success('Plano excluído');
      setSelectedId(null);
      onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao excluir o plano'));
    }
  };

  return (
    <DataCard
      title="Planos de manutenção"
      count={plans.length}
      toolbar={(
        <Toolbar
          selectedCount={single ? 1 : 0}
          primary={<ToolbarPrimary icon={Plus} label="Novo plano" onClick={() => navigate('/fleet/plano-manutencao/new')} testId="new-plan-btn" />}
        >
          <ToolbarButton icon={Pencil} label="Editar" tone="primary" onClick={() => single && navigate(`/fleet/plano-manutencao/${single.id}/edit`)} disabled={!single} testId="edit-plan-btn" />
          <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={!single} testId="delete-plan-btn" />
        </Toolbar>
      )}
    >
      {loading ? (
        <EmptyState loading />
      ) : plans.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nenhum plano cadastrado" hint="Crie um plano por tipo de veículo com os itens preventivos e seus intervalos" />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-10 pr-0" aria-label="Selecionar" />
                <th>Plano</th>
                <th>Tipos de veículo</th>
                <th className="hidden md:table-cell">Itens</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  onDoubleClick={() => navigate(`/fleet/plano-manutencao/${p.id}/edit`)}
                  data-selected={selectedId === p.id}
                  className="cursor-pointer"
                >
                  <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selectedId === p.id} onCheckedChange={() => toggle(p.id)} aria-label={`Selecionar o plano ${p.name}`} />
                  </td>
                  <td className="cell-strong">{p.name}</td>
                  <td>{p.vehicle_types.map(typeLabel).join(', ')}</td>
                  <td className="hidden md:table-cell">
                    <div className="max-w-[420px] truncate" title={p.items.map((i) => i.name).join(', ')}>
                      <span className="tabular-nums">{p.items.length}</span>: {p.items.map((i) => i.name).join(', ')}
                    </div>
                  </td>
                  <td><StatusPill tone={p.active ? 'emerald' : 'slate'}>{p.active ? 'Ativo' : 'Inativo'}</StatusPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog />
    </DataCard>
  );
}

export default function MaintenancePlansPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useUrlState('tab', 'situacao');
  const [plans, setPlans] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadPlans = () => api.getMaintenancePlans()
    .then((r) => setPlans(r.data || []))
    .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar os planos')))
    .finally(() => setLoading(false));

  useEffect(() => {
    loadPlans();
    api.getVehicleTypes().then((r) => setVehicleTypes(r.data || [])).catch(() => {});
  }, []);

  return (
    <Layout>
      <div className="space-y-4" data-testid="maintenance-plans-page">
        <PageHeader
          icon={CalendarClock}
          title="Plano de Manutenção"
          subtitle="Manutenção preventiva por tipo de veículo: cada item vence por km ou por dias, o que chegar primeiro"
        />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="situacao" data-testid="tab-plan-status">Situação</TabsTrigger>
            <TabsTrigger value="registros" data-testid="tab-records">Registros</TabsTrigger>
            <TabsTrigger value="planos" data-testid="tab-plans">Planos ({plans.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="situacao" className="mt-4">
            <StatusTab plans={plans} isAdmin={isAdmin} />
          </TabsContent>
          <TabsContent value="registros" className="mt-4">
            <RecordsTab />
          </TabsContent>
          <TabsContent value="planos" className="mt-4">
            <PlansTab plans={plans} vehicleTypes={vehicleTypes} loading={loading} onChanged={loadPlans} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
