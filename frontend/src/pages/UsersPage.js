import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { Users, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const ROLE_LABELS = {
  admin: 'Administrador',
  operator: 'Operador',
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

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
      <div className="space-y-5" data-testid="users-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Gestão de Usuários
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
            Controle quem tem acesso ao sistema e quem pode editar áreas restritas, como Dados da Empresa e o módulo Financeiro
          </p>
        </div>

        <Card>
          <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
            <CardTitle className="text-[13px] font-medium">Usuários Cadastrados ({users.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {users.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nome</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Email</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nível de Acesso</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cadastrado em</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Acesso Ativo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {users.map((u) => {
                      const isSelf = u.id === currentUser?.id;
                      const isSaving = savingId === u.id;
                      return (
                        <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" data-testid="user-row">
                          <td className="px-4 py-2.5 text-[13px] font-medium">
                            {u.name}
                            {isSelf && <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">(você)</span>}
                          </td>
                          <td className="px-4 py-2.5 text-[13px] text-slate-500 dark:text-slate-400">{u.email}</td>
                          <td className="px-4 py-2.5">
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
                          <td className="px-4 py-2.5 text-[13px]">
                            {format(new Date(u.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={u.active !== false}
                                onCheckedChange={(checked) => handleStatusToggle(u, checked)}
                                disabled={isSelf || isSaving}
                                data-testid="user-active-switch"
                              />
                              <span className={`text-[12px] font-medium ${u.active !== false ? 'text-green-600' : 'text-slate-400 dark:text-slate-500'}`}>
                                {u.active !== false ? 'Ativo' : 'Desativado'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-500 dark:text-slate-400" data-testid="no-users">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">Nenhum usuário cadastrado</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
