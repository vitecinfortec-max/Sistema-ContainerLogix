import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, PlateTag, EmptyState,
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
import { CityStateFields } from '../components/AddressFields';
import { api } from '../lib/api';
import { sanitizeKmInput } from '../lib/utils';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Save, Fuel, Droplet, Wallet, Gauge } from 'lucide-react';

const SOURCE_OPTIONS = [
  ['POSTO_EXTERNO', 'Posto Externo'],
  ['TANQUE_PROPRIO', 'Tanque Próprio'],
];

const FUEL_TYPE_OPTIONS = [
  ['DIESEL_S10', 'Diesel S10'],
  ['DIESEL_S500', 'Diesel S500'],
  ['GASOLINA_COMUM', 'Gasolina Comum'],
  ['GASOLINA_ADITIVADA', 'Gasolina Aditivada'],
  ['ETANOL', 'Etanol'],
  ['ARLA_32', 'Arla 32'],
  ['GNV', 'GNV'],
  ['OUTRO', 'Outro'],
];

const DOCUMENT_TYPE_OPTIONS = [
  ['NF', 'Nota Fiscal'],
  ['CUPOM_FISCAL', 'Cupom Fiscal'],
  ['RECIBO', 'Recibo'],
  ['OUTRO', 'Outro'],
];

const PAYMENT_TYPE_OPTIONS = [
  ['PAGO_MOTORISTA', 'Pago pelo Motorista'],
  ['PROGRAMAR_PAGAMENTO', 'Programar Pagamento'],
  ['JA_PROGRAMADO', 'Já Programado'],
  ['SEM_PROGRAMACAO', 'Sem Programação'],
];

