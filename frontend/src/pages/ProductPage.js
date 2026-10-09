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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Edit, Package, Scale } from 'lucide-react';

const UNIT_OPTIONS = [['KG', 'Kg'], ['TON', 'Toneladas'], ['M3', 'm³'], ['UNIDADE', 'Unidade'], ['CAIXA', 'Caixa'], ['PALLET', 'Pallet']];
const ORIGIN_OPTIONS = [['NACIONAL', 'Nacional'], ['IMPORTADO', 'Importado']];
const STATUS_OPTIONS = [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo']];

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtQty = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function buildEmptyForm() {
  return {
    description: '', stock_quantity: '', warehouse_id: '', warehouse_name: '', barcode: '', ncm: '', cfop: '',
    unit: 'UNIDADE', family_id: '', family_name: '', reference_value: '', icms_rate: '',
    other_taxes_rate: '', origin: 'NACIONAL', linked_party_name: '', status: 'ATIVO', observations: '',
    ca_number: '',
  };
}

export default function ProductPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [families, setFamilies] = useState([]);
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [nextCode, setNextCode] = useState(null);
  const [formData, setFormData] = useState(buildEmptyForm());
  const [submitting, setSubmitting] = useState(false);

  // Ajuste de saldo: informa a quantidade contada e o motivo; o sistema lança
  // a diferença como Entrada ou Saída em Movimentação de Estoque
  const [adjusting, setAdjusting] = useState(null); // produto em ajuste
  const [adjustForm, setAdjustForm] = useState({ counted: '', reason: '' });
  const [savingAdjust, setSavingAdjust] = useState(false);

  // Estado de Seleção (toolbar)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => { loadItems(); loadWarehouses(); loadFamilies(); loadParties(); }, []);

  const loadItems = async () => {
    setLoading(true);
    try {
      const response = await api.getProducts();
      setItems(response.data);
    } catch (error) {
      toast.error('Erro ao carregar produtos');
    } finally {
      setLoading(false);
    }
  };

  const loadWarehouses = async () => {
    try {
      const response = await api.getWarehouses();
      setWarehouses(response.data.filter((w) => w.status === 'ATIVO'));
    } catch (error) { /* ignore */ }
  };

  const loadFamilies = async () => {
    try {
      const response = await api.getProductFamilies();
      setFamilies(response.data.filter((f) => f.status === 'ATIVO'));
    } catch (error) { /* ignore */ }
  };

  const loadParties = async () => {
    try {
      const [clientsRes, suppliersRes] = await Promise.all([api.getClients(), api.getSuppliers()]);
      setParties([...clientsRes.data.map((c) => ({ name: c.name })), ...suppliersRes.data.map((s) => ({ name: s.name }))]);
    } catch (error) { /* ignore */ }
  };

  const resetForm = () => { setFormData(buildEmptyForm()); setEditId(null); };

  const openCreateDialog = async () => {
    resetForm();
    try {
      const r = await api.getProductNextCode();
      setNextCode(r.data?.next_code || 1);
    } catch (e) { setNextCode(null); }
    setOpen(true);
  };

  const openEditDialog = (item) => {
    setFormData({
      description: item.description || '',
      stock_quantity: item.stock_quantity?.toString() || '',
      warehouse_id: item.warehouse_id || '', warehouse_name: item.warehouse_name || '',
      barcode: item.barcode || '', ncm: item.ncm || '', cfop: item.cfop || '',
      unit: item.unit || 'UNIDADE', family_id: item.family_id || '', family_name: item.family_name || '',
      reference_value: item.reference_value?.toString() || '', icms_rate: item.icms_rate?.toString() || '',
      other_taxes_rate: item.other_taxes_rate?.toString() || '', origin: item.origin || 'NACIONAL',
      linked_party_name: item.linked_party_name || '', status: item.status || 'ATIVO', observations: item.observations || '',
      ca_number: item.ca_number || '',
    });
    setNextCode(item.code);
    setEditId(item.id);
    setOpen(true);
  };

  const setField = (name, value) => setFormData((p) => ({ ...p, [name]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!formData.description) {
      toast.error('Preencha a descrição do produto');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...formData,
        stock_quantity: Number(formData.stock_quantity || 0),
        reference_value: Number(formData.reference_value || 0),
        icms_rate: Number(formData.icms_rate || 0),
        other_taxes_rate: Number(formData.other_taxes_rate || 0),
      };
      if (editId) {
        await api.updateProduct(editId, payload);
        toast.success('Produto atualizado com sucesso');
      } else {
        await api.createProduct(payload);
        toast.success('Produto cadastrado com sucesso');
      }
      resetForm();
      setOpen(false);
      loadItems();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar produto');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm('Tem certeza que deseja deletar este produto?')) {
      try {
        await api.deleteProduct(id);
        toast.success('Produto deletado com sucesso');
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        loadItems();
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Erro ao deletar produto');
      }
    }
  };

  const openAdjust = (item) => {
    setAdjustForm({ counted: '', reason: '' });
    setAdjusting(item);
  };

  const adjustDifference = adjusting && adjustForm.counted !== ''
    ? Number(adjustForm.counted) - Number(adjusting.stock_quantity || 0)
    : null;

  const handleAdjust = async (e) => {
    e.preventDefault();
    if (savingAdjust || !adjusting) return;
    if (adjustForm.counted === '' || Number(adjustForm.counted) < 0) {
      toast.error('Informe a quantidade contada');
      return;
    }
    if (!adjustForm.reason.trim()) {
      toast.error('Informe o motivo do ajuste');
      return;
    }
    setSavingAdjust(true);
    try {
      await api.adjustProductStock(adjusting.id, { counted_quantity: Number(adjustForm.counted), reason: adjustForm.reason.trim() });
      toast.success('Saldo ajustado; a diferença foi lançada em Movimentação de Estoque');
      setAdjusting(null);
      loadItems();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao ajustar o saldo');
    } finally {
      setSavingAdjust(false);
    }
  };

  const filteredItems = items.filter((item) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return item.description?.toLowerCase().includes(term) || item.barcode?.toLowerCase().includes(term) || String(item.code).includes(term);
  });

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedIds(prev => {
      const pageIds = filteredItems.map(i => i.id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  };

  const singleSelectedItem = selectedIds.size === 1
    ? items.find(i => i.id === [...selectedIds][0])
    : null;

  return (
    <Layout>
      <div className="space-y-4" data-testid="product-page">
        <PageHeader icon={Package} title="Produto" subtitle="Cadastro de produtos do Estoque" />

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Código, descrição ou código de barras">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-product-input" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um produto pra habilitar as ações da barra */}
        <DataCard
          title="Produtos cadastrados"
          count={loading ? '...' : filteredItems.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo produto" onClick={openCreateDialog} testId="add-product-button" />}
            >
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => singleSelectedItem && openEditDialog(singleSelectedItem)} disabled={!singleSelectedItem} />
              <ToolbarButton icon={Scale} label="Ajustar saldo" tone="primary" onClick={() => singleSelectedItem && openAdjust(singleSelectedItem)} disabled={!singleSelectedItem} testId="adjust-stock-button" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)} disabled={!singleSelectedItem} />
            </Toolbar>
          )}
        >
          {filteredItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredItems.length > 0 && filteredItems.every(i => selectedIds.has(i.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th>Almoxarifado</th>
                    <th>Família</th>
                    <th className="!text-right">Saldo</th>
                    <th className="!text-right">Valor ref.</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <tr
                        key={item.id}
                        data-selected={isSelected}
                        className="cursor-pointer"
                        onClick={() => toggleSelect(item.id)}
                        data-testid="product-row"
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(item.id)}
                          />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">{item.code}</td>
                        <td><div className="max-w-[340px] truncate" title={item.description || ''}>{item.description}</div></td>
                        <td><div className="max-w-[180px] truncate" title={item.warehouse_name || ''}>{item.warehouse_name || '-'}</div></td>
                        <td><div className="max-w-[180px] truncate" title={item.family_name || ''}>{item.family_name || '-'}</div></td>
                        <td className="text-right whitespace-nowrap tabular-nums font-medium">{fmtQty(item.stock_quantity)}</td>
                        <td className="text-right whitespace-nowrap tabular-nums">{fmtMoney(item.reference_value)}</td>
                        <td>
                          <StatusPill tone={item.status === 'ATIVO' ? 'emerald' : 'slate'}>
                            {item.status === 'ATIVO' ? 'Ativo' : 'Inativo'}
                          </StatusPill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Package}
              title={loading ? 'Carregando...' : (search ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado')}
              hint={loading ? undefined : (search ? 'Ajuste a busca' : 'Cadastre o primeiro pelo botão "Novo produto" ou importe uma NF-e em Entradas de Estoque')}
            />
          )}
        </DataCard>
      </div>

      {/* Ajustar saldo */}
      <Dialog open={!!adjusting} onOpenChange={(isOpen) => { if (!isOpen) setAdjusting(null); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined} data-testid="adjust-stock-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="text-base flex items-center gap-2">
              <Scale className="w-4 h-4 text-primary" /> Ajustar saldo
            </DialogTitle>
          </DialogHeader>
          {adjusting && (
            <form onSubmit={handleAdjust} className="space-y-4">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{adjusting.description}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Saldo no sistema: <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtQty(adjusting.stock_quantity)}</span>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adjust_counted" className="text-[13px]">Quantidade contada *</Label>
                <Input
                  id="adjust_counted"
                  type="number"
                  step="0.001"
                  min="0"
                  value={adjustForm.counted}
                  onChange={(e) => setAdjustForm((p) => ({ ...p, counted: e.target.value }))}
                  className="h-10 text-[13px]"
                  data-testid="adjust-counted-input"
                />
                {adjustDifference !== null && (
                  <p className={`text-xs font-medium ${adjustDifference === 0 ? 'text-slate-500' : adjustDifference > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`} data-testid="adjust-difference">
                    {adjustDifference === 0
                      ? 'Igual ao saldo atual: não há o que ajustar.'
                      : adjustDifference > 0
                        ? `Será lançada uma Entrada de ${fmtQty(adjustDifference)}.`
                        : `Será lançada uma Saída de ${fmtQty(-adjustDifference)}.`}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adjust_reason" className="text-[13px]">Motivo *</Label>
                <Input
                  id="adjust_reason"
                  value={adjustForm.reason}
                  maxLength={120}
                  onChange={(e) => setAdjustForm((p) => ({ ...p, reason: e.target.value }))}
                  className="h-10 text-[13px]"
                  data-testid="adjust-reason-input"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAdjusting(null)}>Cancelar</Button>
                <Button type="submit" disabled={savingAdjust || adjustDifference === 0} data-testid="adjust-save-button">
                  {savingAdjust ? 'Ajustando...' : 'Ajustar saldo'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Cadastrar/Editar Produto */}
      <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="product-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="text-base flex items-center gap-2">
              {editId ? 'Editar Produto' : 'Cadastrar Produto'}
              {nextCode !== null && <Badge variant="outline">Cód. {nextCode}</Badge>}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-[13px]">Descrição do Produto *</Label>
                <Input value={formData.description} onChange={(e) => setField('description', e.target.value)} required className="h-10 text-[13px]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">{editId ? 'Saldo em Estoque' : 'Saldo Inicial'}</Label>
                {/* Na edição o saldo é só leitura: ele muda por Movimentação, NF-e, EPI ou "Ajustar saldo" */}
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.stock_quantity}
                  onChange={(e) => setField('stock_quantity', e.target.value)}
                  disabled={!!editId}
                  className="h-10 text-[13px]"
                  data-testid="product-stock-input"
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">
              {editId
                ? 'O saldo não é alterado por aqui. Para corrigi-lo, use "Ajustar saldo" na lista de produtos: a diferença fica registrada em Movimentação de Estoque.'
                : 'Se informar um saldo inicial, ele entra como uma Entrada em Movimentação de Estoque.'}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Almoxarifado</Label>
                <Autocomplete
                  value={formData.warehouse_name}
                  onChange={(v) => setField('warehouse_name', v)}
                  onSelect={(w) => { setField('warehouse_name', w.name); setField('warehouse_id', w.id); }}
                  options={warehouses}
                  displayField="name"
                  className="h-10 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Categoria/Família do Produto</Label>
                <Autocomplete
                  value={formData.family_name}
                  onChange={(v) => setField('family_name', v)}
                  onSelect={(f) => { setField('family_name', f.name); setField('family_id', f.id); }}
                  options={families}
                  displayField="name"
                  className="h-10 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Código de Barras/SKU</Label>
                <Input value={formData.barcode} onChange={(e) => setField('barcode', e.target.value)} className="h-10 text-[13px]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">NCM</Label>
                <Input value={formData.ncm} onChange={(e) => setField('ncm', e.target.value)} className="h-10 text-[13px]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">CFOP Padrão</Label>
                <Input value={formData.cfop} onChange={(e) => setField('cfop', e.target.value)} className="h-10 text-[13px]" />
              </div>
              {/* C.A. do EPI - preenche sozinho na Entrega de EPI's */}
              <div className="space-y-1.5">
                <Label className="text-[13px]">C.A. (se for EPI)</Label>
                <Input value={formData.ca_number} onChange={(e) => setField('ca_number', e.target.value)} className="h-10 text-[13px]" data-testid="product-ca-input" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Unidade de Medida</Label>
                <Select value={formData.unit} onValueChange={(v) => setField('unit', v)}>
                  <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v} className="text-sm">{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Origem da Mercadoria</Label>
                <Select value={formData.origin} onValueChange={(v) => setField('origin', v)}>
                  <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ORIGIN_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v} className="text-sm">{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Valor Unitário de Referência</Label>
                <Input type="number" step="0.01" value={formData.reference_value} onChange={(e) => setField('reference_value', e.target.value)} className="h-10 text-[13px]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Alíquota de ICMS (%)</Label>
                <Input type="number" step="0.01" value={formData.icms_rate} onChange={(e) => setField('icms_rate', e.target.value)} className="h-10 text-[13px]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Outros Impostos (%)</Label>
                <Input type="number" step="0.01" value={formData.other_taxes_rate} onChange={(e) => setField('other_taxes_rate', e.target.value)} className="h-10 text-[13px]" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Cliente/Fornecedor Vinculado</Label>
                <Autocomplete
                  value={formData.linked_party_name}
                  onChange={(v) => setField('linked_party_name', v)}
                  options={parties}
                  displayField="name"
                  className="h-10 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Status</Label>
                <Select value={formData.status} onValueChange={(v) => setField('status', v)}>
                  <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v} className="text-sm">{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Observações</Label>
              <Textarea value={formData.observations} onChange={(e) => setField('observations', e.target.value)} className="text-[13px] min-h-[60px]" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" className="text-[13px] font-semibold" data-testid="submit-product-button" disabled={submitting}>
                {submitting ? 'Salvando...' : (editId ? 'Atualizar' : 'Cadastrar')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
