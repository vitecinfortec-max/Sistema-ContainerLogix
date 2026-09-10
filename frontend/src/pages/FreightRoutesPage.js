import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Route as RouteIcon, Edit, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_OPTIONS = [
  ['ATIVO', 'Ativo'],
  ['INATIVO', 'Inativo'],
];
const STATUS_BADGE_CLASS = {
  ATIVO: 'bg-emerald-100 text-emerald-700',
  INATIVO: 'bg-slate-100 text-slate-600',
};

const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function buildEmpty() {
  return { origin: '', destination: '', freight_value: '', status: 'ATIVO', observations: '' };
}

export default function FreightRoutesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState(buildEmpty());
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    loadRoutes();
  }, []);

  const loadRoutes = async () => {
    try {
      const response = await api.getFreightRoutes();
      setRoutes(response.data);
    } catch (error) {
      toast.error('Erro ao carregar rotas');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData(buildEmpty());
    setEditMode(false);
    setEditId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setOpen(true);
  };

  const openEditDialog = (route) => {
    setFormData({
      origin: route.origin,
      destination: route.destination,
      freight_value: route.freight_value,
      status: route.status || 'ATIVO',
      observations: route.observations || '',
    });
    setEditMode(true);
    setEditId(route.id);
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      const payload = { ...formData, freight_value: parseFloat(formData.freight_value) || 0 };
      if (editMode && editId) {
        await api.updateFreightRoute(editId, payload);
        toast.success('Rota atualizada com sucesso');
      } else {
        await api.createFreightRoute(payload);
        toast.success('Rota cadastrada com sucesso');
      }
      resetForm();
      setOpen(false);
      loadRoutes();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar rota');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm('Tem certeza que deseja deletar esta rota?')) {
      try {
        await api.deleteFreightRoute(id);
        toast.success('Rota deletada com sucesso');
        setSelectedIds(prev => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        loadRoutes();
      } catch (error) {
        toast.error('Erro ao deletar rota');
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
    const pageIds = filteredRoutes.map(r => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const filteredRoutes = routes.filter((route) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      route.origin?.toLowerCase().includes(term) ||
      route.destination?.toLowerCase().includes(term)
    );
  });

  const singleSelectedRoute = selectedIds.size === 1 ? filteredRoutes.find(r => r.id === [...selectedIds][0]) : null;

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="freight-routes-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="freight-routes-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Rota
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Cadastro de rotas dos motoristas, com o valor do frete de cada trajeto</p>
        </div>

        <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) resetForm();
          }}>
            <DialogContent data-testid="route-dialog">
              <DialogHeader>
                <DialogTitle className="text-base">{editMode ? 'Editar Rota' : 'Cadastrar Rota'}</DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editMode ? 'Atualize os dados da rota' : 'Adicione uma nova rota ao sistema'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="origin" className="text-[13px]">Origem *</Label>
                  <Input
                    id="origin"
                    data-testid="route-origin-input"
                    value={formData.origin}
                    onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                    required
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="destination" className="text-[13px]">Destino *</Label>
                  <Input
                    id="destination"
                    data-testid="route-destination-input"
                    value={formData.destination}
                    onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                    required
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="freight_value" className="text-[13px]">Valor do Frete *</Label>
                    <Input
                      id="freight_value"
                      type="number"
                      step="0.01"
                      min="0"
                      data-testid="route-freight-value-input"
                      value={formData.freight_value}
                      onChange={(e) => setFormData({ ...formData, freight_value: e.target.value })}
                      required
                      className="h-10 text-[13px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">Status</Label>
                    <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                      <SelectTrigger className="h-10 text-[13px]" data-testid="route-status-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="observations" className="text-[13px]">Observações</Label>
                  <Textarea
                    id="observations"
                    data-testid="route-observations-input"
                    value={formData.observations}
                    onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                    className="text-[13px] min-h-[60px]"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full h-10 text-[13px] font-semibold"
                  data-testid="submit-route-button"
                  disabled={submitting}
                >
                  {submitting ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

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
                data-testid="search-route-input"
              />
            </div>
          </CardContent>
        </Card>

        {/* Barra de ações - marque uma rota na tabela abaixo pra habilitar as ações */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openCreateDialog}
            title="Adicionar"
            data-testid="add-route-button"
            className="h-9 w-9 p-0"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedRoute && openEditDialog(singleSelectedRoute)}
            disabled={!singleSelectedRoute}
            title="Editar"
            data-testid="edit-route-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Edit className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedRoute && handleDelete(singleSelectedRoute.id)}
            disabled={!singleSelectedRoute}
            title="Excluir"
            data-testid="delete-route-button"
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

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <RouteIcon className="w-4 h-4" />
              Lista de Rotas ({filteredRoutes.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredRoutes.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="w-9 px-4 py-2.5">
                        <Checkbox
                          checked={filteredRoutes.length > 0 && filteredRoutes.every(r => selectedIds.has(r.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                          data-testid="select-all-checkbox"
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Origem</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Destino</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Valor do Frete</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cadastrado em</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredRoutes.map((route) => (
                      <tr
                        key={route.id}
                        onClick={() => toggleSelect(route.id)}
                        className={`cursor-pointer transition-colors ${selectedIds.has(route.id) ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                        data-testid="route-row"
                      >
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(route.id)}
                            onCheckedChange={() => toggleSelect(route.id)}
                            data-testid="route-row-checkbox"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-[13px] font-medium">{route.origin}</td>
                        <td className="px-4 py-2.5 text-[13px] font-medium">{route.destination}</td>
                        <td className="px-4 py-2.5 text-[13px]">{formatMoney(route.freight_value)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_BADGE_CLASS[route.status] || 'bg-slate-100 text-slate-600'}`}>
                            {route.status === 'INATIVO' ? 'Inativo' : 'Ativo'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[13px]">
                          {format(new Date(route.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-500 dark:text-slate-400" data-testid="no-routes">
                <RouteIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">
                  {search ? 'Nenhuma rota encontrada' : 'Nenhuma rota cadastrada'}
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
