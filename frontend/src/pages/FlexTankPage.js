import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Eye, Pencil, Trash2, Package, TrendingUp, TrendingDown, FileSpreadsheet, Filter } from 'lucide-react';
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
      <div className="space-y-5" data-testid="flex-tank-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Flex Tank
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Controle de estoque de bolsas</p>
        </div>

        {/* Dashboard de Estoque */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">
                {appliedFilters.client_id ? `Estoque - ${getSelectedClientName()}` : 'Estoque Total'}
              </CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stock.total_bags}</div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">bolsas disponíveis</p>
            </CardContent>
          </Card>
          
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Total de Entradas</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stock.total_entries}</div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">bolsas recebidas</p>
            </CardContent>
          </Card>
          
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Total de Saídas</CardTitle>
              <TrendingDown className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stock.total_exits}</div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">bolsas expedidas</p>
            </CardContent>
          </Card>
        </div>

        {/* Conteúdo baseado na tab ativa (sem mostrar as abas visuais) */}
        {activeTab === 'movements' && (
          <div className="space-y-4">
            {/* Filtros */}
            <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
              <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5" />
                  Filtrar
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div>
                    <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Inicial</Label>
                    <Input
                      type="date"
                      value={filters.start_date}
                      onChange={(e) => setFilters(prev => ({ ...prev, start_date: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Final</Label>
                    <Input
                      type="date"
                      value={filters.end_date}
                      onChange={(e) => setFilters(prev => ({ ...prev, end_date: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Cliente</Label>
                    <Select
                      value={filters.client_id}
                      onValueChange={(value) => setFilters(prev => ({ ...prev, client_id: value === 'all' ? '' : value }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {clients.map(client => (
                          <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Nº Registro</Label>
                    <Input
                      type="number"
                      value={filters.movement_number}
                      onChange={(e) => setFilters(prev => ({ ...prev, movement_number: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Tipo</Label>
                    <Select
                      value={filters.movement_type}
                      onValueChange={(value) => setFilters(prev => ({ ...prev, movement_type: value === 'all' ? '' : value }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="ENTRADA">Entrada</SelectItem>
                        <SelectItem value="SAIDA">Saída</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-0.5">
                  <Button variant="outline" onClick={clearFilters} className="h-7 text-xs font-medium">
                    Limpar
                  </Button>
                  <Button onClick={applyFilters} className="h-7 text-xs font-medium bg-primary hover:bg-primary/90">
                    Filtrar
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Barra de ações - marque uma movimentação na tabela abaixo pra habilitar as ações */}
            <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/flex-tank/movements/new')}
                title="Adicionar"
                data-testid="new-movement-btn"
                className="h-9 w-9 p-0"
              >
                <Plus className="w-4 h-4 text-primary" />
              </Button>
              <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => singleSelectedId && navigate(`/flex-tank/movements/${singleSelectedId}`)}
                disabled={!singleSelectedId}
                title="Visualizar"
                data-testid="view-movement-button"
                className="h-9 w-9 p-0 disabled:opacity-30"
              >
                <Eye className="w-4 h-4 text-primary" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => singleSelectedId && navigate(`/flex-tank/movements/${singleSelectedId}/edit`)}
                disabled={!singleSelectedId}
                title="Editar"
                data-testid="edit-movement-button"
                className="h-9 w-9 p-0 disabled:opacity-30"
              >
                <Pencil className="w-4 h-4 text-blue-600" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => singleSelectedId && handleDelete(singleSelectedId)}
                disabled={!singleSelectedId}
                title="Excluir"
                data-testid="delete-movement-button"
                className="h-9 w-9 p-0 disabled:opacity-30"
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
              {selectedIds.size > 0 && (
                <span className="text-[11px] text-slate-400 dark:text-slate-500 pl-1 pr-2">
                  {selectedIds.size} selecionado{selectedIds.size > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Lista de Movimentações */}
            <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
              <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Movimentações ({pagination.total})
                  </span>
                  {pagination.totalPages > 1 && (
                    <span className="text-xs font-normal text-slate-400 dark:text-slate-500">Página {pagination.page} de {pagination.totalPages}</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
                ) : movements.length === 0 ? (
                  <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">
                    Nenhuma movimentação encontrada
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          <th className="w-9 px-4 py-2.5">
                            <Checkbox
                              checked={movements.length > 0 && movements.every(m => selectedIds.has(m.id))}
                              onCheckedChange={toggleSelectAllOnPage}
                              data-testid="select-all-checkbox"
                            />
                          </th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº Bolsa</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tamanho</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tipo</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Container</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((movement, idx) => (
                          <tr
                            key={movement.id}
                            className={`cursor-pointer transition-colors ${selectedIds.has(movement.id) ? 'bg-primary/10 hover:bg-primary/15' : `hover:bg-slate-50 dark:hover:bg-slate-800/80 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}`}
                            onClick={() => toggleSelect(movement.id)}
                            data-testid={`movement-row-${movement.id}`}
                          >
                            <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedIds.has(movement.id)}
                                onCheckedChange={() => toggleSelect(movement.id)}
                                data-testid="movement-row-checkbox"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{movement.movement_number}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{movement.bag_number}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{movement.bag_size}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                              {format(new Date(movement.movement_date), "dd/MM/yyyy", { locale: ptBR })}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                                movement.movement_type === 'ENTRADA' 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {movement.movement_type}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{movement.client_name || '-'}</td>
                            <td className="px-4 py-2.5 text-sm font-mono text-slate-700 dark:text-slate-300">{movement.container_number || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Paginação */}
                {pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-xs text-slate-400 dark:text-slate-500">
                      Página {pagination.page} de {pagination.totalPages}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={pagination.page === 1}
                        onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={pagination.page === pagination.totalPages}
                        onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                      >
                        Próximo
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="space-y-4">
            <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
              <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5" />
                  Filtrar
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Início</Label>
                    <Input
                      type="date"
                      value={reportFilters.start_date}
                      onChange={(e) => setReportFilters(prev => ({ ...prev, start_date: e.target.value }))}
                      className="h-8 text-xs"
                      data-testid="report-filter-start-date"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Fim</Label>
                    <Input
                      type="date"
                      value={reportFilters.end_date}
                      onChange={(e) => setReportFilters(prev => ({ ...prev, end_date: e.target.value }))}
                      className="h-8 text-xs"
                      data-testid="report-filter-end-date"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Cliente</Label>
                    <Select
                      value={reportFilters.client_id}
                      onValueChange={(value) => setReportFilters(prev => ({ ...prev, client_id: value === 'all' ? '' : value }))}
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid="report-filter-client">
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
                  </div>
                  <div>
                    <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Tipo</Label>
                    <Select
                      value={reportFilters.movement_type}
                      onValueChange={(value) => setReportFilters(prev => ({ ...prev, movement_type: value === 'all' ? '' : value }))}
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid="report-filter-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os tipos</SelectItem>
                        <SelectItem value="ENTRADA">Entrada</SelectItem>
                        <SelectItem value="SAIDA">Saída</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-0.5">
                  <Button variant="outline" onClick={clearReportFilters} className="h-7 text-xs font-medium" data-testid="clear-report-filters-btn">
                    Limpar
                  </Button>
                  <Button onClick={downloadReport} className="h-7 text-xs font-medium bg-primary hover:bg-primary/90" data-testid="download-report-btn">
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
                    Baixar Excel
                  </Button>
                </div>
                {(reportFilters.start_date || reportFilters.end_date || reportFilters.client_id || reportFilters.movement_type) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">Filtros ativos:</span>
                    {reportFilters.start_date && (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px]">
                        De: {format(new Date(reportFilters.start_date + 'T00:00:00'), 'dd/MM/yyyy')}
                      </span>
                    )}
                    {reportFilters.end_date && (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px]">
                        Até: {format(new Date(reportFilters.end_date + 'T00:00:00'), 'dd/MM/yyyy')}
                      </span>
                    )}
                    {reportFilters.client_id && (
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-[10px]">
                        Cliente: {clients.find(c => c.id === reportFilters.client_id)?.name || 'Selecionado'}
                      </span>
                    )}
                    {reportFilters.movement_type && (
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        reportFilters.movement_type === 'ENTRADA'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        Tipo: {reportFilters.movement_type === 'ENTRADA' ? 'Entrada' : 'Saída'}
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Estoque por Cliente */}
            <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 space-y-6">
                <div>
                  <h3 className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-3">Estoque por Cliente</h3>
                  {stock.by_client.length === 0 ? (
                    <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum dado disponível</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-100 dark:border-slate-800">
                            <th className="text-left py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Entradas</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Saídas</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Estoque</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stock.by_client.map((item, idx) => (
                            <tr key={idx} className={`border-b border-slate-50 dark:border-slate-800 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}>
                              <td className="py-2 px-4 text-sm text-slate-600 dark:text-slate-400">{item.client_name}</td>
                              <td className="py-2 px-4 text-right text-sm text-green-600">{item.entries}</td>
                              <td className="py-2 px-4 text-right text-sm text-red-600">{item.exits}</td>
                              <td className="py-2 px-4 text-right text-sm font-semibold text-slate-700 dark:text-slate-300">{item.stock}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Estoque por Tamanho */}
                <div>
                  <h3 className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-3">Estoque por Tamanho</h3>
                  {stock.by_size.length === 0 ? (
                    <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum dado disponível</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-100 dark:border-slate-800">
                            <th className="text-left py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tamanho</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Entradas</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Saídas</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Estoque</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stock.by_size.map((item, idx) => (
                            <tr key={idx} className={`border-b border-slate-50 dark:border-slate-800 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}>
                              <td className="py-2 px-4 text-sm text-slate-600 dark:text-slate-400">{item.size}</td>
                              <td className="py-2 px-4 text-right text-sm text-green-600">{item.entries}</td>
                              <td className="py-2 px-4 text-right text-sm text-red-600">{item.exits}</td>
                              <td className="py-2 px-4 text-right text-sm font-semibold text-slate-700 dark:text-slate-300">{item.stock}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
          </div>
        )}
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
