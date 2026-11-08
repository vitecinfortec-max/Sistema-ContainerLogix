import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton } from '../components/DataPage';
import { Field, FormSection, FormActions } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete, OptionAutocomplete } from '../components/Autocomplete';
import { QuickAddButton } from '../components/QuickCreate';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { PackageCheck, Plus, Trash2, Save, Download, CalendarClock, MapPin, Route as RouteIcon, UserRound, Container, Truck } from 'lucide-react';
import { formatContainerNumber } from '../lib/containerNumber';
import { formatPlate } from '../lib/masks';
import { apiErrorMessage } from '../lib/errors';
import { ORDER_TYPE_OPTIONS, STATUS_OPTIONS, downloadLoadingOrderPdf } from '../lib/loadingOrders';

const SIZE_TYPE_OPTIONS = [
  ['20DC', '20DC'], ['20RF', '20RF'], ['20OT', '20OT'], ['20FR', '20FR'],
  ['40HC', '40HC'], ['40RF', '40RF'], ['40OT', '40OT'], ['40FR', '40FR'], ['40DRY', '40DRY'],
];

const CONTAINER_STATUS_OPTIONS = [
  ['CHEIO', 'Cheio'],
  ['VAZIO', 'Vazio'],
];

const formatMoney = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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

