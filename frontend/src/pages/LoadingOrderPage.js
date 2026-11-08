import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination, usePagination,
  rowTone,
} from '../components/DataPage';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, PackageCheck, Printer, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { toLocalDay } from '../lib/dates';
import { useUrlState } from '../hooks/useUrlState';
import { apiErrorMessage } from '../lib/errors';
import { ORDER_TYPE_OPTIONS, STATUS_OPTIONS, downloadLoadingOrderPdf } from '../lib/loadingOrders';

const STATUS_LABELS = STATUS_OPTIONS.reduce((acc, [v, l]) => { acc[v] = l; return acc; }, {});
const STATUS_TONES = {
  PENDENTE: 'amber',
  APROVADA: 'emerald',
  CANCELADA: 'red',
};

export default function LoadingOrderPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useUrlState('search', '');
  const [statusFilter, setStatusFilter] = useUrlState('status', '');
  const [typeFilter, setTypeFilter] = useUrlState('type', '');
  const [dateFrom, setDateFrom] = useUrlState('dateFrom', '');
  const [dateTo, setDateTo] = useUrlState('dateTo', '');
  // Status, tipo e período filtram a lista já carregada (a busca vai ao servidor)
  const filtered = list.filter((o) => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (typeFilter && (o.order_type || 'COLETA') !== typeFilter) return false;
    if (dateFrom || dateTo) {
      const day = o.created_at ? toLocalDay(new Date(o.created_at)) : '';
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
    }
    return true;
  });
  const { pageItems, paginationProps } = usePagination(filtered, { resetKey: `${search}|${statusFilter}|${typeFilter}|${dateFrom}|${dateTo}` });
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const debounceRef = useRef(null);

  useEffect(() => { loadList(); }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadList(); }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search]);

  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      const r = await api.getLoadingOrders(params);
      setList(r.data || []);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao carregar ordens de carregamento'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, num, status) => {
    const note = status === 'APROVADA' ? ' O Pagamento Frete ainda pendente desta ordem será cancelado e a EIR de saída será desfeita.' : '';
    if (!(await confirm(`Excluir Ordem de Carregamento Nº ${num}?${note}`))) return;
    try {
      const response = await api.deleteLoadingOrder(id);
      toast.success('Ordem de Carregamento excluída');
      (response.data?.movement_notes || []).forEach((item) => toast.info(item));
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadList();
    } catch (e) { toast.error(apiErrorMessage(e, 'Erro ao excluir')); }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = pageItems.map((o) => o.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const singleSelectedOrder = selectedIds.size === 1 ? list.find((o) => o.id === [...selectedIds][0]) : null;
  const countByStatus = (status) => filtered.filter((o) => o.status === status).length;
  const hasFilters = !!(search || statusFilter || typeFilter || dateFrom || dateTo);
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setTypeFilter('');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="loading-order-page">
        <PageHeader icon={PackageCheck} title="Ordem de Carregamento" subtitle="Minutas de coleta e entrega de container pro motorista" />

        <StatGrid>
          <StatCard label="Ordens" value={filtered.length} icon={PackageCheck} tone="blue" hint={hasFilters ? 'com os filtros atuais' : 'cadastradas'} />
          <StatCard label="Pendentes" value={countByStatus('PENDENTE')} icon={Clock} tone="amber" hint="aguardando aprovação" />
          <StatCard label="Aprovadas" value={countByStatus('APROVADA')} icon={CheckCircle2} tone="primary" hint="movimentação gerada" />
          <StatCard label="Canceladas" value={countByStatus('CANCELADA')} icon={XCircle} tone="red" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={clearFilters}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <FilterField label="Nº, container, motorista, cliente ou booking" className="col-span-2 lg:col-span-1">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="loading-order-search" />
            </FilterField>
            <FilterField label="Status">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="loading-order-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {STATUS_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Tipo">
              <Select value={typeFilter || '_all'} onValueChange={(v) => setTypeFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="loading-order-type-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {ORDER_TYPE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Emissão inicial">
              <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="loading-order-date-from" />
            </FilterField>
            <FilterField label="Emissão final">
              <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="loading-order-date-to" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma ordem pra habilitar as ações da barra */}
        <DataCard
          title="Ordens de carregamento"
          count={loading ? '...' : filtered.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova ordem" onClick={() => navigate('/loading-orders/new')} testId="loading-order-new-btn" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedOrder && navigate(`/loading-orders/${singleSelectedOrder.id}/edit`)} disabled={!singleSelectedOrder} />
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedOrder && downloadLoadingOrderPdf(singleSelectedOrder.id, singleSelectedOrder.order_number)} disabled={!singleSelectedOrder} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedOrder && handleDelete(singleSelectedOrder.id, singleSelectedOrder.order_number, singleSelectedOrder.status)} disabled={!singleSelectedOrder} />
            </Toolbar>
          )}
          footer={<TablePagination {...paginationProps} />}
        >
          {filtered.length === 0 && !loading ? (
            <EmptyState
              icon={PackageCheck}
              title={hasFilters ? 'Nenhuma ordem encontrada' : 'Nenhuma ordem de carregamento cadastrada'}
              hint={hasFilters ? 'Ajuste os filtros' : 'Cadastre a primeira pelo botão "Nova ordem"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={pageItems.length > 0 && pageItems.every((o) => selectedIds.has(o.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Tipo</th>
                    <th>Container</th>
                    <th>Motorista</th>
                    <th>Transportadora</th>
                    <th>Rota</th>
                    <th>Status</th>
                    <th>Emissão</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => toggleSelect(o.id)}
                      onDoubleClick={() => navigate(`/loading-orders/${o.id}/edit`)}
                      data-selected={selectedIds.has(o.id)}
                      data-row-tone={rowTone(o.status === 'CANCELADA' ? 'off' : null)}
                      className="cursor-pointer"
                      data-testid={`loading-order-row-${o.order_number}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(o.id)}
                          onCheckedChange={() => toggleSelect(o.id)}
                          data-testid={`loading-order-row-checkbox-${o.order_number}`}
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{o.order_number}</td>
                      <td>
                        <StatusPill tone={o.order_type === 'ENTREGA' ? 'violet' : 'blue'} dot={false}>
                          {o.order_type === 'ENTREGA' ? 'Entrega' : 'Coleta'}
                        </StatusPill>
                      </td>
                      <td className="font-mono whitespace-nowrap text-slate-700 dark:text-slate-200">
                        {o.items && o.items.length > 0
                          ? `${o.items[0].container_number || '-'}${o.items.length > 1 ? ` +${o.items.length - 1}` : ''}`
                          : '-'}
                      </td>
                      <td><div className="max-w-[200px] truncate" title={o.driver_name || ''}>{o.driver_name || '-'}</div></td>
                      <td><div className="max-w-[200px] truncate" title={o.transport_company || ''}>{o.transport_company || '-'}</div></td>
                      <td><div className="max-w-[200px] truncate" title={o.route_name || ''}>{o.route_name || '-'}</div></td>
                      <td>
                        <StatusPill tone={STATUS_TONES[o.status] || 'slate'}>
                          {STATUS_LABELS[o.status] || o.status}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{o.created_at ? format(new Date(o.created_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <ConfirmDialog />
    </Layout>
  );
}

