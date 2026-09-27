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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Users, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const TIPO_OPTIONS = [
  ['PF', 'Pessoa Física'],
  ['PJ', 'Pessoa Jurídica'],
];

const STATUS_TONES = {
  ATIVO: 'emerald',
  INATIVO: 'slate',
};

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
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

function buildEmpty() {
  return {
    tipo: 'PF',
    name: '',
    trade_name: '',
    cpf: '',
    cnpj: '',
    contact_name: '',
    phone: '',
    email: '',
    bank_name: '',
    bank_agency: '',
    bank_account: '',
    pix_key: '',
    status: 'ATIVO',
    observations: '',
  };
}

export default function ContainerRepresentativesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [representatives, setRepresentatives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState(buildEmpty());
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    loadRepresentatives();
  }, []);

  const loadRepresentatives = async () => {
    try {
      const response = await api.getContainerRepresentatives();
      setRepresentatives(response.data);
    } catch (error) {
      toast.error('Erro ao carregar representantes');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData(buildEmpty());
    setEditMode(false);
    setEditId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setOpen(true);
  };

  const openEditDialog = (representative) => {
    setFormData({ ...buildEmpty(), ...representative });
    setEditMode(true);
    setEditId(representative.id);
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      if (editMode && editId) {
        await api.updateContainerRepresentative(editId, formData);
        toast.success('Representante atualizado com sucesso');
      } else {
        await api.createContainerRepresentative(formData);
        toast.success('Representante cadastrado com sucesso');
      }
      resetForm();
      setOpen(false);
      loadRepresentatives();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar representante');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm('Tem certeza que deseja deletar este representante?')) {
      try {
        await api.deleteContainerRepresentative(id);
        toast.success('Representante deletado com sucesso');
        setSelectedIds(prev => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        loadRepresentatives();
      } catch (error) {
        toast.error('Erro ao deletar representante');
      }
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredRepresentatives.map(r => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const filteredRepresentatives = representatives.filter((r) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      r.name?.toLowerCase().includes(term) ||
      r.trade_name?.toLowerCase().includes(term) ||
      r.cpf?.includes(term) ||
      r.cnpj?.includes(term)
    );
  });

  const singleSelectedRepresentative = selectedIds.size === 1 ? filteredRepresentatives.find(r => r.id === [...selectedIds][0]) : null;

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="container-representatives-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4" data-testid="container-representatives-page">
        <PageHeader icon={Users} title="Cadastro de Representantes" subtitle="Vendedores (PF ou PJ) usados no Registro de Venda de Container" />

        <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) resetForm();
          }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="representative-dialog">
              <DialogHeader>
                <DialogTitle className="text-base">{editMode ? 'Editar Representante' : 'Cadastrar Representante'}</DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editMode ? 'Atualize os dados do representante' : 'Adicione um novo representante ao sistema'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Tipo *</Label>
                  <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                    <SelectTrigger className="h-10 text-[13px]" data-testid="representative-tipo-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPO_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {formData.tipo === 'PF' ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-[13px]">Nome Completo *</Label>
                      <Input
                        id="name"
                        data-testid="representative-name-input"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        className="h-10 text-[13px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cpf" className="text-[13px]">CPF</Label>
                      <Input
                        id="cpf"
                        data-testid="representative-cpf-input"
                        value={formData.cpf}
                        onChange={(e) => setFormData({ ...formData, cpf: formatCPF(e.target.value) })}
                        className="h-10 text-[13px] font-mono"
                        maxLength={14}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-[13px]">Razão Social *</Label>
                      <Input
                        id="name"
                        data-testid="representative-name-input"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        className="h-10 text-[13px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="trade_name" className="text-[13px]">Nome Fantasia</Label>
                      <Input
                        id="trade_name"
                        data-testid="representative-trade-name-input"
                        value={formData.trade_name}
                        onChange={(e) => setFormData({ ...formData, trade_name: e.target.value })}
                        className="h-10 text-[13px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cnpj" className="text-[13px]">CNPJ</Label>
                      <Input
                        id="cnpj"
                        data-testid="representative-cnpj-input"
                        value={formData.cnpj}
                        onChange={(e) => setFormData({ ...formData, cnpj: formatCNPJ(e.target.value) })}
                        className="h-10 text-[13px] font-mono"
                        maxLength={18}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="contact_name" className="text-[13px]">Pessoa de Contato</Label>
                      <Input
                        id="contact_name"
                        data-testid="representative-contact-name-input"
                        value={formData.contact_name}
                        onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                        className="h-10 text-[13px]"
                      />
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="text-[13px]">Telefone</Label>
                    <Input
                      id="phone"
                      data-testid="representative-phone-input"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: formatPhone(e.target.value) })}
                      className="h-10 text-[13px] font-mono"
                      maxLength={15}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-[13px]">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      data-testid="representative-email-input"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="h-10 text-[13px]"
                    />
                  </div>
                </div>

                <Label className="text-[13px] text-slate-500">Dados Bancários (pagamento de comissão)</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="bank_name" className="text-[13px]">Banco</Label>
                    <Input
                      id="bank_name"
                      data-testid="representative-bank-name-input"
                      value={formData.bank_name}
                      onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                      className="h-10 text-[13px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bank_agency" className="text-[13px]">Agência</Label>
                    <Input
                      id="bank_agency"
                      data-testid="representative-bank-agency-input"
                      value={formData.bank_agency}
                      onChange={(e) => setFormData({ ...formData, bank_agency: e.target.value })}
                      className="h-10 text-[13px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bank_account" className="text-[13px]">Conta Corrente</Label>
                    <Input
                      id="bank_account"
                      data-testid="representative-bank-account-input"
                      value={formData.bank_account}
                      onChange={(e) => setFormData({ ...formData, bank_account: e.target.value })}
                      className="h-10 text-[13px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pix_key" className="text-[13px]">Chave PIX</Label>
                    <Input
                      id="pix_key"
                      data-testid="representative-pix-key-input"
                      value={formData.pix_key}
                      onChange={(e) => setFormData({ ...formData, pix_key: e.target.value })}
                      className="h-10 text-[13px]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[13px]">Status</Label>
                  <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                    <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ATIVO">Ativo</SelectItem>
                      <SelectItem value="INATIVO">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="observations" className="text-[13px]">Observações</Label>
                  <Textarea
                    id="observations"
                    data-testid="representative-observations-input"
                    value={formData.observations}
                    onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                    className="text-[13px] min-h-[60px]"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-10 text-[13px] font-semibold"
                  data-testid="submit-representative-button"
                  disabled={submitting}
                >
                  {submitting ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Nome, nome fantasia, CPF ou CNPJ">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-representative-input" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um representante pra habilitar as ações da barra */}
        <DataCard
          title="Representantes"
          count={filteredRepresentatives.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo representante" onClick={openCreateDialog} testId="add-representative-button" />}
            >
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => singleSelectedRepresentative && openEditDialog(singleSelectedRepresentative)} disabled={!singleSelectedRepresentative} testId="edit-representative-button" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedRepresentative && handleDelete(singleSelectedRepresentative.id)} disabled={!singleSelectedRepresentative} testId="delete-representative-button" />
            </Toolbar>
          )}
        >
          {filteredRepresentatives.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredRepresentatives.length > 0 && filteredRepresentatives.every(r => selectedIds.has(r.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Tipo</th>
                    <th>Nome</th>
                    <th>CPF/CNPJ</th>
                    <th>Telefone</th>
                    <th>Status</th>
                    <th>Cadastrado em</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRepresentatives.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => toggleSelect(r.id)}
                      data-selected={selectedIds.has(r.id)}
                      className="cursor-pointer"
                      data-testid="representative-row"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(r.id)}
                          onCheckedChange={() => toggleSelect(r.id)}
                          data-testid="representative-row-checkbox"
                        />
                      </td>
                      <td>
                        <StatusPill tone={r.tipo === 'PJ' ? 'violet' : 'blue'} dot={false}>
                          {r.tipo === 'PJ' ? 'PJ' : 'PF'}
                        </StatusPill>
                      </td>
                      <td><div className="max-w-[260px] truncate cell-strong" title={r.name || ''}>{r.name}</div></td>
                      <td className="whitespace-nowrap tabular-nums">{r.tipo === 'PJ' ? (r.cnpj || '-') : (r.cpf || '-')}</td>
                      <td className="whitespace-nowrap tabular-nums">{r.phone || '-'}</td>
                      <td>
                        <StatusPill tone={STATUS_TONES[r.status] || 'emerald'}>
                          {r.status === 'INATIVO' ? 'Inativo' : 'Ativo'}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {format(new Date(r.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title={search ? 'Nenhum representante encontrado' : 'Nenhum representante cadastrado'}
              hint={search ? 'Ajuste a busca' : 'Cadastre o primeiro pelo botão "Novo representante"'}
              testId="no-representatives"
            />
          )}
        </DataCard>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
