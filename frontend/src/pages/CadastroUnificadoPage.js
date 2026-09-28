import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, StatusPill, EmptyState,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { AddressFields } from '../components/AddressFields';
import { SignatureField } from '../components/SignaturePad';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { useModuleConfig } from '../context/ModuleConfigContext';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Plus, Trash2, Edit, Search, Truck, IdCard, Store, ShieldCheck, Users, Warehouse,
  Building2, ChevronDown, Loader2,
} from 'lucide-react';

const formatCPF = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

const formatCNPJ = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

const formatPhone = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

// Campo único "CNPJ ou CPF": aplica a máscara de CPF enquanto tiver até 11
// dígitos (senão um CPF saía formatado como CNPJ, ex. "026.496.043/28"
// em vez de "026.496.043-28"), e passa a formatar como CNPJ a partir do 12º.
const formatCnpjCpf = (value) => {
  const digits = value.replace(/\D/g, '');
  return digits.length > 11 ? formatCNPJ(value) : formatCPF(value);
};

const MASKS = { cpf: formatCPF, cnpj: formatCNPJ, doc: formatCnpjCpf, tel: formatPhone };

const formatCEP = (value) => {
  const digits = (value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

const STATUS_ATIVO_INATIVO = [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo']];
const RECORD_STATUS_LABELS = { ATIVO: 'Ativo', INATIVO: 'Inativo', BLOQUEADO: 'Bloqueado', AFASTADO: 'Afastado', DESLIGADO: 'Desligado' };
const RECORD_STATUS_TONES = { ATIVO: 'emerald', INATIVO: 'slate', BLOQUEADO: 'red', AFASTADO: 'amber', DESLIGADO: 'slate' };
const STATUS_COM_BLOQUEADO = [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo'], ['BLOQUEADO', 'Bloqueado']];
const STATUS_FUNCIONARIO = [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo'], ['AFASTADO', 'Afastado'], ['DESLIGADO', 'Desligado']];
const LOCATION_TYPE_OPTIONS = [['BRASIL', 'Brasil'], ['EXTERIOR', 'Exterior']];

const TYPES = [
  {
    key: 'motorista',
    label: 'Motorista',
    plural: 'Motoristas',
    icon: Truck,
    moduleKey: 'cadastro.pessoas',
    api: { list: api.getDrivers, create: api.createDriver, update: api.updateDriver, remove: api.deleteDriver },
    listColumns: [['name', 'Nome'], ['cpf', 'CPF'], ['phone', 'Telefone'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Nome completo', required: true },
      { name: 'cpf', label: 'CPF', mask: 'cpf', required: true },
      { name: 'rg', label: 'RG' },
      { name: 'rg_issuer', label: 'Órgão Emissor' },
      { name: 'rg_uf', label: 'UF do RG' },
      { name: 'birth_date', label: 'Data de Nascimento', type: 'date' },
      { name: 'cnh_number', label: 'CNH - Número' },
      { name: 'cnh_category', label: 'CNH - Categoria' },
      { name: 'cnh_expiry', label: 'CNH - Validade', type: 'date' },
      { name: 'phone', label: 'Telefone / WhatsApp', mask: 'tel' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'address_details', label: 'Endereço', type: 'address' },
      { name: 'transport_company', label: 'Transportadora Vinculada (vazio = autônomo)' },
      { name: 'default_truck_plate', label: 'Placa do Cavalo (padrão)' },
      { name: 'default_trailer_plate', label: 'Placa da Carreta (padrão)' },
      { name: 'signature_url', label: "Assinatura (sai no Termo e na Ficha de Entrega de EPI's)", type: 'signature' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_COM_BLOQUEADO },
      { name: 'observations', label: 'Observações', type: 'textarea' },
    ],
  },
  {
    key: 'transportadora',
    label: 'Transportadora',
    plural: 'Transportadoras',
    feminine: true,
    icon: Building2,
    moduleKey: 'cadastro.transportadora',
    api: {
      list: api.getTransportCompanies, create: api.createTransportCompany,
      update: api.updateTransportCompany, remove: api.deleteTransportCompany,
    },
    listColumns: [['name', 'Razão Social'], ['cnpj', 'CNPJ'], ['antt', 'ANTT'], ['status', 'Status']],
    fields: [
      { name: 'cnpj', label: 'CNPJ (ou CPF)', mask: 'doc' },
      { name: 'name', label: 'Razão Social', required: true },
      { name: 'trade_name', label: 'Nome Fantasia' },
      { name: 'antt', label: 'ANTT (RNTRC)' },
      { name: 'state_registration', label: 'Inscrição Estadual' },
      { name: 'municipal_registration', label: 'Inscrição Municipal' },
      { name: 'phone', label: 'Telefone', mask: 'tel' },
      { name: 'email', label: 'Email' },
      { name: 'address_details', label: 'Endereço', type: 'address' },
      { name: 'contact_name', label: 'Nome do Contato' },
      { name: 'contact_phone', label: 'Telefone do Contato', mask: 'tel' },
      { name: 'bank_name', label: 'Banco' },
      { name: 'bank_agency', label: 'Agência' },
      { name: 'bank_account', label: 'Conta' },
      { name: 'pix_key', label: 'Chave PIX' },
      { name: 'payment_terms', label: 'Condições de Pagamento' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_ATIVO_INATIVO },
      { name: 'observations', label: 'Observações', type: 'textarea' },
    ],
  },
  {
    key: 'funcionario',
    label: 'Funcionário',
    plural: 'Funcionários',
    icon: IdCard,
    moduleKey: 'cadastro.funcionario',
    api: { list: api.getEmployees, create: api.createEmployee, update: api.updateEmployee, remove: api.deleteEmployee },
    listColumns: [['name', 'Nome'], ['cpf', 'CPF'], ['position', 'Cargo'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Nome completo', required: true },
      { name: 'cpf', label: 'CPF', mask: 'cpf', required: true },
      { name: 'rg', label: 'RG' },
      { name: 'birth_date', label: 'Data de Nascimento', type: 'date' },
      { name: 'position', label: 'Cargo/Função' },
      { name: 'department', label: 'Setor/Departamento' },
      { name: 'admission_date', label: 'Data de Admissão', type: 'date' },
      { name: 'employee_code', label: 'Matrícula/Código Interno' },
      { name: 'phone', label: 'Telefone / WhatsApp', mask: 'tel' },
      { name: 'email', label: 'Email' },
      { name: 'address_details', label: 'Endereço', type: 'address' },
      { name: 'access_level', label: 'Nível de Acesso (informativo)', placeholder: 'Ex: administrador, portaria, pátio, financeiro...' },
      { name: 'signature_url', label: "Assinatura (sai no Termo e na Ficha de Entrega de EPI's)", type: 'signature' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_FUNCIONARIO },
      { name: 'observations', label: 'Observações', type: 'textarea' },
    ],
  },
  {
    key: 'fornecedor',
    label: 'Fornecedor',
    plural: 'Fornecedores',
    icon: Store,
    moduleKey: 'cadastro.fornecedor',
    api: { list: api.getSuppliers, create: api.createSupplier, update: api.updateSupplier, remove: api.deleteSupplier },
    listColumns: [['name', 'Razão Social'], ['cnpj', 'CNPJ'], ['supply_type', 'Fornecimento'], ['status', 'Status']],
    fields: [
      { name: 'cnpj', label: 'CNPJ (ou CPF)', mask: 'doc' },
      { name: 'name', label: 'Razão Social', required: true },
      { name: 'trade_name', label: 'Nome Fantasia' },
      { name: 'state_registration', label: 'Inscrição Estadual' },
      { name: 'municipal_registration', label: 'Inscrição Municipal' },
      { name: 'supply_type', label: 'Tipo de Fornecimento', placeholder: 'Ex: peças, manutenção, combustível...' },
      { name: 'phone', label: 'Telefone', mask: 'tel' },
      { name: 'email', label: 'Email' },
      { name: 'address_details', label: 'Endereço', type: 'address' },
      { name: 'contact_name', label: 'Nome do Contato' },
      { name: 'contact_phone', label: 'Telefone do Contato', mask: 'tel' },
      { name: 'bank_name', label: 'Banco' },
      { name: 'bank_agency', label: 'Agência' },
      { name: 'bank_account', label: 'Conta' },
      { name: 'pix_key', label: 'Chave PIX' },
      { name: 'payment_terms', label: 'Condições de Pagamento' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_ATIVO_INATIVO },
      { name: 'observations', label: 'Observações', type: 'textarea' },
    ],
  },
  {
    key: 'seguradora',
    label: 'Seguradora',
    plural: 'Seguradoras',
    feminine: true,
    icon: ShieldCheck,
    moduleKey: 'cadastro.seguradora',
    api: {
      list: api.getInsuranceCompanies, create: api.createInsuranceCompany,
      update: api.updateInsuranceCompany, remove: api.deleteInsuranceCompany,
    },
    listColumns: [['name', 'Razão Social'], ['cnpj', 'CNPJ'], ['broker_name', 'Corretor'], ['status', 'Status']],
    fields: [
      { name: 'cnpj', label: 'CNPJ', mask: 'cnpj' },
      { name: 'name', label: 'Razão Social', required: true },
      { name: 'trade_name', label: 'Nome Fantasia' },
      { name: 'susep_registration', label: 'Registro SUSEP' },
      { name: 'address_details', label: 'Endereço', type: 'address' },
      { name: 'phone', label: 'Telefone Geral', mask: 'tel' },
      { name: 'claims_phone', label: 'Telefone de Sinistro/Emergência', mask: 'tel' },
      { name: 'email', label: 'Email' },
      { name: 'broker_name', label: 'Nome do Corretor/Contato' },
      { name: 'broker_phone', label: 'Telefone do Corretor', mask: 'tel' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_ATIVO_INATIVO },
      { name: 'observations', label: 'Observações', type: 'textarea' },
    ],
  },
  {
    key: 'cliente',
    label: 'Cliente',
    plural: 'Clientes',
    icon: Users,
    moduleKey: 'cadastro.cliente',
    api: { list: api.getClients, create: api.createClient, update: api.updateClient, remove: api.deleteClient },
    listColumns: [['name', 'Razão Social / Nome'], ['cnpj', 'CNPJ/CPF'], ['phone', 'Telefone'], ['status', 'Status']],
    fields: [
      { name: 'location_type', label: 'Brasil ou Exterior', type: 'select', options: LOCATION_TYPE_OPTIONS },
      { name: 'cnpj', label: 'CNPJ ou CPF', mask: 'doc', showIf: (f) => f.location_type !== 'EXTERIOR' },
      { name: 'name', label: 'Razão Social / Nome', required: true },
      { name: 'trade_name', label: 'Nome Fantasia' },
      { name: 'state_registration', label: 'Inscrição Estadual', showIf: (f) => f.location_type !== 'EXTERIOR' },
      { name: 'municipal_registration', label: 'Inscrição Municipal', showIf: (f) => f.location_type !== 'EXTERIOR' },
      { name: 'phone', label: 'Telefone', mask: 'tel' },
      { name: 'email', label: "Email (um ou mais, separados por ';')" },
      { name: 'address_details', label: 'Endereço', type: 'address', internationalToggle: 'location_type' },
      { name: 'contact_name', label: 'Nome do Contato' },
      { name: 'contact_phone', label: 'Telefone do Contato', mask: 'tel' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_COM_BLOQUEADO },
      { name: 'observations', label: 'Observações', type: 'textarea' },
    ],
  },
  {
    key: 'terminal',
    label: 'Terminal',
    plural: 'Terminais',
    icon: Warehouse,
    moduleKey: 'cadastro.terminal',
    api: { list: api.getTerminals, create: api.createTerminal, update: api.updateTerminal, remove: api.deleteTerminal },
    listColumns: [['name', 'Nome'], ['cnpj', 'CNPJ'], ['responsible_name', 'Responsável'], ['status', 'Status']],
    fields: [
      { name: 'cnpj', label: 'CNPJ', mask: 'cnpj' },
      { name: 'name', label: 'Nome do Terminal', required: true },
      { name: 'internal_code', label: 'Código/Identificação Interna' },
      { name: 'phone', label: 'Telefone', mask: 'tel' },
      { name: 'email', label: 'Email de Contato' },
      { name: 'address_details', label: 'Endereço', type: 'address' },
      { name: 'responsible_name', label: 'Responsável pelo Terminal' },
      { name: 'responsible_contact', label: 'Contato do Responsável', mask: 'tel' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_ATIVO_INATIVO },
      { name: 'observations', label: 'Observações', type: 'textarea' },
    ],
  },
];

function genderWords(type) {
  const fem = !!type.feminine;
  return {
    novo: fem ? 'Nova' : 'Novo',
    umNovo: fem ? 'uma nova' : 'um novo',
    nenhum: fem ? 'Nenhuma' : 'Nenhum',
    este: fem ? 'esta' : 'este',
    do: fem ? 'da' : 'do',
    cadastrado: fem ? 'cadastrada' : 'cadastrado',
    atualizado: fem ? 'atualizada' : 'atualizado',
    deletado: fem ? 'deletada' : 'deletado',
  };
}

function buildEmptyForm(type) {
  const form = {};
  for (const f of type.fields) {
    form[f.name] = f.type === 'address' ? null : '';
  }
  if (form.status === '') {
    const statusField = type.fields.find((f) => f.name === 'status');
    if (statusField) form.status = statusField.options[0][0];
  }
  if (form.location_type === '') {
    const locationTypeField = type.fields.find((f) => f.name === 'location_type');
    if (locationTypeField) form.location_type = locationTypeField.options[0][0];
  }
  return form;
}

export default function CadastroUnificadoPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const { isModuleEnabled } = useModuleConfig();
  const [searchParams, setSearchParams] = useSearchParams();

  const availableTypes = TYPES.filter((t) => isModuleEnabled(t.moduleKey));
  const initialTypeKey = searchParams.get('type') || availableTypes[0]?.key || TYPES[0].key;
  const [activeTypeKey, setActiveTypeKey] = useState(initialTypeKey);
  const activeType = TYPES.find((t) => t.key === activeTypeKey) || TYPES[0];
  const g = genderWords(activeType);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState(() => buildEmptyForm(activeType));
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [cnpjLoading, setCnpjLoading] = useState(false);

  useEffect(() => {
    setSearchParams(activeTypeKey === TYPES[0].key ? {} : { type: activeTypeKey }, { replace: true });
    setSelectedIds(new Set());
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTypeKey]);

  const loadItems = async () => {
    setLoading(true);
    try {
      const response = await activeType.api.list();
      setItems(response.data);
    } catch (error) {
      toast.error(`Erro ao carregar ${activeType.plural.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData(buildEmptyForm(activeType));
    setEditId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setOpen(true);
  };

  // Chamado a partir do menu do botão "Adicionar" - troca o tipo ativo e já
  // abre o formulário de criação para ele, sem depender de `activeType` (que
  // só reflete o novo valor no próximo render).
  const openCreateDialogFor = (typeKey) => {
    const type = TYPES.find((t) => t.key === typeKey) || TYPES[0];
    setActiveTypeKey(typeKey);
    setFormData(buildEmptyForm(type));
    setEditId(null);
    setOpen(true);
  };

  const openEditDialog = (item) => {
    const form = buildEmptyForm(activeType);
    for (const f of activeType.fields) {
      form[f.name] = item[f.name] ?? form[f.name];
    }
    setFormData(form);
    setEditId(item.id);
    setOpen(true);
  };

  const setField = (name, value) => setFormData((p) => ({ ...p, [name]: value }));

  // Preenche nome/contato/endereço a partir do CNPJ digitado, usando os
  // dados públicos da Receita Federal (via BrasilAPI). Só escreve em campos
  // que já existem no schema do tipo ativo (buildEmptyForm sempre inicializa
  // todas as chaves de type.fields, mesmo vazias) - assim funciona igual
  // pras 5 telas (Transportadora/Fornecedor/Seguradora/Cliente/Terminal)
  // sem precisar de código por tipo.
  const lookupCnpj = async (rawValue) => {
    const digits = (rawValue || '').replace(/\D/g, '');
    if (digits.length !== 14) {
      toast.error('Digite um CNPJ válido (14 dígitos) para buscar');
      return;
    }
    setCnpjLoading(true);
    try {
      const r = await api.lookupCnpj(digits);
      const d = r.data;
      setFormData((p) => {
        const next = { ...p };
        if ('name' in next && d.name) next.name = d.name;
        if ('trade_name' in next && d.trade_name) next.trade_name = d.trade_name;
        if ('phone' in next && d.phone) next.phone = formatPhone(d.phone);
        if ('email' in next && d.email) next.email = d.email;
        if ('address_details' in next) {
          next.address_details = {
            ...(next.address_details || {}),
            street: d.street || next.address_details?.street || '',
            number: d.number || next.address_details?.number || '',
            neighborhood: d.neighborhood || next.address_details?.neighborhood || '',
            zip: d.zip ? formatCEP(d.zip) : next.address_details?.zip || '',
            city: d.city || next.address_details?.city || '',
            state: d.state || next.address_details?.state || '',
          };
        }
        return next;
      });
      toast.success('Dados preenchidos a partir do CNPJ');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'CNPJ não encontrado');
    } finally {
      setCnpjLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (editId) {
        await activeType.api.update(editId, formData);
        toast.success(`${activeType.label} ${g.atualizado} com sucesso`);
      } else {
        await activeType.api.create(formData);
        toast.success(`${activeType.label} ${g.cadastrado} com sucesso`);
      }
      resetForm();
      setOpen(false);
      loadItems();
    } catch (error) {
      toast.error(error.response?.data?.detail || `Erro ao salvar ${g.este} ${activeType.label.toLowerCase()}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm(`Tem certeza que deseja deletar ${g.este} ${activeType.label.toLowerCase()}?`)) {
      try {
        await activeType.api.remove(id);
        toast.success(`${activeType.label} ${g.deletado} com sucesso`);
        setSelectedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        loadItems();
      } catch (error) {
        toast.error(`Erro ao deletar ${g.este} ${activeType.label.toLowerCase()}`);
      }
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredItems.map((item) => item.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const filteredItems = items.filter((item) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return activeType.listColumns.some(([field]) => (item[field] || '').toString().toLowerCase().includes(term));
  });

  const singleSelectedItem = selectedIds.size === 1 ? filteredItems.find((item) => item.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-4" data-testid="cadastro-unificado-page">
        <PageHeader icon={activeType.icon} title={`Cadastro de ${activeType.label}`} subtitle="Selecione o tipo de cadastro" />

        {/* Troca de tipo de cadastro */}
        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 w-fit max-w-full">
          {availableTypes.map((t) => {
            const Icon = t.icon;
            const active = t.key === activeTypeKey;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTypeKey(t.key)}
                data-testid={`cadastro-type-${t.key}`}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetForm(); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="cadastro-dialog">
              <DialogHeader>
                <DialogTitle className="text-base">{editId ? `Editar ${activeType.label}` : `Cadastrar ${activeType.label}`}</DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editId ? `Atualize os dados ${g.do} ${activeType.label.toLowerCase()}` : `Adicione ${g.umNovo} ${activeType.label.toLowerCase()} ao sistema`}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {activeType.fields.map((f) => {
                  if (f.showIf && !f.showIf(formData)) return null;
                  return (
                  <div key={f.name} className="space-y-1.5">
                    {f.type !== 'address' && (
                      <Label className="text-[13px]">{f.label}{f.required ? ' *' : ''}</Label>
                    )}
                    {f.type === 'address' ? (
                      <AddressFields
                        value={formData[f.name]}
                        onChange={(val) => setField(f.name, val)}
                        international={!!f.internationalToggle && formData[f.internationalToggle] === 'EXTERIOR'}
                      />
                    ) : f.type === 'select' ? (
                      <Select value={formData[f.name] || f.options[0][0]} onValueChange={(v) => setField(f.name, v)}>
                        <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {f.options.map(([v, l]) => <SelectItem key={v} value={v} className="text-sm">{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : f.type === 'signature' ? (
                      <SignatureField value={formData[f.name]} onChange={(v) => setField(f.name, v)} personName={formData.name} />
                    ) : f.type === 'textarea' ? (
                      <Textarea value={formData[f.name] || ''} onChange={(e) => setField(f.name, e.target.value)} className="text-[13px] min-h-[70px]" />
                    ) : (f.mask === 'cnpj' || f.mask === 'doc') ? (
                      <div className="flex gap-1.5">
                        <Input
                          type="text"
                          value={formData[f.name] || ''}
                          onChange={(e) => setField(f.name, MASKS[f.mask](e.target.value))}
                          required={f.required}
                          className="h-10 text-[13px]"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 shrink-0"
                          onClick={() => lookupCnpj(formData[f.name])}
                          disabled={cnpjLoading}
                          title="Buscar dados pelo CNPJ"
                        >
                          {cnpjLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        </Button>
                      </div>
                    ) : (
                      <Input
                        type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}
                        value={formData[f.name] || ''}
                        onChange={(e) => setField(f.name, f.mask ? MASKS[f.mask](e.target.value) : e.target.value)}
                        required={f.required}
                        className="h-10 text-[13px]"
                      />
                    )}
                  </div>
                  );
                })}
                <Button type="submit" className="w-full h-10 text-[13px] font-semibold" data-testid="submit-cadastro-button" disabled={submitting}>
                  {submitting ? 'Salvando...' : (editId ? 'Atualizar' : 'Cadastrar')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label={activeType.listColumns.filter(([f]) => f !== 'status').map(([, l]) => l).join(', ')}>
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-cadastro-input" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um registro pra habilitar as ações da barra.
            "Novo" abre um menu pra escolher o tipo de cadastro. */}
        <DataCard
          title={activeType.plural}
          count={loading ? '...' : filteredItems.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={(
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" data-testid="add-cadastro-button" className="h-9 px-3.5 text-[13px] gap-1.5">
                      <Plus className="w-4 h-4" />
                      Novo cadastro
                      <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {availableTypes.map((t) => {
                      const Icon = t.icon;
                      return (
                        <DropdownMenuItem
                          key={t.key}
                          onClick={() => openCreateDialogFor(t.key)}
                          data-testid={`add-cadastro-option-${t.key}`}
                        >
                          <Icon className="w-4 h-4 mr-2" />
                          {genderWords(t).novo} {t.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            >
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => singleSelectedItem && openEditDialog(singleSelectedItem)} disabled={!singleSelectedItem} />
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
                        checked={filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    {activeType.listColumns.map(([field, label]) => (
                      <th key={field}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => toggleSelect(item.id)}
                      data-selected={selectedIds.has(item.id)}
                      className="cursor-pointer"
                      data-testid="cadastro-row"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={() => toggleSelect(item.id)}
                          data-testid="cadastro-row-checkbox"
                        />
                      </td>
                      {activeType.listColumns.map(([field], colIdx) => (
                        <td key={field} className={colIdx === 0 ? 'cell-strong' : 'whitespace-nowrap'}>
                          {field === 'status' ? (
                            <StatusPill tone={RECORD_STATUS_TONES[item.status] || 'slate'}>
                              {RECORD_STATUS_LABELS[item.status] || item.status || '-'}
                            </StatusPill>
                          ) : colIdx === 0 ? (
                            <div className="max-w-[320px] truncate" title={item[field] || ''}>{item[field] || '-'}</div>
                          ) : (item[field] || '-')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={activeType.icon}
              title={loading ? 'Carregando...' : (search ? 'Nenhum registro encontrado' : `${g.nenhum} ${activeType.label.toLowerCase()} ${g.cadastrado}`)}
              hint={loading ? undefined : (search ? 'Ajuste a busca' : 'Use o botão "Novo cadastro" para incluir o primeiro')}
            />
          )}
        </DataCard>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
