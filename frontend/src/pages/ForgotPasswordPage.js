import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      await axios.post(`${API_URL}/api/auth/forgot-password`, { email });
      setSent(true);
      toast.success('Verifique seu email para a senha provisória');
    } catch (error) {
      toast.error('Erro ao processar solicitação');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center px-4 py-12 bg-cover bg-center"
      style={{
        backgroundImage: 'url(https://images.unsplash.com/photo-1494412574643-ff11b0a5c1c3?q=80&w=2070)',
      }}
    >
      <div className="absolute inset-0 bg-black/40" />
      
      <Card className="w-full max-w-md relative z-10 shadow-2xl">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-white p-3 rounded-xl shadow-md">
              <img 
                src="https://customer-assets.emergentagent.com/job_da181895-6b28-4daf-bef5-4444909581e8/artifacts/i8vfweuv_logo.png" 
                alt="J.A Logística" 
                className="h-12 w-auto"
              />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Recuperar Senha</CardTitle>
          <CardDescription>
            {sent 
              ? 'Verifique seu email para instruções' 
              : 'Digite seu email para receber uma senha provisória'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center p-4 bg-green-50 rounded-lg">
                <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
                <p className="text-sm text-green-800 font-medium">
                  Se o email estiver cadastrado, você receberá uma senha provisória.
                </p>
                <p className="text-xs text-green-600 mt-2">
                  Verifique também a pasta de spam.
                </p>
              </div>
              
              <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                <p className="text-sm text-amber-800">
                  <strong>Próximos passos:</strong>
                </p>
                <ol className="text-xs text-amber-700 mt-2 list-decimal list-inside space-y-1">
                  <li>Acesse seu email e copie a senha provisória</li>
                  <li>Faça login com a senha provisória</li>
                  <li>Crie uma nova senha segura</li>
                </ol>
              </div>

              <Link to="/login">
                <Button className="w-full h-12" variant="outline">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Voltar para Login
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-10 h-12"
                    placeholder="seu@email.com"
                    data-testid="forgot-email-input"
                  />
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full h-12 font-bold uppercase tracking-wide"
                disabled={loading}
                data-testid="forgot-submit-button"
              >
                {loading ? 'Enviando...' : 'Enviar Senha Provisória'}
              </Button>

              <Link to="/login" className="block">
                <Button variant="ghost" className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Voltar para Login
                </Button>
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
