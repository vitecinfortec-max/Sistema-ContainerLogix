import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, PeriodFilterFields, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, UserTag, EmptyState, TablePagination, PageSkeleton,
  rowTone,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../hooks/useConfirm';
import { toast } from 'sonner';
import { 
  Receipt, Plus, Search, FileText, Trash2, Eye, 
  X, Check, Package,
  Calendar, User, DollarSign, FileSpreadsheet,
  Edit, History, Clock, ChevronDown
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { todayISO, calendarDate } from '../lib/dates';

const formatDay = (value) => (value ? format(calendarDate(value), 'dd/MM/yyyy') : '-');
// Em aberto e com vencimento já passado
const isOverdue = (invoice) => (invoice.status || 'PENDENTE') === 'PENDENTE' && !!invoice.due_date && invoice.due_date < todayISO();
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';

const ITEMS_PER_PAGE = 15;

const INVOICE_STATUS_OPTIONS = [
  { value: 'PENDENTE', label: 'Pendente', tone: 'amber' },
  { value: 'PAGO', label: 'Pago', tone: 'emerald' },
  { value: 'CANCELADO', label: 'Cancelado', tone: 'red' },
];

const getInvoiceStatusBadge = (status) => {
  return INVOICE_STATUS_OPTIONS.find(s => s.value === status) || INVOICE_STATUS_OPTIONS[0];
};

// Função para abreviar nome (primeiro e segundo nome, ignorando preposições)
const shortenName = (fullName) => {
  if (!fullName) return '-';
  const parts = fullName.trim().split(' ');
  const preposicoes = ['DE', 'DA', 'DO', 'DOS', 'DAS', 'E'];
  const nomesFiltrados = parts.filter(p => !preposicoes.includes(p.toUpperCase()));
  
  if (nomesFiltrados.length >= 2) {
    return `${nomesFiltrados[0]} ${nomesFiltrados[1]}`;
  } else if (nomesFiltrados.length === 1) {
    return nomesFiltrados[0];
  } else if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0] || '-';
};

