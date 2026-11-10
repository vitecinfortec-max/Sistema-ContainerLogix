import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, PeriodFilterFields, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, PlateTag, EmptyState, TablePagination,
} from '../components/DataPage';
import { Field } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../hooks/useConfirm';
import { useUrlState } from '../hooks/useUrlState';
import { todayISO } from '../lib/dates';
import { downloadBlob } from '../lib/fiscal';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { toast } from 'sonner';
import { Handshake, Plus, Pencil, Trash2, FileDown, Lock, LockOpen, FileText, FileSpreadsheet } from 'lucide-react';

export const SETTLEMENT_STATUS = { ABERTO: 'Aberto', FECHADO: 'Fechado' };
const STATUS_TONES = { ABERTO: 'amber', FECHADO: 'emerald' };

const formatDay = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '-');
const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Saldo positivo: a empresa paga ao motorista; negativo: o motorista devolve
export function BalanceText({ value, className = '' }) {
  if (!value) return <span className={`tabular-nums text-slate-500 dark:text-slate-400 ${className}`}>{formatMoney(0)}</span>;
  const pays = value > 0;
  return (
    <span className={`tabular-nums font-semibold ${pays ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} ${className}`}
      title={pays ? 'A pagar ao motorista' : 'A devolver pelo motorista'}>
      {pays ? '' : '- '}{formatMoney(Math.abs(value))}
    </span>
  );
}

