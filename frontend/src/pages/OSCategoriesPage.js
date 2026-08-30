import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Tag, Edit, Search } from 'lucide-react';
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
        loadCategories();
      } catch (error) {
        toast.error('Erro ao deletar categoria');
      }
    }
  };

  const filteredCategories = categories.filter((c) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return c.name?.toLowerCase().includes(term);
  });

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
      <div className="space-y-5" data-testid="os-categories-page">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Cadastro de Categoria
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Categorias usadas no campo "Categoria" da Ordem de Serviço</p>
          </div>
          <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetForm(); }}>
            <DialogTrigger asChild>
              <Button
                size="default"
                className="text-[13px] font-semibold uppercase tracking-wide h-10"
                data-testid="add-os-category-button"
                onClick={openCreateDialog}
              >
                <Plus className="w-4 h-4 mr-2" />
                Nova Categoria
              </Button>
            </DialogTrigger>
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
                    placeholder="Ex: MANUTENÇÃO CORRETIVA - EXTERNA"
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
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
          <Input
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 text-[13px] pl-9"
            data-testid="search-os-category-input"
          />
        </div>

        <Card>
          <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
            <CardTitle className="text-[13px] font-medium">Categorias Cadastradas ({filteredCategories.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredCategories.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nome</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cadastrado em</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredCategories.map((category) => (
                      <tr key={category.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" data-testid="os-category-row">
                        <td className="px-4 py-2.5 text-[13px] font-medium">{category.name}</td>
                        <td className="px-4 py-2.5 text-[13px]">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${category.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {category.active ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[13px]">
                          {format(new Date(category.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEditDialog(category)} title="Editar" className="h-8 w-8 p-0">
                              <Edit className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(category.id)} title="Deletar" className="h-8 w-8 p-0">
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-500 dark:text-slate-400" data-testid="no-os-categories">
                <Tag className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">
                  {search ? 'Nenhuma categoria encontrada' : 'Nenhuma categoria cadastrada'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
