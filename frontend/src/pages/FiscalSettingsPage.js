import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { PageSkeleton, StatusPill } from '../components/DataPage';
import PageHeader from '../components/PageHeader';
import { FormSection, Field, FormActions } from '../components/FormKit';
import { AddressFields } from '../components/AddressFields';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import {
  AMBIENTE_OPTIONS, CFOP_OPTIONS, CRT_OPTIONS, ICMS_CST_OPTIONS, ICMS_WITH_RATE,
  formatCnpjCpf, fromAddressFields, toAddressFields,
} from '../lib/fiscal';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Building2, FileCog, KeyRound, Loader2, RefreshCw, Save, Send, ShieldCheck, Truck } from 'lucide-react';

const EMPTY_FORM = {
  ambiente: 'homologacao', cnpj: '', ie: '', razao_social: '', nome_fantasia: '', email: '', fone: '',
  endereco: {}, crt: '3', rntrc: '', cte_serie: '1', cte_proximo_numero: '', cfop_padrao: '5353',
  natureza_operacao: '', icms_cst: '00', icms_aliquota: '', produto_predominante: '',
};

const fmtDate = (value) => (value ? format(new Date(value), 'dd/MM/yyyy') : '-');

export default function FiscalSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [checkingSefaz, setCheckingSefaz] = useState(false);
  const [info, setInfo] = useState({});
  const [form, setForm] = useState(EMPTY_FORM);
  const [nextNumber, setNextNumber] = useState(1);
  const [certFile, setCertFile] = useState(null);
  const [certPassword, setCertPassword] = useState('');

  useEffect(() => { load(); }, []);

  const applySettings = (data) => {
    setInfo(data);
    setNextNumber(data.cte_proximo_numero || 1);
    setForm({
      ambiente: data.ambiente || 'homologacao',
      cnpj: data.cnpj ? formatCnpjCpf(data.cnpj) : '',
      ie: data.ie || '',
      razao_social: data.razao_social || '',
      nome_fantasia: data.nome_fantasia || '',
      email: data.email || '',
      fone: data.fone || '',
      endereco: data.endereco || {},
      crt: String(data.crt || 3),
      rntrc: data.rntrc || '',
      cte_serie: String(data.cte_serie ?? 1),
      cte_proximo_numero: String(data.cte_proximo_numero || 1),
      cfop_padrao: data.cfop_padrao || '5353',
      natureza_operacao: data.natureza_operacao || '',
      icms_cst: data.icms_cst || '00',
      icms_aliquota: data.icms_aliquota ?? '',
      produto_predominante: data.produto_predominante || '',
    });
  };

  const load = async () => {
    try {
      const r = await api.getFiscalSettings();
      const data = r.data || {};
      // Primeira vez: aproveita o que já está em "Dados da Empresa"
      if (!data.cnpj) {
        try {
          const company = (await api.getCompanySettings()).data || {};
          data.cnpj = company.cnpj || '';
          data.razao_social = data.razao_social || company.name || '';
          data.email = data.email || (company.email || '').split(/[;,]/)[0].trim();
          data.fone = data.fone || company.phone || '';
        } catch (e) { /* segue sem os dados da empresa */ }
      }
      applySettings(data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao carregar a Configuração Fiscal');
    } finally {
      setLoading(false);
    }
  };

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const buildPayload = () => {
    const payload = {
      ambiente: form.ambiente,
      cnpj: form.cnpj,
      ie: form.ie.trim(),
      razao_social: form.razao_social.trim(),
      nome_fantasia: form.nome_fantasia.trim() || null,
      email: form.email.trim(),
      fone: form.fone.trim() || null,
      endereco: form.endereco,
      crt: Number(form.crt),
      rntrc: form.rntrc.trim(),
      cte_serie: Number(form.cte_serie || 0),
      cfop_padrao: form.cfop_padrao,
      natureza_operacao: form.natureza_operacao.trim() || null,
      icms_cst: form.icms_cst,
      icms_aliquota: form.icms_aliquota === '' ? null : Number(String(form.icms_aliquota).replace(',', '.')),
      produto_predominante: form.produto_predominante.trim() || null,
    };
    // Só manda o próximo número quando ele foi alterado na tela
    if (Number(form.cte_proximo_numero) !== Number(nextNumber)) {
      payload.cte_proximo_numero = Number(form.cte_proximo_numero);
    }
    return payload;
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (saving) return false;
    setSaving(true);
    try {
      const r = await api.updateFiscalSettings(buildPayload());
      applySettings(r.data);
      toast.success('Configuração Fiscal salva');
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar a Configuração Fiscal');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!(await handleSave())) return;
    setSyncing(true);
    try {
      const r = await api.syncFiscalCompany();
      applySettings(r.data);
      toast.success('Cadastro da empresa enviado ao emissor');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao enviar o cadastro ao emissor');
    } finally {
      setSyncing(false);
    }
  };

  const handleCertificate = async () => {
    if (!certFile || !certPassword) {
      toast.error('Escolha o arquivo do certificado A1 e informe a senha');
      return;
    }
    setUploading(true);
    try {
      const r = await api.uploadFiscalCertificate(certFile, certPassword);
      applySettings(r.data);
      setCertFile(null);
      setCertPassword('');
      toast.success('Certificado enviado ao emissor');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao enviar o certificado');
    } finally {
      setUploading(false);
    }
  };

  const handleSefazStatus = async () => {
    setCheckingSefaz(true);
    try {
      const r = await api.getFiscalSefazStatus();
      const d = r.data || {};
      const message = `${d.autorizador ? `${d.autorizador}: ` : ''}${d.codigo_status || ''} ${d.motivo_status || ''}`.trim();
      if (Number(d.codigo_status) === 107) toast.success(message || 'Serviço em operação');
      else toast.warning(message || 'Situação desconhecida');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao consultar a Sefaz');
    } finally {
      setCheckingSefaz(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <PageSkeleton testId="fiscal-settings-loading" />
      </Layout>
    );
  }

  const certificate = info.certificate;
  const certExpired = certificate?.not_valid_after && new Date(certificate.not_valid_after) < new Date();

  return (
    <Layout>
      <form onSubmit={handleSave} className="space-y-4" data-testid="fiscal-settings-page">
        <PageHeader
          icon={FileCog}
          title="Configuração Fiscal"
          subtitle="Emitente, certificado A1 e padrões do CT-e emitido pela Nuvem Fiscal"
          backTo="/fiscal/cte"
        />

        <FormSection title="Situação" icon={ShieldCheck}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500 mb-1">Emissor no servidor</p>
              {info.provider_configured
                ? <StatusPill tone="emerald">Configurado</StatusPill>
                : <StatusPill tone="red" title="Faltam NUVEMFISCAL_CLIENT_ID / NUVEMFISCAL_CLIENT_SECRET no servidor">Não configurado</StatusPill>}
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Cadastro da empresa no emissor</p>
              {info.provider_synced_at
                ? <StatusPill tone="emerald">Enviado em {fmtDate(info.provider_synced_at)}</StatusPill>
                : <StatusPill tone="amber">Não enviado</StatusPill>}
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Certificado A1</p>
              {certificate
                ? <StatusPill tone={certExpired ? 'red' : 'emerald'}>{certExpired ? 'Vencido em' : 'Válido até'} {fmtDate(certificate.not_valid_after)}</StatusPill>
                : <StatusPill tone="amber">Não enviado</StatusPill>}
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Ambiente</p>
              <StatusPill tone={info.ambiente === 'producao' ? 'violet' : 'blue'}>
                {info.ambiente === 'producao' ? 'Produção' : 'Homologação'}
              </StatusPill>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleSync} disabled={syncing || saving} data-testid="fiscal-sync-btn">
              {syncing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
              Salvar e enviar cadastro ao emissor
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleSefazStatus} disabled={checkingSefaz || !info.provider_synced_at} data-testid="fiscal-sefaz-btn">
              {checkingSefaz ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
              Consultar Sefaz
            </Button>
          </div>
        </FormSection>

        <FormSection title="Emitente" icon={Building2}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label="CNPJ" required>
              <Input value={form.cnpj} onChange={(e) => set('cnpj', formatCnpjCpf(e.target.value))} className="font-mono" data-testid="fiscal-cnpj" />
            </Field>
            <Field label="Inscrição Estadual" required>
              <Input value={form.ie} onChange={(e) => set('ie', e.target.value)} data-testid="fiscal-ie" />
            </Field>
            <Field label="RNTRC (ANTT)" required hint="8 dígitos">
              <Input value={form.rntrc} onChange={(e) => set('rntrc', e.target.value.replace(/\D/g, '').slice(0, 8))} className="font-mono" data-testid="fiscal-rntrc" />
            </Field>
            <Field label="Regime Tributário (CRT)" required>
              <Select value={form.crt} onValueChange={(v) => set('crt', v)}>
                <SelectTrigger data-testid="fiscal-crt"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CRT_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Razão Social" required className="md:col-span-2">
              <Input value={form.razao_social} onChange={(e) => set('razao_social', e.target.value)} data-testid="fiscal-razao" />
            </Field>
            <Field label="Nome Fantasia" className="md:col-span-2">
              <Input value={form.nome_fantasia} onChange={(e) => set('nome_fantasia', e.target.value)} />
            </Field>
            <Field label="E-mail" required className="md:col-span-2">
              <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} data-testid="fiscal-email" />
            </Field>
            <Field label="Telefone">
              <Input value={form.fone} onChange={(e) => set('fone', e.target.value)} />
            </Field>
          </div>
          <AddressFields
            value={toAddressFields(form.endereco)}
            onChange={(v) => set('endereco', fromAddressFields(v, form.endereco))}
          />
        </FormSection>

        <FormSection title="CT-e" icon={Truck}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label="Ambiente" required className="md:col-span-2" hint="Comece em Homologação: o CT-e sai sem valor fiscal, só para teste">
              <Select value={form.ambiente} onValueChange={(v) => set('ambiente', v)}>
                <SelectTrigger data-testid="fiscal-ambiente"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AMBIENTE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Série">
              <Input inputMode="numeric" value={form.cte_serie} onChange={(e) => set('cte_serie', e.target.value.replace(/\D/g, '').slice(0, 3))} />
            </Field>
            <Field label="Próximo número" hint="Para continuar a numeração de outro emissor">
              <Input inputMode="numeric" value={form.cte_proximo_numero} onChange={(e) => set('cte_proximo_numero', e.target.value.replace(/\D/g, '').slice(0, 9))} data-testid="fiscal-next-number" />
            </Field>
            <Field label="CFOP padrão" className="md:col-span-2">
              <Select value={form.cfop_padrao} onValueChange={(v) => set('cfop_padrao', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CFOP_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Natureza da Operação" className="md:col-span-2">
              <Input value={form.natureza_operacao} onChange={(e) => set('natureza_operacao', e.target.value.toUpperCase())} maxLength={60} />
            </Field>
            <Field label="ICMS (CST) padrão" className="md:col-span-2">
              <Select value={form.icms_cst} onValueChange={(v) => set('icms_cst', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ICMS_CST_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Alíquota ICMS (%)">
              <Input inputMode="decimal" value={form.icms_aliquota} disabled={!ICMS_WITH_RATE.includes(form.icms_cst)}
                onChange={(e) => set('icms_aliquota', e.target.value.replace(/[^\d,.]/g, ''))} />
            </Field>
            <Field label="Produto predominante">
              <Input value={form.produto_predominante} onChange={(e) => set('produto_predominante', e.target.value.toUpperCase())} maxLength={60} />
            </Field>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            CFOP, CST e alíquota dependem da operação e do estado: confirme com o contador antes de passar para Produção.
          </p>
        </FormSection>

        <FormSection title="Certificado digital A1" icon={KeyRound}>
          {certificate && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {certificate.subject_name} · emitido por {certificate.issuer_name || '-'} · válido de {fmtDate(certificate.not_valid_before)} até {fmtDate(certificate.not_valid_after)}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <Field label="Arquivo (.pfx ou .p12)" className="md:col-span-2">
              <Input type="file" accept=".pfx,.p12" onChange={(e) => setCertFile(e.target.files?.[0] || null)} data-testid="fiscal-cert-file" />
            </Field>
            <Field label="Senha do certificado">
              <Input type="password" autoComplete="new-password" value={certPassword} onChange={(e) => setCertPassword(e.target.value)} data-testid="fiscal-cert-password" />
            </Field>
            <Button type="button" variant="outline" onClick={handleCertificate} disabled={uploading || !info.provider_synced_at} data-testid="fiscal-cert-btn">
              {uploading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1.5" />}
              Enviar certificado
            </Button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            O certificado e a senha vão direto para a Nuvem Fiscal e não ficam guardados no sistema. Envie o cadastro da empresa antes.
          </p>
        </FormSection>

        <FormActions sticky>
          <Button type="submit" disabled={saving} data-testid="fiscal-save-btn">
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
            Salvar
          </Button>
        </FormActions>
      </form>
    </Layout>
  );
}
