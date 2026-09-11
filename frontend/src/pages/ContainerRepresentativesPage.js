import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
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
import { Plus, Trash2, Users, Edit, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const TIPO_OPTIONS = [
  ['PF', 'Pessoa Física'],
  ['PJ', 'Pessoa Jurídica'],
];

const STATUS_BADGE_CLASS = {
  ATIVO: 'bg-emerald-100 text-emerald-700',
  INATIVO: 'bg-slate-100 text-slate-600',
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
      <div className="space-y-5" data-testid="container-representatives-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Cadastro de Representantes
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Vendedores (PF ou PJ) usados no Registro de Venda de Container</p>
        </div>

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
                className="h-9 text-[13px] pl-9"
                data-testid="search-representative-input"
              />
            </div>
          </CardContent>
        </Card>

        {/* Barra de ações - marque um representante na tabela abaixo pra habilitar as ações */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openCreateDialog}
            title="Adicionar"
            data-testid="add-representative-button"
            className="h-9 w-9 p-0"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedRepresentative && openEditDialog(singleSelectedRepresentative)}
            disabled={!singleSelectedRepresentative}
            title="Editar"
            data-testid="edit-representative-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Edit className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedRepresentative && handleDelete(singleSelectedRepresentative.id)}
            disabled={!singleSelectedRepresentative}
            title="Excluir"
            data-testid="delete-representative-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
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
              <Users className="w-4 h-4" />
              Lista de Representantes ({filteredRepresentatives.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredRepresentatives.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="w-9 px-4 py-2.5">
                        <Checkbox
                          checked={filteredRepresentatives.length > 0 && filteredRepresentatives.every(r => selectedIds.has(r.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                          data-testid="select-all-checkbox"
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tipo</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nome</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">CPF/CNPJ</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Telefone</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cadastrado em</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredRepresentatives.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => toggleSelect(r.id)}
                        className={`cursor-pointer transition-colors ${selectedIds.has(r.id) ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                        data-testid="representative-row"
                      >
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(r.id)}
                            onCheckedChange={() => toggleSelect(r.id)}
                            data-testid="representative-row-checkbox"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-[13px]">{r.tipo === 'PJ' ? 'PJ' : 'PF'}</td>
                        <td className="px-4 py-2.5 text-[13px] font-medium">{r.name}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono">{r.tipo === 'PJ' ? (r.cnpj || '-') : (r.cpf || '-')}</td>
                        <td className="px-4 py-2.5 text-[13px]">{r.phone || '-'}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_BADGE_CLASS[r.status] || 'bg-slate-100 text-slate-600'}`}>
                            {r.status === 'INATIVO' ? 'Inativo' : 'Ativo'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[13px]">
                          {format(new Date(r.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-500 dark:text-slate-400" data-testid="no-representatives">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">
                  {search ? 'Nenhum representante encontrado' : 'Nenhum representante cadastrado'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
