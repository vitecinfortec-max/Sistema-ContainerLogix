import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { LogIn, Mail, Lock, User, Eye, EyeOff, KeyRound } from 'lucide-react';

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const userData = await login(email, password);
        toast.success('Login realizado com sucesso!');
        
        // Verificar se precisa alterar a senha
        if (userData.must_change_password) {
          navigate('/change-password');
        } else {
          navigate('/dashboard');
        }
      } else {
        await register(name, email, password);
        toast.success('Cadastro realizado com sucesso!');
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
      {/* Lado Esquerdo - Imagem/Marca */}
      <div 
        className="hidden lg:flex lg:w-1/2 bg-primary relative overflow-hidden"
      >
        {/* Padrão de fundo */}
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ 
            backgroundImage: 'url(https://images.unsplash.com/photo-1494412574643-ff11b0a5c1c3?q=80&w=2070)',
          }}
        />
        
        {/* Conteúdo */}
        <div className="relative z-10 flex flex-col items-center justify-center w-full p-12">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-2xl mb-8">
            <img 
              src="/logo-containerlogix.png"
              alt="ContainerLogix"
              className="h-24"
            />
          </div>
          
          <h1 className="text-4xl md:text-5xl font-black text-white text-center mb-4">
            ContainerLogix
          </h1>
          
          <p className="text-white/90 text-lg text-center max-w-md">
            Sistema completo para gestão de movimentação de contêineres
          </p>
          
          <div className="mt-12 text-white/60 text-sm">
            Versão 2.0.0
          </div>
        </div>
      </div>

      {/* Lado Direito - Formulário */}
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-slate-900 p-8">
        <div className="w-full max-w-md">
          {/* Logo Mobile */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-block bg-primary/10 rounded-xl p-4 mb-4">
              <img 
                src="/logo-containerlogix.png"
                alt="ContainerLogix"
                className="h-16 mx-auto"
              />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              ContainerLogix
            </h1>
          </div>

          {/* Cabeçalho do Formulário */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              {isLogin ? 'Bem-vindo!' : 'Criar Conta'}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              {isLogin ? 'Entre com suas credenciais para acessar o sistema' : 'Preencha os dados para criar sua conta'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" data-testid="login-form">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="name" className="text-slate-700 dark:text-slate-300 font-medium">Nome Completo</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400 dark:text-slate-500" />
                  <Input
                    id="name"
                    data-testid="name-input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required={!isLogin}
                    placeholder="Seu nome completo"
                    className="h-12 pl-11 border-slate-300 dark:border-slate-600 focus:border-primary focus:ring-primary"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
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
                  placeholder="seu@email.com"
                  className="h-12 pl-11 border-slate-300 dark:border-slate-600 focus:border-primary focus:ring-primary"
                />
              </div>
            </div>

            <div className="space-y-2">
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
                  placeholder="Sua senha"
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
            </div>

            <Button
              type="submit" 
              className="w-full h-12 font-bold uppercase tracking-wide text-white bg-primary hover:bg-primary/90 transition-all active:scale-[0.98]" 
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
                  {isLogin ? 'Entrar' : 'Cadastrar'}
                </>
              )}
            </Button>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-primary hover:underline font-medium"
                data-testid="toggle-auth-mode"
              >
                {isLogin ? 'Crie sua conta aqui' : 'Já tem conta? Faça login'}
              </button>

              {isLogin && (
                <Link
                  to="/forgot-password"
                  className="text-sm text-slate-500 dark:text-slate-400 hover:text-primary hover:underline inline-flex items-center"
                  data-testid="forgot-password-link"
                >
                  <KeyRound className="w-3 h-3 mr-1" />
                  Esqueci minha senha
                </Link>
              )}
            </div>
          </form>

          {/* Rodapé */}
          <div className="mt-12 text-center">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              ContainerLogix - Sistema de Gestão de Contêineres
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
