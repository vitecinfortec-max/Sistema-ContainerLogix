import { useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { PRODUCT_UNITS } from '../lib/productUnits';
import { formatCNPJ, formatCnpjCpf, formatCPF, formatPhone, formatPlate } from '../lib/masks';

// Cadastro rápido dentro de um formulário (o "+" ao lado do campo, como no
// Bsoft): quando falta a rota, o armador, o motorista... a pessoa cadastra
// ali mesmo, com os campos essenciais, e o registro novo já volta
// selecionado. O cadastro completo continua na tela de cada cadastro.

const parseMoney = (v) => {
  const n = Number(String(v || '').replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

const VEHICLE_TYPES = [
  ['CAVALO', 'Cavalo Mecânico'],
  ['CARRETA', 'Carreta'],
  ['CAMINHÃO', 'Caminhão'],
  ['VAN', 'Van'],
  ['EQUIPAMENTO', 'Outro Equipamento'],
];

export const QUICK_CREATE = {
  route: {
    title: 'Nova rota',
    done: 'Rota cadastrada',
    fields: [
      { key: 'origin', label: 'Origem', required: true },
      { key: 'destination', label: 'Destino', required: true },
      { key: 'freight_value', label: 'Valor do frete (R$)', required: true, placeholder: '0,00', money: true },
    ],
    create: (d) => api.createFreightRoute({ ...d, freight_value: parseMoney(d.freight_value), status: 'ATIVO' }),
  },
  shipping_line: {
    title: 'Novo armador',
    done: 'Armador cadastrado',
    fields: [
      { key: 'name', label: 'Nome', required: true, upper: true },
      { key: 'code', label: 'Código', upper: true },
    ],
    create: (d) => api.createShippingLine(d),
  },
  client: {
    title: 'Novo cliente',
    done: 'Cliente cadastrado',
    fields: [
      { key: 'name', label: 'Razão social / Nome', required: true },
      { key: 'cnpj', label: 'CNPJ / CPF', mask: formatCnpjCpf },
      { key: 'phone', label: 'Telefone', mask: formatPhone },
    ],
    create: (d) => api.createClient(d),
  },
  driver: {
    title: 'Novo motorista',
    done: 'Motorista cadastrado',
    fields: [
      { key: 'name', label: 'Nome', required: true },
      { key: 'cpf', label: 'CPF', required: true, mask: formatCPF },
      { key: 'phone', label: 'Telefone', mask: formatPhone },
      { key: 'cnh_number', label: 'Nº da CNH' },
    ],
    create: (d) => api.createDriver(d),
  },
  vehicle: {
    title: 'Novo veículo',
    done: 'Veículo cadastrado',
    fields: [
      { key: 'plate', label: 'Placa', required: true, mask: formatPlate },
      { key: 'vehicle_type', label: 'Tipo', required: true, options: VEHICLE_TYPES },
      { key: 'brand', label: 'Marca' },
      { key: 'model', label: 'Modelo' },
    ],
    create: (d) => api.createVehicle(d),
  },
  company: {
    title: 'Nova transportadora',
    done: 'Transportadora cadastrada',
    fields: [
      { key: 'name', label: 'Razão social', required: true },
      { key: 'cnpj', label: 'CNPJ', mask: formatCNPJ },
      { key: 'antt', label: 'RNTRC / ANTT' },
    ],
    create: (d) => api.createTransportCompany(d),
  },
  representative: {
    title: 'Novo representante',
    done: 'Representante cadastrado',
    fields: [
      { key: 'name', label: 'Nome', required: true },
      { key: 'phone', label: 'Telefone', mask: formatPhone },
      { key: 'email', label: 'E-mail' },
    ],
    create: (d) => api.createContainerRepresentative(d),
  },
  terminal: {
    title: 'Novo terminal',
    done: 'Terminal cadastrado',
    fields: [
      { key: 'name', label: 'Nome', required: true },
      { key: 'cnpj', label: 'CNPJ', mask: formatCNPJ },
      { key: 'phone', label: 'Telefone', mask: formatPhone },
    ],
    create: (d) => api.createTerminal(d),
  },
  supplier: {
    title: 'Novo fornecedor',
    done: 'Fornecedor cadastrado',
    fields: [
      { key: 'name', label: 'Razão social / Nome', required: true },
      { key: 'cnpj', label: 'CNPJ / CPF', mask: formatCnpjCpf },
      { key: 'phone', label: 'Telefone', mask: formatPhone },
    ],
    create: (d) => api.createSupplier(d),
  },
  employee: {
    title: 'Novo funcionário',
    done: 'Funcionário cadastrado',
    fields: [
      { key: 'name', label: 'Nome', required: true },
      { key: 'cpf', label: 'CPF', required: true, mask: formatCPF },
      { key: 'position', label: 'Cargo' },
      { key: 'phone', label: 'Telefone', mask: formatPhone },
    ],
    create: (d) => api.createEmployee(d),
  },
  service_type: {
    title: 'Novo tipo de serviço',
    done: 'Tipo de serviço cadastrado',
    fields: [
      { key: 'name', label: 'Nome', required: true, upper: true },
      { key: 'description', label: 'Descrição' },
    ],
    create: (d) => api.createServiceType(d),
  },
  product: {
    title: 'Novo produto',
    done: 'Produto cadastrado',
    fields: [
      { key: 'description', label: 'Descrição', required: true, upper: true },
      { key: 'unit', label: 'Unidade', options: PRODUCT_UNITS.map(([v, l]) => [v, l]) },
      { key: 'reference_value', label: 'Valor de referência (R$)', placeholder: '0,00', money: true },
    ],
    create: (d) => api.createProduct({ ...d, reference_value: parseMoney(d.reference_value) || 0 }),
  },
  service: {
    title: 'Novo serviço',
    done: 'Serviço cadastrado',
    fields: [
      { key: 'description', label: 'Descrição', required: true, upper: true },
      { key: 'unit', label: 'Unidade', options: [['QUANTIDADE', 'Quantidade'], ['HORAS', 'Horas'], ['OUTROS', 'Outros']] },
      { key: 'value', label: 'Valor (R$)', placeholder: '0,00', money: true },
    ],
    create: (d) => api.createServiceCatalogItem({ ...d, value: parseMoney(d.value) || 0 }),
  },
};

/** Campo + botão "+" lado a lado: `children` é o campo; o resto vai pro QuickAddButton. */
export function WithQuickAdd({ children, ...buttonProps }) {
  return (
    <div className="flex gap-1.5">
      <div className="flex-1 min-w-0">{children}</div>
      <QuickAddButton {...buttonProps} />
    </div>
  );
}

function emptyValues(config, initial) {
  const values = {};
  config.fields.forEach((f) => {
    const given = initial && initial[f.key];
    values[f.key] = given ? (f.mask ? f.mask(given) : given) : (f.options ? f.options[0][0] : '');
  });
  return values;
}

/**
 * Botão "+" ao lado de um campo. `kind` é uma chave de QUICK_CREATE;
 * `initial` pré-preenche (ex.: o nome que a pessoa já digitou);
 * `onCreated(registro)` recebe o cadastro salvo pra selecionar no campo.
 */
export function QuickAddButton({ kind, initial, onCreated, size = 'md', className, testId }) {
  const config = QUICK_CREATE[kind];
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  const openDialog = () => {
    setValues(emptyValues(config, typeof initial === 'function' ? initial() : initial));
    setOpen(true);
  };

  const set = (key, v) => setValues((p) => ({ ...p, [key]: v }));

  const save = async () => {
    const missing = config.fields.find((f) => f.required && !String(values[f.key] || '').trim());
    if (missing) {
      toast.error(`Preencha o campo ${missing.label}`);
      return;
    }
    const bad = config.fields.find((f) => f.money && !(parseMoney(values[f.key]) >= 0));
    if (bad) {
      toast.error(`Valor inválido em ${bad.label}`);
      return;
    }
    const payload = {};
    config.fields.forEach((f) => {
      const v = String(values[f.key] || '').trim();
      if (v) payload[f.key] = v;
    });
    setSaving(true);
    try {
      const r = await config.create(payload);
      toast.success(config.done);
      setOpen(false);
      onCreated && onCreated(r.data);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Não foi possível cadastrar');
    } finally {
      setSaving(false);
    }
  };

  const testBase = testId || `quick-add-${kind}`;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={openDialog}
        title={`${config.title} (cadastro rápido)`}
        aria-label={`${config.title} (cadastro rápido)`}
        className={cn('shrink-0 p-0 text-primary border-primary/30 hover:bg-primary/10 hover:text-primary', size === 'sm' ? 'h-8 w-8' : 'h-9 w-9', className)}
        data-testid={testBase}
      >
        <Plus className="w-4 h-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid={`${testBase}-dialog`}>
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus className="w-5 h-5 text-primary" />
              {config.title}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cadastro rápido com o essencial. Os demais dados podem ser completados depois no cadastro.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); save(); }}
          >
            {config.fields.map((f, i) => (
              <div key={f.key} className={cn(config.fields.length % 2 === 1 && i === 0 ? 'col-span-2' : 'col-span-2 sm:col-span-1')}>
                <Label className="mb-1.5 block">
                  {f.label}{f.required && <span className="text-destructive"> *</span>}
                </Label>
                {f.options ? (
                  <Select value={values[f.key]} onValueChange={(v) => set(f.key, v)}>
                    <SelectTrigger className="h-9 text-sm" data-testid={`${testBase}-${f.key}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {f.options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={values[f.key] || ''}
                    autoFocus={i === 0}
                    placeholder={f.placeholder}
                    inputMode={f.money ? 'decimal' : undefined}
                    onChange={(e) => set(f.key, f.mask ? f.mask(e.target.value) : f.upper ? e.target.value.toUpperCase() : e.target.value)}
                    className="h-9 text-sm"
                    data-testid={`${testBase}-${f.key}`}
                  />
                )}
              </div>
            ))}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} data-testid={`${testBase}-save`}>
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Cadastrar e selecionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
