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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ComboField } from '../components/ui/combo-field';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Search, Save, PackageCheck, Download } from 'lucide-react';
import { formatContainerNumber } from '../lib/containerNumber';

const ORDER_TYPE_OPTIONS = [
  ['COLETA', 'Coleta de Container'],
  ['ENTREGA', 'Entrega de Container'],
];
const ORDER_TYPE_LABELS = ORDER_TYPE_OPTIONS.reduce((acc, [v, l]) => { acc[v] = l; return acc; }, {});

const STATUS_OPTIONS = [
  ['PENDENTE', 'Pendente'],
  ['APROVADA', 'Aprovada'],
  ['CANCELADA', 'Cancelada'],
];
const STATUS_LABELS = STATUS_OPTIONS.reduce((acc, [v, l]) => { acc[v] = l; return acc; }, {});
const STATUS_BADGE_CLASS = {
  PENDENTE: 'bg-amber-100 text-amber-700',
  APROVADA: 'bg-emerald-100 text-emerald-700',
  CANCELADA: 'bg-rose-100 text-rose-700',
};

const SIZE_TYPE_OPTIONS = [
  ['20DC', '20DC'], ['20RF', '20RF'], ['20OT', '20OT'], ['20FR', '20FR'],
  ['40HC', '40HC'], ['40RF', '40RF'], ['40OT', '40OT'], ['40FR', '40FR'], ['40DRY', '40DRY'],
];

function buildEmpty() {
  return {
    order_type: 'COLETA',
    status: 'PENDENTE',
    collection_window: '',
    origin_terminal: '',
    port: '',
    container_number: '',
    size_type: '',
    gross_weight: '',
    seal: '',
    shipping_line: '',
    booking: '',
    quantity: 1,
    driver_id: '', driver_name: '', driver_cpf: '',
    transport_company: '',
    truck_plate: '',
    trailer_plate: '',
    observations: '',
  };
}