export default function BillingPage() {
  // Estado principal - Faturas
  const [invoices, setInvoices] = useState([]);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  // Filtro por cliente da lista: age sozinho enquanto se digita, sem botão "Filtrar"
  const [clientFilter, setClientFilter] = useState('');
  const appliedClient = useDebouncedValue(clientFilter.trim());
  const [statusFilter, setStatusFilter] = useState('');
  const [stats, setStats] = useState(null);
  const { confirm, ConfirmDialog } = useConfirm();

  // Estado do Modal de Nova Fatura
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [unbilledMovements, setUnbilledMovements] = useState([]);
  const [selectedMovements, setSelectedMovements] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [clients, setClients] = useState([]);
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  // Marcar como paga pede o dia do recebimento: { invoiceId, date }
  const [payDialog, setPayDialog] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [addedMovements, setAddedMovements] = useState([]); // Movimentações adicionadas via busca por ID
  const [targetClientName, setTargetClientName] = useState(''); // Cliente definido para esta fatura (trava a busca por ID)
  const [idSearchError, setIdSearchError] = useState(''); // Mensagem em vermelho da busca por ID/Container
  
  // Estado de Detalhes
  const [showDetails, setShowDetails] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceMovements, setInvoiceMovements] = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsTab, setDetailsTab] = useState('movements'); // 'movements' ou 'history'
  const [invoiceHistory, setInvoiceHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // Estado de Edição
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [editFormData, setEditFormData] = useState({
    client_name: '',
    client_cnpj: '',
    notes: '',
    due_date: ''
  });
  const [saving, setSaving] = useState(false);
  const [editMovements, setEditMovements] = useState([]); // Movimentações atuais da fatura
  const [editAvailableMovements, setEditAvailableMovements] = useState([]); // Movimentações disponíveis para adicionar
  const [movementsToAdd, setMovementsToAdd] = useState(new Set());
  const [movementsToRemove, setMovementsToRemove] = useState(new Set());
  const [loadingEditMovements, setLoadingEditMovements] = useState(false);
  const [editSearchId, setEditSearchId] = useState('');
  
  // Estado de Exclusão
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(null);
  const [downloadingReceipt, setDownloadingReceipt] = useState(null);
  const [downloadingExcel, setDownloadingExcel] = useState(null);

  // Estado de Seleção (toolbar)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    loadClients();
  }, []);

  const [period, setPeriod] = useState(['', '']);
  const changePeriod = (value) => { setPeriod(value); setCurrentPage(1); };

  useEffect(() => {
    loadInvoices();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, appliedClient, statusFilter, period]);

  // Só a primeira carga mostra o esqueleto da tela: recarregar (ao filtrar,
  // trocar de página ou salvar) mantém a lista na tela e o foco no filtro.
  const loadInvoices = async () => {
    try {
      const clientParams = appliedClient ? { client_name: appliedClient } : {};
      const listParams = statusFilter ? { ...clientParams, status: statusFilter } : { ...clientParams };
      if (period[0]) listParams.date_from = period[0];
      if (period[1]) listParams.date_to = period[1];
      const [invoicesRes, countRes, statsRes] = await Promise.all([
        api.getInvoices({ page: currentPage, per_page: ITEMS_PER_PAGE, ...listParams }),
        api.getInvoicesCount(listParams),
        api.getInvoicesStats(clientParams),
      ]);
      setInvoices(invoicesRes.data);
      setTotalInvoices(countRes.data.count);
      setStats(statsRes.data);
    } catch (error) {
      toast.error('Erro ao carregar faturas');
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      const res = await api.getClients();
      setClients(res.data);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
      toast.error('Erro ao carregar clientes');
    }
  };

  const loadUnbilledMovements = async (clientFilter = '') => {
    try {
      setLoadingMovements(true);
      const params = {};
      if (clientFilter) params.client_name = clientFilter;
      
      const res = await api.getUnbilledMovements(params);
      setUnbilledMovements(res.data);
    } catch (error) {
      toast.error('Erro ao carregar movimentações');
    } finally {
      setLoadingMovements(false);
    }
  };

  const openNewInvoiceModal = () => {
    setShowNewInvoice(true);
    setSelectedMovements(new Set());
    setSearchQuery('');
    setClientSearchQuery('');
    setInvoiceNotes('');
    setInvoiceDueDate('');
    setAddedMovements([]);
    setUnbilledMovements([]);
    setTargetClientName('');
    setIdSearchError('');
  };

  // Compara nomes de cliente ignorando maiúsculas/minúsculas e espaços nas pontas
  const isSameClient = (a, b) => {
    if (!a || !b) return false;
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  };

  // Buscar movimentação por ID/Container (código de barras) - inclui já
  // faturadas de propósito, pra poder avisar em qual fatura já está em vez
  // de simplesmente dizer "não encontrada".
  const handleSearchById = async () => {
    if (!searchQuery.trim()) return;
    setIdSearchError('');

    try {
      const res = await api.findMovementForInvoice(searchQuery.trim());
      const matches = res.data || [];

      if (matches.length === 0) {
        setIdSearchError('Nenhuma movimentação encontrada com este ID/Container.');
        setSearchQuery('');
        return;
      }

      const alreadyBilled = matches.find(m => m.billed);
      if (alreadyBilled) {
        setIdSearchError(
          alreadyBilled.billed_invoice_number
            ? `A movimentação #${alreadyBilled.transaction_id} (${alreadyBilled.container_number}) já está na Fatura Nº ${alreadyBilled.billed_invoice_number}.`
            : `A movimentação #${alreadyBilled.transaction_id} (${alreadyBilled.container_number}) está marcada como faturada, mas não pertence a nenhuma fatura ativa.`
        );
        return;
      }

      const wrongClient = targetClientName
        ? matches.find(m => !isSameClient(m.client_name, targetClientName))
        : null;
      if (wrongClient) {
        setIdSearchError(
          `A movimentação #${wrongClient.transaction_id} (${wrongClient.container_number}) pertence ao cliente "${wrongClient.client_name || 'não definido'}", não a "${targetClientName}".`
        );
        return;
      }

      const newMovements = matches.filter(
        m => !addedMovements.some(am => am.id === m.id)
      );

      if (newMovements.length > 0) {
        setAddedMovements(prev => [...prev, ...newMovements]);
        setSelectedMovements(prev => {
          const newSet = new Set(prev);
          newMovements.forEach(m => newSet.add(m.id));
          return newSet;
        });
        if (!targetClientName && newMovements[0].client_name) {
          setTargetClientName(newMovements[0].client_name);
        }
        toast.success(`${newMovements.length} movimentação(ões) adicionada(s)`);
      } else {
        toast.info('Movimentação já foi adicionada');
      }
      setSearchQuery('');
    } catch (error) {
      toast.error('Erro ao buscar movimentação');
    }
  };

  // Buscar movimentações por cliente (nome ou CNPJ) - também define o
  // cliente desta fatura, travando a busca por ID contra outros clientes.
  const handleSearchByClient = async () => {
    if (!clientSearchQuery.trim()) {
      setUnbilledMovements([]);
      if (addedMovements.length === 0) setTargetClientName('');
      return;
    }

    const matchedClient = clients.find(
      c => isSameClient(c.name, clientSearchQuery.trim()) || c.cnpj === clientSearchQuery.trim()
    );
    setTargetClientName(matchedClient?.name || clientSearchQuery.trim());
    setIdSearchError('');

    await loadUnbilledMovements(clientSearchQuery.trim());
  };

  const handleSearch = () => {
    loadUnbilledMovements();
  };

  const toggleMovement = (id) => {
    const newSelected = new Set(selectedMovements);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedMovements(newSelected);
  };

  // Combinar movimentações adicionadas por ID e por cliente (sem duplicatas)
  const getAllMovements = () => {
    const allMovements = [...addedMovements];
    unbilledMovements.forEach(m => {
      if (!allMovements.some(am => am.id === m.id)) {
        allMovements.push(m);
      }
    });
    return allMovements;
  };

  const selectAllMovements = () => {
    const allMovements = getAllMovements();
    if (selectedMovements.size === allMovements.length) {
      setSelectedMovements(new Set());
    } else {
      setSelectedMovements(new Set(allMovements.map(m => m.id)));
    }
  };

  const removeAddedMovement = (id) => {
    setAddedMovements(prev => prev.filter(m => m.id !== id));
    setSelectedMovements(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  const getSelectedClient = () => {
    const allMovements = getAllMovements();
    const selected = allMovements.filter(m => selectedMovements.has(m.id));
    const clientNames = [...new Set(selected.map(m => m.client_name).filter(Boolean))];
    return clientNames.length === 1 ? clientNames[0] : (clientNames.length > 1 ? 'Diversos' : '');
  };

  const getSelectedClientCnpj = () => {
    const clientName = getSelectedClient();
    if (clientName && clientName !== 'Diversos') {
      const client = clients.find(c => c.name === clientName);
      return client?.cnpj || '';
    }
    return '';
  };

  const getTotalValue = () => {
    const allMovements = getAllMovements();
    return allMovements
      .filter(m => selectedMovements.has(m.id))
      .reduce((sum, m) => sum + (m.service_value || 0), 0);
  };

  const createInvoice = async () => {
    if (selectedMovements.size === 0) {
      toast.warning('Selecione pelo menos uma movimentação');
      return;
    }

    const clientName = getSelectedClient();
    if (!clientName) {
      toast.warning('As movimentações selecionadas não possuem cliente definido');
      return;
    }
    if (clientName === 'Diversos') {
      toast.error('As movimentações selecionadas pertencem a clientes diferentes. Remova as que não são do cliente desta fatura.');
      return;
    }

    setCreating(true);
    try {
      await api.createInvoice({
        client_name: clientName,
        client_cnpj: getSelectedClientCnpj(),
        movement_ids: Array.from(selectedMovements),
        notes: invoiceNotes || null,
        due_date: invoiceDueDate || null
      });
      
      toast.success('Fatura gerada com sucesso!');
      setShowNewInvoice(false);
      loadInvoices();
    } catch (error) {
      const message = error.response?.data?.detail || 'Erro ao gerar fatura';
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  // ====== Funções de Edição ======
  const openEditModal = async (invoice) => {
    setEditingInvoice(invoice);
    setEditFormData({
      client_name: invoice.client_name || '',
      client_cnpj: invoice.client_cnpj || '',
      notes: invoice.notes || '',
      due_date: invoice.due_date || ''
    });
    setMovementsToAdd(new Set());
    setMovementsToRemove(new Set());
    setEditSearchId('');
    setShowEditModal(true);
    
    // Carregar movimentações da fatura
    setLoadingEditMovements(true);
    try {
      const [movementsRes, unbilledRes] = await Promise.all([
        api.getInvoiceMovements(invoice.id),
        api.getUnbilledMovements({ client_name: invoice.client_name })
      ]);
      setEditMovements(movementsRes.data || []);
      setEditAvailableMovements(unbilledRes.data || []);
    } catch (error) {
      toast.error('Erro ao carregar movimentações');
    } finally {
      setLoadingEditMovements(false);
    }
  };

  const toggleRemoveMovement = (movementId) => {
    const newSet = new Set(movementsToRemove);
    if (newSet.has(movementId)) {
      newSet.delete(movementId);
    } else {
      newSet.add(movementId);
    }
    setMovementsToRemove(newSet);
  };

  const toggleAddMovement = (movementId) => {
    const newSet = new Set(movementsToAdd);
    if (newSet.has(movementId)) {
      newSet.delete(movementId);
    } else {
      newSet.add(movementId);
    }
    setMovementsToAdd(newSet);
  };

  const searchMovementById = async () => {
    if (!editSearchId.trim()) return;
    
    try {
      const response = await api.getMovements({ transaction_id: editSearchId.trim() });
      const movements = response.data?.movements || response.data || [];
      
      if (movements.length > 0) {
        const movement = movements[0];
        // Verificar se já está na fatura ou já foi selecionada
        const alreadyInInvoice = editMovements.some(m => m.id === movement.id);
        const alreadySelected = movementsToAdd.has(movement.id);

        if (alreadyInInvoice) {
          toast.info('Esta movimentação já está na fatura');
        } else if (alreadySelected) {
          toast.info('Esta movimentação já foi selecionada para adicionar');
        } else if (movement.billed) {
          toast.warning('Esta movimentação já está faturada em outra fatura');
        } else {
          // Garante que a movimentação apareça na lista "Adicionar Movimentações"
          // (pode já estar lá, já que a lista vem pré-carregada com as
          // pendentes do cliente) e já marca pra adicionar direto - antes,
          // quando o item já estava na lista pré-carregada, essa condição
          // não caía em nenhum dos ramos acima e a busca não fazia nada
          // visível, dando a impressão de que "não adicionava".
          setEditAvailableMovements(prev =>
            prev.some(m => m.id === movement.id) ? prev : [movement, ...prev]
          );
          setMovementsToAdd(prev => new Set(prev).add(movement.id));
          toast.success(`Movimentação #${movement.transaction_id} adicionada`);
        }
      } else {
        toast.warning('Movimentação não encontrada');
      }
    } catch (error) {
      toast.error('Erro ao buscar movimentação');
    }
    setEditSearchId('');
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingInvoice) return;

    // Verificar se vai ficar sem movimentações
    const remainingCount = editMovements.length - movementsToRemove.size + movementsToAdd.size;
    if (remainingCount === 0) {
      toast.warning('A fatura deve ter pelo menos uma movimentação');
      return;
    }

    setSaving(true);
    try {
      await api.updateInvoice(editingInvoice.id, {
        ...editFormData,
        movement_ids_to_add: Array.from(movementsToAdd),
        movement_ids_to_remove: Array.from(movementsToRemove)
      });
      toast.success('Fatura atualizada com sucesso!');
      setShowEditModal(false);
      setEditingInvoice(null);
      loadInvoices();
    } catch (error) {
      const message = error.response?.data?.detail || 'Erro ao atualizar fatura';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCNPJChange = (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length <= 14) {
      value = value.replace(/^(\d{2})(\d)/, '$1.$2');
      value = value.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
      value = value.replace(/\.(\d{3})(\d)/, '.$1/$2');
      value = value.replace(/(\d{4})(\d)/, '$1-$2');
    }
    setEditFormData({ ...editFormData, client_cnpj: value });
  };

  const viewInvoiceDetails = async (invoice) => {
    setSelectedInvoice(invoice);
    setShowDetails(true);
    setLoadingDetails(true);
    setDetailsTab('movements');
    setInvoiceHistory([]);
    
    try {
      const res = await api.getInvoiceMovements(invoice.id);
      setInvoiceMovements(res.data);
    } catch (error) {
      toast.error('Erro ao carregar detalhes da fatura');
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleUpdateInvoiceStatus = async (invoiceId, newStatus, paidDate) => {
    const target = invoices.find(inv => inv.id === invoiceId) || selectedInvoice;
    // Paga: primeiro pergunta o dia do recebimento (base do Contas a Receber)
    if (newStatus === 'PAGO' && !paidDate) {
      setPayDialog({ invoiceId, date: todayISO() });
      return;
    }
    // Cancelar devolve as movimentações para "a faturar" e não tem volta
    if (newStatus === 'CANCELADO' && !(await confirm(
      `Cancelar a Fatura Nº ${target?.invoice_number}? As movimentações dela voltam para "a faturar" e a fatura não pode ser reaberta.`,
      'Cancelar fatura'
    ))) return;
    try {
      await api.updateInvoiceStatus(invoiceId, newStatus, paidDate);
      setPayDialog(null);
      toast.success(newStatus === 'CANCELADO' ? 'Fatura cancelada. As movimentações voltaram para "a faturar".' : 'Status atualizado com sucesso!');
      const paid_date = newStatus === 'PAGO' ? paidDate : null;
      setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, status: newStatus, paid_date } : inv));
      setSelectedInvoice(prev => prev && prev.id === invoiceId ? { ...prev, status: newStatus, paid_date } : prev);
      loadInvoices();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar status');
    }
  };

  const loadInvoiceHistory = async (invoiceId) => {
    setLoadingHistory(true);
    try {
      const res = await api.getInvoiceHistory(invoiceId);
      setInvoiceHistory(res.data);
    } catch (error) {
      toast.error('Erro ao carregar histórico');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleTabChange = (tab) => {
    setDetailsTab(tab);
    if (tab === 'history' && selectedInvoice && invoiceHistory.length === 0) {
      loadInvoiceHistory(selectedInvoice.id);
    }
  };

  const formatHistoryAction = (action) => {
    switch (action) {
      case 'CREATED': return { label: 'Criada', tone: 'emerald' };
      case 'UPDATED': return { label: 'Atualizada', tone: 'blue' };
      case 'DELETED': return { label: 'Excluída', tone: 'red' };
      default: return { label: action, tone: 'slate' };
    }
  };

  const formatChanges = (changes) => {
    const items = [];
    if (changes.client_name) {
      if (changes.client_name.from) {
        items.push(`Cliente: ${changes.client_name.from} → ${changes.client_name.to}`);
      } else {
        items.push(`Cliente: ${changes.client_name}`);
      }
    }
    if (changes.client_cnpj) {
      items.push(`CNPJ: ${changes.client_cnpj.from || '-'} → ${changes.client_cnpj.to || '-'}`);
    }
    if (changes.notes) {
      items.push(`Observações alteradas`);
    }
    if (changes.due_date) {
      items.push(changes.due_date.from !== undefined
        ? `Vencimento: ${formatDay(changes.due_date.from)} → ${formatDay(changes.due_date.to)}`
        : `Vencimento: ${formatDay(changes.due_date)}`);
    }
    if (changes.paid_date && changes.paid_date.to) {
      items.push(`Recebida em ${formatDay(changes.paid_date.to)}`);
    }
    if (changes.total_value) {
      if (changes.total_value.from !== undefined) {
        items.push(`Valor: ${formatCurrency(changes.total_value.from)} → ${formatCurrency(changes.total_value.to)}`);
      } else {
        items.push(`Valor: ${formatCurrency(changes.total_value)}`);
      }
    }
    if (changes.credit_applied) {
      items.push(`Crédito do cliente usado: ${formatCurrency(changes.credit_applied.from)} → ${formatCurrency(changes.credit_applied.to)}`);
    }
    if (changes.credit_returned) {
      items.push(`${formatCurrency(changes.credit_returned)} de crédito devolvido ao cliente`);
    }
    if (changes.reason && (changes.credit_applied || changes.credit_returned)) {
      items.push(changes.reason);
    }
    if (changes.movements_count) {
      items.push(`${changes.movements_count} movimentação(ões)`);
    }
    if (changes.movements_added) {
      items.push(`+${changes.movements_added.length} movimentação(ões) adicionada(s)`);
    }
    if (changes.movements_removed) {
      items.push(`-${changes.movements_removed.length} movimentação(ões) removida(s)`);
    }
    return items;
  };

  const downloadPdf = async (invoice) => {
    setDownloadingPdf(invoice.id);
    try {
      const response = await api.downloadInvoicePdf(invoice.id);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fatura_${invoice.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('PDF da fatura baixado com sucesso!');
    } catch (error) {
      toast.error('Erro ao baixar PDF da fatura');
    } finally {
      setDownloadingPdf(null);
    }
  };

  // Recibo de pagamento: só para fatura paga
  const downloadReceipt = async (invoice) => {
    setDownloadingReceipt(invoice.id);
    try {
      const response = await api.downloadInvoiceReceiptPdf(invoice.id);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recibo_fatura_${invoice.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Recibo baixado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar o recibo da fatura');
    } finally {
      setDownloadingReceipt(null);
    }
  };

  const downloadExcel = async (invoice) => {
    setDownloadingExcel(invoice.id);
    try {
      const response = await api.downloadInvoiceExcel(invoice.id);
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fatura_${invoice.invoice_number}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Excel da fatura baixado com sucesso!');
    } catch (error) {
      toast.error('Erro ao baixar Excel da fatura');
    } finally {
      setDownloadingExcel(null);
    }
  };

  const confirmDelete = (invoice) => {
    setInvoiceToDelete(invoice);
    setShowDeleteConfirm(true);
  };

  const deleteInvoice = async () => {
    if (!invoiceToDelete) return;

    setDeleting(true);
    try {
      await api.deleteInvoice(invoiceToDelete.id);
      toast.success('Fatura excluída com sucesso');
      setShowDeleteConfirm(false);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(invoiceToDelete.id);
        return next;
      });
      setInvoiceToDelete(null);
      loadInvoices();
    } catch (error) {
      toast.error('Erro ao excluir fatura');
    } finally {
      setDeleting(false);
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
    setSelectedIds(prev => {
      const pageIds = invoices.map(i => i.id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  };

  const singleSelectedInvoice = selectedIds.size === 1
    ? invoices.find(i => i.id === [...selectedIds][0])
    : null;

  const formatCurrency = (value) => {
    if (!value && value !== 0) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  const totalPages = Math.ceil(totalInvoices / ITEMS_PER_PAGE);

  const clearClientFilter = () => {
    setClientFilter('');
    setStatusFilter('');
    setPeriod(['', '']);
    setCurrentPage(1);
  };

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  if (loading) {
    return (
      <Layout>
        <PageSkeleton testId="billing-loading" />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4" data-testid="billing-page">
        <PageHeader icon={Receipt} title="Faturamento" subtitle="Gerencie as faturas do sistema" />

        {stats && (
          <StatGrid>
            <StatCard label="Em aberto" value={formatCurrency(stats.PENDENTE.total)} icon={Clock} tone="amber" hint={`${stats.PENDENTE.count} fatura(s) pendente(s)`} testId="invoice-kpi-pending" />
            <StatCard label="Recebido" value={formatCurrency(stats.PAGO.total)} icon={Check} tone="emerald" hint={`${stats.PAGO.count} fatura(s) paga(s)`} testId="invoice-kpi-paid" />
            <StatCard label="Cancelado" value={formatCurrency(stats.CANCELADO.total)} icon={X} tone="red" hint={`${stats.CANCELADO.count} fatura(s)`} />
            <StatCard label="Faturas" value={stats.PENDENTE.count + stats.PAGO.count + stats.CANCELADO.count} icon={Receipt} tone="blue" hint={appliedClient ? 'do cliente filtrado' : 'no total'} />
          </StatGrid>
        )}

        <FilterCard hasFilters={!!appliedClient || !!clientFilter || !!statusFilter || !!period[0] || !!period[1]} onClear={clearClientFilter}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Cliente">
              <SearchInput
                value={clientFilter}
                onChange={(e) => { setClientFilter(e.target.value); setCurrentPage(1); }}
                data-testid="invoice-client-filter"
              />
            </FilterField>
            <FilterField label="Status">
              <Select
                value={statusFilter || 'ALL'}
                onValueChange={(v) => { setStatusFilter(v === 'ALL' ? '' : v); setCurrentPage(1); }}
              >
                <SelectTrigger className="h-9 text-[13px]" data-testid="invoice-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  {INVOICE_STATUS_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <PeriodFilterFields value={period} onChange={changePeriod} testIdPrefix="invoice" />
          </div>
        </FilterCard>

        {/* Lista - marque uma fatura pra habilitar as ações da barra */}
        <DataCard
          title="Faturas geradas"
          count={totalInvoices}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Gerar faturamento" onClick={openNewInvoiceModal} testId="new-invoice-button" />}
            >
              <ToolbarButton
                icon={Eye}
                label="Ver detalhes"
                tone="primary"
                onClick={() => singleSelectedInvoice && viewInvoiceDetails(singleSelectedInvoice)}
                disabled={!singleSelectedInvoice}
                testId={singleSelectedInvoice ? `view-invoice-${singleSelectedInvoice.id}` : undefined}
              />
              <ToolbarButton
                icon={Edit}
                label="Editar"
                tone="blue"
                onClick={() => singleSelectedInvoice && openEditModal(singleSelectedInvoice)}
                disabled={!singleSelectedInvoice || singleSelectedInvoice.status === 'CANCELADO'}
                testId={singleSelectedInvoice ? `edit-invoice-${singleSelectedInvoice.id}` : undefined}
              />
              <ToolbarDivider />
              <ToolbarButton
                icon={FileText}
                label={singleSelectedInvoice && downloadingPdf === singleSelectedInvoice.id ? 'Gerando PDF...' : 'Baixar PDF'}
                tone="red"
                onClick={() => singleSelectedInvoice && downloadPdf(singleSelectedInvoice)}
                disabled={!singleSelectedInvoice || downloadingPdf === singleSelectedInvoice?.id}
              />
              <ToolbarButton
                icon={FileSpreadsheet}
                label={singleSelectedInvoice && downloadingExcel === singleSelectedInvoice.id ? 'Gerando Excel...' : 'Baixar Excel'}
                tone="emerald"
                onClick={() => singleSelectedInvoice && downloadExcel(singleSelectedInvoice)}
                disabled={!singleSelectedInvoice || downloadingExcel === singleSelectedInvoice?.id}
                testId={singleSelectedInvoice ? `download-invoice-${singleSelectedInvoice.id}` : undefined}
              />
              <ToolbarButton
                icon={Receipt}
                label={singleSelectedInvoice && downloadingReceipt === singleSelectedInvoice.id ? 'Gerando recibo...' : 'Recibo'}
                tone="primary"
                onClick={() => singleSelectedInvoice && downloadReceipt(singleSelectedInvoice)}
                disabled={!singleSelectedInvoice || singleSelectedInvoice.status !== 'PAGO' || downloadingReceipt === singleSelectedInvoice?.id}
                testId="invoice-receipt-button"
              />
              <ToolbarDivider />
              <ToolbarButton
                icon={Trash2}
                label="Excluir"
                tone="red"
                onClick={() => singleSelectedInvoice && confirmDelete(singleSelectedInvoice)}
                disabled={!singleSelectedInvoice}
                testId={singleSelectedInvoice ? `delete-invoice-${singleSelectedInvoice.id}` : undefined}
              />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalInvoices}
              pageSize={ITEMS_PER_PAGE}
              onPageChange={goToPage}
            />
          )}
        >
          {invoices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={invoices.length > 0 && invoices.every(i => selectedIds.has(i.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Nº fatura</th>
                    <th>Data</th>
                    <th>Vencimento</th>
                    <th>Cliente</th>
                    <th>CNPJ</th>
                    <th className="!text-right">Qtd. movim.</th>
                    <th className="!text-right">Valor total</th>
                    <th>Status</th>
                    <th>Usuário</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => {
                    const badge = getInvoiceStatusBadge(invoice.status);
                    return (
                      <tr
                        key={invoice.id}
                        data-selected={selectedIds.has(invoice.id)}
                        data-row-tone={rowTone(isOverdue(invoice) ? 'alert' : invoice.status === 'CANCELADO' ? 'off' : null)}
                        className="cursor-pointer"
                        onClick={() => toggleSelect(invoice.id)}
                        data-testid="invoice-row"
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(invoice.id)}
                            onCheckedChange={() => toggleSelect(invoice.id)}
                          />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{invoice.invoice_number}</td>
                        <td className="whitespace-nowrap tabular-nums">
                          {format(new Date(invoice.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                        </td>
                        <td className={`whitespace-nowrap tabular-nums ${isOverdue(invoice) ? 'text-destructive font-semibold' : ''}`} title={isOverdue(invoice) ? 'Vencida' : undefined}>
                          {formatDay(invoice.due_date)}
                        </td>
                        <td><div className="max-w-[260px] truncate font-medium text-slate-700 dark:text-slate-200" title={invoice.client_name || ''}>{invoice.client_name}</div></td>
                        <td className="whitespace-nowrap tabular-nums text-slate-500 dark:text-slate-400">{invoice.client_cnpj || '-'}</td>
                        <td className="text-right tabular-nums">{invoice.movement_ids.length}</td>
                        <td className="text-right whitespace-nowrap tabular-nums cell-strong">
                          {formatCurrency(invoice.total_value)}
                          {invoice.credit_applied > 0 && invoice.status === 'PENDENTE' && (
                            <div className="text-[11px] font-normal text-muted-foreground" title={`Crédito do cliente usado: ${formatCurrency(invoice.credit_applied)}`}>
                              falta {formatCurrency(invoice.open_value)}
                            </div>
                          )}
                        </td>
                        <td><StatusPill tone={badge.tone}>{badge.label}</StatusPill></td>
                        <td><UserTag name={invoice.user_name ? shortenName(invoice.user_name) : null} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={FileText}
              title={appliedClient ? 'Nenhuma fatura encontrada para esse cliente' : 'Nenhuma fatura gerada'}
              hint={appliedClient ? 'Ajuste o filtro' : 'Clique em "Gerar faturamento" para criar uma nova fatura'}
            />
          )}
        </DataCard>
      </div>

      {/* Modal - Nova Fatura */}
      <Dialog open={showNewInvoice} onOpenChange={setShowNewInvoice}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Receipt className="w-4 h-4 text-primary" />
              Gerar Nova Fatura
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              Selecione as movimentações para incluir na fatura
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-4">
            {/* Campos de Busca */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
              {/* Busca por ID/Container (Código de Barras) */}
              <div>
                <Label className="mb-1.5 block">Buscar por ID ou Container</Label>
                <div className="flex gap-2">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchById()}
                    className="flex-1"
                    data-testid="search-movements-input"
                  />
                  <Button title="Adicionar" aria-label="Adicionar" onClick={handleSearchById} className="px-4" data-testid="search-by-id-button">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Pressione Enter ou clique + para adicionar</p>
                {idSearchError && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1.5" data-testid="id-search-error">
                    {idSearchError}
                  </p>
                )}
              </div>

              {/* Cliente a Faturar (Nome ou CNPJ) */}
              <div>
                <Label className="mb-1.5 block">Cliente a Faturar (Nome ou CNPJ)</Label>
                <div className="flex gap-2">
                  <Input
                    value={clientSearchQuery}
                    onChange={(e) => setClientSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchByClient()}
                    disabled={!!targetClientName && (addedMovements.length > 0 || selectedMovements.size > 0)}
                    className="flex-1"
                    data-testid="search-client-input"
                  />
                  <Button
                    onClick={handleSearchByClient}
                    disabled={!!targetClientName && (addedMovements.length > 0 || selectedMovements.size > 0)}
                    data-testid="search-by-client-button"
                  >
                    <Search className="w-4 h-4 mr-2" />
                    Buscar
                  </Button>
                </div>
                {targetClientName ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                    Faturando para: {targetClientName}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    Define o cliente desta fatura — movimentações de outro cliente são bloqueadas
                  </p>
                )}
              </div>
            </div>

            {/* Lista de Movimentações Adicionadas por ID/Código de Barras */}
            {addedMovements.length > 0 && (
              <div className="border rounded-lg border-primary/30">
                <div className="flex items-center justify-between px-4 py-2 bg-primary/10 border-b border-primary/30">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Movimentações Adicionadas ({addedMovements.length})
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Adicionadas via busca por ID/Código de Barras</span>
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  <table className="data-table">
                    <thead className="sticky top-0">
                      <tr>
                        <th className="w-10"></th>
                        <th>ID</th>
                        <th>Data</th>
                        <th>Container</th>
                        <th>Cliente</th>
                        <th>Tipo Serviço</th>
                        <th className="!text-right">Valor</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {addedMovements.map((movement) => (
                        <tr 
                          key={movement.id}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${selectedMovements.has(movement.id) ? 'bg-primary/5' : ''}`}
                        >
                          <td>
                            <Checkbox
                              checked={selectedMovements.has(movement.id)}
                              onCheckedChange={() => toggleMovement(movement.id)}
                            />
                          </td>
                          <td className="font-bold text-primary">#{movement.transaction_id}</td>
                          <td className="text-slate-600 dark:text-slate-400">
                            {format(new Date(movement.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                          </td>
                          <td className="font-mono font-medium">{movement.container_number}</td>
                          <td>{movement.client_name || '-'}</td>
                          <td>{movement.service_type || '-'}</td>
                          <td className="text-right font-mono text-emerald-700">
                            {formatCurrency(movement.service_value)}
                          </td>
                          <td>
                            <Button title="Remover" aria-label="Remover"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAddedMovement(movement.id)}
                              className="h-6 w-6 p-0 text-destructive hover:text-red-700 hover:bg-red-50"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Lista de Movimentações do Cliente (Pendentes) */}
            {(unbilledMovements.length > 0 || loadingMovements) && (
              <div className="border rounded-lg">
                <div className="flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-slate-800 border-b">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Movimentações Pendentes do Cliente ({unbilledMovements.filter(m => !addedMovements.some(am => am.id === m.id)).length})
                  </span>
                  {unbilledMovements.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={selectAllMovements}>
                      {selectedMovements.size === getAllMovements().length ? 'Desmarcar todos' : 'Selecionar todos'}
                    </Button>
                  )}
                </div>
                
                {loadingMovements ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <div className="max-h-[250px] overflow-y-auto">
                    <table className="data-table">
                      <thead className="sticky top-0">
                        <tr>
                          <th className="w-10"></th>
                          <th>ID</th>
                          <th>Data</th>
                          <th>Container</th>
                          <th>Cliente</th>
                          <th>Tipo Serviço</th>
                          <th className="!text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unbilledMovements
                          .filter(m => !addedMovements.some(am => am.id === m.id))
                          .map((movement) => (
                          <tr 
                            key={movement.id}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors ${selectedMovements.has(movement.id) ? 'bg-primary/5' : ''}`}
                            onClick={() => toggleMovement(movement.id)}
                            data-testid={`movement-row-${movement.id}`}
                          >
                            <td onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedMovements.has(movement.id)}
                                onCheckedChange={() => toggleMovement(movement.id)}
                              />
                            </td>
                            <td className="font-bold text-primary">#{movement.transaction_id}</td>
                            <td className="text-slate-600 dark:text-slate-400">
                              {format(new Date(movement.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                            </td>
                            <td className="font-mono font-medium">{movement.container_number}</td>
                            <td>{movement.client_name || '-'}</td>
                            <td>{movement.service_type || '-'}</td>
                            <td className="text-right font-mono text-emerald-700">
                              {formatCurrency(movement.service_value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Mensagem quando não há movimentações */}
            {addedMovements.length === 0 && unbilledMovements.length === 0 && !loadingMovements && (
              <div className="text-center py-12 border rounded-lg bg-slate-50 dark:bg-slate-800">
                <Package className="w-12 h-12 mx-auto mb-3 text-slate-400 dark:text-slate-500 opacity-50" />
                <p className="text-slate-600 dark:text-slate-400 font-medium">Nenhuma movimentação adicionada</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Use o campo "Buscar por ID" para adicionar movimentações pelo código de barras,<br/>
                  ou busque por cliente para ver todas as movimentações pendentes.
                </p>
              </div>
            )}

            {/* Resumo da Fatura */}
            {selectedMovements.size > 0 && (
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-3">Resumo da Fatura</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Label className="mb-1.5 block">Cliente</Label>
                    <p className="font-medium">{getSelectedClient() || '-'}</p>
                  </div>
                  <div>
                    <Label className="mb-1.5 block">CNPJ</Label>
                    <p className="font-mono">{getSelectedClientCnpj() || '-'}</p>
                  </div>
                  <div>
                    <Label className="mb-1.5 block">Qtd. Movimentações</Label>
                    <p className="font-bold text-primary">{selectedMovements.size}</p>
                  </div>
                  <div>
                    <Label className="mb-1.5 block">Valor Total</Label>
                    <p className="font-bold text-emerald-700 text-lg">{formatCurrency(getTotalValue())}</p>
                  </div>
                </div>

                <div className="mt-4 max-w-[220px]">
                  <Label className="mb-1.5 block">Vencimento (opcional)</Label>
                  <Input type="date" className="h-9" min={todayISO()} value={invoiceDueDate} onChange={(e) => setInvoiceDueDate(e.target.value)} data-testid="invoice-due-date" />
                </div>

                <div className="mt-4">
                  <Label className="mb-1.5 block">Observações (opcional)</Label>
                  <Textarea
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    className="h-20"
                    data-testid="invoice-notes"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setShowNewInvoice(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={createInvoice} 
              disabled={selectedMovements.size === 0 || creating}
              className="bg-primary hover:bg-primary/90"
              data-testid="confirm-create-invoice"
            >
              {creating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Gerando...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Gerar fatura ({selectedMovements.size})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal - Detalhes da Fatura */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Fatura #{selectedInvoice?.invoice_number}
            </DialogTitle>
          </DialogHeader>

          {selectedInvoice && (
            <div className="flex-1 overflow-y-auto space-y-4 py-4">
              {/* Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-slate-500 dark:text-slate-400">Status:</span>
                  <StatusPill tone={getInvoiceStatusBadge(selectedInvoice.status).tone} className="text-xs px-3 py-1">
                    {getInvoiceStatusBadge(selectedInvoice.status).label}
                  </StatusPill>
                </div>
                <Select
                  value={selectedInvoice.status || 'PENDENTE'}
                  onValueChange={(val) => handleUpdateInvoiceStatus(selectedInvoice.id, val)}
                  disabled={selectedInvoice.status === 'CANCELADO'}
                >
                  <SelectTrigger className="w-40 h-9 text-[13px]" data-testid="invoice-status-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVOICE_STATUS_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Informações da Fatura */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <div>
                  <Label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Data
                  </Label>
                  <p className="font-medium">
                    {format(new Date(selectedInvoice.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <User className="w-3 h-3" /> Cliente
                  </Label>
                  <p className="font-medium">{selectedInvoice.client_name}</p>
                </div>
                <div>
                  <Label className="text-slate-500 dark:text-slate-400 mb-1.5 block">CNPJ</Label>
                  <p className="font-mono">{selectedInvoice.client_cnpj || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Valor Total
                  </Label>
                  <p className="font-bold text-emerald-700 text-lg">{formatCurrency(selectedInvoice.total_value)}</p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Vencimento
                  </Label>
                  <p className={`font-medium ${isOverdue(selectedInvoice) ? 'text-destructive' : ''}`}>
                    {formatDay(selectedInvoice.due_date)}{isOverdue(selectedInvoice) ? ' (vencida)' : ''}
                  </p>
                </div>
                {selectedInvoice.paid_date && (
                  <div>
                    <Label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Recebida em
                    </Label>
                    <p className="font-medium">{formatDay(selectedInvoice.paid_date)}{selectedInvoice.paid_by_credit ? ' (com crédito)' : ''}</p>
                  </div>
                )}
                {selectedInvoice.credit_applied > 0 && (
                  <div data-testid="invoice-credit-applied">
                    <Label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <DollarSign className="w-3 h-3" /> Crédito do cliente usado
                    </Label>
                    <p className="font-medium">
                      {formatCurrency(selectedInvoice.credit_applied)}
                      {selectedInvoice.status === 'PENDENTE' && (
                        <span className="text-xs text-muted-foreground"> · falta receber {formatCurrency(selectedInvoice.open_value)}</span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              {selectedInvoice.notes && (
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <Label className="text-amber-700 mb-1.5 block">Observações</Label>
                  <p className="text-sm text-amber-900 mt-1">{selectedInvoice.notes}</p>
                </div>
              )}

              {/* Abas */}
              <div className="border-b border-slate-200 dark:border-slate-700">
                <div className="flex gap-1">
                  <button
                    onClick={() => handleTabChange('movements')}
                    className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                      detailsTab === 'movements'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                    data-testid="tab-movements"
                  >
                    <Package className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                    Movimentações ({selectedInvoice.movement_ids.length})
                  </button>
                  <button
                    onClick={() => handleTabChange('history')}
                    className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                      detailsTab === 'history'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                    data-testid="tab-history"
                  >
                    <History className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                    Histórico
                  </button>
                </div>
              </div>

              {/* Conteúdo das Abas */}
              {detailsTab === 'movements' && (
                <div>
                  {loadingDetails ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Data</th>
                            <th>Container</th>
                            <th>Operação</th>
                            <th>Tipo Serviço</th>
                            <th className="!text-right">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoiceMovements.map((m) => (
                            <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                              <td className="font-bold text-primary">#{m.transaction_id}</td>
                              <td>
                                {format(new Date(m.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                              </td>
                              <td className="font-mono">{m.container_number}</td>
                              <td>
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  m.operation_type === 'ENTRADA' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300'
                                }`}>
                                  {m.operation_type}
                                </span>
                              </td>
                              <td>{m.service_type || '-'}</td>
                              <td className="text-right font-mono text-emerald-700">
                                {formatCurrency(m.service_value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {detailsTab === 'history' && (
                <div>
                  {loadingHistory ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                  ) : invoiceHistory.length > 0 ? (
                    <div className="space-y-3">
                      {invoiceHistory.map((h) => {
                        const actionInfo = formatHistoryAction(h.action);
                        const changesList = formatChanges(h.changes);
                        return (
                          <div key={h.id} className="border rounded-lg p-3 bg-white dark:bg-slate-900">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <StatusPill tone={actionInfo.tone} dot={false}>
                                  {actionInfo.label}
                                </StatusPill>
                                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{h.user_name}</span>
                              </div>
                              <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {format(new Date(h.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                              </span>
                            </div>
                            {changesList.length > 0 && (
                              <ul className="mt-2 text-[12px] text-slate-600 dark:text-slate-400 space-y-0.5">
                                {changesList.map((change, idx) => (
                                  <li key={idx} className="flex items-center gap-1.5">
                                    <span className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-500"></span>
                                    {change}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                      <History className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p className="text-[13px]">Nenhum histórico de alterações</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="border-t pt-4">
            <div className="flex items-center justify-between w-full">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => selectedInvoice && downloadExcel(selectedInvoice)}
                disabled={downloadingExcel === selectedInvoice?.id}
                className="text-[12px]"
                data-testid="details-download-excel"
              >
                {downloadingExcel === selectedInvoice?.id ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600 mr-2"></div>
                ) : (
                  <FileSpreadsheet className="w-4 h-4 mr-1.5 text-emerald-600" />
                )}
                Baixar Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowDetails(false)} className="text-[12px]">
                Fechar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal - Edição de Fatura */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="edit-invoice-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Edit className="w-4 h-4 text-primary" />
              Editar Fatura #{editingInvoice?.invoice_number}
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              Atualize as informações e gerencie as movimentações da fatura
            </DialogDescription>
          </DialogHeader>
          
          <div className="overflow-y-auto flex-1 pr-2">
            <form onSubmit={handleEditSubmit} className="space-y-4">
              {/* Dados do Cliente */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-client-name" className="block">Nome do Cliente *</Label>
                  <Input
                    id="edit-client-name"
                    data-testid="edit-client-name-input"
                    value={editFormData.client_name}
                    onChange={(e) => setEditFormData({ ...editFormData, client_name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-client-cnpj" className="block">CNPJ</Label>
                  <Input
                    id="edit-client-cnpj"
                    data-testid="edit-client-cnpj-input"
                    value={editFormData.client_cnpj}
                    onChange={handleCNPJChange}
                    className="font-mono"
                    maxLength={18}
                  />
                </div>
              </div>
              
              <div className="space-y-1.5 max-w-[220px]">
                <Label htmlFor="edit-due-date" className="block">Vencimento</Label>
                <Input
                  id="edit-due-date"
                  type="date"
                  className="h-9"
                  data-testid="edit-due-date-input"
                  value={editFormData.due_date}
                  onChange={(e) => setEditFormData({ ...editFormData, due_date: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-notes" className="block">Observações</Label>
                <Textarea
                  id="edit-notes"
                  data-testid="edit-notes-input"
                  value={editFormData.notes}
                  onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                  className="min-h-[60px] text-[13px]"
                />
              </div>

              {/* Movimentações Atuais */}
              <div className="border rounded-lg">
                <div className="bg-slate-50 dark:bg-slate-800 px-3 py-2 border-b flex items-center justify-between">
                  <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
                    Movimentações na Fatura ({editMovements.length - movementsToRemove.size})
                  </span>
                  {movementsToRemove.size > 0 && (
                    <span className="text-[11px] text-red-600">
                      {movementsToRemove.size} marcada(s) para remover
                    </span>
                  )}
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {loadingEditMovements ? (
                    <div className="p-4 text-center text-[13px] text-slate-500 dark:text-slate-400">Carregando...</div>
                  ) : editMovements.length > 0 ? (
                    <table className="data-table">
                      <thead className="sticky top-0">
                        <tr>
                          <th>ID</th>
                          <th>Container</th>
                          <th>Tipo</th>
                          <th className="!text-right">Valor</th>
                          <th className="!text-center">Remover</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editMovements.map((mov) => (
                          <tr 
                            key={mov.id} 
                            className={`${movementsToRemove.has(mov.id) ? 'bg-red-50 line-through opacity-60' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          >
                            <td className="text-[12px] font-mono">{mov.transaction_id}</td>
                            <td className="text-[12px]">{mov.container_number}</td>
                            <td className="text-[12px]">{mov.operation_type}</td>
                            <td className="text-[12px] text-right font-mono">{formatCurrency(mov.service_value || 0)}</td>
                            <td className="text-center">
                              <button aria-label={movementsToRemove.has(mov.id) ? 'Desfazer remoção' : 'Remover da fatura'}
                                type="button"
                                onClick={() => toggleRemoveMovement(mov.id)}
                                className={`p-1 rounded ${movementsToRemove.has(mov.id) ? 'text-emerald-600 hover:bg-emerald-100' : 'text-red-600 hover:bg-red-100'}`}
                                title={movementsToRemove.has(mov.id) ? 'Desfazer remoção' : 'Remover da fatura'}
                              >
                                {movementsToRemove.has(mov.id) ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4 text-center text-[13px] text-slate-500 dark:text-slate-400">Nenhuma movimentação</div>
                  )}
                </div>
              </div>

              {/* Adicionar Movimentações */}
              <div className="border rounded-lg">
                <div className="bg-slate-50 dark:bg-slate-800 px-3 py-2 border-b flex items-center justify-between">
                  <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
                    Adicionar Movimentações
                  </span>
                  {movementsToAdd.size > 0 && (
                    <span className="text-[11px] text-emerald-600">
                      {movementsToAdd.size} selecionada(s) para adicionar
                    </span>
                  )}
                </div>
                
                {/* Busca por ID */}
                <div className="p-3 border-b bg-slate-50 dark:bg-slate-800/50">
                  <div className="flex gap-2">
                    <Input
                      value={editSearchId}
                      onChange={(e) => setEditSearchId(e.target.value)}
                      className="h-9 text-[13px] flex-1"
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), searchMovementById())}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={searchMovementById} className="h-9 text-[12px]">
                      <Search className="w-3.5 h-3.5 mr-1" />
                      Buscar
                    </Button>
                  </div>
                </div>

                <div className="max-h-40 overflow-y-auto">
                  {editAvailableMovements.length > 0 ? (
                    <table className="data-table">
                      <thead className="sticky top-0">
                        <tr>
                          <th>ID</th>
                          <th>Container</th>
                          <th>Tipo</th>
                          <th className="!text-right">Valor</th>
                          <th className="!text-center">Adicionar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editAvailableMovements.map((mov) => (
                          <tr 
                            key={mov.id} 
                            className={`${movementsToAdd.has(mov.id) ? 'bg-emerald-50' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          >
                            <td className="text-[12px] font-mono">{mov.transaction_id}</td>
                            <td className="text-[12px]">{mov.container_number}</td>
                            <td className="text-[12px]">{mov.operation_type}</td>
                            <td className="text-[12px] text-right font-mono">{formatCurrency(mov.service_value || 0)}</td>
                            <td className="text-center">
                              <button aria-label={movementsToAdd.has(mov.id) ? 'Remover seleção' : 'Adicionar à fatura'}
                                type="button"
                                onClick={() => toggleAddMovement(mov.id)}
                                className={`p-1 rounded ${movementsToAdd.has(mov.id) ? 'text-red-600 hover:bg-red-100' : 'text-emerald-600 hover:bg-emerald-100'}`}
                                title={movementsToAdd.has(mov.id) ? 'Remover seleção' : 'Adicionar à fatura'}
                              >
                                {movementsToAdd.has(mov.id) ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4 text-center text-[13px] text-slate-500 dark:text-slate-400">
                      Nenhuma movimentação disponível para adicionar
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setShowEditModal(false)}
                  disabled={saving}
                  className="text-[13px]"
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit"
                  className="text-[13px] font-semibold"
                  disabled={saving}
                  data-testid="save-invoice-button"
                >
                  {saving ? 'Salvando...' : 'Salvar alterações'}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal - Confirmação de Exclusão */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Excluir Fatura</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a fatura #{invoiceToDelete?.invoice_number}?
              <br />
              <br />
              As movimentações associadas serão desmarcadas como faturadas e poderão ser incluídas em uma nova fatura.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
              Cancelar
            </Button>
            <Button 
              variant="destructive" 
              onClick={deleteInvoice}
              disabled={deleting}
              data-testid="confirm-delete-invoice"
            >
              {deleting ? 'Excluindo...' : 'Excluir fatura'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Dia do recebimento ao marcar como paga */}
      <Dialog open={!!payDialog} onOpenChange={(open) => !open && setPayDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Marcar fatura como paga</DialogTitle>
            <DialogDescription>Informe o dia em que o pagamento foi recebido.</DialogDescription>
          </DialogHeader>
          {payDialog && (
            <div className="space-y-1.5">
              <Label htmlFor="invoice-paid-date" className="block">Recebida em *</Label>
              <Input
                id="invoice-paid-date" type="date" className="h-9" max={todayISO()}
                value={payDialog.date} onChange={(e) => setPayDialog((prev) => ({ ...prev, date: e.target.value }))}
                data-testid="invoice-paid-date"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog(null)}>Cancelar</Button>
            <Button
              onClick={() => (payDialog?.date ? handleUpdateInvoiceStatus(payDialog.invoiceId, 'PAGO', payDialog.date) : toast.error('Informe a data do recebimento'))}
              data-testid="invoice-paid-confirm"
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
