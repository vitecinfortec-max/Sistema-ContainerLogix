# 📱 ContainerLogix - Instalação Android (APK) e PWA Browser

## 🤖 INSTALAÇÃO ANDROID APK

### 📦 Como Gerar o APK

O projeto Android foi configurado com sucesso em: `/app/frontend/android/`

#### Pré-requisitos

1. **Android Studio** instalado
2. **JDK 17** ou superior
3. **Android SDK** (API 33+)
4. **Gradle** (incluído no Android Studio)

#### Opção 1: Gerar APK no Android Studio

**Passo a Passo:**

1. **Abra o projeto no Android Studio:**
   ```bash
   cd /app/frontend
   npx cap open android
   ```

2. **No Android Studio:**
   - Aguarde a sincronização do Gradle
   - Vá em: `Build > Build Bundle(s) / APK(s) > Build APK(s)`
   - Aguarde a compilação (5-10 minutos na primeira vez)

3. **Localize o APK:**
   ```
   /app/frontend/android/app/build/outputs/apk/debug/app-debug.apk
   ```

4. **APK Pronto!**
   - Tamanho: ~50-80 MB
   - Versão: Debug (para testes)

#### Opção 2: Gerar APK via Linha de Comando

```bash
cd /app/frontend/android
./gradlew assembleDebug
```

APK gerado em:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

#### Opção 3: APK de Produção (Assinado)

**1. Crie uma keystore:**
```bash
keytool -genkey -v -keystore containerlogix.keystore -alias containerlogix -keyalg RSA -keysize 2048 -validity 10000
```

**2. Configure o build:**

Edite `android/app/build.gradle`:

```gradle
android {
    ...
    signingConfigs {
        release {
            storeFile file("../../containerlogix.keystore")
            storePassword "sua-senha"
            keyAlias "containerlogix"
            keyPassword "sua-senha"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

**3. Gere o APK de produção:**
```bash
cd /app/frontend/android
./gradlew assembleRelease
```

APK gerado em:
```
android/app/build/outputs/apk/release/app-release.apk
```

---

## 🌐 INSTALAÇÃO PWA EM NAVEGADORES DESKTOP

### ✨ Progressive Web App (PWA) Configurado!

O sistema agora funciona como PWA instalável em Chrome, Edge e Firefox.

### 📥 Como Instalar no Google Chrome

1. **Acesse o sistema:**
   ```
   https://container-mvmt-sys.preview.emergentagent.com
   ```

2. **Instale o app:**
   - Clique no ícone **➕** (mais) na barra de endereços
   - Ou vá em: **Menu (⋮) > Salvar e compartilhar > Instalar ContainerLogix**
   - Ou use o atalho: **Ctrl+Shift+A** (Windows/Linux) ou **Cmd+Shift+A** (Mac)

3. **Confirme a instalação:**
   - Clique em "Instalar"
   - O app será adicionado ao menu Iniciar/Aplicativos

4. **Abra o app:**
   - Procure "ContainerLogix" no menu Iniciar
   - Ou abra pelo Chrome: `chrome://apps`

### 📥 Como Instalar no Microsoft Edge

1. **Acesse o sistema:**
   ```
   https://container-mvmt-sys.preview.emergentagent.com
   ```

2. **Instale o app:**
   - Clique no ícone **➕** na barra de endereços
   - Ou vá em: **Menu (...) > Aplicativos > Instalar este site como aplicativo**
   - Ou clique no banner "Instalar ContainerLogix"

3. **Personalize (opcional):**
   - Escolha permitir na barra de título
   - Marque "Fixar na barra de tarefas"
   - Marque "Iniciar automaticamente ao fazer login"

4. **App instalado!**
   - Ícone na área de trabalho
   - Entrada no menu Iniciar
   - Atalho na barra de tarefas

### 📥 Como Instalar no Mozilla Firefox

Firefox tem suporte limitado a PWA. Soluções:

**Opção A: Criar Atalho (Nativo)**

1. Acesse o sistema
2. Menu (☰) > **"Mais ferramentas" > "Adicionar à tela inicial"**
3. Escolha nome e local
4. Atalho criado!

**Opção B: Usar Extensão PWA**

