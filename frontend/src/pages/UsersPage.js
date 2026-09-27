import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, DataCard, Toolbar, ToolbarPrimary, StatusPill, UserTag, EmptyState } from '../components/DataPage';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { Users, ShieldCheck, User as UserIcon, UserX, UserPlus, Eye, EyeOff } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const ROLE_LABELS = {
  admin: 'Administrador',
  operator: 'Operador',
};

const EMPTY_FORM = { name: '', email: '', password: '', role: 'operator', must_change_password: true };

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await api.getUsers();
      setUsers(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  };

  const openCreateDialog = () => {
    setFormData(EMPTY_FORM);
    setShowPassword(false);
    setCreateOpen(true);
  };

  // Novos acessos só nascem aqui - o autocadastro pela tela de login foi desativado
  const handleCreate = async (e) => {
    e.preventDefault();
    if (formData.password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return;
    }
    setCreating(true);
    try {
      const response = await api.createUser({
        ...formData,
        name: formData.name.trim(),
        email: formData.email.trim(),
      });
      setUsers((prev) => [...prev, response.data]);
      setCreateOpen(false);
      toast.success(`Usuário "${response.data.name}" cadastrado`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao cadastrar usuário');
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (targetUser, newRole) => {
    if (newRole === targetUser.role) return;
    const label = newRole === 'admin' ? 'Administrador' : 'Operador';
    const confirmed = await confirm(
      `Alterar o nível de acesso de "${targetUser.name}" para ${label}?`,
      'Confirmar alteração'
    );
    if (!confirmed) return;

    setSavingId(targetUser.id);
    try {
      const response = await api.updateUserRole(targetUser.id, newRole);
      setUsers((prev) => prev.map((u) => (u.id === targetUser.id ? response.data : u)));
      toast.success('Nível de acesso atualizado');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar nível de acesso');
    } finally {
      setSavingId(null);
    }
  };

  const handleStatusToggle = async (targetUser, active) => {
    const action = active ? 'reativar' : 'desativar';
    const confirmed = await confirm(
      `Tem certeza que deseja ${action} o acesso de "${targetUser.name}"?${!active ? ' A pessoa não vai mais conseguir entrar no sistema.' : ''}`,
      active ? 'Reativar acesso' : 'Desativar acesso'
    );
    if (!confirmed) return;

    setSavingId(targetUser.id);
    try {
      const response = await api.updateUserStatus(targetUser.id, active);
      setUsers((prev) => prev.map((u) => (u.id === targetUser.id ? response.data : u)));
      toast.success(active ? 'Acesso reativado' : 'Acesso desativado');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar status');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="users-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4" data-testid="users-page">
        <PageHeader
          icon={ShieldCheck}
          title="Gestão de Usuários"
          subtitle="Controle quem tem acesso ao sistema e quem pode editar áreas restritas, como Dados da Empresa e o módulo Financeiro"
        />

        <StatGrid>
          <StatCard label="Usuários" value={users.length} icon={Users} tone="blue" />
          <StatCard label="Administradores" value={users.filter((u) => u.role === 'admin').length} icon={ShieldCheck} tone="primary" />
          <StatCard label="Operadores" value={users.filter((u) => u.role !== 'admin').length} icon={UserIcon} tone="slate" />
          <StatCard label="Acessos desativados" value={users.filter((u) => u.active === false).length} icon={UserX} tone="red" />
        </StatGrid>

        <DataCard
          title="Usuários cadastrados"
          count={users.length}
          toolbar={
            <Toolbar primary={<ToolbarPrimary icon={UserPlus} label="Novo usuário" onClick={openCreateDialog} testId="new-user-button" />} />
          }
        >
          {users.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Nível de acesso</th>
                    <th>Cadastrado em</th>
                    <th>Acesso ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === currentUser?.id;
                    const isSaving = savingId === u.id;
                    return (
                      <tr key={u.id} data-testid="user-row">
                        <td>
                          <span className="inline-flex items-center gap-2">
                            <UserTag name={u.name} />
                            {isSelf && <StatusPill tone="primary" dot={false} className="text-[10px] px-1.5">você</StatusPill>}
                          </span>
                        </td>
                        <td className="text-slate-500 dark:text-slate-400">{u.email}</td>
                        <td className="!py-1.5">
                          <Select
                            value={u.role}
                            onValueChange={(value) => handleRoleChange(u, value)}
                            disabled={isSelf || isSaving}
                          >
                            <SelectTrigger className="h-8 w-[160px] text-[13px]" data-testid="user-role-select">
                              <SelectValue>{ROLE_LABELS[u.role] || u.role}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Administrador</SelectItem>
                              <SelectItem value="operator">Operador</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {format(new Date(u.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td className="!py-1.5">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={u.active !== false}
                              onCheckedChange={(checked) => handleStatusToggle(u, checked)}
                              disabled={isSelf || isSaving}
                              data-testid="user-active-switch"
                            />
                            <StatusPill tone={u.active !== false ? 'emerald' : 'slate'}>
                              {u.active !== false ? 'Ativo' : 'Desativado'}
                            </StatusPill>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Users} title="Nenhum usuário cadastrado" testId="no-users" />
          )}
        </DataCard>
      </div>

      <Dialog open={createOpen} onOpenChange={(isOpen) => !creating && setCreateOpen(isOpen)}>
        <DialogContent data-testid="new-user-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Novo usuário</DialogTitle>
            <DialogDescription className="text-[13px]">
              Crie o acesso e passe o email e a senha para a pessoa entrar no sistema
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-user-name" className="text-[13px]">Nome completo *</Label>
              <Input
                id="new-user-name"
                data-testid="new-user-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                autoComplete="off"
                className="h-10 text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-email" className="text-[13px]">Email *</Label>
              <Input
                id="new-user-email"
                data-testid="new-user-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                autoComplete="off"
                className="h-10 text-[13px]"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-user-password" className="text-[13px]">Senha *</Label>
                <div className="relative">
                  <Input
                    id="new-user-password"
                    data-testid="new-user-password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="h-10 text-[13px] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Mínimo de 6 caracteres</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Nível de acesso *</Label>
                <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                  <SelectTrigger className="h-10 text-[13px]" data-testid="new-user-role">
                    <SelectValue>{ROLE_LABELS[formData.role]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operator">Operador</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-start gap-2.5 rounded-md border border-slate-200 dark:border-slate-700 p-3 cursor-pointer">
              <Checkbox
                checked={formData.must_change_password}
                onCheckedChange={(checked) => setFormData({ ...formData, must_change_password: checked === true })}
                data-testid="new-user-must-change"
                className="mt-0.5"
              />
              <span className="text-[13px] leading-snug">
                <span className="font-medium text-slate-800 dark:text-slate-100">Pedir nova senha no primeiro acesso</span>
                <span className="block text-slate-500 dark:text-slate-400 text-[12px]">Ao entrar pela primeira vez, a pessoa é levada a trocar essa senha por uma só dela</span>
              </span>
            </label>
            <Button type="submit" className="w-full h-10 text-[13px] font-semibold" disabled={creating} data-testid="new-user-submit">
              {creating ? 'Cadastrando...' : 'Cadastrar usuário'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </Layout>
  );
}
