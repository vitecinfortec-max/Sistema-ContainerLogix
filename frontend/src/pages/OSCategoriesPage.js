import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, StatusPill, EmptyState,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Tag, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function OSCategoriesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({ name: '', active: true });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const response = await api.getOSCategories();
      setCategories(response.data);
    } catch (error) {
      toast.error('Erro ao carregar categorias');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', active: true });
    setEditMode(false);
    setEditId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setOpen(true);
  };

  const openEditDialog = (category) => {
    setFormData({ name: category.name, active: category.active });
    setEditMode(true);
    setEditId(category.id);
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      if (editMode && editId) {
        await api.updateOSCategory(editId, formData);
        toast.success('Categoria atualizada com sucesso');
      } else {
        await api.createOSCategory(formData);
        toast.success('Categoria cadastrada com sucesso');
      }
      resetForm();
      setOpen(false);
      loadCategories();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar categoria');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm('Tem certeza que deseja deletar esta categoria?')) {
      try {
        await api.deleteOSCategory(id);
        toast.success('Categoria deletada com sucesso');
        setSelectedIds(prev => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        loadCategories();
      } catch (error) {
        toast.error('Erro ao deletar categoria');
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
    const pageIds = filteredCategories.map(c => c.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const filteredCategories = categories.filter((c) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return c.name?.toLowerCase().includes(term);
  });

  const singleSelectedCategory = selectedIds.size === 1 ? filteredCategories.find(c => c.id === [...selectedIds][0]) : null;

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="os-categories-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4" data-testid="os-categories-page">
        <PageHeader icon={Tag} title="Cadastro de Categoria" subtitle='Categorias usadas no campo "Categoria" da Ordem de Serviço' />

        <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetForm(); }}>
            <DialogContent data-testid="os-category-dialog">
              <DialogHeader>
                <DialogTitle className="text-base">{editMode ? 'Editar Categoria' : 'Cadastrar Categoria'}</DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editMode ? 'Atualize os dados da categoria' : 'Adicione uma nova categoria de Ordem de Serviço'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[13px]">Nome *</Label>
                  <Input
                    id="name"
                    data-testid="os-category-name-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Status</Label>
                  <Select value={formData.active ? 'true' : 'false'} onValueChange={(v) => setFormData({ ...formData, active: v === 'true' })}>
                    <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Ativo</SelectItem>
                      <SelectItem value="false">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="submit"
                  className="w-full h-10 text-[13px] font-semibold"
                  data-testid="submit-os-category-button"
                  disabled={submitting}
                >
                  {submitting ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Nome">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-os-category-input" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma categoria pra habilitar as ações da barra */}
        <DataCard
          title="Categorias"
          count={filteredCategories.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova categoria" onClick={openCreateDialog} testId="add-os-category-button" />}
            >
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => singleSelectedCategory && openEditDialog(singleSelectedCategory)} disabled={!singleSelectedCategory} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedCategory && handleDelete(singleSelectedCategory.id)} disabled={!singleSelectedCategory} />
            </Toolbar>
          )}
        >
          {filteredCategories.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredCategories.length > 0 && filteredCategories.every(c => selectedIds.has(c.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nome</th>
                    <th>Status</th>
                    <th>Cadastrado em</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCategories.map((category) => (
                    <tr
                      key={category.id}
                      onClick={() => toggleSelect(category.id)}
                      data-selected={selectedIds.has(category.id)}
                      className="cursor-pointer"
                      data-testid="os-category-row"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(category.id)}
                          onCheckedChange={() => toggleSelect(category.id)}
                          data-testid="os-category-row-checkbox"
                        />
                      </td>
                      <td className="cell-strong">{category.name}</td>
                      <td>
                        <StatusPill tone={category.active ? 'emerald' : 'slate'}>
                          {category.active ? 'Ativo' : 'Inativo'}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {format(new Date(category.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Tag}
              title={search ? 'Nenhuma categoria encontrada' : 'Nenhuma categoria cadastrada'}
              hint={search ? 'Ajuste a busca' : 'Cadastre a primeira pelo botão "Nova categoria"'}
              testId="no-os-categories"
            />
          )}
        </DataCard>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
