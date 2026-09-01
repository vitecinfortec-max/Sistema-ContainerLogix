import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Edit, Search, Wrench } from 'lucide-react';

const UNIT_OPTIONS = [['HORAS', 'Horas'], ['QUANTIDADE', 'Quantidade'], ['OUTROS', 'Outros']];
const STATUS_OPTIONS = [['true', 'Ativo'], ['false', 'Inativo']];

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function buildEmptyForm() {
  return { family_id: '', family_name: '', active: true, description: '', unit: 'QUANTIDADE', value: '' };
}

export default function ServiceCatalogPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [families, setFamilies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [nextCode, setNextCode] = useState(null);
  const [formData, setFormData] = useState(buildEmptyForm());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadItems(); loadFamilies(); }, []);

  const loadItems = async () => {
    setLoading(true);
    try {
      const response = await api.getServiceCatalog();
      setItems(response.data);
    } catch (error) {
      toast.error('Erro ao carregar serviços');
    } finally {
      setLoading(false);
    }
  };

  const loadFamilies = async () => {
    try {
      const response = await api.getServiceFamilies();
      setFamilies(response.data.filter((f) => f.status === 'ATIVO'));
    } catch (error) { /* ignore */ }
  };

  const resetForm = () => { setFormData(buildEmptyForm()); setEditId(null); };

  const openCreateDialog = async () => {
    resetForm();
    try {
      const r = await api.getServiceCatalogNextCode();
      setNextCode(r.data?.next_code || 1);
    } catch (e) { setNextCode(null); }
    setOpen(true);
  };

  const openEditDialog = (item) => {
    setFormData({
      family_id: item.family_id || '',
      family_name: item.family_name || '',
      active: item.active,
      description: item.description || '',
      unit: item.unit || 'QUANTIDADE',
      value: item.value?.toString() || '',
    });
    setNextCode(item.code);
    setEditId(item.id);
    setOpen(true);
  };

  const handleFamilyChange = (familyId) => {
    const family = families.find((f) => f.id === familyId);
    setFormData((p) => ({ ...p, family_id: familyId, family_name: family?.name || '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = { ...formData, value: Number(formData.value || 0) };
      if (editId) {
        await api.updateServiceCatalogItem(editId, payload);
        toast.success('Serviço atualizado com sucesso');
      } else {
        await api.createServiceCatalogItem(payload);
        toast.success('Serviço cadastrado com sucesso');
      }
      resetForm();
      setOpen(false);
      loadItems();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar serviço');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm('Tem certeza que deseja deletar este serviço?')) {
      try {
        await api.deleteServiceCatalogItem(id);
        toast.success('Serviço deletado com sucesso');
        loadItems();
      } catch (error) {
        toast.error('Erro ao deletar serviço');
      }
    }
  };

  const filteredItems = items.filter((item) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return item.description?.toLowerCase().includes(term) || item.family_name?.toLowerCase().includes(term) || String(item.code).includes(term);
  });

  return (
    <Layout>
      <div className="space-y-5" data-testid="service-catalog-page">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Cadastro de Serviço</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Catálogo de serviços do Estoque</p>
          </div>
          <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="default" className="text-[13px] font-semibold uppercase tracking-wide h-10" data-testid="add-service-catalog-button" onClick={openCreateDialog}>
                <Plus className="w-4 h-4 mr-2" />
                Novo Serviço
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="service-catalog-dialog">
              <DialogHeader>
                <DialogTitle className="text-base flex items-center gap-2">
                  {editId ? 'Editar Serviço' : 'Cadastrar Serviço'}
                  {nextCode !== null && <Badge variant="outline">Cód. {nextCode}</Badge>}
                </DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editId ? 'Atualize os dados do serviço' : 'Adicione um novo serviço ao catálogo'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Tipo de Família</Label>
                  <Select value={formData.family_id || '_empty'} onValueChange={(v) => handleFamilyChange(v === '_empty' ? '' : v)}>
                    <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_empty">-- Selecione --</SelectItem>
                      {families.map((f) => <SelectItem key={f.id} value={f.id} className="text-sm">{f.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Descrição *</Label>
                  <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} required className="h-10 text-[13px]" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">Unidade</Label>
                    <Select value={formData.unit} onValueChange={(v) => setFormData({ ...formData, unit: v })}>
                      <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNIT_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v} className="text-sm">{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">Valor</Label>
                    <Input type="number" step="0.01" value={formData.value} onChange={(e) => setFormData({ ...formData, value: e.target.value })} className="h-10 text-[13px]" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Ativo</Label>
                  <Select value={formData.active ? 'true' : 'false'} onValueChange={(v) => setFormData({ ...formData, active: v === 'true' })}>
                    <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v} className="text-sm">{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full h-10 text-[13px] font-semibold" data-testid="submit-service-catalog-button" disabled={submitting}>
                  {submitting ? 'Salvando...' : (editId ? 'Atualizar' : 'Cadastrar')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 text-[13px] pl-9" data-testid="search-service-catalog-input" />
        </div>

        <Card>
          <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
            <CardTitle className="text-[13px] font-medium">
              {loading ? 'Carregando...' : `Serviços Cadastrados (${filteredItems.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredItems.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Código</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Família</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Descrição</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Unidade</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Valor</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" data-testid="service-catalog-row">
                        <td className="px-4 py-2.5 text-[13px] font-semibold text-primary">{item.code}</td>
                        <td className="px-4 py-2.5 text-[13px]">{item.family_name || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px]">{item.description}</td>
                        <td className="px-4 py-2.5 text-[13px]">{UNIT_OPTIONS.find(([v]) => v === item.unit)?.[1] || item.unit}</td>
                        <td className="px-4 py-2.5 text-[13px]">{fmtMoney(item.value)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${item.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {item.active ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEditDialog(item)} title="Editar" className="h-8 w-8 p-0">
                              <Edit className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(item.id)} title="Deletar" className="h-8 w-8 p-0">
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
              <div className="p-10 text-center text-slate-500 dark:text-slate-400">
                <Wrench className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">{search ? 'Nenhum serviço encontrado' : 'Nenhum serviço cadastrado'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