const FUEL_TYPE_LABELS = FUEL_TYPE_OPTIONS.reduce((acc, [v, l]) => { acc[v] = l; return acc; }, {});

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtLitersTotal = (v) => `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;

function buildEmpty() {
  return {
    supply_order: '', fuel_supply_order_id: '',
    equipment_id: '', equipment_plate: '',
    driver_id: '', driver_name: '',
    supply_date: new Date().toISOString().split('T')[0],
    entry_date: new Date().toISOString().split('T')[0],
    reading: '',
    supplier_id: '', supplier_name: '',
    city: '', state: '',
    source: 'POSTO_EXTERNO',
    fuel_type: '',
    liters: '', unit_price: '', gross_value: '', discounts: 0, additions: 0,
    full_tank: true,
    has_other_expenses: false, other_expenses_value: '', other_expenses_description: '',
    payment_type: 'PAGO_MOTORISTA',
    document_type: '', document_number: '', allocation: '',
    observations: '',
    linked_to_batch: false, define_company: false,
  };
}

export default function FuelSupplyPage() {
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
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [fuelOrders, setFuelOrders] = useState([]);
  const debounceRef = useRef(null);

  useEffect(() => { loadList(); loadVehicles(); loadDrivers(); loadSuppliers(); loadFuelOrders(); }, []);

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
      const r = await api.getFuelSupplies(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar abastecimentos');
    } finally {
      setLoading(false);
    }
  };

  const loadVehicles = async () => {
    try {
      const r = await api.getVehicles({ per_page: 1000 });
      setVehicles(r.data?.items || r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadDrivers = async () => {
    try {
      const r = await api.getDrivers();
      setDrivers(r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadSuppliers = async () => {
    try {
      const r = await api.getSuppliers();
      setSuppliers(r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadFuelOrders = async () => {
    try {
      const r = await api.getFuelSupplyOrders();
      setFuelOrders((r.data || []).filter((o) => !o.is_launched));
    } catch (e) { /* ignore */ }
  };

  // Ao selecionar uma Ordem de Abastecimento já cadastrada, puxa os dados que
  // ela já tem (equipamento, fornecedor, combustível) pro Abastecimento atual.
  const onSelectFuelOrder = (order) => {
    setForm((p) => ({
      ...p,
      supply_order: `Nº ${order.order_number}`,
      fuel_supply_order_id: order.id,
      equipment_plate: order.equipment_plate || p.equipment_plate,
      equipment_id: order.equipment_id || p.equipment_id,
      supplier_name: order.supplier_name || p.supplier_name,
      supplier_id: order.supplier_id || p.supplier_id,
      fuel_type: order.fuel_type || p.fuel_type,
    }));
    toast.success('Dados da Ordem de Abastecimento preenchidos automaticamente');
  };

  const reset = () => setForm(buildEmpty());

  const openCreate = async () => {
    reset();
    setEditingId(null);
    try {
      const r = await api.getFuelSupplyNextNumber();
      setNextNumber(r.data?.next_number || 1);
    } catch (e) { setNextNumber(null); }
    setDialogOpen(true);
  };

  const openEdit = async (id) => {
    try {
      const r = await api.getFuelSupply(id);
      const d = r.data;
      setEditingId(id);
      setNextNumber(d.supply_number);
      setForm({ ...buildEmpty(), ...d });
      setDialogOpen(true);
    } catch (e) { toast.error('Erro ao carregar abastecimento'); }
  };

  const onChange = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  // Recalcula Valor Bruto automaticamente quando litros/valor unitário mudam,
  // mas continua editável manualmente (ex: se o fornecedor já cobra um valor
  // fechado diferente de litros × unitário).
  const onLitersOrPriceChange = (field, val) => {
    setForm((p) => {
      const next = { ...p, [field]: val };
      const liters = Number(field === 'liters' ? val : p.liters) || 0;
      const unitPrice = Number(field === 'unit_price' ? val : p.unit_price) || 0;
      next.gross_value = liters && unitPrice ? Number((liters * unitPrice).toFixed(2)) : next.gross_value;
      return next;
    });
  };

  const netValue = (() => {
    const gross = Number(form.gross_value || 0);
    const discounts = Number(form.discounts || 0);
    const additions = Number(form.additions || 0);
    return gross - discounts + additions;
  })();

  const totalValue = netValue + (form.has_other_expenses ? Number(form.other_expenses_value || 0) : 0);

  const handleSave = async () => {
    if (!form.equipment_plate || !form.supply_date || !form.entry_date || form.reading === '' || !form.supplier_name || !form.fuel_type || !form.liters || !form.unit_price || !form.gross_value) {
      toast.error('Preencha os campos obrigatórios (Equipamento, Datas, Leitura, Fornecedor, Combustível, Litros, Valor Unitário e Valor Bruto)');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        reading: Number(form.reading || 0),
        liters: Number(form.liters || 0),
        unit_price: Number(form.unit_price || 0),
        gross_value: Number(form.gross_value || 0),
        discounts: Number(form.discounts || 0),
        additions: Number(form.additions || 0),
        other_expenses_value: form.has_other_expenses ? Number(form.other_expenses_value || 0) : 0,
      };
      if (editingId) {
        await api.updateFuelSupply(editingId, payload);
        toast.success('Abastecimento atualizado!');
      } else {
        await api.createFuelSupply(payload);
        toast.success('Abastecimento criado!');
      }
      setDialogOpen(false);
      loadList();
      loadFuelOrders();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar abastecimento');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id, num) => {
    if (!(await confirm(`Excluir Abastecimento Nº ${num}?`))) return;
    try {
      await api.deleteFuelSupply(id);
      toast.success('Abastecimento excluído');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadList();
      loadFuelOrders();
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
    const pageIds = list.map((f) => f.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const singleSelectedSupply = selectedIds.size === 1 ? list.find((f) => f.id === [...selectedIds][0]) : null;
  const listLiters = list.reduce((acc, f) => acc + Number(f.liters || 0), 0);
  const listValue = list.reduce((acc, f) => acc + Number(f.total_value || 0), 0);

  return (
    <Layout>
      <div className="space-y-4" data-testid="fuel-supply-page">
        <PageHeader
          title="Abastecimento"
          subtitle="Controle de abastecimento de combustível e ARLA da frota"
          icon={Fuel}
        />

        <StatGrid>
          <StatCard label="Abastecimentos" value={list.length} icon={Fuel} tone="blue" hint={search ? 'que batem com a busca' : 'registrados'} />
          <StatCard label="Litros" value={fmtLitersTotal(listLiters)} icon={Droplet} tone="primary" />
          <StatCard label="Valor total" value={fmtMoney(listValue)} icon={Wallet} tone="emerald" />
          <StatCard label="Preço médio/litro" value={fmtMoney(listLiters ? listValue / listLiters : 0)} icon={Gauge} tone="amber" />
        </StatGrid>

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Equipamento, motorista ou fornecedor">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="fuel-search" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um abastecimento pra habilitar as ações da barra */}
        <DataCard
          title="Abastecimentos"
          count={loading ? '...' : list.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo abastecimento" onClick={openCreate} testId="fuel-new-btn" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedSupply && openEdit(singleSelectedSupply.id)} disabled={!singleSelectedSupply} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedSupply && handleDelete(singleSelectedSupply.id, singleSelectedSupply.supply_number)} disabled={!singleSelectedSupply} />
            </Toolbar>
          )}
        >
          {list.length === 0 && !loading ? (
            <EmptyState
              icon={Fuel}
              title={search ? 'Nenhum abastecimento encontrado' : 'Nenhum abastecimento cadastrado'}
              hint={search ? 'Ajuste a busca' : 'Registre o primeiro pelo botão "Novo abastecimento"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={list.length > 0 && list.every((f) => selectedIds.has(f.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Equipamento</th>
                    <th>Motorista</th>
                    <th>Fornecedor</th>
                    <th>Fonte</th>
                    <th>Combustível</th>
                    <th className="!text-right">Litros</th>
                    <th className="!text-right">Valor total</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((f) => (
                    <tr
                      key={f.id}
                      onClick={() => toggleSelect(f.id)}
                      data-selected={selectedIds.has(f.id)}
                      className="cursor-pointer"
                      data-testid={`fuel-row-${f.supply_number}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(f.id)}
                          onCheckedChange={() => toggleSelect(f.id)}
                          data-testid={`fuel-row-checkbox-${f.supply_number}`}
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{f.supply_number}</td>
                      <td className="whitespace-nowrap tabular-nums">{f.supply_date ? format(new Date(`${f.supply_date}T00:00:00`), 'dd/MM/yyyy') : '-'}</td>
                      <td><PlateTag>{f.equipment_plate}</PlateTag></td>
                      <td><div className="max-w-[200px] truncate" title={f.driver_name || ''}>{f.driver_name || '-'}</div></td>
                      <td><div className="max-w-[200px] truncate" title={f.supplier_name || ''}>{f.supplier_name || '-'}</div></td>
                      <td>
                        <StatusPill tone={f.source === 'TANQUE_PROPRIO' ? 'primary' : 'slate'} dot={false}>
                          {f.source === 'TANQUE_PROPRIO' ? 'Tanque Próprio' : 'Posto Externo'}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap">{FUEL_TYPE_LABELS[f.fuel_type] || f.fuel_type || '-'}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{Number(f.liters || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtMoney(f.total_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="fuel-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Fuel className="w-5 h-5 text-primary" />
              {editingId ? 'Editar Abastecimento' : 'Novo Abastecimento'}
              {nextNumber !== null && <Badge variant="outline" className="ml-2 text-primary border-primary/30">Nº {nextNumber}</Badge>}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <SectionTitle>Dados Gerais</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="mb-1 block">Ordem de Abastecimento</Label>
                <Autocomplete
                  value={form.supply_order || ''}
                  onChange={(v) => onChange('supply_order', v)}
                  onSelect={onSelectFuelOrder}
                  options={fuelOrders}
                  displayField={(o) => `Nº ${o.order_number}${o.equipment_plate ? ' - ' + o.equipment_plate : ''}${o.supplier_name ? ' - ' + o.supplier_name : ''}`}
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="mb-1 block">Equipamento <span className="text-red-500">*</span></Label>
                <Autocomplete
                  value={form.equipment_plate}
                  onChange={(v) => onChange('equipment_plate', v)}
                  onSelect={(vh) => { onChange('equipment_plate', vh.plate); onChange('equipment_id', vh.id); }}
                  options={vehicles}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  className="text-sm font-mono"
                />
              </div>
              <div>
                <Label className="mb-1 block">Operador / Motorista</Label>
                <Autocomplete
                  value={form.driver_name}
                  onChange={(v) => onChange('driver_name', v)}
                  onSelect={(dr) => { onChange('driver_name', dr.name); onChange('driver_id', dr.id); }}
                  options={drivers}
                  displayField="name"
                  className="text-sm"
                />
              </div>
              <Field type="date" label="Data do Abastecimento *" value={form.supply_date} onChange={(v) => onChange('supply_date', v)} testid="fuel-supply-date" />
              <Field type="date" label="Data de Entrada *" value={form.entry_date} onChange={(v) => onChange('entry_date', v)} testid="fuel-entry-date" />
              <DecimalField label="Leitura *" value={form.reading} onChange={(v) => onChange('reading', v)} testid="fuel-reading" />
              <div>
                <Label className="mb-1 block">Fornecedor <span className="text-red-500">*</span></Label>
                <Autocomplete
                  value={form.supplier_name}
                  onChange={(v) => onChange('supplier_name', v)}
                  onSelect={(sp) => { onChange('supplier_name', sp.name); onChange('supplier_id', sp.id); }}
                  options={suppliers}
                  displayField="name"
                  className="text-sm"
                />
              </div>
              <CityStateFields
                flat
                value={{ city: form.city, state: form.state }}
                onChange={({ city, state }) => { onChange('city', city); onChange('state', state); }}
              />
              <SelectField label="Fonte *" value={form.source} onChange={(v) => onChange('source', v)} options={SOURCE_OPTIONS} testid="fuel-source" />
            </div>

            <SectionTitle>Combustível / ARLA</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <SelectField label="Combustível/ARLA *" value={form.fuel_type} onChange={(v) => onChange('fuel_type', v)} options={FUEL_TYPE_OPTIONS} testid="fuel-type" />
              <Field type="number" label="Litros *" value={form.liters} onChange={(v) => onLitersOrPriceChange('liters', v)} testid="fuel-liters" />
              <Field type="number" label="Valor Unitário *" value={form.unit_price} onChange={(v) => onLitersOrPriceChange('unit_price', v)} testid="fuel-unit-price" />
              <Field type="number" label="Valor Bruto *" value={form.gross_value} onChange={(v) => onChange('gross_value', v)} testid="fuel-gross" />
              <Field type="number" label="Abatimentos" value={form.discounts} onChange={(v) => onChange('discounts', v)} testid="fuel-discounts" />
              <Field type="number" label="Acréscimos" value={form.additions} onChange={(v) => onChange('additions', v)} testid="fuel-additions" />
              <div>
                <Label className="mb-1 block">Valor Líquido</Label>
                <Input value={fmtMoney(netValue)} readOnly className="h-9 text-sm text-right font-semibold bg-muted" />
              </div>
              <RadioField label="Tanque Cheio *" value={form.full_tank} onChange={(v) => onChange('full_tank', v)} testid="fuel-full-tank" />
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="has-other-expenses" checked={form.has_other_expenses} onChange={(e) => onChange('has_other_expenses', e.target.checked)} className="h-4 w-4" data-testid="fuel-has-other-expenses" />
              <Label htmlFor="has-other-expenses" className="text-[12px] text-slate-700 dark:text-slate-300 cursor-pointer">Outras Despesas</Label>
            </div>
            {form.has_other_expenses && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <Field type="number" label="Valor de Outras Despesas" value={form.other_expenses_value} onChange={(v) => onChange('other_expenses_value', v)} testid="fuel-other-expenses-value" />
                <Field label="Descrição" value={form.other_expenses_description} onChange={(v) => onChange('other_expenses_description', v)} testid="fuel-other-expenses-desc" />
              </div>
            )}

            <TotalBox label="Valor Total" value={totalValue} />

            <SectionTitle>Informações de Pagamento</SectionTitle>
            <div className="grid grid-cols-1 gap-2">
              <Label>Tipo de Pagamento <span className="text-red-500">*</span></Label>
              <div className="flex flex-wrap gap-4">
                {PAYMENT_TYPE_OPTIONS.map(([v, l]) => (
                  <label key={v} className="flex items-center gap-1.5 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input type="radio" name="payment_type" checked={form.payment_type === v} onChange={() => onChange('payment_type', v)} className="h-3.5 w-3.5" />
                    {l}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <SelectField label="Tipo do Documento *" value={form.document_type} onChange={(v) => onChange('document_type', v)} options={DOCUMENT_TYPE_OPTIONS} testid="fuel-doc-type" />
              <Field label="Número" value={form.document_number} onChange={(v) => onChange('document_number', v)} testid="fuel-doc-number" />
              <Field label="Apropriação *" value={form.allocation} onChange={(v) => onChange('allocation', v)} testid="fuel-allocation" />
            </div>
            <TextAreaField label="Observações" value={form.observations} onChange={(v) => onChange('observations', v)} testid="fuel-observations" />
            <div className="grid grid-cols-2 gap-3">
              <RadioField label="Vinculado ao Lote" value={form.linked_to_batch} onChange={(v) => onChange('linked_to_batch', v)} testid="fuel-linked-batch" />
              <RadioField label="Definir Empresa" value={form.define_company} onChange={(v) => onChange('define_company', v)} testid="fuel-define-company" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="fuel-cancel">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90" data-testid="fuel-save">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : editingId ? 'Atualizar Abastecimento' : 'Salvar Abastecimento'}
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

function Field({ label, value, onChange, type = 'text', testid, placeholder }) {
  return (
    <div>
      <Label className="mb-1 block"><RequiredLabel label={label} /></Label>
      <Input type={type} value={value ?? ''}
        onChange={(e) => onChange(e.target.value)} className="h-9 text-sm" data-testid={testid} />
    </div>
  );
}

// Campo numérico decimal digitado como texto em vez de <input type="number">
// - ver sanitizeKmInput em lib/utils.js pro motivo.
function DecimalField({ label, value, onChange, testid }) {
  const handleChange = (e) => {
    const normalized = sanitizeKmInput(e.target.value);
    if (normalized !== null) onChange(normalized);
  };
  return (
    <div>
      <Label className="mb-1 block"><RequiredLabel label={label} /></Label>
      <Input type="text" inputMode="decimal" value={value ?? ''}
        onChange={handleChange} className="h-9 text-sm" data-testid={testid} />
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

function RadioField({ label, value, onChange, testid }) {
  return (
    <div>
      <Label className="mb-1 block"><RequiredLabel label={label} /></Label>
      <div className="flex items-center gap-4 h-9">
        <label className="flex items-center gap-1.5 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
          <input type="radio" checked={value === true} onChange={() => onChange(true)} className="h-3.5 w-3.5" data-testid={testid ? `${testid}-sim` : undefined} />
          Sim
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
          <input type="radio" checked={value === false} onChange={() => onChange(false)} className="h-3.5 w-3.5" data-testid={testid ? `${testid}-nao` : undefined} />
          Não
        </label>
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

function TotalBox({ label, value }) {
  return (
    <div className="p-3 rounded-lg border-2 border-primary/40 bg-primary/5">
      <div className="text-[10px] uppercase tracking-wider text-primary font-semibold">{label}</div>
      <div className="text-xl font-bold text-primary">{fmtMoney(value)}</div>
    </div>
  );
}
