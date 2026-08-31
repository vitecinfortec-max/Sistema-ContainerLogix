import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { ComboField } from '../components/ui/combo-field';
import { Autocomplete } from '../components/Autocomplete';
import { CityStateFields } from '../components/AddressFields';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Download, Search, Save, X, FileText } from 'lucide-react';

const STATUS_COLORS = {
  ABERTO: 'bg-blue-100 text-blue-700',
  ANDAMENTO: 'bg-amber-100 text-amber-700',
  FECHADO: 'bg-emerald-100 text-emerald-700',
  CANCELADO: 'bg-rose-100 text-rose-700',
};

const fmtMoney = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function OrdemServicoPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [nextNumber, setNextNumber] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [osCategories, setOsCategories] = useState([]);
  const [productCatalog, setProductCatalog] = useState([]);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const debounceRef = useRef(null);

  // Pessoa/Supervisor/Técnico/Ajudante buscam nos cadastros de Motorista +
  // Funcionário combinados (unificados na tela /cadastro) - _type marca de
  // qual registro veio, pra guardar junto do id selecionado.
  const people = [
    ...drivers.map((d) => ({ ...d, _type: 'motorista' })),
    ...employees.map((e) => ({ ...e, _type: 'funcionario' })),
  ];

  // Normaliza Produto/Cadastro de Serviço (Fases 6-7) pro mesmo formato
  // usado pelas linhas de Produtos e Serviços da OS.
  const productCatalogOptions = productCatalog.map((p) => ({
    code: String(p.code), description: p.description, unit: p.unit, price: p.reference_value,
  }));
  const serviceCatalogOptions = serviceCatalog.map((s) => ({
    code: String(s.code), description: s.description, unit: s.unit, price: s.value,
  }));

  useEffect(() => {
    loadList(); loadVehicles(); loadDrivers(); loadEmployees(); loadOsCategories();
    loadProductCatalog(); loadServiceCatalog();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadList(); }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search, statusFilter]);

  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;
      const r = await api.getOrdensServico(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar Ordens de Serviço');
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
  const loadEmployees = async () => {
    try {
      const r = await api.getEmployees();
      setEmployees(r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadOsCategories = async () => {
    try {
      const r = await api.getOSCategories();
      setOsCategories((r.data || []).filter((c) => c.active));
    } catch (e) { /* ignore */ }
  };
  const loadProductCatalog = async () => {
    try {
      const r = await api.getProducts();
      setProductCatalog((r.data || []).filter((p) => p.status === 'ATIVO'));
    } catch (e) { /* ignore */ }
  };
  const loadServiceCatalog = async () => {
    try {
      const r = await api.getServiceCatalog();
      setServiceCatalog((r.data || []).filter((s) => s.active));
    } catch (e) { /* ignore */ }
  };

  const reset = () => setForm(buildEmpty());

  const openCreate = async () => {
    reset();
    setEditingId(null);
    try {
      const r = await api.getOrdemServicoNextNumber();
      setNextNumber(r.data?.next_number || 1);
    } catch (e) { setNextNumber(null); }
    setDialogOpen(true);
  };

  const openEdit = async (id) => {
    try {
      const r = await api.getOrdemServico(id);
      const d = r.data;
      setEditingId(id);
      setNextNumber(d.os_number);
      setForm({
        ...buildEmpty(),
        ...d,
        products: d.products?.length ? d.products : [],
        services: d.services?.length ? d.services : [],
      });
      setDialogOpen(true);
    } catch (e) { toast.error('Erro ao carregar OS'); }
  };

  const onChange = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const setItem = (kind, idx, field, val) => {
    setForm((p) => {
      const arr = [...(p[kind] || [])];
      const item = { ...arr[idx], [field]: val };
      const q = Number(field === 'quantity' ? val : item.quantity || 0);
      const up = Number(field === 'unit_price' ? val : item.unit_price || 0);
      const ds = Number(field === 'discount' ? val : item.discount || 0);
      item.total = q * up - ds;
      arr[idx] = item;
      return { ...p, [kind]: arr };
    });
  };

  const addItem = (kind) => setForm((p) => ({
    ...p, [kind]: [...(p[kind] || []), { code: '', description: '', quantity: 1, unit: kind === 'services' ? 'quantidade' : 'UN', unit_price: 0, discount: 0, total: 0 }]
  }));
  const removeItem = (kind, idx) => setForm((p) => ({
    ...p, [kind]: (p[kind] || []).filter((_, i) => i !== idx)
  }));

  const totals = () => {
    const pt = (form.products || []).reduce((a, i) => a + Number(i.total || 0), 0);
    const st = (form.services || []).reduce((a, i) => a + Number(i.total || 0), 0);
    return { products_total: pt, services_total: st, grand_total: pt + st };
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        reading_initial: Number(form.reading_initial || 0),
        reading_final: Number(form.reading_final || 0),
        products: (form.products || []).map((i) => ({
          ...i,
          quantity: Number(i.quantity || 0),
          unit_price: Number(i.unit_price || 0),
          discount: Number(i.discount || 0),
          total: Number(i.total || 0),
        })),
        services: (form.services || []).map((i) => ({
          ...i,
          quantity: Number(i.quantity || 0),
          unit_price: Number(i.unit_price || 0),
          discount: Number(i.discount || 0),
          total: Number(i.total || 0),
        })),
      };
      if (editingId) {
        await api.updateOrdemServico(editingId, payload);
        toast.success('OS atualizada!');
      } else {
        await api.createOrdemServico(payload);
        toast.success('OS criada!');
      }
      setDialogOpen(false);
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id, num) => {
    if (!(await confirm(`Excluir OS Nº ${num}?`))) return;
    try {
      await api.deleteOrdemServico(id);
      toast.success('OS excluída');
      loadList();
    } catch (e) { toast.error('Erro ao excluir'); }
  };

  const downloadPDF = async (id, num) => {
    try {
      const r = await api.getOrdemServicoPDF(id);
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `OS_${num}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('PDF gerado!');
    } catch (e) { toast.error('Erro ao gerar PDF'); }
  };

  const t = totals();

  return (
    <Layout>
      <div className="space-y-5" data-testid="ordem-servico-page">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Ordem de Serviço</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Gestão de OS para manutenção da frota</p>
          </div>
          <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="os-new-btn">
            <Plus className="w-4 h-4 mr-2" />Nova OS
          </Button>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700" />

        <Card className="shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative max-w-md flex-1 min-w-[280px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <Input placeholder="Buscar por cliente, placa, descrição..." value={search}
                  onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-[13px]" data-testid="os-search" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-[13px] w-44" data-testid="os-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="ABERTO">Aberto</SelectItem>
                  <SelectItem value="ANDAMENTO">Em Andamento</SelectItem>
                  <SelectItem value="FECHADO">Fechado</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] text-slate-700 dark:text-slate-300">
              {loading ? 'Carregando...' : `${list.length} Ordem(s) de Serviço`}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-800">
                    <TableHead className="text-[12px] font-semibold">Nº</TableHead>
                    <TableHead className="text-[12px] font-semibold">Abertura</TableHead>
                    <TableHead className="text-[12px] font-semibold">Pessoa</TableHead>
                    <TableHead className="text-[12px] font-semibold">Placa</TableHead>
                    <TableHead className="text-[12px] font-semibold">Categoria</TableHead>
                    <TableHead className="text-[12px] font-semibold">Status</TableHead>
                    <TableHead className="text-[12px] font-semibold text-right">Total</TableHead>
                    <TableHead className="text-[12px] font-semibold text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.length === 0 && !loading && (
                    <TableRow><TableCell colSpan={8} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">Nenhuma OS cadastrada.</TableCell></TableRow>
                  )}
                  {list.map((o) => (
                    <TableRow key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800" data-testid={`os-row-${o.os_number}`}>
                      <TableCell className="text-[13px] font-semibold text-emerald-700">Nº {o.os_number}</TableCell>
                      <TableCell className="text-[12px]">{o.opened_at ? format(new Date(o.opened_at), 'dd/MM/yyyy HH:mm') : '-'}</TableCell>
                      <TableCell className="text-[13px]">{o.person_name || '-'}</TableCell>
                      <TableCell className="text-[12px] font-mono">{o.equipment_plate || '-'}</TableCell>
                      <TableCell className="text-[12px]">{o.category || '-'}</TableCell>
                      <TableCell><Badge variant="secondary" className={`text-[10px] ${STATUS_COLORS[o.status] || ''}`}>{o.status}</Badge></TableCell>
                      <TableCell className="text-[13px] font-semibold text-right text-emerald-700">{fmtMoney(o.grand_total)}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => downloadPDF(o.id, o.os_number)} className="h-8 px-2" data-testid={`os-pdf-${o.os_number}`} title="Baixar PDF">
                            <Download className="w-3.5 h-3.5 text-emerald-600" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(o.id)} className="h-8 px-2" data-testid={`os-edit-${o.os_number}`} title="Editar">
                            <Pencil className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(o.id, o.os_number)} className="h-8 px-2" data-testid={`os-del-${o.os_number}`} title="Excluir">
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto" data-testid="os-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              {editingId ? 'Editar Ordem de Serviço' : 'Nova Ordem de Serviço'}
              {nextNumber !== null && <Badge variant="outline" className="ml-2 text-emerald-700 border-emerald-300">Nº {nextNumber}</Badge>}
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="basicos" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="basicos" data-testid="os-tab-basicos">Dados Básicos</TabsTrigger>
              <TabsTrigger value="produtos" data-testid="os-tab-produtos">Produtos e Serviços</TabsTrigger>
            </TabsList>

            <TabsContent value="basicos" className="space-y-5">
              <SectionTitle>Dados da O.S.</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <SelectField label="Prioridade *" value={form.priority} onChange={(v) => onChange('priority', v)} options={[['ALTA', 'Alta'], ['MEDIA', 'Média'], ['BAIXA', 'Baixa']]} testid="os-priority" />
                <SelectField label="Tipo *" value={form.os_type} onChange={(v) => onChange('os_type', v)} options={[['INTERNO', 'Interno'], ['EXTERNO', 'Externo']]} testid="os-type" />
                <SelectField label="Status *" value={form.status} onChange={(v) => onChange('status', v)} options={[['ABERTO', 'Aberto'], ['ANDAMENTO', 'Em Andamento'], ['FECHADO', 'Fechado'], ['CANCELADO', 'Cancelado']]} testid="os-status" />
                <div>
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Categoria *</Label>
                  <ComboField
                    value={form.category}
                    onChange={(v) => onChange('category', v)}
                    options={osCategories.map((c) => [c.name, c.name])}
                    placeholder="-- Selecione --"
                    searchPlaceholder="Buscar categoria..."
                    emptyLabel="Nenhuma categoria encontrada"
                    testid="os-category"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Equipamento (Placa)</Label>
                  <Autocomplete
                    value={form.equipment_plate}
                    onChange={(v) => onChange('equipment_plate', v)}
                    onSelect={(vh) => { onChange('equipment_plate', vh.plate); onChange('equipment_id', vh.id); }}
                    options={vehicles}
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    placeholder="Digite para buscar a placa..."
                    className="h-9 text-sm font-mono"
                  />
                </div>
                <Field label="Apropriação (Equip. Agregador)" value={form.appropriation_plate} onChange={(v) => onChange('appropriation_plate', v)} testid="os-approp" />
                <div>
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Pessoa *</Label>
                  <Autocomplete
                    value={form.person_name}
                    onChange={(v) => onChange('person_name', v)}
                    onSelect={(p) => { onChange('person_name', p.name); onChange('person_id', p.id); onChange('person_type', p._type); }}
                    options={people}
                    displayField="name"
                    placeholder="Digite para buscar..."
                    className="h-9 text-sm"
                  />
                </div>
                <Field label="CPF/CNPJ" value={form.person_doc} onChange={(v) => onChange('person_doc', v)} testid="os-person-doc" />
                <Field label="Telefone" value={form.contact_value} onChange={(v) => onChange('contact_value', v)} testid="os-phone" />
                <Field label="Endereço *" value={form.address} onChange={(v) => onChange('address', v)} testid="os-address" />
                <CityStateFields
                  flat
                  value={{ city: form.city, state: form.state }}
                  onChange={({ city, state }) => {
                    onChange('city', city);
                    onChange('state', state);
                    onChange('city_uf', city && state ? `${city}/${state}` : (city || state || ''));
                  }}
                />
                {!form.city && !form.state && form.city_uf && (
                  <p className="col-span-3 text-[11px] text-slate-400 dark:text-slate-500 -mt-2">
                    Cidade/UF cadastrada anteriormente (texto livre): {form.city_uf}
                  </p>
                )}
                <CheckboxField label="Retorno" value={form.is_retorno} onChange={(v) => onChange('is_retorno', v)} />
              </div>

              <SectionTitle>Prazos</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <Field type="datetime-local" label="Abertura *" value={form.opened_at} onChange={(v) => onChange('opened_at', v)} testid="os-opened" />
                <Field type="datetime-local" label="Orçamento" value={form.budget_at} onChange={(v) => onChange('budget_at', v)} testid="os-budget" />
                <Field type="datetime-local" label="Aprovação" value={form.approved_at} onChange={(v) => onChange('approved_at', v)} testid="os-approved" />
                <Field type="datetime-local" label="Prev. Fechamento" value={form.forecast_close_at} onChange={(v) => onChange('forecast_close_at', v)} testid="os-forecast" />
                <Field type="datetime-local" label="Fechamento" value={form.closed_at} onChange={(v) => onChange('closed_at', v)} testid="os-closed" />
                <CheckboxField label="Exige PT?" value={form.requires_pt} onChange={(v) => onChange('requires_pt', v)} />
              </div>

              <SectionTitle>Equipe e Supervisão</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Supervisor</Label>
                  <Autocomplete
                    value={form.supervisor_name}
                    onChange={(v) => onChange('supervisor_name', v)}
                    onSelect={(p) => { onChange('supervisor_name', p.name); onChange('supervisor_id', p.id); onChange('supervisor_type', p._type); }}
                    options={people}
                    displayField="name"
                    placeholder="Digite para buscar..."
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Técnico</Label>
                  <Autocomplete
                    value={form.technician_name}
                    onChange={(v) => onChange('technician_name', v)}
                    onSelect={(p) => { onChange('technician_name', p.name); onChange('technician_id', p.id); onChange('technician_type', p._type); }}
                    options={people}
                    displayField="name"
                    placeholder="Digite para buscar..."
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Ajudante</Label>
                  <Autocomplete
                    value={form.helper_name}
                    onChange={(v) => onChange('helper_name', v)}
                    onSelect={(p) => { onChange('helper_name', p.name); onChange('helper_id', p.id); onChange('helper_type', p._type); }}
                    options={people}
                    displayField="name"
                    placeholder="Digite para buscar..."
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <SectionTitle>Controle de Uso</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Field type="number" label="Leitura Inicial (KM/HR)" value={form.reading_initial} onChange={(v) => onChange('reading_initial', v)} testid="os-rd-ini" />
                <Field type="number" label="Leitura Final (KM/HR)" value={form.reading_final} onChange={(v) => onChange('reading_final', v)} testid="os-rd-fim" />
              </div>

              <SectionTitle>Descrição da O.S.</SectionTitle>
              <div className="space-y-3">
                <TextAreaField label="Detalhamento da Demanda" value={form.description} onChange={(v) => onChange('description', v)} testid="os-desc" />
                <TextAreaField label="Ações Associadas" value={form.associated_actions} onChange={(v) => onChange('associated_actions', v)} testid="os-actions" />
                <TextAreaField label="Parecer de Encerramento" value={form.closure_remark} onChange={(v) => onChange('closure_remark', v)} testid="os-closure" />
                <TextAreaField label="Observação" value={form.observations} onChange={(v) => onChange('observations', v)} testid="os-obs" />
              </div>
            </TabsContent>

            <TabsContent value="produtos" className="space-y-5">
              <ItemsSection title="Produtos" items={form.products || []} kind="products"
                onAdd={() => addItem('products')} onRemove={(i) => removeItem('products', i)}
                onChange={(i, f, v) => setItem('products', i, f, v)}
                catalogOptions={productCatalogOptions}
                showUnit={true} />

              <ItemsSection title="Serviços" items={form.services || []} kind="services"
                onAdd={() => addItem('services')} onRemove={(i) => removeItem('services', i)}
                onChange={(i, f, v) => setItem('services', i, f, v)}
                catalogOptions={serviceCatalogOptions}
                showUnit={true} />

              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                <TotalBox label="Total Produtos" value={t.products_total} />
                <TotalBox label="Total Serviços" value={t.services_total} />
                <TotalBox label="VALOR TOTAL" value={t.grand_total} highlight />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="os-cancel">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="os-save">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : editingId ? 'Atualizar OS' : 'Salvar OS'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}

function buildEmpty() {
  return {
    priority: 'MEDIA', requires_pt: false, os_type: 'EXTERNO', status: 'ABERTO',
    category: '', equipment_plate: '', equipment_id: '', person_doc: '', person_name: '',
    person_id: '', person_type: '',
    address: '', city_uf: '', city: '', state: '', is_retorno: false, contact_type: 'banco', contact_value: '',
    opened_at: new Date().toISOString().slice(0, 16),
    budget_at: '', approved_at: '', forecast_close_at: '', closed_at: '',
    appropriation_plate: '', supervision_type: 'outros', supervision_value: '',
    reading_initial: 0, reading_final: 0,
    description: '', associated_actions: '', closure_remark: '',
    observations: '',
    helper_name: '', helper_id: '', helper_type: '',
    technician_name: '', technician_id: '', technician_type: '',
    supervisor_name: '', supervisor_id: '', supervisor_type: '',
    products: [], services: [],
  };
}

function SectionTitle({ children }) {
  return (
    <h3 className="text-[12px] font-bold uppercase tracking-wider text-emerald-700 border-b-2 border-emerald-200 pb-1">
      {children}
    </h3>
  );
}

function Field({ label, value, onChange, type = 'text', testid, placeholder }) {
  return (
    <div>
      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">{label}</Label>
      <Input type={type} value={value ?? ''} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} className="h-9 text-sm" data-testid={testid} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, testid }) {
  return (
    <div>
      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">{label}</Label>
      <Select value={value || '_empty'} onValueChange={(v) => onChange(v === '_empty' ? '' : v)}>
        <SelectTrigger className="h-9 text-sm" data-testid={testid}><SelectValue placeholder="-- Selecione --" /></SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v || '_empty'} value={v || '_empty'} className="text-sm">{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CheckboxField({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-2 mt-5">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      <Label className="text-[12px] text-slate-700 dark:text-slate-300">{label}</Label>
    </div>
  );
}

function TextAreaField({ label, value, onChange, testid }) {
  return (
    <div>
      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">{label}</Label>
      <Textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="text-sm min-h-[60px]" data-testid={testid} />
    </div>
  );
}

function ItemsSection({ title, items, kind, onAdd, onRemove, onChange, showUnit, catalogOptions = [] }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-emerald-700">{title}</h3>
        <Button variant="outline" size="sm" type="button" onClick={onAdd} className="h-7 text-xs">
          <Plus className="w-3 h-3 mr-1" />Adicionar {title === 'Produtos' ? 'Produto' : 'Serviço'}
        </Button>
      </div>
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-center py-4 text-[12px] text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded">
            Nenhum {title === 'Produtos' ? 'produto' : 'serviço'} adicionado
          </div>
        )}
        {items.map((it, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
            <div className="col-span-2">
              <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Código</Label>
              <Input value={it.code || ''} onChange={(e) => onChange(idx, 'code', e.target.value)} className="h-8 text-sm" data-testid={`${kind}-code-${idx}`} />
            </div>
            <div className="col-span-4">
              <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Descrição</Label>
              <Autocomplete
                value={it.description || ''}
                onChange={(v) => onChange(idx, 'description', v)}
                onSelect={(cat) => {
                  onChange(idx, 'description', cat.description);
                  onChange(idx, 'code', cat.code);
                  if (cat.unit) onChange(idx, 'unit', cat.unit);
                  onChange(idx, 'unit_price', cat.price ?? 0);
                }}
                options={catalogOptions}
                displayField="description"
                placeholder="Digite para buscar no catálogo..."
                className="h-8 text-sm"
              />
            </div>
            <div className="col-span-1">
              <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Qtd</Label>
              <Input type="number" step="0.01" value={it.quantity ?? ''} onChange={(e) => onChange(idx, 'quantity', e.target.value)} className="h-8 text-sm text-right" data-testid={`${kind}-qty-${idx}`} />
            </div>
            {showUnit && (
              <div className="col-span-1">
                <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Un.</Label>
                <Input value={it.unit || ''} onChange={(e) => onChange(idx, 'unit', e.target.value)} className="h-8 text-sm" data-testid={`${kind}-unit-${idx}`} />
              </div>
            )}
            <div className="col-span-1">
              <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">V. Unit.</Label>
              <Input type="number" step="0.01" value={it.unit_price ?? ''} onChange={(e) => onChange(idx, 'unit_price', e.target.value)} className="h-8 text-sm text-right" data-testid={`${kind}-unitprice-${idx}`} />
            </div>
            <div className="col-span-1">
              <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Desc.</Label>
              <Input type="number" step="0.01" value={it.discount ?? ''} onChange={(e) => onChange(idx, 'discount', e.target.value)} className="h-8 text-sm text-right" data-testid={`${kind}-disc-${idx}`} />
            </div>
            <div className="col-span-1">
              <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Total</Label>
              <Input value={fmtMoney(it.total)} readOnly className="h-8 text-sm text-right font-semibold bg-white dark:bg-slate-900" />
            </div>
            <div className="col-span-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(idx)} className="h-8 px-2 text-red-500 hover:text-red-700">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TotalBox({ label, value, highlight }) {
  return (
    <div className={`p-3 rounded-lg border-2 ${highlight ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800'}`}>
      <div className={`text-[10px] uppercase tracking-wider ${highlight ? 'text-emerald-700' : 'text-slate-500 dark:text-slate-400'} font-semibold`}>{label}</div>
      <div className={`text-xl font-bold ${highlight ? 'text-emerald-700' : 'text-slate-800 dark:text-slate-200'}`}>{fmtMoney(value)}</div>
    </div>
  );
}
