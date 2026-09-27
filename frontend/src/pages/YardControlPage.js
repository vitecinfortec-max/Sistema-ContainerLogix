import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Checkbox } from '../components/ui/checkbox';
import { Package, Clock, AlertTriangle, FileText, FileSpreadsheet, Eye, LogOut, Users, Ship } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const ITEMS_PER_PAGE = 20;

export default function YardControlPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [containers, setContainers] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    empty: 0,
    full: 0,
    avg_days: 0,
    max_days: 0,
    over_30_days: 0,
    over_60_days: 0,
    over_90_days: 0
  });
  const [byClient, setByClient] = useState([]);
  const [byShipping, setByShipping] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Modal de Saída Rápida
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState(null);
  const [exitData, setExitData] = useState({
    driver_id: '',
    driver_name: '',
    vehicle_plate: '',
    transport_company_id: '',
    transport_company_name: '',
    observations: ''
  });
  const [savingExit, setSavingExit] = useState(false);
  
  // Filtros
  const [filters, setFilters] = useState({
    status_filter: '',
    client_name: '',
    shipping_line: '',
    min_days: '',
    movement_type: '',
    date_from: '',
    date_to: ''
  });
  const [clientInputFocused, setClientInputFocused] = useState(false);
  useEffect(() => {
    // Link do sino de alertas chega com ?min_days=61 para já abrir filtrado
    const minDaysFromUrl = new URLSearchParams(location.search).get('min_days');
    if (minDaysFromUrl) {
      setFilters(prev => ({ ...prev, min_days: minDaysFromUrl }));
      loadData({ min_days: minDaysFromUrl });
    } else {
      loadData();
    }
    loadFiltersData();
  }, []);

  const loadFiltersData = async () => {
    try {
      const [clientsRes, shippingRes, driversRes, companiesRes] = await Promise.all([
        api.getClients(),
        api.getShippingLines(),
        api.getDrivers(),
        api.getCompanies()
      ]);
      setClients(clientsRes.data);
      setShippingLines(shippingRes.data);
      setDrivers(driversRes.data);
      setCompanies(companiesRes.data);
    } catch (error) {
      console.error('Erro ao carregar filtros:', error);
      toast.error('Erro ao carregar filtros');
    }
  };

  const loadData = async (appliedFilters = {}) => {
    setLoading(true);
    try {
      const params = { ...appliedFilters };
      Object.keys(params).forEach(key => {
        if (!params[key]) delete params[key];
      });
      
      const response = await api.getYardControl(params);
      const containersData = response.data.containers;

      // Verificar segregação de todos os containers em uma única chamada em lote -
      // antes disparava uma requisição HTTP por container (100-300 chamadas
      // paralelas a cada carregamento de página com o pátio cheio).
      let segregationByContainer = {};
      try {
        const containerNumbers = containersData.map((c) => c.container_number);
        const segRes = await api.checkContainerSegregationBatch(containerNumbers);
        segregationByContainer = segRes.data || {};
      } catch {
        segregationByContainer = {};
      }

      const containersWithSegregation = containersData.map((container) => {
        const seg = segregationByContainer[container.container_number?.toUpperCase()];
        return {
          ...container,
          is_segregated: seg?.is_segregated || false,
          segregation_client: seg?.segregation_client || null
        };
      });

      setContainers(containersWithSegregation);
      setStats(response.data.stats);
      setByClient(response.data.by_client || []);
      setByShipping(response.data.by_shipping || []);
    } catch (error) {
      toast.error('Erro ao carregar dados do pátio');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    setCurrentPage(1);
    loadData(filters);
  };

  const clearFilters = () => {
    setFilters({
      status_filter: '',
      client_name: '',
      shipping_line: '',
      min_days: '',
      movement_type: '',
      date_from: '',
      date_to: ''
    });
    setCurrentPage(1);
    loadData({});
  };

  // Paginação
  const totalPages = Math.ceil(containers.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedContainers = containers.slice(startIndex, endIndex);

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
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
    const pageIds = paginatedContainers.map(c => c.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const singleSelectedContainer = selectedIds.size === 1 ? containers.find(c => c.id === [...selectedIds][0]) : null;

  const downloadExcel = async () => {
    try {
      const params = { ...filters };
      Object.keys(params).forEach(key => {
        if (!params[key]) delete params[key];
      });

      const response = await api.downloadYardControlExcel(params);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `controle_patio_${format(new Date(), 'dd-MM-yyyy_HH-mm')}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório baixado com sucesso!');
    } catch (error) {
      toast.error('Erro ao baixar relatório');
    }
  };

  const downloadPdf = async () => {
    try {
      const params = { ...filters };
      Object.keys(params).forEach(key => {
        if (!params[key]) delete params[key];
      });

      const response = await api.downloadYardControlPdf(params);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `controle_patio_${format(new Date(), 'dd-MM-yyyy_HH-mm')}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório baixado com sucesso!');
    } catch (error) {
      toast.error('Erro ao baixar relatório');
    }
  };

  const getDaysTone = (days) => {
    if (days > 60) return 'red';
    if (days > 30) return 'amber';
    return 'emerald';
  };

  const openExitModal = (container) => {
    setSelectedContainer(container);
    setExitData({
      driver_id: '',
      driver_name: '',
      vehicle_plate: '',
      transport_company_id: '',
      transport_company_name: '',
      observations: ''
    });
    setExitModalOpen(true);
  };

  const handleDriverChange = (driverId) => {
    const driver = drivers.find(d => d.id === driverId);
    setExitData(prev => ({
      ...prev,
      driver_id: driverId,
      driver_name: driver?.name || ''
    }));
  };

  const handleCompanyChange = (companyId) => {
    const company = companies.find(c => c.id === companyId);
    setExitData(prev => ({
      ...prev,
      transport_company_id: companyId,
      transport_company_name: company?.name || ''
    }));
  };

  const handleQuickExit = async () => {
    if (!selectedContainer) return;
    
    setSavingExit(true);
    try {
      await api.registerQuickExit({
        entry_movement_id: selectedContainer.id,
        ...exitData
      });
      toast.success(`Saída do container ${selectedContainer.container_number} registrada com sucesso!`);
      setExitModalOpen(false);
      setSelectedIds(prev => {
        if (!prev.has(selectedContainer.id)) return prev;
        const next = new Set(prev);
        next.delete(selectedContainer.id);
        return next;
      });
      loadData(filters);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao registrar saída');
    } finally {
      setSavingExit(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="yard-control-page">
        <PageHeader icon={Clock} title="Controle de Pátio" subtitle="Containers em estoque e tempo de permanência" />

        <StatGrid>
          <StatCard label="Total no pátio" value={stats.total.toLocaleString('pt-BR')} icon={Package} tone="primary" hint={`${stats.empty} vazios · ${stats.full} cheios`} />
          <StatCard label="Média de dias" value={stats.avg_days} icon={Clock} tone="blue" hint="tempo médio de permanência" />
          <StatCard label="Máximo de dias" value={stats.max_days} icon={AlertTriangle} tone="amber" hint="container há mais tempo" />
          <StatCard label="Mais de 30 dias" value={stats.over_30_days} icon={AlertTriangle} tone="red" hint={`${stats.over_60_days} com +60 · ${stats.over_90_days} com +90`} />
        </StatGrid>

        {/* Alerta de permanência longa */}
        {stats.over_60_days > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold text-red-800 dark:text-red-300">Atenção à permanência</p>
              <p className="text-[12px] text-red-700 dark:text-red-400">
                {stats.over_60_days} container(s) com mais de 60 dias no pátio
                {stats.over_90_days > 0 && `, sendo ${stats.over_90_days} com mais de 90 dias`}.
              </p>
            </div>
          </div>
        )}

        <FilterCard
          hasFilters={Object.values(filters).some(Boolean)}
          onClear={clearFilters}
          onApply={applyFilters}
          clearTestId="clear-filters-btn"
          applyTestId="apply-filters-btn"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <FilterField label="Status">
              <Select
                value={filters.status_filter || 'all'}
                onValueChange={(value) => setFilters(prev => ({ ...prev, status_filter: value === 'all' ? '' : value }))}
              >
                <SelectTrigger data-testid="filter-status" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="VAZIO">Vazio</SelectItem>
                  <SelectItem value="CHEIO">Cheio</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Tipo">
              <Select
                value={filters.movement_type || 'all'}
                onValueChange={(value) => setFilters(prev => ({ ...prev, movement_type: value === 'all' ? '' : value }))}
              >
                <SelectTrigger data-testid="filter-movement-type" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="ENTRADA">Entrada</SelectItem>
                  <SelectItem value="SAIDA">Saída</SelectItem>
                  <SelectItem value="ESTOQUE">Estoque Atual</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Cliente" className="relative">
              <SearchInput
                value={filters.client_name}
                onChange={(e) => setFilters(prev => ({ ...prev, client_name: e.target.value }))}
                onFocus={() => setClientInputFocused(true)}
                onBlur={() => setTimeout(() => setClientInputFocused(false), 200)}
                data-testid="filter-client"
              />
              {clientInputFocused && filters.client_name && filters.client_name.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {clients
                    .filter(c => c.name.toLowerCase().includes(filters.client_name.toLowerCase()))
                    .slice(0, 10)
                    .map(client => (
                      <div
                        key={client.id}
                        className="px-3 py-2 cursor-pointer hover:bg-muted text-[13px]"
                        onClick={() => {
                          setFilters(prev => ({ ...prev, client_name: client.name }));
                          setClientInputFocused(false);
                        }}
                      >
                        {client.name}
                      </div>
                    ))
                  }
                  {clients.filter(c => c.name.toLowerCase().includes(filters.client_name.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-[13px] text-muted-foreground">
                      Nenhum cliente encontrado
                    </div>
                  )}
                </div>
              )}
            </FilterField>

            <FilterField label="Armador">
              <Select
                value={filters.shipping_line || 'all'}
                onValueChange={(value) => setFilters(prev => ({ ...prev, shipping_line: value === 'all' ? '' : value }))}
              >
                <SelectTrigger data-testid="filter-shipping" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {shippingLines.map(sl => (
                    <SelectItem key={sl.id} value={sl.name}>
                      {sl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Dias mínimos">
              <Input
                type="number"
                min="0"
                value={filters.min_days}
                onChange={(e) => setFilters(prev => ({ ...prev, min_days: e.target.value }))}
                data-testid="filter-min-days"
                className="h-9 text-sm"
              />
            </FilterField>

            <FilterField label="Data inicial">
              <Input
                type="date"
                value={filters.date_from}
                onChange={(e) => setFilters(prev => ({ ...prev, date_from: e.target.value }))}
                data-testid="filter-date-from"
                className="h-9 text-sm"
              />
            </FilterField>

            <FilterField label="Data final">
              <Input
                type="date"
                value={filters.date_to}
                onChange={(e) => setFilters(prev => ({ ...prev, date_to: e.target.value }))}
                data-testid="filter-date-to"
                className="h-9 text-sm"
              />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um container pra habilitar as ações da barra */}
        <DataCard
          title="Containers no pátio"
          count={containers.length.toLocaleString('pt-BR')}
          meta={(
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <StatusPill tone="slate">Vazios: {stats.empty}</StatusPill>
              <StatusPill tone="emerald">Cheios: {stats.full}</StatusPill>
            </span>
          )}
          toolbar={(
            <Toolbar selectedCount={selectedIds.size}>
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedContainer && navigate(`/movements/${singleSelectedContainer.id}`)} disabled={!singleSelectedContainer} testId="view-container-button" />
              <ToolbarButton icon={LogOut} label="Registrar saída" tone="red" onClick={() => singleSelectedContainer && openExitModal(singleSelectedContainer)} disabled={!singleSelectedContainer || singleSelectedContainer.in_stock === false} testId="exit-container-button" />
              <ToolbarDivider />
              <ToolbarButton icon={FileText} label="Exportar PDF" tone="red" onClick={downloadPdf} testId="download-pdf-btn" />
              <ToolbarButton icon={FileSpreadsheet} label="Exportar Excel" tone="emerald" onClick={downloadExcel} testId="download-excel-btn" />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={containers.length}
              pageSize={ITEMS_PER_PAGE}
              onPageChange={goToPage}
            />
          )}
        >
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : containers.length === 0 ? (
            <EmptyState icon={Package} title="Nenhum container encontrado no pátio" hint="Ajuste os filtros acima" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={paginatedContainers.length > 0 && paginatedContainers.every(c => selectedIds.has(c.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Container</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Tamanho</th>
                    <th>Armador</th>
                    <th>Cliente</th>
                    <th>Data entrada</th>
                    <th>Data saída</th>
                    <th className="!text-center">Dias no pátio</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedContainers.map(container => (
                    <tr
                      key={container.id}
                      onClick={() => toggleSelect(container.id)}
                      data-selected={selectedIds.has(container.id)}
                      className="cursor-pointer"
                      data-testid={`container-row-${container.container_number}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(container.id)}
                          onCheckedChange={() => toggleSelect(container.id)}
                          data-testid="container-row-checkbox"
                        />
                      </td>
                      <td>
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">{container.container_number}</span>
                          {container.is_segregated && (
                            <span title={`Reservado para: ${container.segregation_client}`}>
                              <StatusPill tone="amber" dot={false} className="!text-[10px] !px-1.5">SEGREGADO</StatusPill>
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <StatusPill tone={container.in_stock !== false ? 'primary' : 'amber'}>
                          {container.in_stock !== false ? 'Entrada' : 'Saída'}
                        </StatusPill>
                      </td>
                      <td>
                        <StatusPill tone={container.status === 'CHEIO' ? 'emerald' : 'slate'}>
                          {container.status === 'CHEIO' ? 'Cheio' : container.status === 'VAZIO' ? 'Vazio' : container.status}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap">{container.size_type}</td>
                      <td><div className="max-w-[150px] truncate" title={container.shipping_line || ''}>{container.shipping_line}</div></td>
                      <td><div className="max-w-[200px] truncate" title={container.client_name || ''}>{container.client_name || '-'}</div></td>
                      <td className="whitespace-nowrap tabular-nums">
                        {container.entry_date ? format(new Date(container.entry_date), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {container.exit_date ? format(new Date(container.exit_date), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                      </td>
                      <td className="text-center">
                        <StatusPill
                          tone={getDaysTone(container.days_in_yard)}
                          dot={false}
                          className={container.days_in_yard > 90 ? '!bg-red-600 !text-white' : ''}
                        >
                          {container.days_in_yard} dias
                        </StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        {/* Estoque por Cliente e Armador */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { title: 'Estoque por cliente', icon: Users, rows: byClient, nameKey: 'client' },
            { title: 'Estoque por armador', icon: Ship, rows: byShipping, nameKey: 'shipping_line' },
          ].map(({ title, icon: Icon, rows, nameKey }) => (
            <DataCard
              key={title}
              title={(<span className="flex items-center gap-2"><Icon className="w-4 h-4 text-primary" />{title}</span>)}
              count={rows.length}
            >
              {rows.length === 0 ? (
                <EmptyState title="Nenhum dado disponível" />
              ) : (
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((item, index) => (
                    <div key={index} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate flex-1" title={item[nameKey]}>{item[nameKey]}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusPill tone="slate" dot={false}>{item.empty} V</StatusPill>
                        <StatusPill tone="emerald" dot={false}>{item.full} C</StatusPill>
                        <span className="min-w-8 text-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold px-2 py-0.5 tabular-nums">{item.total}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DataCard>
          ))}
        </div>
      </div>

      {/* Modal de Saída Rápida */}
      <Dialog open={exitModalOpen} onOpenChange={setExitModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Saída</DialogTitle>
          </DialogHeader>
          
          {selectedContainer && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Container</p>
                <p className="font-mono font-bold text-lg">{selectedContainer.container_number}</p>
                <div className="flex gap-4 mt-1 text-sm">
                  <span>{selectedContainer.status}</span>
                  <span>{selectedContainer.size_type}</span>
                  <span>{selectedContainer.shipping_line}</span>
                </div>
              </div>

              <div>
                <Label>Motorista</Label>
                <Select value={exitData.driver_id} onValueChange={handleDriverChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {drivers.map(driver => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Transportadora</Label>
                <Select value={exitData.transport_company_id} onValueChange={handleCompanyChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map(company => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Placa do Veículo</Label>
                <Input
                  value={exitData.vehicle_plate}
                  onChange={(e) => setExitData(prev => ({ ...prev, vehicle_plate: e.target.value.toUpperCase() }))}
                />
              </div>

              <div>
                <Label>Observações</Label>
                <Input
                  value={exitData.observations}
                  onChange={(e) => setExitData(prev => ({ ...prev, observations: e.target.value }))}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setExitModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleQuickExit} disabled={savingExit}>
              {savingExit ? 'Registrando...' : 'Confirmar Saída'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
