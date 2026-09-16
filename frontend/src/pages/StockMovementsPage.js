import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ComboField } from '../components/ui/combo-field';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Plus, Trash2, Save, Search, ArrowLeftRight, Car, ClipboardList, Pencil, Download } from 'lucide-react';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const OPERATION_LABELS = { ENTRADA: 'Entrada', SAIDA: 'Saída' };
const OPERATION_COLORS = {
  ENTRADA: 'bg-emerald-100 text-emerald-700',
  SAIDA: 'bg-rose-100 text-rose-700',
};

export default function StockMovementsPage() {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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

  const loadMovements = async () => {
    setLoading(true);
    try {
      const r = await api.getStockMovements(search ? { search } : {});
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

  const singleSelectedMovement = selectedIds.size === 1 ? movements.find((m) => m.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-5" data-testid="stock-movements-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Movimentação de Estoque</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Lançamentos manuais de Entrada e Saída de estoque</p>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadMovements()}
                onBlur={loadMovements}
                placeholder="Placa, Nº OS, NF-e, Almoxarifado..."
                className="h-9 text-[13px] pl-9"
                data-testid="search-stock-movements-input"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button variant="ghost" size="sm" onClick={openCreate} title="Nova Movimentação" data-testid="stock-movement-new-btn" className="h-9 w-9 p-0">
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedMovement && openEdit(singleSelectedMovement.id)}
            disabled={!singleSelectedMovement}
            title="Editar"
            data-testid="stock-movement-edit-btn"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Pencil className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedMovement && downloadPDF(singleSelectedMovement.id, singleSelectedMovement.movement_number)}
            disabled={!singleSelectedMovement}
            title="Baixar PDF"
            data-testid="stock-movement-pdf-btn"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Download className="w-4 h-4 text-emerald-600" />
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
              <ArrowLeftRight className="w-4 h-4" />
              {loading ? 'Carregando...' : `${movements.length} Movimentação(ões)`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {movements.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="w-9 px-4 py-2.5">
                        <Checkbox
                          checked={movements.length > 0 && movements.every((m) => selectedIds.has(m.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                          data-testid="stock-movement-select-all"
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Data</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Operação</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Almoxarifado</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Finalidade</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Itens</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Valor Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {movements.map((m) => (
                      <tr
                        key={m.id}
                        onClick={() => toggleSelect(m.id)}
                        className={`cursor-pointer transition-colors ${selectedIds.has(m.id) ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                        data-testid="stock-movement-row"
                      >
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(m.id)}
                            onCheckedChange={() => toggleSelect(m.id)}
                            data-testid={`stock-movement-row-checkbox-${m.movement_number}`}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-[13px] font-semibold text-emerald-700">Nº {m.movement_number}</td>
                        <td className="px-4 py-2.5 text-[12px] text-slate-500 dark:text-slate-400">{m.movement_date ? format(new Date(m.movement_date + 'T00:00:00'), 'dd/MM/yyyy') : '-'}</td>
                        <td className="px-4 py-2.5"><Badge variant="secondary" className={`text-[10px] ${OPERATION_COLORS[m.operation_type] || ''}`}>{OPERATION_LABELS[m.operation_type] || m.operation_type}</Badge></td>
                        <td className="px-4 py-2.5 text-[13px]">{m.warehouse_name || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px]">
                          {m.purpose_type === 'VEICULO' && <span className="inline-flex items-center gap-1"><Car className="w-3.5 h-3.5 text-slate-400" />{m.purpose_text}</span>}
                          {m.purpose_type === 'OS' && <span className="inline-flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5 text-slate-400" />{m.purpose_text}</span>}
                          {(!m.purpose_type || m.purpose_type === 'OUTRO') && (m.purpose_text || '-')}
                        </td>
                        <td className="px-4 py-2.5 text-[13px]">{(m.items || []).length}</td>
                        <td className="px-4 py-2.5 text-[13px] font-semibold">{fmtMoney(m.total_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-500 dark:text-slate-400">
                <ArrowLeftRight className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">{search ? 'Nenhuma movimentação encontrada' : 'Nenhuma movimentação de estoque registrada'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="stock-movement-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="w-5 h-5 text-emerald-600" />
              {editingId ? 'Editar Movimentação de Estoque' : 'Movimentação de Estoque - Inclusão'}
              {nextNumber !== null && <Badge variant="outline" className="ml-2 text-emerald-700 border-emerald-300">Nº {nextNumber}</Badge>}
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
                  <ComboField
                    value={form.warehouse_id}
                    onChange={(v) => {
                      onChange('warehouse_id', v);
                      onChange('warehouse_name', warehouses.find((w) => w.id === v)?.name || '');
                    }}
                    options={warehouses.map((w) => [w.id, w.name])}
                    emptyLabel="Nenhum almoxarifado encontrado"
                    testid="stock-movement-warehouse"
                  />
                </div>
                <div>
                  <Label className="mb-1 block">Fornecedor</Label>
                  <ComboField
                    value={form.supplier_id}
                    onChange={(v) => {
                      onChange('supplier_id', v);
                      onChange('supplier_name', suppliers.find((s) => s.id === v)?.name || '');
                    }}
                    options={suppliers.map((s) => [s.id, s.name])}
                    emptyLabel="Nenhum fornecedor encontrado"
                    testid="stock-movement-supplier"
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
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-emerald-700">Itens</h3>
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
                <div className="p-3 rounded-lg border-2 border-emerald-400 bg-emerald-50 min-w-[220px] text-right">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">Valor Total</div>
                  <div className="text-xl font-bold text-emerald-700">{fmtMoney(total)}</div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="stock-movement-cancel">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="stock-movement-save">
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
