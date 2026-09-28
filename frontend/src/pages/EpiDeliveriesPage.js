import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider,
  ToolbarPrimary, StatusPill, EmptyState,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Autocomplete, OptionAutocomplete } from '../components/Autocomplete';
import { SignatureCaptureDialog, signatureSrc } from '../components/SignaturePad';
import { useConfirm } from '../hooks/useConfirm';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  HardHat, Plus, Pencil, Trash2, Save, FileSignature, FileText, PenLine, Users, PackageCheck, AlertTriangle,
} from 'lucide-react';

const TYPE_LABELS = { MOTORISTA: 'Motorista', FUNCIONARIO: 'Funcionário' };
const SIGNATURE_KIND = { MOTORISTA: 'motorista', FUNCIONARIO: 'funcionario' };

const fmtQty = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtDate = (v) => (v ? format(new Date(`${String(v).slice(0, 10)}T00:00:00`), 'dd/MM/yyyy') : '-');
const today = () => format(new Date(), 'yyyy-MM-dd');

function buildEmpty() {
  return {
    recipient_type: '', recipient_id: '', recipient_label: '',
    delivery_date: today(),
    warehouse_id: '', warehouse_name: '',
    items: [emptyItem()],
    observations: '',
  };
}

function emptyItem() {
  return { product_id: '', product_code: null, product_description: '', unit: '', quantity: 1, ca_number: '' };
}

