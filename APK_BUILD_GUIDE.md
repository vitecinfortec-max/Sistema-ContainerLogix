# Guia para Gerar APK do ContainerLogix

## Opção 1: Compilar Localmente (Recomendado)

### Pré-requisitos
1. **Node.js** v18+ e npm/yarn
2. **Java JDK 17** 
3. **Android Studio** com Android SDK

### Passo a Passo

1. **Clone o projeto ou baixe os arquivos**

2. **Instale as dependências**
```bash
cd frontend
yarn install
```

3. **Gere o build de produção**
```bash
yarn build
```

4. **Sincronize com o Android**
```bash
npx cap sync android
```

5. **Abra no Android Studio**
```bash
npx cap open android
```

6. **Gere o APK no Android Studio**
   - Menu: `Build > Build Bundle(s) / APK(s) > Build APK(s)`
   - O APK estará em: `android/app/build/outputs/apk/debug/app-debug.apk`

### Para APK de Release (Assinado)
1. Gere uma keystore:
```bash
keytool -genkey -v -keystore containerlogix.keystore -alias containerlogix -keyalg RSA -keysize 2048 -validity 10000
```

2. Configure em `android/app/build.gradle`:
```gradle
android {
    signingConfigs {
        release {
            storeFile file('containerlogix.keystore')
            storePassword 'sua_senha'
            keyAlias 'containerlogix'
            keyPassword 'sua_senha'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

3. Gere o APK de release:
   - `Build > Build Bundle(s) / APK(s) > Build APK(s)`

---

## Opção 2: GitHub Actions (CI/CD Automatizado)

Crie o arquivo `.github/workflows/android.yml`:

```yaml
name: Build Android APK

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'yarn'
          cache-dependency-path: frontend/yarn.lock
      
      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      
      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
      
      - name: Install dependencies
        working-directory: frontend
        run: yarn install
      
      - name: Build React app
        working-directory: frontend
        run: yarn build
      
      - name: Sync Capacitor
        working-directory: frontend
        run: npx cap sync android
      
      - name: Build APK
        working-directory: frontend/android
        run: ./gradlew assembleDebug
      
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: containerlogix-apk
          path: frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Configuração do App

O arquivo `capacitor.config.json` já está configurado:

```json
{
  "appId": "com.jalogistica.containerlogix",
  "appName": "ContainerLogix",
  "webDir": "build",
  "server": {
    "url": "https://container-mvmt-sys.preview.emergentagent.com",
    "cleartext": true,
    "androidScheme": "https"
  }
}
```

**Importante:** O app Android aponta para o servidor web. Todos os dados são sincronizados automaticamente entre PWA e APK.

---

## Sincronização PWA/APK

### Como Funciona

O ContainerLogix usa uma **arquitetura híbrida** onde:

1. **Frontend (React)** - Código único para todas as plataformas
2. **Backend (FastAPI)** - API centralizada no servidor
3. **Capacitor** - Empacota o app React como APK nativo

```
┌─────────────────┐     ┌─────────────────┐
│   Browser/PWA   │────▶│                 │
└─────────────────┘     │   Backend API   │
                        │  (FastAPI)      │
┌─────────────────┐     │                 │
│   APK Android   │────▶│   MongoDB       │
└─────────────────┘     └─────────────────┘
```

### Benefícios

- ✅ **Dados sincronizados automaticamente** - Mesmo banco de dados
- ✅ **Código único** - Alterações no React refletem em todas as plataformas
- ✅ **Mesmo usuário** - Login funciona em qualquer plataforma
- ✅ **Tempo real** - Polling sincroniza dados entre dispositivos
- ✅ **Notificações** - Service Worker ativo no PWA

### Atualizando o APK após alterações

Sempre que fizer alterações no código, execute:

```bash
cd frontend
yarn build                # Compila o React
npx cap sync android      # Sincroniza com Android
npx cap open android      # Abre no Android Studio para gerar APK
```

### Funcionalidades disponíveis em ambas plataformas

| Funcionalidade | Browser/PWA | APK |
|----------------|-------------|-----|
| Login/Cadastro | ✅ | ✅ |
| Recuperação de Senha | ✅ | ✅ |
| CRUD Movimentações | ✅ | ✅ |
| Filtros e Relatórios | ✅ | ✅ |
| Faturamento | ✅ | ✅ |
| Download PDF/Excel | ✅ | ✅ |
| Impressão | ✅ | ✅* |
| Sincronização em tempo real | ✅ | ✅ |

*Impressão no APK abre o diálogo de compartilhamento do Android

---

## Solução de Problemas

### Erro: ANDROID_SDK_ROOT not found
```bash
export ANDROID_SDK_ROOT=$HOME/Android/Sdk
```

### Erro: Build tools not found
```bash
sdkmanager "build-tools;34.0.0"
```

### Erro: License not accepted
```bash
yes | sdkmanager --licenses
```
