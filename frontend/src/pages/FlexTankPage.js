import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Plus, Eye, Pencil, Trash2, Search, Package, TrendingUp, TrendingDown, FileSpreadsheet, Filter, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function FlexTankPage() {
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
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Tem certeza que deseja excluir esta movimentação?')) return;
    
    try {
      await api.deleteFlexTankMovement(id);
      toast.success('Movimentação excluída com sucesso!');
      loadMovements();
      loadStock();
    } catch (error) {
      toast.error('Erro ao excluir movimentação');
    }
  };

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
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              Flex Tank
            </h1>
            <p className="text-[13px] text-slate-500 mt-0.5">Controle de estoque de bolsas</p>
          </div>
          <Button onClick={() => navigate('/flex-tank/movements/new')} className="text-[13px] font-semibold uppercase tracking-wide h-10 px-5 bg-primary hover:bg-primary/90" data-testid="new-movement-btn">
            <Plus className="w-4 h-4 mr-1.5" />
            Nova Movimentação
          </Button>
        </div>

        {/* Dashboard de Estoque */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border border-slate-200 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                {appliedFilters.client_id ? `Estoque - ${getSelectedClientName()}` : 'Estoque Total'}
              </CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stock.total_bags}</div>
              <p className="text-[11px] text-slate-400">bolsas disponíveis</p>
            </CardContent>
          </Card>
          
          <Card className="border border-slate-200 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Total de Entradas</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stock.total_entries}</div>
              <p className="text-[11px] text-slate-400">bolsas recebidas</p>
            </CardContent>
          </Card>
          
          <Card className="border border-slate-200 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Total de Saídas</CardTitle>
              <TrendingDown className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stock.total_exits}</div>
              <p className="text-[11px] text-slate-400">bolsas expedidas</p>
            </CardContent>
          </Card>
        </div>

        {/* Conteúdo baseado na tab ativa (sem mostrar as abas visuais) */}
        {activeTab === 'movements' && (
          <div className="space-y-4">
            {/* Filtros */}
            <Card className="border border-slate-200 shadow-none">
              <CardHeader className="py-3 px-4 border-b border-slate-100">
                <CardTitle className="flex items-center justify-between text-[13px] font-medium text-slate-700">
                  <span className="flex items-center gap-2">
                    <Filter className="w-4 h-4" />
                    Filtros
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div>
                    <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Data Inicial</Label>
                    <Input
                      type="date"
                      value={filters.start_date}
                      onChange={(e) => setFilters(prev => ({ ...prev, start_date: e.target.value }))}
                      className="h-9 text-[13px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Data Final</Label>
                    <Input
                      type="date"
                      value={filters.end_date}
                      onChange={(e) => setFilters(prev => ({ ...prev, end_date: e.target.value }))}
                      className="h-9 text-[13px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Cliente</Label>
                    <Select
                      value={filters.client_id}
                      onValueChange={(value) => setFilters(prev => ({ ...prev, client_id: value === 'all' ? '' : value }))}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Todos" />
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
                    <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Nº Registro</Label>
                    <Input
                      type="number"
                      value={filters.movement_number}
                      onChange={(e) => setFilters(prev => ({ ...prev, movement_number: e.target.value }))}
                      placeholder="Ex: 1"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Tipo</Label>
                    <Select
                      value={filters.movement_type}
                      onValueChange={(value) => setFilters(prev => ({ ...prev, movement_type: value === 'all' ? '' : value }))}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Todos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="ENTRADA">Entrada</SelectItem>
                        <SelectItem value="SAIDA">Saída</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button onClick={applyFilters} size="sm" className="h-8 text-xs font-medium bg-primary hover:bg-primary/90">
                    <Search className="w-4 h-4 mr-2" />
                    Filtrar
                  </Button>
                  <Button variant="outline" onClick={clearFilters} size="sm" className="h-8 text-xs font-medium">
                    <X className="w-4 h-4 mr-2" />
                    Limpar
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Lista de Movimentações */}
            <Card className="border border-slate-200 shadow-none">
              <CardHeader className="py-3 px-4 border-b border-slate-100">
                <CardTitle className="flex items-center justify-between text-sm font-semibold text-slate-700">
                  <span className="flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Movimentações ({pagination.total})
                  </span>
                  {pagination.totalPages > 1 && (
                    <span className="text-xs font-normal text-slate-400">Página {pagination.page} de {pagination.totalPages}</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="text-center py-8 text-sm text-slate-500">Carregando...</div>
                ) : movements.length === 0 ? (
                  <div className="text-center py-8 text-sm text-slate-500">
                    Nenhuma movimentação encontrada
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Nº</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Nº Bolsa</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tamanho</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Data</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tipo</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Cliente</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Container</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((movement, idx) => (
                          <tr 
                            key={movement.id} 
                            className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${idx % 2 === 0 ? '' : 'bg-slate-50/40'}`}
                            onClick={() => navigate(`/flex-tank/movements/${movement.id}`)}
                            data-testid={`movement-row-${movement.id}`}
                          >
                            <td className="px-4 py-2.5 text-sm font-semibold text-slate-800">#{movement.movement_number}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600">{movement.bag_number}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600">{movement.bag_size}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-500">
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
                            <td className="px-4 py-2.5 text-sm text-slate-600">{movement.client_name || '-'}</td>
                            <td className="px-4 py-2.5 text-sm font-mono text-slate-700">{movement.container_number || '-'}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-0.5">
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={(e) => { e.stopPropagation(); navigate(`/flex-tank/movements/${movement.id}`); }}
                                  title="Visualizar"
                                  data-testid={`view-movement-${movement.id}`}
                                >
                                  <Eye className="w-3.5 h-3.5 text-primary" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={(e) => { e.stopPropagation(); navigate(`/flex-tank/movements/${movement.id}/edit`); }}
                                  title="Editar"
                                  data-testid={`edit-movement-${movement.id}`}
                                >
                                  <Pencil className="w-3.5 h-3.5 text-blue-600" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={(e) => handleDelete(movement.id, e)}
                                  title="Excluir"
                                  data-testid={`delete-movement-${movement.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Paginação */}
                {pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                    <div className="text-xs text-slate-400">
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
            <Card className="border border-slate-200 shadow-none">
              <CardHeader className="py-3 px-4 border-b border-slate-100">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <FileSpreadsheet className="w-4 h-4" />
                  Relatórios
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-6">
                {/* Filtros do Relatório */}
                <div className="p-4 border rounded-lg bg-slate-50/50">
                  <div className="flex items-center gap-2 mb-4">
                    <Filter className="w-4 h-4 text-slate-500" />
                    <h3 className="text-[13px] font-semibold text-slate-700">Filtros do Relatório</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Data Início</Label>
                      <Input
                        type="date"
                        value={reportFilters.start_date}
                        onChange={(e) => setReportFilters(prev => ({ ...prev, start_date: e.target.value }))}
                        className="h-9 text-[13px]"
                        data-testid="report-filter-start-date"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Data Fim</Label>
                      <Input
                        type="date"
                        value={reportFilters.end_date}
                        onChange={(e) => setReportFilters(prev => ({ ...prev, end_date: e.target.value }))}
                        className="h-9 text-[13px]"
                        data-testid="report-filter-end-date"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Cliente</Label>
                      <Select
                        value={reportFilters.client_id}
                        onValueChange={(value) => setReportFilters(prev => ({ ...prev, client_id: value === 'all' ? '' : value }))}
                      >
                        <SelectTrigger className="h-9 text-sm" data-testid="report-filter-client">
                          <SelectValue placeholder="Todos os clientes" />
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
                      <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Tipo</Label>
                      <Select
                        value={reportFilters.movement_type}
                        onValueChange={(value) => setReportFilters(prev => ({ ...prev, movement_type: value === 'all' ? '' : value }))}
                      >
                        <SelectTrigger className="h-9 text-sm" data-testid="report-filter-type">
                          <SelectValue placeholder="Todos os tipos" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos os tipos</SelectItem>
                          <SelectItem value="ENTRADA">Entrada</SelectItem>
                          <SelectItem value="SAIDA">Saída</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button onClick={downloadReport} size="sm" className="h-8 text-xs font-medium bg-primary hover:bg-primary/90" data-testid="download-report-btn">
                      <FileSpreadsheet className="w-4 h-4 mr-2" />
                      Baixar Excel
                    </Button>
                    <Button variant="outline" onClick={clearReportFilters} size="sm" className="h-8 text-xs font-medium" data-testid="clear-report-filters-btn">
                      <X className="w-4 h-4 mr-2" />
                      Limpar Filtros
                    </Button>
                  </div>
                  {(reportFilters.start_date || reportFilters.end_date || reportFilters.client_id || reportFilters.movement_type) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="text-[11px] text-slate-400">Filtros ativos:</span>
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
                </div>

                {/* Estoque por Cliente */}
                <div>
                  <h3 className="text-[13px] font-semibold text-slate-700 mb-3">Estoque por Cliente</h3>
                  {stock.by_client.length === 0 ? (
                    <p className="text-sm text-slate-400">Nenhum dado disponível</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-100">
                            <th className="text-left py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Cliente</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Entradas</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Saídas</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Estoque</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stock.by_client.map((item, idx) => (
                            <tr key={idx} className={`border-b border-slate-50 ${idx % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                              <td className="py-2 px-4 text-sm text-slate-600">{item.client_name}</td>
                              <td className="py-2 px-4 text-right text-sm text-green-600">{item.entries}</td>
                              <td className="py-2 px-4 text-right text-sm text-red-600">{item.exits}</td>
                              <td className="py-2 px-4 text-right text-sm font-semibold text-slate-700">{item.stock}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Estoque por Tamanho */}
                <div>
                  <h3 className="text-[13px] font-semibold text-slate-700 mb-3">Estoque por Tamanho</h3>
                  {stock.by_size.length === 0 ? (
                    <p className="text-sm text-slate-400">Nenhum dado disponível</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-100">
                            <th className="text-left py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tamanho</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Entradas</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Saídas</th>
                            <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Estoque</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stock.by_size.map((item, idx) => (
                            <tr key={idx} className={`border-b border-slate-50 ${idx % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                              <td className="py-2 px-4 text-sm text-slate-600">{item.size}</td>
                              <td className="py-2 px-4 text-right text-sm text-green-600">{item.entries}</td>
                              <td className="py-2 px-4 text-right text-sm text-red-600">{item.exits}</td>
                              <td className="py-2 px-4 text-right text-sm font-semibold text-slate-700">{item.stock}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}
