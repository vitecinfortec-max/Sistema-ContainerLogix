import { useEffect, useState, useCallback } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Plus, Search, Trash2, Container as ContainerIcon, Eye, Edit, Wifi, WifiOff, Copy, Calendar, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { useWebSocket } from '../hooks/useWebSocket';

const ITEMS_PER_PAGE = 15;

export default function MovementsPage() {
  const [movements, setMovements] = useState([]);
  const [filteredMovements, setFilteredMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchClient, setSearchClient] = useState('');
  const [searchContainer, setSearchContainer] = useState('');
  const [searchMovement, setSearchMovement] = useState('');
  const [searchDriver, setSearchDriver] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cloneId, setCloneId] = useState(null);
  const [isCloning, setIsCloning] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const navigate = useNavigate();

  const handleWebSocketMessage = useCallback((message) => {
    if (message.type === 'MOVEMENT_CREATED') {
      const newMovement = { ...message.data, created_at: message.data.created_at };
      setMovements(prev => {
        if (prev.some(m => m.id === newMovement.id)) return prev;
        const updated = [newMovement, ...prev];
        return updated.sort((a, b) => b.transaction_id - a.transaction_id);
      });
      toast.info(`Nova movimentação: ${newMovement.container_number}`, {
        description: `${newMovement.operation_type} - ${newMovement.driver_name}`
      });
    } else if (message.type === 'MOVEMENT_DELETED') {
      setMovements(prev => prev.filter(m => m.id !== message.data.id));
    } else if (message.type === 'DATA_CHANGED') {
      const sortedMovements = message.data.sort((a, b) => b.transaction_id - a.transaction_id);
      setMovements(sortedMovements);
    }
  }, []);

  const { isConnected, markPendingDelete, forceRefresh } = useWebSocket(handleWebSocketMessage);

  useEffect(() => { loadMovements(); }, []);

  useEffect(() => {
    filterData();
  }, [movements, filterType, filterStatus, searchClient, searchContainer, searchMovement, searchDriver, dateFrom, dateTo]);

  const loadMovements = async () => {
    try {
      const response = await api.getMovements();
      const sortedMovements = response.data.sort((a, b) => b.transaction_id - a.transaction_id);
      setMovements(sortedMovements);
    } catch (error) {
      toast.error('Erro ao carregar movimentações');
    } finally {
      setLoading(false);
    }
  };

  const filterData = () => {
    let filtered = movements;

    if (searchClient) {
      filtered = filtered.filter(m => m.client_name && m.client_name.toLowerCase().includes(searchClient.toLowerCase()));
    }
    if (searchContainer) {
      filtered = filtered.filter(m => m.container_number.toLowerCase().includes(searchContainer.toLowerCase()));
    }
    if (searchMovement) {
      filtered = filtered.filter(m => String(m.transaction_id).includes(searchMovement));
    }
    if (searchDriver) {
      filtered = filtered.filter(m => m.driver_name.toLowerCase().includes(searchDriver.toLowerCase()));
    }
    if (filterType !== 'all') {
      filtered = filtered.filter(m => m.operation_type === filterType);
    }
    if (filterStatus !== 'all') {
      filtered = filtered.filter(m => m.status === filterStatus);
    }
    if (dateFrom || dateTo) {
      filtered = filtered.filter(m => {
        const movementDate = parseISO(m.created_at);
        const from = dateFrom ? startOfDay(parseISO(dateFrom)) : null;
        const to = dateTo ? endOfDay(parseISO(dateTo)) : null;
        if (from && to) return isWithinInterval(movementDate, { start: from, end: to });
        if (from) return movementDate >= from;
        if (to) return movementDate <= to;
        return true;
      });
    }

    setFilteredMovements(filtered);
    setCurrentPage(1);
  };

  const hasFilters = searchClient || searchContainer || searchMovement || searchDriver || filterType !== 'all' || filterStatus !== 'all' || dateFrom || dateTo;

  const clearAllFilters = () => {
    setSearchClient('');
    setSearchContainer('');
    setSearchMovement('');
    setSearchDriver('');
    setFilterType('all');
    setFilterStatus('all');
    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(filteredMovements.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedMovements = filteredMovements.slice(startIndex, endIndex);

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const getShortName = (fullName) => {
    if (!fullName) return '-';
    const parts = fullName.trim().split(' ');
    if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
    return parts[0];
  };

  const handleClone = async () => {
    if (!cloneId || isCloning) return;
    const movementToClone = movements.find(m => m.id === cloneId);
    if (!movementToClone) { toast.error('Movimentação não encontrada'); setCloneId(null); return; }
    setIsCloning(true);
    try {
      const cloneData = {
        operation_type: movementToClone.operation_type,
        driver_name: movementToClone.driver_name,
        driver_cpf: movementToClone.driver_cpf,
        truck_plate: movementToClone.truck_plate,
        trailer_plate_1: movementToClone.trailer_plate_1,
        trailer_plate_2: movementToClone.trailer_plate_2 || '',
        transport_company: movementToClone.transport_company,
        container_number: movementToClone.container_number,
        status: movementToClone.status,
        size_type: movementToClone.size_type,
        tare: movementToClone.tare || '',
        shipping_line: movementToClone.shipping_line,
        seal: movementToClone.seal || '',
        genset: movementToClone.genset || '',
        booking: movementToClone.booking || ''
      };
      const response = await api.createMovement(cloneData);
      toast.success(`Movimentação clonada! Nova ID: #${response.data.transaction_id}`);
      setMovements(prev => {
        const updated = [response.data, ...prev];
        return updated.sort((a, b) => b.transaction_id - a.transaction_id);
      });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao clonar movimentação');
    } finally {
      setCloneId(null);
      setIsCloning(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId || isDeleting) return;
    const movementExists = movements.some(m => m.id === deleteId);
    if (!movementExists) { toast.error('Movimentação já foi removida'); setDeleteId(null); return; }
    setIsDeleting(true);
    markPendingDelete(deleteId);
    const idToDelete = deleteId;
    setMovements(prev => prev.filter(m => m.id !== idToDelete));
    try {
      await api.deleteMovement(idToDelete);
      toast.success('Movimentação deletada com sucesso');
      setTimeout(() => forceRefresh(), 500);
    } catch (error) {
      if (error.response?.status === 404) {
        toast.info('Movimentação já foi removida');
      } else {
        toast.error(error.response?.data?.detail || 'Erro ao deletar movimentação');
        forceRefresh();
      }
    } finally {
      setDeleteId(null);
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="movements-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="movements-page">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              Movimentações
            </h1>
            <p className="text-[13px] text-slate-500 mt-0.5 flex items-center gap-2">
              Histórico completo de entradas e saídas
              <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${isConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {isConnected ? 'Sincronizado' : 'Offline'}
              </span>
            </p>
          </div>
          <Button
            onClick={() => navigate('/movements/new')}
            className="text-[13px] font-semibold uppercase tracking-wide h-10 px-5 bg-primary hover:bg-primary/90"
            data-testid="add-movement-button"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Nova Movimentação
          </Button>
        </div>

        {/* Filtros */}
        <Card className="border border-slate-200 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100">
            <CardTitle className="flex items-center justify-between text-[13px] font-medium text-slate-700">
              <span className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Filtrar
              </span>
              {hasFilters && (
                <button onClick={clearAllFilters} className="text-[11px] text-slate-400 hover:text-primary flex items-center gap-1 font-normal" data-testid="clear-all-filters">
                  <X className="w-3.5 h-3.5" />
                  Limpar
                </button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {/* Row 1: Dates + Type + Status */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Data Início</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-[13px]" data-testid="date-from-input" />
              </div>
              <div>
                <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Data Fim</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-[13px]" data-testid="date-to-input" />
              </div>
              <div>
                <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Tipo</Label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="h-9 text-sm" data-testid="filter-type-select">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="ENTRADA">Entrada</SelectItem>
                    <SelectItem value="SAIDA">Saída</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-9 text-sm" data-testid="filter-status-select">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="CHEIO">Cheio</SelectItem>
                    <SelectItem value="VAZIO">Vazio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: Specific search fields */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Cliente</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    placeholder="Buscar cliente..."
                    value={searchClient}
                    onChange={e => setSearchClient(e.target.value)}
                    className="h-9 text-sm pl-8"
                    data-testid="search-client-input"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Nº Container</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    placeholder="Buscar container..."
                    value={searchContainer}
                    onChange={e => setSearchContainer(e.target.value)}
                    className="h-9 text-sm pl-8"
                    data-testid="search-container-input"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Nº Movimentação</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    placeholder="Buscar nº..."
                    value={searchMovement}
                    onChange={e => setSearchMovement(e.target.value)}
                    className="h-9 text-sm pl-8"
                    data-testid="search-movement-input"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[11px] text-slate-400 mb-1 block uppercase tracking-wider font-semibold">Motorista</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    placeholder="Buscar motorista..."
                    value={searchDriver}
                    onChange={e => setSearchDriver(e.target.value)}
                    className="h-9 text-sm pl-8"
                    data-testid="search-driver-input"
                  />
                </div>
              </div>
            </div>

            {/* Filter + Clear buttons */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
                className="h-8 text-xs font-medium"
                data-testid="filter-clear-button"
              >
                Limpar
              </Button>
              <Button
                size="sm"
                onClick={filterData}
                className="h-8 text-xs font-medium bg-primary hover:bg-primary/90"
                data-testid="filter-apply-button"
              >
                Filtrar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="border border-slate-200 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100">
            <CardTitle className="flex items-center justify-between text-sm font-semibold text-slate-700">
              <span>Lista de Movimentações ({filteredMovements.length})</span>
              {totalPages > 1 && (
                <span className="text-xs font-normal text-slate-400">Página {currentPage} de {totalPages}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {paginatedMovements.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tipo</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Cliente</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Motorista</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Placa</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Emissão</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Usuário</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedMovements.map((movement, idx) => (
                      <tr
                        key={movement.id}
                        className={`hover:bg-slate-50/80 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/40'}`}
                        data-testid="movement-row"
                      >
                        <td className="px-4 py-2.5 text-sm font-semibold text-slate-800">#{movement.transaction_id}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                            movement.operation_type === 'ENTRADA'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {movement.operation_type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-slate-600">{movement.client_name || '-'}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600">{movement.driver_name}</td>
                        <td className="px-4 py-2.5 text-sm font-mono text-slate-700">{movement.truck_plate}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            movement.status === 'CHEIO'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {movement.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-slate-500">
                          {format(new Date(movement.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-slate-500">{getShortName(movement.user_name)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-0.5">
                            <Button variant="ghost" size="sm" onClick={() => navigate(`/movements/${movement.id}`)} title="Ver/Imprimir" data-testid="view-movement-button" className="h-7 w-7 p-0">
                              <Eye className="w-3.5 h-3.5 text-primary" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => navigate(`/movements/${movement.id}/edit`)} title="Editar" data-testid="edit-movement-button" className="h-7 w-7 p-0">
                              <Edit className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setCloneId(movement.id)} title="Clonar" data-testid="clone-movement-button" className="h-7 w-7 p-0">
                              <Copy className="w-3.5 h-3.5 text-green-600" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setDeleteId(movement.id)} title="Deletar" data-testid="delete-movement-button" className="h-7 w-7 p-0">
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-muted-foreground" data-testid="no-movements">
                <ContainerIcon className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">Nenhuma movimentação encontrada</p>
                <p className="text-xs mt-1 text-slate-400">Tente ajustar os filtros ou adicione uma nova movimentação</p>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                <div className="text-xs text-slate-400">
                  {startIndex + 1}–{Math.min(endIndex, filteredMovements.length)} de {filteredMovements.length}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => goToPage(1)} disabled={currentPage === 1} className="hidden sm:flex h-7 text-xs">
                    Primeira
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="h-7 text-xs">
                    <ChevronLeft className="w-3 h-3 mr-0.5" /> Anterior
                  </Button>
                  <div className="hidden md:flex items-center gap-1">
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
                  </div>
                  <Button variant="outline" size="sm" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="h-7 text-xs">
                    Próxima <ChevronRight className="w-3 h-3 ml-0.5" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages} className="hidden sm:flex h-7 text-xs">
                    Última
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !isDeleting && setDeleteId(open ? deleteId : null)}>
        <AlertDialogContent data-testid="delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar esta movimentação? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting} data-testid="cancel-delete">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90" data-testid="confirm-delete">
              {isDeleting ? 'Deletando...' : 'Deletar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clone Dialog */}
      <AlertDialog open={!!cloneId} onOpenChange={(open) => !isCloning && setCloneId(open ? cloneId : null)}>
        <AlertDialogContent data-testid="clone-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Clonar Movimentação</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja criar uma cópia desta movimentação? Uma nova ID será gerada automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCloning} data-testid="cancel-clone">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleClone} disabled={isCloning} className="bg-green-600 hover:bg-green-700" data-testid="confirm-clone">
              {isCloning ? 'Clonando...' : 'Clonar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
