import { useState, useEffect, useRef } from 'react';
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
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Save, PackageCheck, Download, Printer, Clock, CheckCircle2, XCircle } from 'lucide-react';
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
const STATUS_TONES = {
  PENDENTE: 'amber',
  APROVADA: 'emerald',
  CANCELADA: 'red',
};

const SIZE_TYPE_OPTIONS = [
  ['20DC', '20DC'], ['20RF', '20RF'], ['20OT', '20OT'], ['20FR', '20FR'],
  ['40HC', '40HC'], ['40RF', '40RF'], ['40OT', '40OT'], ['40FR', '40FR'], ['40DRY', '40DRY'],
];

const CONTAINER_STATUS_OPTIONS = [
  ['CHEIO', 'Cheio'],
  ['VAZIO', 'Vazio'],
];

const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function emptyItem() {
  return { container_number: '', status: 'CHEIO', size_type: '', gross_weight: '', seal: '', shipping_line: '' };
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
    client_name: '',
    route_id: '', route_name: '', freight_value: null,
    representative_id: '', representative_name: '',
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
  const [freightRoutes, setFreightRoutes] = useState([]);
  const [clients, setClients] = useState([]);
  const [nextBookingPreview, setNextBookingPreview] = useState(null);
  const [representatives, setRepresentatives] = useState([]);
  const debounceRef = useRef(null);

  useEffect(() => { loadList(); loadDrivers(); loadCompanies(); loadVehicles(); loadShippingLines(); loadTerminals(); loadFreightRoutes(); loadClients(); loadNextBookingPreview(); loadRepresentatives(); }, []);

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
  const loadFreightRoutes = async () => {
    try {
      const r = await api.getFreightRoutes();
      setFreightRoutes(r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadClients = async () => {
    try {
      const r = await api.getClients();
      setClients(r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadNextBookingPreview = async () => {
    try {
      const r = await api.getNextAutoBookingNumber();
      setNextBookingPreview(r.data?.next_booking || null);
    } catch (e) { setNextBookingPreview(null); }
  };
  const loadRepresentatives = async () => {
    try {
      const r = await api.getContainerRepresentatives();
      setRepresentatives(r.data || []);
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

  const onChangeOrderType = (v) => {
    setForm((p) => ({
      ...p,
      order_type: v,
      ...(v !== 'COLETA' ? { route_id: '', route_name: '', freight_value: null } : {}),
      ...(v !== 'ENTREGA' ? { representative_id: '', representative_name: '' } : {}),
    }));
  };

  const onSelectRoute = (routeId) => {
    const route = freightRoutes.find((r) => r.id === routeId);
    if (!route) {
      setForm((p) => ({ ...p, route_id: '', route_name: '', freight_value: null }));
      return;
    }
    setForm((p) => ({
      ...p,
      route_id: route.id,
      route_name: `${route.origin} x ${route.destination}`,
      freight_value: route.freight_value,
    }));
  };

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
          status: entry.status || items[idx].status,
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
      loadNextBookingPreview();
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
  const countByStatus = (status) => list.filter((o) => o.status === status).length;

  return (
    <Layout>
      <div className="space-y-4" data-testid="loading-order-page">
        <PageHeader icon={PackageCheck} title="Ordem de Carregamento" subtitle="Minutas de coleta e entrega de container pro motorista" />

        <StatGrid>
          <StatCard label="Ordens" value={list.length} icon={PackageCheck} tone="blue" hint={search ? 'que batem com a busca' : 'cadastradas'} />
          <StatCard label="Pendentes" value={countByStatus('PENDENTE')} icon={Clock} tone="amber" hint="aguardando aprovação" />
          <StatCard label="Aprovadas" value={countByStatus('APROVADA')} icon={CheckCircle2} tone="primary" hint="movimentação gerada" />
          <StatCard label="Canceladas" value={countByStatus('CANCELADA')} icon={XCircle} tone="red" />
        </StatGrid>

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Número, container, motorista ou transportadora">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="loading-order-search" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma ordem pra habilitar as ações da barra */}
        <DataCard
          title="Ordens de carregamento"
          count={loading ? '...' : list.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova ordem" onClick={openCreate} testId="loading-order-new-btn" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedOrder && openEdit(singleSelectedOrder.id)} disabled={!singleSelectedOrder} />
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedOrder && downloadPDF(singleSelectedOrder.id, singleSelectedOrder.order_number)} disabled={!singleSelectedOrder} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedOrder && handleDelete(singleSelectedOrder.id, singleSelectedOrder.order_number)} disabled={!singleSelectedOrder} />
            </Toolbar>
          )}
        >
          {list.length === 0 && !loading ? (
            <EmptyState
              icon={PackageCheck}
              title={search ? 'Nenhuma ordem encontrada' : 'Nenhuma ordem de carregamento cadastrada'}
              hint={search ? 'Ajuste a busca' : 'Cadastre a primeira pelo botão "Nova ordem"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={list.length > 0 && list.every((o) => selectedIds.has(o.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Tipo</th>
                    <th>Container</th>
                    <th>Motorista</th>
                    <th>Transportadora</th>
                    <th>Rota</th>
                    <th>Status</th>
                    <th>Emissão</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => toggleSelect(o.id)}
                      data-selected={selectedIds.has(o.id)}
                      className="cursor-pointer"
                      data-testid={`loading-order-row-${o.order_number}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(o.id)}
                          onCheckedChange={() => toggleSelect(o.id)}
                          data-testid={`loading-order-row-checkbox-${o.order_number}`}
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{o.order_number}</td>
                      <td>
                        <StatusPill tone={o.order_type === 'ENTREGA' ? 'violet' : 'blue'} dot={false}>
                          {o.order_type === 'ENTREGA' ? 'Entrega' : 'Coleta'}
                        </StatusPill>
                      </td>
                      <td className="font-mono whitespace-nowrap text-slate-700 dark:text-slate-200">
                        {o.items && o.items.length > 0
                          ? `${o.items[0].container_number || '-'}${o.items.length > 1 ? ` +${o.items.length - 1}` : ''}`
                          : '-'}
                      </td>
                      <td><div className="max-w-[200px] truncate" title={o.driver_name || ''}>{o.driver_name || '-'}</div></td>
                      <td><div className="max-w-[200px] truncate" title={o.transport_company || ''}>{o.transport_company || '-'}</div></td>
                      <td><div className="max-w-[200px] truncate" title={o.route_name || ''}>{o.route_name || '-'}</div></td>
                      <td>
                        <StatusPill tone={STATUS_TONES[o.status] || 'slate'}>
                          {STATUS_LABELS[o.status] || o.status}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{o.created_at ? format(new Date(o.created_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
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
              <SelectField label="Tipo *" value={form.order_type} onChange={onChangeOrderType} options={ORDER_TYPE_OPTIONS} testid="loading-order-type" />
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

            {form.order_type === 'COLETA' && (
              <>
                <SectionTitle>Rota e Frete</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1 block">Rota</Label>
                    <Select value={form.route_id || '_empty'} onValueChange={(v) => onSelectRoute(v === '_empty' ? '' : v)}>
                      <SelectTrigger className="h-9 text-sm" data-testid="loading-order-route"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_empty">-</SelectItem>
                        {freightRoutes
                          .filter((r) => r.status === 'ATIVO' || r.id === form.route_id)
                          .map((r) => (
                            <SelectItem key={r.id} value={r.id}>{r.origin} x {r.destination}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {freightRoutes.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">Nenhuma rota cadastrada. Vá em "Transporte &gt; Rota" para adicionar.</p>
                    )}
                  </div>
                  <div>
                    <Label className="mb-1 block">Valor do Frete</Label>
                    <Input
                      disabled
                      value={form.route_id ? formatMoney(form.freight_value) : '-'}
                      className="h-9 text-sm bg-slate-50 dark:bg-slate-800"
                      data-testid="loading-order-freight-value"
                    />
                    <p className="text-xs text-slate-400 mt-1">Preenchido automaticamente pela Rota selecionada</p>
                  </div>
                </div>
              </>
            )}

            {form.order_type === 'ENTREGA' && (
              <>
                <SectionTitle>Representante</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1 block">Representante</Label>
                    <Autocomplete
                      value={form.representative_name}
                      onChange={(v) => onChange('representative_name', v)}
                      onSelect={(r) => setForm((p) => ({ ...p, representative_id: r.id, representative_name: r.name }))}
                      options={representatives}
                      displayField="name"
                      className="h-9 text-sm"
                    />
                    {representatives.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">Nenhum representante cadastrado. Vá em "Gestão de Container &gt; Cadastro de Representantes" para adicionar.</p>
                    )}
                  </div>
                </div>
              </>
            )}

            <SectionTitle>Especificações do Container e Carga</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              {form.order_type === 'ENTREGA' && nextBookingPreview ? (
                <div>
                  <Label className="mb-1 block">Booking/Ref.</Label>
                  <Input
                    disabled
                    value={form.booking || nextBookingPreview}
                    className="h-9 text-sm bg-slate-50 dark:bg-slate-800"
                    data-testid="loading-order-booking"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    {form.booking ? 'Gerado automaticamente' : 'Será gerado automaticamente ao salvar'}
                  </p>
                </div>
              ) : (
                <Field label="Booking/Ref." value={form.booking} onChange={(v) => onChange('booking', v)} testid="loading-order-booking" />
              )}
              <div>
                <Label className="mb-1 block">Cliente</Label>
                <Autocomplete
                  value={form.client_name}
                  onChange={(v) => onChange('client_name', v)}
                  onSelect={(c) => onChange('client_name', c.name)}
                  options={clients}
                  displayField="name"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-between mt-1">
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Containers da Ordem</Label>
              <Button variant="outline" size="sm" onClick={addContainerItem} type="button" className="h-7 text-xs" data-testid="loading-order-add-item">
                <Plus className="w-3 h-3 mr-1" />Adicionar Container
              </Button>
            </div>
            <div className="space-y-2">
              {form.items.map((it, idx) => (
                <div key={idx} className="flex flex-col gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
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
                      <Label className="text-xs mb-1 block">Status</Label>
                      <Select value={it.status || 'CHEIO'} onValueChange={(v) => updateContainerItem(idx, 'status', v)}>
                        <SelectTrigger className="h-8 text-sm" data-testid={`loading-order-item-status-${idx}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONTAINER_STATUS_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
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
                  </div>
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-3">
                      <Label className="text-xs mb-1 block">Peso Bruto</Label>
                      <Input value={it.gross_weight} onChange={(e) => updateContainerItem(idx, 'gross_weight', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs mb-1 block">Lacre</Label>
                      <Input value={it.seal} onChange={(e) => updateContainerItem(idx, 'seal', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-4" />
                    <div className="col-span-2 flex justify-end">
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
