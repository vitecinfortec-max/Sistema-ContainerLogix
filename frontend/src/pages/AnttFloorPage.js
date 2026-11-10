import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { DataCard, Toolbar, ToolbarButton, ToolbarPrimary, StatusPill, EmptyState, PageSkeleton } from '../components/DataPage';
import { Field } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { useConfirm } from '../hooks/useConfirm';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ExternalLink, FileUp, Loader2, Pencil, Plus, RefreshCw, Scale, Trash2 } from 'lucide-react';

/**
 * Pisos mínimos de frete da ANTT: uma tabela por resolução/portaria, com a
 * data de início de vigência, o fator do retorno vazio e os coeficientes CCD
 * e CC (importados por planilha). O CT-e usa a tabela vigente na data de
 * emissão. Nenhum coeficiente vem pronto: cadastre os da norma oficial.
 * O sistema consulta o Diário Oficial uma vez por dia e só AVISA quando
 * aparece uma nova publicação da ANTT sobre pisos mínimos.
 */
const fmtDate = (v) => (v && v.length >= 10 ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '-');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const toNumber = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const emptyForm = () => ({ resolucao: '', vigencia_inicio: '', fator_retorno_vazio: '', observacoes: '', teste: false });

export default function AnttFloorPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null); // { id|null, form }
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const r = await api.getAnttFloorTables();
      setData(r.data);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao carregar as tabelas ANTT'));
      setData({ items: [], publicacoes: [], verificacao: {} });
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    setImportErrors([]);
    if (!selectedId) { setDetail(null); return; }
    api.getAnttFloorTable(selectedId).then((r) => setDetail(r.data)).catch(() => setDetail(null));
  }, [selectedId]);

  if (!data) return <Layout><PageSkeleton testId="antt-loading" /></Layout>;
  const items = data.items || [];
  const selected = items.find((i) => i.id === selectedId) || null;

  const openNew = () => setEditing({ id: null, form: emptyForm() });
  const openEdit = () => selected && setEditing({
    id: selected.id,
    form: {
      resolucao: selected.resolucao, vigencia_inicio: selected.vigencia_inicio,
      fator_retorno_vazio: selected.fator_retorno_vazio != null ? String(selected.fator_retorno_vazio).replace('.', ',') : '',
      observacoes: selected.observacoes || '', teste: !!selected.teste,
    },
  });
  const setF = (patch) => setEditing((prev) => ({ ...prev, form: { ...prev.form, ...patch } }));

  const save = async () => {
    const f = editing.form;
    if ((f.resolucao || '').trim().length < 3 || !f.vigencia_inicio) {
      toast.error('Informe a resolução/portaria e a data de início de vigência');
      return;
    }
    const fator = toNumber(f.fator_retorno_vazio);
    if (fator !== null && (fator < 0 || fator > 1)) {
      toast.error('O fator do retorno vazio vai de 0 a 1 (ex.: 0,92)');
      return;
    }
    setSaving(true);
    try {
      const body = {
        resolucao: f.resolucao.trim(), vigencia_inicio: f.vigencia_inicio, fator_retorno_vazio: fator,
        observacoes: (f.observacoes || '').trim() || null, teste: !!f.teste,
        coeficientes: editing.id ? (detail?.coeficientes || []) : [],
      };
      const r = editing.id ? await api.updateAnttFloorTable(editing.id, body) : await api.createAnttFloorTable(body);
      toast.success(editing.id ? 'Tabela atualizada' : 'Tabela cadastrada: agora importe a planilha com os coeficientes');
      setEditing(null);
      await load();
      setSelectedId(r.data.id);
      if (editing.id) setDetail(r.data);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao salvar a tabela'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    const ok = await confirm(`Excluir "${selected.resolucao}"? CT-es já calculados guardam o próprio cálculo e não mudam.`, 'Excluir tabela ANTT');
    if (!ok) return;
    try {
      await api.deleteAnttFloorTable(selected.id);
      toast.success('Tabela excluída');
      setSelectedId(null);
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao excluir'));
    }
  };

  const importFile = async (file) => {
    if (!file || !selected) return;
    setImportErrors([]);
    try {
      const r = await api.importAnttFloorTable(selected.id, file);
      toast.success(`${r.data.importados} coeficiente(s) importado(s)`);
      const d = await api.getAnttFloorTable(selected.id);
      setDetail(d.data);
      load();
    } catch (e) {
      const detailErr = e?.response?.data?.detail;
      if (detailErr?.erros) {
        setImportErrors(detailErr.erros);
        toast.error(detailErr.mensagem);
      } else {
        toast.error(apiErrorMessage(e, 'Erro ao importar a planilha'));
      }
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await api.checkAnttPublications();
      toast.success(`Diário Oficial consultado: ${r.data.encontradas} ato(s) da ANTT sobre pisos mínimos neste ano`);
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Não foi possível consultar o Diário Oficial'));
      load();
    } finally {
      setChecking(false);
    }
  };

  const markChecked = async (pub) => {
    try {
      await api.markAnttPublicationChecked(pub.id);
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao marcar como conferida'));
    }
  };

  const check = data.verificacao || {};
  const pubs = data.publicacoes || [];

  return (
    <Layout>
      <div className="space-y-4" data-testid="antt-floor-page">
        <PageHeader icon={Scale} title="Pisos mínimos de frete (ANTT)"
          subtitle="Coeficientes CCD e CC por resolução/portaria. O CT-e usa a tabela vigente na data de emissão." />

        {/* Aviso do Diário Oficial */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-testid="antt-dou">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Novas publicações da ANTT (Diário Oficial)</p>
              <p className="text-xs text-slate-500">
                Consultado automaticamente uma vez por dia · última consulta: {fmtDateTime(check.verificado_em)}
                {check.erro && <span className="text-red-600"> · falhou: {check.erro}</span>}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={checkNow} disabled={checking} data-testid="antt-check-now">
              {checking ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />} Verificar agora
            </Button>
          </div>
          {pubs.length === 0 ? (
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="inline w-3.5 h-3.5 mr-1" />Nenhuma publicação nova depois da tabela vigente cadastrada.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {pubs.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium">{p.titulo}</span> <span>· publicada em {fmtDate(p.data)}</span>
                  {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">abrir <ExternalLink className="w-3 h-3" /></a>}
                  <Button type="button" variant="ghost" size="sm" className="ml-auto h-7" onClick={() => markChecked(p)}>Marcar como conferida</Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">
            É só um aviso: os coeficientes nunca são trocados sozinhos. Confira a norma e cadastre a nova tabela com a planilha. A busca do Diário Oficial pode falhar ou não achar tudo: nada substitui acompanhar as publicações da ANTT.
          </p>
        </section>

        <DataCard title="Tabelas cadastradas" count={items.length} testId="antt-tables"
          toolbar={(
            <Toolbar primary={<ToolbarPrimary icon={Plus} label="Nova tabela" onClick={openNew} testId="antt-new" />}>
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={openEdit} disabled={!selected} testId="antt-edit" />
              <ToolbarButton icon={FileUp} label="Importar planilha" tone="emerald" onClick={() => fileRef.current?.click()} disabled={!selected} testId="antt-import" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={remove} disabled={!selected} testId="antt-delete" />
            </Toolbar>
          )}>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm,text/csv" className="hidden" data-testid="antt-file"
            onChange={(e) => importFile(e.target.files?.[0])} />
          {items.length === 0 ? (
            <EmptyState icon={Scale} title="Nenhuma tabela cadastrada"
              hint='Cadastre a resolução/portaria vigente pelo "Nova tabela" e importe a planilha com os coeficientes oficiais.' testId="antt-empty" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Resolução / portaria</th><th>Início de vigência</th><th className="text-right">Fator retorno vazio</th><th className="text-right">Coeficientes</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id} onClick={() => setSelectedId(t.id === selectedId ? null : t.id)} data-selected={t.id === selectedId} className="cursor-pointer" data-testid={`antt-row-${t.id}`}>
                      <td className="cell-strong">{t.resolucao}{t.teste && <span className="ml-2 rounded bg-red-100 px-1.5 text-[0.6875rem] font-bold text-red-700">TESTE</span>}</td>
                      <td>{fmtDate(t.vigencia_inicio)}</td>
                      <td className="text-right tabular-nums">{t.fator_retorno_vazio != null ? String(t.fator_retorno_vazio).replace('.', ',') : '-'}</td>
                      <td className="text-right tabular-nums">{t.total_coeficientes}</td>
                      <td>{t.vigente ? <StatusPill tone="emerald">Vigente</StatusPill> : t.vigencia_inicio > new Date().toISOString().slice(0, 10)
                        ? <StatusPill tone="blue">Futura</StatusPill> : <StatusPill tone="slate">Histórico</StatusPill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        {selected && (
          <DataCard title={`Coeficientes · ${selected.resolucao}`} count={detail?.coeficientes?.length ?? 0} testId="antt-coefs">
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs text-slate-500">
                Planilha (.xlsx ou .csv) com o cabeçalho <code>tabela; tipo_carga; eixos; ccd; cc</code> na 1ª linha (aceita vírgula decimal).
                Tabela A a D, tipo de carga 1 a 12, eixos 2, 3, 4, 5, 6, 7 ou 9. A importação substitui os coeficientes desta tabela; se alguma linha tiver erro, nada é gravado.
                {detail?.importado_de && <> Última importação: {detail.importado_de} por {detail.importado_por} em {fmtDateTime(detail.importado_em)}.</>}
              </p>
              {importErrors.length > 0 && (
                <ul className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" data-testid="antt-import-errors">
                  {importErrors.map((msg) => <li key={msg}>• {msg}</li>)}
                </ul>
              )}
            </div>
            {detail?.coeficientes?.length ? (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Tabela</th><th>Tipo de carga</th><th className="text-right">Eixos</th><th className="text-right">CCD (R$/km)</th><th className="text-right">CC (R$)</th></tr></thead>
                  <tbody>
                    {detail.coeficientes.map((c) => (
                      <tr key={`${c.tabela}-${c.tipo_carga}-${c.eixos}`}>
                        <td>{c.tabela}</td><td>{c.tipo_carga}</td><td className="text-right">{c.eixos}</td>
                        <td className="text-right tabular-nums">{Number(c.ccd).toLocaleString('pt-BR', { minimumFractionDigits: 4 })}</td>
                        <td className="text-right tabular-nums">{Number(c.cc).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 pb-4 text-sm text-amber-700" data-testid="antt-no-coefs">Sem coeficientes: importe a planilha da norma oficial.</p>
            )}
          </DataCard>
        )}

        <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
          {editing && (
            <DialogContent className="max-w-lg" data-testid="antt-dialog">
              <DialogHeader><DialogTitle>{editing.id ? 'Editar tabela ANTT' : 'Nova tabela ANTT'}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Field label="Resolução / portaria *" hint="Ex.: Portaria SUROC nº 22/2026">
                  <Input value={editing.form.resolucao} maxLength={120} onChange={(e) => setF({ resolucao: e.target.value })} data-testid="antt-resolucao" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Início de vigência *">
                    <Input type="date" value={editing.form.vigencia_inicio} onChange={(e) => setF({ vigencia_inicio: e.target.value })} data-testid="antt-vigencia" />
                  </Field>
                  <Field label="Fator do retorno vazio" hint="Da norma (0 a 1). Vazio: sem cálculo de retorno">
                    <Input inputMode="decimal" value={editing.form.fator_retorno_vazio} onChange={(e) => setF({ fator_retorno_vazio: e.target.value.replace(/[^\d,]/g, '') })} data-testid="antt-fator" />
                  </Field>
                </div>
                <Field label="Observações">
                  <Textarea rows={2} value={editing.form.observacoes} onChange={(e) => setF({ observacoes: e.target.value })} />
                </Field>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={editing.form.teste} onCheckedChange={(c) => setF({ teste: !!c })} data-testid="antt-teste" />
                  Dados de TESTE (não oficiais) - o CT-e mostra o aviso
                </label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                <Button type="button" onClick={save} disabled={saving} data-testid="antt-save">{saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Salvar</Button>
              </DialogFooter>
            </DialogContent>
          )}
        </Dialog>
        <ConfirmDialog />
      </div>
    </Layout>
  );
}
