import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { formatContainerNumber } from '../lib/containerNumber';
import {
  ArrowLeft, CheckCircle2, XCircle, Camera, PlusCircle, Download, Loader2, ListChecks,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_STYLES = {
  PENDENTE: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  CONFIRMADO: 'bg-green-100 text-green-800',
  FALTANTE: 'bg-red-100 text-red-800',
  NAO_ESPERADO: 'bg-yellow-100 text-yellow-800',
};
const STATUS_LABELS = {
  PENDENTE: 'Pendente',
  CONFIRMADO: 'Confirmado',
  FALTANTE: 'Faltante',
  NAO_ESPERADO: 'Não Esperado',
};

export default function ContainerAuditDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingContainer, setSavingContainer] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [newContainer, setNewContainer] = useState('');
  const [obsDrafts, setObsDrafts] = useState({});
  const fileInputRefs = useRef({});

  useEffect(() => {
    loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadAudit = async () => {
    try {
      const response = await api.getContainerAudit(id);
      setAudit(response.data);
      const drafts = {};
      (response.data.items || []).forEach(i => { drafts[i.container_number] = i.observations || ''; });
      setObsDrafts(drafts);
    } catch (error) {
      toast.error('Erro ao carregar auditoria');
    } finally {
      setLoading(false);
    }
  };

  const isLocked = audit?.status === 'CONCLUIDA';

  const updateItem = async (containerNumber, status, observations) => {
    setSavingContainer(containerNumber);
    try {
      const response = await api.updateContainerAuditItem(id, {
        container_number: containerNumber,
        status,
        observations: observations !== undefined ? observations : (obsDrafts[containerNumber] || ''),
      });
      setAudit(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar container');
    } finally {
      setSavingContainer(null);
    }
  };

  const handleAddUnexpected = async () => {
    const formatted = formatContainerNumber(newContainer);
    if (!formatted) {
      toast.error('Informe o número do container');
      return;
    }
    await updateItem(formatted, 'NAO_ESPERADO', '');
    setNewContainer('');
    toast.success(`Container ${formatted} adicionado como não esperado`);
  };

  const handlePhotoClick = (containerNumber) => {
    fileInputRefs.current[containerNumber]?.click();
  };

  const handlePhotoChange = async (containerNumber, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSavingContainer(containerNumber);
    try {
      await api.uploadContainerAuditPhoto(id, containerNumber, file);
      await loadAudit();
      toast.success('Foto anexada');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao enviar foto');
    } finally {
      setSavingContainer(null);
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
      setAudit(response.data);
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
        <div className="text-center py-12 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
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

  const expectedItems = (audit.items || []).filter(i => i.expected);
  const unexpectedItems = (audit.items || []).filter(i => !i.expected);

  return (
    <Layout>
      <div className="space-y-5" data-testid="container-audit-detail-page">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate('/container-audits')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 font-mono">{audit.audit_code}</h1>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
                {audit.client_name} · {format(new Date(audit.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
              </p>
            </div>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${audit.status === 'CONCLUIDA' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {audit.status === 'CONCLUIDA' ? 'Concluída' : 'Em Andamento'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isLocked && (
              <Button variant="outline" size="sm" onClick={downloadPdf} data-testid="download-audit-pdf-btn">
                <Download className="w-4 h-4 mr-2" />
                Baixar PDF novamente
              </Button>
            )}
            {!isLocked && (
              <Button size="sm" onClick={handleComplete} disabled={completing} data-testid="complete-audit-btn">
                {completing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Concluir Auditoria
              </Button>
            )}
          </div>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <ListChecks className="w-4 h-4" />
              Containers Esperados ({expectedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Container</th>
                    <th className="hidden sm:table-cell px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tamanho</th>
                    <th className="hidden sm:table-cell px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Booking</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Situação</th>
                    <th className="hidden md:table-cell px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Observações</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Foto</th>
                    {!isLocked && <th className="px-4 py-2.5"></th>}
                  </tr>
                </thead>
                <tbody>
                  {expectedItems.map((item, idx) => (
                    <tr key={item.container_number} className={idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}>
                      <td className="px-4 py-2.5 text-sm font-mono text-slate-800 dark:text-slate-200">{item.container_number}</td>
                      <td className="hidden sm:table-cell px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">{item.size_type || '-'}</td>
                      <td className="hidden sm:table-cell px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">{item.booking || '-'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_STYLES[item.status] || STATUS_STYLES.PENDENTE}`}>
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                      </td>
                      <td className="hidden md:table-cell px-4 py-2.5">
                        {isLocked ? (
                          <span className="text-sm text-slate-500 dark:text-slate-400">{item.observations || '-'}</span>
                        ) : (
                          <Input
                            value={obsDrafts[item.container_number] ?? ''}
                            onChange={(e) => setObsDrafts(prev => ({ ...prev, [item.container_number]: e.target.value }))}
                            onBlur={(e) => updateItem(item.container_number, item.status, e.target.value)}
                            className="h-7 text-xs"
                          />
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {item.photo ? (
                          <a href={item.photo.url} target="_blank" rel="noreferrer">
                            <img src={item.photo.url} alt={item.container_number} className="w-10 h-10 object-cover rounded border border-slate-200 dark:border-slate-700" />
                          </a>
                        ) : !isLocked ? (
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handlePhotoClick(item.container_number)} disabled={savingContainer === item.container_number}>
                            <Camera className="w-4 h-4 text-slate-400" />
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">-</span>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          ref={(el) => { fileInputRefs.current[item.container_number] = el; }}
                          onChange={(e) => handlePhotoChange(item.container_number, e)}
                        />
                      </td>
                      {!isLocked && (
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost" size="sm" className="h-8 w-8 p-0"
                              title="Confirmar"
                              disabled={savingContainer === item.container_number}
                              onClick={() => updateItem(item.container_number, 'CONFIRMADO')}
                            >
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            </Button>
                            <Button
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
                  {expectedItems.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">
                        Nenhum container em estoque para este cliente no momento
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
              Containers Não Esperados Encontrados ({unexpectedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {!isLocked && (
              <div className="flex items-end gap-2 max-w-md">
                <div className="flex-1">
                  <Label htmlFor="new-container">Nº Container encontrado no pátio</Label>
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

            {unexpectedItems.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Container</th>
                      <th className="hidden md:table-cell px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Observações</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Foto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unexpectedItems.map((item, idx) => (
                      <tr key={item.container_number} className={idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}>
                        <td className="px-4 py-2.5 text-sm font-mono text-slate-800 dark:text-slate-200">{item.container_number}</td>
                        <td className="hidden md:table-cell px-4 py-2.5">
                          {isLocked ? (
                            <span className="text-sm text-slate-500 dark:text-slate-400">{item.observations || '-'}</span>
                          ) : (
                            <Input
                              value={obsDrafts[item.container_number] ?? ''}
                              onChange={(e) => setObsDrafts(prev => ({ ...prev, [item.container_number]: e.target.value }))}
                              onBlur={(e) => updateItem(item.container_number, item.status, e.target.value)}
                              className="h-7 text-xs"
                            />
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {item.photo ? (
                            <a href={item.photo.url} target="_blank" rel="noreferrer">
                              <img src={item.photo.url} alt={item.container_number} className="w-10 h-10 object-cover rounded border border-slate-200 dark:border-slate-700" />
                            </a>
                          ) : !isLocked ? (
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handlePhotoClick(item.container_number)} disabled={savingContainer === item.container_number}>
                              <Camera className="w-4 h-4 text-slate-400" />
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500">-</span>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            ref={(el) => { fileInputRefs.current[item.container_number] = el; }}
                            onChange={(e) => handlePhotoChange(item.container_number, e)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