export default function LoadingOrderPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [nextNumber, setNextNumber] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);
  const [drivers, setDrivers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const debounceRef = useRef(null);

  useEffect(() => { loadList(); loadDrivers(); loadCompanies(); loadVehicles(); loadShippingLines(); }, []);

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
      const r = await api.getLoadingOrders(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar ordens de carregamento');
    } finally {
      setLoading(false);
    }
  };

  const loadDrivers = async () => {
    try {
      const r = await api.getDrivers();
      setDrivers(r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadCompanies = async () => {
    try {
      const r = await api.getCompanies();
      setCompanies(r.data?.items || r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadVehicles = async () => {
    try {
      const r = await api.getVehicles();
      setVehicles(r.data?.items || r.data || []);
    } catch (e) { /* ignore */ }
  };
  const loadShippingLines = async () => {
    try {
      const r = await api.getShippingLines();
      setShippingLines(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const reset = () => setForm(buildEmpty());

  const openCreate = async () => {
    reset();
    setEditingId(null);
    try {
      const r = await api.getLoadingOrderNextNumber();
      setNextNumber(r.data?.next_number || 1);
    } catch (e) { setNextNumber(null); }
    setDialogOpen(true);
  };

  const openEdit = async (id) => {
    try {
      const r = await api.getLoadingOrder(id);
      const d = r.data;
      setEditingId(id);
      setNextNumber(d.order_number);
      setForm({ ...buildEmpty(), ...d });
      setDialogOpen(true);
    } catch (e) { toast.error('Erro ao carregar ordem de carregamento'); }
  };

  const onChange = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const onSelectDriver = (d) => {
    setForm((p) => ({ ...p, driver_id: d.id, driver_name: d.name, driver_cpf: d.cpf || p.driver_cpf }));
  };

  const handleSave = async () => {
    if (!form.container_number || !form.driver_name) {
      toast.error('Preencha os campos obrigatórios (Container e Motorista)');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, quantity: Number(form.quantity || 1) };
      if (editingId) {
        await api.updateLoadingOrder(editingId, payload);
        toast.success('Ordem de Carregamento atualizada!');
      } else {
        await api.createLoadingOrder(payload);
        toast.success('Ordem de Carregamento criada!');
      }
      setDialogOpen(false);
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar ordem de carregamento');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id, num) => {
    if (!(await confirm(`Excluir Ordem de Carregamento Nº ${num}?`))) return;
    try {
      await api.deleteLoadingOrder(id);
      toast.success('Ordem de Carregamento excluída');
      loadList();
    } catch (e) { toast.error('Erro ao excluir'); }
  };

  const downloadPDF = async (id, num) => {
    try {
      const r = await api.getLoadingOrderPDF(id);
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `OrdemCarregamento_${num}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('PDF gerado!');
    } catch (e) { toast.error('Erro ao gerar PDF'); }
  };

  return (
    <Layout>
      <div className="space-y-5" data-testid="loading-order-page">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <PackageCheck className="w-4 h-4" />
              Ordem de Carregamento
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Minutas de coleta e entrega de container pro motorista</p>
          </div>
          <Button onClick={openCreate} className="text-[13px] font-semibold uppercase tracking-wide h-10 px-5 bg-primary hover:bg-primary/90" data-testid="loading-order-new-btn">
            <Plus className="w-4 h-4 mr-1.5" />
            Nova Ordem de Carregamento
          </Button>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700" />

        <Card className="shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <Input value={search}
                onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-[13px]" data-testid="loading-order-search" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] text-slate-700 dark:text-slate-300">
              {loading ? 'Carregando...' : `Ordens de Carregamento Registradas (${list.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-800">
                    <TableHead className="text-[12px] font-semibold">Nº</TableHead>
                    <TableHead className="text-[12px] font-semibold">Tipo</TableHead>
                    <TableHead className="text-[12px] font-semibold">Container</TableHead>
                    <TableHead className="text-[12px] font-semibold">Motorista</TableHead>
                    <TableHead className="text-[12px] font-semibold">Transportadora</TableHead>
                    <TableHead className="text-[12px] font-semibold">Status</TableHead>
                    <TableHead className="text-[12px] font-semibold">Emissão</TableHead>
                    <TableHead className="text-[12px] font-semibold text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.length === 0 && !loading && (
                    <TableRow><TableCell colSpan={8} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">Nenhuma ordem de carregamento cadastrada.</TableCell></TableRow>
                  )}
                  {list.map((o) => (
                    <TableRow key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800" data-testid={`loading-order-row-${o.order_number}`}>
                      <TableCell className="text-[13px] font-semibold text-primary">Nº {o.order_number}</TableCell>
                      <TableCell className="text-[12px]">{ORDER_TYPE_LABELS[o.order_type] || o.order_type}</TableCell>
                      <TableCell className="text-[12px] font-mono">{o.container_number || '-'}</TableCell>
                      <TableCell className="text-[13px]">{o.driver_name || '-'}</TableCell>
                      <TableCell className="text-[13px]">{o.transport_company || '-'}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_BADGE_CLASS[o.status] || 'bg-slate-100 text-slate-600'}`}>
                          {STATUS_LABELS[o.status] || o.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-[12px]">{o.created_at ? format(new Date(o.created_at), 'dd/MM/yyyy HH:mm') : '-'}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => downloadPDF(o.id, o.order_number)} className="h-8 px-2" data-testid={`loading-order-pdf-${o.order_number}`} title="Baixar PDF">
                            <Download className="w-3.5 h-3.5 text-emerald-600" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(o.id)} className="h-8 px-2" data-testid={`loading-order-edit-${o.order_number}`} title="Editar">
                            <Pencil className="w-3.5 h-3.5 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(o.id, o.order_number)} className="h-8 px-2" data-testid={`loading-order-del-${o.order_number}`} title="Excluir">
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
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="loading-order-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-primary" />
              {editingId ? 'Editar Ordem de Carregamento' : 'Nova Ordem de Carregamento'}
              {nextNumber !== null && <Badge variant="outline" className="ml-2 text-primary border-primary/30">Nº {nextNumber}</Badge>}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <SectionTitle>Dados do Agendamento e Controle</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <SelectField label="Tipo *" value={form.order_type} onChange={(v) => onChange('order_type', v)} options={ORDER_TYPE_OPTIONS} testid="loading-order-type" />
              <SelectField label="Status" value={form.status} onChange={(v) => onChange('status', v)} options={STATUS_OPTIONS} testid="loading-order-status" />
              <Field label="Janela" value={form.collection_window} onChange={(v) => onChange('collection_window', v)} testid="loading-order-window" />
            </div>

            <SectionTitle>Origem e Destino</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Terminal de Origem" value={form.origin_terminal} onChange={(v) => onChange('origin_terminal', v)} testid="loading-order-origin" />
              <Field label="Porto" value={form.port} onChange={(v) => onChange('port', v)} testid="loading-order-port" />
            </div>

            <SectionTitle>Especificações do Container e Carga</SectionTitle>
            <div className="grid grid-cols-4 gap-3">
              <Field label="ID do Container *" value={form.container_number} onChange={(v) => onChange('container_number', v.toUpperCase())} onBlur={(e) => onChange('container_number', formatContainerNumber(e.target.value))} testid="loading-order-container" />
              <SelectField label="Tipo/Tamanho" value={form.size_type} onChange={(v) => onChange('size_type', v)} options={SIZE_TYPE_OPTIONS} testid="loading-order-size" />
              <Field label="Peso Bruto" value={form.gross_weight} onChange={(v) => onChange('gross_weight', v)} testid="loading-order-weight" />
              <Field label="Lacre (Seal)" value={form.seal} onChange={(v) => onChange('seal', v)} testid="loading-order-seal" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <ComboField label="Armador" value={form.shipping_line} onChange={(v) => onChange('shipping_line', v)} options={shippingLines.map((s) => [s.name, s.name])}
                searchPlaceholder="Buscar armador..." emptyLabel="Nenhum armador encontrado" testid="loading-order-shipping-line" />
              <Field label="Booking/Ref." value={form.booking} onChange={(v) => onChange('booking', v)} testid="loading-order-booking" />
              <Field type="number" label="Quantidade" value={form.quantity} onChange={(v) => onChange('quantity', v)} testid="loading-order-quantity" />
            </div>

            <SectionTitle>Dados do Transporte (Transportador/Motorista)</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Motorista <span className="text-red-500">*</span></Label>
                <Autocomplete
                  value={form.driver_name}
                  onChange={(v) => onChange('driver_name', v)}
                  onSelect={onSelectDriver}
                  options={drivers}
                  displayField="name"
                  className="h-9 text-sm"
                />
              </div>
              <Field label="CPF" value={form.driver_cpf} onChange={(v) => onChange('driver_cpf', v)} testid="loading-order-cpf" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Transportadora Contratada</Label>
                <Autocomplete
                  value={form.transport_company}
                  onChange={(v) => onChange('transport_company', v)}
                  options={companies}
                  displayField="name"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Placa do Cavalo</Label>
                <Autocomplete
                  value={form.truck_plate}
                  onChange={(v) => onChange('truck_plate', v.toUpperCase())}
                  onSelect={(v) => onChange('truck_plate', v.plate)}
                  options={vehicles}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  className="h-9 text-sm font-mono"
                />
              </div>
              <div>
                <Label className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Placa da Carreta</Label>
                <Autocomplete
                  value={form.trailer_plate}
                  onChange={(v) => onChange('trailer_plate', v.toUpperCase())}
                  onSelect={(v) => onChange('trailer_plate', v.plate)}
                  options={vehicles}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  className="h-9 text-sm font-mono"
                />
              </div>
            </div>

            <TextAreaField label="Observações" value={form.observations} onChange={(v) => onChange('observations', v)} testid="loading-order-observations" />
          </div>

          <DialogFooter>
            {editingId && (
              <Button variant="outline" onClick={() => downloadPDF(editingId, nextNumber)} data-testid="loading-order-print" title="Baixar PDF">
                <Download className="w-4 h-4 mr-2" />Imprimir
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="loading-order-cancel">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90" data-testid="loading-order-save">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : editingId ? 'Atualizar Ordem' : 'Salvar Ordem'}
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

function Field({ label, value, onChange, onBlur, type = 'text', testid }) {
  return (
    <div>
      <Label className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide"><RequiredLabel label={label} /></Label>
      <Input type={type} value={value ?? ''}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur} className="h-9 text-sm" data-testid={testid} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, testid }) {
  return (
    <div>
      <Label className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide"><RequiredLabel label={label} /></Label>
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

function TextAreaField({ label, value, onChange, testid }) {
  return (
    <div>
      <Label className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">{label}</Label>
      <Textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="text-sm min-h-[60px]" data-testid={testid} />
    </div>
  );
}
