import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, ClipboardList, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function ServiceTypesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [serviceTypes, setServiceTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: 50,
    total: 0,
    totalPages: 0
  });
  const debounceRef = useRef(null);

  useEffect(() => {
    loadServiceTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page]);

  useEffect(() => {
    setPagination(prev => (prev.page === 1 ? prev : { ...prev, page: 1 }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadServiceTypes(); }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const loadServiceTypes = async () => {
    try {
      const response = await api.getServiceTypes({
        page: search.trim() ? 1 : pagination.page,
        per_page: pagination.perPage,
        search: search.trim() || undefined
      });
      setServiceTypes(response.data.items);
      setPagination(prev => ({
        ...prev,
        total: response.data.total,
        totalPages: response.data.total_pages
      }));
    } catch (error) {
      toast.error('Erro ao carregar tipos de serviço');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', description: '' });
    setEditMode(false);
    setEditId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setOpen(true);
  };

  const openEditDialog = (serviceType) => {
    setFormData({
      name: serviceType.name,
      description: serviceType.description || ''
    });
    setEditMode(true);
    setEditId(serviceType.id);
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    
    setSubmitting(true);
    try {
      if (editMode && editId) {
        await api.updateServiceType(editId, formData);
        toast.success('Tipo de serviço atualizado com sucesso');
      } else {
        await api.createServiceType(formData);
        toast.success('Tipo de serviço cadastrado com sucesso');
      }
      resetForm();
      setOpen(false);
      loadServiceTypes();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar tipo de serviço');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm('Tem certeza que deseja deletar este tipo de serviço?')) {
      try {
        await api.deleteServiceType(id);
        toast.success('Tipo de serviço deletado com sucesso');
        setSelectedIds(prev => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        loadServiceTypes();
      } catch (error) {
        toast.error('Erro ao deletar tipo de serviço');
      }
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
    const pageIds = serviceTypes.map(s => s.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const singleSelectedServiceType = selectedIds.size === 1 ? serviceTypes.find(s => s.id === [...selectedIds][0]) : null;

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="service-types-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4" data-testid="service-types-page">
        <PageHeader icon={ClipboardList} title="Tipos de Serviço" subtitle="Gerencie os tipos de serviço para movimentações" />

        <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) resetForm();
          }}>
            <DialogContent data-testid="service-type-dialog">
              <DialogHeader>
                <DialogTitle className="text-base">{editMode ? 'Editar Tipo de Serviço' : 'Cadastrar Tipo de Serviço'}</DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editMode ? 'Atualize os dados do tipo de serviço' : 'Adicione um novo tipo de serviço ao sistema'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[13px]">Nome *</Label>
                  <Input
                    id="name"
                    data-testid="service-type-name-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description" className="text-[13px]">Descrição</Label>
                  <Textarea
                    id="description"
                    data-testid="service-type-description-input"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="min-h-[70px] text-[13px]"
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full h-10 text-[13px] font-semibold" 
                  data-testid="submit-service-type-button"
                  disabled={submitting}
                >
                  {submitting ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Nome do serviço">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-service-type-input" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um tipo de serviço pra habilitar as ações da barra */}
        <DataCard
          title="Tipos de serviço"
          count={pagination.total.toLocaleString('pt-BR')}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo tipo de serviço" onClick={openCreateDialog} testId="add-service-type-button" />}
            >
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => singleSelectedServiceType && openEditDialog(singleSelectedServiceType)} disabled={!singleSelectedServiceType} testId="edit-service-type-button" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedServiceType && handleDelete(singleSelectedServiceType.id)} disabled={!singleSelectedServiceType} testId="delete-service-type-button" />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.total}
              pageSize={pagination.perPage}
              onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            />
          )}
        >
          {serviceTypes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={serviceTypes.length > 0 && serviceTypes.every(s => selectedIds.has(s.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nome</th>
                    <th>Descrição</th>
                    <th>Cadastrado em</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceTypes.map((serviceType) => (
                    <tr
                      key={serviceType.id}
                      onClick={() => toggleSelect(serviceType.id)}
                      data-selected={selectedIds.has(serviceType.id)}
                      className="cursor-pointer"
                      data-testid="service-type-row"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(serviceType.id)}
                          onCheckedChange={() => toggleSelect(serviceType.id)}
                          data-testid="service-type-row-checkbox"
                        />
                      </td>
                      <td className="cell-strong">{serviceType.name}</td>
                      <td className="text-slate-500 dark:text-slate-400"><div className="max-w-[420px] truncate" title={serviceType.description || ''}>{serviceType.description || '-'}</div></td>
                      <td className="whitespace-nowrap tabular-nums">{format(new Date(serviceType.created_at), 'dd/MM/yyyy', { locale: ptBR })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={ClipboardList}
              title={search ? 'Nenhum tipo de serviço encontrado' : 'Nenhum tipo de serviço cadastrado'}
              hint={search ? 'Ajuste a busca' : 'Cadastre o primeiro pelo botão "Novo tipo de serviço"'}
              testId="no-service-types"
            />
          )}
        </DataCard>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