// Nova ordem (/loading-orders/new) e edição (/loading-orders/:id/edit)
export default function LoadingOrderFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const backToList = () => navigate('/loading-orders');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [orderNumber, setOrderNumber] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [drivers, setDrivers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const [freightRoutes, setFreightRoutes] = useState([]);
  const [clients, setClients] = useState([]);
  const [nextBookingPreview, setNextBookingPreview] = useState(null);
  const [representatives, setRepresentatives] = useState([]);

  useEffect(() => {
    // Listas de apoio: uma que falhe não impede as outras nem o formulário
    const load = (request, setter, pick = (r) => r.data || []) => request().then((r) => setter(pick(r))).catch(() => {});
    load(() => api.getDrivers(), setDrivers);
    load(() => api.getCompanies(), setCompanies, (r) => r.data?.items || r.data || []);
    load(() => api.getVehicles({ per_page: 1000 }), setVehicles, (r) => r.data?.items || r.data || []);
    load(() => api.getShippingLines(), setShippingLines);
    load(() => api.getTerminals(), setTerminals);
    load(() => api.getFreightRoutes(), setFreightRoutes);
    load(() => api.getClients(), setClients);
    load(() => api.getContainerRepresentatives(), setRepresentatives);
    load(() => api.getNextAutoBookingNumber(), setNextBookingPreview, (r) => r.data?.next_booking || null);

    if (!isEdit) {
      api.getLoadingOrderNextNumber()
        .then((r) => setOrderNumber(r.data?.next_number || 1))
        .catch(() => setOrderNumber(null));
      return;
    }
    api.getLoadingOrder(id)
      .then(({ data: d }) => {
        setOrderNumber(d.order_number);
        setForm({ ...buildEmpty(), ...d, items: (d.items && d.items.length) ? d.items : [emptyItem()] });
      })
      .catch((e) => {
        toast.error(apiErrorMessage(e, 'Erro ao carregar ordem de carregamento'));
        backToList();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  // Cadastro rápido (o "+" ao lado do campo): entra na lista e já fica
  // selecionado no formulário
  const appendTo = (setter) => (record) => setter((prev) => [...prev, record]);
  const onRouteCreated = (route) => {
    appendTo(setFreightRoutes)(route);
    setForm((p) => ({ ...p, route_id: route.id, route_name: `${route.origin} x ${route.destination}`, freight_value: route.freight_value }));
  };
  const onVehicleCreated = (field) => (vehicle) => {
    appendTo(setVehicles)(vehicle);
    onChange(field, vehicle.plate);
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
      if (isEdit) {
        const response = await api.updateLoadingOrder(id, payload);
        (response.data?.movement_notes || []).forEach((note) => toast.info(note));
        toast.success('Ordem de Carregamento atualizada!');
      } else {
        await api.createLoadingOrder(payload);
        toast.success('Ordem de Carregamento criada!');
      }
      backToList();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao salvar ordem de carregamento'));
    } finally { setSaving(false); }
  };

  const routeOptions = freightRoutes
    .filter((r) => r.status === 'ATIVO' || r.id === form.route_id)
    .map((r) => [r.id, `${r.origin} x ${r.destination}`]);
  const plateLabel = (v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4" data-testid="loading-order-form-page">
        <PageHeader
          backTo={backToList}
          icon={PackageCheck}
          title={isEdit ? 'Editar ordem de carregamento' : 'Nova ordem de carregamento'}
          subtitle={orderNumber !== null ? `Ordem Nº ${orderNumber}` : 'Minuta de coleta ou entrega de container pro motorista'}
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            <FormSection title="Agendamento e controle" icon={CalendarClock}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Tipo" required>
                  <OptionSelect value={form.order_type} onChange={onChangeOrderType} options={ORDER_TYPE_OPTIONS} testid="loading-order-type" />
                </Field>
                <Field label="Status">
                  <OptionSelect value={form.status} onChange={(v) => onChange('status', v)} options={STATUS_OPTIONS} testid="loading-order-status" />
                </Field>
                <WindowField value={form.collection_window} onChange={(v) => onChange('collection_window', v)} />
              </div>
            </FormSection>

            <FormSection title="Origem e destino" icon={MapPin}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Terminal de origem">
                  <div className="flex gap-1.5">
                    <div className="flex-1 min-w-0">
                      <Autocomplete
                        value={form.origin_terminal}
                        onChange={(v) => onChange('origin_terminal', v)}
                        onSelect={(t) => onChange('origin_terminal', t.name)}
                        options={terminals}
                        displayField="name"
                        className="text-sm"
                      />
                    </div>
                    <QuickAddButton kind="terminal" initial={{ name: form.origin_terminal }}
                      onCreated={(t) => { appendTo(setTerminals)(t); onChange('origin_terminal', t.name); }} />
                  </div>
                </Field>
                <Field label="Destino">
                  <Input value={form.port ?? ''} onChange={(e) => onChange('port', e.target.value)} className="h-9 text-sm" data-testid="loading-order-port" />
                </Field>
              </div>
            </FormSection>

            {form.order_type === 'COLETA' && (
              <FormSection title="Rota e frete" icon={RouteIcon}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field
                    label="Rota"
                    hint={freightRoutes.length === 0
                      ? (isAdmin ? 'Nenhuma rota cadastrada. Use o + para cadastrar.' : 'Nenhuma rota cadastrada. Peça ao administrador para cadastrar em "Transporte > Rota".')
                      : undefined}
                  >
                    <div className="flex gap-1.5">
                      <div className="flex-1 min-w-0">
                        <OptionAutocomplete value={form.route_id} onChange={onSelectRoute} options={routeOptions} className="text-sm" testId="loading-order-route" />
                      </div>
                      {isAdmin && <QuickAddButton kind="route" onCreated={onRouteCreated} />}
                    </div>
                  </Field>
                  <Field label="Valor do frete" hint="Preenchido automaticamente pela Rota selecionada">
                    <Input
                      disabled
                      value={form.route_id ? formatMoney(form.freight_value) : '-'}
                      className="h-9 text-sm bg-slate-50 dark:bg-slate-800"
                      data-testid="loading-order-freight-value"
                    />
                  </Field>
                </div>
              </FormSection>
            )}

            {form.order_type === 'ENTREGA' && (
              <FormSection title="Representante" icon={UserRound}>
                <Field
                  label="Representante"
                  className="max-w-xl"
                  hint={representatives.length === 0 ? 'Nenhum representante cadastrado. Use o + para cadastrar.' : undefined}
                >
                  <div className="flex gap-1.5">
                    <div className="flex-1 min-w-0">
                      <Autocomplete
                        value={form.representative_name}
                        onChange={(v) => setForm((p) => ({ ...p, representative_name: v, representative_id: '' }))}
                        onSelect={(r) => setForm((p) => ({ ...p, representative_id: r.id, representative_name: r.name }))}
                        options={representatives.filter((r) => r.status !== 'INATIVO')}
                        displayField="name"
                        className="text-sm"
                      />
                    </div>
                    <QuickAddButton kind="representative" initial={{ name: form.representative_name }}
                      onCreated={(r) => { appendTo(setRepresentatives)(r); setForm((p) => ({ ...p, representative_id: r.id, representative_name: r.name })); }} />
                  </div>
                </Field>
              </FormSection>
            )}

            <FormSection
              title="Container e carga"
              icon={Container}
              actions={(
                <Button variant="outline" size="sm" onClick={addContainerItem} type="button" className="h-8 text-xs" data-testid="loading-order-add-item">
                  <Plus className="w-3.5 h-3.5 mr-1" />Adicionar container
                </Button>
              )}
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {form.order_type === 'ENTREGA' && nextBookingPreview ? (
                  <Field label="Booking/Ref." hint={form.booking ? 'Gerado automaticamente' : 'Será gerado automaticamente ao salvar'}>
                    <Input
                      disabled
                      value={form.booking || nextBookingPreview}
                      className="h-9 text-sm bg-slate-50 dark:bg-slate-800"
                      data-testid="loading-order-booking"
                    />
                  </Field>
                ) : (
                  <Field label="Booking/Ref.">
                    <Input value={form.booking ?? ''} onChange={(e) => onChange('booking', e.target.value)} className="h-9 text-sm" data-testid="loading-order-booking" />
                  </Field>
                )}
                <Field label="Cliente" className="sm:col-span-2">
                  <div className="flex gap-1.5">
                    <div className="flex-1 min-w-0">
                      <Autocomplete
                        value={form.client_name}
                        onChange={(v) => onChange('client_name', v)}
                        onSelect={(c) => onChange('client_name', c.name)}
                        options={clients}
                        displayField="name"
                        className="text-sm"
                      />
                    </div>
                    <QuickAddButton kind="client" initial={{ name: form.client_name }}
                      onCreated={(c) => { appendTo(setClients)(c); onChange('client_name', c.name); }} />
                  </div>
                </Field>
              </div>

              <div className="space-y-2">
                {form.items.map((it, idx) => (
                  <div key={idx} className="flex flex-col gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="grid grid-cols-2 sm:grid-cols-12 gap-3 items-end">
                      <Field label="Container" required className="col-span-1 sm:col-span-3">
                        <Input
                          value={it.container_number}
                          onChange={(e) => updateContainerItem(idx, 'container_number', e.target.value.toUpperCase())}
                          onBlur={(e) => handleItemContainerBlur(idx, e)}
                          className="h-9 text-sm font-mono"
                          data-testid={`loading-order-item-container-${idx}`}
                        />
                      </Field>
                      <Field label="Status" className="sm:col-span-2">
                        <Select value={it.status || 'CHEIO'} onValueChange={(v) => updateContainerItem(idx, 'status', v)}>
                          <SelectTrigger className="h-9 text-sm" data-testid={`loading-order-item-status-${idx}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CONTAINER_STATUS_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Tipo/Tamanho" className="col-span-1 sm:col-span-3">
                        <Select value={it.size_type || '_empty'} onValueChange={(v) => updateContainerItem(idx, 'size_type', v === '_empty' ? '' : v)}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_empty">-</SelectItem>
                            {SIZE_TYPE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Armador" className="col-span-2 sm:col-span-4">
                        <div className="flex gap-1.5">
                          <Select value={it.shipping_line || '_empty'} onValueChange={(v) => updateContainerItem(idx, 'shipping_line', v === '_empty' ? '' : v)}>
                            <SelectTrigger className="h-9 text-sm flex-1 min-w-0" data-testid={`loading-order-item-line-${idx}`}><SelectValue /></SelectTrigger>
                            <SelectContent className="max-h-80 overflow-y-auto">
                              <SelectItem value="_empty">-</SelectItem>
                              {it.shipping_line && !shippingLines.some((l) => l.name === it.shipping_line) && (
                                <SelectItem value={it.shipping_line}>{it.shipping_line}</SelectItem>
                              )}
                              {shippingLines.map((line) => <SelectItem key={line.id} value={line.name}>{line.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <QuickAddButton kind="shipping_line" size="sm" testId={`quick-add-shipping-line-${idx}`}
                            onCreated={(line) => { appendTo(setShippingLines)(line); updateContainerItem(idx, 'shipping_line', line.name); }} />
                        </div>
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-12 gap-3 items-end">
                      <Field label="Peso bruto" className="col-span-1 sm:col-span-3">
                        <Input value={it.gross_weight} onChange={(e) => updateContainerItem(idx, 'gross_weight', e.target.value)} className="h-9 text-sm" />
                      </Field>
                      <Field label="Lacre" className="col-span-1 sm:col-span-3">
                        <Input value={it.seal} onChange={(e) => updateContainerItem(idx, 'seal', e.target.value)} className="h-9 text-sm" />
                      </Field>
                      <div className="hidden sm:block sm:col-span-4" />
                      <div className="col-span-2 sm:col-span-2 flex justify-end">
                        <Button title="Tirar container" aria-label="Tirar container"
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeContainerItem(idx)}
                          disabled={form.items.length <= 1}
                          className="h-9 px-2 text-destructive hover:text-red-700 disabled:opacity-30"
                          data-testid={`loading-order-item-remove-${idx}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {shippingLines.length === 0 && (
                <p className="text-xs text-amber-600">Nenhum armador cadastrado. Use o + ao lado do campo Armador para cadastrar.</p>
              )}
            </FormSection>

            <FormSection title="Transporte (transportador e motorista)" icon={Truck}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Motorista" required>
                  <div className="flex gap-1.5">
                    <div className="flex-1 min-w-0">
                      <Autocomplete
                        value={form.driver_name}
                        onChange={(v) => onChange('driver_name', v)}
                        onSelect={onSelectDriver}
                        options={drivers}
                        displayField="name"
                        className="text-sm"
                        testId="loading-order-driver"
                      />
                    </div>
                    <QuickAddButton kind="driver" initial={{ name: form.driver_name, cpf: form.driver_cpf }}
                      onCreated={(d) => { appendTo(setDrivers)(d); onSelectDriver(d); }} />
                  </div>
                </Field>
                <Field label="CPF">
                  <Input value={form.driver_cpf ?? ''} onChange={(e) => onChange('driver_cpf', e.target.value)} className="h-9 text-sm" data-testid="loading-order-cpf" />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Transportadora contratada">
                  <div className="flex gap-1.5">
                    <div className="flex-1 min-w-0">
                      <Autocomplete
                        value={form.transport_company}
                        onChange={(v) => onChange('transport_company', v)}
                        options={companies}
                        displayField="name"
                        className="text-sm"
                      />
                    </div>
                    <QuickAddButton kind="company" initial={{ name: form.transport_company }}
                      onCreated={(c) => { appendTo(setCompanies)(c); onChange('transport_company', c.name); }} />
                  </div>
                </Field>
                <Field label="Placa do cavalo">
                  <div className="flex gap-1.5">
                    <div className="flex-1 min-w-0">
                      <Autocomplete
                        value={form.truck_plate}
                        onChange={(v) => onChange('truck_plate', formatPlate(v))}
                        onSelect={(v) => onChange('truck_plate', formatPlate(v.plate))}
                        options={vehicles}
                        displayField={plateLabel}
                        className="text-sm font-mono"
                      />
                    </div>
                    <QuickAddButton kind="vehicle" testId="quick-add-truck-plate" initial={{ plate: form.truck_plate, vehicle_type: 'CAVALO' }}
                      onCreated={onVehicleCreated('truck_plate')} />
                  </div>
                </Field>
                <Field label="Placa da carreta">
                  <div className="flex gap-1.5">
                    <div className="flex-1 min-w-0">
                      <Autocomplete
                        value={form.trailer_plate}
                        onChange={(v) => onChange('trailer_plate', formatPlate(v))}
                        onSelect={(v) => onChange('trailer_plate', formatPlate(v.plate))}
                        options={vehicles}
                        displayField={plateLabel}
                        className="text-sm font-mono"
                      />
                    </div>
                    <QuickAddButton kind="vehicle" testId="quick-add-trailer-plate" initial={{ plate: form.trailer_plate, vehicle_type: 'CARRETA' }}
                      onCreated={onVehicleCreated('trailer_plate')} />
                  </div>
                </Field>
              </div>
            </FormSection>

            <FormSection title="Observações">
              <Textarea
                rows={3}
                aria-label="Observações"
                value={form.observations ?? ''}
                onChange={(e) => onChange('observations', e.target.value)}
                className="text-sm"
                data-testid="loading-order-observations"
              />
            </FormSection>

            <FormActions sticky>
              {isEdit && (
                <Button type="button" variant="outline" onClick={() => downloadLoadingOrderPdf(id, orderNumber)} data-testid="loading-order-print" title="Baixar PDF">
                  <Download className="w-4 h-4 mr-2" />Imprimir
                </Button>
              )}
              <Button type="button" variant="outline" onClick={backToList} data-testid="loading-order-cancel">Cancelar</Button>
              <Button type="button" onClick={handleSave} disabled={saving} data-testid="loading-order-save">
                <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Salvar ordem'}
              </Button>
            </FormActions>
          </div>
        )}
      </div>
    </Layout>
  );
}

function OptionSelect({ value, onChange, options, testid }) {
  return (
    <Select value={value || '_empty'} onValueChange={(v) => onChange(v === '_empty' ? '' : v)}>
      <SelectTrigger className="h-9 text-sm" data-testid={testid}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v || '_empty'} value={v || '_empty'} className="text-sm">{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WindowField({ value, onChange }) {
  const [start, end] = (value || '').split(' - ').map((s) => s.trim());
  return (
    <Field label="Janela">
      <div className="flex items-center gap-1.5">
        <Input
          type="time"
          aria-label="Janela: início"
          value={start || ''}
          onChange={(e) => onChange(`${e.target.value}${end ? ' - ' + end : ''}`)}
          className="h-9 text-sm"
          data-testid="loading-order-window-start"
        />
        <span className="text-xs text-muted-foreground shrink-0">até</span>
        <Input
          type="time"
          aria-label="Janela: fim"
          value={end || ''}
          onChange={(e) => onChange(`${start || ''} - ${e.target.value}`)}
          className="h-9 text-sm"
          data-testid="loading-order-window-end"
        />
      </div>
    </Field>
  );
}
