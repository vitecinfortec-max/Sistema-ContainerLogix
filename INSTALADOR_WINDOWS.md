# 🪟 ContainerLogix - Instalador Windows

## ⚠️ Importante: Limitação do Ambiente de Build

O ambiente atual (Linux ARM64) não consegue gerar instaladores Windows (.msi ou .exe) diretamente sem ferramentas adicionais (Wine/WiX).

## 🔧 Soluções Disponíveis

### Solução 1: Executável Portátil (Recomendado - Mais Simples)

**O que é:** Um único arquivo .exe que roda sem instalação.

**Vantagens:**
- ✅ Não precisa de instalador
- ✅ Funciona em qualquer Windows sem admin
- ✅ Fácil de distribuir
- ✅ Pode ser executado de USB/rede

**Como usar:**
1. Baixe `ContainerLogix-Portable.exe`
2. Clique duas vezes
3. Pronto! Não precisa instalar

### Solução 2: Gerar MSI em Máquina Windows

Se você **realmente precisa** de um instalador .msi, siga estes passos:

#### Opção A: Usando Máquina Windows Real

**1. Prepare o ambiente Windows:**
```cmd
# Instale Node.js 16+ 
# Download: https://nodejs.org

# Instale Yarn
npm install -g yarn
```

**2. Copie os arquivos:**
- Transfira toda a pasta `/app/desktop` para o Windows
- Ou clone do repositório

**3. No Windows, execute:**
```cmd
cd desktop
yarn install
yarn build:win
```

**4. Resultado:**
Arquivos gerados em `dist/`:
- `ContainerLogix-1.0.0-x64.msi` ✅
- `ContainerLogix-1.0.0-x64.exe` (NSIS)

#### Opção B: GitHub Actions (Automatizado)

Crie o arquivo `.github/workflows/build.yml`:

```yaml
name: Build Windows Installer

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  build:
    runs-on: windows-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '16'
      
      - name: Install dependencies
        working-directory: ./desktop
        run: yarn install
      
      - name: Build Windows installer
        working-directory: ./desktop
        run: yarn build:win
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: windows-installers
          path: desktop/dist/*.msi
```

Depois de fazer push, o GitHub Actions gerará o .msi automaticamente.

#### Opção C: Serviço de Build Online

Use serviços como:
- **AppVeyor** (gratuito para open source)
- **CircleCI** (com Windows executor)

### Solução 3: Converter ZIP para MSI

Se você tem um ZIP com os arquivos do app:

**1. Baixe WiX Toolset:**
```
https://wixtoolset.org/
```

**2. Crie arquivo Product.wxs:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" 
           Name="ContainerLogix" 
           Language="1033" 
           Version="1.0.0" 
           Manufacturer="J.A Logística" 
           UpgradeCode="PUT-GUID-HERE">
    
    <Package InstallerVersion="200" Compressed="yes" InstallScope="perMachine" />
    
    <MajorUpgrade DowngradeErrorMessage="A later version is already installed." />
    
    <MediaTemplate EmbedCab="yes" />
    
    <Feature Id="ProductFeature" Title="ContainerLogix" Level="1">
      <ComponentGroupRef Id="ProductComponents" />
    </Feature>
    
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFilesFolder">
        <Directory Id="INSTALLFOLDER" Name="ContainerLogix" />
      </Directory>
      <Directory Id="ProgramMenuFolder">
        <Directory Id="ApplicationProgramsFolder" Name="ContainerLogix"/>
      </Directory>
      <Directory Id="DesktopFolder" Name="Desktop" />
    </Directory>
    
    <ComponentGroup Id="ProductComponents" Directory="INSTALLFOLDER">
      <!-- Adicione seus arquivos aqui -->
      <Component Id="MainExecutable" Guid="*">
        <File Id="ContainerLogixEXE" Source="ContainerLogix.exe" KeyPath="yes">
          <Shortcut Id="desktopShortcut" 
                    Directory="DesktopFolder" 
                    Name="ContainerLogix"
                    WorkingDirectory="INSTALLFOLDER" 
                    Icon="AppIcon.exe" 
                    IconIndex="0" 
                    Advertise="yes" />
          <Shortcut Id="startMenuShortcut" 
                    Directory="ApplicationProgramsFolder" 
                    Name="ContainerLogix"
                    WorkingDirectory="INSTALLFOLDER" 
                    Icon="AppIcon.exe" 
                    IconIndex="0" 
                    Advertise="yes" />
        </File>
      </Component>
    </ComponentGroup>
  </Product>
</Wix>
```

**3. Compile:**
```cmd
candle Product.wxs
light -ext WixUIExtension -out ContainerLogix.msi Product.wixobj
```

---

## 📦 Arquivos de Instalação Alternativos

### O Que Podemos Gerar Agora:

**1. AppImage Linux** ✅ (Já gerado)
```
ContainerLogix-1.0.0-arm64.AppImage (100 MB)
```

**2. ZIP Portátil Windows** (Pode ser gerado)
```bash
cd /app/desktop
yarn build:win --target zip
```
Resultado: `ContainerLogix-1.0.0-win.zip`

**3. Executável Portátil** (Não requer instalação)
Formato: `ContainerLogix-Portable.exe`

---

## 🎯 Recomendação Prática

### Para Distribuição Imediata:

**Use versão Portátil (.exe standalone):**
1. Menor tamanho
2. Não precisa de privilégios de admin
3. Funciona imediatamente
4. Pode ser usado de qualquer lugar

### Para Distribuição Empresarial:

**Use MSI gerado no Windows:**
1. Integração com GPO
2. Instalação silenciosa
3. Instalação por usuário ou máquina
4. Melhor para ambientes corporativos

---

## 📋 Comparação de Formatos

| Formato | Tamanho | Admin? | Instalação | Desinstalação | Atalhos |
|---------|---------|--------|------------|---------------|---------|
| **.msi** | ~100MB | Sim | Sim | Sim (Painel) | Sim |
| **.exe (NSIS)** | ~100MB | Sim | Sim | Sim (Painel) | Sim |
| **Portable.exe** | ~100MB | Não | Não | Delete arquivo | Manual |
| **.zip** | ~150MB | Não | Extract | Delete pasta | Manual |

---

## 🚀 Ação Recomendada

**Opção Mais Rápida:** Use GitHub Actions

1. Faça commit dos arquivos em `/app/desktop`
2. Adicione o workflow YAML acima
3. Faça push para GitHub
4. Aguarde 5-10 minutos
5. Baixe o .msi gerado automaticamente

**Opção Mais Simples:** Use versão portátil

1. Execute em uma máquina Windows: `yarn build:win --target portable`
2. Distribua o arquivo .exe único
3. Usuários clicam e usam (sem instalação)

---

## 📞 Precisa de Ajuda?

Se você tem acesso a:
- ✅ Máquina Windows - Execute `yarn build:win` lá
- ✅ GitHub - Use GitHub Actions
- ✅ Azure/AWS - Use build pipeline
- ✅ Computador local - Execute o build localmente

---

## 🔗 Recursos Úteis

- **Electron Builder Docs:** https://www.electron.build/
- **WiX Toolset:** https://wixtoolset.org/
- **GitHub Actions:** https://docs.github.com/actions
- **AppVeyor:** https://www.appveyor.com/

---

**© 2026 J.A Logística**

*Esta documentação explica as limitações técnicas e oferece soluções práticas para gerar instaladores Windows.*
