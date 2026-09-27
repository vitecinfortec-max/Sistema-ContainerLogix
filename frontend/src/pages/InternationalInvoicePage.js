import { useEffect, useState, useRef } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
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
  Plus, Search, FileText, Trash2, Eye, 
  X, Check, Globe,
  Calendar, User, DollarSign, Download, Building2,
  Loader2, FileDown, Pencil
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const ITEMS_PER_PAGE = 15;

const CURRENCIES = [
  { value: 'USD', label: 'USD - Dólar Americano', symbol: '$' },
  { value: 'EUR', label: 'EUR - Euro', symbol: '€' },
  { value: 'BRL', label: 'BRL - Real Brasileiro', symbol: 'R$' },
];

const STATUS_OPTIONS = [
  { value: 'EMITIDA', label: 'Emitida', tone: 'blue' },
  { value: 'PAGA', label: 'Paga', tone: 'emerald' },
  { value: 'CANCELADA', label: 'Cancelada', tone: 'red' },
];

export default function InternationalInvoicePage() {
  // Estado principal
  const [invoices, setInvoices] = useState([]);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCurrency, setFilterCurrency] = useState('');
  
  // Estado do Modal de Nova Invoice
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [creating, setCreating] = useState(false);
  const [clients, setClients] = useState([]);
  const [receiverData, setReceiverData] = useState(null);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientInputRef = useRef(null);
  
  // Formulário de nova invoice
  const [formData, setFormData] = useState({
    payer_client_id: '',
    payer_company: '',
    payer_cnpj: '',
    payer_contact: '',
    payer_email: '',
    payer_address: '',
    issue_date: format(new Date(), 'yyyy-MM-dd'),
    due_date: '',
    currency: 'USD',
    notes: '',
  });
  
  // Itens da invoice
  const [invoiceItems, setInvoiceItems] = useState([
    { description: '', quantity: 1, unit_price: 0, total: 0 }
  ]);
  
  // Estado de Detalhes
  const [showDetails, setShowDetails] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  
  // Estado de Edição
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editFormData, setEditFormData] = useState({
    payer_client_id: '',
    payer_company: '',
    payer_cnpj: '',
    payer_contact: '',
    payer_email: '',
    payer_address: '',
    issue_date: '',
    due_date: '',
    currency: 'USD',
    notes: '',
  });
  const [editInvoiceItems, setEditInvoiceItems] = useState([]);
  const [editClientSearch, setEditClientSearch] = useState('');
  const [showEditClientDropdown, setShowEditClientDropdown] = useState(false);
  const editClientInputRef = useRef(null);

  // Estado de Exclusão
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(null);

  // Estado de Seleção (toolbar)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    loadInvoices();
    loadClients();
    loadReceiverData();
    setSelectedIds(new Set());
  }, [currentPage, filterStatus, filterCurrency]);

  // Fecha os dropdowns de autocomplete de cliente ao clicar fora - sem isso eles
  // ficavam abertos sobre o formulário até o usuário selecionar um cliente.
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (clientInputRef.current && !clientInputRef.current.contains(event.target)) {
        setShowClientDropdown(false);
      }
      if (editClientInputRef.current && !editClientInputRef.current.contains(event.target)) {
        setShowEditClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const params = { page: currentPage, per_page: ITEMS_PER_PAGE };
      if (filterStatus) params.status = filterStatus;
      if (filterCurrency) params.currency = filterCurrency;
      
      const res = await api.getIntlInvoices(params);
      setInvoices(res.data.items || []);
      setTotalInvoices(res.data.total || 0);
    } catch (error) {
      console.error('Erro ao carregar invoices:', error);
      toast.error('Erro ao carregar invoices');
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      const res = await api.getClients();
      setClients(res.data || []);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
      toast.error('Erro ao carregar clientes');
    }
  };

  const loadReceiverData = async () => {
    try {
      const res = await api.getIntlInvoiceReceiverData();
      setReceiverData(res.data);
    } catch (error) {
      console.error('Erro ao carregar dados do recebedor:', error);
      toast.error('Erro ao carregar dados do recebedor');
    }
  };

  const handleClientSelect = (client) => {
    setFormData({
      ...formData,
      payer_client_id: client.id,
      payer_company: client.name,
      payer_cnpj: client.cnpj || '',
      payer_contact: client.phone || '',
      payer_email: client.email || '',
      payer_address: client.address || '',
    });
    setClientSearch(client.name);
    setShowClientDropdown(false);
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // Estado para busca de movimentação
  const [movementSearch, setMovementSearch] = useState('');
  const [searchingMovement, setSearchingMovement] = useState(false);

  const searchMovement = async () => {
    if (!movementSearch.trim()) {
      toast.error('Informe o número da movimentação');
      return;
    }

    try {
      setSearchingMovement(true);
      const res = await api.getMovementForInvoice(movementSearch.trim());
      const movement = res.data;
      
      // Criar descrição do item baseado na movimentação
      const description = `Handling gate in / out - Container ${movement.container_number || 'N/A'} - Mov. #${movement.transaction_id}`;
      
      // Adicionar como novo item
      setInvoiceItems([...invoiceItems, {
        description: description,
        quantity: 1,
        unit_price: parseFloat(movement.service_value) || 0,
        total: parseFloat(movement.service_value) || 0,
        movement_id: movement.transaction_id
      }]);
      
      setMovementSearch('');
      toast.success(`Movimentação #${movement.transaction_id} adicionada`);
    } catch (error) {
      console.error('Erro ao buscar movimentação:', error);
      toast.error(error.response?.data?.detail || 'Movimentação não encontrada');
    } finally {
      setSearchingMovement(false);
    }
  };

  const addInvoiceItem = () => {
    setInvoiceItems([...invoiceItems, { description: '', quantity: 1, unit_price: 0, total: 0 }]);
  };

  const removeInvoiceItem = (index) => {
    if (invoiceItems.length > 1) {
      setInvoiceItems(invoiceItems.filter((_, i) => i !== index));
    }
  };

  const updateInvoiceItem = (index, field, value) => {
    const newItems = [...invoiceItems];
    newItems[index][field] = value;
    
    // Recalcular total do item
    if (field === 'quantity' || field === 'unit_price') {
      const qty = parseFloat(newItems[index].quantity) || 0;
      const price = parseFloat(newItems[index].unit_price) || 0;
      newItems[index].total = qty * price;
    }
    
    setInvoiceItems(newItems);
  };

  const calculateSubtotal = () => {
    return invoiceItems.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
  };

  const openNewInvoiceModal = () => {
    setShowNewInvoice(true);
    setFormData({
      payer_client_id: '',
      payer_company: '',
      payer_cnpj: '',
      payer_contact: '',
      payer_email: '',
      payer_address: '',
      issue_date: format(new Date(), 'yyyy-MM-dd'),
      due_date: '',
      currency: 'USD',
      notes: '',
    });
    setInvoiceItems([{ description: '', quantity: 1, unit_price: 0, total: 0 }]);
    setClientSearch('');
  };

  const handleCreateInvoice = async () => {
    // Validações
    if (!formData.payer_company.trim()) {
      toast.error('Informe o nome da empresa pagadora');
      return;
    }
    if (!formData.payer_address.trim()) {
      toast.error('Informe o endereço do pagador');
      return;
    }
    if (!formData.due_date) {
      toast.error('Informe a data de vencimento');
      return;
    }
    
    const validItems = invoiceItems.filter(item => item.description.trim() && item.total > 0);
    if (validItems.length === 0) {
      toast.error('Adicione pelo menos um item válido');
      return;
    }

    try {
      setCreating(true);
      
      const payload = {
        payer_client_id: formData.payer_client_id || null,
        payer_company: formData.payer_company,
        payer_cnpj: formData.payer_cnpj || null,
        payer_contact: formData.payer_contact || null,
        payer_email: formData.payer_email || null,
        payer_address: formData.payer_address,
        issue_date: formData.issue_date,
        due_date: formData.due_date,
        currency: formData.currency,
        notes: formData.notes || null,
        items: validItems.map(item => ({
          description: item.description,
          quantity: parseFloat(item.quantity) || 1,
          unit_price: parseFloat(item.unit_price) || 0,
          total: parseFloat(item.total) || 0
        }))
      };

      await api.createIntlInvoice(payload);
      toast.success('Invoice criada com sucesso!');
      setShowNewInvoice(false);
      loadInvoices();
    } catch (error) {
      console.error('Erro ao criar invoice:', error);
      toast.error(error.response?.data?.detail || 'Erro ao criar invoice');
    } finally {
      setCreating(false);
    }
  };

  const handleViewDetails = (invoice) => {
    setSelectedInvoice(invoice);
    setShowDetails(true);
  };

  const handleOpenEdit = (invoice) => {
    setEditingInvoice(invoice);
    setEditFormData({
      payer_client_id: invoice.payer_client_id || '',
      payer_company: invoice.payer_company || '',
      payer_cnpj: invoice.payer_cnpj || '',
      payer_contact: invoice.payer_contact || '',
      payer_email: invoice.payer_email || '',
      payer_address: invoice.payer_address || '',
      issue_date: invoice.issue_date || '',
      due_date: invoice.due_date || '',
      currency: invoice.currency || 'USD',
      notes: invoice.notes || '',
    });
    setEditInvoiceItems(invoice.items?.map(item => ({
      description: item.description || '',
      quantity: item.quantity || 1,
      unit_price: item.unit_price || 0,
      total: item.total || 0
    })) || [{ description: '', quantity: 1, unit_price: 0, total: 0 }]);
    setEditClientSearch(invoice.payer_company || '');
    setShowEditModal(true);
  };

  const handleEditClientSelect = (client) => {
    setEditFormData({
      ...editFormData,
      payer_client_id: client.id,
      payer_company: client.name,
      payer_cnpj: client.cnpj || '',
      payer_contact: client.phone || '',
      payer_email: client.email || '',
      payer_address: client.address || '',
    });
    setEditClientSearch(client.name);
    setShowEditClientDropdown(false);
  };

  const addEditInvoiceItem = () => {
    setEditInvoiceItems([...editInvoiceItems, { description: '', quantity: 1, unit_price: 0, total: 0 }]);
  };

  const removeEditInvoiceItem = (index) => {
    if (editInvoiceItems.length > 1) {
      setEditInvoiceItems(editInvoiceItems.filter((_, i) => i !== index));
    }
  };

  const updateEditInvoiceItem = (index, field, value) => {
    const newItems = [...editInvoiceItems];
    newItems[index][field] = value;
    
    if (field === 'quantity' || field === 'unit_price') {
      const qty = parseFloat(newItems[index].quantity) || 0;
      const price = parseFloat(newItems[index].unit_price) || 0;
      newItems[index].total = qty * price;
    }
    
    setEditInvoiceItems(newItems);
  };

  const calculateEditSubtotal = () => {
    return editInvoiceItems.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
  };

  // Estado para busca de movimentação no modal de edição
  const [editMovementSearch, setEditMovementSearch] = useState('');
  const [editSearchingMovement, setEditSearchingMovement] = useState(false);

  const searchEditMovement = async () => {
    if (!editMovementSearch.trim()) {
      toast.error('Informe o número da movimentação');
      return;
    }

    try {
      setEditSearchingMovement(true);
      const res = await api.getMovementForInvoice(editMovementSearch.trim());
      const movement = res.data;
      
      const description = `Handling gate in / out - Container ${movement.container_number || 'N/A'} - Mov. #${movement.transaction_id}`;
      
      setEditInvoiceItems([...editInvoiceItems, {
        description: description,
        quantity: 1,
        unit_price: parseFloat(movement.service_value) || 0,
        total: parseFloat(movement.service_value) || 0,
        movement_id: movement.transaction_id
      }]);
      
      setEditMovementSearch('');
      toast.success(`Movimentação #${movement.transaction_id} adicionada`);
    } catch (error) {
      console.error('Erro ao buscar movimentação:', error);
      toast.error(error.response?.data?.detail || 'Movimentação não encontrada');
    } finally {
      setEditSearchingMovement(false);
    }
  };

  const handleUpdateInvoice = async () => {
    if (!editFormData.payer_company.trim()) {
      toast.error('Informe o nome da empresa pagadora');
      return;
    }
    if (!editFormData.payer_address.trim()) {
      toast.error('Informe o endereço do pagador');
      return;
    }
    if (!editFormData.due_date) {
      toast.error('Informe a data de vencimento');
      return;
    }
    
    const validItems = editInvoiceItems.filter(item => item.description.trim() && item.total > 0);
    if (validItems.length === 0) {
      toast.error('Adicione pelo menos um item válido');
      return;
    }

    try {
      setEditing(true);
      
      const payload = {
        payer_client_id: editFormData.payer_client_id || null,
        payer_company: editFormData.payer_company,
        payer_cnpj: editFormData.payer_cnpj || null,
        payer_contact: editFormData.payer_contact || null,
        payer_email: editFormData.payer_email || null,
        payer_address: editFormData.payer_address,
        issue_date: editFormData.issue_date,
        due_date: editFormData.due_date,
        currency: editFormData.currency,
        notes: editFormData.notes || null,
        items: validItems.map(item => ({
          description: item.description,
          quantity: parseFloat(item.quantity) || 1,
          unit_price: parseFloat(item.unit_price) || 0,
          total: parseFloat(item.total) || 0
        }))
      };

      await api.updateIntlInvoice(editingInvoice.id, payload);
      toast.success('Invoice atualizada com sucesso!');
      setShowEditModal(false);
      setEditingInvoice(null);
      loadInvoices();
    } catch (error) {
      console.error('Erro ao atualizar invoice:', error);
      toast.error(error.response?.data?.detail || 'Erro ao atualizar invoice');
    } finally {
      setEditing(false);
    }
  };

  const handleUpdateStatus = async (invoiceId, newStatus) => {
    try {
      await api.updateIntlInvoiceStatus(invoiceId, newStatus);
      toast.success('Status atualizado com sucesso!');
      loadInvoices();
      if (selectedInvoice && selectedInvoice.id === invoiceId) {
        setSelectedInvoice({ ...selectedInvoice, status: newStatus });
      }
    } catch (error) {
      toast.error('Erro ao atualizar status');
    }
  };

  const handleDownloadPdf = async (invoice) => {
    try {
      setDownloadingPdf(invoice.id);
      const res = await api.downloadIntlInvoicePdf(invoice.id);
      
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `invoice_${invoice.invoice_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      toast.success('PDF baixado com sucesso!');
    } catch (error) {
      console.error('Erro ao baixar PDF:', error);
      toast.error('Erro ao baixar PDF');
    } finally {
      setDownloadingPdf(null);
    }
  };

  const handleDelete = async () => {
    if (!invoiceToDelete) return;

    try {
      setDeleting(true);
      await api.deleteIntlInvoice(invoiceToDelete.id);
      toast.success('Invoice excluída com sucesso!');
      setShowDeleteConfirm(false);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(invoiceToDelete.id);
        return next;
      });
      setInvoiceToDelete(null);
      loadInvoices();
    } catch (error) {
      toast.error('Erro ao excluir invoice');
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

  const getCurrencySymbol = (currency) => {
    const found = CURRENCIES.find(c => c.value === currency);
    return found ? found.symbol : currency;
  };

  const getStatusBadge = (status) => {
    const found = STATUS_OPTIONS.find(s => s.value === status);
    return found ? found : { label: status, tone: 'slate' };
  };

  const totalPages = Math.ceil(totalInvoices / ITEMS_PER_PAGE);

  return (
    <Layout>
      <div className="space-y-4" data-testid="international-invoice-page">
        <PageHeader icon={Globe} title="Invoices Internacionais" subtitle="Gerencie suas faturas para clientes internacionais" />

        <FilterCard
          hasFilters={!!(filterStatus || filterCurrency)}
          onClear={() => { setFilterStatus(''); setFilterCurrency(''); }}
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Status">
              <Select value={filterStatus || 'ALL'} onValueChange={(val) => setFilterStatus(val === "ALL" ? "" : val)}>
                <SelectTrigger className="h-9 text-sm" data-testid="filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  {STATUS_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Moeda">
              <Select value={filterCurrency || 'ALL'} onValueChange={(val) => setFilterCurrency(val === "ALL" ? "" : val)}>
                <SelectTrigger className="h-9 text-sm" data-testid="filter-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  {CURRENCIES.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma invoice pra habilitar as ações da barra */}
        <DataCard
          title="Invoices"
          count={totalInvoices}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova invoice" onClick={openNewInvoiceModal} testId="new-invoice-btn" />}
            >
              <ToolbarButton
                icon={Eye}
                label="Ver detalhes"
                tone="primary"
                onClick={() => singleSelectedInvoice && handleViewDetails(singleSelectedInvoice)}
                disabled={!singleSelectedInvoice}
                testId={singleSelectedInvoice ? `view-invoice-${singleSelectedInvoice.id}` : undefined}
              />
              <ToolbarButton
                icon={Pencil}
                label="Editar"
                tone="blue"
                onClick={() => singleSelectedInvoice && handleOpenEdit(singleSelectedInvoice)}
                disabled={!singleSelectedInvoice}
                testId={singleSelectedInvoice ? `edit-invoice-${singleSelectedInvoice.id}` : undefined}
              />
              <ToolbarButton
                icon={FileDown}
                label={singleSelectedInvoice && downloadingPdf === singleSelectedInvoice.id ? 'Gerando PDF...' : 'Baixar PDF'}
                tone="emerald"
                onClick={() => singleSelectedInvoice && handleDownloadPdf(singleSelectedInvoice)}
                disabled={!singleSelectedInvoice || downloadingPdf === singleSelectedInvoice?.id}
                testId={singleSelectedInvoice ? `download-pdf-${singleSelectedInvoice.id}` : undefined}
              />
              <ToolbarButton
                icon={Trash2}
                label="Excluir"
                tone="red"
                onClick={() => {
                  if (!singleSelectedInvoice) return;
                  setInvoiceToDelete(singleSelectedInvoice);
                  setShowDeleteConfirm(true);
                }}
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
              onPageChange={setCurrentPage}
            />
          )}
        >
          {loading ? (
            <EmptyState title="Carregando..." />
          ) : invoices.length === 0 ? (
            <EmptyState
              icon={Globe}
              title="Nenhuma invoice encontrada"
              hint={filterStatus || filterCurrency ? 'Ajuste os filtros' : 'Crie a primeira pelo botão "Nova invoice"'}
            />
          ) : (
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
                    <th>Nº</th>
                    <th>Pagador</th>
                    <th>Emissão</th>
                    <th>Vencimento</th>
                    <th>Moeda</th>
                    <th className="!text-right">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => {
                    const statusBadge = getStatusBadge(invoice.status);
                    return (
                      <tr
                        key={invoice.id}
                        data-selected={selectedIds.has(invoice.id)}
                        className="cursor-pointer"
                        onClick={() => toggleSelect(invoice.id)}
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(invoice.id)}
                            onCheckedChange={() => toggleSelect(invoice.id)}
                          />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{invoice.invoice_number}</td>
                        <td><div className="max-w-[260px] truncate" title={invoice.payer_company || ''}>{invoice.payer_company}</div></td>
                        <td className="whitespace-nowrap tabular-nums">
                          {invoice.issue_date ? format(parseISO(invoice.issue_date), 'dd/MM/yyyy') : '-'}
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {invoice.due_date ? format(parseISO(invoice.due_date), 'dd/MM/yyyy') : '-'}
                        </td>
                        <td><StatusPill tone="slate" dot={false}>{invoice.currency}</StatusPill></td>
                        <td className="text-right whitespace-nowrap tabular-nums cell-strong">
                          {getCurrencySymbol(invoice.currency)} {invoice.total?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                        <td><StatusPill tone={statusBadge.tone}>{statusBadge.label}</StatusPill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        {/* Modal Nova Invoice */}
        <Dialog open={showNewInvoice} onOpenChange={setShowNewInvoice}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Globe className="h-4 w-4 text-primary" />
                Nova Invoice Internacional
              </DialogTitle>
              <DialogDescription className="text-[13px]">
                Preencha os dados para criar uma nova invoice
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Dados do Recebedor (fixo) */}
              {receiverData && (
                <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
                  <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300 mb-2">Recebedor (Emissor)</h3>
                  <p className="text-sm font-medium">{receiverData.company}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{receiverData.address}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{receiverData.city_state} - CEP: {receiverData.zip}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{receiverData.email}</p>
                </div>
              )}

              {/* Dados do Pagador */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300 border-b pb-2">Dados do Pagador</h3>
                
                <div className="relative" ref={clientInputRef}>
                  <Label>Cliente (buscar)</Label>
                  <Input
                    value={clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      setShowClientDropdown(true);
                    }}
                    onFocus={() => setShowClientDropdown(true)}
                    data-testid="client-search"
                  />
                  {showClientDropdown && clientSearch && filteredClients.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {filteredClients.map(client => (
                        <div
                          key={client.id}
                          className="px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer text-sm"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleClientSelect(client);
                          }}
                        >
                          <p className="font-medium">{client.name}</p>
                          {client.address && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">{client.address}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Empresa / Nome *</Label>
                    <Input
                      value={formData.payer_company}
                      onChange={(e) => setFormData({ ...formData, payer_company: e.target.value })}
                      data-testid="payer-company"
                    />
                  </div>
                  <div>
                    <Label>CNPJ</Label>
                    <Input
                      value={formData.payer_cnpj}
                      onChange={(e) => setFormData({ ...formData, payer_cnpj: e.target.value })}
                      data-testid="payer-cnpj"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Contato</Label>
                    <Input
                      value={formData.payer_contact}
                      onChange={(e) => setFormData({ ...formData, payer_contact: e.target.value })}
                      data-testid="payer-contact"
                    />
                  </div>
                  <div>
                    <Label>E-mail</Label>
                    <Input
                      value={formData.payer_email}
                      onChange={(e) => setFormData({ ...formData, payer_email: e.target.value })}
                      data-testid="payer-email"
                    />
                  </div>
                </div>

                <div>
                  <Label>Endereço *</Label>
                  <Input
                    value={formData.payer_address}
                    onChange={(e) => setFormData({ ...formData, payer_address: e.target.value })}
                    data-testid="payer-address"
                  />
                </div>
              </div>

              {/* Detalhes da Invoice */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300 border-b pb-2">Detalhes da Invoice</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Data de Emissão *</Label>
                    <Input
                      type="date"
                      value={formData.issue_date}
                      onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
                      data-testid="issue-date"
                    />
                  </div>
                  <div>
                    <Label>Data de Vencimento *</Label>
                    <Input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                      data-testid="due-date"
                    />
                  </div>
                  <div>
                    <Label>Moeda *</Label>
                    <Select 
                      value={formData.currency} 
                      onValueChange={(val) => setFormData({ ...formData, currency: val })}
                    >
                      <SelectTrigger data-testid="currency-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map(c => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Itens */}
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                  <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300">Itens da Invoice</h3>
                  <Button variant="outline" size="sm" onClick={addInvoiceItem} data-testid="add-item-btn">
                    <Plus className="h-4 w-4 mr-1" /> Adicionar Item
                  </Button>
                </div>

                {/* Busca de Movimentação */}
                <div className="flex gap-2 items-end bg-blue-50 p-3 rounded-lg">
                  <div className="flex-1">
                    <Label className="text-xs text-blue-700">Buscar Movimentação pelo Número</Label>
                    <Input
                      value={movementSearch}
                      onChange={(e) => setMovementSearch(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && searchMovement()}
                      data-testid="movement-search"
                    />
                  </div>
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={searchMovement}
                    disabled={searchingMovement}
                    className="bg-blue-600 hover:bg-blue-700"
                    data-testid="search-movement-btn"
                  >
                    {searchingMovement ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-1" /> Buscar
                      </>
                    )}
                  </Button>
                </div>

                {invoiceItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end bg-slate-50 dark:bg-slate-800 p-3 rounded-lg">
                    <div className="col-span-5">
                      <Label className="text-xs">Descrição</Label>
                      <Input
                        value={item.description}
                        onChange={(e) => updateInvoiceItem(index, 'description', e.target.value)}
                        data-testid={`item-description-${index}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Qtd</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity}
                        onChange={(e) => updateInvoiceItem(index, 'quantity', e.target.value)}
                        data-testid={`item-quantity-${index}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Valor Unit.</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) => updateInvoiceItem(index, 'unit_price', e.target.value)}
                        data-testid={`item-unit-price-${index}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Total</Label>
                      <Input
                        value={item.total.toFixed(2)}
                        disabled
                        className="bg-slate-100 dark:bg-slate-700"
                      />
                    </div>
                    <div className="col-span-1">
                      {invoiceItems.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeInvoiceItem(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Subtotal */}
                <div className="flex justify-end pt-2 border-t">
                  <div className="text-right">
                    <span className="text-sm text-slate-500 dark:text-slate-400">Subtotal: </span>
                    <span className="font-bold text-lg">
                      {getCurrencySymbol(formData.currency)} {calculateSubtotal().toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Observações */}
              <div>
                <Label>Observações</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  data-testid="notes-input"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNewInvoice(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreateInvoice} disabled={creating} data-testid="create-invoice-btn">
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Criar Invoice
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal Detalhes */}
        <Dialog open={showDetails} onOpenChange={setShowDetails}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Invoice #{selectedInvoice?.invoice_number}
              </DialogTitle>
            </DialogHeader>

            {selectedInvoice && (
              <div className="space-y-6 py-4">
                {/* Status */}
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-sm text-slate-500 dark:text-slate-400">Status:</span>
                    <StatusPill tone={getStatusBadge(selectedInvoice.status).tone} className="ml-2 text-xs px-3 py-1">{getStatusBadge(selectedInvoice.status).label}</StatusPill>
                  </div>
                  <Select 
                    value={selectedInvoice.status} 
                    onValueChange={(val) => handleUpdateStatus(selectedInvoice.id, val)}
                  >
                    <SelectTrigger className="w-40" data-testid="status-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Dados */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded">
                    <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">Recebedor</h4>
                    <p className="font-medium">{selectedInvoice.receiver_company}</p>
                    <p className="text-slate-500 dark:text-slate-400">{selectedInvoice.receiver_address}</p>
                    <p className="text-slate-500 dark:text-slate-400">{selectedInvoice.receiver_city_state}</p>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded">
                    <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">Pagador</h4>
                    <p className="font-medium">{selectedInvoice.payer_company}</p>
                    <p className="text-slate-500 dark:text-slate-400">{selectedInvoice.payer_address}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Emissão:</span>
                    <p className="font-medium">
                      {selectedInvoice.issue_date ? format(parseISO(selectedInvoice.issue_date), 'dd/MM/yyyy') : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Vencimento:</span>
                    <p className="font-medium">
                      {selectedInvoice.due_date ? format(parseISO(selectedInvoice.due_date), 'dd/MM/yyyy') : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Moeda:</span>
                    <p className="font-medium">{selectedInvoice.currency}</p>
                  </div>
                </div>

                {/* Itens */}
                <div>
                  <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">Itens</h4>
                  <div className="border rounded overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-100 dark:bg-slate-700">
                        <tr>
                          <th className="text-left p-2">Descrição</th>
                          <th className="text-right p-2">Qtd</th>
                          <th className="text-right p-2">Valor Unit.</th>
                          <th className="text-right p-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedInvoice.items?.map((item, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="p-2">{item.description}</td>
                            <td className="p-2 text-right">{item.quantity}</td>
                            <td className="p-2 text-right">
                              {getCurrencySymbol(selectedInvoice.currency)} {item.unit_price?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-2 text-right font-medium">
                              {getCurrencySymbol(selectedInvoice.currency)} {item.total?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 dark:bg-slate-800">
                        <tr className="border-t">
                          <td colSpan={3} className="p-2 text-right font-semibold">TOTAL:</td>
                          <td className="p-2 text-right font-bold text-lg">
                            {getCurrencySymbol(selectedInvoice.currency)} {selectedInvoice.total?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {selectedInvoice.notes && (
                  <div>
                    <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">Observações</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-3 rounded">{selectedInvoice.notes}</p>
                  </div>
                )}

                <div className="text-xs text-slate-400 dark:text-slate-500 pt-4 border-t">
                  Criada por {selectedInvoice.created_by_name} em{' '}
                  {selectedInvoice.created_at ? format(parseISO(selectedInvoice.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : '-'}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDetails(false)}>
                Fechar
              </Button>
              <Button onClick={() => handleDownloadPdf(selectedInvoice)} disabled={downloadingPdf === selectedInvoice?.id}>
                {downloadingPdf === selectedInvoice?.id ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Baixar PDF
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal Confirmação de Exclusão */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-red-600">Confirmar Exclusão</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja excluir a Invoice #{invoiceToDelete?.invoice_number}?
                Esta ação não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal Editar Invoice */}
        <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-primary" />
                Editar Invoice #{editingInvoice?.invoice_number}
              </DialogTitle>
              <DialogDescription>
                Altere os dados da invoice internacional
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Dados do Recebedor (fixo) */}
              {receiverData && (
                <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
                  <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300 mb-2">Recebedor (Emissor)</h3>
                  <p className="text-sm font-medium">{receiverData.company}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{receiverData.address}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{receiverData.city_state} - CEP: {receiverData.zip}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{receiverData.email}</p>
                </div>
              )}

              {/* Dados do Pagador */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300 border-b pb-2">Dados do Pagador</h3>
                
                <div className="relative" ref={editClientInputRef}>
                  <Label>Cliente (buscar)</Label>
                  <Input
                    value={editClientSearch}
                    onChange={(e) => {
                      setEditClientSearch(e.target.value);
                      setShowEditClientDropdown(true);
                    }}
                    onFocus={() => setShowEditClientDropdown(true)}
                    data-testid="edit-client-search"
                  />
                  {showEditClientDropdown && editClientSearch && clients.filter(c => 
                    c.name.toLowerCase().includes(editClientSearch.toLowerCase())
                  ).length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {clients.filter(c => 
                        c.name.toLowerCase().includes(editClientSearch.toLowerCase())
                      ).map(client => (
                        <div
                          key={client.id}
                          className="px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer text-sm"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleEditClientSelect(client);
                          }}
                        >
                          <p className="font-medium">{client.name}</p>
                          {client.address && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">{client.address}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Empresa / Nome *</Label>
                    <Input
                      value={editFormData.payer_company}
                      onChange={(e) => setEditFormData({ ...editFormData, payer_company: e.target.value })}
                      data-testid="edit-payer-company"
                    />
                  </div>
                  <div>
                    <Label>CNPJ</Label>
                    <Input
                      value={editFormData.payer_cnpj}
                      onChange={(e) => setEditFormData({ ...editFormData, payer_cnpj: e.target.value })}
                      data-testid="edit-payer-cnpj"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Contato</Label>
                    <Input
                      value={editFormData.payer_contact}
                      onChange={(e) => setEditFormData({ ...editFormData, payer_contact: e.target.value })}
                      data-testid="edit-payer-contact"
                    />
                  </div>
                  <div>
                    <Label>E-mail</Label>
                    <Input
                      value={editFormData.payer_email}
                      onChange={(e) => setEditFormData({ ...editFormData, payer_email: e.target.value })}
                      data-testid="edit-payer-email"
                    />
                  </div>
                </div>

                <div>
                  <Label>Endereço *</Label>
                  <Input
                    value={editFormData.payer_address}
                    onChange={(e) => setEditFormData({ ...editFormData, payer_address: e.target.value })}
                    data-testid="edit-payer-address"
                  />
                </div>
              </div>

              {/* Detalhes da Invoice */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300 border-b pb-2">Detalhes da Invoice</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Data de Emissão *</Label>
                    <Input
                      type="date"
                      value={editFormData.issue_date}
                      onChange={(e) => setEditFormData({ ...editFormData, issue_date: e.target.value })}
                      data-testid="edit-issue-date"
                    />
                  </div>
                  <div>
                    <Label>Data de Vencimento *</Label>
                    <Input
                      type="date"
                      value={editFormData.due_date}
                      onChange={(e) => setEditFormData({ ...editFormData, due_date: e.target.value })}
                      data-testid="edit-due-date"
                    />
                  </div>
                  <div>
                    <Label>Moeda *</Label>
                    <Select 
                      value={editFormData.currency} 
                      onValueChange={(val) => setEditFormData({ ...editFormData, currency: val })}
                    >
                      <SelectTrigger data-testid="edit-currency-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map(c => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Itens */}
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                  <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300">Itens da Invoice</h3>
                  <Button variant="outline" size="sm" onClick={addEditInvoiceItem} data-testid="edit-add-item-btn">
                    <Plus className="h-4 w-4 mr-1" /> Adicionar Item
                  </Button>
                </div>

                {/* Busca de Movimentação */}
                <div className="flex gap-2 items-end bg-blue-50 p-3 rounded-lg">
                  <div className="flex-1">
                    <Label className="text-xs text-blue-700">Buscar Movimentação pelo Número</Label>
                    <Input
                      value={editMovementSearch}
                      onChange={(e) => setEditMovementSearch(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && searchEditMovement()}
                      data-testid="edit-movement-search"
                    />
                  </div>
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={searchEditMovement}
                    disabled={editSearchingMovement}
                    className="bg-blue-600 hover:bg-blue-700"
                    data-testid="edit-search-movement-btn"
                  >
                    {editSearchingMovement ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-1" /> Buscar
                      </>
                    )}
                  </Button>
                </div>

                {editInvoiceItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end bg-slate-50 dark:bg-slate-800 p-3 rounded-lg">
                    <div className="col-span-5">
                      <Label className="text-xs">Descrição</Label>
                      <Input
                        value={item.description}
                        onChange={(e) => updateEditInvoiceItem(index, 'description', e.target.value)}
                        data-testid={`edit-item-description-${index}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Qtd</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity}
                        onChange={(e) => updateEditInvoiceItem(index, 'quantity', e.target.value)}
                        data-testid={`edit-item-quantity-${index}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Valor Unit.</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) => updateEditInvoiceItem(index, 'unit_price', e.target.value)}
                        data-testid={`edit-item-unit-price-${index}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Total</Label>
                      <Input
                        value={item.total.toFixed(2)}
                        disabled
                        className="bg-slate-100 dark:bg-slate-700"
                      />
                    </div>
                    <div className="col-span-1">
                      {editInvoiceItems.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeEditInvoiceItem(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Subtotal */}
                <div className="flex justify-end pt-2 border-t">
                  <div className="text-right">
                    <span className="text-sm text-slate-500 dark:text-slate-400">Subtotal: </span>
                    <span className="font-bold text-lg">
                      {getCurrencySymbol(editFormData.currency)} {calculateEditSubtotal().toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Observações */}
              <div>
                <Label>Observações</Label>
                <Textarea
                  value={editFormData.notes}
                  onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                  rows={3}
                  data-testid="edit-notes-input"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditModal(false)}>
                Cancelar
              </Button>
              <Button onClick={handleUpdateInvoice} disabled={editing} data-testid="save-edit-btn">
                {editing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Salvar Alterações
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
