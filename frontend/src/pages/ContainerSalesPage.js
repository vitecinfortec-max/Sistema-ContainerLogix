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
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Plus, Pencil, CheckCircle2, RotateCcw, Search, BadgeDollarSign } from 'lucide-react';

const STATUS_LABELS = { PENDENTE: 'Pendente', RECEBIDO: 'Recebido' };
const STATUS_BADGE_CLASS = {
  PENDENTE: 'bg-amber-100 text-amber-700',
  RECEBIDO: 'bg-emerald-100 text-emerald-700',
};

const formatMoney = (value) => (value == null ? '-' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

function buildEmpty() {
  return {
    container_number: '',
    representative_id: '',
    representative_name: '',
    sale_value: '',
    received_value: '',
    observations: '',
  };
}

export default function ContainerSalesPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [representatives, setRepresentatives] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [statusFilter, setStatusFilter] = useState('');
  const [containerFilter, setContainerFilter] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingIsAuto, setEditingIsAuto] = useState(false);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadRepresentatives(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadList(); }, [statusFilter]);

  const loadRepresentatives = async () => {
    try {
      const r = await api.getContainerRepresentatives();
      setRepresentatives(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const r = await api.getContainerSales(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar registros de venda');
    } finally {
      setLoading(false);
    }
  };

  const filteredList = list.filter((s) => {
    const term = containerFilter.trim().toUpperCase();
    if (!term) return true;
    return s.container_number?.toUpperCase().includes(term);
  });

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredList.map((s) => s.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const singleSelected = selectedIds.size === 1 ? filteredList.find((s) => s.id === [...selectedIds][0]) : null;

  const markStatus = async (id, status) => {
    try {
      await api.updateContainerSaleStatus(id, status);
      toast.success(status === 'RECEBIDO' ? 'Marcado como Recebido' : 'Marcado como Pendente');
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao atualizar status');
    }
  };

  const openCreate = () => {
    setForm(buildEmpty());
    setEditMode(false);
    setEditingId(null);
    setEditingIsAuto(false);
    setDialogOpen(true);
  };

  const openEdit = (sale) => {
    setForm({
      container_number: sale.container_number || '',
      representative_id: sale.representative_id || '',
      representative_name: sale.representative_name || '',
      sale_value: sale.sale_value ?? '',
      received_value: sale.received_value ?? '',
      observations: sale.observations || '',
    });
    setEditMode(true);
    setEditingId(sale.id);
    setEditingIsAuto(!!sale.loading_order_id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        container_number: form.container_number,
        representative_id: form.representative_id || null,
        representative_name: form.representative_name || null,
        sale_value: form.sale_value === '' ? null : parseFloat(form.sale_value),
        received_value: form.received_value === '' ? null : parseFloat(form.received_value),
        observations: form.observations || null,
      };
      if (editMode) {
        await api.updateContainerSale(editingId, payload);
        toast.success('Registro de Venda atualizado');
      } else {
        await api.createContainerSale(payload);
        toast.success('Registro de Venda cadastrado');
      }
      setDialogOpen(false);
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar registro de venda');
    } finally { setSaving(false); }
  };

  return (
    <Layout>
      <div className="space-y-5" data-testid="container-sales-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <BadgeDollarSign className="w-4 h-4" />
            Registro de Venda
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Lançamentos gerados a partir das Ordens de Entrega aprovadas, ou cadastrados manualmente, para controle de comissão dos vendedores</p>
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
                    <SelectItem value="PENDENTE">Pendente</SelectItem>
                    <SelectItem value="RECEBIDO">Recebido</SelectItem>
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
            data-testid="add-container-sale-button"
            className="h-9 w-9 p-0"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelected && markStatus(singleSelected.id, 'RECEBIDO')}
            disabled={!singleSelected || singleSelected.status !== 'PENDENTE'}
            title="Marcar como Recebido"
            data-testid="sale-mark-received"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelected && markStatus(singleSelected.id, 'PENDENTE')}
            disabled={!singleSelected || singleSelected.status !== 'RECEBIDO'}
            title="Marcar como Pendente"
            data-testid="sale-mark-pending"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <RotateCcw className="w-4 h-4 text-amber-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelected && openEdit(singleSelected)}
            disabled={!singleSelected}
            title="Editar"
            data-testid="edit-container-sale-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Pencil className="w-4 h-4 text-blue-600" />
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
              <BadgeDollarSign className="w-4 h-4" />
              {loading ? 'Carregando...' : `Vendas (${filteredList.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-800">
                    <TableHead className="w-9">
                      <Checkbox
                        checked={filteredList.length > 0 && filteredList.every((s) => selectedIds.has(s.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </TableHead>
                    <TableHead className="text-[12px] font-semibold">Container</TableHead>
                    <TableHead className="text-[12px] font-semibold">Booking</TableHead>
                    <TableHead className="text-[12px] font-semibold">Terminal</TableHead>
                    <TableHead className="text-[12px] font-semibold">Data Entrada</TableHead>
                    <TableHead className="text-[12px] font-semibold">Vendedor</TableHead>
                    <TableHead className="text-[12px] font-semibold">Valor Venda</TableHead>
                    <TableHead className="text-[12px] font-semibold">Valor Recebido</TableHead>
                    <TableHead className="text-[12px] font-semibold">Status</TableHead>
                    <TableHead className="text-[12px] font-semibold">Origem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredList.length === 0 && !loading && (
                    <TableRow><TableCell colSpan={10} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">Nenhuma venda encontrada.</TableCell></TableRow>
                  )}
                  {filteredList.map((s) => (
                    <TableRow
                      key={s.id}
                      onClick={() => toggleSelect(s.id)}
                      className={`cursor-pointer transition-colors ${selectedIds.has(s.id) ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                      data-testid="container-sale-row"
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(s.id)}
                          onCheckedChange={() => toggleSelect(s.id)}
                        />
                      </TableCell>
                      <TableCell className="text-[13px] font-mono font-semibold">{s.container_number}</TableCell>
                      <TableCell className="text-[13px]">{s.booking || '-'}</TableCell>
                      <TableCell className="text-[13px]">{s.origin_terminal || '-'}</TableCell>
                      <TableCell className="text-[12px]">{s.entry_date ? format(new Date(s.entry_date), 'dd/MM/yyyy') : '-'}</TableCell>
                      <TableCell className="text-[13px]">{s.representative_name || '-'}</TableCell>
                      <TableCell className="text-[13px]">{formatMoney(s.sale_value)}</TableCell>
                      <TableCell className="text-[13px]">{formatMoney(s.received_value)}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_BADGE_CLASS[s.status] || 'bg-slate-100 text-slate-600'}`}>
                          {STATUS_LABELS[s.status] || s.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-[12px]">{s.loading_order_id ? `Ordem Nº ${s.order_number}` : 'Manual'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="container-sale-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">{editMode ? 'Editar Registro de Venda' : 'Cadastrar Registro de Venda'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Número do Container *</Label>
              <Input
                className="h-10 text-[13px] font-mono"
                value={form.container_number}
                onChange={(e) => setForm({ ...form, container_number: e.target.value.toUpperCase() })}
                disabled={editingIsAuto}
                data-testid="sale-container-number-input"
              />
              {!editMode && (
                <p className="text-xs text-slate-500">Se houver uma Compra Disponível para este container, Booking/Terminal/Data de Entrada serão preenchidos automaticamente.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Representante</Label>
              <Autocomplete
                value={form.representative_name}
                onChange={(v) => setForm({ ...form, representative_name: v })}
                onSelect={(r) => setForm({ ...form, representative_id: r.id, representative_name: r.name })}
                options={representatives}
                displayField="name"
                className="h-10 text-[13px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Valor da Venda</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-10 text-[13px]"
                  value={form.sale_value}
                  onChange={(e) => setForm({ ...form, sale_value: e.target.value })}
                  data-testid="sale-value-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Valor Recebido</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-10 text-[13px]"
                  value={form.received_value}
                  onChange={(e) => setForm({ ...form, received_value: e.target.value })}
                  data-testid="sale-received-value-input"
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
            <Button onClick={handleSave} disabled={saving} data-testid="submit-container-sale-button">
              {saving ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
