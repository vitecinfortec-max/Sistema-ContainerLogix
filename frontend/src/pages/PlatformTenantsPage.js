import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary, StatusPill, EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { useConfirm } from '../hooks/useConfirm';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Building2, Plus, Pencil, LayoutGrid, PauseCircle, PlayCircle, Save, Copy, Users, KeyRound, FolderInput } from 'lucide-react';

const errorDetail = (e, fallback) => e?.response?.data?.detail || fallback;
const slugify = (text) => (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const fmtDateTime = (v) => { try { return v ? format(new Date(v), 'dd/MM/yyyy HH:mm') : '-'; } catch (e) { return '-'; } };
const EMPTY = { name: '', slug: '', slugTouched: false, hosts: '', notes: '', admin_name: '', admin_email: '' };

/** Painel do dono do sistema: empresas (clientes) atendidas pelo servidor. */
export default function PlatformTenantsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [catalog, setCatalog] = useState([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', hosts: '', notes: '' });
  const [modulesOpen, setModulesOpen] = useState(false);
  const [disabled, setDisabled] = useState(() => new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState('');
  const [importStatus, setImportStatus] = useState(null);

  // Cópia dos arquivos: acompanha a cada 2s enquanto estiver copiando
  useEffect(() => {
    if (!importOpen || importStatus?.state !== 'COPIANDO') return undefined;
    const timer = setInterval(() => {
      api.getPlatformTenantImport(selected.slug).then((r) => setImportStatus(r.data)).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [importOpen, importStatus?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    api.getModuleCatalog().then((r) => setCatalog(r.data.catalog || [])).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getPlatformTenants();
      setRows(r.data || []);
      setSelected((prev) => (prev ? (r.data || []).find((t) => t.slug === prev.slug) || null : null));
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao carregar as empresas'));
    } finally {
      setLoading(false);
    }
  };

  const hostsOf = (text) => text.split(/[\n,;]+/).map((h) => h.trim()).filter(Boolean);
  const setField = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v };
    if (k === 'name' && !f.slugTouched) next.slug = slugify(v);
    if (k === 'slug') next.slugTouched = true;
    return next;
  });

  const openCreate = () => { setForm(EMPTY); setCreateOpen(true); };
  const create = async () => {
    if (!form.name.trim() || !form.slug.trim() || !form.admin_name.trim() || !form.admin_email.trim()) {
      toast.error('Preencha empresa, identificador e o administrador'); return;
    }
    setSaving(true);
    try {
      const hosts = hostsOf(form.hosts);
      const r = await api.createPlatformTenant({
        name: form.name.trim(), slug: form.slug.trim(), notes: form.notes || null,
        hosts: hosts.length ? hosts : [`${form.slug.trim()}.containerlogix.com.br`],
        admin_name: form.admin_name.trim(), admin_email: form.admin_email.trim(),
      });
      setCreateOpen(false);
      setCreated(r.data);
      load();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao criar a empresa'));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = () => {
    setEditForm({ name: selected.name, hosts: (selected.hosts || []).join('\n'), notes: selected.notes || '' });
    setEditOpen(true);
  };
  const saveEdit = async () => {
    setSaving(true);
    try {
      await api.updatePlatformTenant(selected.slug, { name: editForm.name, hosts: hostsOf(editForm.hosts), notes: editForm.notes || null });
      toast.success('Empresa atualizada');
      setEditOpen(false);
      load();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar'));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async () => {
    const suspend = selected.status === 'ATIVO';
    const msg = suspend
      ? `Suspender ${selected.name}? Ninguém da empresa consegue acessar até reativar. Os dados não são apagados.`
      : `Reativar o acesso de ${selected.name}?`;
    if (!(await confirm(msg))) return;
    try {
      await api.setPlatformTenantStatus(selected.slug, suspend ? 'SUSPENSO' : 'ATIVO');
      toast.success(suspend ? 'Empresa suspensa' : 'Empresa reativada');
      load();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao alterar a situação'));
    }
  };

  const openModules = () => { setDisabled(new Set(selected.disabled_modules || [])); setModulesOpen(true); };
  const toggleKey = (key) => setDisabled((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const saveModules = async () => {
    setSaving(true);
    try {
      await api.setPlatformTenantModules(selected.slug, [...disabled]);
      toast.success('Módulos atualizados');
      setModulesOpen(false);
      load();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar os módulos'));
    } finally {
      setSaving(false);
    }
  };

  const openImport = async () => {
    setImportSource(selected.legacy_backend_url || '');
    setImportStatus(null);
    setImportOpen(true);
    try { setImportStatus((await api.getPlatformTenantImport(selected.slug)).data); } catch (e) { /* sem histórico */ }
  };
  const startImport = async () => {
    try {
      setImportStatus((await api.importPlatformTenantUploads(selected.slug, importSource)).data);
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao iniciar a cópia'));
    }
  };
  const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round((n || 0) / 1024)} KB`);

  const copyAccess = () => {
    const tenant = created.tenant;
    const text = `Acesso ao ContainerLogix - ${tenant.name}\nEndereço: https://${tenant.hosts[0] || ''}\nCódigo da empresa (app): ${tenant.slug}\n`
      + `E-mail: ${created.admin_email}\nSenha provisória: ${created.temp_password}\n(No primeiro acesso o sistema pede uma senha nova.)`;
    navigator.clipboard?.writeText(text).then(() => toast.success('Dados de acesso copiados')).catch(() => toast.error('Não foi possível copiar'));
  };

  const active = rows.filter((t) => t.status === 'ATIVO').length;

  return (
    <Layout>
      <div className="space-y-4" data-testid="platform-page">
        <PageHeader icon={Building2} title="Clientes do Sistema"
          subtitle="Empresas atendidas pelo ContainerLogix: criar cliente, endereços, módulos contratados e suspensão de acesso" />

        <StatGrid>
          <StatCard label="Empresas ativas" value={active} icon={Building2} tone="emerald" />
          <StatCard label="Suspensas" value={rows.length - active} icon={PauseCircle} tone="amber" />
          <StatCard label="Usuários" value={rows.reduce((a, t) => a + (t.users || 0), 0)} icon={Users} tone="blue" hint="em todas as empresas" />
        </StatGrid>

        <DataCard
          title="Empresas"
          count={loading ? '...' : rows.length}
          toolbar={(
            <Toolbar selectedCount={selected ? 1 : 0} primary={<ToolbarPrimary icon={Plus} label="Novo cliente" onClick={openCreate} testId="platform-new-btn" />}>
              <ToolbarButton icon={Pencil} label="Editar nome e endereços" tone="blue" onClick={openEdit} disabled={!selected} testId="platform-edit-btn" />
              <ToolbarButton icon={LayoutGrid} label="Módulos contratados" tone="primary" onClick={openModules} disabled={!selected} testId="platform-modules-btn" />
              <ToolbarButton icon={FolderInput} label="Copiar arquivos do servidor antigo" tone="emerald" onClick={openImport} disabled={!selected} testId="platform-import-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={selected?.status === 'SUSPENSO' ? PlayCircle : PauseCircle} label={selected?.status === 'SUSPENSO' ? 'Reativar' : 'Suspender'}
                tone="amber" onClick={toggleStatus} disabled={!selected || selected.current} testId="platform-status-btn" />
            </Toolbar>
          )}
        >
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0" />
                    <th>Empresa</th>
                    <th>Código</th>
                    <th>Endereços</th>
                    <th className="!text-center">Usuários</th>
                    <th className="!text-center">Movimentações</th>
                    <th>Última movimentação</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.slug} onClick={() => setSelected(selected?.slug === t.slug ? null : t)} data-selected={selected?.slug === t.slug}
                      className="cursor-pointer" data-testid={`platform-row-${t.slug}`}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected?.slug === t.slug} onCheckedChange={() => setSelected(selected?.slug === t.slug ? null : t)} />
                      </td>
                      <td className="cell-strong">
                        {t.name}
                        {t.current && <span className="ml-2 text-[11px] font-normal text-primary">(você está aqui)</span>}
                        <span className="block text-[11px] font-normal text-slate-400">banco {t.db_name}</span>
                      </td>
                      <td className="tabular-nums">{t.slug}</td>
                      <td><div className="max-w-[260px] text-[12px] leading-snug">{(t.hosts || []).join(', ') || '-'}</div></td>
                      <td className="text-center tabular-nums">{t.users}</td>
                      <td className="text-center tabular-nums">{t.movements}</td>
                      <td className="tabular-nums whitespace-nowrap">{fmtDateTime(t.last_movement_at)}</td>
                      <td><StatusPill tone={t.status === 'ATIVO' ? 'emerald' : 'amber'}>{t.status === 'ATIVO' ? 'Ativa' : 'Suspensa'}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Building2} loading={loading} title="Nenhuma empresa no cadastro central" />
          )}
        </DataCard>
      </div>

      {/* Novo cliente */}
      <Dialog open={createOpen} onOpenChange={(v) => !saving && setCreateOpen(v)}>
        <DialogContent className="max-w-xl" data-testid="platform-create-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="text-base">Novo Cliente</DialogTitle>
            <DialogDescription>Cria o banco da empresa, o primeiro administrador (com senha provisória) e a sua conta master.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Nome da empresa *</Label>
              <Input value={form.name} onChange={(e) => setField('name', e.target.value)} className="h-9 text-sm" data-testid="platform-name" />
            </div>
            <div>
              <Label className="mb-1.5 block">Código da empresa *</Label>
              <Input value={form.slug} onChange={(e) => setField('slug', slugify(e.target.value))} className="h-9 text-sm" data-testid="platform-slug" />
              <p className="text-[11px] text-slate-500 mt-1">Não muda depois. Usado no app e no endereço.</p>
            </div>
            <div>
              <Label className="mb-1.5 block">Endereços (um por linha)</Label>
              <Textarea value={form.hosts} onChange={(e) => setField('hosts', e.target.value)} className="text-sm min-h-[60px]" />
              <p className="text-[11px] text-slate-500 mt-1">Vazio: {form.slug || 'codigo'}.containerlogix.com.br</p>
            </div>
            <div>
              <Label className="mb-1.5 block">Administrador da empresa *</Label>
              <Input value={form.admin_name} onChange={(e) => setField('admin_name', e.target.value)} className="h-9 text-sm" data-testid="platform-admin-name" />
            </div>
            <div>
              <Label className="mb-1.5 block">E-mail do administrador *</Label>
              <Input type="email" value={form.admin_email} onChange={(e) => setField('admin_email', e.target.value)} className="h-9 text-sm" data-testid="platform-admin-email" />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Observações</Label>
              <Textarea value={form.notes} onChange={(e) => setField('notes', e.target.value)} className="text-sm min-h-[50px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={create} disabled={saving} data-testid="platform-create-confirm"><Plus className="w-4 h-4 mr-2" />{saving ? 'Criando...' : 'Criar cliente'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dados de acesso do cliente criado */}
      <Dialog open={!!created} onOpenChange={(v) => !v && setCreated(null)}>
        <DialogContent className="max-w-md" data-testid="platform-created-dialog">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" />Cliente criado</DialogTitle>
            <DialogDescription>Anote ou copie agora: a senha provisória não aparece de novo.</DialogDescription>
          </DialogHeader>
          {created && (
            <div className="rounded-md bg-muted p-3 text-sm space-y-1" data-testid="platform-created-info">
              <div><span className="text-slate-500">Empresa:</span> <b>{created.tenant.name}</b></div>
              <div><span className="text-slate-500">Endereço:</span> <b>https://{created.tenant.hosts[0]}</b></div>
              <div><span className="text-slate-500">Código (app):</span> <b>{created.tenant.slug}</b></div>
              <div><span className="text-slate-500">E-mail:</span> <b>{created.admin_email}</b></div>
              <div><span className="text-slate-500">Senha provisória:</span> <b className="font-mono">{created.temp_password}</b></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={copyAccess}><Copy className="w-4 h-4 mr-2" />Copiar dados de acesso</Button>
            <Button onClick={() => setCreated(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar */}
      <Dialog open={editOpen} onOpenChange={(v) => !saving && setEditOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Editar Empresa</DialogTitle>
            <DialogDescription>Código {selected?.slug} · banco {selected?.db_name} (não mudam)</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1.5 block">Nome *</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1.5 block">Endereços (um por linha)</Label>
              <Textarea value={editForm.hosts} onChange={(e) => setEditForm((f) => ({ ...f, hosts: e.target.value }))} className="text-sm min-h-[80px]" />
            </div>
            <div>
              <Label className="mb-1.5 block">Observações</Label>
              <Textarea value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} className="text-sm min-h-[50px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving}><Save className="w-4 h-4 mr-2" />Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Módulos */}
      <Dialog open={modulesOpen} onOpenChange={(v) => !saving && setModulesOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="platform-modules-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Módulos Contratados · {selected?.name}</DialogTitle>
            <DialogDescription>Marcado = liberado para a empresa.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {catalog.map((group) => (
              <div key={group.key} className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
                <label className="flex items-center gap-2 font-semibold text-sm mb-2">
                  <Checkbox checked={!disabled.has(group.key)} onCheckedChange={() => toggleKey(group.key)} />{group.label}
                </label>
                <div className="space-y-1 pl-6">
                  {group.items.map((item) => (
                    <label key={item.key} className={`flex items-center gap-2 text-[13px] ${disabled.has(group.key) ? 'opacity-40' : ''}`}>
                      <Checkbox checked={!disabled.has(item.key)} disabled={disabled.has(group.key)} onCheckedChange={() => toggleKey(item.key)} />{item.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModulesOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={saveModules} disabled={saving} data-testid="platform-modules-save"><Save className="w-4 h-4 mr-2" />Salvar módulos</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Cópia dos arquivos (virada) */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg" data-testid="platform-import-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Copiar Arquivos · {selected?.name}</DialogTitle>
            <DialogDescription>
              Traz as fotos e PDFs do servidor antigo da empresa para este servidor. Pode repetir: só copia o que falta ou mudou, e não apaga nada no antigo.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block">Endereço do servidor antigo</Label>
            <Input value={importSource} onChange={(e) => setImportSource(e.target.value)} className="h-9 text-sm" data-testid="platform-import-source" />
          </div>
          {importStatus && importStatus.state !== 'NUNCA' && (
            <div className="rounded-md bg-muted p-3 text-sm space-y-1" data-testid="platform-import-status">
              <div><b>{{ COPIANDO: 'Copiando...', CONCLUIDO: 'Cópia concluída', ERRO: 'Erro na cópia' }[importStatus.state]}</b></div>
              <div>Arquivos: {importStatus.total ?? '...'} · copiados {importStatus.copied} · já existiam {importStatus.skipped} · com erro {importStatus.failed}</div>
              <div>Transferido: {fmtBytes(importStatus.bytes)}</div>
              {importStatus.error && <div className="text-destructive">{importStatus.error}</div>}
              {(importStatus.errors || []).slice(0, 5).map((err) => <div key={err} className="text-[11px] text-destructive">{err}</div>)}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Fechar</Button>
            <Button onClick={startImport} disabled={!importSource || importStatus?.state === 'COPIANDO'} data-testid="platform-import-start">
              <FolderInput className="w-4 h-4 mr-2" />{importStatus?.state === 'CONCLUIDO' ? 'Copiar de novo' : 'Copiar arquivos'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
