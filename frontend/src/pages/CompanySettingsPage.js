import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { PageSkeleton } from '../components/DataPage';
import PageHeader from '../components/PageHeader';
import LoginNoticesManager from '../components/LoginNoticesManager';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Building2, Upload, X, Save, AlertTriangle, Loader2, Palette } from 'lucide-react';
import { formatCNPJ, formatPhone } from '../lib/masks';
import { applyBrandAccent } from '../lib/brandTheme';
import { apiErrorMessage } from '../lib/errors';

const EMPTY_FORM = {
  name: '',
  cnpj: '',
  slogan: '',
  address: '',
  phone: '',
  email: '',
  bank_name: '',
  bank_agency: '',
  bank_account: '',
  pix_key: '',
  logo_filename: '',
  accent_color: '',
  auto_booking_prefix: '',
  financial_lock_date: ''
};

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [logoPreview, setLogoPreview] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await api.getCompanySettings();
      const data = response.data || {};
      setFormData({ ...EMPTY_FORM, ...data });
      if (data.logo_filename) {
        setLogoPreview(api.getFileUrl(`/api/uploads/${data.logo_filename}`));
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao carregar dados da empresa'));
    } finally {
      setLoading(false);
    }
  };

  const handleCNPJChange = (e) => {
    setFormData({ ...formData, cnpj: formatCNPJ(e.target.value) });
  };

  const handlePhoneChange = (e) => {
    setFormData({ ...formData, phone: formatPhone(e.target.value) });
  };

  const handleLogoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Por favor, selecione uma imagem');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setLogoPreview(previewUrl);
    setUploadingLogo(true);
    try {
      const response = await api.uploadFile(file);
      setFormData(prev => ({ ...prev, logo_filename: response.data.filename }));
      await loadSuggestion(response.data.filename);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao enviar logo'));
    } finally {
      setUploadingLogo(false);
    }
  };

  const loadSuggestion = async (filename) => {
    try {
      const response = await api.getAccentSuggestion(filename);
      setSuggestion(response.data);
    } catch (error) {
      setSuggestion(null);
    }
  };

  const handleRemoveLogo = () => {
    setSuggestion(null);
    setLogoPreview(null);
    setFormData(prev => ({ ...prev, logo_filename: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAdmin || saving) return;

    setSaving(true);
    try {
      const response = await api.updateCompanySettings(formData);
      setFormData(prev => ({ ...prev, accent_color: response.data.accent_color || '' }));
      applyBrandAccent(response.data.accent_color || null);
      toast.success('Dados da empresa salvos com sucesso');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao salvar dados da empresa'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <PageSkeleton testId="company-settings-loading" />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4" data-testid="company-settings-page">
        <PageHeader
          icon={Building2}
          title="Dados da Empresa"
          subtitle="Essas informações e o logo são usados nos PDFs e planilhas gerados pelo sistema"
        />

        {!isAdmin && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-[0.8125rem] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Apenas administradores podem editar os dados da empresa. Você pode visualizar as informações abaixo.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Identificação
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-col sm:flex-row gap-6">
                <div className="shrink-0">
                  <Label className="mb-1.5 block">Logo</Label>
                  <div className="mt-1.5">
                    {logoPreview ? (
                      <div className="relative w-32 h-32">
                        <img
                          src={logoPreview}
                          alt="Logo da empresa"
                          className="w-32 h-32 object-contain rounded-lg border bg-white dark:bg-slate-900"
                        />
                        {isAdmin && (
                          <Button title="Remover" aria-label="Remover"
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute -top-2 -right-2 h-6 w-6"
                            onClick={handleRemoveLogo}
                            data-testid="remove-logo-button"
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="w-32 h-32 border-2 border-dashed rounded-lg flex items-center justify-center bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
                        <Building2 className="w-8 h-8" />
                      </div>
                    )}
                    {isAdmin && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2 text-[0.75rem] h-8"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingLogo}
                          data-testid="upload-logo-button"
                        >
                          {uploadingLogo ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5 mr-1.5" />
                          )}
                          {logoPreview ? 'Trocar logo' : 'Enviar logo'}
                        </Button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleLogoSelect}
                        />
                      </>
                    )}
                  </div>
                </div>

                <div className="flex-1 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="block">Nome / Razão Social</Label>
                    <Input
                      id="name"
                      data-testid="company-name-input"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="slogan" className="block">Slogan / Tagline</Label>
                    <Input
                      id="slogan"
                      data-testid="company-slogan-input"
                      value={formData.slogan}
                      onChange={(e) => setFormData({ ...formData, slogan: e.target.value })}
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cnpj" className="block">CNPJ</Label>
                    <Input
                      id="cnpj"
                      data-testid="company-cnpj-input"
                      value={formData.cnpj}
                      onChange={handleCNPJChange}
                      disabled={!isAdmin}
                      className="font-mono"
                      maxLength={18}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="address" className="block">Endereço</Label>
                    <Textarea
                      id="address"
                      data-testid="company-address-input"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      disabled={!isAdmin}
                      className="text-[0.8125rem] min-h-[4.375rem]"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Palette className="w-4 h-4" />
                Cor de destaque
              </CardTitle>
              <CardDescription>Aparece nas telas e nos títulos dos PDFs, planilhas e e-mails. O restante do layout segue neutro.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="color"
                  aria-label="Cor de destaque"
                  data-testid="accent-color-input"
                  className="h-9 w-14 cursor-pointer rounded border bg-white p-0.5 disabled:cursor-not-allowed dark:bg-slate-900"
                  value={formData.accent_color || '#0F766E'}
                  onChange={(e) => setFormData({ ...formData, accent_color: e.target.value })}
                  disabled={!isAdmin}
                />
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {formData.accent_color ? formData.accent_color.toUpperCase() : 'Cor padrão do sistema'}
                </span>
                {isAdmin && formData.logo_filename && (
                  <Button type="button" variant="outline" size="sm" data-testid="accent-from-logo-button"
                    onClick={() => loadSuggestion(formData.logo_filename)}>
                    Sugerir pela logo
                  </Button>
                )}
                {isAdmin && formData.accent_color && (
                  <Button type="button" variant="ghost" size="sm" data-testid="accent-reset-button"
                    onClick={() => setFormData({ ...formData, accent_color: '' })}>
                    Usar cor padrão
                  </Button>
                )}
              </div>
              {suggestion && (suggestion.color ? (
                <div className="flex flex-wrap items-center gap-3 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800" data-testid="accent-suggestion">
                  <span className="h-6 w-6 rounded border" style={{ backgroundColor: suggestion.color }} />
                  <span className="text-slate-700 dark:text-slate-300">
                    Sugestão da logo: {suggestion.color}
                    {suggestion.adjusted && ' (escurecida para ficar legível)'}
                  </span>
                  <Button type="button" size="sm" data-testid="accent-apply-button"
                    onClick={() => { setFormData({ ...formData, accent_color: suggestion.color }); setSuggestion(null); }}>
                    Aplicar
                  </Button>
                  {suggestion.red_hue && (
                    <p className="flex w-full items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      Tom próximo do vermelho, usado no sistema para erros e cancelamentos.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-400" data-testid="accent-no-suggestion">
                  A logo é neutra (preta, branca ou cinza), então a cor padrão é a mais indicada.
                </p>
              ))}
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Contato</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="block">Telefone</Label>
                  <Input
                    id="phone"
                    data-testid="company-phone-input"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    disabled={!isAdmin}
                    className="font-mono"
                    maxLength={15}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="block">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    data-testid="company-email-input"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    disabled={!isAdmin}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Dados Bancários</CardTitle>
              <CardDescription className="text-[0.75rem]">Exibidos nos relatórios e faturas de faturamento</CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="bank_name" className="block">Banco</Label>
                  <Input
                    id="bank_name"
                    data-testid="company-bank-name-input"
                    value={formData.bank_name}
                    onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bank_agency" className="block">Agência</Label>
                  <Input
                    id="bank_agency"
                    data-testid="company-bank-agency-input"
                    value={formData.bank_agency}
                    onChange={(e) => setFormData({ ...formData, bank_agency: e.target.value })}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bank_account" className="block">Conta Corrente</Label>
                  <Input
                    id="bank_account"
                    data-testid="company-bank-account-input"
                    value={formData.bank_account}
                    onChange={(e) => setFormData({ ...formData, bank_account: e.target.value })}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pix_key" className="block">Chave PIX</Label>
                  <Input
                    id="pix_key"
                    data-testid="company-pix-key-input"
                    value={formData.pix_key}
                    onChange={(e) => setFormData({ ...formData, pix_key: e.target.value })}
                    disabled={!isAdmin}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Ordem de Carregamento</CardTitle>
              <CardDescription className="text-[0.75rem]">Controla o preenchimento automático do Booking/Ref. em ordens do tipo Entrega</CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <div className="max-w-sm space-y-1.5">
                <Label htmlFor="auto_booking_prefix" className="block">Prefixo de Booking Automático (Entrega)</Label>
                <Input
                  id="auto_booking_prefix"
                  data-testid="company-auto-booking-prefix-input"
                  value={formData.auto_booking_prefix}
                  onChange={(e) => setFormData({ ...formData, auto_booking_prefix: e.target.value.toUpperCase() })}
                  disabled={!isAdmin}
                  className="font-mono"
                  maxLength={10}
                />
                <p className="text-[0.75rem] text-slate-500 dark:text-slate-400">
                  Se preenchido (ex: "TLL"), toda Ordem de Carregamento do tipo Entrega passa a gerar o Booking/Ref. sozinha, em sequência (TLL00001, TLL00002...). Deixe em branco para continuar preenchendo manualmente.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Fechamento do Financeiro</CardTitle>
              <CardDescription className="text-[0.75rem]">Trava os lançamentos financeiros de meses já fechados com a contabilidade</CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <div className="max-w-sm space-y-1.5">
                <Label htmlFor="financial_lock_date" className="block">Período fechado até</Label>
                <Input
                  id="financial_lock_date"
                  type="date"
                  data-testid="company-financial-lock-date-input"
                  value={formData.financial_lock_date || ''}
                  onChange={(e) => setFormData({ ...formData, financial_lock_date: e.target.value })}
                  disabled={!isAdmin}
                />
                <p className="text-[0.75rem] text-slate-500 dark:text-slate-400">
                  Faturas, cheques, prestações de contas, pagamentos de frete, diárias, faturamento portuário, invoices internacionais e créditos de cliente com data até este dia não podem mais ser incluídos, alterados nem excluídos, por ninguém. Recebimentos e baixas feitos depois desta data continuam liberados. Para corrigir algo, volte a data, corrija e feche de novo. Deixe em branco para não travar nada.
                </p>
              </div>
            </CardContent>
          </Card>

          {isAdmin && (
            <div className="flex justify-end">
              <Button
                type="submit"
                className="font-semibold"
                disabled={saving || uploadingLogo}
                data-testid="save-company-settings-button"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Salvar
              </Button>
            </div>
          )}
        </form>

        {/* Fora do <form>: tem o próprio salvar, por aviso */}
        {isAdmin && <LoginNoticesManager />}
      </div>
    </Layout>
  );
}
