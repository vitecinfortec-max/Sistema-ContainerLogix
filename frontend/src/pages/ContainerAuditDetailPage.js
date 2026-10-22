import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatusPill, PageSkeleton, StatCard, StatGrid, SearchInput } from '../components/DataPage';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { formatContainerNumber } from '../lib/containerNumber';
import { compressImage } from '../lib/imageCompression';
import {
  CheckCircle2, XCircle, Camera, PlusCircle, Download, Loader2, ListChecks, ScanLine, Trash2, AlertTriangle, ClipboardCheck,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_STYLES = {
  PENDENTE: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  CONFIRMADO: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  FALTANTE: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  NAO_ESPERADO: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
};
const STATUS_LABELS = {
  PENDENTE: 'Pendente',
  CONFIRMADO: 'Confirmado',
  FALTANTE: 'Faltante',
  NAO_ESPERADO: 'Não Esperado',
};

const SIZE_TYPE_OPTIONS = ['20DC', '20RF', '20OT', '20FR', '40HC', '40RF', '40OT', '40FR', '40DRY'];

// Compara pelo número padronizado: snapshots antigos podem ter o número sem o traço
const sameContainer = (a, b) => formatContainerNumber(a) === formatContainerNumber(b);
const searchKey = (v) => (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export default function ContainerAuditDetailPage() {
  const { id } = useParams();
  const { confirm, ConfirmDialog } = useConfirm();
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingContainer, setSavingContainer] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [newContainer, setNewContainer] = useState('');
  const [obsDrafts, setObsDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(null); // { file, previewUrl, reading, number, sizeType, error }
  const [scanning, setScanning] = useState(false);
  const [scanSaving, setScanSaving] = useState(false);
  // Um só seletor de arquivo para as fotos dos itens: guarda de qual container é a foto
  const photoInputRef = useRef(null);
  const photoTargetRef = useRef(null);
  const scanInputRef = useRef(null);

  useEffect(() => {
    loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => () => { if (scan?.previewUrl) URL.revokeObjectURL(scan.previewUrl); }, [scan?.previewUrl]);

  const applyAudit = (data) => {
    setAudit(data);
    const drafts = {};
    (data.items || []).forEach(i => { drafts[i.container_number] = i.observations || ''; });
    setObsDrafts(drafts);
  };

  const loadAudit = async () => {
    try {
      const response = await api.getContainerAudit(id);
      applyAudit(response.data);
    } catch (error) {
      toast.error('Erro ao carregar auditoria');
    } finally {
      setLoading(false);
    }
  };

  const isLocked = audit?.status === 'CONCLUIDA';

  // Mantém os rascunhos de observação de outros itens ao receber a auditoria atualizada
  const mergeAudit = (data) => {
    setAudit(data);
    setObsDrafts(prev => {
      const next = { ...prev };
      (data.items || []).forEach(i => { if (!(i.container_number in next)) next[i.container_number] = i.observations || ''; });
      return next;
    });
  };

  const updateItem = async (containerNumber, status, { observations, sizeType } = {}) => {
    setSavingContainer(containerNumber);
    try {
      const response = await api.updateContainerAuditItem(id, {
        container_number: containerNumber,
        status,
        observations: observations !== undefined ? observations : (obsDrafts[containerNumber] || ''),
        size_type: sizeType || null,
      });
      mergeAudit(response.data);
      return response.data;
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar container');
      return null;
    } finally {
      setSavingContainer(null);
    }
  };

  // Salva a observação só quando mudou - antes cada saída do campo gravava
  const saveObservation = (item, value) => {
    if ((value || '') === (item.observations || '')) return;
    updateItem(item.container_number, item.status, { observations: value });
  };

  const handleAddUnexpected = async () => {
    const formatted = formatContainerNumber(newContainer);
    if (!formatted) {
      toast.error('Informe o número do container');
      return;
    }
    const existing = (audit.items || []).find(i => sameContainer(i.container_number, formatted));
    const updated = await updateItem(existing?.container_number || formatted, 'NAO_ESPERADO', { observations: existing ? undefined : '' });
    if (!updated) return;
    setNewContainer('');
    if (existing?.expected) toast.success(`Container ${formatted} estava na lista de esperados: marcado como Confirmado`);
    else if (existing) toast.info(`Container ${formatted} já estava lançado como não esperado`);
    else toast.success(`Container ${formatted} adicionado como não esperado`);
  };

  const handleRemoveUnexpected = async (item) => {
    if (!(await confirm(`Remover o container ${item.container_number} desta auditoria?`))) return;
    setSavingContainer(item.container_number);
    try {
      const response = await api.deleteContainerAuditItem(id, item.container_number);
      mergeAudit(response.data);
      toast.success('Container removido');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao remover container');
    } finally {
      setSavingContainer(null);
    }
  };

  const handlePhotoClick = (containerNumber) => {
    photoTargetRef.current = containerNumber;
    photoInputRef.current?.click();
  };

  const uploadPhoto = async (containerNumber, file) => {
    const compressed = await compressImage(file);
    await api.uploadContainerAuditPhoto(id, containerNumber, compressed);
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const containerNumber = photoTargetRef.current;
    if (!file || !containerNumber) return;
    setSavingContainer(containerNumber);
    try {
      await uploadPhoto(containerNumber, file);
      await loadAudit();
      toast.success('Foto anexada');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao enviar foto');
    } finally {
      setSavingContainer(null);
    }
  };

  const handleRemovePhoto = async (item) => {
    if (!(await confirm(`Remover a foto do container ${item.container_number}?`))) return;
    setSavingContainer(item.container_number);
    try {
      const response = await api.deleteContainerAuditPhoto(id, item.container_number);
      mergeAudit(response.data);
      toast.success('Foto removida');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao remover foto');
    } finally {
      setSavingContainer(null);
    }
  };

  // ===== Leitura do container pela foto =====
  const handleScanChange = async (e) => {
    const original = e.target.files?.[0];
    e.target.value = '';
    if (!original) return;
    setScanning(true);
    const file = await compressImage(original);
    const previewUrl = URL.createObjectURL(file);
    try {
      const response = await api.scanContainerAuditPhoto(id, file);
      const reading = response.data;
      setScan({
        file, previewUrl, reading,
        number: reading.container_number || '',
        sizeType: reading.size_type || '',
        error: reading.found ? null : 'Não foi possível identificar o número na foto. Digite o número do container.',
      });
    } catch (error) {
      // Mesmo sem leitura a foto serve: o auditor digita o número
      setScan({
        file, previewUrl, reading: null, number: '', sizeType: '',
        error: `${error.response?.data?.detail || 'Não foi possível ler a foto'}. Digite o número do container.`,
      });
    } finally {
      setScanning(false);
    }
  };

  const scanNumber = formatContainerNumber(scan?.number);
  const scanValid = /^[A-Z]{4}\d{6}-\d$/.test(scanNumber);
  const scanMatch = scanValid ? (audit?.items || []).find(i => sameContainer(i.container_number, scanNumber)) : null;
  // O dígito pintado só vale para o número como foi lido; se o auditor corrigiu, não se aplica
  const scanDigitWarning = scan?.reading?.check_digit_ok === false && sameContainer(scan.reading.container_number, scanNumber);

  const handleScanConfirm = async () => {
    if (!scanValid) {
      toast.error('Informe o número completo do container (4 letras e 6 números)');
      return;
    }
    setScanSaving(true);
    try {
      let target = scanMatch?.container_number || scanNumber;
      if (scanMatch?.expected) {
        if (!(await updateItem(target, 'CONFIRMADO', { sizeType: scan.sizeType }))) return;
      } else if (!scanMatch) {
        const updated = await updateItem(scanNumber, 'NAO_ESPERADO', { observations: '', sizeType: scan.sizeType });
        if (!updated) return;
        target = (updated.items || []).find(i => sameContainer(i.container_number, scanNumber))?.container_number || scanNumber;
      }
      await api.uploadContainerAuditPhoto(id, target, scan.file);
      await loadAudit();
      toast.success(
        scanMatch?.expected ? `Container ${target} confirmado com foto`
          : scanMatch ? `Foto do container ${target} atualizada`
            : `Container ${target} adicionado como não esperado, com foto`
      );
      setScan(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar a foto');
    } finally {
      setScanSaving(false);
    }
  };

  const downloadPdf = async () => {
    try {
      const response = await api.downloadContainerAuditPdf(id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Auditoria_${audit.audit_code}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    }
  };

  const handleComplete = async () => {
    const pendentes = (audit.items || []).filter(i => i.status === 'PENDENTE').length;
    const msg = pendentes > 0
      ? `${pendentes} container(s) ainda não foram confirmados e serão marcados como Faltante. Concluir mesmo assim?`
      : 'Concluir esta auditoria? Não será mais possível editá-la depois.';
    if (!(await confirm(msg))) return;
    setCompleting(true);
    try {
      const response = await api.completeContainerAudit(id);
      applyAudit(response.data);
      toast.success('Auditoria concluída');
      await downloadPdf();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao concluir auditoria');
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <PageSkeleton />
      </Layout>
    );
  }

  if (!audit) {
    return (
      <Layout>
        <div className="text-center py-12 text-sm text-slate-500 dark:text-slate-400">Auditoria não encontrada</div>
      </Layout>
    );
  }

  const items = audit.items || [];
  const expectedItems = items.filter(i => i.expected);
  const unexpectedItems = items.filter(i => !i.expected);
  const checkedCount = expectedItems.filter(i => i.status !== 'PENDENTE').length;
  const query = searchKey(search);
  const matchesSearch = (i) => !query || searchKey(i.container_number).includes(query) || searchKey(i.booking).includes(query);
  const visibleExpected = expectedItems.filter(matchesSearch);
  const visibleUnexpected = unexpectedItems.filter(matchesSearch);

  const observationInput = (item, className = '') => (
    <Input
      value={obsDrafts[item.container_number] ?? ''}
      onChange={(e) => setObsDrafts(prev => ({ ...prev, [item.container_number]: e.target.value }))}
      onBlur={(e) => saveObservation(item, e.target.value)}
      placeholder="Observação"
      className={`h-7 text-xs ${className}`}
    />
  );

  // Número + (no celular) tamanho, booking e observação embaixo, já que as colunas ficam ocultas
  const containerCell = (item) => (
    <td>
      <div className="text-sm font-mono text-slate-800 dark:text-slate-200">{item.container_number}</div>
      <div className="md:hidden space-y-1">
        {(item.size_type || item.booking) && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {[item.size_type, item.booking && `Booking ${item.booking}`].filter(Boolean).join(' · ')}
          </div>
        )}
        {isLocked
          ? item.observations && <div className="text-[11px] text-slate-500 dark:text-slate-400">{item.observations}</div>
          : observationInput(item, 'mt-1 min-w-[160px]')}
      </div>
    </td>
  );

  const observationCell = (item) => (
    <td className="hidden md:table-cell">
      {isLocked ? (
        <span className="text-sm text-slate-500 dark:text-slate-400">{item.observations || '-'}</span>
      ) : observationInput(item)}
    </td>
  );

  const photoCell = (item) => {
    const busy = savingContainer === item.container_number;
    return (
      <td>
        <div className="flex items-center gap-1">
          {item.photo ? (
            <a href={api.getFileUrl(item.photo.url)} target="_blank" rel="noreferrer">
              <img src={api.getFileUrl(item.photo.url)} alt={item.container_number} className="w-10 h-10 object-cover rounded border border-slate-200 dark:border-slate-700" />
            </a>
          ) : isLocked && (
            <span className="text-xs text-slate-400 dark:text-slate-500">-</span>
          )}
          {!isLocked && (
            <Button title={item.photo ? 'Tirar outra foto' : 'Tirar foto'} aria-label={item.photo ? 'Tirar outra foto' : 'Tirar foto'} variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handlePhotoClick(item.container_number)} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <Camera className="w-4 h-4 text-slate-400" />}
            </Button>
          )}
          {!isLocked && item.photo && (
            <Button title="Remover foto" aria-label="Remover foto" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleRemovePhoto(item)} disabled={busy}>
              <Trash2 className="w-4 h-4 text-slate-400" />
            </Button>
          )}
        </div>
      </td>
    );
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="container-audit-detail-page">
        <PageHeader
          icon={ListChecks}
          title={<span className="font-mono">{audit.audit_code}</span>}
          subtitle={<>{audit.client_name} · {format(new Date(audit.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</>}
          meta={(
            <StatusPill tone={audit.status === 'CONCLUIDA' ? 'emerald' : 'amber'}>
              {audit.status === 'CONCLUIDA' ? 'Concluída' : 'Em Andamento'}
            </StatusPill>
          )}
          backTo="/container-audits"
          actions={isLocked ? (
            <Button variant="outline" onClick={downloadPdf} data-testid="download-audit-pdf-btn">
              <Download className="w-4 h-4 mr-2" />
              Baixar PDF novamente
            </Button>
          ) : (
            <Button onClick={handleComplete} disabled={completing} data-testid="complete-audit-btn">
              {completing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              Concluir auditoria
            </Button>
          )}
        />

        <StatGrid>
          <StatCard label="Conferidos" value={`${checkedCount} de ${expectedItems.length}`} icon={ClipboardCheck} tone="blue" hint="esperados já marcados" testId="audit-progress" />
          <StatCard label="Confirmados" value={expectedItems.filter(i => i.status === 'CONFIRMADO').length} icon={CheckCircle2} tone="emerald" hint="encontrados no pátio" />
          <StatCard label="Faltantes" value={expectedItems.filter(i => i.status === 'FALTANTE').length} icon={XCircle} tone="red" hint="não encontrados" />
          <StatCard label="Não esperados" value={unexpectedItems.length} icon={AlertTriangle} tone="amber" hint="fora da lista" />
        </StatGrid>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          {!isLocked && (
            <Button onClick={() => scanInputRef.current?.click()} disabled={scanning} className="sm:w-auto" data-testid="scan-container-btn">
              {scanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanLine className="w-4 h-4 mr-2" />}
              {scanning ? 'Lendo a foto...' : 'Ler container pela foto'}
            </Button>
          )}
          <div className="sm:w-72">
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar container ou booking" data-testid="audit-item-search" />
          </div>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <ListChecks className="w-4 h-4" />
              Containers Esperados ({query ? `${visibleExpected.length} de ${expectedItems.length}` : expectedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Container</th>
                    <th className="hidden md:table-cell">Tamanho</th>
                    <th className="hidden md:table-cell">Booking</th>
                    <th>Situação</th>
                    <th className="hidden md:table-cell">Observações</th>
                    <th>Foto</th>
                    {!isLocked && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleExpected.map((item, idx) => (
                    <tr key={item.container_number} className={idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}>
                      {containerCell(item)}
                      <td className="hidden md:table-cell text-sm text-slate-500 dark:text-slate-400">{item.size_type || '-'}</td>
                      <td className="hidden md:table-cell text-sm text-slate-500 dark:text-slate-400">{item.booking || '-'}</td>
                      <td>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_STYLES[item.status] || STATUS_STYLES.PENDENTE}`}>
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                      </td>
                      {observationCell(item)}
                      {photoCell(item)}
                      {!isLocked && (
                        <td>
                          <div className="flex items-center gap-1">
                            <Button aria-label="Confirmar"
                              variant="ghost" size="sm" className="h-8 w-8 p-0"
                              title="Confirmar"
                              disabled={savingContainer === item.container_number}
                              onClick={() => updateItem(item.container_number, 'CONFIRMADO')}
                            >
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            </Button>
                            <Button aria-label="Marcar Faltante"
                              variant="ghost" size="sm" className="h-8 w-8 p-0"
                              title="Marcar Faltante"
                              disabled={savingContainer === item.container_number}
                              onClick={() => updateItem(item.container_number, 'FALTANTE')}
                            >
                              <XCircle className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {visibleExpected.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">
                        {expectedItems.length === 0 ? 'Nenhum container em estoque para este cliente no momento' : 'Nenhum container esperado bate com a busca'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Containers Não Esperados Encontrados ({query ? `${visibleUnexpected.length} de ${unexpectedItems.length}` : unexpectedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {!isLocked && (
              <div className="flex items-end gap-2 max-w-md">
                <div className="flex-1">
                  <Label htmlFor="new-container" className="mb-1.5 block">Nº Container encontrado no pátio</Label>
                  <Input
                    id="new-container"
                    value={newContainer}
                    onChange={(e) => setNewContainer(e.target.value)}
                    onBlur={(e) => setNewContainer(formatContainerNumber(e.target.value))}
                    className="font-mono uppercase"
                    data-testid="new-unexpected-container-input"
                  />
                </div>
                <Button variant="outline" onClick={handleAddUnexpected} data-testid="add-unexpected-container-btn">
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Adicionar
                </Button>
              </div>
            )}

            {visibleUnexpected.length > 0 && (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Container</th>
                      <th className="hidden md:table-cell">Tamanho</th>
                      <th className="hidden md:table-cell">Observações</th>
                      <th>Foto</th>
                      {!isLocked && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUnexpected.map((item, idx) => (
                      <tr key={item.container_number} className={idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}>
                        {containerCell(item)}
                        <td className="hidden md:table-cell text-sm text-slate-500 dark:text-slate-400">{item.size_type || '-'}</td>
                        {observationCell(item)}
                        {photoCell(item)}
                        {!isLocked && (
                          <td>
                            <Button aria-label="Remover container" title="Remover container (lançado por engano)"
                              variant="ghost" size="sm" className="h-8 w-8 p-0"
                              disabled={savingContainer === item.container_number}
                              onClick={() => handleRemoveUnexpected(item)}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* capture="environment": no celular abre direto a câmera traseira */}
      <input type="file" accept="image/*" capture="environment" className="hidden" ref={photoInputRef} onChange={handlePhotoChange} />
      <input type="file" accept="image/*" capture="environment" className="hidden" ref={scanInputRef} onChange={handleScanChange} data-testid="scan-container-input" />

      <Dialog open={!!scan} onOpenChange={(open) => { if (!open && !scanSaving) setScan(null); }}>
        <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto" data-testid="scan-container-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ScanLine className="w-5 h-5 text-primary" />
              Conferir leitura da foto
            </DialogTitle>
          </DialogHeader>
          {scan && (
            <div className="space-y-3">
              <img src={scan.previewUrl} alt="Foto do container" className="w-full max-h-64 object-contain rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              {scan.error && (
                <p className="text-[13px] text-amber-700 dark:text-amber-300">{scan.error}</p>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label htmlFor="scan-number" className="mb-1.5 block">Nº do container</Label>
                  <Input
                    id="scan-number"
                    value={scan.number}
                    onChange={(e) => setScan(prev => ({ ...prev, number: e.target.value }))}
                    onBlur={(e) => setScan(prev => ({ ...prev, number: formatContainerNumber(e.target.value) }))}
                    className="font-mono uppercase"
                    data-testid="scan-container-number"
                  />
                </div>
                <div>
                  <Label htmlFor="scan-size" className="mb-1.5 block">Tamanho</Label>
                  <Input
                    id="scan-size"
                    list="scan-size-options"
                    value={scan.sizeType}
                    onChange={(e) => setScan(prev => ({ ...prev, sizeType: e.target.value.toUpperCase() }))}
                    className="uppercase"
                    data-testid="scan-container-size"
                  />
                  <datalist id="scan-size-options">
                    {SIZE_TYPE_OPTIONS.map(v => <option key={v} value={v} />)}
                  </datalist>
                </div>
              </div>
              {scan.reading?.size_type_code && (
                <p className="text-[12px] text-slate-500 dark:text-slate-400">Código ISO lido: <span className="font-mono">{scan.reading.size_type_code}</span></p>
              )}
              {scanDigitWarning && (
                <p className="flex items-start gap-1.5 text-[13px] text-red-700 dark:text-red-300" data-testid="scan-digit-warning">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  O dígito verificador pintado ({scan.reading.read_check_digit}) não bate com o calculado. Confira as letras e números com o container.
                </p>
              )}
              {scanValid && (
                <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300" data-testid="scan-match-info">
                  {scanMatch?.expected
                    ? (scanMatch.status === 'CONFIRMADO' ? 'Já confirmado na lista de esperados: a foto será atualizada.' : 'Está na lista de esperados: será marcado como Confirmado, com a foto.')
                    : scanMatch ? 'Já lançado como não esperado: a foto será atualizada.'
                      : 'Não está na lista de esperados: será adicionado como Não Esperado, com a foto.'}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setScan(null)} disabled={scanSaving}>Cancelar</Button>
            <Button onClick={handleScanConfirm} disabled={scanSaving || !scanValid} data-testid="scan-confirm-btn">
              {scanSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              {scanMatch?.expected ? 'Confirmar' : scanMatch ? 'Salvar foto' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
