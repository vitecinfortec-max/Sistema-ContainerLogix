import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Ship, Edit, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function ShippingLinesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({ name: '', code: '' });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadShippingLines();
  }, []);

  const loadShippingLines = async () => {
    try {
      const response = await api.getShippingLines();
      setLines(response.data);
    } catch (error) {
      toast.error('Erro ao carregar armadores');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', code: '' });
    setEditMode(false);
    setEditId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setOpen(true);
  };

  const openEditDialog = (line) => {
    setFormData({
      name: line.name,
      code: line.code || ''
    });
    setEditMode(true);
    setEditId(line.id);
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    
    setSubmitting(true);
    try {
      if (editMode && editId) {
        await api.updateShippingLine(editId, formData);
        toast.success('Armador atualizado com sucesso');
      } else {
        await api.createShippingLine(formData);
        toast.success('Armador cadastrado com sucesso');
      }
      resetForm();
      setOpen(false);
      loadShippingLines();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar armador');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm('Tem certeza que deseja deletar este armador?')) {
      try {
        await api.deleteShippingLine(id);
        toast.success('Armador deletado com sucesso');
        loadShippingLines();
      } catch (error) {
        toast.error('Erro ao deletar armador');
      }
    }
  };

  const filteredLines = lines.filter((line) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      line.name?.toLowerCase().includes(term) ||
      line.code?.toLowerCase().includes(term)
    );
  });

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="shipping-lines-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="shipping-lines-page">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Armadores
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Gerencie o cadastro de armadores (shipping lines)</p>
          </div>
          <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button 
                size="default" 
                className="text-[13px] font-semibold uppercase tracking-wide h-10" 
                data-testid="add-line-button"
                onClick={openCreateDialog}
              >
                <Plus className="w-4 h-4 mr-2" />
                Novo Armador
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="line-dialog">
              <DialogHeader>
                <DialogTitle className="text-base">{editMode ? 'Editar Armador' : 'Cadastrar Armador'}</DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editMode ? 'Atualize os dados do armador' : 'Adicione um novo armador ao sistema'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[13px]">Nome do Armador *</Label>
                  <Input
                    id="name"
                    data-testid="line-name-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="code" className="text-[13px]">Código</Label>
                  <Input
                    id="code"
                    data-testid="line-code-input"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="h-10 text-[13px] font-mono"
                    maxLength={10}
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full h-10 text-[13px] font-semibold" 
                  data-testid="submit-line-button"
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 text-[13px] pl-9"
            data-testid="search-line-input"
          />
        </div>

        <Card>
          <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
            <CardTitle className="text-[13px] font-medium">Lista de Armadores ({filteredLines.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredLines.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nome</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Código</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cadastrado em</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredLines.map((line) => (
                      <tr key={line.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" data-testid="line-row">
                        <td className="px-4 py-2.5 text-[13px] font-medium">{line.name}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono">{line.code || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px]">
                          {format(new Date(line.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(line)}
                              data-testid="edit-line-button"
                              title="Editar"
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(line.id)}
                              data-testid="delete-line-button"
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
              <div className="p-10 text-center text-slate-500 dark:text-slate-400" data-testid="no-lines">
                <Ship className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">
                  {search ? 'Nenhum armador encontrado' : 'Nenhum armador cadastrado'}
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
