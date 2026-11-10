import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, PeriodFilterFields, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, PlateTag, EmptyState, TablePagination,
} from '../components/DataPage';
import PeriodReportDialog from '../components/PeriodReportDialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../hooks/useConfirm';
import { useUrlState } from '../hooks/useUrlState';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { toast } from 'sonner';
import { AlertOctagon, Plus, Pencil, Trash2, FileBarChart, Tags, Camera } from 'lucide-react';

const OCCURRENCE_STATUS = { ABERTA: 'Aberta', RESOLVIDA: 'Resolvida' };
const STATUS_TONES = { ABERTA: 'amber', RESOLVIDA: 'emerald' };

const formatDay = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '-');
// O select do relatório não aceita valor vazio: "Todos" vai como ALL e sai aqui
const reportParams = ({ type_id: typeId, ...rest }) => (typeId && typeId !== 'ALL' ? { ...rest, type_id: typeId } : rest);

const formatMoney = (value) => (value ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-');

// Cadastro dos tipos de ocorrência, aberto pela barra da lista
function OccurrenceTypesDialog({ open, onOpenChange, types, onChanged }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action, success) => {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      await onChanged();
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao salvar o tipo de ocorrência'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!newName.trim()) return;
    if (await run(() => api.createTransportOccurrenceType({ name: newName, active: true }), 'Tipo cadastrado')) setNewName('');
  };
  const rename = (type, name) => {
    if (name.trim() && name.trim() !== type.name) run(() => api.updateTransportOccurrenceType(type.id, { name, active: type.active }));
  };
  const remove = async (type) => {
    if (!(await confirm(`Excluir o tipo "${type.name}"?`))) return;
    run(() => api.deleteTransportOccurrenceType(type.id), 'Tipo excluído');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tipos de Ocorrência</DialogTitle>
          <DialogDescription>Renomeie, desative (some da lista ao lançar) ou cadastre novos tipos.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            aria-label="Nome do novo tipo"
            data-testid="new-occurrence-type-input"
          />
          <Button type="button" onClick={add} disabled={busy || !newName.trim()} data-testid="add-occurrence-type-btn">
            <Plus className="w-4 h-4 mr-1" /> Adicionar tipo
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {types.map((type) => (
            <div key={type.id} className="flex items-center gap-2 py-2">
              <Input
                defaultValue={type.name}
                onBlur={(e) => rename(type, e.target.value)}
                className={type.active ? '' : 'text-slate-400'}
                aria-label={`Nome do tipo ${type.name}`}
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                <Checkbox
                  checked={type.active}
                  onCheckedChange={(v) => run(() => api.updateTransportOccurrenceType(type.id, { name: type.name, active: !!v }))}
                  disabled={busy}
                />
                Ativo
              </label>
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(type)} disabled={busy} aria-label={`Excluir o tipo ${type.name}`} title="Excluir tipo">
                <Trash2 className="w-4 h-4 text-red-600" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
      <ConfirmDialog />
    </Dialog>
  );
}

export default function TransportOccurrencesPage() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useUrlState('term', '');
  const [statusFilter, setStatusFilter] = useUrlState('status', '');
  const [typeFilter, setTypeFilter] = useUrlState('type', '');
  const [period, setPeriod] = useUrlState('period', ['', '']);
  const debouncedSearch = useDebouncedValue(searchTerm.trim());
  const filterKey = `${debouncedSearch}|${statusFilter}|${typeFilter}|${period.join('|')}`;
  const requestSeq = useRef(0);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pagination, setPagination] = useState({ page: 1, perPage: 15, total: 0, totalPages: 0 });
  const [typesOpen, setTypesOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const loadTypes = () => api.getTransportOccurrenceTypes()
    .then((r) => setTypes(r.data || []))
    .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar os tipos de ocorrência')));

  useEffect(() => { loadTypes(); }, []);

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
      if (typeFilter) params.type_id = typeFilter;
      if (period[0]) params.date_from = period[0];
      if (period[1]) params.date_to = period[1];
      const response = await api.getTransportOccurrences(params);
      if (seq !== requestSeq.current) return;
      setItems(response.data.items);
      setPagination((prev) => ({ ...prev, total: response.data.total, totalPages: response.data.pages }));
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao carregar ocorrências'));
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

  const handleDelete = async () => {
    if (!single || !(await confirm(`Excluir a ocorrência nº ${single.occurrence_number}?`))) return;
    try {
      await api.deleteTransportOccurrence(single.id);
      toast.success('Ocorrência excluída');
      setSelectedIds(new Set());
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao excluir ocorrência'));
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="transport-occurrences-page">
        <PageHeader
          icon={AlertOctagon}
          title="Ocorrências de Transporte"
          subtitle="Atrasos, avarias, sinistros, multas e outros problemas durante o transporte"
        />

        <FilterCard
          hasFilters={!!(searchTerm || statusFilter || typeFilter || period[0] || period[1])}
          onClear={() => { setSearchTerm(''); setStatusFilter(''); setTypeFilter(''); setPeriod(['', '']); }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Nº, placa, motorista, local ou descrição" className="sm:col-span-2">
              <SearchInput value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="search-occurrence" />
            </FilterField>
            <FilterField label="Tipo">
              <Select value={typeFilter || 'ALL'} onValueChange={(v) => setTypeFilter(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="occurrence-type-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Situação">
              <Select value={statusFilter || 'ALL'} onValueChange={(v) => setStatusFilter(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="occurrence-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  {Object.entries(OCCURRENCE_STATUS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <PeriodFilterFields value={period} onChange={setPeriod} testIdPrefix="occurrence" />
          </div>
        </FilterCard>

        <DataCard
          title="Ocorrências"
          count={pagination.total.toLocaleString('pt-BR')}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova ocorrência" onClick={() => navigate('/transport-occurrences/new')} testId="new-occurrence-btn" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="primary" onClick={() => single && navigate(`/transport-occurrences/${single.id}/edit`)} disabled={!single} testId="edit-occurrence-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={!single} testId="delete-occurrence-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={FileBarChart} label="Relatório" onClick={() => setReportOpen(true)} testId="occurrence-report-btn" />
              <ToolbarButton icon={Tags} label="Tipos de ocorrência" onClick={() => setTypesOpen(true)} testId="occurrence-types-btn" />
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
            <EmptyState icon={AlertOctagon} title="Nenhuma ocorrência encontrada" hint="Ajuste os filtros ou registre uma nova ocorrência" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={items.length > 0 && items.every((i) => selectedIds.has(i.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        aria-label="Selecionar todas da página"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th className="hidden md:table-cell">Placa</th>
                    <th className="hidden lg:table-cell">Motorista</th>
                    <th className="hidden lg:table-cell">Ordem</th>
                    <th className="hidden xl:table-cell">Descrição</th>
                    <th className="hidden md:table-cell !text-right">Custo</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((occ) => (
                    <tr
                      key={occ.id}
                      onClick={() => toggleSelect(occ.id)}
                      onDoubleClick={() => navigate(`/transport-occurrences/${occ.id}/edit`)}
                      data-selected={selectedIds.has(occ.id)}
                      className="cursor-pointer"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(occ.id)} onCheckedChange={() => toggleSelect(occ.id)} aria-label={`Selecionar ocorrência ${occ.occurrence_number}`} />
                      </td>
                      <td className="cell-strong tabular-nums">{occ.occurrence_number}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {formatDay(occ.occurred_date)}
                        {occ.occurred_time && <span className="text-slate-400 dark:text-slate-500"> {occ.occurred_time}</span>}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {occ.type_name}
                          {occ.photos?.length > 0 && <Camera className="w-3.5 h-3.5 text-slate-400" aria-label={`${occ.photos.length} foto(s)`} />}
                        </div>
                      </td>
                      <td className="hidden md:table-cell">{occ.vehicle_plate ? <PlateTag>{occ.vehicle_plate}</PlateTag> : '-'}</td>
                      <td className="hidden lg:table-cell"><div className="max-w-[180px] truncate">{occ.driver_name || '-'}</div></td>
                      <td className="hidden lg:table-cell tabular-nums">{occ.loading_order_number || '-'}</td>
                      <td className="hidden xl:table-cell"><div className="max-w-[280px] truncate" title={occ.description}>{occ.description}</div></td>
                      <td className="hidden md:table-cell text-right tabular-nums whitespace-nowrap">{formatMoney(occ.cost)}</td>
                      <td><StatusPill tone={STATUS_TONES[occ.status] || 'slate'}>{OCCURRENCE_STATUS[occ.status] || occ.status}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <OccurrenceTypesDialog open={typesOpen} onOpenChange={setTypesOpen} types={types} onChanged={async () => { await loadTypes(); load(); }} />

      <PeriodReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Relatório de Ocorrências de Transporte"
        description="Ocorrências do período pela data em que aconteceram, com o resumo por tipo e o custo total."
        periodLabel="Data da ocorrência"
        statuses={[{ value: '', label: 'Todas' }, { value: 'ABERTA', label: 'Abertas' }, { value: 'RESOLVIDA', label: 'Resolvidas' }]}
        selects={[{ key: 'type_id', label: 'Tipo', options: [{ value: 'ALL', label: 'Todos' }, ...types.map((t) => ({ value: t.id, label: t.name }))] }]}
        textFilters={[{ key: 'search', label: 'Placa, motorista ou descrição' }]}
        load={(p) => api.getTransportOccurrenceReport(reportParams(p))}
        summarize={(d) => [
          ['Ocorrências', d.summary.total],
          ['Abertas', d.summary.open],
          ['Resolvidas', d.summary.resolved],
          ['Custo total', d.summary.cost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })],
        ]}
        downloadPdf={(p) => api.getTransportOccurrenceReportPdf(reportParams(p))}
        downloadExcel={(p) => api.getTransportOccurrenceReportExcel(reportParams(p))}
        filename="relatorio_ocorrencias"
      />
      <ConfirmDialog />
    </Layout>
  );
}
