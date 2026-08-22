import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Building2, Edit, Search } from 'lucide-react';
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

// Máscara de telefone: (00) 0000-0000 ou (00) 00000-0000
const formatPhone = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

export default function CompaniesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({ name: '', cnpj: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const location = useLocation();

  useEffect(() => {
    const qFromUrl = new URLSearchParams(location.search).get('q');
    if (qFromUrl) setSearch(qFromUrl);
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    try {
      const response = await api.getTransportCompanies();
      setCompanies(response.data);
    } catch (error) {
      toast.error('Erro ao carregar transportadoras');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', cnpj: '', phone: '' });
    setEditMode(false);
    setEditId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setOpen(true);
  };

  const openEditDialog = (company) => {
    setFormData({
      name: company.name,
      cnpj: company.cnpj || '',
      phone: company.phone || ''
    });
    setEditMode(true);
    setEditId(company.id);
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    
    setSubmitting(true);
    try {
      if (editMode && editId) {
        await api.updateTransportCompany(editId, formData);
        toast.success('Transportadora atualizada com sucesso');
      } else {
        await api.createTransportCompany(formData);
        toast.success('Transportadora cadastrada com sucesso');
      }
      resetForm();
      setOpen(false);
      loadCompanies();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar transportadora');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm('Tem certeza que deseja deletar esta transportadora?')) {
      try {
        await api.deleteTransportCompany(id);
        toast.success('Transportadora deletada com sucesso');
        loadCompanies();
      } catch (error) {
        toast.error('Erro ao deletar transportadora');
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

  const filteredCompanies = companies.filter((company) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      company.name?.toLowerCase().includes(term) ||
      company.cnpj?.toLowerCase().includes(term) ||
      company.phone?.toLowerCase().includes(term)
    );
  });

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="companies-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="companies-page">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Transportadoras
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Gerencie o cadastro de empresas de transporte</p>
          </div>
          <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button 
                size="default" 
                className="text-[13px] font-semibold uppercase tracking-wide h-10" 
                data-testid="add-company-button"
                onClick={openCreateDialog}
              >
                <Plus className="w-4 h-4 mr-2" />
                Nova Transportadora
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="company-dialog">
              <DialogHeader>
                <DialogTitle className="text-base">{editMode ? 'Editar Transportadora' : 'Cadastrar Transportadora'}</DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editMode ? 'Atualize os dados da transportadora' : 'Adicione uma nova transportadora ao sistema'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[13px]">Nome da Empresa *</Label>
                  <Input
                    id="name"
                    data-testid="company-name-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cnpj" className="text-[13px]">CNPJ</Label>
                  <Input
                    id="cnpj"
                    data-testid="company-cnpj-input"
                    value={formData.cnpj}
                    onChange={handleCNPJChange}
                    className="h-10 text-[13px] font-mono"
                    placeholder="00.000.000/0000-00"
                    maxLength={18}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-[13px]">Telefone</Label>
                  <Input
                    id="phone"
                    data-testid="company-phone-input"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    className="h-10 text-[13px] font-mono"
                    placeholder="(00) 0000-0000"
                    maxLength={15}
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full h-10 text-[13px] font-semibold" 
                  data-testid="submit-company-button"
                  disabled={submitting}
                >
                  {submitting ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
          <Input
            placeholder="Buscar por nome, CNPJ ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 text-[13px] pl-9"
            data-testid="search-company-input"
          />
        </div>

        <Card>
          <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
            <CardTitle className="text-[13px] font-medium">Lista de Transportadoras ({filteredCompanies.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredCompanies.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nome</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">CNPJ</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Telefone</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cadastrado em</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredCompanies.map((company) => (
                      <tr key={company.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" data-testid="company-row">
                        <td className="px-4 py-2.5 text-[13px] font-medium">{company.name}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono">{company.cnpj || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono">{company.phone || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px]">
                          {format(new Date(company.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(company)}
                              data-testid="edit-company-button"
                              title="Editar"
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(company.id)}
                              data-testid="delete-company-button"
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
              <div className="p-10 text-center text-slate-500 dark:text-slate-400" data-testid="no-companies">
                <Building2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">
                  {search ? 'Nenhuma transportadora encontrada' : 'Nenhuma transportadora cadastrada'}
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
