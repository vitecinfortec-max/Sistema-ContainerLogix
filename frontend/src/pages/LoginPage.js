import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { LogIn, Mail, Lock, Eye, EyeOff, KeyRound, Building2 } from 'lucide-react';
import { api } from '../lib/api';
import { getTenantCode, setTenantCode } from '../lib/tenant';
import LoginScene3D from '../components/LoginScene3D';
import LoginNotices from '../components/LoginNotices';
import { motion, riseIn, staggerParent } from '../components/Motion';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  // Multi-cliente: { status: 'single' | 'ok' | 'need-code', name, slug, logo_filename }
  const [tenant, setTenant] = useState({ status: 'loading' });
  const [companyCode, setCompanyCode] = useState(getTenantCode());
  // Avisos do painel ao lado do formulário (cadastrados em Dados da Empresa)
  const [notices, setNotices] = useState([]);

  const loadTenant = () => api.getTenantInfo()
    .then((res) => {
      const info = res.data || {};
      const next = info.multi_tenant ? { status: 'ok', ...info } : { status: 'single' };
      setTenant(next);
      return next;
    })
    .catch((error) => {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      // 400/404 do servidor multi-cliente: este endereço não diz a empresa
      // (app do celular) - pede o código. Outros erros: tela como sempre.
      const next = (status === 400 || status === 404) && detail !== 'Not Found' ? { status: 'need-code' } : { status: 'single' };
      setTenant(next);
      return next;
    });

  useEffect(() => { loadTenant(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sem empresa definida (app pedindo o código) não há de onde ler os avisos
  useEffect(() => {
    if (tenant.status !== 'ok' && tenant.status !== 'single') return;
    api.getLoginNotices()
      .then((res) => setNotices(Array.isArray(res.data) ? res.data : []))
      .catch(() => setNotices([]));
  }, [tenant.status, tenant.slug]);

  const changeCompany = () => {
    setTenantCode('');
    setCompanyCode('');
    loadTenant();
  };

  // Antes do login o <img> não tem token: a empresa vai na URL (?tenant=)
  const companyLogo = tenant.status === 'ok' && tenant.logo_filename ? api.getFileUrl(`/api/uploads/${tenant.logo_filename}`) : null;
  const logoUrl = companyLogo ? `${companyLogo}${companyLogo.includes('?') ? '&' : '?'}tenant=${tenant.slug}` : '/logo-containerlogix.png';
  const brandName = tenant.status === 'ok' && tenant.name ? tenant.name : 'ContainerLogix';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (tenant.status === 'need-code') {
        if (!companyCode.trim()) {
          toast.error('Informe o código da empresa');
          return;
        }
        setTenantCode(companyCode);
        const info = await loadTenant();
        if (info.status !== 'ok') {
          setTenantCode('');
          toast.error('Código da empresa não encontrado');
          return;
        }
      }
      const userData = await login(email, password);
      toast.success('Login realizado com sucesso!');

      // Verificar se precisa alterar a senha
      if (userData.must_change_password) {
        navigate('/change-password');
      } else {
        navigate('/dashboard');
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao processar solicitação');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Lado Esquerdo - cena 3D do pátio + marca */}
      <div
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden text-white"
        style={{ background: 'radial-gradient(120% 90% at 18% 8%, #0c9a8a 0%, #06584f 46%, #032a27 100%)' }}
      >
        <LoginScene3D />
        {/* Véu escuro em cima e embaixo pra marca e o texto ficarem legíveis sobre a cena */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent from-[56%] to-[#032a27] to-[88%]" />

        <motion.div
          variants={staggerParent(0.12, 0.2)}
          initial="hidden"
          animate="show"
          className={`relative z-10 flex flex-col w-full p-10 xl:p-12 pointer-events-none ${notices.length ? 'justify-between' : 'justify-end'}`}
        >
          <div>
            <motion.h1 variants={riseIn} className={`font-black tracking-tight ${notices.length ? 'text-2xl xl:text-3xl' : 'text-4xl xl:text-5xl'}`}>
              ContainerLogix
            </motion.h1>
            {/* Uma linha só: o tamanho da letra acompanha a largura da tela */}
            <motion.p variants={riseIn} className="text-white/85 mt-3 whitespace-nowrap text-[clamp(13px,1.25vw,18px)]">
              Sistema completo para gestão de movimentação de contêineres
            </motion.p>
            {!notices.length && (
              <motion.div variants={riseIn} className="mt-8 text-white/55 text-sm">
                Versão 2.0.0
              </motion.div>
            )}
          </div>
          {notices.length > 0 && (
            <motion.div variants={riseIn} className="max-w-xl">
              <LoginNotices notices={notices} />
            </motion.div>
          )}
        </motion.div>
      </div>

      {/* Lado Direito - Formulário */}
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-slate-900 p-8">
        <motion.div variants={staggerParent(0.07, 0.1)} initial="hidden" animate="show" className="w-full max-w-md">
          {/* Marca: logo + nome do sistema, acima das informações de login */}
          <motion.div variants={riseIn} className="flex items-center gap-3 mb-10" data-testid="login-brand">
            <div className="rounded-xl bg-white dark:bg-slate-800 p-1.5 shadow-md ring-1 ring-slate-200 dark:ring-slate-700">
              <img src={logoUrl} alt={brandName} className="h-12 w-12 object-contain"
                onError={(e) => { e.currentTarget.src = '/logo-containerlogix.png'; }} />
            </div>
            <div className="min-w-0">
              <span className="block text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate" data-testid="login-brand-name">
                {brandName}
              </span>
              {tenant.status === 'ok' && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  ContainerLogix
                  {getTenantCode() && (
                    <> · <button type="button" onClick={changeCompany} className="text-primary hover:underline" data-testid="change-company">trocar empresa</button></>
                  )}
                </span>
              )}
            </div>
          </motion.div>

          {/* Cabeçalho do Formulário */}
          <motion.div variants={riseIn} className="mb-8">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              Bem-vindo!
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              Entre com suas credenciais para acessar o sistema
            </p>
          </motion.div>

          <form onSubmit={handleSubmit} className="space-y-5" data-testid="login-form">
            {tenant.status === 'need-code' && (
              <motion.div variants={riseIn} className="space-y-2">
                <Label htmlFor="company-code" className="text-sm text-slate-700 dark:text-slate-300 font-medium">Código da empresa</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400 dark:text-slate-500" />
                  <Input
                    id="company-code"
                    data-testid="company-code-input"
                    value={companyCode}
                    onChange={(e) => setCompanyCode(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    required
                    className="h-12 pl-11 border-slate-300 dark:border-slate-600 focus:border-primary focus:ring-primary"
                  />
                </div>
              </motion.div>
            )}
            <motion.div variants={riseIn} className="space-y-2">
              <Label htmlFor="email" className="text-sm text-slate-700 dark:text-slate-300 font-medium">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400 dark:text-slate-500" />
                <Input
                  id="email"
                  data-testid="email-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 pl-11 border-slate-300 dark:border-slate-600 focus:border-primary focus:ring-primary"
                />
              </div>
            </motion.div>

            <motion.div variants={riseIn} className="space-y-2">
              <Label htmlFor="password" className="text-sm text-slate-700 dark:text-slate-300 font-medium">Senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400 dark:text-slate-500" />
                <Input
                  id="password"
                  data-testid="password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 pl-11 pr-11 border-slate-300 dark:border-slate-600 focus:border-primary focus:ring-primary"
                />
                <button title="Mostrar ou ocultar senha" aria-label="Mostrar ou ocultar senha"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </motion.div>

            <motion.div variants={riseIn}>
              <Button
                type="submit"
                className="w-full h-12 font-bold uppercase tracking-wide text-white bg-primary hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25"
                disabled={loading}
                data-testid="submit-button"
              >
                {loading ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processando...
                  </span>
                ) : (
                  <>
                    <LogIn className="w-5 h-5 mr-2" />
                    Entrar
                  </>
                )}
              </Button>
            </motion.div>

            {/* Novos acessos são criados por um administrador em Gestão de Usuários */}
            <motion.div variants={riseIn} className="flex items-center justify-end pt-2">
              <Link
                to="/forgot-password"
                className="text-sm text-slate-500 dark:text-slate-400 hover:text-primary hover:underline inline-flex items-center"
                data-testid="forgot-password-link"
              >
                <KeyRound className="w-3 h-3 mr-1" />
                Esqueci minha senha
              </Link>
            </motion.div>
          </form>

          {notices.length > 0 && (
            <motion.div variants={riseIn} className="lg:hidden mt-8">
              <LoginNotices notices={notices} variant="card" />
            </motion.div>
          )}

          {/* Rodapé */}
          <motion.div variants={riseIn} className="mt-12 text-center">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              ContainerLogix - Sistema de Gestão de Contêineres
            </p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
