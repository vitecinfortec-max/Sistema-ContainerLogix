import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, ClipboardList, Edit, Search } from 'lucide-react';
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

  useEffect(() => {
    loadServiceTypes();
  }, []);

  const loadServiceTypes = async () => {
    try {
      const response = await api.getServiceTypes();
      setServiceTypes(response.data);
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
        loadServiceTypes();
      } catch (error) {
        toast.error('Erro ao deletar tipo de serviço');
      }
    }
  };

  const filteredServiceTypes = serviceTypes.filter((serviceType) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      serviceType.name?.toLowerCase().includes(term) ||
      serviceType.description?.toLowerCase().includes(term)
    );
  });

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
      <div className="space-y-5" data-testid="service-types-page">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Tipos de Serviço
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Gerencie os tipos de serviço para movimentações</p>
          </div>
          <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button 
                size="default" 
                className="text-[13px] font-semibold uppercase tracking-wide h-10" 
                data-testid="add-service-type-button"
                onClick={openCreateDialog}
              >
                <Plus className="w-4 h-4 mr-2" />
                Novo Tipo de Serviço
              </Button>
            </DialogTrigger>
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
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 text-[13px] pl-9"
                data-testid="search-service-type-input"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <ClipboardList className="w-4 h-4" />
              Lista de Tipos de Serviço ({filteredServiceTypes.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredServiceTypes.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nome</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Descrição</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cadastrado em</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredServiceTypes.map((serviceType) => (
                      <tr key={serviceType.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" data-testid="service-type-row">
                        <td className="px-4 py-2.5 text-[13px] font-medium">{serviceType.name}</td>
                        <td className="px-4 py-2.5 text-[13px] text-slate-500 dark:text-slate-400">{serviceType.description || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px]">
                          {format(new Date(serviceType.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(serviceType)}
                              data-testid="edit-service-type-button"
                              title="Editar"
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(serviceType.id)}
                              data-testid="delete-service-type-button"
                              title="Deletar"
                              className="h-8 w-8 p-0"
                            >
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
              <div className="p-10 text-center text-slate-500 dark:text-slate-400" data-testid="no-service-types">
                <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">
                  {search ? 'Nenhum tipo de serviço encontrado' : 'Nenhum tipo de serviço cadastrado'}
                </p>
                {!search && <p className="text-[11px] mt-1">Clique em "Novo Tipo de Serviço" para adicionar</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
