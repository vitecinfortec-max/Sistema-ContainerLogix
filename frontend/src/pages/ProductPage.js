import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
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
import { Plus, Trash2, Edit, Search, Package } from 'lucide-react';

const UNIT_OPTIONS = [['KG', 'Kg'], ['TON', 'Toneladas'], ['M3', 'm³'], ['UNIDADE', 'Unidade'], ['CAIXA', 'Caixa'], ['PALLET', 'Pallet']];
const ORIGIN_OPTIONS = [['NACIONAL', 'Nacional'], ['IMPORTADO', 'Importado']];
const STATUS_OPTIONS = [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo']];

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function buildEmptyForm() {
  return {
    description: '', stock_quantity: '', warehouse_id: '', warehouse_name: '', barcode: '', ncm: '', cfop: '',
    unit: 'UNIDADE', family_id: '', family_name: '', reference_value: '', icms_rate: '',
    other_taxes_rate: '', origin: 'NACIONAL', linked_party_name: '', status: 'ATIVO', observations: '',
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
        toast.error('Erro ao deletar produto');
      }
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
      <div className="space-y-5" data-testid="product-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Produto</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Cadastro de produtos do Estoque</p>
        </div>

        {/* Filtrar */}
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
              <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 text-[13px] pl-9" data-testid="search-product-input" />
            </div>
          </CardContent>
        </Card>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openCreateDialog}
            className="h-9 w-9 p-0"
            title="Adicionar"
            data-testid="add-product-button"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && openEditDialog(singleSelectedItem)}
            disabled={!singleSelectedItem}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Editar"
          >
            <Edit className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)}
            disabled={!singleSelectedItem}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Excluir"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
          {selectedIds.size > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 pr-1">
              {selectedIds.size} selecionado(s)
            </span>
          )}
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Package className="w-4 h-4" />
              {loading ? 'Carregando...' : `Produtos Cadastrados (${filteredItems.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredItems.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left w-10">
                        <Checkbox
                          checked={filteredItems.length > 0 && filteredItems.every(i => selectedIds.has(i.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Código</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Descrição</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Almoxarifado</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Família</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Valor Ref.</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredItems.map((item) => {
                      const isSelected = selectedIds.has(item.id);
                      return (
                        <tr
                          key={item.id}
                          className={`cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          onClick={() => toggleSelect(item.id)}
                          data-testid="product-row"
                        >
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(item.id)}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-[13px] font-semibold text-primary">{item.code}</td>
                          <td className="px-4 py-2.5 text-[13px]">{item.description}</td>
                          <td className="px-4 py-2.5 text-[13px]">{item.warehouse_name || '-'}</td>
                          <td className="px-4 py-2.5 text-[13px]">{item.family_name || '-'}</td>
                          <td className="px-4 py-2.5 text-[13px]">{fmtMoney(item.reference_value)}</td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${item.status === 'ATIVO' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                              {item.status === 'ATIVO' ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-500 dark:text-slate-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">{search ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
                <Label className="text-[13px]">Quantidade em Estoque</Label>
                <Input type="number" step="0.01" value={formData.stock_quantity} onChange={(e) => setField('stock_quantity', e.target.value)} className="h-10 text-[13px]" />
              </div>
            </div>
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
            <div className="grid grid-cols-3 gap-4">
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
