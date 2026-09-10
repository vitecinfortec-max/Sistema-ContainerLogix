import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Search, Save, PackageCheck, Download } from 'lucide-react';
import { formatContainerNumber } from '../lib/containerNumber';

const ORDER_TYPE_OPTIONS = [
  ['COLETA', 'Coleta de Container'],
  ['ENTREGA', 'Entrega de Container'],
];
const ORDER_TYPE_LABELS = ORDER_TYPE_OPTIONS.reduce((acc, [v, l]) => { acc[v] = l; return acc; }, {});

const STATUS_OPTIONS = [
  ['PENDENTE', 'Pendente'],
  ['APROVADA', 'Aprovada'],
  ['CANCELADA', 'Cancelada'],
];
const STATUS_LABELS = STATUS_OPTIONS.reduce((acc, [v, l]) => { acc[v] = l; return acc; }, {});
const STATUS_BADGE_CLASS = {
  PENDENTE: 'bg-amber-100 text-amber-700',
  APROVADA: 'bg-emerald-100 text-emerald-700',
  CANCELADA: 'bg-rose-100 text-rose-700',
};

const SIZE_TYPE_OPTIONS = [
  ['20DC', '20DC'], ['20RF', '20RF'], ['20OT', '20OT'], ['20FR', '20FR'],
  ['40HC', '40HC'], ['40RF', '40RF'], ['40OT', '40OT'], ['40FR', '40FR'], ['40DRY', '40DRY'],
];

function emptyItem() {
  return { container_number: '', size_type: '', gross_weight: '', seal: '', shipping_line: '' };
}

function buildEmpty() {
  return {
    order_type: 'COLETA',
    status: 'PENDENTE',
    collection_window: '',
    origin_terminal: '',
    port: '',
    items: [emptyItem()],
    booking: '',
    driver_id: '', driver_name: '', driver_cpf: '',
    transport_company: '',
    truck_plate: '',
    trailer_plate: '',
    observations: '',
  };
}

