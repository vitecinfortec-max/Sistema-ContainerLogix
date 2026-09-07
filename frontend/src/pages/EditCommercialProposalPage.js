import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Save, Plus, Trash2, Loader2, Download } from 'lucide-react';

export default function EditCommercialProposalPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [clients, setClients] = useState([]);
  const [proposalNumber, setProposalNumber] = useState('');

  const [recipientName, setRecipientName] = useState('');
  const [subject, setSubject] = useState('');
  const [validityDays, setValidityDays] = useState('7');
  const [items, setItems] = useState([{ description: '', value: '' }]);
  const [freeTimeText, setFreeTimeText] = useState('');
  const [paymentTermsText, setPaymentTermsText] = useState('');

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadData = async () => {
    try {
      const [proposalRes, clientsRes] = await Promise.all([api.getCommercialProposal(id), api.getClients()]);
      const p = proposalRes.data;
      setProposalNumber(p.proposal_number);
      setRecipientName(p.recipient_name || '');
      setSubject(p.subject || '');
      setValidityDays(String(p.validity_days ?? 7));
      setItems((p.items && p.items.length > 0) ? p.items.map(i => ({ description: i.description, value: String(i.value) })) : [{ description: '', value: '' }]);
      setFreeTimeText(p.free_time_text || '');
      setPaymentTermsText(p.payment_terms_text || '');
      setClients(Array.isArray(clientsRes.data) ? clientsRes.data : []);
    } catch (error) {
      toast.error('Erro ao carregar proposta comercial');
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => setItems(prev => [...prev, { description: '', value: '' }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx, field, value) => setItems(prev => {
    const next = [...prev];
    next[idx] = { ...next[idx], [field]: value };
    return next;
  });

  const total = items.reduce((sum, i) => sum + (Number(i.value) || 0), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!recipientName.trim()) {
      toast.error('Informe o destinatário da proposta');
      return;
    }
    const validItems = items.filter(i => i.description.trim() && i.value !== '');
    if (validItems.length === 0) {
      toast.error('Adicione ao menos um serviço com valor');
      return;
    }
    setSaving(true);
    try {
      await api.updateCommercialProposal(id, {
        recipient_name: recipientName.trim(),
        subject: subject.trim(),
        validity_days: Number(validityDays) || 7,
        items: validItems.map(i => ({ description: i.description.trim(), value: Number(i.value) })),
        free_time_text: freeTimeText.trim() || null,
        payment_terms_text: paymentTermsText.trim() || null,
      });
      toast.success('Proposta comercial atualizada com sucesso!');
      navigate('/comercial/proposta');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar proposta comercial');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const response = await api.downloadCommercialProposalPdf(id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Proposta_${proposalNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="edit-commercial-proposal-page">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate('/comercial/proposta')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 font-mono">{proposalNumber}</h1>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Editar proposta comercial</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={downloading}>
            <Download className="w-4 h-4 mr-2" />
            Baixar PDF
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Dados Gerais</CardTitle>
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label>Destinatário (cliente ou prospect)</Label>
                <Autocomplete
                  value={recipientName}
                  onChange={setRecipientName}
                  options={clients}
                  displayField="name"
                  onSelect={(c) => setRecipientName(c.name)}
                  className="w-full"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Assunto</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div>
                <Label>Validade (dias)</Label>
                <Input type="number" min="1" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Serviços e Valores</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Item
              </Button>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">Serviço</Label>
                    <Input value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} className="h-9" />
                  </div>
                  <div className="w-40">
                    <Label className="text-xs">Valor (R$)</Label>
                    <Input type="number" step="0.01" min="0" value={item.value} onChange={(e) => updateItem(idx, 'value', e.target.value)} className="h-9" />
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => removeItem(idx)} disabled={items.length === 1}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Total: {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Free Time de Armazenagem</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <Textarea value={freeTimeText} onChange={(e) => setFreeTimeText(e.target.value)} className="min-h-[80px]" />
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Forma de Pagamento</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <Textarea value={paymentTermsText} onChange={(e) => setPaymentTermsText(e.target.value)} className="min-h-[80px]" />
            </CardContent>
          </Card>

          <Button type="submit" disabled={saving} data-testid="submit-proposal-btn">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Salvar Alterações
          </Button>
        </form>
      </div>
    </Layout>
  );
}
