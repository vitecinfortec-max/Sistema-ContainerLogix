import { useEffect, useState } from 'react';
import { Megaphone, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { StatusPill } from './DataPage';
import { useConfirm } from '../hooks/useConfirm';
import { api } from '../lib/api';
import { toLocalDay } from '../lib/dates';

// Cadastro dos avisos que aparecem no painel da tela de login (Dados da
// Empresa, só administrador). A tela de login mostra os ativos dentro do
// período; aqui a lista mostra todos com a situação de cada um.

const EMPTY = { title: '', message: '', link_label: '', link_url: '', start_date: '', end_date: '', active: true };
const fmtDay = (d) => (d ? d.split('-').reverse().join('/') : '');

function situation(n, today) {
  if (!n.active) return ['Desativado', 'slate'];
  if (n.start_date && n.start_date > today) return [`A partir de ${fmtDay(n.start_date)}`, 'blue'];
  if (n.end_date && n.end_date < today) return ['Encerrado', 'slate'];
  return ['Na tela de login', 'emerald'];
}

export default function LoginNoticesManager() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const today = toLocalDay(new Date());

  const load = () => api.listLoginNotices().then((r) => setList(r.data || [])).catch(() => toast.error('Erro ao carregar os avisos'));
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const openNew = () => { setEditingId(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (n) => {
    setEditingId(n.id);
    setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v ?? (k === 'active' ? true : '')])) });
    setOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) {
      toast.error('Informe o título do aviso');
      return;
    }
    const payload = { ...form };
    ['message', 'link_label', 'link_url', 'start_date', 'end_date'].forEach((k) => { if (!payload[k]) payload[k] = null; });
    setSaving(true);
    try {
      if (editingId) await api.updateLoginNotice(editingId, payload);
      else await api.createLoginNotice(payload);
      toast.success(editingId ? 'Aviso atualizado' : 'Aviso cadastrado');
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar o aviso');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n) => {
    if (!(await confirm(`Excluir o aviso "${n.title}"?`))) return;
    try {
      await api.deleteLoginNotice(n.id);
      toast.success('Aviso excluído');
      load();
    } catch (e) {
      toast.error('Erro ao excluir o aviso');
    }
  };

  return (
    <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="login-notices-manager">
      <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Megaphone className="w-4 h-4" />
            Avisos da tela de login
          </CardTitle>
          <CardDescription className="text-xs mt-1">
            Aparecem no painel ao lado do formulário de login, para todos que entram no sistema. Com mais de um, eles se revezam.
          </CardDescription>
        </div>
        <Button type="button" size="sm" onClick={openNew} className="h-8 gap-1.5 shrink-0" data-testid="new-login-notice">
          <Plus className="w-4 h-4" />Novo aviso
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {list.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400 text-center">
            Nenhum aviso cadastrado. Sem aviso, a tela de login mostra só a marca do sistema.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((n) => {
              const [label, tone] = situation(n, today);
              const period = n.start_date || n.end_date
                ? `${n.start_date ? fmtDay(n.start_date) : 'desde já'} até ${n.end_date ? fmtDay(n.end_date) : 'sem fim'}`
                : 'sem prazo';
              return (
                <li key={n.id} className="flex items-start gap-3 px-4 py-3" data-testid="login-notice-row">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{n.title}</p>
                    {n.message && <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">{n.message}</p>}
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                      {period}{n.link_url ? ` · botão "${n.link_label || 'Saiba mais'}"` : ''}
                    </p>
                  </div>
                  <StatusPill tone={tone}>{label}</StatusPill>
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" title="Editar" aria-label="Editar" onClick={() => openEdit(n)}>
                    <Pencil className="w-4 h-4 text-blue-600" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" title="Excluir" aria-label="Excluir" onClick={() => remove(n)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="login-notice-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Megaphone className="w-5 h-5 text-primary" />
              {editingId ? 'Editar aviso' : 'Novo aviso'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="mb-1.5 block">Título <span className="text-destructive">*</span></Label>
              <Input value={form.title} maxLength={80} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Feriado na sexta-feira" data-testid="login-notice-title-input" />
            </div>
            <div className="col-span-2">
              <Label className="mb-1.5 block">Texto</Label>
              <Textarea value={form.message} maxLength={400} onChange={(e) => set('message', e.target.value)} className="min-h-[80px] text-sm" data-testid="login-notice-message-input" />
              <p className="text-[11px] text-slate-400 mt-1 text-right">{(form.message || '').length}/400</p>
            </div>
            <div>
              <Label className="mb-1.5 block">Texto do botão</Label>
              <Input value={form.link_label} maxLength={40} onChange={(e) => set('link_label', e.target.value)} placeholder="Saiba mais" />
            </div>
            <div>
              <Label className="mb-1.5 block">Link do botão</Label>
              <Input value={form.link_url} onChange={(e) => set('link_url', e.target.value)} placeholder="https://..." data-testid="login-notice-link-input" />
            </div>
            <div>
              <Label className="mb-1.5 block">Mostrar a partir de</Label>
              <Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block">Mostrar até</Label>
              <Input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <Switch checked={!!form.active} onCheckedChange={(v) => set('active', v)} />
              Ativo (aparece na tela de login dentro do período)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} data-testid="login-notice-save">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Salvar aviso'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Card>
  );
}
