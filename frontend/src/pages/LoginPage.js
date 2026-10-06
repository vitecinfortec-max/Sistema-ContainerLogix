import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { LogIn, Mail, Lock, Eye, EyeOff, KeyRound } from 'lucide-react';
import LoginScene3D from '../components/LoginScene3D';
import { motion, riseIn, staggerParent } from '../components/Motion';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
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
          className="relative z-10 flex flex-col justify-end w-full p-10 xl:p-12 pointer-events-none"
        >
          <div>
            <motion.h1 variants={riseIn} className="text-4xl xl:text-5xl font-black tracking-tight">
              ContainerLogix
            </motion.h1>
            {/* Uma linha só: o tamanho da letra acompanha a largura da tela */}
            <motion.p variants={riseIn} className="text-white/85 mt-3 whitespace-nowrap text-[clamp(13px,1.25vw,18px)]">
              Sistema completo para gestão de movimentação de contêineres
            </motion.p>
            <motion.div variants={riseIn} className="mt-8 text-white/55 text-sm">
              Versão 2.0.0
            </motion.div>
          </div>
        </motion.div>
      </div>

      {/* Lado Direito - Formulário */}
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-slate-900 p-8">
        <motion.div variants={staggerParent(0.07, 0.1)} initial="hidden" animate="show" className="w-full max-w-md">
          {/* Marca: logo + nome do sistema, acima das informações de login */}
          <motion.div variants={riseIn} className="flex items-center gap-3 mb-10" data-testid="login-brand">
            <div className="rounded-xl bg-white dark:bg-slate-800 p-1.5 shadow-md ring-1 ring-slate-200 dark:ring-slate-700">
              <img src="/logo-containerlogix.png" alt="ContainerLogix" className="h-12 w-12 object-contain" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              ContainerLogix
            </span>
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
            <motion.div variants={riseIn} className="space-y-2">
              <Label htmlFor="email" className="text-slate-700 dark:text-slate-300 font-medium">Email</Label>
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
              <Label htmlFor="password" className="text-slate-700 dark:text-slate-300 font-medium">Senha</Label>
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
                <button
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
