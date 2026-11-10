import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { DataCard, EmptyState, StatusPill } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useConfirm } from '../hooks/useConfirm';
import { useUrlState } from '../hooks/useUrlState';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { toast } from 'sonner';
import { ListTree, Plus, Trash2 } from 'lucide-react';

const KINDS = { DESPESA: 'Despesa', RECEITA: 'Receita' };

// Edição direto na linha: o nome/código salva ao sair do campo
function useSaver(onChanged) {
  const [busy, setBusy] = useState(false);
  const run = async (action, success) => {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      await onChanged();
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível salvar'));
      await onChanged();
      return false;
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

function AccountsTab() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ code: '', name: '', kind: 'DESPESA' });
  const load = () => api.getChartAccounts().then((r) => setItems(r.data || []))
    .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar o plano de contas')))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  const [busy, run] = useSaver(load);

  const add = async () => {
    if (!draft.code.trim() || !draft.name.trim()) return;
    if (await run(() => api.createChartAccount({ ...draft, active: true }), 'Conta cadastrada')) setDraft({ code: '', name: '', kind: draft.kind });
  };
  const save = (item, changes) => run(() => api.updateChartAccount(item.id, { code: item.code, name: item.name, kind: item.kind, active: item.active, ...changes }));
  const remove = async (item) => {
    if (await confirm(`Excluir a conta ${item.code} ${item.name}?`)) run(() => api.deleteChartAccount(item.id), 'Conta excluída');
  };

  return (
    <DataCard title="Plano de contas" count={items.length}>
      <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-2 items-end">
        <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} className="w-24" aria-label="Código da nova conta" data-testid="new-account-code" />
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="flex-1 min-w-[180px]" aria-label="Nome da nova conta"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} data-testid="new-account-name" />
        <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v })}>
          <SelectTrigger className="w-32" aria-label="Tipo da nova conta"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(KINDS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" onClick={add} disabled={busy || !draft.code.trim() || !draft.name.trim()} data-testid="add-account-btn">
          <Plus className="w-4 h-4 mr-1" /> Adicionar conta
        </Button>
      </div>
      {loading ? <EmptyState loading /> : items.length === 0 ? <EmptyState icon={ListTree} title="Nenhuma conta cadastrada" /> : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th className="w-28">Código</th><th>Nome</th><th className="w-32">Tipo</th><th className="w-24">Ativa</th><th aria-label="Excluir" /></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td><Input key={`${a.id}-${a.code}`} defaultValue={a.code} onBlur={(e) => e.target.value.trim() !== a.code && save(a, { code: e.target.value })} aria-label={`Código da conta ${a.name}`} /></td>
                  <td><Input key={`${a.id}-${a.name}`} defaultValue={a.name} onBlur={(e) => e.target.value.trim() !== a.name && save(a, { name: e.target.value })} className={a.active ? '' : 'text-slate-400'} aria-label={`Nome da conta ${a.code}`} /></td>
                  <td>
                    <Select value={a.kind} onValueChange={(v) => save(a, { kind: v })}>
                      <SelectTrigger aria-label={`Tipo da conta ${a.code}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(KINDS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox checked={a.active} onCheckedChange={(v) => save(a, { active: !!v })} disabled={busy} aria-label={`Conta ${a.code} ativa`} />
                      {a.active ? <StatusPill tone="emerald">Ativa</StatusPill> : <StatusPill tone="slate">Inativa</StatusPill>}
                    </label>
                  </td>
                  <td>
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(a)} disabled={busy} aria-label={`Excluir a conta ${a.code}`} title="Excluir conta">
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog />
    </DataCard>
  );
}

function CostCentersTab() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const load = () => api.getCostCenters().then((r) => setItems(r.data || []))
    .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar os centros de custo')))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  const [busy, run] = useSaver(load);

  const add = async () => {
    if (!name.trim()) return;
    if (await run(() => api.createCostCenter({ name, active: true }), 'Centro de custo cadastrado')) setName('');
  };
  const save = (item, changes) => run(() => api.updateCostCenter(item.id, { name: item.name, active: item.active, ...changes }));
  const remove = async (item) => {
    if (await confirm(`Excluir o centro de custo "${item.name}"?`)) run(() => api.deleteCostCenter(item.id), 'Centro de custo excluído');
  };

  return (
    <DataCard title="Centros de custo" count={items.length}>
      <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 min-w-[200px]" aria-label="Nome do novo centro de custo"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} data-testid="new-center-name" />
        <Button type="button" onClick={add} disabled={busy || !name.trim()} data-testid="add-center-btn">
          <Plus className="w-4 h-4 mr-1" /> Adicionar centro de custo
        </Button>
      </div>
      {loading ? <EmptyState loading /> : items.length === 0 ? <EmptyState icon={ListTree} title="Nenhum centro de custo cadastrado" /> : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Nome</th><th className="w-24">Ativo</th><th aria-label="Excluir" /></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td><Input key={`${c.id}-${c.name}`} defaultValue={c.name} onBlur={(e) => e.target.value.trim() !== c.name && save(c, { name: e.target.value })} className={c.active ? '' : 'text-slate-400'} aria-label={`Nome do centro de custo ${c.name}`} /></td>
                  <td>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox checked={c.active} onCheckedChange={(v) => save(c, { active: !!v })} disabled={busy} aria-label={`Centro de custo ${c.name} ativo`} />
                      {c.active ? <StatusPill tone="emerald">Ativo</StatusPill> : <StatusPill tone="slate">Inativo</StatusPill>}
                    </label>
                  </td>
                  <td>
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(c)} disabled={busy} aria-label={`Excluir o centro de custo ${c.name}`} title="Excluir centro de custo">
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog />
    </DataCard>
  );
}

export default function ChartOfAccountsPage() {
  const [tab, setTab] = useUrlState('tab', 'contas');
  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4" data-testid="chart-of-accounts-page">
        <PageHeader
          backTo="/accounts-payable"
          icon={ListTree}
          title="Plano de Contas e Centros de Custo"
          subtitle="Classificação das contas a pagar. Conta já usada não pode ser excluída: desative para tirar das listas."
        />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="contas" data-testid="tab-accounts">Plano de contas</TabsTrigger>
            <TabsTrigger value="centros" data-testid="tab-centers">Centros de custo</TabsTrigger>
          </TabsList>
          <TabsContent value="contas" className="mt-4"><AccountsTab /></TabsContent>
          <TabsContent value="centros" className="mt-4"><CostCentersTab /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