// Resultado da viagem: verde quando dá lucro (com a margem), vermelho no prejuízo
export function ResultText({ value, margin, className = '' }) {
  if (!value) return <span className={`tabular-nums text-slate-500 dark:text-slate-400 ${className}`}>{formatMoney(0)}</span>;
  const profit = value > 0;
  return (
    <span className={`tabular-nums font-semibold ${profit ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} ${className}`}
      title={profit ? 'Lucro' : 'Prejuízo'}>
      {profit ? '' : '- '}{formatMoney(Math.abs(value))}
      {profit && margin != null && <span className="ml-1 text-xs font-medium">({margin.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)</span>}
    </span>
  );
}

// Fechar = saldo pago/recebido nessa data
function CloseDialog({ settlement, onOpenChange, onDone }) {
  const [day, setDay] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (settlement) setDay(todayISO()); }, [settlement]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.closeDriverSettlement(settlement.id, true, day);
      toast.success(`Acerto nº ${settlement.settlement_number} fechado`);
      onDone();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao fechar o acerto'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!settlement} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fechar acerto nº {settlement?.settlement_number}</DialogTitle>
          <DialogDescription>
            Fechado, o acerto não pode mais ser alterado (só reabrindo). Saldo:{' '}
            <BalanceText value={settlement?.balance} />{settlement?.balance > 0 ? ' a pagar ao motorista' : settlement?.balance < 0 ? ' a devolver pelo motorista' : ''}.
          </DialogDescription>
        </DialogHeader>
        <Field label="Data do pagamento/recebimento do saldo">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} data-testid="settlement-close-date" />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={submit} disabled={busy || !day} data-testid="settlement-close-confirm">
            {busy ? 'Fechando...' : 'Fechar acerto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DriverSettlementsPage() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useUrlState('term', '');
  const [statusFilter, setStatusFilter] = useUrlState('status', '');
  const [period, setPeriod] = useUrlState('period', ['', '']);
  const debouncedSearch = useDebouncedValue(searchTerm.trim());
  const filterKey = `${debouncedSearch}|${statusFilter}|${period.join('|')}`;
  const requestSeq = useRef(0);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pagination, setPagination] = useState({ page: 1, perPage: 15, total: 0, totalPages: 0 });
  const [closing, setClosing] = useState(null);

  useEffect(() => {
    setPagination((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
  }, [filterKey]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, filterKey]);

  const load = async () => {
    try {
      const seq = ++requestSeq.current;
      const params = { page: pagination.page, per_page: pagination.perPage };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      if (period[0]) params.date_from = period[0];
      if (period[1]) params.date_to = period[1];
      const response = await api.getDriverSettlements(params);
      if (seq !== requestSeq.current) return;
      setItems(response.data.items);
      setPagination((prev) => ({ ...prev, total: response.data.total, totalPages: response.data.pages }));
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao carregar os acertos'));
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAllOnPage = () => {
    const pageIds = items.map((i) => i.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };
  const single = selectedIds.size === 1 ? items.find((i) => i.id === [...selectedIds][0]) : null;
  const singleOpen = single && single.status !== 'FECHADO';

  const handleDelete = async () => {
    if (!singleOpen || !(await confirm(`Excluir o acerto nº ${single.settlement_number}?`))) return;
    try {
      await api.deleteDriverSettlement(single.id);
      toast.success('Acerto excluído');
      setSelectedIds(new Set());
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao excluir o acerto'));
    }
  };

  const handleReopen = async () => {
    if (!single || single.status !== 'FECHADO') return;
    if (!(await confirm(`Reabrir o acerto nº ${single.settlement_number}? A data do fechamento será apagada.`))) return;
    try {
      await api.closeDriverSettlement(single.id, false);
      toast.success('Acerto reaberto');
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao reabrir o acerto'));
    }
  };

  const handlePdf = async () => {
    if (!single) return;
    try {
      const response = await api.getDriverSettlementPdf(single.id);
      downloadBlob(response.data, `acerto_viagem_${single.settlement_number}.pdf`);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao gerar o PDF do acerto'));
    }
  };

  // Relatório de acertos com os filtros da tela (Receita, Custo, Resultado, Margem)
  const [reporting, setReporting] = useState(false);
  const handleReport = async (format) => {
    setReporting(true);
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      if (period[0]) params.date_from = period[0];
      if (period[1]) params.date_to = period[1];
      const response = await api.downloadDriverSettlementsReport(format, params);
      downloadBlob(response.data, `relatorio_acertos_viagem.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao gerar o relatório'));
    } finally {
      setReporting(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="driver-settlements-page">
        <PageHeader
          icon={Handshake}
          title="Acerto da Viagem"
          subtitle="Prestação de contas da viagem: saldo com o motorista e resultado (lucro ou prejuízo) de cada acerto"
        />

        <FilterCard
          hasFilters={!!(searchTerm || statusFilter || period[0] || period[1])}
          onClear={() => { setSearchTerm(''); setStatusFilter(''); setPeriod(['', '']); }}
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => handleReport('pdf')} disabled={reporting} className="h-8 text-xs gap-1.5" data-testid="settlements-report-pdf">
                <FileText className="w-4 h-4 text-red-600" /> Relatório PDF
              </Button>
              <Button type="button" size="sm" onClick={() => handleReport('excel')} disabled={reporting} className="h-8 text-xs gap-1.5" data-testid="settlements-report-excel">
                <FileSpreadsheet className="w-4 h-4" /> Relatório Excel
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <FilterField label="Nº, motorista, placa ou observação" className="sm:col-span-2">
              <SearchInput value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="search-settlement" />
            </FilterField>
            <FilterField label="Situação">
              <Select value={statusFilter || 'ALL'} onValueChange={(v) => setStatusFilter(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="settlement-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  {Object.entries(SETTLEMENT_STATUS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <PeriodFilterFields value={period} onChange={setPeriod} testIdPrefix="settlement" />
          </div>
        </FilterCard>

        <DataCard
          title="Acertos"
          count={pagination.total.toLocaleString('pt-BR')}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo acerto" onClick={() => navigate('/driver-settlements/new')} testId="new-settlement-btn" />}
            >
              <ToolbarButton icon={Pencil} label={single?.status === 'FECHADO' ? 'Ver' : 'Editar'} tone="primary" onClick={() => single && navigate(`/driver-settlements/${single.id}/edit`)} disabled={!single} testId="edit-settlement-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={!singleOpen} testId="delete-settlement-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={Lock} label="Fechar acerto" tone="primary" onClick={() => singleOpen && setClosing(single)} disabled={!singleOpen} testId="close-settlement-btn" />
              <ToolbarButton icon={LockOpen} label="Reabrir" onClick={handleReopen} disabled={!single || single.status !== 'FECHADO'} testId="reopen-settlement-btn" />
              <ToolbarButton icon={FileDown} label="PDF" onClick={handlePdf} disabled={!single} testId="settlement-pdf-btn" />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.total}
              pageSize={pagination.perPage}
              onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
            />
          )}
        >
          {loading ? (
            <EmptyState loading />
          ) : items.length === 0 ? (
            <EmptyState icon={Handshake} title="Nenhum acerto encontrado" hint="Ajuste os filtros ou faça um novo acerto" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={items.length > 0 && items.every((i) => selectedIds.has(i.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        aria-label="Selecionar todos da página"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Motorista</th>
                    <th className="hidden md:table-cell">Veículo</th>
                    <th className="hidden xl:table-cell !text-right">Km</th>
                    <th className="hidden lg:table-cell !text-right">Receita</th>
                    <th className="hidden lg:table-cell !text-right">Custo</th>
                    <th className="!text-right">Resultado</th>
                    <th className="!text-right">Saldo motorista</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => toggleSelect(s.id)}
                      onDoubleClick={() => navigate(`/driver-settlements/${s.id}/edit`)}
                      data-selected={selectedIds.has(s.id)}
                      className="cursor-pointer"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(s.id)} onCheckedChange={() => toggleSelect(s.id)} aria-label={`Selecionar acerto ${s.settlement_number}`} />
                      </td>
                      <td className="cell-strong tabular-nums">{s.settlement_number}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatDay(s.settlement_date)}</td>
                      <td><div className="max-w-[200px] truncate">{s.driver_name}</div></td>
                      <td className="hidden md:table-cell">{s.vehicle_plate ? <PlateTag>{s.vehicle_plate}</PlateTag> : '-'}</td>
                      <td className="hidden xl:table-cell text-right tabular-nums">{(s.km_total || 0).toLocaleString('pt-BR')}</td>
                      <td className="hidden lg:table-cell text-right tabular-nums whitespace-nowrap">{formatMoney(s.revenue)}</td>
                      <td className="hidden lg:table-cell text-right tabular-nums whitespace-nowrap">{formatMoney(s.cost_total)}</td>
                      <td className="text-right whitespace-nowrap" data-testid={`settlement-result-${s.settlement_number}`}><ResultText value={s.result} margin={s.margin} /></td>
                      <td className="text-right whitespace-nowrap"><BalanceText value={s.balance} /></td>
                      <td><StatusPill tone={STATUS_TONES[s.status] || 'slate'}>{SETTLEMENT_STATUS[s.status] || s.status}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <CloseDialog settlement={closing} onOpenChange={(open) => !open && setClosing(null)} onDone={() => { setClosing(null); load(); }} />
      <ConfirmDialog />
    </Layout>
  );
}
