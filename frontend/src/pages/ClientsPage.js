import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Users, Edit, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Máscara de CNPJ: 00.000.000/0000-00
const formatCNPJ = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

// Máscara de telefone: (00) 00000-0000
const formatPhone = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

export default function ClientsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({ name: '', cnpj: '', phone: '', email: '', address: '' });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const location = useLocation();

  useEffect(() => {
    const qFromUrl = new URLSearchParams(location.search).get('q');
    if (qFromUrl) setSearch(qFromUrl);
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      const response = await api.getClients();
      setClients(response.data);
    } catch (error) {
      toast.error('Erro ao carregar clientes');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', cnpj: '', phone: '', email: '', address: '' });
    setEditMode(false);
    setEditId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setOpen(true);
  };

  const openEditDialog = (client) => {
    setFormData({
      name: client.name,
      cnpj: client.cnpj || '',
      phone: client.phone || '',
      email: client.email || '',
      address: client.address || ''
    });
    setEditMode(true);
    setEditId(client.id);
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    
    setSubmitting(true);
    try {
      if (editMode && editId) {
        await api.updateClient(editId, formData);
        toast.success('Cliente atualizado com sucesso');
      } else {
        await api.createClient(formData);
        toast.success('Cliente cadastrado com sucesso');
      }
      resetForm();
      setOpen(false);
      loadClients();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar cliente');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm('Tem certeza que deseja deletar este cliente?')) {
      try {
        await api.deleteClient(id);
        toast.success('Cliente deletado com sucesso');
        loadClients();
      } catch (error) {
        toast.error('Erro ao deletar cliente');
      }
    }
  };

  const handleCNPJChange = (e) => {
    const formatted = formatCNPJ(e.target.value);
    setFormData({ ...formData, cnpj: formatted });
  };

  const handlePhoneChange = (e) => {
    const formatted = formatPhone(e.target.value);
    setFormData({ ...formData, phone: formatted });
  };

  const filteredClients = clients.filter((client) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      client.name?.toLowerCase().includes(term) ||
      client.cnpj?.toLowerCase().includes(term) ||
      client.phone?.toLowerCase().includes(term) ||
      client.email?.toLowerCase().includes(term)
    );
  });

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="clients-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="clients-page">
        <PageHeader
          title="Cadastro de Cliente"
          subtitle="Gerencie o cadastro de clientes"
          icon={Users}
          actions={
            <Dialog open={open} onOpenChange={(isOpen) => {
              setOpen(isOpen);
              if (!isOpen) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button
                  size="default"
                  className="text-[13px] font-semibold uppercase tracking-wide h-10"
                  data-testid="add-client-button"
                  onClick={openCreateDialog}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Novo Cliente
                </Button>
              </DialogTrigger>
              <DialogContent data-testid="client-dialog">
              <DialogHeader>
                <DialogTitle className="text-base">{editMode ? 'Editar Cliente' : 'Cadastrar Cliente'}</DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editMode ? 'Atualize os dados do cliente' : 'Adicione um novo cliente ao sistema'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Nome/Razão Social <span className="text-red-500">*</span></Label>
                  <Input
                    id="name"
                    data-testid="client-name-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cnpj" className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">CNPJ</Label>
                  <Input
                    id="cnpj"
                    data-testid="client-cnpj-input"
                    value={formData.cnpj}
                    onChange={handleCNPJChange}
                    className="h-10 text-[13px] font-mono"
                    placeholder="00.000.000/0000-00"
                    maxLength={18}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Telefone</Label>
                  <Input
                    id="phone"
                    data-testid="client-phone-input"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    className="h-10 text-[13px] font-mono"
                    placeholder="(00) 00000-0000"
                    maxLength={15}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Email</Label>
                  <Input
                    id="email"
                    data-testid="client-email-input"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="h-10 text-[13px]"
                    placeholder="email@exemplo.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="address" className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Endereço</Label>
                  <Input
                    id="address"
                    data-testid="client-address-input"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="h-10 text-[13px]"
                    placeholder="Endereço completo"
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full h-10 text-[13px] font-semibold" 
                  data-testid="submit-client-button"
                  disabled={submitting}
                >
                  {submitting ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
                </Button>
              </form>
            </DialogContent>
            </Dialog>
          }
        />

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">
              <Search className="w-4 h-4" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:max-w-sm gap-3">
              <div>
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Nome, CNPJ, telefone ou email</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                  <Input
                    placeholder="Buscar..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 text-sm pl-8"
                    data-testid="search-client-input"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Lista de Clientes ({filteredClients.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredClients.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nome</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">CNPJ</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Telefone</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Email</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cadastrado em</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredClients.map((client) => (
                      <tr key={client.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" data-testid="client-row">
                        <td className="px-4 py-2.5 text-[13px] font-medium">{client.name}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono">{client.cnpj || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono">{client.phone || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px]">{client.email || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px]">
                          {format(new Date(client.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(client)}
                              data-testid="edit-client-button"
                              title="Editar"
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(client.id)}
                              data-testid="delete-client-button"
                              title="Deletar"
                              className="h-8 w-8 p-0"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-500 dark:text-slate-400" data-testid="no-clients">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">
                  {search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
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
