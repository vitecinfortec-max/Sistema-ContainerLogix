import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, StatusPill, EmptyState,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete, OptionAutocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Plus, Trash2, Save, ArrowLeftRight, Car, ClipboardList, Pencil, Printer } from 'lucide-react';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const OPERATION_LABELS = { ENTRADA: 'Entrada', SAIDA: 'Saída' };
const OPERATION_TONES = {
  ENTRADA: 'emerald',
  SAIDA: 'red',
};

export default function StockMovementsPage() {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [operationFilter, setOperationFilter] = useState('');

  const [warehouses, setWarehouses] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [ordensServico, setOrdensServico] = useState([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [nextNumber, setNextNumber] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    loadMovements(); loadWarehouses(); loadSuppliers(); loadProducts();
    loadVehicles(); loadOrdensServico();
  }, []);

  const loadMovements = async (term = search, operation = operationFilter) => {
    setLoading(true);
    try {
      const params = {};
      if (term) params.search = term;
      if (operation) params.operation_type = operation;
      const r = await api.getStockMovements(params);
      setMovements(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar movimentações de estoque');
    } finally {
      setLoading(false);
    }
  };

  const loadWarehouses = async () => {
    try { const r = await api.getWarehouses(); setWarehouses(r.data || []); } catch (e) { /* ignore */ }
  };
  const loadSuppliers = async () => {
    try { const r = await api.getSuppliers(); setSuppliers(r.data || []); } catch (e) { /* ignore */ }
  };
  const loadProducts = async () => {
    try { const r = await api.getProducts(); setProducts(r.data || []); } catch (e) { /* ignore */ }
  };
  const loadVehicles = async () => {
    try { const r = await api.getVehicles({ per_page: 1000 }); setVehicles(r.data?.items || r.data || []); } catch (e) { /* ignore */ }
  };
  const loadOrdensServico = async () => {
    try { const r = await api.getOrdensServico({}); setOrdensServico(r.data || []); } catch (e) { /* ignore */ }
  };

  const onChange = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const openCreate = async () => {
    setForm(buildEmpty());
    setEditingId(null);
    try {
      const r = await api.getStockMovementNextNumber();
      setNextNumber(r.data?.next_number || 1);
    } catch (e) { setNextNumber(null); }
    setDialogOpen(true);
  };

  const openEdit = async (id) => {
    try {
      const r = await api.getStockMovement(id);
      const d = r.data;
      setEditingId(id);
      setNextNumber(d.movement_number);
      setForm({
        ...buildEmpty(),
        ...d,
        nfe_value: d.nfe_value ?? '',
        items: d.items?.length ? d.items : [],
      });
      setDialogOpen(true);
    } catch (e) { toast.error('Erro ao carregar movimentação'); }
  };

  const downloadPDF = async (id, num) => {
    try {
      const r = await api.getStockMovementPDF(id);
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `MovimentacaoEstoque_${num}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('PDF gerado!');
    } catch (e) { toast.error('Erro ao gerar PDF'); }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = movements.map((m) => m.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  // ===== Itens =====
  const addItem = () => setForm((p) => ({
    ...p, items: [...(p.items || []), { product_id: '', product_code: null, product_description: '', quantity: 1, unit_value: 0, total_value: 0 }]
  }));
  const removeItem = (idx) => setForm((p) => ({ ...p, items: (p.items || []).filter((_, i) => i !== idx) }));
  const setItem = (idx, field, val) => {
    setForm((p) => {
      const items = [...(p.items || [])];
      const item = { ...items[idx], [field]: val };
      const q = Number(field === 'quantity' ? val : item.quantity || 0);
      const uv = Number(field === 'unit_value' ? val : item.unit_value || 0);
      item.total_value = q * uv;
      items[idx] = item;
      return { ...p, items };
    });
  };
  const setItemProduct = (idx, product) => {
    setForm((p) => {
      const items = [...(p.items || [])];
      const item = { ...items[idx] };
      item.product_id = product?.id || '';
      item.product_code = product?.code ?? null;
      item.product_description = product?.description || item.product_description || '';
      if (product) item.unit_value = product.reference_value || 0;
      item.total_value = Number(item.quantity || 0) * Number(item.unit_value || 0);
      items[idx] = item;
      return { ...p, items };
    });
  };

  // ===== Finalidade (Veículo / OS / texto livre) =====
  // OS primeiro na lista: o Autocomplete só mostra os 10 primeiros
  // resultados do filtro, e com Veículo na frente uma placa que bate com
  // várias OS's diferentes esmagava as OS's do resultado, escondendo a
  // que interessava (relatado pelo usuário buscando por "1").
  const purposeOptions = [
    ...ordensServico.map((o) => ({ ...o, _kind: 'OS' })),
    ...vehicles.map((v) => ({ ...v, _kind: 'VEICULO' })),
  ];
  // A placa do veículo vinculado entra no texto da OS só pra fins de busca/
  // exibição na lista - buscar pela placa também encontra a OS que usa esse
  // veículo, não só o cadastro do veículo em si.
  const purposeDisplay = (opt) => (opt._kind === 'VEICULO'
    ? `${opt.plate}${opt.model ? ' - ' + opt.model : ''}`
    : `OS Nº ${opt.os_number}${opt.equipment_plate ? ' - ' + opt.equipment_plate : ''}${opt.person_name ? ' - ' + opt.person_name : ''}`);

  const onPurposeChange = (v) => setForm((p) => ({
    ...p, purpose_text: v, purpose_type: 'OUTRO',
    purpose_vehicle_id: '', purpose_vehicle_plate: '', purpose_os_id: '', purpose_os_number: '',
  }));

  // Ao vincular a uma OS, se a movimentação ainda não tem itens, importa os
  // materiais já lançados nos "Produtos" dessa OS pra já sair pronta pra
  // gerar a Saída/baixa no estoque - tenta casar cada item com um Produto
  // do catálogo pela descrição (mesma estratégia usada na importação de
  // NF-e); o que não casar entra com a descrição preenchida mas sem
  // produto vinculado, pro usuário resolver manualmente antes de salvar.
  const importItemsFromOS = (osRecord) => {
    const osProducts = osRecord.products || [];
    const norm = (s) => (s || '').trim().toLowerCase();
    return osProducts.map((p) => {
      const match = products.find((prod) => norm(prod.description) === norm(p.description));
      const quantity = Number(p.quantity || 0);
      const unitValue = Number(p.unit_price || 0);
      return {
        product_id: match ? match.id : '',
        product_code: match ? match.code : null,
        product_description: p.description || '',
        quantity,
        unit_value: unitValue,
        total_value: quantity * unitValue,
      };
    });
  };

  const onPurposeSelect = (opt) => {
    if (opt._kind === 'VEICULO') {
      setForm((p) => ({
        ...p, purpose_type: 'VEICULO', purpose_text: opt.plate,
        purpose_vehicle_id: opt.id, purpose_vehicle_plate: opt.plate,
        purpose_os_id: '', purpose_os_number: '',
      }));
      return;
    }

    const osProducts = opt.products || [];
    const canImport = osProducts.length > 0 && (form.items || []).length === 0;
    const importedItems = canImport ? importItemsFromOS(opt) : null;

    setForm((p) => ({
      ...p, purpose_type: 'OS', purpose_text: `OS Nº ${opt.os_number}`,
      purpose_os_id: opt.id, purpose_os_number: opt.os_number,
      purpose_vehicle_id: '', purpose_vehicle_plate: '',
      ...(importedItems ? { items: importedItems, operation_type: 'SAIDA' } : {}),
    }));

    if (importedItems) {
      const unmatched = importedItems.filter((i) => !i.product_id).length;
      toast.success(
        `${importedItems.length} item(ns) da OS Nº ${opt.os_number} importado(s) para a Saída`
        + (unmatched > 0 ? ` - ${unmatched} sem produto correspondente no catálogo, selecione manualmente` : '')
      );
    } else if (osProducts.length > 0) {
      toast.info('Essa OS tem materiais cadastrados, mas a movimentação já tem itens - remova-os e selecione a OS de novo para importar automaticamente.');
    }
  };

  const total = (form.items || []).reduce((a, i) => a + Number(i.total_value || 0), 0);

  const handleSave = async () => {
    if (!form.warehouse_id) { toast.error('Selecione o Almoxarifado'); return; }
    if (!form.movement_date) { toast.error('Informe a Data'); return; }
    if (!(form.items || []).length) { toast.error('Adicione ao menos um item'); return; }
    for (const it of form.items) {
      if (!it.product_id) { toast.error('Selecione o Produto em todos os itens'); return; }
      if (!(Number(it.quantity) > 0)) { toast.error('Informe uma Quantidade válida em todos os itens'); return; }
    }
    setSaving(true);
    try {
      const payload = {
        operation_type: form.operation_type,
        movement_date: form.movement_date,
        nfe_number: form.nfe_number || null,
        nfe_value: form.nfe_value !== '' && form.nfe_value !== null ? Number(form.nfe_value) : null,
        warehouse_id: form.warehouse_id,
        warehouse_name: form.warehouse_name,
        supplier_id: form.supplier_id || null,
        supplier_name: form.supplier_name || null,
        purpose_type: form.purpose_type || null,
        purpose_text: form.purpose_text || null,
        purpose_vehicle_id: form.purpose_vehicle_id || null,
        purpose_vehicle_plate: form.purpose_vehicle_plate || null,
        purpose_os_id: form.purpose_os_id || null,
        purpose_os_number: form.purpose_os_number || null,
        account_entry: form.account_entry || null,
        observations: form.observations || null,
        items: form.items.map((it) => ({
          product_id: it.product_id,
          product_code: it.product_code,
          product_description: it.product_description,
          quantity: Number(it.quantity || 0),
          unit_value: Number(it.unit_value || 0),
          total_value: Number(it.quantity || 0) * Number(it.unit_value || 0),
        })),
      };
      if (editingId) {
        await api.updateStockMovement(editingId, payload);
        toast.success('Movimentação de Estoque atualizada!');
      } else {
        await api.createStockMovement(payload);
        toast.success('Movimentação de Estoque registrada!');
      }
      setDialogOpen(false);
      loadMovements();
      loadProducts();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar movimentação');
    } finally { setSaving(false); }
  };

  const warehouseOptions = warehouses.map((w) => [w.id, w.name]);
  const supplierOptions = suppliers.map((s) => [s.id, s.name]);

  const clearFilters = () => {
    setSearch('');
    setOperationFilter('');
    loadMovements('', '');
  };

  const singleSelectedMovement = selectedIds.size === 1 ? movements.find((m) => m.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-4" data-testid="stock-movements-page">
        <PageHeader icon={ArrowLeftRight} title="Movimentação de Estoque" subtitle="Lançamentos manuais de Entrada e Saída de estoque" />

        <FilterCard hasFilters={!!(search || operationFilter)} onClear={clearFilters} onApply={() => loadMovements()}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Finalidade, placa, nota fiscal ou almoxarifado" className="col-span-2">
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadMovements()}
                data-testid="search-stock-movements-input"
              />
            </FilterField>
            <FilterField label="Operação">
              <Select value={operationFilter || 'ALL'} onValueChange={(v) => setOperationFilter(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="filter-stock-movement-operation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  <SelectItem value="ENTRADA">Entrada</SelectItem>
                  <SelectItem value="SAIDA">Saída</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma movimentação pra habilitar as ações da barra */}
        <DataCard
          title="Movimentações"
          count={loading ? '...' : movements.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova movimentação" onClick={openCreate} testId="stock-movement-new-btn" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedMovement && openEdit(singleSelectedMovement.id)} disabled={!singleSelectedMovement} testId="stock-movement-edit-btn" />
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedMovement && downloadPDF(singleSelectedMovement.id, singleSelectedMovement.movement_number)} disabled={!singleSelectedMovement} testId="stock-movement-pdf-btn" />
            </Toolbar>
          )}
        >
          {movements.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={movements.length > 0 && movements.every((m) => selectedIds.has(m.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="stock-movement-select-all"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Operação</th>
                    <th>Almoxarifado</th>
                    <th>Finalidade</th>
                    <th className="!text-right">Itens</th>
                    <th className="!text-right">Valor total</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => toggleSelect(m.id)}
                      data-selected={selectedIds.has(m.id)}
                      className="cursor-pointer"
                      data-testid="stock-movement-row"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(m.id)}
                          onCheckedChange={() => toggleSelect(m.id)}
                          data-testid={`stock-movement-row-checkbox-${m.movement_number}`}
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{m.movement_number}</td>
                      <td className="whitespace-nowrap tabular-nums">{m.movement_date ? format(new Date(m.movement_date + 'T00:00:00'), 'dd/MM/yyyy') : '-'}</td>
                      <td>
                        <StatusPill tone={OPERATION_TONES[m.operation_type] || 'slate'}>
                          {OPERATION_LABELS[m.operation_type] || m.operation_type}
                        </StatusPill>
                      </td>
                      <td><div className="max-w-[180px] truncate" title={m.warehouse_name || ''}>{m.warehouse_name || '-'}</div></td>
                      <td>
                        <div className="max-w-[240px] truncate" title={m.purpose_text || ''}>
                          {m.purpose_type === 'VEICULO' && <span className="inline-flex items-center gap-1"><Car className="w-3.5 h-3.5 text-slate-400" />{m.purpose_text}</span>}
                          {m.purpose_type === 'OS' && <span className="inline-flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5 text-slate-400" />{m.purpose_text}</span>}
                          {(!m.purpose_type || m.purpose_type === 'OUTRO') && (m.purpose_text || '-')}
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{(m.items || []).length}</td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtMoney(m.total_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={ArrowLeftRight}
              title={loading ? 'Carregando...' : (search || operationFilter ? 'Nenhuma movimentação encontrada' : 'Nenhuma movimentação de estoque registrada')}
              hint={loading ? undefined : (search || operationFilter ? 'Ajuste os filtros' : 'Registre a primeira pelo botão "Nova movimentação"')}
            />
          )}
        </DataCard>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="stock-movement-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="w-5 h-5 text-primary" />
              {editingId ? 'Editar Movimentação de Estoque' : 'Movimentação de Estoque - Inclusão'}
              {nextNumber !== null && <Badge variant="outline" className="ml-2 text-primary border-primary/30">Nº {nextNumber}</Badge>}
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="basicos" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="basicos" data-testid="stock-movement-tab-basicos">Dados Básicos</TabsTrigger>
              <TabsTrigger value="itens" data-testid="stock-movement-tab-itens">Itens da Movimentação</TabsTrigger>
            </TabsList>

            <TabsContent value="basicos" className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <SelectField label="Operação *" value={form.operation_type} onChange={(v) => onChange('operation_type', v)}
                  options={[['ENTRADA', 'Entrada'], ['SAIDA', 'Saída']]} testid="stock-movement-operation" />
                <Field type="date" label="Data *" value={form.movement_date} onChange={(v) => onChange('movement_date', v)} testid="stock-movement-date" />
                <Field label="Nota Fiscal" value={form.nfe_number} onChange={(v) => onChange('nfe_number', v)} testid="stock-movement-nfe" />
                <Field type="number" label="Valor Nota Fiscal" value={form.nfe_value} onChange={(v) => onChange('nfe_value', v)} testid="stock-movement-nfe-value" />
                <div>
                  <Label className="mb-1 block">Almoxarifado *</Label>
                  <OptionAutocomplete
                    value={form.warehouse_id}
                    onChange={(v) => {
                      onChange('warehouse_id', v);
                      onChange('warehouse_name', warehouses.find((w) => w.id === v)?.name || '');
                    }}
                    options={warehouseOptions}
                    className="text-sm"
                    testId="stock-movement-warehouse"
                  />
                </div>
                <div>
                  <Label className="mb-1 block">Fornecedor</Label>
                  <OptionAutocomplete
                    value={form.supplier_id}
                    onChange={(v) => {
                      onChange('supplier_id', v);
                      onChange('supplier_name', suppliers.find((s) => s.id === v)?.name || '');
                    }}
                    options={supplierOptions}
                    className="text-sm"
                    testId="stock-movement-supplier"
                  />
                </div>
                <div>
                  <Label className="mb-1 block">Finalidade</Label>
                  <Autocomplete
                    value={form.purpose_text}
                    onChange={onPurposeChange}
                    onSelect={onPurposeSelect}
                    options={purposeOptions}
                    displayField={purposeDisplay}
                    className="h-9 text-sm"
                  />
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                    Busque pela placa do veículo ou Nº da OS de Serviço, ou digite livremente (ex: Uso Interno, Perda)
                  </p>
                </div>
                <Field label="Conta Lançamento" value={form.account_entry} onChange={(v) => onChange('account_entry', v)} testid="stock-movement-account" />
              </div>
              <div>
                <Label className="mb-1 block">Observações</Label>
                <Textarea value={form.observations ?? ''} onChange={(e) => onChange('observations', e.target.value)} className="text-sm min-h-[70px]" data-testid="stock-movement-obs" />
              </div>
            </TabsContent>

            <TabsContent value="itens" className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-primary">Itens</h3>
                <Button variant="outline" size="sm" type="button" onClick={addItem} className="h-7 text-xs">
                  <Plus className="w-3 h-3 mr-1" />Adicionar Item
                </Button>
              </div>
              <div className="space-y-2">
                {(form.items || []).length === 0 && (
                  <div className="text-center py-4 text-[12px] text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded">
                    Nenhum item adicionado
                  </div>
                )}
                {(form.items || []).map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                    <div className="col-span-6">
                      <Label className="text-xs mb-1 block">Produto</Label>
                      <Autocomplete
                        value={it.product_description || ''}
                        onChange={(v) => setItem(idx, 'product_description', v)}
                        onSelect={(prod) => setItemProduct(idx, prod)}
                        options={products}
                        displayField="description"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs mb-1 block">Qtd</Label>
                      <Input type="number" step="0.01" value={it.quantity ?? ''} onChange={(e) => setItem(idx, 'quantity', e.target.value)} className="h-8 text-sm text-right" data-testid={`stock-movement-item-qty-${idx}`} />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs mb-1 block">V. Unit.</Label>
                      <Input type="number" step="0.01" value={it.unit_value ?? ''} onChange={(e) => setItem(idx, 'unit_value', e.target.value)} className="h-8 text-sm text-right" data-testid={`stock-movement-item-unitvalue-${idx}`} />
                    </div>
                    <div className="col-span-1">
                      <Label className="text-xs mb-1 block">Total</Label>
                      <Input value={fmtMoney(it.total_value)} readOnly className="h-8 text-sm text-right font-semibold bg-white dark:bg-slate-900" />
                    </div>
                    <div className="col-span-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(idx)} className="h-8 px-2 text-red-500 hover:text-red-700">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
                <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 min-w-[220px] text-right">
                  <div className="text-[10px] uppercase tracking-wider text-primary font-semibold">Valor Total</div>
                  <div className="text-xl font-bold text-primary tabular-nums">{fmtMoney(total)}</div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="stock-movement-cancel">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="stock-movement-save">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : editingId ? 'Atualizar Movimentação' : 'Salvar Movimentação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function buildEmpty() {
  return {
    operation_type: 'ENTRADA',
    movement_date: new Date().toISOString().slice(0, 10),
    nfe_number: '', nfe_value: '',
    warehouse_id: '', warehouse_name: '',
    supplier_id: '', supplier_name: '',
    purpose_type: '', purpose_text: '',
    purpose_vehicle_id: '', purpose_vehicle_plate: '',
    purpose_os_id: '', purpose_os_number: '',
    account_entry: '',
    observations: '',
    items: [],
  };
}

function Field({ label, value, onChange, type = 'text', testid }) {
  return (
    <div>
      <Label className="mb-1 block">{label}</Label>
      <Input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="h-9 text-sm" data-testid={testid} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, testid }) {
  return (
    <div>
      <Label className="mb-1 block">{label}</Label>
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
