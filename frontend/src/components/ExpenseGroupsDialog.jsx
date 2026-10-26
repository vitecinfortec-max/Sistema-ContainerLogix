import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { StatusPill } from './DataPage';
import { useConfirm } from '../hooks/useConfirm';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Save, X, Power } from 'lucide-react';

const errorDetail = (e, fallback) => e?.response?.data?.detail || fallback;

// Cadastro dos grupos de custo da Prestação de Contas (Combustível,
// Alimentação...). Grupo usado em compras não é excluído: fica Inativo e
// some da lista de escolha, mas continua nos relatórios.
export default function ExpenseGroupsDialog({ open, onOpenChange, onChanged }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [groups, setGroups] = useState([]);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState(null); // { id, name }
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await api.getExpenseGroups();
      setGroups(r.data);
      onChanged?.(r.data);
    } catch (e) {
      toast.error('Erro ao carregar os grupos');
    }
  };
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
      return true;
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!newName.trim()) return;
    if (await run(() => api.createExpenseGroup({ name: newName.trim() }), 'Grupo criado')) setNewName('');
  };
  const saveEdit = async (g) => {
    if (await run(() => api.updateExpenseGroup(g.id, { name: editing.name, description: g.description, status: g.status }), 'Grupo renomeado')) {
      setEditing(null);
    }
  };
  const toggle = (g) => run(() => api.updateExpenseGroup(g.id, { name: g.name, description: g.description, status: g.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' }));
  const remove = async (g) => {
    if (!(await confirm(`Excluir o grupo ${g.name}?`))) return;
    run(() => api.deleteExpenseGroup(g.id), 'Grupo excluído');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="expense-groups-dialog">
        <DialogHeader>
          <DialogTitle className="text-base">Grupos de custo</DialogTitle>
          <DialogDescription>Cada compra da prestação de contas é lançada em um grupo, para somar o custo por grupo no dashboard e nos relatórios.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Novo grupo (ex.: Lavagem de veículos)" className="h-9 text-sm" data-testid="expense-group-new" />
          <Button onClick={add} disabled={busy || !newName.trim()} className="h-9"><Plus className="w-4 h-4 mr-1" />Incluir</Button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto divide-y rounded-md border">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {editing?.id === g.id ? (
                <>
                  <Input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(g)} className="h-8 text-sm flex-1" />
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Salvar" onClick={() => saveEdit(g)} disabled={busy}><Save className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Cancelar" onClick={() => setEditing(null)}><X className="w-4 h-4" /></Button>
                </>
              ) : (
                <>
                  <span className={`flex-1 truncate ${g.status === 'INATIVO' ? 'text-slate-400 line-through' : ''}`}>{g.name}</span>
                  <span className="text-[11px] text-slate-500 tabular-nums">{g.purchases} compra(s)</span>
                  {g.status === 'INATIVO' && <StatusPill tone="slate" dot={false} className="text-[10px]">Inativo</StatusPill>}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Renomear" title="Renomear" onClick={() => setEditing({ id: g.id, name: g.name })}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={g.status === 'ATIVO' ? 'Inativar' : 'Reativar'}
                    title={g.status === 'ATIVO' ? 'Inativar (some da lista de escolha)' : 'Reativar'} onClick={() => toggle(g)} disabled={busy}>
                    <Power className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" aria-label="Excluir" title={g.purchases ? 'Usado em compras: inative em vez de excluir' : 'Excluir'}
                    onClick={() => remove(g)} disabled={busy || g.purchases > 0}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog />
    </Dialog>
  );
}
