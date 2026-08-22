import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { 
  Receipt, Plus, Search, FileText, Trash2, Eye, 
  ChevronLeft, ChevronRight, X, Check, Package,
  Calendar, User, DollarSign, Download, FileSpreadsheet,
  Edit, History, Clock, ChevronDown
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';

const ITEMS_PER_PAGE = 15;

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
  
  // Estado do Modal de Nova Fatura
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [unbilledMovements, setUnbilledMovements] = useState([]);
  const [selectedMovements, setSelectedMovements] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [clients, setClients] = useState([]);
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [addedMovements, setAddedMovements] = useState([]); // Movimentações adicionadas via busca por ID
  
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
    notes: ''
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
  const [downloadingExcel, setDownloadingExcel] = useState(null);

  useEffect(() => {
    loadInvoices();
    loadClients();
  }, [currentPage]);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const [invoicesRes, countRes] = await Promise.all([
        api.getInvoices({ page: currentPage, per_page: ITEMS_PER_PAGE }),
        api.getInvoicesCount()
      ]);
      setInvoices(invoicesRes.data);
      setTotalInvoices(countRes.data.count);
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
    setAddedMovements([]);
    setUnbilledMovements([]);
  };

  // Buscar movimentação por ID/Container (código de barras)
  const handleSearchById = async () => {
    if (!searchQuery.trim()) return;
    
    try {
      const res = await api.getUnbilledMovements({ search: searchQuery.trim() });
      if (res.data && res.data.length > 0) {
        // Adicionar movimentações encontradas que ainda não estão na lista
        const newMovements = res.data.filter(
          m => !addedMovements.some(am => am.id === m.id)
        );
        
        if (newMovements.length > 0) {
          setAddedMovements(prev => [...prev, ...newMovements]);
          // Selecionar automaticamente as novas movimentações
          setSelectedMovements(prev => {
            const newSet = new Set(prev);
            newMovements.forEach(m => newSet.add(m.id));
            return newSet;
          });
          toast.success(`${newMovements.length} movimentação(ões) adicionada(s)`);
        } else {
          toast.info('Movimentação já foi adicionada');
        }
      } else {
        toast.warning('Nenhuma movimentação encontrada com este ID/Container');
      }
      setSearchQuery('');
    } catch (error) {
      toast.error('Erro ao buscar movimentação');
    }
  };

  // Buscar movimentações por cliente (nome ou CNPJ)
  const handleSearchByClient = async () => {
    if (!clientSearchQuery.trim()) {
      setUnbilledMovements([]);
      return;
    }
    
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

    setCreating(true);
    try {
      await api.createInvoice({
        client_name: clientName,
        client_cnpj: getSelectedClientCnpj(),
        movement_ids: Array.from(selectedMovements),
        notes: invoiceNotes || null
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
      notes: invoice.notes || ''
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
        const alreadyInAvailable = editAvailableMovements.some(m => m.id === movement.id);
        
        if (alreadyInInvoice) {
          toast.info('Esta movimentação já está na fatura');
        } else if (alreadySelected) {
          toast.info('Esta movimentação já foi selecionada para adicionar');
        } else if (movement.billed) {
          toast.warning('Esta movimentação já está faturada em outra fatura');
        } else if (!alreadyInAvailable) {
          setEditAvailableMovements(prev => [movement, ...prev]);
          toast.success('Movimentação encontrada e adicionada à lista');
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
      case 'CREATED': return { label: 'Criada', color: 'bg-green-100 text-green-800' };
      case 'UPDATED': return { label: 'Atualizada', color: 'bg-blue-100 text-blue-800' };
      case 'DELETED': return { label: 'Excluída', color: 'bg-red-100 text-red-800' };
      default: return { label: action, color: 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200' };
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
    if (changes.total_value) {
      if (changes.total_value.from !== undefined) {
        items.push(`Valor: ${formatCurrency(changes.total_value.from)} → ${formatCurrency(changes.total_value.to)}`);
      } else {
        items.push(`Valor: ${formatCurrency(changes.total_value)}`);
      }
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
      setInvoiceToDelete(null);
      loadInvoices();
    } catch (error) {
      toast.error('Erro ao excluir fatura');
    } finally {
      setDeleting(false);
    }
  };

  const formatCurrency = (value) => {
    if (!value && value !== 0) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  const totalPages = Math.ceil(totalInvoices / ITEMS_PER_PAGE);

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="billing-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="billing-page">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Faturamento
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
              Gerencie as faturas do sistema
            </p>
          </div>
          <Button
            onClick={openNewInvoiceModal}
            size="default"
            className="text-[13px] font-semibold uppercase tracking-wide h-10 px-5 bg-primary hover:bg-primary/90 shadow-sm"
            data-testid="new-invoice-button"
          >
            <Plus className="w-4 h-4 mr-2" />
            Gerar Faturamento
          </Button>
        </div>

        {/* Separador */}
        <div className="border-t border-slate-200 dark:border-slate-700"></div>

        {/* Lista de Faturas */}
        <Card className="shadow-sm">
          <CardHeader className="bg-slate-50 dark:bg-slate-800/50 py-3">
            <CardTitle className="flex items-center justify-between text-[13px] font-medium text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Faturas Geradas ({totalInvoices})
              </span>
              {totalPages > 1 && (
                <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                  Página {currentPage} de {totalPages}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {invoices.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nº Fatura</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Data</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cliente</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">CNPJ</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Qtd. Movim.</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Valor Total</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Usuário</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {invoices.map((invoice) => (
                      <tr 
                        key={invoice.id} 
                        className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        data-testid="invoice-row"
                      >
                        <td className="px-4 py-2.5 text-[13px] font-bold text-primary">
                          #{invoice.invoice_number}
                        </td>
                        <td className="px-4 py-2.5 text-[13px]">
                          {format(new Date(invoice.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-2.5 text-[13px] font-medium">{invoice.client_name}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono">{invoice.client_cnpj || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px] text-center">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-[12px]">
                            {invoice.movement_ids.length}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[13px] font-mono font-bold text-green-700">
                          {formatCurrency(invoice.total_value)}
                        </td>
                        <td className="px-4 py-2.5 text-[13px] text-slate-600 dark:text-slate-400">{shortenName(invoice.user_name)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => viewInvoiceDetails(invoice)}
                              className="h-8 w-8 p-0 text-slate-600 dark:text-slate-400 hover:text-primary"
                              title="Ver detalhes"
                              data-testid={`view-invoice-${invoice.id}`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-slate-600 dark:text-slate-400 hover:text-green-600"
                              title="Baixar Excel"
                              data-testid={`download-invoice-${invoice.id}`}
                              disabled={downloadingExcel === invoice.id}
                              onClick={() => downloadExcel(invoice)}
                            >
                              {downloadingExcel === invoice.id ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                              ) : (
                                <FileSpreadsheet className="w-4 h-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditModal(invoice)}
                              className="h-8 w-8 p-0 text-slate-600 dark:text-slate-400 hover:text-blue-600"
                              title="Editar fatura"
                              data-testid={`edit-invoice-${invoice.id}`}
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => confirmDelete(invoice)}
                              className="h-8 w-8 p-0 text-slate-600 dark:text-slate-400 hover:text-red-600"
                              title="Excluir fatura"
                              data-testid={`delete-invoice-${invoice.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-10">
                <FileText className="w-12 h-12 text-slate-400 dark:text-slate-500 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium text-slate-600 dark:text-slate-400">
                  Nenhuma fatura gerada
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Clique em "Gerar Faturamento" para criar uma nova fatura
                </p>
              </div>
            )}

            {/* Controles de Paginação */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t bg-slate-50 dark:bg-slate-800">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Mostrando {((currentPage - 1) * ITEMS_PER_PAGE) + 1} a {Math.min(currentPage * ITEMS_PER_PAGE, totalInvoices)} de {totalInvoices} faturas
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="h-8 text-[12px]"
                  >
                    <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="h-8 text-[12px]"
                  >
                    Próxima
                    <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal - Nova Fatura */}
      <Dialog open={showNewInvoice} onOpenChange={setShowNewInvoice}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
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
                <Label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Buscar por ID ou Container</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Ex: 123 ou CONT1234567 (escaneie o código de barras)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchById()}
                    className="h-10 flex-1"
                    data-testid="search-movements-input"
                  />
                  <Button onClick={handleSearchById} className="h-10 px-4" data-testid="search-by-id-button">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Pressione Enter ou clique + para adicionar</p>
              </div>

              {/* Busca por Cliente (Nome ou CNPJ) */}
              <div>
                <Label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Cliente (Nome ou CNPJ)</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Ex: Empresa LTDA ou 12.345.678/0001-90"
                    value={clientSearchQuery}
                    onChange={(e) => setClientSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchByClient()}
                    className="h-10 flex-1"
                    data-testid="search-client-input"
                  />
                  <Button onClick={handleSearchByClient} className="h-10" data-testid="search-by-client-button">
                    <Search className="w-4 h-4 mr-2" />
                    Buscar
                  </Button>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Buscar movimentações pendentes do cliente</p>
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
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left w-10"></th>
                        <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">ID</th>
                        <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Data</th>
                        <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Container</th>
                        <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Cliente</th>
                        <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Tipo Serviço</th>
                        <th className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Valor</th>
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {addedMovements.map((movement) => (
                        <tr 
                          key={movement.id}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${selectedMovements.has(movement.id) ? 'bg-primary/5' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={selectedMovements.has(movement.id)}
                              onCheckedChange={() => toggleMovement(movement.id)}
                            />
                          </td>
                          <td className="px-3 py-2 font-bold text-primary">#{movement.transaction_id}</td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            {format(new Date(movement.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                          </td>
                          <td className="px-3 py-2 font-mono font-medium">{movement.container_number}</td>
                          <td className="px-3 py-2">{movement.client_name || '-'}</td>
                          <td className="px-3 py-2">{movement.service_type || '-'}</td>
                          <td className="px-3 py-2 text-right font-mono text-green-700">
                            {formatCurrency(movement.service_value)}
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAddedMovement(movement.id)}
                              className="h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
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
                      {selectedMovements.size === getAllMovements().length ? 'Desmarcar Todos' : 'Selecionar Todos'}
                    </Button>
                  )}
                </div>
                
                {loadingMovements ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <div className="max-h-[250px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left w-10"></th>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">ID</th>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Data</th>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Container</th>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Cliente</th>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Tipo Serviço</th>
                          <th className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {unbilledMovements
                          .filter(m => !addedMovements.some(am => am.id === m.id))
                          .map((movement) => (
                          <tr 
                            key={movement.id}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors ${selectedMovements.has(movement.id) ? 'bg-primary/5' : ''}`}
                            onClick={() => toggleMovement(movement.id)}
                            data-testid={`movement-row-${movement.id}`}
                          >
                            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedMovements.has(movement.id)}
                                onCheckedChange={() => toggleMovement(movement.id)}
                              />
                            </td>
                            <td className="px-3 py-2 font-bold text-primary">#{movement.transaction_id}</td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                              {format(new Date(movement.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                            </td>
                            <td className="px-3 py-2 font-mono font-medium">{movement.container_number}</td>
                            <td className="px-3 py-2">{movement.client_name || '-'}</td>
                            <td className="px-3 py-2">{movement.service_type || '-'}</td>
                            <td className="px-3 py-2 text-right font-mono text-green-700">
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
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Cliente</Label>
                    <p className="font-medium">{getSelectedClient() || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 dark:text-slate-400">CNPJ</Label>
                    <p className="font-mono">{getSelectedClientCnpj() || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Qtd. Movimentações</Label>
                    <p className="font-bold text-primary">{selectedMovements.size}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Valor Total</Label>
                    <p className="font-bold text-green-700 text-lg">{formatCurrency(getTotalValue())}</p>
                  </div>
                </div>
                
                <div className="mt-4">
                  <Label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Observações (opcional)</Label>
                  <Textarea
                    placeholder="Adicione observações para esta fatura..."
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
                  Gerar Fatura ({selectedMovements.size})
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
                  <Label className="text-xs text-slate-500 dark:text-slate-400">CNPJ</Label>
                  <p className="font-mono">{selectedInvoice.client_cnpj || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Valor Total
                  </Label>
                  <p className="font-bold text-green-700 text-lg">{formatCurrency(selectedInvoice.total_value)}</p>
                </div>
              </div>

              {selectedInvoice.notes && (
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <Label className="text-xs text-amber-700 font-medium">Observações</Label>
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
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">ID</th>
                            <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Data</th>
                            <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Container</th>
                            <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Operação</th>
                            <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Tipo Serviço</th>
                            <th className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Valor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {invoiceMovements.map((m) => (
                            <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                              <td className="px-3 py-2 font-bold text-primary">#{m.transaction_id}</td>
                              <td className="px-3 py-2">
                                {format(new Date(m.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                              </td>
                              <td className="px-3 py-2 font-mono">{m.container_number}</td>
                              <td className="px-3 py-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  m.operation_type === 'ENTRADA' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                                }`}>
                                  {m.operation_type}
                                </span>
                              </td>
                              <td className="px-3 py-2">{m.service_type || '-'}</td>
                              <td className="px-3 py-2 text-right font-mono text-green-700">
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
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionInfo.color}`}>
                                  {actionInfo.label}
                                </span>
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
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600 mr-2"></div>
                ) : (
                  <FileSpreadsheet className="w-4 h-4 mr-1.5 text-green-600" />
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
                  <Label htmlFor="edit-client-name" className="text-[13px]">Nome do Cliente *</Label>
                  <Input
                    id="edit-client-name"
                    data-testid="edit-client-name-input"
                    value={editFormData.client_name}
                    onChange={(e) => setEditFormData({ ...editFormData, client_name: e.target.value })}
                    required
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-client-cnpj" className="text-[13px]">CNPJ</Label>
                  <Input
                    id="edit-client-cnpj"
                    data-testid="edit-client-cnpj-input"
                    value={editFormData.client_cnpj}
                    onChange={handleCNPJChange}
                    className="h-10 text-[13px] font-mono"
                    placeholder="00.000.000/0000-00"
                    maxLength={18}
                  />
                </div>
              </div>
              
              <div className="space-y-1.5">
                <Label htmlFor="edit-notes" className="text-[13px]">Observações</Label>
                <Textarea
                  id="edit-notes"
                  data-testid="edit-notes-input"
                  value={editFormData.notes}
                  onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                  className="min-h-[60px] text-[13px]"
                  placeholder="Observações da fatura (opcional)"
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
                    <table className="w-full">
                      <thead className="bg-slate-50 dark:bg-slate-800 border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">ID</th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Container</th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Tipo</th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Valor</th>
                          <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Remover</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {editMovements.map((mov) => (
                          <tr 
                            key={mov.id} 
                            className={`${movementsToRemove.has(mov.id) ? 'bg-red-50 line-through opacity-60' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          >
                            <td className="px-3 py-1.5 text-[12px] font-mono">{mov.transaction_id}</td>
                            <td className="px-3 py-1.5 text-[12px]">{mov.container_number}</td>
                            <td className="px-3 py-1.5 text-[12px]">{mov.operation_type}</td>
                            <td className="px-3 py-1.5 text-[12px] text-right font-mono">{formatCurrency(mov.service_value || 0)}</td>
                            <td className="px-3 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => toggleRemoveMovement(mov.id)}
                                className={`p-1 rounded ${movementsToRemove.has(mov.id) ? 'text-green-600 hover:bg-green-100' : 'text-red-600 hover:bg-red-100'}`}
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
                    <span className="text-[11px] text-green-600">
                      {movementsToAdd.size} selecionada(s) para adicionar
                    </span>
                  )}
                </div>
                
                {/* Busca por ID */}
                <div className="p-3 border-b bg-slate-50 dark:bg-slate-800/50">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Buscar por Nº da movimentação..."
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
                    <table className="w-full">
                      <thead className="bg-slate-50 dark:bg-slate-800 border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">ID</th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Container</th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Tipo</th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Valor</th>
                          <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">Adicionar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {editAvailableMovements.map((mov) => (
                          <tr 
                            key={mov.id} 
                            className={`${movementsToAdd.has(mov.id) ? 'bg-green-50' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          >
                            <td className="px-3 py-1.5 text-[12px] font-mono">{mov.transaction_id}</td>
                            <td className="px-3 py-1.5 text-[12px]">{mov.container_number}</td>
                            <td className="px-3 py-1.5 text-[12px]">{mov.operation_type}</td>
                            <td className="px-3 py-1.5 text-[12px] text-right font-mono">{formatCurrency(mov.service_value || 0)}</td>
                            <td className="px-3 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => toggleAddMovement(mov.id)}
                                className={`p-1 rounded ${movementsToAdd.has(mov.id) ? 'text-red-600 hover:bg-red-100' : 'text-green-600 hover:bg-green-100'}`}
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
                  {saving ? 'Salvando...' : 'Salvar Alterações'}
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
              {deleting ? 'Excluindo...' : 'Excluir Fatura'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
