import { useEffect, useState, useRef } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Checkbox } from '../components/ui/checkbox';
import { Package, Plus, Eye, Trash2, Search, Printer, Pencil, Unlock, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function UnitSegregationPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [segregations, setSegregations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Modal de novo/editar
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [saving, setSaving] = useState(false);

  // Dados auxiliares
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);

  // Formulário - agora com items (múltiplos containers)
  const [formData, setFormData] = useState({
    client_id: '',
    items: [{ container_number: '', tare: '', shipping_line: '' }],
    observations: ''
  });

  // Autocomplete de cliente
  const [clientSearch, setClientSearch] = useState('');
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [selectedClientName, setSelectedClientName] = useState('');
  const clientAutocompleteRef = useRef(null);

  // Modal de detalhes
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    loadSegregations();
    loadAuxData();
  }, [pagination.page, statusFilter]);

  // Fecha o dropdown de autocomplete de cliente ao clicar fora - antes ficava
  // aberto sobre a lista de containers do formulário até selecionar um cliente.
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (clientAutocompleteRef.current && !clientAutocompleteRef.current.contains(event.target)) {
        setShowClientSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadAuxData = async () => {
    try {
      const [clientsRes, shippingRes] = await Promise.all([
        api.getClients(),
        api.getShippingLines()
      ]);
      setClients(clientsRes.data || []);
      setShippingLines(shippingRes.data || []);
    } catch (error) {
      console.error('Erro ao carregar dados auxiliares:', error);
      toast.error('Erro ao carregar dados auxiliares');
    }
  };

  // Filtrar clientes pelo termo de busca
  const handleClientSearch = (searchTerm) => {
    setClientSearch(searchTerm);
    if (searchTerm.length >= 2) {
      const filtered = clients.filter(c => 
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setClientSuggestions(filtered.slice(0, 10));
      setShowClientSuggestions(true);
    } else {
      setClientSuggestions([]);
      setShowClientSuggestions(false);
    }
  };

  // Selecionar um cliente do autocomplete
  const selectClient = (client) => {
    setFormData(prev => ({ ...prev, client_id: client.id }));
    setSelectedClientName(client.name);
    setClientSearch(client.name);
    setShowClientSuggestions(false);
  };

  // Limpar seleção do cliente
  const clearClient = () => {
    setFormData(prev => ({ ...prev, client_id: '' }));
    setSelectedClientName('');
    setClientSearch('');
    setShowClientSuggestions(false);
  };

  const loadSegregations = async () => {
    try {
      const params = { page: pagination.page, per_page: 20 };
      if (statusFilter) params.status = statusFilter;
      if (searchQuery) params.container_number = searchQuery;
      
      const response = await api.getUnitSegregations(params);
      setSegregations(response.data.items);
      setPagination(prev => ({ ...prev, pages: response.data.pages, total: response.data.total }));
    } catch (error) {
      toast.error('Erro ao carregar segregações');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.client_id) {
      toast.error('Selecione o cliente reservado');
      return;
    }
    
    // Validar que pelo menos um container foi preenchido
    const validItems = formData.items.filter(item => item.container_number && item.shipping_line);
    if (validItems.length === 0) {
      toast.error('Adicione pelo menos um container com número e armador');
      return;
    }
    
    setSaving(true);
    try {
      const payload = {
        client_id: formData.client_id,
        items: validItems,
        observations: formData.observations
      };
      
      if (editingItem) {
        await api.updateUnitSegregation(editingItem.id, payload);
        toast.success('Segregação atualizada!');
      } else {
        await api.createUnitSegregation(payload);
        toast.success('Segregação criada com sucesso!');
      }
      setModalOpen(false);
      resetForm();
      loadSegregations();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      client_id: '',
      items: [{ container_number: '', tare: '', shipping_line: '' }],
      observations: ''
    });
    setEditingItem(null);
    setClientSearch('');
    setSelectedClientName('');
    setShowClientSuggestions(false);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setFormData({
      client_id: item.client_id,
      items: item.items && item.items.length > 0 
        ? item.items.map(i => ({
            container_number: i.container_number || '',
            tare: i.tare || '',
            shipping_line: i.shipping_line || ''
          }))
        : [{ container_number: '', tare: '', shipping_line: '' }],
      observations: item.observations || ''
    });
    setClientSearch(item.client_name || '');
    setSelectedClientName(item.client_name || '');
    setModalOpen(true);
  };

  // Funções para manipular itens (containers)
  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { container_number: '', tare: '', shipping_line: '' }]
    }));
  };

  const removeItem = (index) => {
    if (formData.items.length > 1) {
      setFormData(prev => ({
        ...prev,
        items: prev.items.filter((_, i) => i !== index)
      }));
    }
  };

  const updateItem = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => 
        i === index ? { ...item, [field]: field === 'container_number' ? value.toUpperCase() : value } : item
      )
    }));
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir esta segregação?'))) return;
    try {
      await api.deleteUnitSegregation(id);
      toast.success('Segregação excluída!');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadSegregations();
    } catch (error) {
      toast.error('Erro ao excluir');
    }
  };

  const handleRelease = async (id) => {
    if (!(await confirm('Tem certeza que deseja liberar esta segregação?'))) return;
    try {
      await api.releaseUnitSegregation(id);
      toast.success('Segregação liberada com sucesso!');
      loadSegregations();
    } catch (error) {
      toast.error('Erro ao liberar');
    }
  };

  const handlePrint = async (id) => {
    try {
      const response = await api.getUnitSegregationPDF(id);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `segregacao_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    }
  };

  const viewDetails = (item) => {
    setSelectedItem(item);
    setDetailModalOpen(true);
  };

  const getStatusBadge = (status) => {
    const styles = {
      'ATIVO': 'bg-green-100 text-green-800',
      'LIBERADO': 'bg-blue-100 text-blue-800',
      'CANCELADO': 'bg-red-100 text-red-800'
    };
    return styles[status] || 'bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200';
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = segregations.map(s => s.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const singleSelectedItem = selectedIds.size === 1 ? segregations.find(s => s.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-5" data-testid="unit-segregation-page">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Segregação de Unidade</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Reserva de containers para clientes específicos</p>
        </div>

        {/* Filtros */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Container</Label>
                <Input
                  placeholder="Nº do Container"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 text-xs"
                  data-testid="search-container"
                />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Status</Label>
                <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="ATIVO">Ativo</SelectItem>
                    <SelectItem value="LIBERADO">Liberado</SelectItem>
                    <SelectItem value="CANCELADO">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" className="h-8 text-xs font-medium" onClick={() => {
                setPagination(prev => ({ ...prev, page: 1 }));
                loadSegregations();
              }}>
                <Search className="w-3.5 h-3.5 mr-1" />
                Buscar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Barra de ações - marque uma segregação na tabela abaixo pra habilitar as ações */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { resetForm(); setModalOpen(true); }}
            title="Adicionar"
            data-testid="new-segregation-btn"
            className="h-9 w-9 p-0"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && viewDetails(singleSelectedItem)}
            disabled={!singleSelectedItem}
            title="Ver Detalhes"
            data-testid="view-segregation-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Eye className="w-4 h-4 text-primary" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && openEditModal(singleSelectedItem)}
            disabled={!singleSelectedItem || singleSelectedItem.status !== 'ATIVO'}
            title="Editar"
            data-testid="edit-segregation-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Pencil className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && handleRelease(singleSelectedItem.id)}
            disabled={!singleSelectedItem || singleSelectedItem.status !== 'ATIVO'}
            title="Liberar"
            data-testid="release-segregation-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Unlock className="w-4 h-4 text-amber-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && handlePrint(singleSelectedItem.id)}
            disabled={!singleSelectedItem}
            title="Imprimir PDF"
            data-testid="print-segregation-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Printer className="w-4 h-4 text-green-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)}
            disabled={!singleSelectedItem}
            title="Excluir"
            data-testid="delete-segregation-button"
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

        {/* Lista */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-2">
                <Package className="w-4 h-4" />
                Segregações ({pagination.total})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
            ) : segregations.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Nenhuma segregação encontrada</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="w-9 px-4 py-2.5">
                        <Checkbox
                          checked={segregations.length > 0 && segregations.every(s => selectedIds.has(s.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                          data-testid="select-all-checkbox"
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente Reservado</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Containers</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {segregations.map((item, idx) => (
                      <tr
                        key={item.id}
                        onClick={() => toggleSelect(item.id)}
                        className={`cursor-pointer transition-colors ${selectedIds.has(item.id) ? 'bg-primary/10 hover:bg-primary/15' : `hover:bg-slate-50 dark:hover:bg-slate-800/80 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}`}
                      >
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={() => toggleSelect(item.id)}
                            data-testid="segregation-row-checkbox"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{item.segregation_number}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{item.client_name}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {(item.items || []).slice(0, 3).map((container, i) => (
                              <span key={i} className="inline-flex px-2 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                {container.container_number}
                              </span>
                            ))}
                            {(item.items || []).length > 3 && (
                              <span className="inline-flex px-2 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-semibold">
                                +{(item.items || []).length - 3}
                              </span>
                            )}
                            {(!item.items || item.items.length === 0) && (
                              <span className="text-xs text-slate-400 dark:text-slate-500">-</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                          {item.created_at ? format(new Date(item.created_at), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${getStatusBadge(item.status)}`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Paginação */}
            {pagination.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs text-slate-400 dark:text-slate-500">Página {pagination.page} de {pagination.pages}</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagination.page === 1} onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}>
                    Anterior
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagination.page === pagination.pages} onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}>
                    Próximo
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal Criar/Editar */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) resetForm(); setModalOpen(open); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              {editingItem ? 'Editar Segregação' : 'Nova Segregação de Unidade'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Cliente - Autocomplete */}
            <div className="relative" ref={clientAutocompleteRef}>
              <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">
                Cliente Reservado <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  placeholder="Digite para buscar cliente..."
                  value={clientSearch}
                  onChange={(e) => handleClientSearch(e.target.value)}
                  onFocus={() => {
                    if (clientSearch.length >= 2) {
                      setShowClientSuggestions(true);
                    }
                  }}
                  className={`h-9 pr-8 ${formData.client_id ? 'border-green-500 bg-green-50' : ''}`}
                  data-testid="client-search-input"
                />
                {formData.client_id && (
                  <button
                    type="button"
                    onClick={clearClient}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              
              {showClientSuggestions && clientSuggestions.length > 0 && (
                <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {clientSuggestions.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => selectClient(client)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 focus:outline-none border-b border-slate-100 dark:border-slate-800 last:border-b-0"
                    >
                      {client.name}
                    </button>
                  ))}
                </div>
              )}
              
              {formData.client_id && selectedClientName && (
                <p className="text-[10px] text-green-600 mt-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Cliente selecionado: {selectedClientName}
                </p>
              )}
            </div>

            {/* Lista de Containers */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">
                  Unidades a Segregar <span className="text-red-500">*</span>
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs">
                  <Plus className="w-3 h-3 mr-1" />
                  Adicionar Container
                </Button>
              </div>

              <div className="space-y-2">
                {formData.items.map((item, index) => (
                  <div key={index} className="flex gap-2 items-start p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-1 block uppercase">Container *</Label>
                        <Input
                          placeholder="ABCD1234567"
                          value={item.container_number}
                          onChange={(e) => updateItem(index, 'container_number', e.target.value)}
                          className="h-8 text-sm font-mono"
                          data-testid={`container-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-1 block uppercase">Tara</Label>
                        <Input
                          placeholder="3800"
                          value={item.tare}
                          onChange={(e) => updateItem(index, 'tare', e.target.value)}
                          className="h-8 text-sm"
                          data-testid={`tare-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-1 block uppercase">Armador *</Label>
                        <Select value={item.shipping_line} onValueChange={(v) => updateItem(index, 'shipping_line', v)}>
                          <SelectTrigger className="h-8 text-sm" data-testid={`shipping-${index}`}>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {shippingLines.map(sl => (
                              <SelectItem key={sl.id} value={sl.id}>{sl.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {formData.items.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 mt-5"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Observações */}
            <div>
              <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Observações</Label>
              <textarea
                className="w-full h-20 p-3 border rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                value={formData.observations}
                onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))}
                placeholder="Observações adicionais..."
                data-testid="observations-input"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setModalOpen(false); }}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvando...' : editingItem ? 'Atualizar' : 'Criar Segregação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Segregação #{selectedItem?.segregation_number}
            </DialogTitle>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Cliente Reservado</span>
                  <span className="text-sm font-semibold text-primary">{selectedItem.client_name}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Status</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${getStatusBadge(selectedItem.status)}`}>
                    {selectedItem.status}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Criado em</span>
                  <span className="text-sm">{selectedItem.created_at ? format(new Date(selectedItem.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-'}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Total de Containers</span>
                  <span className="text-sm font-semibold">{(selectedItem.items || []).length}</span>
                </div>
              </div>

              {/* Tabela de containers */}
              {selectedItem.items && selectedItem.items.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-slate-100 dark:bg-slate-700 px-4 py-2 border-b">
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">Containers Segregados</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50 dark:bg-slate-800">
                        <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">#</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Container</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Tara</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Armador</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItem.items.map((container, idx) => (
                        <tr key={idx} className="border-b last:border-b-0">
                          <td className="px-4 py-2 font-semibold">{idx + 1}</td>
                          <td className="px-4 py-2 font-mono">{container.container_number}</td>
                          <td className="px-4 py-2">{container.tare || '-'}</td>
                          <td className="px-4 py-2">{container.shipping_line_name || container.shipping_line}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedItem.status === 'LIBERADO' && selectedItem.released_at && (
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 text-blue-800 mb-2">
                    <Unlock className="w-4 h-4" />
                    <span className="font-semibold text-sm">Liberado</span>
                  </div>
                  <div className="text-sm text-blue-700">
                    <span>Em {format(new Date(selectedItem.released_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</span>
                    {selectedItem.released_by_name && <span> por {selectedItem.released_by_name}</span>}
                  </div>
                </div>
              )}

              {selectedItem.observations && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block mb-1">Observações</span>
                  <span className="text-sm">{selectedItem.observations}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
            <Button onClick={() => { handlePrint(selectedItem.id); }}>
              <Printer className="w-4 h-4 mr-2" />
              Imprimir PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
