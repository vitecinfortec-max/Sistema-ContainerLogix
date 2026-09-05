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
import { ComboField } from '../components/ui/combo-field';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Search, Save, ClipboardCheck, Download } from 'lucide-react';

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
const FUEL_TYPE_LABELS = FUEL_TYPE_OPTIONS.reduce((acc, [v, l]) => { acc[v] = l; return acc; }, {});

const SUPPLY_MODE_OPTIONS = [
  ['LITROS', 'Litros'],
  ['VALOR', 'Valor'],
  ['LITROS_VALOR', 'Litros/Valor'],
  ['COMPLETAR_TANQUE', 'Completar Tanque'],
];
const SUPPLY_MODE_LABELS = SUPPLY_MODE_OPTIONS.reduce((acc, [v, l]) => { acc[v] = l; return acc; }, {});

function buildEmpty() {
  return {
    company_id: '', company_name: '',
    requester: '',
    order_date: new Date().toISOString().split('T')[0],
    equipment_id: '', equipment_plate: '',
    supplier_id: '', supplier_name: '',
    fuel_type: '',
    supply_mode: 'LITROS',
    liters: '',
    estimated_value: '',
    observations: '',
  };
}

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function FuelSupplyOrderPage() {
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
  const [suppliers, setSuppliers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const debounceRef = useRef(null);

  useEffect(() => { loadList(); loadVehicles(); loadSuppliers(); loadCompanies(); }, []);

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
      const r = await api.getFuelSupplyOrders(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar ordens de abastecimento');
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
  const loadSuppliers = async () => {
    try {
      const r = await api.getSuppliers();
      setSuppliers(r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadCompanies = async () => {
    try {
      const r = await api.getCompanies();
      setCompanies(r.data?.items || r.data || []);
    } catch (e) { /* ignore */ }
  };

  const reset = () => setForm(buildEmpty());

  const openCreate = async () => {
    reset();
    setEditingId(null);
    try {
      const r = await api.getFuelSupplyOrderNextNumber();
      setNextNumber(r.data?.next_number || 1);
    } catch (e) { setNextNumber(null); }
    setDialogOpen(true);
  };

  const openEdit = async (id) => {
    try {
      const r = await api.getFuelSupplyOrder(id);
      const d = r.data;
      setEditingId(id);
      setNextNumber(d.order_number);
      setForm({ ...buildEmpty(), ...d });
      setDialogOpen(true);
    } catch (e) { toast.error('Erro ao carregar ordem de abastecimento'); }
  };

  const onChange = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const estimatedTotal = Number(form.liters || 0) * Number(form.estimated_value || 0);

  const handleSave = async () => {
    if (!form.order_date || !form.equipment_plate || !form.fuel_type) {
      toast.error('Preencha os campos obrigatórios (Data, Equipamento e Produto)');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        liters: ['LITROS', 'LITROS_VALOR'].includes(form.supply_mode) && form.liters !== '' ? Number(form.liters) : null,
        estimated_value: ['VALOR', 'LITROS_VALOR'].includes(form.supply_mode) && form.estimated_value !== '' ? Number(form.estimated_value) : null,
      };
      if (editingId) {
        await api.updateFuelSupplyOrder(editingId, payload);
        toast.success('Ordem de Abastecimento atualizada!');
      } else {
        await api.createFuelSupplyOrder(payload);
        toast.success('Ordem de Abastecimento criada!');
      }
      setDialogOpen(false);
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar ordem de abastecimento');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id, num) => {
    if (!(await confirm(`Excluir Ordem de Abastecimento Nº ${num}?`))) return;
    try {
      await api.deleteFuelSupplyOrder(id);
      toast.success('Ordem de Abastecimento excluída');
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
      const r = await api.getFuelSupplyOrderPDF(id);
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `OrdemAbastecimento_${num}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('PDF gerado!');
    } catch (e) { toast.error('Erro ao gerar PDF'); }
  };

  const singleSelectedOrder = selectedIds.size === 1 ? list.find((o) => o.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-5" data-testid="fuel-order-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4" />
            Ordem de Abastecimento
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Autorização de abastecimento anterior ao registro do abastecimento em si</p>
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
                onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-[13px]" data-testid="fuel-order-search" />
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
            data-testid="fuel-order-new-btn"
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
              <ClipboardCheck className="w-4 h-4" />
              {loading ? 'Carregando...' : `Ordens de Abastecimento Registradas (${list.length})`}
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
                    <TableHead className="text-[12px] font-semibold">Data</TableHead>
                    <TableHead className="text-[12px] font-semibold">Equipamento</TableHead>
                    <TableHead className="text-[12px] font-semibold">Fornecedor</TableHead>
                    <TableHead className="text-[12px] font-semibold">Produto</TableHead>
                    <TableHead className="text-[12px] font-semibold">Tipo</TableHead>
                    <TableHead className="text-[12px] font-semibold">Solicitante</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.length === 0 && !loading && (
                    <TableRow><TableCell colSpan={8} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">Nenhuma ordem de abastecimento cadastrada.</TableCell></TableRow>
                  )}
                  {list.map((o) => (
                    <TableRow
                      key={o.id}
                      onClick={() => toggleSelect(o.id)}
                      className={`cursor-pointer transition-colors ${selectedIds.has(o.id) ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                      data-testid={`fuel-order-row-${o.order_number}`}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(o.id)}
                          onCheckedChange={() => toggleSelect(o.id)}
                          data-testid={`fuel-order-row-checkbox-${o.order_number}`}
                        />
                      </TableCell>
                      <TableCell className="text-[13px] font-semibold text-primary">Nº {o.order_number}</TableCell>
                      <TableCell className="text-[12px]">{o.order_date ? format(new Date(`${o.order_date}T00:00:00`), 'dd/MM/yyyy') : '-'}</TableCell>
                      <TableCell className="text-[12px] font-mono">{o.equipment_plate || '-'}</TableCell>
                      <TableCell className="text-[13px]">{o.supplier_name || '-'}</TableCell>
                      <TableCell className="text-[12px]">{FUEL_TYPE_LABELS[o.fuel_type] || o.fuel_type || '-'}</TableCell>
                      <TableCell className="text-[12px]">{SUPPLY_MODE_LABELS[o.supply_mode] || o.supply_mode || '-'}</TableCell>
                      <TableCell className="text-[13px]">{o.requester || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="fuel-order-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="w-5 h-5 text-primary" />
              {editingId ? 'Editar Ordem de Abastecimento' : 'Nova Ordem de Abastecimento'}
              {nextNumber !== null && <Badge variant="outline" className="ml-2 text-primary border-primary/30">Nº {nextNumber}</Badge>}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <ComboField label="Empresa" value={form.company_id || ''} onChange={(v) => {
                onChange('company_id', v);
                const c = companies.find((x) => x.id === v);
                onChange('company_name', c?.name || '');
              }} options={companies.map((c) => [c.id, c.name])}
                searchPlaceholder="Buscar empresa..." emptyLabel="Nenhuma empresa encontrada" testid="fuel-order-company" />
              <Field label="Solicitante" value={form.requester} onChange={(v) => onChange('requester', v)} testid="fuel-order-requester" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field type="date" label="Data *" value={form.order_date} onChange={(v) => onChange('order_date', v)} testid="fuel-order-date" />
              <ComboField label="Equipamento *" value={form.equipment_plate || ''} onChange={(v) => {
                onChange('equipment_plate', v);
                const vh = vehicles.find((x) => x.plate === v);
                onChange('equipment_id', vh?.id || '');
              }} options={vehicles.map((v) => [v.plate, `${v.plate} ${v.model || ''}`.trim()])}
                searchPlaceholder="Buscar equipamento..." emptyLabel="Nenhum equipamento encontrado" testid="fuel-order-equipment" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ComboField label="Fornecedor" value={form.supplier_name || ''} onChange={(v) => {
                onChange('supplier_name', v);
                const sp = suppliers.find((x) => x.name === v);
                onChange('supplier_id', sp?.id || '');
              }} options={suppliers.map((s) => [s.name, s.name])}
                searchPlaceholder="Buscar fornecedor..." emptyLabel="Nenhum fornecedor encontrado" testid="fuel-order-supplier" />
              <ComboField label="Produto *" value={form.fuel_type} onChange={(v) => onChange('fuel_type', v)} options={FUEL_TYPE_OPTIONS}
                searchPlaceholder="Buscar produto..." emptyLabel="Nenhum produto encontrado" testid="fuel-order-fuel-type" />
            </div>

            <div>
              <Label className="mb-1 block">Tipo <span className="text-red-500">*</span></Label>
              <div className="flex flex-wrap gap-4">
                {SUPPLY_MODE_OPTIONS.map(([v, l]) => (
                  <label key={v} className="flex items-center gap-1.5 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input type="radio" name="supply_mode" checked={form.supply_mode === v} onChange={() => onChange('supply_mode', v)} className="h-3.5 w-3.5" data-testid={`fuel-order-mode-${v}`} />
                    {l}
                  </label>
                ))}
              </div>
            </div>

            {form.supply_mode !== 'COMPLETAR_TANQUE' && (
              <div className="grid grid-cols-2 gap-3">
                {(form.supply_mode === 'LITROS' || form.supply_mode === 'LITROS_VALOR') && (
                  <Field type="number" label="Litros" value={form.liters} onChange={(v) => onChange('liters', v)} testid="fuel-order-liters" />
                )}
                {(form.supply_mode === 'VALOR' || form.supply_mode === 'LITROS_VALOR') && (
                  <Field type="number" label="Valor" value={form.estimated_value} onChange={(v) => onChange('estimated_value', v)} testid="fuel-order-value" />
                )}
                {form.supply_mode === 'LITROS_VALOR' && (
                  <div>
                    <Label className="mb-1 block">Total</Label>
                    <Input value={fmtMoney(estimatedTotal)} readOnly className="h-9 text-sm bg-muted" data-testid="fuel-order-total" />
                  </div>
                )}
              </div>
            )}

            <TextAreaField label="Observação" value={form.observations} onChange={(v) => onChange('observations', v)} testid="fuel-order-observations" />
          </div>

          <DialogFooter>
            {editingId && (
              <Button variant="outline" onClick={() => downloadPDF(editingId, nextNumber)} data-testid="fuel-order-print" title="Baixar PDF">
                <Download className="w-4 h-4 mr-2" />Imprimir
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="fuel-order-cancel">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90" data-testid="fuel-order-save">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : editingId ? 'Atualizar Ordem' : 'Salvar Ordem'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
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

function TextAreaField({ label, value, onChange, testid }) {
  return (
    <div>
      <Label className="mb-1 block">{label}</Label>
      <Textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="text-sm min-h-[60px]" data-testid={testid} />
    </div>
  );
}
