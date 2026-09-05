import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
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
import { ComboField } from '../components/ui/combo-field';
import { Autocomplete } from '../components/Autocomplete';
import { CityStateFields } from '../components/AddressFields';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Search, Save, Fuel } from 'lucide-react';

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

function buildEmpty() {
  return {
    supply_order: '',
    equipment_id: '', equipment_plate: '',
    driver_id: '', driver_name: '',
    supply_date: new Date().toISOString().split('T')[0],
    entry_date: new Date().toISOString().split('T')[0],
    reading: '',
    supplier_id: '', supplier_name: '',
    city: '', state: '',
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
      const r = await api.getVehicles();
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
      setFuelOrders(r.data || []);
    } catch (e) { /* ignore */ }
  };

  // Ao selecionar uma Ordem de Abastecimento já cadastrada, puxa os dados que
  // ela já tem (equipamento, fornecedor, combustível) pro Abastecimento atual.
  const onSelectFuelOrder = (order) => {
    setForm((p) => ({
      ...p,
      supply_order: `Nº ${order.order_number}`,
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

  return (
    <Layout>
      <div className="space-y-5" data-testid="fuel-supply-page">
        <PageHeader
          title="Abastecimento"
          subtitle="Controle de abastecimento de combustível e ARLA da frota"
          icon={Fuel}
        />

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
                onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-[13px]" data-testid="fuel-search" />
            </div>
          </CardContent>
        </Card>

        {/* Barra de ações - marque um abastecimento na tabela abaixo pra habilitar as ações */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openCreate}
            title="Adicionar"
            data-testid="fuel-new-btn"
            className="h-9 w-9 p-0"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedSupply && openEdit(singleSelectedSupply.id)}
            disabled={!singleSelectedSupply}
            title="Editar"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Pencil className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedSupply && handleDelete(singleSelectedSupply.id, singleSelectedSupply.supply_number)}
            disabled={!singleSelectedSupply}
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
              <Fuel className="w-4 h-4" />
              {loading ? 'Carregando...' : `Abastecimentos Registrados (${list.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-800">
                    <TableHead className="w-9">
                      <Checkbox
                        checked={list.length > 0 && list.every((f) => selectedIds.has(f.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </TableHead>
                    <TableHead className="text-[12px] font-semibold">Nº</TableHead>
                    <TableHead className="text-[12px] font-semibold">Data</TableHead>
                    <TableHead className="text-[12px] font-semibold">Equipamento</TableHead>
                    <TableHead className="text-[12px] font-semibold">Motorista</TableHead>
                    <TableHead className="text-[12px] font-semibold">Fornecedor</TableHead>
                    <TableHead className="text-[12px] font-semibold">Combustível</TableHead>
                    <TableHead className="text-[12px] font-semibold text-right">Litros</TableHead>
                    <TableHead className="text-[12px] font-semibold text-right">Valor Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.length === 0 && !loading && (
                    <TableRow><TableCell colSpan={9} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">Nenhum abastecimento cadastrado.</TableCell></TableRow>
                  )}
                  {list.map((f) => (
                    <TableRow
                      key={f.id}
                      onClick={() => toggleSelect(f.id)}
                      className={`cursor-pointer transition-colors ${selectedIds.has(f.id) ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                      data-testid={`fuel-row-${f.supply_number}`}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(f.id)}
                          onCheckedChange={() => toggleSelect(f.id)}
                          data-testid={`fuel-row-checkbox-${f.supply_number}`}
                        />
                      </TableCell>
                      <TableCell className="text-[13px] font-semibold text-primary">Nº {f.supply_number}</TableCell>
                      <TableCell className="text-[12px]">{f.supply_date ? format(new Date(`${f.supply_date}T00:00:00`), 'dd/MM/yyyy') : '-'}</TableCell>
                      <TableCell className="text-[12px] font-mono">{f.equipment_plate || '-'}</TableCell>
                      <TableCell className="text-[13px]">{f.driver_name || '-'}</TableCell>
                      <TableCell className="text-[13px]">{f.supplier_name || '-'}</TableCell>
                      <TableCell className="text-[12px]">{FUEL_TYPE_LABELS[f.fuel_type] || f.fuel_type || '-'}</TableCell>
                      <TableCell className="text-[12px] text-right">{Number(f.liters || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-[13px] font-semibold text-right text-primary">{fmtMoney(f.total_value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
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
              <ComboField label="Equipamento *" value={form.equipment_plate || ''} onChange={(v) => {
                onChange('equipment_plate', v);
                const vh = vehicles.find((x) => x.plate === v);
                onChange('equipment_id', vh?.id || '');
              }} options={vehicles.map((v) => [v.plate, `${v.plate} ${v.model || ''}`.trim()])}
                searchPlaceholder="Buscar equipamento..." emptyLabel="Nenhum equipamento encontrado" testid="fuel-equipment" />
              <ComboField label="Operador / Motorista" value={form.driver_name || ''} onChange={(v) => {
                onChange('driver_name', v);
                const dr = drivers.find((x) => x.name === v);
                onChange('driver_id', dr?.id || '');
              }} options={drivers.map((d) => [d.name, d.name])}
                searchPlaceholder="Buscar motorista..." emptyLabel="Nenhum motorista encontrado" testid="fuel-driver" />
              <Field type="date" label="Data do Abastecimento *" value={form.supply_date} onChange={(v) => onChange('supply_date', v)} testid="fuel-supply-date" />
              <Field type="date" label="Data de Entrada *" value={form.entry_date} onChange={(v) => onChange('entry_date', v)} testid="fuel-entry-date" />
              <Field type="number" label="Leitura *" value={form.reading} onChange={(v) => onChange('reading', v)} testid="fuel-reading" />
              <ComboField label="Fornecedor *" value={form.supplier_name || ''} onChange={(v) => {
                onChange('supplier_name', v);
                const sp = suppliers.find((x) => x.name === v);
                onChange('supplier_id', sp?.id || '');
              }} options={suppliers.map((s) => [s.name, s.name])}
                searchPlaceholder="Buscar fornecedor..." emptyLabel="Nenhum fornecedor encontrado" testid="fuel-supplier" />
              <CityStateFields
                flat
                value={{ city: form.city, state: form.state }}
                onChange={({ city, state }) => { onChange('city', city); onChange('state', state); }}
              />
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