1. Instale a extensão: [PWA for Firefox](https://addons.mozilla.org/firefox/addon/pwas-for-firefox/)
2. Clique no ícone da extensão
3. Clique em "Install Current Site"
4. PWA instalado!

**Opção C: Usar como Site Fixado**

1. Arraste a aba para fora
2. Menu > "Fixar aba"
3. Firefox cria um atalho persistente

---

## 🎯 Comparação: APK vs PWA vs Desktop

| Característica | APK Android | PWA Browser | Desktop Electron |
|----------------|-------------|-------------|------------------|
| **Instalação** | Google Play ou APK | 1 clique no navegador | Instalador .exe/.msi |
| **Tamanho** | 50-80 MB | ~2 MB | 100 MB |
| **Offline** | ✅ Sim | ✅ Cache | ✅ Sim |
| **Ícone** | ✅ Home screen | ✅ Menu Iniciar | ✅ Área de trabalho |
| **Notificações** | ✅ Push | ✅ Push | ✅ Sistema |
| **Auto-update** | Play Store | ✅ Automático | Manual |
| **Permissões** | Android | Navegador | Sistema |

---

## 🚀 Vantagens do PWA (Recomendado para Desktop)

### ✨ Por que usar PWA no Desktop?

1. **Instalação Instantânea** (2 cliques)
2. **Sempre Atualizado** (sem reinstalar)
3. **Leve** (~2MB vs 100MB)
4. **Funciona Offline** (cache inteligente)
5. **Multiplataforma** (Windows, Mac, Linux)

### 🎯 Funcionalidades PWA Ativadas

- ✅ **Instalável** em Chrome, Edge, Opera
- ✅ **Ícone personalizado** J.A Logística
- ✅ **Modo standalone** (sem barra do navegador)
- ✅ **Cache offline** (Service Worker)
- ✅ **Tema personalizado** (cores da marca)
- ✅ **Responsivo** (mobile e desktop)
- ✅ **Rápido** (carregamento otimizado)

---

## 📱 Como Distribuir o APK Android

### Opção 1: Download Direto (Simples)

1. Gere o APK (instruções acima)
2. Hospede em seu servidor
3. Usuários baixam e instalam
4. ⚠️ Precisa habilitar "Fontes desconhecidas"

### Opção 2: Google Play Store (Profissional)

1. **Crie conta Google Play Developer** ($25 único)
2. **Prepare o app:**
   ```bash
   cd /app/frontend/android
   ./gradlew bundleRelease
   ```
3. **Upload do AAB:**
   - Acesse: https://play.google.com/console
   - Crie novo app
   - Upload: `android/app/build/outputs/bundle/release/app-release.aab`
4. **Preencha informações:**
   - Screenshots
   - Descrição
   - Ícone
5. **Publique!**

### Opção 3: Firebase App Distribution (Beta)

1. **Instale Firebase CLI:**
   ```bash
   npm install -g firebase-tools
   ```

2. **Configure:**
   ```bash
   firebase login
   firebase init hosting
   ```

3. **Distribua:**
   ```bash
   firebase appdistribution:distribute android/app/build/outputs/apk/debug/app-debug.apk
   ```

---

## 🖥️ Instruções para Usuários Finais

### 📱 Android

**Instalar APK:**

1. Baixe `ContainerLogix.apk` no celular
2. Abra o arquivo
3. Permitir instalação de fontes desconhecidas:
   - Configurações > Segurança > Fontes Desconhecidas > Ativar
4. Confirme a instalação
5. Abra o app pelo ícone na tela inicial

### 🌐 Desktop (Chrome/Edge)

**Instalar PWA:**

1. Acesse: https://container-mvmt-sys.preview.emergentagent.com
2. Clique no ícone ➕ na barra de endereços
3. Clique em "Instalar"
4. Pronto! App instalado no menu Iniciar

**Ou crie atalho na área de trabalho:**
- Chrome: chrome://apps > botão direito > Criar atalhos
- Edge: edge://apps > botão direito > Fixar na barra de tarefas

---

## 📋 Checklist de Configuração

### ✅ APK Android
- [x] Capacitor instalado e configurado
- [x] Projeto Android criado em `/app/frontend/android/`
- [x] Manifest configurado
- [x] Ícone da empresa incluído
- [x] URL do servidor configurada
- [ ] **Próximo:** Abrir no Android Studio e gerar APK

### ✅ PWA Browser
- [x] Service Worker criado
- [x] Manifest.json completo
- [x] Meta tags PWA no index.html
- [x] Ícones configurados
- [x] Tema e cores definidos
- [x] Instalável em Chrome/Edge
- [x] Cache offline ativo

---

## 🎯 Status Atual

### ✅ Pronto para Usar (0 minutos)
- **PWA Browser** - Já funcionando!
- Acesse e instale: https://container-mvmt-sys.preview.emergentagent.com
- Funciona em Chrome, Edge, Opera, Brave

### ⚙️ Precisa de Build (10 minutos)
- **APK Android** - Projeto configurado
- Abra em Android Studio e clique em "Build APK"
- Ou execute: `./gradlew assembleDebug`

### ⚙️ Precisa de Build em Windows (10 minutos)
- **MSI Windows** - Scripts prontos
- Execute `build-windows.bat` em máquina Windows
- Ou use GitHub Actions (automatizado)

---

## 📞 Próximos Passos

### Para Gerar APK Agora:

1. **Instale Android Studio:**
   - Download: https://developer.android.com/studio

2. **Abra o projeto:**
   ```bash
   cd /app/frontend
   npx cap open android
   ```

3. **Clique em:**
   - `Build > Build Bundle(s) / APK(s) > Build APK(s)`

4. **Aguarde 5-10 minutos**

5. **APK pronto em:**
   ```
   android/app/build/outputs/apk/debug/app-debug.apk
   ```

### Para Usar PWA Agora (Imediato):

1. Abra Chrome ou Edge
2. Acesse: https://container-mvmt-sys.preview.emergentagent.com
3. Clique em ➕ "Instalar"
4. Use como app nativo!

---

## 📦 Arquivos e Configurações Criados

**Android:**
- ✅ `/app/frontend/android/` - Projeto completo
- ✅ `/app/frontend/capacitor.config.json` - Config

**PWA:**
- ✅ `/app/frontend/public/manifest.json` - Manifest completo
- ✅ `/app/frontend/public/service-worker.js` - Cache offline
- ✅ `/app/frontend/public/index.html` - Meta tags PWA
- ✅ `/app/frontend/src/index.js` - Registro do SW

**Documentação:**
- ✅ `/app/INSTALACAO_ANDROID_PWA.md` - Este guia

---

**🎉 PWA já está 100% funcional! APK precisa apenas do build no Android Studio.**

**© 2026 J.A Logística**