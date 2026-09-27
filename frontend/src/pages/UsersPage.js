import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, DataCard, StatusPill, UserTag, EmptyState } from '../components/DataPage';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { Users, ShieldCheck, User as UserIcon, UserX } from 'lucide-react';
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

        <DataCard title="Usuários cadastrados" count={users.length}>
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
      <ConfirmDialog />
    </Layout>
  );
}
