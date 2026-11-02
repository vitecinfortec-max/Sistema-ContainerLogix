import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton } from '../components/DataPage';
import { Field, FormSection, FormActions } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { FileWarning, Plus, Trash2, X, ShieldCheck, Search, Loader2, Container, Wrench, Calculator } from 'lucide-react';
import { SIZE_TYPES, formatMoney, estimateCode, vistoriaCode, toNumber } from '../lib/repairEstimates';

const emptyItem = () => ({ description: '', quantity: 1, unit_price: '' });

function emptyForm() {
  return {
    container_number: '',
    vistoria_id: null,
    vistoria_number: null,
    client_name: '',
    shipping_line: '',
    size_type: '',
    items: [emptyItem()],
    discount: '',
    validity_days: 15,
    execution_days: '',
    observations: '',
  };
}

const asList = (res) => (Array.isArray(res.data) ? res.data : (res.data.items || []));

// Novo orçamento (/repair-estimates/new, ou ?vistoria=<id> vindo de "Gerar
// orçamento" na Vistoria de Container) e edição (/repair-estimates/:id/edit,
// só enquanto o orçamento está em aberto)
export default function RepairEstimateFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const backToList = () => navigate('/repair-estimates');

  const [loading, setLoading] = useState(true);
  const [editingEstimate, setEditingEstimate] = useState(null);
  const [formData, setFormData] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [vistoriaNumber, setVistoriaNumber] = useState('');
  const [lookingUpVistoria, setLookingUpVistoria] = useState(false);

  const [repairServices, setRepairServices] = useState([]);
  const [lastPrices, setLastPrices] = useState({});
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);

  const suggestedPrice = (description, prices = lastPrices) => {
    const price = prices[(description || '').trim().toLowerCase()];
    return price !== undefined ? price : '';
  };

  // Os "Tipo de Serviços" da vistoria entram como itens (sem repetir os já
  // lançados), com o último preço usado em cada um
  const fillFromVistoria = (form, vistoria, prices = lastPrices) => {
    const kept = form.items.filter((item) => item.description.trim());
    const existing = new Set(kept.map((item) => item.description.trim().toLowerCase()));
    const added = (vistoria.damage_items || [])
      .filter((name) => !existing.has(name.trim().toLowerCase()))
      .map((name) => ({ description: name, quantity: 1, unit_price: suggestedPrice(name, prices) }));
    const items = [...kept, ...added];
    return {
      ...form,
      vistoria_id: vistoria.id,
      vistoria_number: vistoria.vistoria_number,
      container_number: vistoria.container_number || form.container_number,
      client_name: vistoria.client_name || form.client_name,
      shipping_line: vistoria.shipping_line || form.shipping_line,
      size_type: vistoria.size_type || form.size_type,
      items: items.length ? items : [emptyItem()],
    };
  };

  useEffect(() => {
    // Cadastros de apoio podem estar desativados: aí os campos são só digitados
    api.getContainerRepairServices().then((res) => setRepairServices(asList(res))).catch(() => setRepairServices([]));
    api.getClients().then((res) => setClients(asList(res))).catch(() => setClients([]));
    api.getShippingLines().then((res) => setShippingLines(asList(res))).catch(() => setShippingLines([]));

    (async () => {
      // Preços sugeridos: buscados a cada abertura, pra já trazer o que foi
      // lançado desde a última vez
      const prices = await api.getRepairEstimatesLastPrices().then((res) => res.data).catch(() => ({}));
      setLastPrices(prices);
      try {
        if (isEdit) {
          const { data: estimate } = await api.getRepairEstimate(id);
          if (estimate.status !== 'EM_ABERTO') {
            toast.error(`O orçamento ${estimateCode(estimate.estimate_number)} não está em aberto e não pode ser editado`);
            backToList();
            return;
          }
          setEditingEstimate(estimate);
          setFormData({
            container_number: estimate.container_number,
            vistoria_id: estimate.vistoria_id || null,
            vistoria_number: estimate.vistoria_number || null,
            client_name: estimate.client_name || '',
            shipping_line: estimate.shipping_line || '',
            size_type: estimate.size_type || '',
            items: estimate.items.map((item) => ({ description: item.description, quantity: item.quantity, unit_price: item.unit_price })),
            discount: estimate.discount || '',
            validity_days: estimate.validity_days,
            execution_days: estimate.execution_days ?? '',
            observations: estimate.observations || '',
          });
        } else if (searchParams.get('vistoria')) {
          const { data: vistoria } = await api.getContainerVistoria(searchParams.get('vistoria'));
          setFormData(fillFromVistoria(emptyForm(), vistoria, prices));
        }
      } catch (error) {
        toast.error(error.response?.data?.detail || (isEdit ? 'Não foi possível carregar o orçamento' : 'Não foi possível carregar a vistoria'));
        if (isEdit) backToList();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Digita o nº da vistoria (123 ou VC000123) e Enter: puxa container,
  // cliente, armador, tamanho e os serviços marcados nela
  const lookupVistoria = async () => {
    const number = vistoriaNumber.trim();
    if (!number || lookingUpVistoria) return;
    setLookingUpVistoria(true);
    try {
      const res = await api.getContainerVistoriaByNumber(number);
      const vistoria = res.data;
      setFormData((prev) => fillFromVistoria(prev, vistoria));
      setVistoriaNumber('');
      if (vistoria.no_damage || !(vistoria.damage_items || []).length) {
        toast.warning(`${vistoriaCode(vistoria.vistoria_number)} não tem serviços de reparo marcados, inclua os itens manualmente`);
      } else {
        toast.success(`${vistoriaCode(vistoria.vistoria_number)}: ${vistoria.damage_items.length} serviço(s) incluído(s)`);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Vistoria não encontrada');
    } finally {
      setLookingUpVistoria(false);
    }
  };

  const setField = (field) => (value) => setFormData((prev) => ({ ...prev, [field]: value }));

  const setItem = (index, changes) => setFormData((prev) => ({
    ...prev,
    items: prev.items.map((item, i) => (i === index ? { ...item, ...changes } : item)),
  }));

  const pickService = (index, name) => {
    const current = formData.items[index];
    const changes = { description: name };
    if (current.unit_price === '' || toNumber(current.unit_price) === 0) changes.unit_price = suggestedPrice(name);
    setItem(index, changes);
  };

  const addItem = () => setFormData((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
  const removeItem = (index) => setFormData((prev) => ({
    ...prev,
    items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== index) : [emptyItem()],
  }));

  const subtotal = formData.items.reduce((sum, item) => sum + toNumber(item.quantity) * toNumber(item.unit_price), 0);
  const discount = toNumber(formData.discount);
  const total = subtotal - discount;

  const handleSubmit = async () => {
    if (!formData.container_number.trim()) {
      toast.error('Informe o número do container');
      return;
    }
    const items = formData.items.filter((item) => item.description.trim());
    if (items.length === 0) {
      toast.error('Inclua ao menos um serviço no orçamento');
      return;
    }
    if (items.some((item) => !(toNumber(item.quantity) > 0))) {
      toast.error('A quantidade de cada serviço deve ser maior que zero');
      return;
    }
    if (discount < 0 || discount > subtotal) {
      toast.error('O desconto não pode ser maior que o subtotal');
      return;
    }
    if (!(parseInt(formData.validity_days, 10) >= 1)) {
      toast.error('A validade deve ser de pelo menos 1 dia');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        container_number: formData.container_number,
        vistoria_id: formData.vistoria_id,
        client_name: formData.client_name,
        shipping_line: formData.shipping_line,
        size_type: formData.size_type,
        items: items.map((item) => ({ description: item.description, quantity: toNumber(item.quantity), unit_price: toNumber(item.unit_price) })),
        discount,
        validity_days: parseInt(formData.validity_days, 10),
        execution_days: formData.execution_days === '' ? null : parseInt(formData.execution_days, 10),
        observations: formData.observations,
      };
      if (editingEstimate) {
        await api.updateRepairEstimate(editingEstimate.id, payload);
        toast.success('Orçamento atualizado');
      } else {
        const res = await api.createRepairEstimate(payload);
        toast.success(`Orçamento ${estimateCode(res.data.estimate_number)} criado`);
      }
      backToList();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar orçamento');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4" data-testid="repair-estimate-form-page">
        <PageHeader
          icon={FileWarning}
          title={editingEstimate ? `Editar orçamento ${estimateCode(editingEstimate.estimate_number)}` : 'Novo orçamento de reparo'}
          subtitle="Orçamento dos reparos do container, para aprovação do cliente"
          backTo="/repair-estimates"
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            <FormSection title="Container" icon={Container}>
              <Field
                label="Vistoria de Container de origem"
                hint={formData.vistoria_id
                  ? 'Os serviços marcados na vistoria entraram como itens, com o último preço usado em cada um.'
                  : 'Opcional: digite o nº da vistoria (ex: 123 ou VC000123) e tecle Enter para puxar o container e os serviços.'}
              >
                {formData.vistoria_id ? (
                  <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 text-sm max-w-md">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    <span className="font-medium">{vistoriaCode(formData.vistoria_number)}</span>
                    <span className="text-muted-foreground truncate">{formData.container_number}</span>
                    <button
                      type="button" className="ml-auto text-muted-foreground hover:text-foreground" title="Desvincular vistoria" aria-label="Desvincular vistoria"
                      onClick={() => setFormData((prev) => ({ ...prev, vistoria_id: null, vistoria_number: null }))}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 max-w-sm">
                    <Input
                      className="h-9 font-mono uppercase"
                      value={vistoriaNumber}
                      aria-label="Nº da vistoria"
                      autoFocus={!isEdit}
                      onChange={(e) => setVistoriaNumber(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          lookupVistoria();
                        }
                      }}
                      data-testid="estimate-vistoria-number-input"
                    />
                    <Button type="button" variant="outline" className="h-9" onClick={lookupVistoria} disabled={!vistoriaNumber.trim() || lookingUpVistoria} data-testid="estimate-vistoria-lookup">
                      {lookingUpVistoria ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin motion-reduce:animate-none" /> : <Search className="w-4 h-4 mr-1.5" />}
                      Puxar
                    </Button>
                  </div>
                )}
              </Field>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Nº do container" required>
                  <Input className="h-9 font-mono uppercase" value={formData.container_number} onChange={(e) => setField('container_number')(e.target.value.toUpperCase())} data-testid="estimate-container-input" />
                </Field>
                <Field label="Tamanho/Tipo">
                  <Select value={formData.size_type || 'NONE'} onValueChange={(v) => setField('size_type')(v === 'NONE' ? '' : v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">-</SelectItem>
                      {SIZE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Cliente" className="col-span-2 md:col-span-1">
                  <Autocomplete value={formData.client_name} onChange={setField('client_name')} options={clients} displayField="name" valueField="id" onSelect={(c) => setField('client_name')(c.name)} testId="estimate-client-input" />
                </Field>
                <Field label="Armador" className="col-span-2 md:col-span-1">
                  <Autocomplete value={formData.shipping_line} onChange={setField('shipping_line')} options={shippingLines} displayField="name" valueField="id" onSelect={(s) => setField('shipping_line')(s.name)} testId="estimate-shipping-line-input" />
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Serviços de reparo"
              icon={Wrench}
              actions={(
                <Button type="button" variant="outline" size="sm" onClick={addItem} data-testid="estimate-add-item">
                  <Plus className="w-4 h-4 mr-1" /> Adicionar serviço
                </Button>
              )}
            >
              <div className="space-y-2">
                <div className="hidden md:grid grid-cols-[1fr_80px_120px_110px_32px] gap-2 text-xs font-medium text-muted-foreground px-0.5">
                  <span>Serviço</span><span>Qtd.</span><span>Valor unit. (R$)</span><span className="text-right">Total</span><span />
                </div>
                {formData.items.map((item, index) => (
                  <div key={index} className="grid grid-cols-[1fr_32px] md:grid-cols-[1fr_80px_120px_110px_32px] gap-2 items-center rounded-md md:rounded-none border md:border-0 border-slate-200 dark:border-slate-700 p-2 md:p-0">
                    <Autocomplete
                      value={item.description}
                      onChange={(text) => setItem(index, { description: text })}
                      options={repairServices}
                      displayField="name"
                      valueField="id"
                      onSelect={(service) => pickService(index, service.name)}
                      testId={`estimate-item-description-${index}`}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-8 md:order-last text-muted-foreground hover:text-destructive" onClick={() => removeItem(index)} title="Remover serviço" aria-label="Remover serviço">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <div className="col-span-2 md:col-span-1 grid grid-cols-3 md:contents gap-2">
                      <Input className="h-9" type="number" step="1" min="0" value={item.quantity} onChange={(e) => setItem(index, { quantity: e.target.value })} aria-label="Quantidade" data-testid={`estimate-item-qty-${index}`} />
                      <Input className="h-9" type="number" step="0.01" min="0" value={item.unit_price} onChange={(e) => setItem(index, { unit_price: e.target.value })} aria-label="Valor unitário" data-testid={`estimate-item-price-${index}`} />
                      <div className="h-9 flex items-center justify-end text-sm font-medium tabular-nums">{formatMoney(toNumber(item.quantity) * toNumber(item.unit_price))}</div>
                    </div>
                  </div>
                ))}
              </div>
            </FormSection>

            <FormSection title="Condições e total" icon={Calculator}>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-4">
                <div className="grid grid-cols-2 gap-3 content-start">
                  <Field label="Validade (dias)" required>
                    <Input className="h-9" type="number" min="1" value={formData.validity_days} onChange={(e) => setField('validity_days')(e.target.value)} />
                  </Field>
                  <Field label="Prazo de execução (dias)" hint="Após a aprovação">
                    <Input className="h-9" type="number" min="0" value={formData.execution_days} onChange={(e) => setField('execution_days')(e.target.value)} />
                  </Field>
                  <Field label="Observações" className="col-span-2">
                    <Textarea rows={3} value={formData.observations} onChange={(e) => setField('observations')(e.target.value)} />
                  </Field>
                </div>
                <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-2 text-sm self-start">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums font-medium">{formatMoney(subtotal)}</span></div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Desconto (R$)</span>
                    <Input className="h-8 w-28 text-right" type="number" step="0.01" min="0" value={formData.discount} onChange={(e) => setField('discount')(e.target.value)} data-testid="estimate-discount-input" />
                  </div>
                  <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2 text-base">
                    <span className="font-semibold">Total</span>
                    <span className={`tabular-nums font-bold ${total < 0 ? 'text-destructive' : 'text-primary'}`} data-testid="estimate-total">{formatMoney(total)}</span>
                  </div>
                </div>
              </div>
            </FormSection>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={backToList}>Cancelar</Button>
              <Button type="button" onClick={handleSubmit} disabled={saving} data-testid="estimate-save-btn">
                {saving ? 'Salvando...' : (editingEstimate ? 'Salvar alterações' : 'Criar orçamento')}
              </Button>
            </FormActions>
          </div>
        )}
      </div>
    </Layout>
  );
}
