import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, PeriodFilterFields, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Checkbox } from '../components/ui/checkbox';
import { Package, Plus, Eye, Trash2, Printer, Pencil, Unlock, Tag, CheckCircle2, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { compressImage } from '../lib/imageCompression';
import PhotoLightbox from '../components/checklist/PhotoLightbox';
import { ContainerPhotos, photoSrc } from '../components/SegregationPhotos';
import { useUrlState } from '../hooks/useUrlState';
import { apiErrorMessage } from '../lib/errors';

export default function UnitSegregationPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [segregations, setSegregations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useUrlState('query', '');
  const [statusFilter, setStatusFilter] = useUrlState('status', '');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Foto ampliada e container enviando foto (janela de detalhes)
  const [lightbox, setLightbox] = useState({ photos: [], index: null });
  const [photoBusy, setPhotoBusy] = useState(null);

  // Modal de detalhes
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  // Filtra enquanto se digita (sem botão "Filtrar"); o filtro vale também ao
  // trocar de página e ao recarregar depois de salvar.
  const debouncedContainer = useDebouncedValue(searchQuery.trim());

  const [period, setPeriod] = useUrlState('period', ['', '']);
  const changePeriod = (value) => { setPeriod(value); setPagination(prev => ({ ...prev, page: 1 })); };

  useEffect(() => {
    loadSegregations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, statusFilter, debouncedContainer, period]);

  const onFilter = (setter) => (value) => {
    setter(value);
    setPagination(prev => ({ ...prev, page: 1 }));
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
      toast.error(apiErrorMessage(error, 'Erro ao carregar segregações'));
    } finally {
      setLoading(false);
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
      toast.error(apiErrorMessage(error, 'Erro ao enviar foto'));
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
      toast.error(apiErrorMessage(error, 'Erro ao remover foto'));
    } finally {
      setPhotoBusy(null);
    }
  };

  const openLightbox = (photos, index, containerNumber) => {
    setLightbox({ photos: photos.map(p => ({ id: p.id, src: photoSrc(p), label: containerNumber || 'Foto do container' })), index });
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Deseja realmente excluir esta segregação?'))) return;
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
      toast.error(apiErrorMessage(error, 'Erro ao excluir'));
    }
  };

  const handleRelease = async (id) => {
    if (!(await confirm('Deseja realmente liberar esta segregação?'))) return;
    try {
      await api.releaseUnitSegregation(id);
      toast.success('Segregação liberada com sucesso!');
      loadSegregations();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao liberar'));
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
      toast.error(apiErrorMessage(error, 'Erro ao gerar PDF'));
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
      toast.error(apiErrorMessage(error, 'Erro ao gerar etiqueta'));
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
              primary={<ToolbarPrimary icon={Plus} label="Nova segregação" onClick={() => navigate('/unit-segregation/new')} testId="new-segregation-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedItem && viewDetails(singleSelectedItem)} disabled={!singleSelectedItem} testId="view-segregation-button" />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedItem && navigate(`/unit-segregation/${singleSelectedItem.id}/edit`)} disabled={!singleSelectedItem || singleSelectedItem.status !== 'ATIVO'} testId="edit-segregation-button" />
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
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">Cliente Reservado</span>
                  <span className="text-sm font-semibold text-primary">{selectedItem.client_name}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">Status</span>
                  <StatusPill tone={getStatusTone(selectedItem.status)}>
                    {selectedItem.status}
                  </StatusPill>
                </div>
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">Retirada</span>
                  {(() => {
                    const rb = getRetrievalBadge(selectedItem.retrieval_status);
                    const RIcon = rb.icon;
                    return (
                      <StatusPill tone={rb.tone} dot={false}>
                        <RIcon className="w-3 h-3" />
                        {rb.label}
                      </StatusPill>
                    );
                  })()}
                </div>
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">Criado em</span>
                  <span className="text-sm">{selectedItem.created_at ? format(new Date(selectedItem.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">Total de Containers</span>
                  <span className="text-sm font-semibold">{(selectedItem.items || []).length}</span>
                </div>
              </div>

              {/* Tabela de containers */}
              {selectedItem.items && selectedItem.items.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-slate-100 dark:bg-slate-700 px-4 py-2 border-b">
                    <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Containers Segregados</span>
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
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" title={container.retrieved_at ? format(new Date(container.retrieved_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : ''}>
                                <CheckCircle2 className="w-3 h-3" />
                                Retirado{container.retrieved_transaction_id ? ` (#${container.retrieved_transaction_id})` : ''}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
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
                    <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Fotos</span>
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
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1">Observações</span>
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
