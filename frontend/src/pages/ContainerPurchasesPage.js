import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, EmptyState,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, ShoppingCart, Package, CheckCircle2, Wallet } from 'lucide-react';

const STATUS_LABELS = { DISPONIVEL: 'Disponível', VENDIDO: 'Vendido' };
const STATUS_TONES = {
  DISPONIVEL: 'emerald',
  VENDIDO: 'slate',
};

const formatMoney = (value) => (value == null ? '-' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

function buildEmpty() {
  return {
    container_number: '',
    booking: '',
    origin_terminal: '',
    entry_date: '',
    purchase_value: '',
    sale_value: '',
    observations: '',
  };
}

export default function ContainerPurchasesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [statusFilter, setStatusFilter] = useState('');
  const [containerFilter, setContainerFilter] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingIsAuto, setEditingIsAuto] = useState(false);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadList(); }, [statusFilter]);

  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const r = await api.getContainerPurchases(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar compras de container');
    } finally {
      setLoading(false);
    }
  };

  const filteredList = list.filter((p) => {
    const term = containerFilter.trim().toUpperCase();
    if (!term) return true;
    return p.container_number?.toUpperCase().includes(term);
  });

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredList.map((p) => p.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const singleSelected = selectedIds.size === 1 ? filteredList.find((p) => p.id === [...selectedIds][0]) : null;

  const openCreate = () => {
    setForm(buildEmpty());
    setEditMode(false);
    setEditingId(null);
    setEditingIsAuto(false);
    setDialogOpen(true);
  };

  const openEdit = (purchase) => {
    setForm({
      container_number: purchase.container_number || '',
      booking: purchase.booking || '',
      origin_terminal: purchase.origin_terminal || '',
      entry_date: purchase.entry_date ? purchase.entry_date.slice(0, 10) : '',
      purchase_value: purchase.purchase_value ?? '',
      sale_value: purchase.sale_value ?? '',
      observations: purchase.observations || '',
    });
    setEditMode(true);
    setEditingId(purchase.id);
    setEditingIsAuto(!!purchase.loading_order_id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        container_number: form.container_number,
        booking: form.booking || null,
        origin_terminal: form.origin_terminal || null,
        entry_date: form.entry_date ? new Date(form.entry_date).toISOString() : null,
        purchase_value: form.purchase_value === '' ? null : parseFloat(form.purchase_value),
        sale_value: form.sale_value === '' ? null : parseFloat(form.sale_value),
        observations: form.observations || null,
      };
      if (editMode) {
        await api.updateContainerPurchase(editingId, payload);
        toast.success('Compra de Container atualizada');
      } else {
        await api.createContainerPurchase(payload);
        toast.success('Compra de Container cadastrada');
      }
      setDialogOpen(false);
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar compra de container');
    } finally { setSaving(false); }
  };

  const handleDelete = async (purchase) => {
    if (await confirm('Tem certeza que deseja excluir esta Compra de Container?')) {
      try {
        await api.deleteContainerPurchase(purchase.id);
        toast.success('Compra de Container excluída');
        setSelectedIds(prev => {
          if (!prev.has(purchase.id)) return prev;
          const next = new Set(prev);
          next.delete(purchase.id);
          return next;
        });
        loadList();
      } catch (e) {
        toast.error(e?.response?.data?.detail || 'Erro ao excluir compra de container');
      }
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="container-purchases-page">
        <PageHeader
          icon={ShoppingCart}
          title="Compra de Container"
          subtitle="Lançamentos gerados a partir das Ordens de Coleta aprovadas, ou cadastrados manualmente"
        />

        <StatGrid className="lg:grid-cols-3">
          <StatCard label="Disponíveis" value={filteredList.filter((p) => p.status === 'DISPONIVEL').length} icon={Package} tone="emerald" hint="ainda não vendidos" />
          <StatCard label="Vendidos" value={filteredList.filter((p) => p.status === 'VENDIDO').length} icon={CheckCircle2} tone="slate" />
          <StatCard label="Valor de compra" value={formatMoney(filteredList.reduce((acc, p) => acc + Number(p.purchase_value || 0), 0))} icon={Wallet} tone="blue" hint="soma dos listados" />
        </StatGrid>

        <FilterCard
          hasFilters={!!(containerFilter || statusFilter)}
          onClear={() => { setContainerFilter(''); setStatusFilter(''); }}
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Container">
              <SearchInput className="font-mono" value={containerFilter} onChange={(e) => setContainerFilter(e.target.value)} />
            </FilterField>
            <FilterField label="Status">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  <SelectItem value="DISPONIVEL">Disponível</SelectItem>
                  <SelectItem value="VENDIDO">Vendido</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma compra pra habilitar as ações da barra */}
        <DataCard
          title="Compras"
          count={loading ? '...' : filteredList.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova compra" onClick={openCreate} testId="add-container-purchase-button" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelected && openEdit(singleSelected)} disabled={!singleSelected} testId="edit-container-purchase-button" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelected && handleDelete(singleSelected)} disabled={!singleSelected} testId="delete-container-purchase-button" />
            </Toolbar>
          )}
        >
          {filteredList.length === 0 && !loading ? (
            <EmptyState
              icon={ShoppingCart}
              title="Nenhuma compra encontrada"
              hint={containerFilter || statusFilter ? 'Ajuste os filtros' : 'As compras aparecem aqui quando uma Ordem de Coleta é aprovada, ou pelo botão "Nova compra"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredList.length > 0 && filteredList.every((p) => selectedIds.has(p.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Container</th>
                    <th>Booking</th>
                    <th>Terminal</th>
                    <th>Data entrada</th>
                    <th className="!text-right">Valor compra</th>
                    <th className="!text-right">Valor venda</th>
                    <th>Status</th>
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredList.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => toggleSelect(p.id)}
                      data-selected={selectedIds.has(p.id)}
                      className="cursor-pointer"
                      data-testid="container-purchase-row"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(p.id)}
                          onCheckedChange={() => toggleSelect(p.id)}
                        />
                      </td>
                      <td className="font-mono whitespace-nowrap cell-strong">{p.container_number}</td>
                      <td className="whitespace-nowrap">{p.booking || '-'}</td>
                      <td><div className="max-w-[200px] truncate" title={p.origin_terminal || ''}>{p.origin_terminal || '-'}</div></td>
                      <td className="whitespace-nowrap tabular-nums">{p.entry_date ? format(new Date(p.entry_date), 'dd/MM/yyyy') : '-'}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{formatMoney(p.purchase_value)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{formatMoney(p.sale_value)}</td>
                      <td>
                        <StatusPill tone={STATUS_TONES[p.status] || 'slate'}>
                          {STATUS_LABELS[p.status] || p.status}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap">
                        {p.loading_order_id
                          ? <StatusPill tone="blue" dot={false}>Ordem #{p.order_number}</StatusPill>
                          : <StatusPill tone="slate" dot={false}>Manual</StatusPill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="container-purchase-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">{editMode ? 'Editar Compra de Container' : 'Cadastrar Compra de Container'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Número do Container *</Label>
                <Input
                  className="h-10 text-[13px] font-mono"
                  value={form.container_number}
                  onChange={(e) => setForm({ ...form, container_number: e.target.value.toUpperCase() })}
                  disabled={editingIsAuto}
                  data-testid="purchase-container-number-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Número do Booking</Label>
                <Input
                  className="h-10 text-[13px]"
                  value={form.booking}
                  onChange={(e) => setForm({ ...form, booking: e.target.value })}
                  disabled={editingIsAuto}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Terminal de Coleta</Label>
                <Input
                  className="h-10 text-[13px]"
                  value={form.origin_terminal}
                  onChange={(e) => setForm({ ...form, origin_terminal: e.target.value })}
                  disabled={editingIsAuto}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Data de Entrada</Label>
                <Input
                  type="date"
                  className="h-10 text-[13px]"
                  value={form.entry_date}
                  onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                  disabled={editingIsAuto}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Valor de Compra</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-10 text-[13px]"
                  value={form.purchase_value}
                  onChange={(e) => setForm({ ...form, purchase_value: e.target.value })}
                  data-testid="purchase-value-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Valor de Venda (alvo)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-10 text-[13px]"
                  value={form.sale_value}
                  onChange={(e) => setForm({ ...form, sale_value: e.target.value })}
                  data-testid="purchase-sale-target-input"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Observações</Label>
              <Textarea
                className="text-[13px] min-h-[60px]"
                value={form.observations}
                onChange={(e) => setForm({ ...form, observations: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="submit-container-purchase-button">
              {saving ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