export default function LoadingOrderPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [nextNumber, setNextNumber] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [drivers, setDrivers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const debounceRef = useRef(null);

  useEffect(() => { loadList(); loadDrivers(); loadCompanies(); loadVehicles(); loadShippingLines(); loadTerminals(); }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadList(); }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search]);

  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      const r = await api.getLoadingOrders(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar ordens de carregamento');
    } finally {
      setLoading(false);
    }
  };

  const loadDrivers = async () => {
    try {
      const r = await api.getDrivers();
      setDrivers(r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadCompanies = async () => {
    try {
      const r = await api.getCompanies();
      setCompanies(r.data?.items || r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadVehicles = async () => {
    try {
      const r = await api.getVehicles({ per_page: 1000 });
      setVehicles(r.data?.items || r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadShippingLines = async () => {
    try {
      const r = await api.getShippingLines();
      setShippingLines(r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadTerminals = async () => {
    try {
      const r = await api.getTerminals();
      setTerminals(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const reset = () => setForm(buildEmpty());

  const openCreate = async () => {
    reset();
    setEditingId(null);
    try {
      const r = await api.getLoadingOrderNextNumber();
      setNextNumber(r.data?.next_number || 1);
    } catch (e) { setNextNumber(null); }
    setDialogOpen(true);
  };

  const openEdit = async (id) => {
    try {
      const r = await api.getLoadingOrder(id);
      const d = r.data;
      setEditingId(id);
      setNextNumber(d.order_number);
      setForm({ ...buildEmpty(), ...d, items: (d.items && d.items.length) ? d.items : [emptyItem()] });
      setDialogOpen(true);
    } catch (e) { toast.error('Erro ao carregar ordem de carregamento'); }
  };

  const onChange = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const onSelectDriver = (d) => {
    setForm((p) => ({
      ...p,
      driver_id: d.id,
      driver_name: d.name,
      driver_cpf: d.cpf || p.driver_cpf,
      truck_plate: d.default_truck_plate || p.truck_plate,
      trailer_plate: d.default_trailer_plate || p.trailer_plate,
    }));
  };

  const addContainerItem = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
  };
  const updateContainerItem = (idx, field, value) => {
    setForm((prev) => {
      const items = [...prev.items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...prev, items };
    });
  };
  const removeContainerItem = (idx) => {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const handleItemContainerBlur = async (idx, e) => {
    const formatted = formatContainerNumber(e.target.value);
    if (form.order_type !== 'ENTREGA' || !formatted) {
      updateContainerItem(idx, 'container_number', formatted);
      return;
    }
    try {
      const response = await api.getOpenEntryForContainer(formatted);
      const entry = response.data?.entry;
      updateContainerItem(idx, 'container_number', formatted);
      if (!entry) return;
      setForm((prev) => {
        const items = [...prev.items];
        items[idx] = {
          ...items[idx],
          container_number: formatted,
          size_type: entry.size_type || items[idx].size_type,
          shipping_line: entry.shipping_line || items[idx].shipping_line,
          seal: entry.seal || items[idx].seal,
          gross_weight: entry.tare || items[idx].gross_weight,
        };
        return { ...prev, items };
      });
      toast.success(`Dados da entrada #${entry.transaction_id} preenchidos automaticamente (Booking não incluso)`);
    } catch (error) {
      // Sem entrada em aberto para esse container - segue preenchimento manual
      updateContainerItem(idx, 'container_number', formatted);
    }
  };

  const handleSave = async () => {
    if (!form.driver_name) {
      toast.error('Preencha os campos obrigatórios (Motorista)');
      return;
    }
    const items = form.items
      .filter((it) => (it.container_number || '').trim())
      .map((it) => ({ ...it, container_number: formatContainerNumber(it.container_number) }));
    if (items.length === 0) {
      toast.error('Adicione ao menos um container à ordem');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, items };
      if (editingId) {
        await api.updateLoadingOrder(editingId, payload);
        toast.success('Ordem de Carregamento atualizada!');
      } else {
        await api.createLoadingOrder(payload);
        toast.success('Ordem de Carregamento criada!');
      }
      setDialogOpen(false);
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar ordem de carregamento');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id, num) => {
    if (!(await confirm(`Excluir Ordem de Carregamento Nº ${num}?`))) return;
    try {
      await api.deleteLoadingOrder(id);
      toast.success('Ordem de Carregamento excluída');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadList();
    } catch (e) { toast.error('Erro ao excluir'); }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = list.map((o) => o.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const downloadPDF = async (id, num) => {
    try {
      const r = await api.getLoadingOrderPDF(id);
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `OrdemCarregamento_${num}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('PDF gerado!');
    } catch (e) { toast.error('Erro ao gerar PDF'); }
  };

  const singleSelectedOrder = selectedIds.size === 1 ? list.find((o) => o.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-5" data-testid="loading-order-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <PackageCheck className="w-4 h-4" />
            Ordem de Carregamento
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Minutas de coleta e entrega de container pro motorista</p>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <Input value={search}
                onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-[13px]" data-testid="loading-order-search" />
            </div>
          </CardContent>
        </Card>

        {/* Barra de ações - marque uma ordem na tabela abaixo pra habilitar as ações */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openCreate}
            title="Adicionar"
            data-testid="loading-order-new-btn"
            className="h-9 w-9 p-0"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedOrder && openEdit(singleSelectedOrder.id)}
            disabled={!singleSelectedOrder}
            title="Editar"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Pencil className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedOrder && downloadPDF(singleSelectedOrder.id, singleSelectedOrder.order_number)}
            disabled={!singleSelectedOrder}
            title="Baixar PDF"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Download className="w-4 h-4 text-emerald-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedOrder && handleDelete(singleSelectedOrder.id, singleSelectedOrder.order_number)}
            disabled={!singleSelectedOrder}
            title="Excluir"
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
              <PackageCheck className="w-4 h-4" />
              {loading ? 'Carregando...' : `Ordens de Carregamento Registradas (${list.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-800">
                    <TableHead className="w-9">
                      <Checkbox
                        checked={list.length > 0 && list.every((o) => selectedIds.has(o.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </TableHead>
                    <TableHead className="text-[12px] font-semibold">Nº</TableHead>
                    <TableHead className="text-[12px] font-semibold">Tipo</TableHead>
                    <TableHead className="text-[12px] font-semibold">Container</TableHead>
                    <TableHead className="text-[12px] font-semibold">Motorista</TableHead>
                    <TableHead className="text-[12px] font-semibold">Transportadora</TableHead>
                    <TableHead className="text-[12px] font-semibold">Status</TableHead>
                    <TableHead className="text-[12px] font-semibold">Emissão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.length === 0 && !loading && (
                    <TableRow><TableCell colSpan={8} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">Nenhuma ordem de carregamento cadastrada.</TableCell></TableRow>
                  )}
                  {list.map((o) => (
                    <TableRow
                      key={o.id}
                      onClick={() => toggleSelect(o.id)}
                      className={`cursor-pointer transition-colors ${selectedIds.has(o.id) ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                      data-testid={`loading-order-row-${o.order_number}`}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(o.id)}
                          onCheckedChange={() => toggleSelect(o.id)}
                          data-testid={`loading-order-row-checkbox-${o.order_number}`}
                        />
                      </TableCell>
                      <TableCell className="text-[13px] font-semibold text-primary">Nº {o.order_number}</TableCell>
                      <TableCell className="text-[12px]">{ORDER_TYPE_LABELS[o.order_type] || o.order_type}</TableCell>
                      <TableCell className="text-[12px] font-mono">
                        {o.items && o.items.length > 0
                          ? `${o.items[0].container_number || '-'}${o.items.length > 1 ? ` +${o.items.length - 1}` : ''}`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-[13px]">{o.driver_name || '-'}</TableCell>
                      <TableCell className="text-[13px]">{o.transport_company || '-'}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_BADGE_CLASS[o.status] || 'bg-slate-100 text-slate-600'}`}>
                          {STATUS_LABELS[o.status] || o.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-[12px]">{o.created_at ? format(new Date(o.created_at), 'dd/MM/yyyy HH:mm') : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="loading-order-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <PackageCheck className="w-5 h-5 text-primary" />
              {editingId ? 'Editar Ordem de Carregamento' : 'Nova Ordem de Carregamento'}
              {nextNumber !== null && <Badge variant="outline" className="ml-2 text-primary border-primary/30">Nº {nextNumber}</Badge>}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <SectionTitle>Dados do Agendamento e Controle</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <SelectField label="Tipo *" value={form.order_type} onChange={(v) => onChange('order_type', v)} options={ORDER_TYPE_OPTIONS} testid="loading-order-type" />
              <SelectField label="Status" value={form.status} onChange={(v) => onChange('status', v)} options={STATUS_OPTIONS} testid="loading-order-status" />
              <WindowField value={form.collection_window} onChange={(v) => onChange('collection_window', v)} />
            </div>

            <SectionTitle>Origem e Destino</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block">Terminal de Origem</Label>
                <Autocomplete
                  value={form.origin_terminal}
                  onChange={(v) => onChange('origin_terminal', v)}
                  onSelect={(t) => onChange('origin_terminal', t.name)}
                  options={terminals}
                  displayField="name"
                  className="h-9 text-sm"
                />
              </div>
              <Field label="Destino" value={form.port} onChange={(v) => onChange('port', v)} testid="loading-order-port" />
            </div>

            <SectionTitle>Especificações do Container e Carga</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Booking/Ref." value={form.booking} onChange={(v) => onChange('booking', v)} testid="loading-order-booking" />
            </div>

            <div className="flex items-center justify-between mt-1">
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Containers da Ordem</Label>
              <Button variant="outline" size="sm" onClick={addContainerItem} type="button" className="h-7 text-xs" data-testid="loading-order-add-item">
                <Plus className="w-3 h-3 mr-1" />Adicionar Container
              </Button>
            </div>
            <div className="space-y-2">
              {form.items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                  <div className="col-span-3">
                    <Label className="text-xs mb-1 block">ID do Container <span className="text-red-500">*</span></Label>
                    <Input
                      value={it.container_number}
                      onChange={(e) => updateContainerItem(idx, 'container_number', e.target.value.toUpperCase())}
                      onBlur={(e) => handleItemContainerBlur(idx, e)}
                      className="h-8 text-sm"
                      data-testid={`loading-order-item-container-${idx}`}
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs mb-1 block">Tipo/Tamanho</Label>
                    <Select value={it.size_type || '_empty'} onValueChange={(v) => updateContainerItem(idx, 'size_type', v === '_empty' ? '' : v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_empty">-</SelectItem>
                        {SIZE_TYPE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs mb-1 block">Peso Bruto</Label>
                    <Input value={it.gross_weight} onChange={(e) => updateContainerItem(idx, 'gross_weight', e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs mb-1 block">Armador</Label>
                    <Select value={it.shipping_line || '_empty'} onValueChange={(v) => updateContainerItem(idx, 'shipping_line', v === '_empty' ? '' : v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-80 overflow-y-auto">
                        <SelectItem value="_empty">-</SelectItem>
                        {it.shipping_line && !shippingLines.some((l) => l.name === it.shipping_line) && (
                          <SelectItem value={it.shipping_line}>{it.shipping_line}</SelectItem>
                        )}
                        {shippingLines.map((line) => <SelectItem key={line.id} value={line.name}>{line.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1">
                    <Label className="text-xs mb-1 block">Lacre</Label>
                    <Input value={it.seal} onChange={(e) => updateContainerItem(idx, 'seal', e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeContainerItem(idx)}
                      disabled={form.items.length <= 1}
                      className="h-8 px-2 text-red-500 hover:text-red-700 disabled:opacity-30"
                      data-testid={`loading-order-item-remove-${idx}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {shippingLines.length === 0 && (
              <p className="text-xs text-amber-600 -mt-1">Nenhum armador cadastrado. Vá em "Cadastro" para adicionar.</p>
            )}

            <SectionTitle>Dados do Transporte (Transportador/Motorista)</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block">Motorista <span className="text-red-500">*</span></Label>
                <Autocomplete
                  value={form.driver_name}
                  onChange={(v) => onChange('driver_name', v)}
                  onSelect={onSelectDriver}
                  options={drivers}
                  displayField="name"
                  className="h-9 text-sm"
                />
              </div>
              <Field label="CPF" value={form.driver_cpf} onChange={(v) => onChange('driver_cpf', v)} testid="loading-order-cpf" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="mb-1 block">Transportadora Contratada</Label>
                <Autocomplete
                  value={form.transport_company}
                  onChange={(v) => onChange('transport_company', v)}
                  options={companies}
                  displayField="name"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="mb-1 block">Placa do Cavalo</Label>
                <Autocomplete
                  value={form.truck_plate}
                  onChange={(v) => onChange('truck_plate', v.toUpperCase())}
                  onSelect={(v) => onChange('truck_plate', v.plate)}
                  options={vehicles}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  className="h-9 text-sm font-mono"
                />
              </div>
              <div>
                <Label className="mb-1 block">Placa da Carreta</Label>
                <Autocomplete
                  value={form.trailer_plate}
                  onChange={(v) => onChange('trailer_plate', v.toUpperCase())}
                  onSelect={(v) => onChange('trailer_plate', v.plate)}
                  options={vehicles}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  className="h-9 text-sm font-mono"
                />
              </div>
            </div>

            <TextAreaField label="Observações" value={form.observations} onChange={(v) => onChange('observations', v)} testid="loading-order-observations" />
          </div>

          <DialogFooter>
            {editingId && (
              <Button variant="outline" onClick={() => downloadPDF(editingId, nextNumber)} data-testid="loading-order-print" title="Baixar PDF">
                <Download className="w-4 h-4 mr-2" />Imprimir
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="loading-order-cancel">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90" data-testid="loading-order-save">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : editingId ? 'Atualizar Ordem' : 'Salvar Ordem'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 className="text-[12px] font-bold uppercase tracking-wider text-primary border-b-2 border-primary/20 pb-1">
      {children}
    </h3>
  );
}

function RequiredLabel({ label }) {
  if (typeof label === 'string' && label.endsWith(' *')) {
    return <>{label.slice(0, -2)} <span className="text-red-500">*</span></>;
  }
  return label;
}

function Field({ label, value, onChange, onBlur, type = 'text', testid }) {
  return (
    <div>
      <Label className="mb-1 block"><RequiredLabel label={label} /></Label>
      <Input type={type} value={value ?? ''}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur} className="h-9 text-sm" data-testid={testid} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, testid }) {
  return (
    <div>
      <Label className="mb-1 block"><RequiredLabel label={label} /></Label>
      <Select value={value || '_empty'} onValueChange={(v) => onChange(v === '_empty' ? '' : v)}>
        <SelectTrigger className="h-9 text-sm" data-testid={testid}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v || '_empty'} value={v || '_empty'} className="text-sm">{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function WindowField({ value, onChange }) {
  const [start, end] = (value || '').split(' - ').map((s) => s.trim());
  return (
    <div>
      <Label className="mb-1 block">Janela</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="time"
          value={start || ''}
          onChange={(e) => onChange(`${e.target.value}${end ? ' - ' + end : ''}`)}
          className="h-9 text-sm"
          data-testid="loading-order-window-start"
        />
        <span className="text-xs text-muted-foreground shrink-0">até</span>
        <Input
          type="time"
          value={end || ''}
          onChange={(e) => onChange(`${start || ''} - ${e.target.value}`)}
          className="h-9 text-sm"
          data-testid="loading-order-window-end"
        />
      </div>
    </div>
  );
}

function TextAreaField({ label, value, onChange, testid }) {
  return (
    <div>
      <Label className="mb-1 block">{label}</Label>
      <Textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="text-sm min-h-[60px]" data-testid={testid} />
    </div>
  );
}
