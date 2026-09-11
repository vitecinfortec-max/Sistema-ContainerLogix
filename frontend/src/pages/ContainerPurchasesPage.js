import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Search, ShoppingCart } from 'lucide-react';

const STATUS_LABELS = { DISPONIVEL: 'Disponível', VENDIDO: 'Vendido' };
const STATUS_BADGE_CLASS = {
  DISPONIVEL: 'bg-emerald-100 text-emerald-700',
  VENDIDO: 'bg-slate-100 text-slate-600',
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
      <div className="space-y-5" data-testid="container-purchases-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            Compra de Container
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Lançamentos gerados a partir das Ordens de Coleta aprovadas, ou cadastrados manualmente</p>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="mb-1 block text-xs">Container</Label>
                <Input className="h-9 text-sm font-mono" value={containerFilter} onChange={(e) => setContainerFilter(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Status</Label>
                <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todos</SelectItem>
                    <SelectItem value="DISPONIVEL">Disponível</SelectItem>
                    <SelectItem value="VENDIDO">Vendido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openCreate}
            title="Adicionar"
            data-testid="add-container-purchase-button"
            className="h-9 w-9 p-0"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelected && openEdit(singleSelected)}
            disabled={!singleSelected}
            title="Editar"
            data-testid="edit-container-purchase-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Pencil className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelected && handleDelete(singleSelected)}
            disabled={!singleSelected}
            title="Excluir"
            data-testid="delete-container-purchase-button"
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
              <ShoppingCart className="w-4 h-4" />
              {loading ? 'Carregando...' : `Compras (${filteredList.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-800">
                    <TableHead className="w-9">
                      <Checkbox
                        checked={filteredList.length > 0 && filteredList.every((p) => selectedIds.has(p.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </TableHead>
                    <TableHead className="text-[12px] font-semibold">Container</TableHead>
                    <TableHead className="text-[12px] font-semibold">Booking</TableHead>
                    <TableHead className="text-[12px] font-semibold">Terminal</TableHead>
                    <TableHead className="text-[12px] font-semibold">Data Entrada</TableHead>
                    <TableHead className="text-[12px] font-semibold">Valor Compra</TableHead>
                    <TableHead className="text-[12px] font-semibold">Valor Venda</TableHead>
                    <TableHead className="text-[12px] font-semibold">Status</TableHead>
                    <TableHead className="text-[12px] font-semibold">Origem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredList.length === 0 && !loading && (
                    <TableRow><TableCell colSpan={9} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">Nenhuma compra encontrada.</TableCell></TableRow>
                  )}
                  {filteredList.map((p) => (
                    <TableRow
                      key={p.id}
                      onClick={() => toggleSelect(p.id)}
                      className={`cursor-pointer transition-colors ${selectedIds.has(p.id) ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                      data-testid="container-purchase-row"
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(p.id)}
                          onCheckedChange={() => toggleSelect(p.id)}
                        />
                      </TableCell>
                      <TableCell className="text-[13px] font-mono font-semibold">{p.container_number}</TableCell>
                      <TableCell className="text-[13px]">{p.booking || '-'}</TableCell>
                      <TableCell className="text-[13px]">{p.origin_terminal || '-'}</TableCell>
                      <TableCell className="text-[12px]">{p.entry_date ? format(new Date(p.entry_date), 'dd/MM/yyyy') : '-'}</TableCell>
                      <TableCell className="text-[13px]">{formatMoney(p.purchase_value)}</TableCell>
                      <TableCell className="text-[13px]">{formatMoney(p.sale_value)}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_BADGE_CLASS[p.status] || 'bg-slate-100 text-slate-600'}`}>
                          {STATUS_LABELS[p.status] || p.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-[12px]">{p.loading_order_id ? `Ordem Nº ${p.order_number}` : 'Manual'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
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
