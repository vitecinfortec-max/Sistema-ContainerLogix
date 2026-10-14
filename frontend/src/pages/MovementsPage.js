import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton,
  ToolbarDivider, ToolbarPrimary, StatusPill, PlateTag, UserTag, EmptyState, TablePagination, PageSkeleton,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { documentFilename, downloadDocumentsInBatch } from '../lib/batchDownload';
import { toast } from 'sonner';
import { Plus, Trash2, Container as ContainerIcon, Eye, Edit, Wifi, WifiOff, Copy, ChevronUp, ChevronDown, ChevronsUpDown, Download, Loader2, ClipboardList, ArrowDownToLine, ArrowUpFromLine, PackageCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
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

// Espera o usuário parar de digitar antes de consultar o servidor
function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const EMPTY_STATS = { total: 0, entries: 0, exits: 0, full: 0, empty: 0 };

// A lista é paginada, filtrada e ordenada no servidor: a tela só recebe os 15
// registros da página atual, mais os totais do filtro inteiro pros
// indicadores do topo. Antes o histórico completo era baixado e tudo isso era
// feito no navegador.
export default function MovementsPage() {
  const [movements, setMovements] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
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
  // Com mais de um registro marcado: um PDF por registro, ou um único PDF com todos
  const [separateFiles, setSeparateFiles] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState('transaction_id');
  const [sortDirection, setSortDirection] = useState('desc');
  const navigate = useNavigate();

  // Nº do registro de cada linha marcada - a seleção pode incluir registros
  // de outras páginas, que não estão mais em `movements`.
  const selectedNumbers = useRef(new Map());
  const selectedContainers = useRef(new Map());
  // Só a resposta do pedido mais recente é aplicada (digitação rápida gera
  // pedidos que podem voltar fora de ordem).
  const requestSeq = useRef(0);

  const debouncedClient = useDebouncedValue(searchClient);
  const debouncedContainer = useDebouncedValue(searchContainer);
  const debouncedMovement = useDebouncedValue(searchMovement);
  const debouncedDriver = useDebouncedValue(searchDriver);

  const queryParams = useMemo(() => {
    const params = { page: currentPage, per_page: ITEMS_PER_PAGE, sort_by: sortField, sort_dir: sortDirection };
    if (filterType !== 'all') params.operation_type = filterType;
    if (filterStatus !== 'all') params.status_filter = filterStatus;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (debouncedClient.trim()) params.client_name = debouncedClient.trim();
    if (debouncedContainer.trim()) params.container_number = debouncedContainer.trim();
    if (debouncedMovement.trim()) params.search_id = debouncedMovement.trim();
    if (debouncedDriver.trim()) params.driver_name = debouncedDriver.trim();
    return params;
  }, [currentPage, sortField, sortDirection, filterType, filterStatus, dateFrom, dateTo,
    debouncedClient, debouncedContainer, debouncedMovement, debouncedDriver]);

  const loadMovements = useCallback(async () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setFetching(true);
    try {
      const response = await api.getMovements(queryParams);
      if (seq !== requestSeq.current) return;
      const data = response.data;
      // A página pedida deixou de existir (ex: o último registro dela foi
      // excluído) - volta pra última que existe.
      if (data.items.length === 0 && data.pages >= 1 && queryParams.page > data.pages) {
        setCurrentPage(data.pages);
        return;
      }
      setMovements(data.items);
      setTotal(data.total);
      setTotalPages(Math.max(1, data.pages));
      setStats(data.stats || EMPTY_STATS);
    } catch (error) {
      if (seq !== requestSeq.current) return;
      toast.error(error.response?.data?.detail || 'Erro ao carregar registros');
    } finally {
      if (seq === requestSeq.current) {
        setFetching(false);
        setLoading(false);
      }
    }
  }, [queryParams]);

  useEffect(() => { loadMovements(); }, [loadMovements]);

  // Sempre a versão mais recente de loadMovements, pra quem chama de fora do
  // ciclo de renderização (mensagens em tempo real).
  const reloadRef = useRef(loadMovements);
  useEffect(() => { reloadRef.current = loadMovements; }, [loadMovements]);

  // Qualquer mudança feita por outro usuário recarrega a página atual da
  // lista (com os filtros e a ordenação em uso) - não dá mais pra encaixar o
  // registro novo direto na lista, porque a tela só tem uma página dela.
  const handleWebSocketMessage = useCallback((message) => {
    if (message.type === 'MOVEMENT_CREATED') {
      toast.info(`Novo registro: ${message.data.container_number}`, {
        description: `${message.data.operation_type} - ${message.data.driver_name}`
      });
      reloadRef.current();
    } else if (message.type === 'MOVEMENT_DELETED' || message.type === 'DATA_CHANGED') {
      reloadRef.current();
    }
  }, []);

  const { isConnected } = useWebSocket(handleWebSocketMessage);

  // Mudou filtro ou ordenação: volta pra primeira página
  const resetPage = () => setCurrentPage(1);
  const onFilter = (setter) => (value) => { setter(value); resetPage(); };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    resetPage();
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

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const toggleSelect = (movement) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(movement.id)) {
        next.delete(movement.id);
        selectedNumbers.current.delete(movement.id);
        selectedContainers.current.delete(movement.id);
      } else {
        next.add(movement.id);
        selectedNumbers.current.set(movement.id, movement.transaction_id);
        selectedContainers.current.set(movement.id, movement.container_number);
      }
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const allSelected = movements.length > 0 && movements.every(m => selectedIds.has(m.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      movements.forEach((m) => {
        if (allSelected) {
          next.delete(m.id);
          selectedNumbers.current.delete(m.id);
          selectedContainers.current.delete(m.id);
        } else {
          next.add(m.id);
          selectedNumbers.current.set(m.id, m.transaction_id);
          selectedContainers.current.set(m.id, m.container_number);
        }
      });
      return next;
    });
  };

  const unselect = (id) => {
    selectedNumbers.current.delete(id);
    selectedContainers.current.delete(id);
    setSelectedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const singleSelectedId = selectedIds.size === 1 ? [...selectedIds][0] : null;

  const handleClone = async () => {
    if (!cloneId || isCloning) return;
    setIsCloning(true);
    try {
      // Busca o registro no servidor: ele pode estar em outra página da lista.
      const { data: movementToClone } = await api.getMovement(cloneId);
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
      loadMovements();
    } catch (error) {
      if (error.response?.status === 404) {
        toast.error('Registro não encontrado');
      } else {
        toast.error(error.response?.data?.detail || 'Erro ao clonar registro');
      }
    } finally {
      setCloneId(null);
      setIsCloning(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId || isDeleting) return;
    setIsDeleting(true);
    const idToDelete = deleteId;
    try {
      await api.deleteMovement(idToDelete);
      toast.success('Registro deletado com sucesso');
    } catch (error) {
      if (error.response?.status === 404) {
        toast.info('Registro já foi removido');
      } else {
        toast.error(error.response?.data?.detail || 'Erro ao deletar registro');
      }
    } finally {
      setDeleteId(null);
      setIsDeleting(false);
      unselect(idToDelete);
      loadMovements();
    }
  };

  const handleDownloadPdf = async (via) => {
    if (selectedIds.size === 0 || isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    const eirFilename = (id) => documentFilename('EIR', selectedContainers.current.get(id), selectedNumbers.current.get(id) || id);
    try {
      if (selectedIds.size > 1 && separateFiles) {
        await downloadDocumentsInBatch([...selectedIds].map((id) => ({
          filename: eirFilename(id),
          load: () => api.downloadMovementsPdf([id], via).then((response) => response.data),
        })));
        setShowViaDialog(false);
        return;
      }
      const response = await api.downloadMovementsPdf([...selectedIds], via);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      const filename = selectedIds.size === 1
        ? eirFilename([...selectedIds][0])
        : `EIR-${selectedIds.size}-documentos.pdf`;
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
        <PageSkeleton testId="movements-loading" />
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

        <FilterCard hasFilters={hasFilters} onClear={clearAllFilters} onApply={loadMovements}>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <FilterField label="Data início">
              <Input type="date" value={dateFrom} onChange={e => onFilter(setDateFrom)(e.target.value)} className="h-9 text-sm" data-testid="date-from-input" />
            </FilterField>
            <FilterField label="Data fim">
              <Input type="date" value={dateTo} onChange={e => onFilter(setDateTo)(e.target.value)} className="h-9 text-sm" data-testid="date-to-input" />
            </FilterField>
            <FilterField label="Tipo">
              <Select value={filterType} onValueChange={onFilter(setFilterType)}>
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
              <Select value={filterStatus} onValueChange={onFilter(setFilterStatus)}>
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
              <SearchInput value={searchClient} onChange={e => onFilter(setSearchClient)(e.target.value)} data-testid="search-client-input" />
            </FilterField>
            <FilterField label="Nº container">
              <SearchInput value={searchContainer} onChange={e => onFilter(setSearchContainer)(e.target.value)} data-testid="search-container-input" />
            </FilterField>
            <FilterField label="Nº registro">
              <SearchInput value={searchMovement} onChange={e => onFilter(setSearchMovement)(e.target.value)} data-testid="search-movement-input" />
            </FilterField>
            <FilterField label="Motorista">
              <SearchInput value={searchDriver} onChange={e => onFilter(setSearchDriver)(e.target.value)} data-testid="search-driver-input" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um ou mais registros pra habilitar as ações da barra */}
        <DataCard
          title="Registros"
          count={formatCount(total)}
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
              totalItems={total}
              pageSize={ITEMS_PER_PAGE}
              onPageChange={goToPage}
            />
          )}
        >
          {movements.length > 0 ? (
            <div className={`overflow-x-auto transition-opacity ${fetching ? 'opacity-60' : ''}`}>
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
                    <th className="sortable" onClick={() => handleSort('transaction_id')}>Nº<SortIcon field="transaction_id" /></th>
                    <th className="sortable" onClick={() => handleSort('operation_type')}>Tipo<SortIcon field="operation_type" /></th>
                    <th className="sortable" onClick={() => handleSort('container_number')}>Container<SortIcon field="container_number" /></th>
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
                  {movements.map((movement) => {
                    const createdAt = new Date(movement.created_at);
                    return (
                      <tr
                        key={movement.id}
                        onClick={() => toggleSelect(movement)}
                        data-selected={selectedIds.has(movement.id)}
                        className="cursor-pointer"
                        data-testid="movement-row"
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(movement.id)}
                            onCheckedChange={() => toggleSelect(movement)}
                            data-testid="movement-row-checkbox"
                          />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{movement.transaction_id}</td>
                        <td>
                          <StatusPill tone={movement.operation_type === 'ENTRADA' ? 'primary' : 'amber'}>
                            {movement.operation_type === 'ENTRADA' ? 'Entrada' : 'Saída'}
                          </StatusPill>
                        </td>
                        <td className="cell-strong whitespace-nowrap font-mono text-[12px]">{movement.container_number || '-'}</td>
                        <td><div className="max-w-[110px] xl:max-w-[150px] min-[1400px]:max-w-[190px] 2xl:max-w-[300px] truncate" title={movement.client_name || ''}>{movement.client_name || '-'}</div></td>
                        <td><div className="max-w-[120px] xl:max-w-[170px] min-[1400px]:max-w-[210px] 2xl:max-w-[320px] truncate" title={movement.driver_name || ''}>{movement.driver_name}</div></td>
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
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
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
            <AlertDialogAction onClick={handleClone} disabled={isCloning} className="bg-emerald-600 hover:bg-emerald-700" data-testid="confirm-clone">
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
                : separateFiles
                  ? `Serão gerados ${selectedIds.size} PDFs, um para cada registro selecionado, com o nome EIR-CONTAINER-Nº, dentro de uma pasta compactada (.zip).`
                  : `Será gerado um único PDF com ${selectedIds.size} páginas, uma para cada registro selecionado.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selectedIds.size > 1 && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={separateFiles}
                onCheckedChange={(checked) => setSeparateFiles(checked === true)}
                disabled={isDownloadingPdf}
                data-testid="separate-files-checkbox"
              />
              Um arquivo por registro
            </label>
          )}
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
