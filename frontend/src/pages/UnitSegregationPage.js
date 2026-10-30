import { useEffect, useState, useRef } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, PeriodFilterFields, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Checkbox } from '../components/ui/checkbox';
import { Package, Plus, Eye, Trash2, Printer, Pencil, Unlock, X, Tag, CheckCircle2, Clock, Camera, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatContainerNumber } from '../lib/containerNumber';
import { compressImage } from '../lib/imageCompression';
import PhotoLightbox from '../components/checklist/PhotoLightbox';

// Mesmo limite do backend (MAX_PHOTOS_PER_CONTAINER em routers/unit_segregation.py)
const MAX_PHOTOS_PER_CONTAINER = 6;

const emptyItem = () => ({ container_number: '', tare: '', shipping_line: '', photos: [], staged: [] });

const photoSrc = (photo) => photo.preview || api.getFileUrl(photo.url);

// Miniaturas do container + botão da câmera. `photos`: as já salvas e as que
// ainda serão enviadas ({ preview }); capture="environment" abre a câmera
// traseira no celular.
function ContainerPhotos({ photos, busy, canEdit, onAdd, onRemove, onOpen, testId }) {
  const inputRef = useRef(null);
  const full = photos.length >= MAX_PHOTOS_PER_CONTAINER;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {photos.map((photo, index) => (
        <div key={photo.id} className="relative">
          <button type="button" title="Ampliar foto" aria-label="Ampliar foto" onClick={() => onOpen(index)} className="block">
            <img src={photoSrc(photo)} alt="Foto do container" className="w-12 h-12 object-cover rounded border border-slate-200 dark:border-slate-700" />
          </button>
          {canEdit && (
            <button
              type="button"
              title="Remover foto"
              aria-label="Remover foto"
              onClick={() => onRemove(photo)}
              disabled={busy}
              className="absolute -top-1.5 -right-1.5 rounded-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 p-0.5 text-slate-500 hover:text-red-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      {canEdit && !full && (
        <>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={busy} onClick={() => inputRef.current?.click()} data-testid={testId}>
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Camera className="w-3.5 h-3.5 mr-1" />}
            Bater foto
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onAdd(file);
            }}
          />
        </>
      )}
      {!canEdit && photos.length === 0 && <span className="text-xs text-slate-400 dark:text-slate-500">-</span>}
    </div>
  );
}

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
    items: [emptyItem()],
    observations: ''
  });

  // Foto ampliada (de qualquer uma das janelas) e container enviando foto
  const [lightbox, setLightbox] = useState({ photos: [], index: null });
  const [photoBusy, setPhotoBusy] = useState(null);

  // Autocomplete de cliente
  const [clientSearch, setClientSearch] = useState('');
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [selectedClientName, setSelectedClientName] = useState('');
  const clientAutocompleteRef = useRef(null);

  // Modal de detalhes
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  // Filtra enquanto se digita (sem botão "Filtrar"); o filtro vale também ao
  // trocar de página e ao recarregar depois de salvar.
  const debouncedContainer = useDebouncedValue(searchQuery.trim());

  useEffect(() => {
    loadAuxData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [period, setPeriod] = useState(['', '']);
  const changePeriod = (value) => { setPeriod(value); setPagination(prev => ({ ...prev, page: 1 })); };

  useEffect(() => {
    loadSegregations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, statusFilter, debouncedContainer, period]);

  const onFilter = (setter) => (value) => {
    setter(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

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
      if (debouncedContainer) params.container_number = debouncedContainer;
      if (period[0]) params.date_from = period[0];
      if (period[1]) params.date_to = period[1];
      
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
    
    // A linha incompleta não é salva: sem este aviso, a foto dela sumiria calada
    if (formData.items.some(item => item.staged.length > 0 && !validItems.includes(item))) {
      toast.error('Preencha o número e o armador dos containers que têm foto');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        client_id: formData.client_id,
        items: validItems.map(({ container_number, tare, shipping_line }) => ({ container_number, tare, shipping_line })),
        observations: formData.observations
      };

      let saved;
      if (editingItem) {
        saved = (await api.updateUnitSegregation(editingItem.id, payload)).data;
        toast.success('Segregação atualizada!');
      } else {
        saved = (await api.createUnitSegregation(payload)).data;
        toast.success('Segregação criada com sucesso!');
      }

      // Só aqui a segregação existe com certeza: as fotos batidas na janela vão agora.
      // Se alguma falhar a reserva já está salva, então avisa em vez de perder calado.
      const uploads = validItems.flatMap(item => item.staged.map(photo => (
        api.uploadUnitSegregationPhoto(saved.id, item.container_number, photo.file)
      )));
      const failed = (await Promise.allSettled(uploads)).filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        toast.error(`${failed} foto(s) não foram enviadas. Abra "Ver detalhes" e bata de novo.`);
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
    formData.items.forEach(item => item.staged.forEach(photo => URL.revokeObjectURL(photo.preview)));
    setFormData({
      client_id: '',
      items: [emptyItem()],
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
            shipping_line: i.shipping_line || '',
            photos: i.photos || [],
            staged: []
          }))
        : [emptyItem()],
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
      items: [...prev.items, emptyItem()]
    }));
  };

  const removeItem = async (index) => {
    if (formData.items.length <= 1) return;
    const item = formData.items[index];
    if (item.photos.length > 0 && !(await confirm(`Tirar o container ${item.container_number} da segregação? As fotos dele serão apagadas ao salvar.`))) return;
    item.staged.forEach(photo => URL.revokeObjectURL(photo.preview));
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  // Na janela de criar/editar a foto só fica guardada aqui e vai junto ao salvar
  const stagePhoto = async (index, original) => {
    const file = await compressImage(original);
    const photo = { id: `local-${Date.now()}-${Math.random()}`, file, preview: URL.createObjectURL(file) };
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, staged: [...item.staged, photo] } : item))
    }));
  };

  const removeFormPhoto = async (index, photo) => {
    if (photo.file) {
      URL.revokeObjectURL(photo.preview);
      setFormData(prev => ({
        ...prev,
        items: prev.items.map((item, i) => (i === index ? { ...item, staged: item.staged.filter(p => p.id !== photo.id) } : item))
      }));
      return;
    }
    if (!(await confirm('Remover esta foto?'))) return;
    try {
      await api.deleteUnitSegregationPhoto(editingItem.id, formData.items[index].container_number, photo.id);
      setFormData(prev => ({
        ...prev,
        items: prev.items.map((item, i) => (i === index ? { ...item, photos: item.photos.filter(p => p.id !== photo.id) } : item))
      }));
      loadSegregations();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao remover foto');
    }
  };

  // Na janela de detalhes a segregação já existe: a foto vai direto pro servidor
  const syncSelected = (updated) => {
    setSelectedItem(updated);
    setSegregations(prev => prev.map(s => (s.id === updated.id ? updated : s)));
  };

  const addDetailPhoto = async (container, original) => {
    setPhotoBusy(container.container_number);
    try {
      const file = await compressImage(original);
      const response = await api.uploadUnitSegregationPhoto(selectedItem.id, container.container_number, file);
      syncSelected(response.data);
      toast.success('Foto anexada');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao enviar foto');
    } finally {
      setPhotoBusy(null);
    }
  };

  const removeDetailPhoto = async (container, photo) => {
    if (!(await confirm(`Remover esta foto do container ${container.container_number}?`))) return;
    setPhotoBusy(container.container_number);
    try {
      const response = await api.deleteUnitSegregationPhoto(selectedItem.id, container.container_number, photo.id);
      syncSelected(response.data);
      toast.success('Foto removida');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao remover foto');
    } finally {
      setPhotoBusy(null);
    }
  };

  const openLightbox = (photos, index, containerNumber) => {
    setLightbox({ photos: photos.map(p => ({ id: p.id, src: photoSrc(p), label: containerNumber || 'Foto do container' })), index });
  };

  const updateItem = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => 
        i === index ? { ...item, [field]: field === 'container_number' ? value.toUpperCase() : value } : item
      )
    }));
  };

  // Ao sair do campo Container, puxa tara e armador da entrada em aberto.
  // Só preenche o que está em branco, pra não apagar o que já foi digitado.
  const fillFromEntry = async (index, raw) => {
    const number = formatContainerNumber(raw);
    updateItem(index, 'container_number', number);
    if (!/^[A-Z]{4}\d{6}-\d$/.test(number)) return;
    try {
      const { entry } = (await api.getOpenEntryForContainer(number)).data;
      if (!entry) {
        toast.info(`Container ${number} sem entrada em aberto: preencha a tara e o armador`);
        return;
      }
      const lineName = (entry.shipping_line || '').trim().toLowerCase();
      const line = shippingLines.find(sl => sl.id === entry.shipping_line || sl.name.trim().toLowerCase() === lineName);
      // Confere o número de novo: a linha pode ter mudado enquanto a busca respondia
      setFormData(prev => ({
        ...prev,
        items: prev.items.map((item, i) => (i === index && item.container_number === number ? {
          ...item,
          tare: item.tare || entry.tare || '',
          shipping_line: item.shipping_line || line?.id || ''
        } : item))
      }));
    } catch (error) {
      console.error('Erro ao buscar a entrada do container:', error);
    }
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

  const handlePrintLabel = async (id) => {
    try {
      const response = await api.getUnitSegregationLabel(id);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `etiqueta_segregacao_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar etiqueta');
    }
  };

  const viewDetails = (item) => {
    setSelectedItem(item);
    setDetailModalOpen(true);
  };

  const getStatusTone = (status) => {
    const tones = {
      'ATIVO': 'emerald',
      'LIBERADO': 'blue',
      'CANCELADO': 'red'
    };
    return tones[status] || 'slate';
  };

  // Retirada: computado no backend a partir de items[].retrieved (baixa
  // automática dada quando a EIR de Saída pro cliente certo é emitida).
  const getRetrievalBadge = (retrievalStatus) => {
    if (retrievalStatus === 'CONCLUIDO') {
      return { tone: 'emerald', icon: CheckCircle2, label: 'Concluído' };
    }
    return { tone: 'amber', icon: Clock, label: 'Pendente' };
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
      <div className="space-y-4" data-testid="unit-segregation-page">
        <PageHeader icon={Package} title="Segregação de Unidade" subtitle="Reserva de containers para clientes específicos" />

        <FilterCard
          hasFilters={!!(searchQuery || statusFilter || period[0] || period[1])}
          onClear={() => { setSearchQuery(''); setStatusFilter(''); setPeriod(['', '']); setPagination(prev => ({ ...prev, page: 1 })); }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Container">
              <SearchInput value={searchQuery} onChange={(e) => onFilter(setSearchQuery)(e.target.value)} data-testid="search-container" />
            </FilterField>
            <FilterField label="Status">
              <Select value={statusFilter || "all"} onValueChange={(v) => onFilter(setStatusFilter)(v === "all" ? "" : v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="ATIVO">Ativo</SelectItem>
                  <SelectItem value="LIBERADO">Liberado</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <PeriodFilterFields value={period} onChange={changePeriod} testIdPrefix="segregation" />
          </div>
        </FilterCard>

        {/* Lista - marque uma segregação pra habilitar as ações da barra */}
        <DataCard
          title="Segregações"
          count={pagination.total.toLocaleString('pt-BR')}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova segregação" onClick={() => { resetForm(); setModalOpen(true); }} testId="new-segregation-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedItem && viewDetails(singleSelectedItem)} disabled={!singleSelectedItem} testId="view-segregation-button" />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedItem && openEditModal(singleSelectedItem)} disabled={!singleSelectedItem || singleSelectedItem.status !== 'ATIVO'} testId="edit-segregation-button" />
              <ToolbarButton icon={Unlock} label="Liberar" tone="amber" onClick={() => singleSelectedItem && handleRelease(singleSelectedItem.id)} disabled={!singleSelectedItem || singleSelectedItem.status !== 'ATIVO'} testId="release-segregation-button" />
              <ToolbarDivider />
              <ToolbarButton icon={Printer} label="Imprimir PDF" tone="emerald" onClick={() => singleSelectedItem && handlePrint(singleSelectedItem.id)} disabled={!singleSelectedItem} testId="print-segregation-button" />
              <ToolbarButton icon={Tag} label="Gerar etiqueta" tone="violet" onClick={() => singleSelectedItem && handlePrintLabel(singleSelectedItem.id)} disabled={!singleSelectedItem} testId="label-segregation-button" />
              <ToolbarDivider />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)} disabled={!singleSelectedItem} testId="delete-segregation-button" />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              pageSize={20}
              onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            />
          )}
        >
          {loading ? (
            <EmptyState loading />
          ) : segregations.length === 0 ? (
            <EmptyState icon={Package} title="Nenhuma segregação encontrada" hint="Ajuste os filtros ou crie uma nova segregação" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={segregations.length > 0 && segregations.every(s => selectedIds.has(s.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Cliente reservado</th>
                    <th>Containers</th>
                    <th>Data</th>
                    <th>Status</th>
                    <th>Retirada</th>
                  </tr>
                </thead>
                <tbody>
                  {segregations.map((item) => {
                    const rb = getRetrievalBadge(item.retrieval_status);
                    const RIcon = rb.icon;
                    return (
                      <tr
                        key={item.id}
                        onClick={() => toggleSelect(item.id)}
                        data-selected={selectedIds.has(item.id)}
                        className="cursor-pointer"
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={() => toggleSelect(item.id)}
                            data-testid="segregation-row-checkbox"
                          />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{item.segregation_number}</td>
                        <td><div className="max-w-[260px] truncate" title={item.client_name || ''}>{item.client_name}</div></td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {(item.items || []).slice(0, 3).map((container, i) => (
                              <span key={i} className="inline-flex px-1.5 py-px rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px] font-mono text-slate-700 dark:text-slate-300">
                                {container.container_number}
                              </span>
                            ))}
                            {(item.items || []).length > 3 && (
                              <StatusPill tone="primary" dot={false}>+{(item.items || []).length - 3}</StatusPill>
                            )}
                            {(!item.items || item.items.length === 0) && (
                              <span className="text-xs text-slate-400 dark:text-slate-500">-</span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {item.created_at ? format(new Date(item.created_at), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                        </td>
                        <td><StatusPill tone={getStatusTone(item.status)}>{item.status}</StatusPill></td>
                        <td>
                          <StatusPill tone={rb.tone} dot={false}><RIcon className="w-3 h-3" />{rb.label}</StatusPill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      {/* Modal Criar/Editar */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) resetForm(); setModalOpen(open); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Package className="w-5 h-5 text-primary" />
              {editingItem ? 'Editar Segregação' : 'Nova Segregação de Unidade'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Cliente - Autocomplete */}
            <div className="relative" ref={clientAutocompleteRef}>
              <Label className="mb-1.5 block">
                Cliente Reservado <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Input
                  value={clientSearch}
                  onChange={(e) => handleClientSearch(e.target.value)}
                  onFocus={() => {
                    if (clientSearch.length >= 2) {
                      setShowClientSuggestions(true);
                    }
                  }}
                  className={`h-11 pr-8 ${formData.client_id ? 'border-emerald-500 bg-emerald-50' : ''}`}
                  data-testid="client-search-input"
                />
                {formData.client_id && (
                  <button title="Limpar" aria-label="Limpar"
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
                <p className="text-[10px] text-emerald-600 mt-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                  Cliente selecionado: {selectedClientName}
                </p>
              )}
            </div>

            {/* Lista de Containers */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>
                  Unidades a Segregar <span className="text-destructive">*</span>
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-8 text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Adicionar container
                </Button>
              </div>

              <div className="space-y-2">
                {formData.items.map((item, index) => (
                  <div key={index} className="flex gap-2 items-start p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex-1 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="mb-1.5 block">Container *</Label>
                        <Input
                          value={item.container_number}
                          onChange={(e) => updateItem(index, 'container_number', e.target.value)}
                          onBlur={(e) => fillFromEntry(index, e.target.value)}
                          className="font-mono"
                          disabled={item.photos.length > 0}
                          title={item.photos.length > 0 ? 'Este container já tem foto salva: remova as fotos para trocar o número' : undefined}
                          data-testid={`container-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Tara</Label>
                        <Input
                          value={item.tare}
                          onChange={(e) => updateItem(index, 'tare', e.target.value)}
                          data-testid={`tare-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Armador *</Label>
                        <Select value={item.shipping_line} onValueChange={(v) => updateItem(index, 'shipping_line', v)}>
                          <SelectTrigger data-testid={`shipping-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {shippingLines.map(sl => (
                              <SelectItem key={sl.id} value={sl.id}>{sl.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <ContainerPhotos
                      photos={[...item.photos, ...item.staged]}
                      canEdit
                      onAdd={(file) => stagePhoto(index, file)}
                      onRemove={(photo) => removeFormPhoto(index, photo)}
                      onOpen={(i) => openLightbox([...item.photos, ...item.staged], i, item.container_number)}
                      testId={`photo-button-${index}`}
                    />
                    </div>
                    {formData.items.length > 1 && (
                      <Button title="Excluir" aria-label="Excluir"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        className="h-10 w-10 p-0 text-destructive hover:text-red-700 hover:bg-red-50 mt-5"
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
              <Label className="mb-1.5 block">Observações</Label>
              <textarea
                className="w-full h-20 p-3 border border-input rounded-md text-sm bg-transparent resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                value={formData.observations}
                onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))}
                data-testid="observations-input"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setModalOpen(false); }}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvando...' : editingItem ? 'Atualizar' : 'Criar segregação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Segregação #{selectedItem?.segregation_number}
            </DialogTitle>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-4 py-4 min-w-0">
              <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Cliente Reservado</span>
                  <span className="text-sm font-semibold text-primary">{selectedItem.client_name}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Status</span>
                  <StatusPill tone={getStatusTone(selectedItem.status)}>
                    {selectedItem.status}
                  </StatusPill>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Retirada</span>
                  {(() => {
                    const rb = getRetrievalBadge(selectedItem.retrieval_status);
                    const RIcon = rb.icon;
                    return (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${rb.className}`}>
                        <RIcon className="w-3 h-3" />
                        {rb.label}
                      </span>
                    );
                  })()}
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
                  <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Container</th>
                        <th>Tara</th>
                        <th>Armador</th>
                        <th>Retirada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItem.items.map((container, idx) => (
                        <tr key={idx} className="border-b last:border-b-0">
                          <td className="font-semibold">{idx + 1}</td>
                          <td className="font-mono">{container.container_number}</td>
                          <td>{container.tare || '-'}</td>
                          <td>{container.shipping_line_name || container.shipping_line}</td>
                          <td>
                            {container.retrieved ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" title={container.retrieved_at ? format(new Date(container.retrieved_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : ''}>
                                <CheckCircle2 className="w-3 h-3" />
                                Retirado{container.retrieved_transaction_id ? ` (#${container.retrieved_transaction_id})` : ''}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                                <Clock className="w-3 h-3" />
                                Pendente
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {/* Fora da tabela: no celular, onde a foto é batida, o botão ficava cortado */}
              {selectedItem.items && selectedItem.items.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-slate-100 dark:bg-slate-700 px-4 py-2 border-b">
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">Fotos</span>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {selectedItem.items.map((container, idx) => (
                      <div key={idx} className="px-4 py-3 space-y-2">
                        <span className="block font-mono text-xs text-slate-600 dark:text-slate-400">{container.container_number}</span>
                        <ContainerPhotos
                          photos={container.photos || []}
                          busy={photoBusy === container.container_number}
                          canEdit={selectedItem.status === 'ATIVO'}
                          onAdd={(file) => addDetailPhoto(container, file)}
                          onRemove={(photo) => removeDetailPhoto(container, photo)}
                          onOpen={(i) => openLightbox(container.photos, i, container.container_number)}
                          testId={`detail-photo-button-${idx}`}
                        />
                      </div>
                    ))}
                  </div>
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
            <Button variant="outline" onClick={() => { handlePrintLabel(selectedItem.id); }}>
              <Tag className="w-4 h-4 mr-2" />
              Gerar etiqueta
            </Button>
            <Button onClick={() => { handlePrint(selectedItem.id); }}>
              <Printer className="w-4 h-4 mr-2" />
              Imprimir PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PhotoLightbox
        photos={lightbox.photos}
        index={lightbox.index}
        onIndexChange={(index) => setLightbox(prev => ({ ...prev, index }))}
      />
      <ConfirmDialog />
    </Layout>
  );
}
