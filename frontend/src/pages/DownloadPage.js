import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Download, Monitor, Info, CheckCircle2, Smartphone, Chrome, AppWindow } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

export default function DownloadPage() {
  const handleDownload = () => {
    window.open('/downloads/ContainerLogix-1.0.0-arm64.AppImage', '_blank');
  };

  const handleInstallPWA = () => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      alert('O app já está instalado!');
    } else {
      alert('Clique no ícone ➕ na barra de endereços do navegador para instalar o ContainerLogix como aplicativo.');
    }
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6" data-testid="download-page">
        <div className="text-center">
          <AppWindow className="w-20 h-20 mx-auto mb-4 text-primary" />
          <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Chivo, sans-serif' }}>
            Instalar ContainerLogix
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Escolha a melhor opção para seu dispositivo
          </p>
        </div>

        <Tabs defaultValue="pwa" className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-14">
            <TabsTrigger value="pwa" className="text-base" data-testid="tab-pwa">
              <Chrome className="w-4 h-4 mr-2" />
              PWA Browser
            </TabsTrigger>
            <TabsTrigger value="desktop" className="text-base" data-testid="tab-desktop">
              <Monitor className="w-4 h-4 mr-2" />
              Desktop Linux
            </TabsTrigger>
            <TabsTrigger value="android" className="text-base" data-testid="tab-android">
              <Smartphone className="w-4 h-4 mr-2" />
              Android APK
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pwa" className="space-y-4">
            <Card className="border-2 border-green-500">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                  <div>
                    <CardTitle className="text-2xl">PWA - Recomendado para Desktop!</CardTitle>
                    <CardDescription className="text-base mt-1">
                      Instalação instantânea em Chrome, Edge, Opera e Brave
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <Chrome className="w-12 h-12 mx-auto mb-2 text-blue-600" />
                    <p className="font-semibold">Google Chrome</p>
                    <p className="text-xs text-muted-foreground mt-1">Totalmente suportado</p>
                  </div>
                  <div className="text-center p-4 bg-cyan-50 rounded-lg">
                    <Monitor className="w-12 h-12 mx-auto mb-2 text-cyan-600" />
                    <p className="font-semibold">Microsoft Edge</p>
                    <p className="text-xs text-muted-foreground mt-1">Totalmente suportado</p>
                  </div>
                  <div className="text-center p-4 bg-orange-50 rounded-lg">
                    <AppWindow className="w-12 h-12 mx-auto mb-2 text-orange-600" />
                    <p className="font-semibold">Opera / Brave</p>
                    <p className="text-xs text-muted-foreground mt-1">Totalmente suportado</p>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-6 rounded-lg">
                  <h3 className="font-bold text-lg mb-3">Como Instalar (2 cliques):</h3>
                  <ol className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 font-bold">1</span>
                      <span>Clique no ícone <strong>➕</strong> ou <strong>⊕</strong> na barra de endereços</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 font-bold">2</span>
                      <span>Clique em <strong>"Instalar ContainerLogix"</strong></span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
                      <span className="font-semibold text-green-700">Pronto! App instalado no seu computador</span>
                    </li>
                  </ol>
                </div>

                <div className="text-center">
                  <Button 
                    onClick={handleInstallPWA} 
                    size="lg" 
                    className="font-bold uppercase h-14 px-10 text-base"
                    data-testid="install-pwa-button"
                  >
                    <Chrome className="w-5 h-5 mr-2" />
                    Instalar Agora (PWA)
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    Funciona em: Windows, macOS, Linux, ChromeOS
                  </p>
                </div>

                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="pt-6">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <Info className="w-4 h-4 text-blue-600" />
                      Vantagens do PWA:
                    </h4>
                    <ul className="space-y-1 text-sm text-blue-900">
                      <li>✅ Instalação em 2 cliques (sem download)</li>
                      <li>✅ Apenas ~2MB (vs 100MB do desktop)</li>
                      <li>✅ Atualização automática (sempre na versão mais recente)</li>
                      <li>✅ Funciona offline com cache inteligente</li>
                      <li>✅ Aparece no menu Iniciar como app nativo</li>
                      <li>✅ Não ocupa espaço em disco</li>
                    </ul>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="desktop" className="space-y-4">
            <Card className="border-2 border-primary">
              <CardHeader className="bg-gradient-to-r from-primary/10 to-secondary/10">
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Download className="w-6 h-6" />
                  Desktop Linux (AppImage)
                </CardTitle>
                <CardDescription className="text-base">
                  Versão 1.0.0 - Aplicativo nativo standalone
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-lg">ContainerLogix-1.0.0-arm64.AppImage</p>
                    <p className="text-sm text-muted-foreground">Tamanho: 100 MB</p>
                  </div>
                  <Button 
                    onClick={handleDownload} 
                    size="lg" 
                    className="font-bold uppercase h-14 px-8"
                    data-testid="download-button"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Baixar
                  </Button>
                </div>

                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex gap-2">
                    <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-900">
                      <p className="font-semibold mb-2">Como instalar:</p>
                      <ol className="list-decimal list-inside space-y-1 ml-2">
                        <li>Baixe o arquivo .AppImage</li>
                        <li>Terminal: <code className="bg-blue-100 px-2 py-0.5 rounded font-mono">chmod +x ContainerLogix-1.0.0-arm64.AppImage</code></li>
                        <li>Execute: <code className="bg-blue-100 px-2 py-0.5 rounded font-mono">./ContainerLogix-1.0.0-arm64.AppImage</code></li>
                      </ol>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="android" className="space-y-4">
            <Card className="border-2 border-green-500">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Smartphone className="w-6 h-6" />
                  Aplicativo Android (APK)
                </CardTitle>
                <CardDescription className="text-base">
                  Projeto configurado - Pronto para build
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                  <div className="flex gap-2">
                    <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-900">
                      <p className="font-semibold mb-2">📱 APK Android - Como Gerar:</p>
                      <p className="mb-2">O projeto Android está 100% configurado em <code className="bg-amber-100 px-1 rounded">/app/frontend/android/</code></p>
                      
                      <p className="font-semibold mt-3 mb-1">Via Android Studio:</p>
                      <ol className="list-decimal list-inside space-y-1 ml-2">
                        <li>Instale Android Studio</li>
                        <li>Abra: <code className="bg-amber-100 px-1 rounded">/app/frontend/android/</code></li>
                        <li>Build > Build Bundle(s) / APK(s) > Build APK(s)</li>
                        <li>Aguarde 5-10 minutos</li>
                      </ol>
                      
                      <p className="font-semibold mt-3 mb-1">Via linha de comando:</p>
                      <code className="bg-amber-100 px-2 py-1 rounded font-mono block mt-1">
                        cd /app/frontend/android<br/>
                        ./gradlew assembleDebug
                      </code>
                      
                      <p className="mt-3"><strong>APK gerado em:</strong></p>
                      <code className="bg-amber-100 px-2 py-1 rounded font-mono block text-xs">
                        android/app/build/outputs/apk/debug/app-debug.apk
                      </code>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">📋 Configuração Android</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Capacitor 5.7.0 instalado</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Projeto Android criado</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Manifest Android configurado</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Ícone incluído</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <span>URL servidor configurada</span>
                        </li>
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="bg-green-50 border-green-200">
                    <CardHeader>
                      <CardTitle className="text-base">🎯 Use PWA no Celular!</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm mb-3">
                        Enquanto o APK é gerado, use a versão PWA:
                      </p>
                      <ol className="text-sm space-y-2">
                        <li>1️⃣ Abra no Chrome mobile</li>
                        <li>2️⃣ Menu > "Adicionar à tela inicial"</li>
                        <li>3️⃣ Use como app nativo!</li>
                      </ol>
                      <p className="text-xs text-green-700 mt-3 font-semibold">
                        ✅ Mesmo resultado, zero instalação!
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="desktop" className="space-y-4">
            <Card className="border-2 border-primary">
              <CardHeader className="bg-gradient-to-r from-primary/10 to-secondary/10">
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Download className="w-6 h-6" />
                  Desktop Linux (AppImage)
                </CardTitle>
                <CardDescription className="text-base">
                  Versão 1.0.0 - Aplicativo nativo standalone
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-lg">ContainerLogix-1.0.0-arm64.AppImage</p>
                    <p className="text-sm text-muted-foreground">Tamanho: 100 MB</p>
                  </div>
                  <Button 
                    onClick={handleDownload} 
                    size="lg" 
                    className="font-bold uppercase h-14 px-8"
                    data-testid="download-linux-button"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Baixar Linux
                  </Button>
                </div>

                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex gap-2">
                    <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-900">
                      <p className="font-semibold mb-2">Instalação rápida:</p>
                      <code className="bg-blue-100 px-3 py-2 rounded font-mono block">
                        chmod +x ContainerLogix-1.0.0-arm64.AppImage<br/>
                        ./ContainerLogix-1.0.0-arm64.AppImage
                      </code>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="bg-gradient-to-br from-primary/5 to-secondary/5">
          <CardHeader>
            <CardTitle className="text-xl">💡 Qual Opção Escolher?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <div className="p-4 bg-white rounded-lg border-2 border-green-200">
                <div className="font-bold text-green-700 mb-2 flex items-center gap-1">
                  🌟 PWA Browser
                  <span className="text-xs bg-green-100 px-2 py-0.5 rounded-full">Recomendado</span>
                </div>
                <ul className="space-y-1 text-muted-foreground text-xs">
                  <li>✅ Instalação em 2 cliques</li>
                  <li>✅ Apenas 2 MB</li>
                  <li>✅ Atualiza automaticamente</li>
                  <li>✅ Funciona offline</li>
                  <li>✅ Disponível AGORA</li>
                </ul>
              </div>

              <div className="p-4 bg-white rounded-lg border">
                <div className="font-bold text-blue-700 mb-2">🖥️ Desktop Linux</div>
                <ul className="space-y-1 text-muted-foreground text-xs">
                  <li>✅ App nativo standalone</li>
                  <li>• 100 MB</li>
                  <li>• Requer instalação</li>
                  <li>✅ Menu nativo</li>
                  <li>✅ Download disponível</li>
                </ul>
              </div>

              <div className="p-4 bg-white rounded-lg border">
                <div className="font-bold text-amber-700 mb-2">📱 Android APK</div>
                <ul className="space-y-1 text-muted-foreground text-xs">
                  <li>✅ App móvel nativo</li>
                  <li>• 50-80 MB</li>
                  <li>• Precisa build</li>
                  <li>✅ Offline completo</li>
                  <li>⚙️ Configurado</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
