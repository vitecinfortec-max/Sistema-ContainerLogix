import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Eye, Pencil, Trash2, Package, TrendingUp, TrendingDown, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function FlexTankPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const location = useLocation();
  const [movements, setMovements] = useState([]);
  const [stock, setStock] = useState({ total_bags: 0, total_entries: 0, total_exits: 0, by_client: [], by_size: [] });
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Ler tab da URL
  const searchParams = new URLSearchParams(location.search);
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(tabFromUrl === 'reports' ? 'reports' : 'movements');
  
  // Atualizar activeTab quando a URL mudar
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    setActiveTab(tab === 'reports' ? 'reports' : 'movements');
  }, [location.search]);
  
  // Atualizar URL quando mudar a tab
  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    if (newTab === 'reports') {
      navigate('/flex-tank?tab=reports', { replace: true });
    } else {
      navigate('/flex-tank', { replace: true });
    }
  };
  
  // Filtros
  const [filters, setFilters] = useState({
    start_date: '',
    end_date: '',
    client_id: '',
    movement_number: '',
    movement_type: ''
  });
  const [appliedFilters, setAppliedFilters] = useState({});
  
  // Filtros de Relatório
  const [reportFilters, setReportFilters] = useState({
    start_date: '',
    end_date: '',
    client_id: '',
    movement_type: ''
  });
  
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: 20,
    total: 0,
    totalPages: 0
  });
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    loadClients();
  }, []);

  useEffect(() => {
    loadMovements();
    loadStock();
  }, [pagination.page, appliedFilters]);

  const loadClients = async () => {
    try {
      const response = await api.getClients();
      setClients(response.data);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
      toast.error('Erro ao carregar clientes');
    }
  };

  const loadMovements = async () => {
    try {
      const params = {
        page: pagination.page,
        per_page: pagination.perPage,
        ...appliedFilters
      };
      
      // Remover parâmetros vazios
      Object.keys(params).forEach(key => {
        if (!params[key]) delete params[key];
      });
      
      const response = await api.getFlexTankMovements(params);
      setMovements(response.data.items);
      setPagination(prev => ({
        ...prev,
        total: response.data.total,
        totalPages: response.data.total_pages
      }));
    } catch (error) {
      toast.error('Erro ao carregar movimentações');
    } finally {
      setLoading(false);
    }
  };

  const loadStock = async () => {
    try {
      const params = appliedFilters.client_id ? { client_id: appliedFilters.client_id } : {};
      const response = await api.getFlexTankStock(params);
      setStock(response.data);
    } catch (error) {
      console.error('Erro ao carregar estoque:', error);
      toast.error('Erro ao carregar estoque');
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir esta movimentação?'))) return;

    try {
      await api.deleteFlexTankMovement(id);
      toast.success('Movimentação excluída com sucesso!');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadMovements();
      loadStock();
    } catch (error) {
      toast.error('Erro ao excluir movimentação');
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = movements.map(m => m.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const singleSelectedId = selectedIds.size === 1 ? [...selectedIds][0] : null;

  const applyFilters = () => {
    setAppliedFilters({ ...filters });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({
      start_date: '',
      end_date: '',
      client_id: '',
      movement_number: '',
      movement_type: ''
    });
    setAppliedFilters({});
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const downloadReport = async () => {
    try {
      // Usar os filtros de relatório específicos
      const reportParams = {};
      if (reportFilters.start_date) reportParams.start_date = reportFilters.start_date;
      if (reportFilters.end_date) reportParams.end_date = reportFilters.end_date;
      if (reportFilters.client_id) reportParams.client_id = reportFilters.client_id;
      if (reportFilters.movement_type) reportParams.movement_type = reportFilters.movement_type;
      
      const response = await api.downloadFlexTankReport(reportParams);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `relatorio_flex_tank_${format(new Date(), 'dd-MM-yyyy_HH-mm')}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório baixado com sucesso!');
    } catch (error) {
      toast.error('Erro ao baixar relatório');
    }
  };

  const clearReportFilters = () => {
    setReportFilters({
      start_date: '',
      end_date: '',
      client_id: '',
      movement_type: ''
    });
  };

  const getSelectedClientName = () => {
    if (!appliedFilters.client_id) return null;
    const client = clients.find(c => c.id === appliedFilters.client_id);
    return client?.name || 'Cliente selecionado';
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="flex-tank-page">
        <PageHeader
          icon={Package}
          title="Flex Tank"
          subtitle={activeTab === 'reports' ? 'Relatórios de estoque de bolsas' : 'Controle de estoque de bolsas'}
        />

        {/* Dashboard de Estoque */}
        <StatGrid className="lg:grid-cols-3">
          <StatCard
            label={appliedFilters.client_id ? `Estoque - ${getSelectedClientName()}` : 'Estoque total'}
            value={stock.total_bags}
            icon={Package}
            tone="blue"
            hint="bolsas disponíveis"
          />
          <StatCard label="Total de entradas" value={stock.total_entries} icon={TrendingUp} tone="primary" hint="bolsas recebidas" />
          <StatCard label="Total de saídas" value={stock.total_exits} icon={TrendingDown} tone="amber" hint="bolsas expedidas" />
        </StatGrid>

        {/* Conteúdo baseado na tab ativa (sem mostrar as abas visuais) */}
        {activeTab === 'movements' && (
          <>
            <FilterCard hasFilters={Object.values(filters).some(Boolean)} onClear={clearFilters} onApply={applyFilters}>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <FilterField label="Data inicial">
                  <Input
                    type="date"
                    value={filters.start_date}
                    onChange={(e) => setFilters(prev => ({ ...prev, start_date: e.target.value }))}
                    className="h-9 text-sm"
                  />
                </FilterField>
                <FilterField label="Data final">
                  <Input
                    type="date"
                    value={filters.end_date}
                    onChange={(e) => setFilters(prev => ({ ...prev, end_date: e.target.value }))}
                    className="h-9 text-sm"
                  />
                </FilterField>
                <FilterField label="Cliente">
                  <Select
                    value={filters.client_id || 'all'}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, client_id: value === 'all' ? '' : value }))}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {clients.map(client => (
                        <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="Nº registro">
                  <Input
                    type="number"
                    value={filters.movement_number}
                    onChange={(e) => setFilters(prev => ({ ...prev, movement_number: e.target.value }))}
                    className="h-9 text-sm"
                  />
                </FilterField>
                <FilterField label="Tipo">
                  <Select
                    value={filters.movement_type || 'all'}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, movement_type: value === 'all' ? '' : value }))}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="ENTRADA">Entrada</SelectItem>
                      <SelectItem value="SAIDA">Saída</SelectItem>
                    </SelectContent>
                  </Select>
                </FilterField>
              </div>
            </FilterCard>

            {/* Lista - marque uma movimentação pra habilitar as ações da barra */}
            <DataCard
              title="Movimentações"
              count={pagination.total.toLocaleString('pt-BR')}
              toolbar={(
                <Toolbar
                  selectedCount={selectedIds.size}
                  primary={<ToolbarPrimary icon={Plus} label="Nova movimentação" onClick={() => navigate('/flex-tank/movements/new')} testId="new-movement-btn" />}
                >
                  <ToolbarButton icon={Eye} label="Visualizar" tone="primary" onClick={() => singleSelectedId && navigate(`/flex-tank/movements/${singleSelectedId}`)} disabled={!singleSelectedId} testId="view-movement-button" />
                  <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedId && navigate(`/flex-tank/movements/${singleSelectedId}/edit`)} disabled={!singleSelectedId} testId="edit-movement-button" />
                  <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedId && handleDelete(singleSelectedId)} disabled={!singleSelectedId} testId="delete-movement-button" />
                </Toolbar>
              )}
              footer={(
                <TablePagination
                  currentPage={pagination.page}
                  totalPages={pagination.totalPages}
                  totalItems={pagination.total}
                  pageSize={pagination.perPage}
                  onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
                />
              )}
            >
              {loading ? (
                <EmptyState title="Carregando..." />
              ) : movements.length === 0 ? (
                <EmptyState icon={Package} title="Nenhuma movimentação encontrada" hint="Ajuste os filtros ou registre uma nova movimentação" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="w-10 pr-0">
                          <Checkbox
                            checked={movements.length > 0 && movements.every(m => selectedIds.has(m.id))}
                            onCheckedChange={toggleSelectAllOnPage}
                            data-testid="select-all-checkbox"
                          />
                        </th>
                        <th>Nº</th>
                        <th>Nº bolsa</th>
                        <th>Tamanho</th>
                        <th>Data</th>
                        <th>Tipo</th>
                        <th>Cliente</th>
                        <th>Container</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((movement) => (
                        <tr
                          key={movement.id}
                          onClick={() => toggleSelect(movement.id)}
                          data-selected={selectedIds.has(movement.id)}
                          className="cursor-pointer"
                          data-testid={`movement-row-${movement.id}`}
                        >
                          <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(movement.id)}
                              onCheckedChange={() => toggleSelect(movement.id)}
                              data-testid="movement-row-checkbox"
                            />
                          </td>
                          <td className="cell-strong whitespace-nowrap tabular-nums">#{movement.movement_number}</td>
                          <td className="font-mono whitespace-nowrap">{movement.bag_number}</td>
                          <td className="whitespace-nowrap">{movement.bag_size}</td>
                          <td className="whitespace-nowrap tabular-nums">{format(new Date(movement.movement_date), 'dd/MM/yyyy', { locale: ptBR })}</td>
                          <td>
                            <StatusPill tone={movement.movement_type === 'ENTRADA' ? 'primary' : 'amber'}>
                              {movement.movement_type === 'ENTRADA' ? 'Entrada' : 'Saída'}
                            </StatusPill>
                          </td>
                          <td><div className="max-w-[260px] truncate" title={movement.client_name || ''}>{movement.client_name || '-'}</div></td>
                          <td className="font-mono whitespace-nowrap text-slate-700 dark:text-slate-200">{movement.container_number || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DataCard>
          </>
        )}

        {activeTab === 'reports' && (
          <>
            <FilterCard
              hasFilters={!!(reportFilters.start_date || reportFilters.end_date || reportFilters.client_id || reportFilters.movement_type)}
              onClear={clearReportFilters}
              clearLinkTestId="clear-report-filters-btn"
              actions={(
                <Button type="button" size="sm" onClick={downloadReport} className="h-8 text-xs gap-1.5" data-testid="download-report-btn">
                  <FileSpreadsheet className="w-4 h-4" /> Baixar Excel
                </Button>
              )}
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <FilterField label="Data início">
                  <Input
                    type="date"
                    value={reportFilters.start_date}
                    onChange={(e) => setReportFilters(prev => ({ ...prev, start_date: e.target.value }))}
                    className="h-9 text-sm"
                    data-testid="report-filter-start-date"
                  />
                </FilterField>
                <FilterField label="Data fim">
                  <Input
                    type="date"
                    value={reportFilters.end_date}
                    onChange={(e) => setReportFilters(prev => ({ ...prev, end_date: e.target.value }))}
                    className="h-9 text-sm"
                    data-testid="report-filter-end-date"
                  />
                </FilterField>
                <FilterField label="Cliente">
                  <Select
                    value={reportFilters.client_id || 'all'}
                    onValueChange={(value) => setReportFilters(prev => ({ ...prev, client_id: value === 'all' ? '' : value }))}
                  >
                    <SelectTrigger className="h-9 text-sm" data-testid="report-filter-client">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os clientes</SelectItem>
                      {clients.map(client => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="Tipo">
                  <Select
                    value={reportFilters.movement_type || 'all'}
                    onValueChange={(value) => setReportFilters(prev => ({ ...prev, movement_type: value === 'all' ? '' : value }))}
                  >
                    <SelectTrigger className="h-9 text-sm" data-testid="report-filter-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os tipos</SelectItem>
                      <SelectItem value="ENTRADA">Entrada</SelectItem>
                      <SelectItem value="SAIDA">Saída</SelectItem>
                    </SelectContent>
                  </Select>
                </FilterField>
              </div>
            </FilterCard>

            {/* Estoque por Cliente / por Tamanho */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[
                { title: 'Estoque por cliente', rows: stock.by_client, nameKey: 'client_name', nameLabel: 'Cliente' },
                { title: 'Estoque por tamanho', rows: stock.by_size, nameKey: 'size', nameLabel: 'Tamanho' },
              ].map(({ title, rows, nameKey, nameLabel }) => (
                <DataCard key={title} title={title} count={rows.length}>
                  {rows.length === 0 ? (
                    <EmptyState title="Nenhum dado disponível" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>{nameLabel}</th>
                            <th className="!text-right">Entradas</th>
                            <th className="!text-right">Saídas</th>
                            <th className="!text-right">Estoque</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((item, idx) => (
                            <tr key={idx}>
                              <td><div className="max-w-[240px] truncate" title={item[nameKey]}>{item[nameKey]}</div></td>
                              <td className="text-right tabular-nums text-primary">{item.entries}</td>
                              <td className="text-right tabular-nums text-amber-600 dark:text-amber-400">{item.exits}</td>
                              <td className="text-right tabular-nums cell-strong">{item.stock}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </DataCard>
              ))}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
