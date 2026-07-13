import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Plus, Trash2, Truck, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Máscara de CPF: 000.000.000-00
const formatCPF = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

// Máscara de telefone: (00) 00000-0000
const formatPhone = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

export default function DriversPage() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({ name: '', cpf: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadDrivers();
  }, []);

  const loadDrivers = async () => {
    try {
      const response = await api.getDrivers();
      setDrivers(response.data);
    } catch (error) {
      toast.error('Erro ao carregar pessoas');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', cpf: '', phone: '' });
    setEditMode(false);
    setEditId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setOpen(true);
  };

  const openEditDialog = (driver) => {
    setFormData({
      name: driver.name,
      cpf: driver.cpf || '',
      phone: driver.phone || ''
    });
    setEditMode(true);
    setEditId(driver.id);
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    
    setSubmitting(true);
    try {
      if (editMode && editId) {
        await api.updateDriver(editId, formData);
        toast.success('Pessoa atualizada com sucesso');
      } else {
        await api.createDriver(formData);
        toast.success('Pessoa cadastrada com sucesso');
      }
      resetForm();
      setOpen(false);
      loadDrivers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar pessoa');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Tem certeza que deseja deletar esta pessoa?')) {
      try {
        await api.deleteDriver(id);
        toast.success('Pessoa deletada com sucesso');
        loadDrivers();
      } catch (error) {
        toast.error('Erro ao deletar pessoa');
      }
    }
  };

  const handleCPFChange = (e) => {
    const formatted = formatCPF(e.target.value);
    setFormData({ ...formData, cpf: formatted });
  };

  const handlePhoneChange = (e) => {
    const formatted = formatPhone(e.target.value);
    setFormData({ ...formData, phone: formatted });
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="drivers-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="drivers-page">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              Pessoas
            </h1>
            <p className="text-[13px] text-slate-500 mt-0.5">Gerencie o cadastro de pessoas</p>
          </div>
          <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button 
                size="default" 
                className="text-[13px] font-semibold uppercase tracking-wide h-10" 
                data-testid="add-driver-button"
                onClick={openCreateDialog}
              >
                <Plus className="w-4 h-4 mr-2" />
                Nova Pessoa
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="driver-dialog">
              <DialogHeader>
                <DialogTitle className="text-base">{editMode ? 'Editar Pessoa' : 'Cadastrar Pessoa'}</DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editMode ? 'Atualize os dados da pessoa' : 'Adicione uma nova pessoa ao sistema'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[13px]">Nome Completo *</Label>
                  <Input
                    id="name"
                    data-testid="driver-name-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cpf" className="text-[13px]">CPF *</Label>
                  <Input
                    id="cpf"
                    data-testid="driver-cpf-input"
                    value={formData.cpf}
                    onChange={handleCPFChange}
                    required
                    className="h-10 text-[13px] font-mono"
                    placeholder="000.000.000-00"
                    maxLength={14}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-[13px]">Telefone</Label>
                  <Input
                    id="phone"
                    data-testid="driver-phone-input"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    className="h-10 text-[13px] font-mono"
                    placeholder="(00) 00000-0000"
                    maxLength={15}
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full h-10 text-[13px] font-semibold" 
                  data-testid="submit-driver-button"
                  disabled={submitting}
                >
                  {submitting ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="bg-slate-50 py-3">
            <CardTitle className="text-[13px] font-medium">Lista de Pessoas ({drivers.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {drivers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Nome</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">CPF</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Telefone</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cadastrado em</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {drivers.map((driver) => (
                      <tr key={driver.id} className="hover:bg-slate-50 transition-colors" data-testid="driver-row">
                        <td className="px-4 py-2.5 text-[13px] font-medium">{driver.name}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono">{driver.cpf}</td>
                        <td className="px-4 py-2.5 text-[13px] font-mono">{driver.phone || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px]">
                          {format(new Date(driver.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(driver)}
                              data-testid="edit-driver-button"
                              title="Editar"
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(driver.id)}
                              data-testid="delete-driver-button"
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
              <div className="p-10 text-center text-slate-500" data-testid="no-drivers">
                <Truck className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">Nenhuma pessoa cadastrada</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
