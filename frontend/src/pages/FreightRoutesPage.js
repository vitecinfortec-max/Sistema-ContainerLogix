import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, StatusPill, EmptyState,
} from '../components/DataPage';
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
import { Plus, Trash2, Route as RouteIcon, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_OPTIONS = [
  ['ATIVO', 'Ativo'],
  ['INATIVO', 'Inativo'],
];
const STATUS_TONES = {
  ATIVO: 'emerald',
  INATIVO: 'slate',
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
      <div className="space-y-4" data-testid="freight-routes-page">
        <PageHeader icon={RouteIcon} title="Rota" subtitle="Cadastro de rotas dos motoristas, com o valor do frete de cada trajeto" />

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

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Origem ou destino">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-route-input" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma rota pra habilitar as ações da barra */}
        <DataCard
          title="Rotas"
          count={filteredRoutes.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova rota" onClick={openCreateDialog} testId="add-route-button" />}
            >
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => singleSelectedRoute && openEditDialog(singleSelectedRoute)} disabled={!singleSelectedRoute} testId="edit-route-button" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedRoute && handleDelete(singleSelectedRoute.id)} disabled={!singleSelectedRoute} testId="delete-route-button" />
            </Toolbar>
          )}
        >
          {filteredRoutes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredRoutes.length > 0 && filteredRoutes.every(r => selectedIds.has(r.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Origem</th>
                    <th>Destino</th>
                    <th className="!text-right">Valor do frete</th>
                    <th>Status</th>
                    <th>Cadastrado em</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoutes.map((route) => (
                    <tr
                      key={route.id}
                      onClick={() => toggleSelect(route.id)}
                      data-selected={selectedIds.has(route.id)}
                      className="cursor-pointer"
                      data-testid="route-row"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(route.id)}
                          onCheckedChange={() => toggleSelect(route.id)}
                          data-testid="route-row-checkbox"
                        />
                      </td>
                      <td className="cell-strong">{route.origin}</td>
                      <td className="cell-strong">{route.destination}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{formatMoney(route.freight_value)}</td>
                      <td>
                        <StatusPill tone={STATUS_TONES[route.status] || 'emerald'}>
                          {route.status === 'INATIVO' ? 'Inativo' : 'Ativo'}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {format(new Date(route.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={RouteIcon}
              title={search ? 'Nenhuma rota encontrada' : 'Nenhuma rota cadastrada'}
              hint={search ? 'Ajuste a busca' : 'Cadastre a primeira rota pelo botão "Nova rota"'}
              testId="no-routes"
            />
          )}
        </DataCard>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
