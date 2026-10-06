import { useState, useEffect, useRef } from 'react';
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
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { Autocomplete, OptionAutocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Save, ClipboardCheck, Download, Printer, Clock, CheckCircle2 } from 'lucide-react';

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

const ITEMS_PER_PAGE = 15;

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
  const [currentPage, setCurrentPage] = useState(1);
  const [vehicles, setVehicles] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const debounceRef = useRef(null);

  useEffect(() => { loadList(); loadVehicles(); loadSuppliers(); loadCompanies(); }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCurrentPage(1);
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
      const r = await api.getVehicles({ per_page: 1000 });
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

  // Paginação: a lista vem inteira da API; a tela mostra uma página por vez.
  // Se a página atual deixar de existir (ex.: excluiu o último registro dela),
  // cai na última que existe.
  const totalPages = Math.max(1, Math.ceil(list.length / ITEMS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const pageItems = list.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
  const goToPage = (next) => {
    if (next >= 1 && next <= totalPages) {
      setCurrentPage(next);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = pageItems.map((o) => o.id);
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
      <div className="space-y-4" data-testid="fuel-order-page">
        <PageHeader icon={ClipboardCheck} title="Ordem de Abastecimento" subtitle="Autorização de abastecimento anterior ao registro do abastecimento em si" />

        <StatGrid className="lg:grid-cols-3">
          <StatCard label="Ordens" value={list.length} icon={ClipboardCheck} tone="blue" hint={search ? 'que batem com a busca' : 'cadastradas'} />
          <StatCard label="Pendentes" value={list.filter((o) => !o.is_launched).length} icon={Clock} tone="amber" hint="ainda sem abastecimento lançado" />
          <StatCard label="Lançadas" value={list.filter((o) => o.is_launched).length} icon={CheckCircle2} tone="primary" hint="já viraram abastecimento" />
        </StatGrid>

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Equipamento, fornecedor, solicitante ou empresa">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="fuel-order-search" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma ordem pra habilitar as ações da barra */}
        <DataCard
          title="Ordens de abastecimento"
          count={loading ? '...' : list.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova ordem" onClick={openCreate} testId="fuel-order-new-btn" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedOrder && openEdit(singleSelectedOrder.id)} disabled={!singleSelectedOrder} />
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedOrder && downloadPDF(singleSelectedOrder.id, singleSelectedOrder.order_number)} disabled={!singleSelectedOrder} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedOrder && handleDelete(singleSelectedOrder.id, singleSelectedOrder.order_number)} disabled={!singleSelectedOrder} />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={list.length}
              pageSize={ITEMS_PER_PAGE}
              onPageChange={goToPage}
            />
          )}
        >
          {list.length === 0 && !loading ? (
            <EmptyState
              icon={ClipboardCheck}
              title={search ? 'Nenhuma ordem encontrada' : 'Nenhuma ordem de abastecimento cadastrada'}
              hint={search ? 'Ajuste a busca' : 'Cadastre a primeira pelo botão "Nova ordem"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={pageItems.length > 0 && pageItems.every((o) => selectedIds.has(o.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Equipamento</th>
                    <th>Fornecedor</th>
                    <th>Produto</th>
                    <th>Tipo</th>
                    <th>Solicitante</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => toggleSelect(o.id)}
                      data-selected={selectedIds.has(o.id)}
                      className="cursor-pointer"
                      data-testid={`fuel-order-row-${o.order_number}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(o.id)}
                          onCheckedChange={() => toggleSelect(o.id)}
                          data-testid={`fuel-order-row-checkbox-${o.order_number}`}
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{o.order_number}</td>
                      <td className="whitespace-nowrap tabular-nums">{o.order_date ? format(new Date(`${o.order_date}T00:00:00`), 'dd/MM/yyyy') : '-'}</td>
                      <td><PlateTag>{o.equipment_plate}</PlateTag></td>
                      <td><div className="max-w-[220px] truncate" title={o.supplier_name || ''}>{o.supplier_name || '-'}</div></td>
                      <td className="whitespace-nowrap">{FUEL_TYPE_LABELS[o.fuel_type] || o.fuel_type || '-'}</td>
                      <td className="whitespace-nowrap">{SUPPLY_MODE_LABELS[o.supply_mode] || o.supply_mode || '-'}</td>
                      <td><div className="max-w-[180px] truncate" title={o.requester || ''}>{o.requester || '-'}</div></td>
                      <td>
                        <StatusPill tone={o.is_launched ? 'emerald' : 'amber'}>
                          {o.is_launched ? 'Lançado' : 'Pendente'}
                        </StatusPill>
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
              <div>
                <Label className="mb-1 block">Empresa</Label>
                <Autocomplete
                  value={form.company_name}
                  onChange={(v) => onChange('company_name', v)}
                  onSelect={(c) => { onChange('company_name', c.name); onChange('company_id', c.id); }}
                  options={companies}
                  displayField="name"
                  className="text-sm"
                />
              </div>
              <Field label="Solicitante" value={form.requester} onChange={(v) => onChange('requester', v)} testid="fuel-order-requester" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field type="date" label="Data *" value={form.order_date} onChange={(v) => onChange('order_date', v)} testid="fuel-order-date" />
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
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block">Fornecedor</Label>
                <Autocomplete
                  value={form.supplier_name}
                  onChange={(v) => onChange('supplier_name', v)}
                  onSelect={(sp) => { onChange('supplier_name', sp.name); onChange('supplier_id', sp.id); }}
                  options={suppliers}
                  displayField="name"
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="mb-1 block">Produto <span className="text-red-500">*</span></Label>
                <OptionAutocomplete
                  value={form.fuel_type}
                  onChange={(v) => onChange('fuel_type', v)}
                  options={FUEL_TYPE_OPTIONS}
                  className="text-sm"
                  testId="fuel-order-fuel-type"
                />
              </div>
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
