import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Building2, Upload, X, Save, AlertTriangle, Loader2 } from 'lucide-react';

// Máscara de CNPJ: 00.000.000/0000-00
const formatCNPJ = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

// Máscara de telefone: (00) 0000-0000 ou (00) 00000-0000
const formatPhone = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const EMPTY_FORM = {
  name: '',
  cnpj: '',
  address: '',
  phone: '',
  email: '',
  bank_name: '',
  bank_agency: '',
  bank_account: '',
  pix_key: '',
  logo_filename: ''
};

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [logoPreview, setLogoPreview] = useState(null);
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
      toast.error('Erro ao carregar dados da empresa');
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
    } catch (error) {
      toast.error('Erro ao enviar logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = () => {
    setLogoPreview(null);
    setFormData(prev => ({ ...prev, logo_filename: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAdmin || saving) return;

    setSaving(true);
    try {
      await api.updateCompanySettings(formData);
      toast.success('Dados da empresa salvos com sucesso');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar dados da empresa');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="company-settings-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="company-settings-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Dados da Empresa</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
            Essas informações e o logo são usados nos PDFs e planilhas gerados pelo sistema
          </p>
        </div>

        {!isAdmin && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Apenas administradores podem editar os dados da empresa. Você pode visualizar as informações abaixo.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Identificação
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              <div className="flex flex-col sm:flex-row gap-6">
                <div className="shrink-0">
                  <Label className="text-[13px]">Logo</Label>
                  <div className="mt-1.5">
                    {logoPreview ? (
                      <div className="relative w-32 h-32">
                        <img
                          src={logoPreview}
                          alt="Logo da empresa"
                          className="w-32 h-32 object-contain rounded-lg border bg-white dark:bg-slate-900"
                        />
                        {isAdmin && (
                          <Button
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
                          className="mt-2 text-[12px] h-8"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingLogo}
                          data-testid="upload-logo-button"
                        >
                          {uploadingLogo ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5 mr-1.5" />
                          )}
                          {logoPreview ? 'Trocar Logo' : 'Enviar Logo'}
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
                    <Label htmlFor="name" className="text-[13px]">Nome / Razão Social</Label>
                    <Input
                      id="name"
                      data-testid="company-name-input"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      disabled={!isAdmin}
                      className="h-10 text-[13px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cnpj" className="text-[13px]">CNPJ</Label>
                    <Input
                      id="cnpj"
                      data-testid="company-cnpj-input"
                      value={formData.cnpj}
                      onChange={handleCNPJChange}
                      disabled={!isAdmin}
                      className="h-10 text-[13px] font-mono"
                      maxLength={18}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="address" className="text-[13px]">Endereço</Label>
                    <Textarea
                      id="address"
                      data-testid="company-address-input"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      disabled={!isAdmin}
                      className="text-[13px] min-h-[70px]"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Contato</CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-[13px]">Telefone</Label>
                  <Input
                    id="phone"
                    data-testid="company-phone-input"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    disabled={!isAdmin}
                    className="h-10 text-[13px] font-mono"
                    maxLength={15}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-[13px]">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    data-testid="company-email-input"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    disabled={!isAdmin}
                    className="h-10 text-[13px]"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Dados Bancários</CardTitle>
              <CardDescription className="text-[12px]">Exibidos nos relatórios e faturas de faturamento</CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="bank_name" className="text-[13px]">Banco</Label>
                  <Input
                    id="bank_name"
                    data-testid="company-bank-name-input"
                    value={formData.bank_name}
                    onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                    disabled={!isAdmin}
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bank_agency" className="text-[13px]">Agência</Label>
                  <Input
                    id="bank_agency"
                    data-testid="company-bank-agency-input"
                    value={formData.bank_agency}
                    onChange={(e) => setFormData({ ...formData, bank_agency: e.target.value })}
                    disabled={!isAdmin}
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bank_account" className="text-[13px]">Conta Corrente</Label>
                  <Input
                    id="bank_account"
                    data-testid="company-bank-account-input"
                    value={formData.bank_account}
                    onChange={(e) => setFormData({ ...formData, bank_account: e.target.value })}
                    disabled={!isAdmin}
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pix_key" className="text-[13px]">Chave PIX</Label>
                  <Input
                    id="pix_key"
                    data-testid="company-pix-key-input"
                    value={formData.pix_key}
                    onChange={(e) => setFormData({ ...formData, pix_key: e.target.value })}
                    disabled={!isAdmin}
                    className="h-10 text-[13px]"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {isAdmin && (
            <div className="flex justify-end">
              <Button
                type="submit"
                className="h-10 text-[13px] font-semibold"
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
      </div>
    </Layout>
  );
}
