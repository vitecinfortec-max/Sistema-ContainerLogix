import { useEffect, useState, useCallback, useMemo } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton,
  ToolbarDivider, ToolbarPrimary, StatusPill, PlateTag, UserTag, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Plus, Trash2, Container as ContainerIcon, Eye, Edit, Wifi, WifiOff, Copy, ChevronUp, ChevronDown, ChevronsUpDown, Download, Loader2, ClipboardList, ArrowDownToLine, ArrowUpFromLine, PackageCheck } from 'lucide-react';
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
const STATUS_LABELS = { CHEIO: 'Cheio', VAZIO: 'Vazio' };
const formatCount = (n) => n.toLocaleString('pt-BR');
const formatShare = (part, total) => `${total ? Math.round((part / total) * 100) : 0}%`;

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
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showViaDialog, setShowViaDialog] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState('transaction_id');
  const [sortDirection, setSortDirection] = useState('desc');
  const navigate = useNavigate();

  const handleWebSocketMessage = useCallback((message) => {
    if (message.type === 'MOVEMENT_CREATED') {
      const newMovement = { ...message.data, created_at: message.data.created_at };
      setMovements(prev => {
        if (prev.some(m => m.id === newMovement.id)) return prev;
        const updated = [newMovement, ...prev];
        return updated.sort((a, b) => b.transaction_id - a.transaction_id);
      });
      toast.info(`Novo registro: ${newMovement.container_number}`, {
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
  }, [movements, filterType, filterStatus, searchClient, searchContainer, searchMovement, searchDriver, dateFrom, dateTo, sortField, sortDirection]);

  const loadMovements = async () => {
    try {
      const response = await api.getMovements();
      const sortedMovements = response.data.sort((a, b) => b.transaction_id - a.transaction_id);
      setMovements(sortedMovements);
    } catch (error) {
      toast.error('Erro ao carregar registros');
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
      filtered = filtered.filter(m => m.container_number && m.container_number.toLowerCase().includes(searchContainer.toLowerCase()));
    }
    if (searchMovement) {
      filtered = filtered.filter(m => String(m.transaction_id).includes(searchMovement));
    }
    if (searchDriver) {
      filtered = filtered.filter(m => m.driver_name && m.driver_name.toLowerCase().includes(searchDriver.toLowerCase()));
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

    filtered = [...filtered].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (sortField === 'created_at') {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
      } else if (typeof valA === 'string' || typeof valB === 'string') {
        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();
      } else {
        valA = valA ?? 0;
        valB = valB ?? 0;
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    setFilteredMovements(filtered);
    setCurrentPage(1);
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 inline ml-1 opacity-40" />;
    return sortDirection === 'asc'
      ? <ChevronUp className="w-3 h-3 inline ml-1" />
      : <ChevronDown className="w-3 h-3 inline ml-1" />;
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

  // Indicadores do topo - refletem o filtro atual (sem filtro = todos os registros)
  const stats = useMemo(() => {
    let entries = 0;
    let exits = 0;
    let full = 0;
    filteredMovements.forEach((m) => {
      if (m.operation_type === 'ENTRADA') entries += 1;
      else if (m.operation_type === 'SAIDA') exits += 1;
      if (m.status === 'CHEIO') full += 1;
    });
    return { total: filteredMovements.length, entries, exits, full, empty: filteredMovements.length - full };
  }, [filteredMovements]);

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = paginatedMovements.map(m => m.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach(id => next.delete(id));
      } else {
        pageIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const singleSelectedId = selectedIds.size === 1 ? [...selectedIds][0] : null;

  const handleClone = async () => {
    if (!cloneId || isCloning) return;
    const movementToClone = movements.find(m => m.id === cloneId);
    if (!movementToClone) { toast.error('Registro não encontrado'); setCloneId(null); return; }
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
      toast.success(`Registro clonado! Nova ID: #${response.data.transaction_id}`);
      setMovements(prev => {
        const updated = [response.data, ...prev];
        return updated.sort((a, b) => b.transaction_id - a.transaction_id);
      });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao clonar registro');
    } finally {
      setCloneId(null);
      setIsCloning(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId || isDeleting) return;
    const movementExists = movements.some(m => m.id === deleteId);
    if (!movementExists) { toast.error('Registro já foi removido'); setDeleteId(null); return; }
    setIsDeleting(true);
    markPendingDelete(deleteId);
    const idToDelete = deleteId;
    setMovements(prev => prev.filter(m => m.id !== idToDelete));
    try {
      await api.deleteMovement(idToDelete);
      toast.success('Registro deletado com sucesso');
      setTimeout(() => forceRefresh(), 500);
    } catch (error) {
      if (error.response?.status === 404) {
        toast.info('Registro já foi removido');
      } else {
        toast.error(error.response?.data?.detail || 'Erro ao deletar registro');
        forceRefresh();
      }
    } finally {
      setDeleteId(null);
      setIsDeleting(false);
      setSelectedIds(prev => {
        if (!prev.has(idToDelete)) return prev;
        const next = new Set(prev);
        next.delete(idToDelete);
        return next;
      });
    }
  };

  const handleDownloadPdf = async (via) => {
    if (selectedIds.size === 0 || isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      const response = await api.downloadMovementsPdf([...selectedIds], via);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      const filename = selectedIds.size === 1
        ? `registro-gate-${movements.find(m => m.id === [...selectedIds][0])?.transaction_id || [...selectedIds][0]}.pdf`
        : `registros-gate-${selectedIds.size}-documentos.pdf`;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('PDF gerado com sucesso!');
      setShowViaDialog(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao gerar PDF');
    } finally {
      setIsDownloadingPdf(false);
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
      <div className="space-y-4" data-testid="movements-page">
        <PageHeader
          icon={ContainerIcon}
          title="Gate"
          subtitle="Histórico completo de entradas e saídas"
          meta={isConnected ? (
            <StatusPill tone="emerald" dot={false}><Wifi className="w-3 h-3" />Sincronizado</StatusPill>
          ) : (
            <StatusPill tone="red" dot={false}><WifiOff className="w-3 h-3" />Offline</StatusPill>
          )}
        />

        <StatGrid>
          <StatCard label="Registros" value={formatCount(stats.total)} icon={ClipboardList} tone="blue" hint={hasFilters ? 'no filtro atual' : 'todos os registros'} testId="stat-total" />
          <StatCard label="Entradas" value={formatCount(stats.entries)} icon={ArrowDownToLine} tone="primary" hint={`${formatShare(stats.entries, stats.total)} dos registros`} testId="stat-entries" />
          <StatCard label="Saídas" value={formatCount(stats.exits)} icon={ArrowUpFromLine} tone="amber" hint={`${formatShare(stats.exits, stats.total)} dos registros`} testId="stat-exits" />
          <StatCard label="Cheios / Vazios" value={`${formatCount(stats.full)} / ${formatCount(stats.empty)}`} icon={PackageCheck} tone="emerald" hint={`${formatShare(stats.full, stats.total)} cheios`} testId="stat-status" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={clearAllFilters} onApply={filterData}>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <FilterField label="Data início">
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-sm" data-testid="date-from-input" />
            </FilterField>
            <FilterField label="Data fim">
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-sm" data-testid="date-to-input" />
            </FilterField>
            <FilterField label="Tipo">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-9 text-sm" data-testid="filter-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="ENTRADA">Entrada</SelectItem>
                  <SelectItem value="SAIDA">Saída</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Status">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-9 text-sm" data-testid="filter-status-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="CHEIO">Cheio</SelectItem>
                  <SelectItem value="VAZIO">Vazio</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Cliente">
              <SearchInput value={searchClient} onChange={e => setSearchClient(e.target.value)} data-testid="search-client-input" />
            </FilterField>
            <FilterField label="Nº container">
              <SearchInput value={searchContainer} onChange={e => setSearchContainer(e.target.value)} data-testid="search-container-input" />
            </FilterField>
            <FilterField label="Nº registro">
              <SearchInput value={searchMovement} onChange={e => setSearchMovement(e.target.value)} data-testid="search-movement-input" />
            </FilterField>
            <FilterField label="Motorista">
              <SearchInput value={searchDriver} onChange={e => setSearchDriver(e.target.value)} data-testid="search-driver-input" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um ou mais registros pra habilitar as ações da barra */}
        <DataCard
          title="Registros"
          count={formatCount(filteredMovements.length)}
          testId="movements-list"
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo registro" onClick={() => navigate('/movements/new')} testId="add-movement-button" />}
            >
              <ToolbarButton icon={Eye} label="Ver/Imprimir" tone="primary" onClick={() => singleSelectedId && navigate(`/movements/${singleSelectedId}`)} disabled={!singleSelectedId} testId="view-movement-button" />
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => singleSelectedId && navigate(`/movements/${singleSelectedId}/edit`)} disabled={!singleSelectedId} testId="edit-movement-button" />
              <ToolbarButton icon={Copy} label="Clonar" tone="emerald" onClick={() => singleSelectedId && setCloneId(singleSelectedId)} disabled={!singleSelectedId} testId="clone-movement-button" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedId && setDeleteId(singleSelectedId)} disabled={!singleSelectedId} testId="delete-movement-button" />
              <ToolbarDivider />
              <ToolbarButton icon={Download} label="Baixar PDF" onClick={() => setShowViaDialog(true)} disabled={selectedIds.size === 0} testId="download-pdf-button" />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredMovements.length}
              pageSize={ITEMS_PER_PAGE}
              onPageChange={goToPage}
            />
          )}
        >
          {paginatedMovements.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={paginatedMovements.length > 0 && paginatedMovements.every(m => selectedIds.has(m.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th className="sortable" onClick={() => handleSort('transaction_id')}>Nº<SortIcon field="transaction_id" /></th>
                    <th className="sortable" onClick={() => handleSort('operation_type')}>Tipo<SortIcon field="operation_type" /></th>
                    <th className="sortable" onClick={() => handleSort('client_name')}>Cliente<SortIcon field="client_name" /></th>
                    <th className="sortable" onClick={() => handleSort('driver_name')}>Motorista<SortIcon field="driver_name" /></th>
                    <th className="sortable" onClick={() => handleSort('truck_plate')}>Placa<SortIcon field="truck_plate" /></th>
                    <th className="sortable" onClick={() => handleSort('status')}>Status<SortIcon field="status" /></th>
                    <th className="sortable" onClick={() => handleSort('created_at')}>Emissão<SortIcon field="created_at" /></th>
                    {/* Usuário é a coluna menos usada - some em telas menores pra lista caber sem rolagem lateral */}
                    <th className="sortable hidden min-[1400px]:table-cell" onClick={() => handleSort('user_name')}>Usuário<SortIcon field="user_name" /></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMovements.map((movement) => {
                    const createdAt = new Date(movement.created_at);
                    return (
                      <tr
                        key={movement.id}
                        onClick={() => toggleSelect(movement.id)}
                        data-selected={selectedIds.has(movement.id)}
                        className="cursor-pointer"
                        data-testid="movement-row"
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(movement.id)}
                            onCheckedChange={() => toggleSelect(movement.id)}
                            data-testid="movement-row-checkbox"
                          />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{movement.transaction_id}</td>
                        <td>
                          <StatusPill tone={movement.operation_type === 'ENTRADA' ? 'primary' : 'amber'}>
                            {movement.operation_type === 'ENTRADA' ? 'Entrada' : 'Saída'}
                          </StatusPill>
                        </td>
                        <td><div className="max-w-[150px] min-[1400px]:max-w-[190px] 2xl:max-w-[300px] truncate" title={movement.client_name || ''}>{movement.client_name || '-'}</div></td>
                        <td><div className="max-w-[170px] min-[1400px]:max-w-[210px] 2xl:max-w-[320px] truncate" title={movement.driver_name || ''}>{movement.driver_name}</div></td>
                        <td><PlateTag>{movement.truck_plate}</PlateTag></td>
                        <td>
                          <StatusPill tone={movement.status === 'CHEIO' ? 'emerald' : 'slate'}>
                            {STATUS_LABELS[movement.status] || movement.status}
                          </StatusPill>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {format(createdAt, 'dd/MM/yyyy', { locale: ptBR })}{' '}
                          <span className="text-slate-400 dark:text-slate-500">{format(createdAt, 'HH:mm', { locale: ptBR })}</span>
                        </td>
                        <td className="hidden min-[1400px]:table-cell"><UserTag name={movement.user_name} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={ContainerIcon}
              title="Nenhum registro encontrado"
              hint="Tente ajustar os filtros ou adicione um novo registro"
              testId="no-movements"
            />
          )}
        </DataCard>
      </div>

      {/* Delete Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !isDeleting && setDeleteId(open ? deleteId : null)}>
        <AlertDialogContent data-testid="delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar este registro? Esta ação não pode ser desfeita.
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
            <AlertDialogTitle>Clonar Registro</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja criar uma cópia deste registro? Uma nova ID será gerada automaticamente.
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

      {/* Via Dialog - qual via do comprovante baixar em PDF */}
      <AlertDialog open={showViaDialog} onOpenChange={(open) => !isDownloadingPdf && setShowViaDialog(open)}>
        <AlertDialogContent data-testid="via-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Qual via deseja baixar?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedIds.size === 1
                ? 'Será gerado um PDF com o comprovante do registro selecionado.'
                : `Será gerado um único PDF com ${selectedIds.size} páginas, uma para cada registro selecionado.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDownloadingPdf} data-testid="cancel-via">Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDownloadPdf('TERMINAL')}
              disabled={isDownloadingPdf}
              data-testid="via-terminal-button"
            >
              {isDownloadingPdf && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Via Terminal
            </Button>
            <Button
              type="button"
              onClick={() => handleDownloadPdf('MOTORISTA')}
              disabled={isDownloadingPdf}
              data-testid="via-motorista-button"
            >
              {isDownloadingPdf && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Via Motorista
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
