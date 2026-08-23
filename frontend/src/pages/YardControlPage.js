import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Package, Clock, AlertTriangle, FileSpreadsheet, Search, Filter, X, Eye, LogOut, Users, Ship, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
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

  const getDaysColor = (days) => {
    if (days > 90) return 'bg-red-500 text-white';
    if (days > 60) return 'bg-red-100 text-red-800';
    if (days > 30) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
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
      loadData(filters);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao registrar saída');
    } finally {
      setSavingExit(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6" data-testid="yard-control-page">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Controle de Pátio
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Containers em estoque e tempo de permanência</p>
          </div>
          <Button onClick={downloadExcel} data-testid="download-excel-btn" className="text-[13px] font-semibold uppercase tracking-wide h-10 px-5 bg-primary hover:bg-primary/90">
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Exportar Excel
          </Button>
        </div>

        {/* Cards de Estatísticas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Total no Pátio</p>
                  <p className="text-2xl font-bold text-primary">{stats.total}</p>
                </div>
                <Package className="w-8 h-8 text-primary/20" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Média de Dias</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.avg_days}</p>
                </div>
                <Clock className="w-8 h-8 text-blue-600/20" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Máximo de Dias</p>
                  <p className="text-2xl font-bold text-orange-600">{stats.max_days}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-orange-600/20" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">&gt;30 dias</p>
                  <p className="text-2xl font-bold text-red-600">{stats.over_30_days}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-red-600/20" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Alertas */}
        {stats.over_60_days > 0 && (
          <div className="flex items-center gap-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <div>
              <p className="text-[13px] font-semibold text-red-800">Atenção!</p>
              <p className="text-[12px] text-red-700">
                {stats.over_60_days} container(s) com mais de 60 dias no pátio
                {stats.over_90_days > 0 && `, sendo ${stats.over_90_days} com mais de 90 dias`}.
              </p>
            </div>
          </div>
        )}

        {/* Filtros */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-[13px] font-medium text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Filtros
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Status</Label>
                <Select
                  value={filters.status_filter || 'all'}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, status_filter: value === 'all' ? '' : value }))}
                >
                  <SelectTrigger data-testid="filter-status" className="h-9 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="VAZIO">Vazio</SelectItem>
                    <SelectItem value="CHEIO">Cheio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Tipo</Label>
                <Select
                  value={filters.movement_type || 'all'}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, movement_type: value === 'all' ? '' : value }))}
                >
                  <SelectTrigger data-testid="filter-movement-type" className="h-9 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="ENTRADA">Entrada</SelectItem>
                    <SelectItem value="SAIDA">Saída</SelectItem>
                    <SelectItem value="ESTOQUE">Estoque Atual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Cliente</Label>
                <div className="relative">
                  <Input
                    value={filters.client_name}
                    onChange={(e) => setFilters(prev => ({ ...prev, client_name: e.target.value }))}
                    onFocus={() => setClientInputFocused(true)}
                    onBlur={() => setTimeout(() => setClientInputFocused(false), 200)}
                    placeholder="Digite para buscar..."
                    data-testid="filter-client"
                    className="h-9 text-sm"
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
                </div>
              </div>
              
              <div>
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Armador</Label>
                <Select
                  value={filters.shipping_line || 'all'}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, shipping_line: value === 'all' ? '' : value }))}
                >
                  <SelectTrigger data-testid="filter-shipping" className="h-9 text-sm">
                    <SelectValue placeholder="Selecione" />
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
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div>
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Dias mínimos</Label>
                <Input
                  type="number"
                  min="0"
                  value={filters.min_days}
                  onChange={(e) => setFilters(prev => ({ ...prev, min_days: e.target.value }))}
                  placeholder="Ex: 30"
                  data-testid="filter-min-days"
                  className="h-9 text-sm"
                />
              </div>
              
              <div>
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Data Inicial</Label>
                <Input
                  type="date"
                  value={filters.date_from}
                  onChange={(e) => setFilters(prev => ({ ...prev, date_from: e.target.value }))}
                  data-testid="filter-date-from"
                  className="h-9 text-[13px]"
                />
              </div>
              
              <div>
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Data Final</Label>
                <Input
                  type="date"
                  value={filters.date_to}
                  onChange={(e) => setFilters(prev => ({ ...prev, date_to: e.target.value }))}
                  data-testid="filter-date-to"
                  className="h-9 text-[13px]"
                />
              </div>
              
              <div className="flex items-end gap-2 md:col-span-2">
                <Button onClick={applyFilters} className="flex-1 h-8 text-xs font-medium bg-primary hover:bg-primary/90" data-testid="apply-filters-btn">
                  <Search className="w-4 h-4 mr-2" />
                  Filtrar
                </Button>
                <Button variant="outline" onClick={clearFilters} className="h-8 text-xs font-medium" data-testid="clear-filters-btn">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabela de Containers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300">
              <span>Containers no Pátio ({containers.length})</span>
              <div className="flex gap-2 text-[11px]">
                <span className="px-2 py-1 bg-green-100 text-green-800 rounded">Vazios: {stats.empty}</span>
                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">Cheios: {stats.full}</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : containers.length === 0 ? (
              <div className="text-center py-8 text-[13px] text-muted-foreground">
                Nenhum container encontrado no pátio
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Container</th>
                      <th className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tipo</th>
                      <th className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</th>
                      <th className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tamanho</th>
                      <th className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Armador</th>
                      <th className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente</th>
                      <th className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data Entrada</th>
                      <th className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data Saída</th>
                      <th className="text-center py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Dias no Pátio</th>
                      <th className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedContainers.map(container => (
                      <tr 
                        key={container.id} 
                        className="border-b hover:bg-muted/50"
                        data-testid={`container-row-${container.container_number}`}
                      >
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{container.container_number}</span>
                            {container.is_segregated && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300" title={`Reservado para: ${container.segregation_client}`}>
                                SEGREGADO
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-1 rounded text-[10px] font-medium ${
                            container.in_stock !== false ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {container.in_stock !== false ? 'ENTRADA' : 'SAÍDA'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-1 rounded text-[10px] font-medium ${
                            container.status === 'CHEIO' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200'
                          }`}>
                            {container.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-sm text-slate-600 dark:text-slate-400">{container.size_type}</td>
                        <td className="py-2.5 px-4 text-sm text-slate-600 dark:text-slate-400">{container.shipping_line}</td>
                        <td className="py-2.5 px-4 text-sm text-slate-600 dark:text-slate-400">{container.client_name || '-'}</td>
                        <td className="py-2.5 px-4 text-sm text-slate-600 dark:text-slate-400">
                          {container.entry_date ? format(new Date(container.entry_date), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-sm text-slate-600 dark:text-slate-400">
                          {container.exit_date ? format(new Date(container.exit_date), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${getDaysColor(container.days_in_yard)}`}>
                            {container.days_in_yard} dias
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => navigate(`/movements/${container.id}`)}
                              title="Ver Detalhes"
                              data-testid={`view-container-${container.container_number}`}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {container.in_stock !== false && (
                              <Button 
                                variant="ghost" 
                                size="icon"
                                className="h-7 w-7 text-red-600 hover:text-red-700"
                                onClick={() => openExitModal(container)}
                                title="Registrar Saída"
                                data-testid={`exit-container-${container.container_number}`}
                              >
                                <LogOut className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            
            {/* Paginação */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t pt-4 mt-4">
                <div className="text-sm text-muted-foreground">
                  Mostrando {startIndex + 1} a {Math.min(endIndex, containers.length)} de {containers.length} containers
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => goToPage(1)} disabled={currentPage === 1} className="hidden sm:flex h-7 text-xs">
                    <ChevronsLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="h-7 text-xs">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) pageNum = i + 1;
                    else if (currentPage <= 3) pageNum = i + 1;
                    else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                    else pageNum = currentPage - 2 + i;
                    return (
                      <Button key={pageNum} variant={currentPage === pageNum ? "default" : "outline"} size="sm" onClick={() => goToPage(pageNum)} className="w-7 h-7 p-0 text-xs">
                        {pageNum}
                      </Button>
                    );
                  })}
                  
                  <Button variant="outline" size="sm" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="h-7 text-xs">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages} className="hidden sm:flex h-7 text-xs">
                    <ChevronsRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Estoque por Cliente e Armador */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Estoque por Cliente */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                <Users className="w-4 h-4" />
                Estoque por Cliente
              </CardTitle>
            </CardHeader>
            <CardContent>
              {byClient.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">Nenhum dado disponível</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {byClient.map((item, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                      <span className="font-medium truncate flex-1">{item.client}</span>
                      <div className="flex gap-2 text-sm">
                        <span className="px-2 py-0.5 bg-gray-100 dark:bg-slate-700 rounded">{item.empty} V</span>
                        <span className="px-2 py-0.5 bg-blue-100 rounded">{item.full} C</span>
                        <span className="px-2 py-0.5 bg-primary text-primary-foreground rounded font-bold">{item.total}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Estoque por Armador */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Ship className="w-5 h-5" />
                Estoque por Armador
              </CardTitle>
            </CardHeader>
            <CardContent>
              {byShipping.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">Nenhum dado disponível</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {byShipping.map((item, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                      <span className="font-medium truncate flex-1">{item.shipping_line}</span>
                      <div className="flex gap-2 text-sm">
                        <span className="px-2 py-0.5 bg-gray-100 dark:bg-slate-700 rounded">{item.empty} V</span>
                        <span className="px-2 py-0.5 bg-blue-100 rounded">{item.full} C</span>
                        <span className="px-2 py-0.5 bg-primary text-primary-foreground rounded font-bold">{item.total}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
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
                    <SelectValue placeholder="Selecione o motorista" />
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
                    <SelectValue placeholder="Selecione a transportadora" />
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
                  placeholder="Ex: ABC1D23"
                />
              </div>

              <div>
                <Label>Observações</Label>
                <Input
                  value={exitData.observations}
                  onChange={(e) => setExitData(prev => ({ ...prev, observations: e.target.value }))}
                  placeholder="Observações (opcional)"
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