function downloadBlob(data, filename) {
  const url = window.URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function EpiDeliveriesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [people, setPeople] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [nextNumber, setNextNumber] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signSaving, setSignSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    loadDeliveries();
    loadPeople();
    loadProducts();
    api.getWarehouses().then((r) => setWarehouses(r.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDeliveries = async (term = search, from = dateFrom, to = dateTo) => {
    setLoading(true);
    try {
      const params = {};
      if (term) params.search = term;
      if (from) params.date_from = from;
      if (to) params.date_to = to;
      const r = await api.getEpiDeliveries(params);
      setDeliveries(r.data || []);
      setSelectedIds(new Set());
    } catch (e) {
      toast.error("Erro ao carregar as entregas de EPI's");
    } finally {
      setLoading(false);
    }
  };

  // Motoristas + Funcionários numa lista só pra busca da entrega
  const loadPeople = async () => {
    const [drivers, employees] = await Promise.all([
      api.getDrivers().then((r) => r.data || []).catch(() => []),
      api.getEmployees({ per_page: 1000 }).then((r) => r.data || []).catch(() => []),
    ]);
    setPeople([
      ...employees.map((p) => ({ ...p, _type: 'FUNCIONARIO' })),
      ...drivers.map((p) => ({ ...p, _type: 'MOTORISTA' })),
    ].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')));
  };

  const loadProducts = () => api.getProducts().then((r) => setProducts(r.data || [])).catch(() => {});

  const personLabel = (p) => `${p.name}${p.cpf ? ` - ${p.cpf}` : ''} (${TYPE_LABELS[p._type]})`;
  const selectedPerson = useMemo(
    () => people.find((p) => p.id === form.recipient_id && p._type === form.recipient_type) || null,
    [people, form.recipient_id, form.recipient_type],
  );

  // ===== Diálogo =====
  const openCreate = async () => {
    const empty = buildEmpty();
    if (warehouses.length === 1) {
      empty.warehouse_id = warehouses[0].id;
      empty.warehouse_name = warehouses[0].name;
    }
    setForm(empty);
    setEditingId(null);
    setNextNumber(null);
    setDialogOpen(true);
    try {
      const r = await api.getEpiDeliveryNextNumber();
      setNextNumber(r.data?.next_number || 1);
    } catch (e) { /* só exibição */ }
  };

  const openEdit = async (id) => {
    try {
      const { data: d } = await api.getEpiDelivery(id);
      const person = people.find((p) => p.id === d.recipient_id && p._type === d.recipient_type);
      setForm({
        recipient_type: d.recipient_type,
        recipient_id: d.recipient_id,
        recipient_label: person ? personLabel(person) : `${d.recipient_name} (${TYPE_LABELS[d.recipient_type]})`,
        delivery_date: d.delivery_date,
        warehouse_id: d.warehouse_id,
        warehouse_name: d.warehouse_name,
        items: (d.items || []).map((it) => ({ ...it, ca_number: it.ca_number || '' })),
        observations: d.observations || '',
      });
      setEditingId(id);
      setNextNumber(d.delivery_number);
      setDialogOpen(true);
    } catch (e) {
      toast.error('Erro ao carregar a entrega');
    }
  };

  const setField = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  const onPersonInput = (value) => setForm((p) => ({ ...p, recipient_label: value, recipient_id: '', recipient_type: '' }));
  const onPersonSelect = (person) => setForm((p) => ({
    ...p, recipient_label: personLabel(person), recipient_id: person.id, recipient_type: person._type,
  }));

  const setItem = (idx, field, value) => setForm((p) => {
    const items = [...p.items];
    items[idx] = { ...items[idx], [field]: value };
    return { ...p, items };
  });
  const onItemInput = (idx, value) => setForm((p) => {
    const items = [...p.items];
    items[idx] = { ...items[idx], product_description: value, product_id: '', product_code: null };
    return { ...p, items };
  });
  const onItemSelect = (idx, product) => setForm((p) => {
    const items = [...p.items];
    items[idx] = {
      ...items[idx],
      product_id: product.id,
      product_code: product.code,
      product_description: product.description,
      unit: product.unit || '',
      // C.A. vem do cadastro do Produto; pode ser ajustado aqui
      ca_number: product.ca_number || items[idx].ca_number || '',
    };
    return { ...p, items };
  });
  const addItem = () => setForm((p) => ({ ...p, items: [...p.items, emptyItem()] }));
  const removeItem = (idx) => setForm((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));

  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const productLabel = (p) => `${p.description} (saldo: ${fmtQty(p.stock_quantity)}${p.unit ? ` ${p.unit}` : ''})`;

  const handleSave = async () => {
    if (!form.recipient_id) { toast.error('Selecione o Motorista ou Funcionário na lista'); return; }
    if (!form.delivery_date) { toast.error('Informe a data da entrega'); return; }
    if (!form.warehouse_id) { toast.error('Selecione o Almoxarifado'); return; }
    if (!form.items.length) { toast.error('Adicione ao menos um EPI'); return; }
    for (const it of form.items) {
      if (!it.product_id) { toast.error('Selecione o EPI (produto do estoque) em todas as linhas'); return; }
      if (!(Number(it.quantity) > 0)) { toast.error('Informe uma quantidade válida em todas as linhas'); return; }
    }
    setSaving(true);
    try {
      const payload = {
        recipient_type: form.recipient_type,
        recipient_id: form.recipient_id,
        delivery_date: form.delivery_date,
        warehouse_id: form.warehouse_id,
        warehouse_name: form.warehouse_name,
        observations: form.observations || null,
        items: form.items.map((it) => ({
          product_id: it.product_id,
          product_code: it.product_code,
          product_description: it.product_description,
          unit: it.unit || null,
          quantity: Number(it.quantity),
          ca_number: (it.ca_number || '').trim() || null,
        })),
      };
      if (editingId) {
        await api.updateEpiDelivery(editingId, payload);
        toast.success('Entrega de EPI atualizada');
      } else {
        const r = await api.createEpiDelivery(payload);
        toast.success(`Entrega Nº ${r.data.delivery_number} registrada e baixada do estoque`);
      }
      setDialogOpen(false);
      loadDeliveries();
      loadProducts();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar a entrega');
    } finally {
      setSaving(false);
    }
  };

  // "Assinar agora": grava a assinatura direto no cadastro da pessoa
  const saveSignature = async (dataUrl) => {
    if (!selectedPerson) return;
    setSignSaving(true);
    try {
      const r = await api.updatePersonSignature(SIGNATURE_KIND[selectedPerson._type], selectedPerson.id, dataUrl);
      setPeople((prev) => prev.map((p) => (p.id === selectedPerson.id && p._type === selectedPerson._type
        ? { ...p, signature_url: r.data.signature_url } : p)));
      toast.success('Assinatura salva no cadastro');
      setSignOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar a assinatura');
    } finally {
      setSignSaving(false);
    }
  };

  // ===== Ações da lista =====
  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => setSelectedIds((prev) => (
    deliveries.length > 0 && deliveries.every((d) => prev.has(d.id)) ? new Set() : new Set(deliveries.map((d) => d.id))
  ));
  const single = selectedIds.size === 1 ? deliveries.find((d) => d.id === [...selectedIds][0]) : null;

  const handleDelete = async () => {
    if (!single) return;
    const ok = await confirm(
      `Excluir a entrega Nº ${single.delivery_number} de ${single.recipient_name}? Os EPIs voltam para o estoque.`,
      'Excluir entrega',
    );
    if (!ok) return;
    try {
      await api.deleteEpiDelivery(single.id);
      toast.success('Entrega excluída e itens devolvidos ao estoque');
      loadDeliveries();
      loadProducts();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao excluir a entrega');
    }
  };

  const downloadTermo = async () => {
    if (!single) return;
    setDownloading(true);
    try {
      const r = await api.getEpiDeliveryPDF(single.id);
      downloadBlob(r.data, `Termo_Entrega_EPI_${single.delivery_number}.pdf`);
    } catch (e) {
      toast.error('Erro ao gerar o Termo de Entrega');
    } finally {
      setDownloading(false);
    }
  };

  // Ficha de EPI da pessoa da entrega selecionada: todas as entregas dela
  // (ou só as do período, se o filtro de datas estiver preenchido)
  const downloadFicha = async () => {
    if (!single) return;
    setDownloading(true);
    try {
      const params = { recipient_type: single.recipient_type, recipient_id: single.recipient_id };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const r = await api.getEpiFichaPDF(params);
      downloadBlob(r.data, `Ficha_EPI_${(single.recipient_name || 'pessoa').replace(/[^A-Za-z0-9]+/g, '_')}.pdf`);
    } catch (e) {
      toast.error('Erro ao gerar a Ficha de EPI');
    } finally {
      setDownloading(false);
    }
  };

  const clearFilters = () => {
    setSearch(''); setDateFrom(''); setDateTo('');
    loadDeliveries('', '', '');
  };

  // ===== Indicadores =====
  const totalItems = deliveries.reduce((acc, d) => acc + Number(d.total_quantity || 0), 0);
  const peopleServed = new Set(deliveries.map((d) => `${d.recipient_type}:${d.recipient_id}`)).size;
  const pendingSignatures = deliveries.filter((d) => !d.has_signature).length;
  const hasFilters = !!(search || dateFrom || dateTo);
  const warehouseOptions = warehouses.map((w) => [w.id, w.name]);

  return (
    <Layout>
      <div className="space-y-4" data-testid="epi-deliveries-page">
        <PageHeader
          icon={HardHat}
          title="Entrega de EPI's"
          subtitle="Registre os EPIs entregues a cada motorista ou funcionário, com baixa no estoque e assinatura no termo"
        />

        <StatGrid>
          <StatCard label="Entregas" value={deliveries.length} icon={PackageCheck} tone="primary" testId="epi-kpi-deliveries" />
          <StatCard label="EPIs entregues" value={fmtQty(totalItems)} icon={HardHat} tone="blue" testId="epi-kpi-items" />
          <StatCard label="Pessoas atendidas" value={peopleServed} icon={Users} tone="slate" testId="epi-kpi-people" />
          <StatCard label="Sem assinatura" value={pendingSignatures} icon={AlertTriangle} tone={pendingSignatures ? 'amber' : 'slate'} hint={pendingSignatures ? 'cadastre a assinatura da pessoa' : undefined} testId="epi-kpi-unsigned" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={clearFilters} onApply={() => loadDeliveries()}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Nome, CPF, EPI ou C.A." className="col-span-2">
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadDeliveries()}
                data-testid="epi-search-input"
              />
            </FilterField>
            <FilterField label="Data inicial">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-sm" data-testid="epi-date-from" />
            </FilterField>
            <FilterField label="Data final">
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-sm" data-testid="epi-date-to" />
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Entregas"
          count={loading ? '...' : deliveries.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova entrega" onClick={openCreate} testId="epi-new-btn" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && openEdit(single.id)} disabled={!single} testId="epi-edit-btn" />
              <ToolbarButton icon={Trash2} label="Excluir (devolve ao estoque)" tone="red" onClick={handleDelete} disabled={!single} testId="epi-delete-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={FileSignature} label="Termo de Entrega (PDF)" tone="emerald" onClick={downloadTermo} disabled={!single || downloading} testId="epi-termo-btn" />
              <ToolbarButton icon={FileText} label="Ficha de EPI da pessoa (PDF)" tone="primary" onClick={downloadFicha} disabled={!single || downloading} testId="epi-ficha-btn" />
            </Toolbar>
          )}
        >
          {deliveries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={deliveries.length > 0 && deliveries.every((d) => selectedIds.has(d.id))}
                        onCheckedChange={toggleSelectAll}
                        data-testid="epi-select-all"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Recebido por</th>
                    <th>EPIs</th>
                    <th className="!text-right">Qtd</th>
                    <th>Assinatura</th>
                    <th>Lançado por</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => {
                    const itemsText = (d.items || []).map((it) => `${it.product_description} (${fmtQty(it.quantity)})`).join(', ');
                    return (
                      <tr
                        key={d.id}
                        onClick={() => toggleSelect(d.id)}
                        data-selected={selectedIds.has(d.id)}
                        className="cursor-pointer"
                        data-testid="epi-row"
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selectedIds.has(d.id)} onCheckedChange={() => toggleSelect(d.id)} data-testid={`epi-row-checkbox-${d.delivery_number}`} />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{d.delivery_number}</td>
                        <td className="whitespace-nowrap tabular-nums">{fmtDate(d.delivery_date)}</td>
                        <td>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="cell-strong max-w-[220px] truncate" title={d.recipient_name}>{d.recipient_name}</span>
                            <StatusPill tone={d.recipient_type === 'FUNCIONARIO' ? 'blue' : 'slate'} dot={false} className="text-[10px] px-1.5">
                              {TYPE_LABELS[d.recipient_type]}
                            </StatusPill>
                          </div>
                        </td>
                        <td><div className="max-w-[300px] truncate" title={itemsText}>{itemsText || '-'}</div></td>
                        <td className="text-right tabular-nums">{fmtQty(d.total_quantity)}</td>
                        <td>
                          <StatusPill tone={d.has_signature ? 'emerald' : 'amber'}>{d.has_signature ? 'Assinada' : 'Pendente'}</StatusPill>
                        </td>
                        <td className="whitespace-nowrap text-slate-500 dark:text-slate-400">{d.created_by_name || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={HardHat}
              title={loading ? 'Carregando...' : (hasFilters ? 'Nenhuma entrega encontrada' : 'Nenhuma entrega de EPI registrada')}
              hint={loading ? undefined : (hasFilters ? 'Ajuste os filtros' : 'Registre a primeira pelo botão "Nova entrega"')}
              testId="epi-empty"
            />
          )}
        </DataCard>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(v) => !saving && setDialogOpen(v)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="epi-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <HardHat className="w-5 h-5 text-primary" />
              {editingId ? 'Editar Entrega de EPI' : 'Nova Entrega de EPI'}
              {nextNumber !== null && <Badge variant="outline" className="ml-2 text-primary border-primary/30">Nº {nextNumber}</Badge>}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-3">
                <Label className="mb-1 block text-[13px]">Motorista ou Funcionário *</Label>
                <Autocomplete
                  value={form.recipient_label}
                  onChange={onPersonInput}
                  onSelect={onPersonSelect}
                  options={people}
                  displayField={personLabel}
                  className="text-sm"
                  testId="epi-person-input"
                />
              </div>

              {selectedPerson && (
                <div className="sm:col-span-3 flex flex-wrap items-center gap-4 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3" data-testid="epi-person-card">
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{selectedPerson.name}</div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {TYPE_LABELS[selectedPerson._type]}
                      {selectedPerson.cpf ? ` · CPF ${selectedPerson.cpf}` : ''}
                      {selectedPerson.position ? ` · ${selectedPerson.position}` : ''}
                      {selectedPerson.department ? ` · ${selectedPerson.department}` : ''}
                    </div>
                  </div>
                  {selectedPerson.signature_url ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="h-12 w-36 rounded border border-slate-200 dark:border-slate-700 bg-white flex items-center justify-center overflow-hidden">
                        <img src={signatureSrc(selectedPerson.signature_url)} alt="Assinatura" className="max-h-full max-w-full object-contain p-1" />
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSignOpen(true)} data-testid="epi-resign-btn">Trocar</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone="amber">Sem assinatura no cadastro</StatusPill>
                      <Button type="button" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setSignOpen(true)} data-testid="epi-sign-now-btn">
                        <PenLine className="w-3.5 h-3.5" />Assinar agora
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div>
                <Label className="mb-1 block text-[13px]">Data da entrega *</Label>
                <Input type="date" value={form.delivery_date} onChange={(e) => setField('delivery_date', e.target.value)} className="h-9 text-sm" data-testid="epi-date-input" />
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1 block text-[13px]">Almoxarifado (baixa do estoque) *</Label>
                <OptionAutocomplete
                  value={form.warehouse_id}
                  onChange={(v) => setForm((p) => ({ ...p, warehouse_id: v, warehouse_name: warehouses.find((w) => w.id === v)?.name || '' }))}
                  options={warehouseOptions}
                  className="text-sm"
                  testId="epi-warehouse-input"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-primary">EPIs entregues</h3>
                <Button variant="outline" size="sm" type="button" onClick={addItem} className="h-7 text-xs" data-testid="epi-add-item">
                  <Plus className="w-3 h-3 mr-1" />Adicionar EPI
                </Button>
              </div>
              {form.items.length === 0 && (
                <div className="text-center py-4 text-[12px] text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded">
                  Nenhum EPI adicionado
                </div>
              )}
              {form.items.map((it, idx) => {
                const product = productById[it.product_id];
                const overStock = product && Number(it.quantity) > Number(product.stock_quantity || 0) && !editingId;
                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700" data-testid="epi-item-row">
                    <div className="col-span-12 sm:col-span-6">
                      <Label className="text-xs mb-1 block">EPI (produto do estoque)</Label>
                      <Autocomplete
                        value={it.product_description || ''}
                        onChange={(v) => onItemInput(idx, v)}
                        onSelect={(p) => onItemSelect(idx, p)}
                        options={products}
                        displayField={productLabel}
                        className="h-8 text-sm"
                        testId={`epi-item-product-${idx}`}
                      />
                      {product && (
                        <p className={`text-[11px] mt-1 ${overStock ? 'text-red-600' : 'text-slate-500 dark:text-slate-400'}`}>
                          Saldo em estoque: {fmtQty(product.stock_quantity)}{product.unit ? ` ${product.unit}` : ''}
                          {overStock ? ' - insuficiente para esta quantidade' : ''}
                        </p>
                      )}
                    </div>
                    <div className="col-span-5 sm:col-span-3">
                      <Label className="text-xs mb-1 block">C.A.</Label>
                      <Input value={it.ca_number} onChange={(e) => setItem(idx, 'ca_number', e.target.value)} className="h-8 text-sm" data-testid={`epi-item-ca-${idx}`} />
                    </div>
                    <div className="col-span-5 sm:col-span-2">
                      <Label className="text-xs mb-1 block">Qtd</Label>
                      <Input type="number" min="0" step="1" value={it.quantity} onChange={(e) => setItem(idx, 'quantity', e.target.value)} className="h-8 text-sm text-right" data-testid={`epi-item-qty-${idx}`} />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(idx)} className="h-8 px-2 text-red-500 hover:text-red-700" title="Remover EPI">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <Label className="mb-1 block text-[13px]">Observações</Label>
              <Textarea value={form.observations} onChange={(e) => setField('observations', e.target.value)} className="text-sm min-h-[60px]" data-testid="epi-obs-input" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="epi-save-btn">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : editingId ? 'Atualizar entrega' : 'Registrar entrega'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignatureCaptureDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        personName={selectedPerson?.name}
        onSave={saveSignature}
        saving={signSaving}
      />
      <ConfirmDialog />
    </Layout>
  );
}
