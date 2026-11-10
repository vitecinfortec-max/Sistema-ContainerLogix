import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, PlateTag, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import { toast } from 'sonner';
import {
  Container, Plus, Trash2, Printer, Pencil, Wallet, Clock, Truck, CheckCircle2, XCircle, AlertTriangle, X,
} from 'lucide-react';
import { format } from 'date-fns';
import { formatPlate } from '../lib/masks';
import { calculateContainerCheckDigit } from '../lib/containerNumber';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const OPERATION_LABELS = { ENTREGA: 'Entrega (Porto → Cliente)', COLETA: 'Coleta (Cliente → Porto)' };
export const OPERATION_SHORT = { ENTREGA: 'Entrega', COLETA: 'Coleta' };
export const STATUS_LABELS = { ABERTA: 'Aberta', EM_TRANSITO: 'Em trânsito', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' };
export const STATUS_TONES = { ABERTA: 'blue', EM_TRANSITO: 'amber', CONCLUIDA: 'emerald', CANCELADA: 'red' };
const FINAL_STATUSES = ['CONCLUIDA', 'CANCELADA'];
const SIZE_OPTIONS = ['20', '40', '45'];
const TYPE_OPTIONS = ['DRY', 'HC', 'REEFER', 'OPEN TOP', 'FLAT RACK', 'TANK'];

// 'AAAA-MM-DDTHH:MM' (horário de Brasília, como foi digitado) -> 'dd/MM/aaaa HH:mm'
export function fmtLocalDateTime(value) {
  if (!value) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return value;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

// Aviso de formato ISO 6346 (4 letras + 7 números, com dígito verificador).
// Só avisa: o número é livre e a ordem salva assim mesmo.
export function containerWarning(raw) {
  const clean = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean) return null;
  if (!/^[A-Z]{4}[0-9]{7}$/.test(clean)) return 'Fora do padrão ISO 6346 (4 letras + 7 números). Dá para salvar assim mesmo.';
  const expected = calculateContainerCheckDigit(clean.slice(0, 10));
  if (expected !== Number(clean[10])) return `Dígito verificador não confere (pelo ISO 6346 seria ${expected}). Dá para salvar assim mesmo.`;
  return null;
}

function addressOf(client) {
  const a = client?.address_details;
  if (a && (a.street || a.city)) {
    const line1 = [a.street, a.number].filter(Boolean).join(', ');
    const parts = [line1, a.complement, a.neighborhood, [a.city, a.state].filter(Boolean).join('/'), a.zip ? `CEP ${a.zip}` : null];
    return parts.filter(Boolean).join(' - ');
  }
  return client?.address || '';
}

function nowLocal() {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm");
}

function emptyContainer() {
  return { container_number: '', container_size: '', container_type: '' };
}

function emptyForm() {
  return {
    operation_type: 'ENTREGA', status: 'ABERTA',
    client_id: '', client_name: '', port_terminal_id: '', port_terminal_name: '', client_address: '',
    containers: [emptyContainer()], booking: '', bl: '', freight_value: '',
    driver_id: '', driver_name: '', driver_cpf: '', truck_plate: '', trailer_plate: '', trailer_plate_2: '', rodotrem: false,
    scheduled_at: '', completed_at: '', observations: '',
  };
}

const EMPTY_FILTERS = { date_from: '', date_to: '', client_id: '', operation_type: '', status: '' };

export default function PortClientOrderPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterClientName, setFilterClientName] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [stats, setStats] = useState({ count: 0, freight_total: 0, open: 0, in_transit: 0, cancelled: 0 });
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [clients, setClients] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [nextNumber, setNextNumber] = useState(null);

  const debouncedSearch = useDebouncedValue(searchQuery.trim());

  useEffect(() => {
    (async () => {
      const results = await Promise.allSettled([
        api.getClients({ per_page: 1000 }), api.getTerminals(), api.getDrivers(), api.getVehicles({ per_page: 1000 }),
      ]);
      const data = (i) => (results[i].status === 'fulfilled' ? results[i].value.data : null);
      setClients(data(0) || []);
      setTerminals(data(1) || []);
      setDrivers(data(2) || []);
      setVehicles(data(3)?.items || []);
    })();
  }, []);

  useEffect(() => {
    loadOrders();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, debouncedSearch, filters]);

  const loadOrders = async () => {
    try {
      const params = { page: pagination.page, per_page: 15 };
      if (debouncedSearch) params.search = debouncedSearch;
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const r = await api.getPortClientOrders(params);
      setOrders(r.data.items);
      setStats(r.data.stats);
      setPagination((p) => ({ ...p, pages: r.data.pages, total: r.data.total }));
    } catch (e) {
      toast.error('Erro ao carregar as ordens');
    } finally {
      setLoading(false);
    }
  };

  const setFilter = (key) => (value) => {
    setFilters((prev) => ({ ...prev, [key]: value === '_all' ? '' : value }));
    setPagination((p) => ({ ...p, page: 1 }));
  };
  const hasFilters = !!searchQuery || Object.values(filters).some(Boolean);
  const clearFilters = () => {
    setSearchQuery('');
    setFilterClientName('');
    setFilters(EMPTY_FILTERS);
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const set = (key, value) => setForm((p) => ({ ...p, [key]: value }));

  const openNew = async () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
    try {
      const r = await api.getPortClientOrderNextNumber();
      setNextNumber(r.data.next_number);
    } catch (e) { setNextNumber(null); }
  };

  const openEdit = (order) => {
    setEditing(order);
    const base = emptyForm();
    Object.keys(base).forEach((k) => { if (order[k] !== null && order[k] !== undefined) base[k] = order[k]; });
    base.freight_value = order.freight_value ?? '';
    base.containers = (order.containers || []).length
      ? order.containers.map((c) => ({ container_number: c.container_number || '', container_size: c.container_size || '', container_type: c.container_type || '' }))
      : [emptyContainer()];
    base.rodotrem = !!order.trailer_plate_2;
    setForm(base);
    setModalOpen(true);
  };

  const onSelectClient = (c) => {
    setForm((p) => ({ ...p, client_id: c.id, client_name: c.name, client_address: addressOf(c) || p.client_address }));
  };

  const onSelectDriver = (d) => {
    setForm((p) => ({
      ...p, driver_id: d.id, driver_name: d.name, driver_cpf: d.cpf || p.driver_cpf,
      truck_plate: d.default_truck_plate ? formatPlate(d.default_truck_plate) : p.truck_plate,
      trailer_plate: d.default_trailer_plate ? formatPlate(d.default_trailer_plate) : p.trailer_plate,
    }));
  };

  const onStatusChange = (status) => {
    setForm((p) => ({ ...p, status, completed_at: status === 'CONCLUIDA' && !p.completed_at ? nowLocal() : p.completed_at }));
  };

  const handleSubmit = async () => {
    const missing = [];
    if (!form.client_name.trim()) missing.push('Cliente');
    if (!form.port_terminal_name.trim()) missing.push('Porto/Terminal');
    const filledContainers = form.containers.filter((c) => c.container_number.trim());
    if (!filledContainers.length) missing.push('ao menos 1 Container');
    if (!form.scheduled_at) missing.push('Data/hora prevista');
    if (!(Number(form.freight_value) > 0)) missing.push('Valor do Frete');
    if (missing.length) {
      toast.error(`Preencha: ${missing.join(', ')}`);
      return;
    }
    const keys = filledContainers.map((c) => c.container_number.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const repeated = keys.find((k, i) => keys.indexOf(k) !== i);
    if (repeated) {
      toast.error(`Container ${repeated} repetido na ordem`);
      return;
    }
    const { rodotrem, ...rest } = form;
    const payload = {
      ...rest,
      containers: filledContainers.map((c) => ({ ...c, container_size: c.container_size || null, container_type: c.container_type || null })),
      trailer_plate_2: rodotrem ? form.trailer_plate_2 : '',
      freight_value: Number(form.freight_value),
    };
    Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null; });
    setSaving(true);
    try {
      const r = editing
        ? await api.updatePortClientOrder(editing.id, payload)
        : await api.createPortClientOrder(payload);
      toast.success(editing ? 'Ordem atualizada' : `Ordem Nº ${r.data.order_number} criada`);
      (r.data.container_warnings || []).forEach((w) => toast.warning(w));
      setModalOpen(false);
      loadOrders();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar a ordem');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (order, status) => {
    if (status === 'CANCELADA' && !(await confirm(`Cancelar a Ordem Nº ${order.order_number}? Depois de cancelada ela não volta a ficar aberta.`))) return;
    try {
      await api.updatePortClientOrder(order.id, { status });
      toast.success(`Ordem Nº ${order.order_number}: ${STATUS_LABELS[status]}`);
      loadOrders();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao mudar o status');
    }
  };

  const handleDelete = async (order) => {
    if (!(await confirm(`Excluir a Ordem Nº ${order.order_number}?`))) return;
    try {
      await api.deletePortClientOrder(order.id);
      toast.success('Ordem excluída');
      loadOrders();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao excluir');
    }
  };

  const handlePrint = async (order) => {
    try {
      const r = await api.getPortClientOrderPDF(order.id);
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `OS_Porto_Cliente_${order.order_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Erro ao gerar o PDF');
    }
  };

  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelectedIds((prev) => {
    const ids = orders.map((o) => o.id);
    return ids.length && ids.every((id) => prev.has(id)) ? new Set() : new Set(ids);
  });
  const single = selectedIds.size === 1 ? orders.find((o) => o.id === [...selectedIds][0]) : null;
  const singleOpen = single && !FINAL_STATUSES.includes(single.status);

  const setContainer = (idx, key, value) => setForm((p) => ({
    ...p, containers: p.containers.map((c, i) => (i === idx ? { ...c, [key]: value } : c)),
  }));
  // novo container herda tamanho/tipo do anterior (o normal é a ordem levar containers iguais)
  const addContainer = () => setForm((p) => {
    const last = p.containers[p.containers.length - 1] || emptyContainer();
    return { ...p, containers: [...p.containers, { ...emptyContainer(), container_size: last.container_size, container_type: last.container_type }] };
  });
  const removeContainer = (idx) => setForm((p) => ({
    ...p, containers: p.containers.length > 1 ? p.containers.filter((_, i) => i !== idx) : [emptyContainer()],
  }));
  const isFinal = editing && FINAL_STATUSES.includes(editing.status);
  const cavalos = vehicles.filter((v) => v.vehicle_type !== 'CARRETA');
  const carretas = vehicles.filter((v) => v.vehicle_type === 'CARRETA');

  return (
    <Layout>
      <div className="space-y-4" data-testid="port-client-order-page">
        <PageHeader
          icon={Container}
          title="Ordem de Serviço - Cliente"
          subtitle="Entrega e coleta de container cheio direto entre porto e cliente, sem passar pelo terminal (não gera EIR nem movimentação de pátio)"
        />

        <StatGrid>
          <StatCard label="Ordens" value={stats.count} icon={Container} tone="blue" hint={hasFilters ? 'com os filtros atuais' : 'registradas'} testId="pco-kpi-count" />
          <StatCard label="Valor do frete" value={fmtMoney(stats.freight_total)} icon={Wallet} tone="emerald" hint="sem as canceladas" testId="pco-kpi-freight" />
          <StatCard label="Abertas" value={stats.open} icon={Clock} tone="primary" />
          <StatCard label="Em trânsito" value={stats.in_transit} icon={Truck} tone="amber" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={clearFilters}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Nº, container, motorista, placa, booking" className="col-span-2 lg:col-span-1">
              <SearchInput value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} data-testid="pco-search" />
            </FilterField>
            <FilterField label="Prevista de">
              <Input type="date" className="h-9 text-sm" value={filters.date_from} onChange={(e) => setFilter('date_from')(e.target.value)} data-testid="pco-date-from" />
            </FilterField>
            <FilterField label="Até">
              <Input type="date" className="h-9 text-sm" value={filters.date_to} onChange={(e) => setFilter('date_to')(e.target.value)} data-testid="pco-date-to" />
            </FilterField>
            <FilterField label="Cliente">
              <Autocomplete
                value={filterClientName}
                onChange={(v) => { setFilterClientName(v); if (!v) setFilter('client_id')(''); }}
                onSelect={(c) => { setFilterClientName(c.name); setFilter('client_id')(c.id); }}
                options={clients}
                displayField="name"
                className="h-9 text-sm"
                testId="pco-filter-client"
              />
            </FilterField>
            <FilterField label="Operação">
              <Select value={filters.operation_type || '_all'} onValueChange={setFilter('operation_type')}>
                <SelectTrigger className="h-9 text-sm" data-testid="pco-filter-operation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  <SelectItem value="ENTREGA">Entrega</SelectItem>
                  <SelectItem value="COLETA">Coleta</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Status">
              <Select value={filters.status || '_all'} onValueChange={setFilter('status')}>
                <SelectTrigger className="h-9 text-sm" data-testid="pco-filter-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Ordens de Serviço - Cliente"
          count={pagination.total}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova ordem" onClick={openNew} testId="pco-new" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && openEdit(single)} disabled={!single} testId="pco-edit" />
              <ToolbarButton icon={Truck} label="Em trânsito" tone="amber" onClick={() => single && changeStatus(single, 'EM_TRANSITO')} disabled={!singleOpen || single?.status === 'EM_TRANSITO'} testId="pco-transit" />
              <ToolbarButton icon={CheckCircle2} label="Concluir" tone="emerald" onClick={() => single && changeStatus(single, 'CONCLUIDA')} disabled={!singleOpen} testId="pco-complete" />
              <ToolbarButton icon={XCircle} label="Cancelar" tone="red" onClick={() => single && changeStatus(single, 'CANCELADA')} disabled={!singleOpen} testId="pco-cancel" />
              <ToolbarButton icon={Printer} label="Imprimir" tone="primary" onClick={() => single && handlePrint(single)} disabled={!single} testId="pco-print" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => single && handleDelete(single)} disabled={!single} testId="pco-delete" />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              pageSize={15}
              onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            />
          )}
        >
          {loading ? (
            <EmptyState loading />
          ) : orders.length === 0 ? (
            <EmptyState icon={Container} title="Nenhuma ordem encontrada" hint={hasFilters ? 'Ajuste os filtros' : 'Crie a primeira pelo botão "Nova ordem"'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table" data-testid="pco-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0"><Checkbox checked={orders.length > 0 && orders.every((o) => selectedIds.has(o.id))} onCheckedChange={toggleAll} /></th>
                    <th>Nº</th>
                    <th>Prevista</th>
                    <th>Operação</th>
                    <th>Cliente</th>
                    <th>Porto/Terminal</th>
                    <th>Containers</th>
                    <th>Motorista / Placa</th>
                    <th>Status</th>
                    <th className="!text-right">Frete</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const selected = selectedIds.has(o.id);
                    return (
                      <tr key={o.id} data-selected={selected} className="cursor-pointer" onClick={() => toggleSelect(o.id)} onDoubleClick={() => openEdit(o)}>
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}><Checkbox checked={selected} onCheckedChange={() => toggleSelect(o.id)} /></td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{o.order_number}</td>
                        <td className="whitespace-nowrap tabular-nums">{fmtLocalDateTime(o.scheduled_at)}</td>
                        <td>
                          <StatusPill tone={o.operation_type === 'COLETA' ? 'violet' : 'primary'} dot={false}>{OPERATION_SHORT[o.operation_type]}</StatusPill>
                        </td>
                        <td><div className="max-w-[10.625rem] truncate" title={o.client_name || ''}>{o.client_name}</div></td>
                        <td><div className="max-w-[8.125rem] truncate" title={o.port_terminal_name || ''}>{o.port_terminal_name}</div></td>
                        <td className="whitespace-nowrap font-mono" data-testid="pco-row-containers">
                          {(o.containers || []).slice(0, 2).map((c) => (
                            <div key={c.container_number} className="flex items-center gap-1" title={c.warning || ''}>
                              {c.container_number}
                              {c.warning && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                            </div>
                          ))}
                          {(o.containers || []).length > 2 && (
                            <span className="text-xs text-slate-500 font-sans" title={o.containers.slice(2).map((c) => c.container_number).join(', ')}>
                              + {o.containers.length - 2} container(s)
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="max-w-[10.625rem] truncate" title={o.driver_name || ''}>{o.driver_name || '-'}</div>
                          {o.truck_plate && <div className="mt-0.5"><PlateTag>{o.truck_plate}</PlateTag></div>}
                        </td>
                        <td><StatusPill tone={STATUS_TONES[o.status]}>{STATUS_LABELS[o.status]}</StatusPill></td>
                        <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtMoney(o.freight_value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="pco-form">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Container className="w-4 h-4 text-primary" />
              {editing ? `Editar Ordem Nº ${editing.order_number}` : `Nova Ordem${nextNumber ? ` Nº ${nextNumber}` : ''}`}
              <span className="text-xs font-normal text-slate-500">· direto porto x cliente (sem EIR)</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="mb-1.5 block">Tipo de operação *</Label>
                <Select value={form.operation_type} onValueChange={(v) => set('operation_type', v)}>
                  <SelectTrigger className="h-9" data-testid="pco-operation"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(OPERATION_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Status</Label>
                <Select value={form.status} onValueChange={onStatusChange} disabled={isFinal}>
                  <SelectTrigger className="h-9" data-testid="pco-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Valor do Frete (R$) *</Label>
                <Input type="number" step="0.01" min="0" className="h-9 font-mono" value={form.freight_value}
                  onChange={(e) => set('freight_value', e.target.value)} data-testid="pco-freight" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Cliente *</Label>
                <Autocomplete
                  value={form.client_name}
                  onChange={(v) => setForm((p) => ({ ...p, client_name: v, client_id: '' }))}
                  onSelect={onSelectClient}
                  options={clients}
                  displayField="name"
                  testId="pco-client"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">{`Porto/Terminal portuário de ${form.operation_type === 'COLETA' ? 'destino' : 'origem'} *`}</Label>
                <Autocomplete
                  value={form.port_terminal_name}
                  onChange={(v) => setForm((p) => ({ ...p, port_terminal_name: v, port_terminal_id: '' }))}
                  onSelect={(t) => setForm((p) => ({ ...p, port_terminal_id: t.id, port_terminal_name: t.name }))}
                  options={terminals}
                  displayField="name"
                  testId="pco-terminal"
                />
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Endereço do cliente para {form.operation_type === 'COLETA' ? 'coleta' : 'entrega'}</Label>
              <Input className="h-9" value={form.client_address} onChange={(e) => set('client_address', e.target.value)} data-testid="pco-address" />
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-testid="pco-containers">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-2"><Label>Containers *</Label><span className="text-xs text-slate-500">condição: Cheio</span></div>
                <span className="text-xs text-slate-500">{form.containers.filter((c) => c.container_number.trim()).length} container(s)</span>
              </div>
              {form.containers.map((c, idx) => {
                const warning = containerWarning(c.container_number);
                return (
                  <div key={idx} data-testid={`pco-container-row-${idx}`}>
                    <div className="grid grid-cols-[1.5rem_1fr_6rem_8rem_2rem] gap-2 items-center">
                      <span className="text-xs text-slate-400 tabular-nums text-right">{idx + 1}.</span>
                      <Input className="h-9 font-mono uppercase" value={c.container_number} placeholder="ABCU1234567"
                        onChange={(e) => setContainer(idx, 'container_number', e.target.value.toUpperCase())}
                        data-testid={`pco-container-${idx}`} aria-label={`Nº do container ${idx + 1}`} />
                      <Select value={c.container_size || '_empty'} onValueChange={(v) => setContainer(idx, 'container_size', v === '_empty' ? '' : v)}>
                        <SelectTrigger className="h-9" aria-label="Tamanho"><SelectValue placeholder="Tam." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_empty">Tam.</SelectItem>
                          {SIZE_OPTIONS.map((sz) => <SelectItem key={sz} value={sz}>{sz}'</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={c.container_type || '_empty'} onValueChange={(v) => setContainer(idx, 'container_type', v === '_empty' ? '' : v)}>
                        <SelectTrigger className="h-9" aria-label="Tipo"><SelectValue placeholder="Tipo" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_empty">Tipo</SelectItem>
                          {TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600"
                        onClick={() => removeContainer(idx)} title="Remover container" data-testid={`pco-container-remove-${idx}`}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    {warning && (
                      <p className="mt-1 ml-8 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1" data-testid={`pco-container-warning-${idx}`}>
                        <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {warning}
                      </p>
                    )}
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={addContainer} data-testid="pco-add-container">
                <Plus className="w-4 h-4" /> Adicionar container
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Booking</Label>
                <Input className="h-9 uppercase" value={form.booking} onChange={(e) => set('booking', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">BL</Label>
                <Input className="h-9 uppercase" value={form.bl} onChange={(e) => set('bl', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="mb-1.5 block">Motorista</Label>
                <Autocomplete
                  value={form.driver_name}
                  onChange={(v) => setForm((p) => ({ ...p, driver_name: v, driver_id: '' }))}
                  onSelect={onSelectDriver}
                  options={drivers}
                  displayField="name"
                  testId="pco-driver"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Placa do Cavalo</Label>
                <Autocomplete
                  value={form.truck_plate}
                  onChange={(v) => set('truck_plate', formatPlate(v))}
                  onSelect={(v) => set('truck_plate', formatPlate(v.plate))}
                  options={cavalos}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  className="font-mono"
                  testId="pco-truck"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Placa da Carreta</Label>
                <Autocomplete
                  value={form.trailer_plate}
                  onChange={(v) => set('trailer_plate', formatPlate(v))}
                  onSelect={(v) => set('trailer_plate', formatPlate(v.plate))}
                  options={carretas}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  className="font-mono"
                  testId="pco-trailer"
                />
                <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <Checkbox checked={form.rodotrem} onCheckedChange={(v) => set('rodotrem', !!v)} data-testid="pco-rodotrem" />
                  Rodotrem (2ª carreta)
                </label>
              </div>
              {form.rodotrem && (
                <div className="md:col-start-3">
                  <Label className="mb-1.5 block">Placa da 2ª Carreta</Label>
                  <Autocomplete
                    value={form.trailer_plate_2}
                    onChange={(v) => set('trailer_plate_2', formatPlate(v))}
                    onSelect={(v) => set('trailer_plate_2', formatPlate(v.plate))}
                    options={carretas}
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    className="font-mono"
                    testId="pco-trailer-2"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Data/hora prevista *</Label>
                <Input type="datetime-local" className="h-9" value={form.scheduled_at} onChange={(e) => set('scheduled_at', e.target.value)} data-testid="pco-scheduled" />
              </div>
              <div>
                <Label className="mb-1.5 block">Data/hora realizada</Label>
                <Input type="datetime-local" className="h-9" value={form.completed_at} onChange={(e) => set('completed_at', e.target.value)} data-testid="pco-completed" />
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Observações</Label>
              <Textarea rows={3} value={form.observations} onChange={(e) => set('observations', e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Fechar</Button>
            <Button onClick={handleSubmit} disabled={saving} data-testid="pco-save">
              {saving ? 'Salvando...' : (editing ? 'Salvar alterações' : 'Criar ordem')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
