# 📥 ContainerLogix Desktop - Download e Instalação

## 🎉 Arquivo de Instalação Gerado com Sucesso!

### 📦 Arquivo Disponível

**Nome:** `ContainerLogix-1.0.0-arm64.AppImage`  
**Tamanho:** 100 MB  
**Plataforma:** Linux (ARM64)  
**Localização:** `/app/desktop/dist/` e `/app/frontend/public/downloads/`

---

## 🌐 Como Baixar

### Opção 1: Pelo Sistema Web (Recomendado)

1. Acesse o sistema: https://container-mvmt-sys.preview.emergentagent.com
2. Faça login
3. Clique na aba **"Desktop"** no menu de navegação
4. Clique em **"BAIXAR AGORA"**
5. O download começará automaticamente

### Opção 2: Download Direto

Acesse diretamente:
```
https://container-mvmt-sys.preview.emergentagent.com/downloads/ContainerLogix-1.0.0-arm64.AppImage
```

### Opção 3: Via Servidor (SSH/SFTP)

O arquivo está localizado em:
```bash
/app/desktop/dist/ContainerLogix-1.0.0-arm64.AppImage
```

Você pode copiá-lo usando SCP:
```bash
scp user@servidor:/app/desktop/dist/ContainerLogix-1.0.0-arm64.AppImage ~/Downloads/
```

---

## 🚀 Como Instalar

### Linux (AppImage)

1. **Baixe o arquivo** `ContainerLogix-1.0.0-arm64.AppImage`

2. **Abra o terminal** na pasta de download:
   ```bash
   cd ~/Downloads
   ```

3. **Torne o arquivo executável:**
   ```bash
   chmod +x ContainerLogix-1.0.0-arm64.AppImage
   ```

4. **Execute o aplicativo:**
   ```bash
   ./ContainerLogix-1.0.0-arm64.AppImage
   ```

### Criar Atalho no Desktop (Opcional)

Crie um arquivo `ContainerLogix.desktop`:

```bash
cat > ~/.local/share/applications/containerlogix.desktop << 'EOF'
[Desktop Entry]
Name=ContainerLogix
Comment=Sistema de Movimentação de Contêineres
Exec=/caminho/completo/para/ContainerLogix-1.0.0-arm64.AppImage
Icon=/caminho/completo/para/icon.png
Terminal=false
Type=Application
Categories=Office;Business;
EOF
```

Substitua `/caminho/completo/para/` pelo caminho real do arquivo.

---

## ✨ O Que Você Terá

### Interface Desktop Completa
- ✅ Aplicativo nativo standalone (não precisa de navegador)
- ✅ Janela otimizada: 1400x900 pixels
- ✅ Resolução mínima: 1024x768
- ✅ Menu em português
- ✅ Ícone da J.A Logística

### Todas as Funcionalidades
- ✅ Dashboard com estatísticas
- ✅ Cadastro e edição de movimentações
- ✅ Gestão de motoristas
- ✅ Gestão de transportadoras
- ✅ Gestão de armadores
- ✅ Relatórios PDF (paisagem)
- ✅ Relatórios Excel
- ✅ Impressão de comprovantes
- ✅ Busca e filtros

### Atalhos de Teclado
- `Ctrl+R` - Recarregar
- `F11` - Tela cheia
- `Ctrl++` - Aumentar zoom
- `Ctrl+-` - Diminuir zoom
- `Ctrl+0` - Resetar zoom
- `Ctrl+Q` - Sair
- `Ctrl+Shift+I` - DevTools

---

## 📋 Requisitos do Sistema

### Mínimo
- **SO:** Linux (ARM64) - Ubuntu 18.04+, Debian 10+, etc.
- **RAM:** 4 GB
- **Disco:** 200 MB livres
- **Resolução:** 1024x768

### Recomendado
- **SO:** Ubuntu 20.04+ ou similar
- **RAM:** 8 GB ou mais
- **Disco:** 500 MB livres
- **Resolução:** 1920x1080 ou superior

---

## 🔧 Solução de Problemas

### O arquivo não executa

**Problema:** Permissões incorretas  
**Solução:**
```bash
chmod +x ContainerLogix-1.0.0-arm64.AppImage
```

### Erro: "cannot execute binary file"

**Problema:** Arquitetura incompatível  
**Solução:** Verifique se seu sistema é ARM64:
```bash
uname -m
# Deve mostrar: aarch64 ou arm64
```

### Erro de bibliotecas faltando

**Solução:** Instale dependências:
```bash
sudo apt-get install libfuse2
```

### Aplicativo não abre

**Solução:** Execute no terminal para ver erros:
```bash
./ContainerLogix-1.0.0-arm64.AppImage
```

---

## 🎯 Próximos Passos

### Para Usuários
1. Baixe o arquivo
2. Siga as instruções de instalação acima
3. Execute e faça login
4. Aproveite a experiência desktop!

### Para Gerar Outras Versões

Se você tem acesso ao código-fonte e quer gerar para outras plataformas:

**Windows:**
```bash
cd /app/desktop
yarn build:win
# Gera: dist/ContainerLogix-Setup-1.0.0.exe
```

**macOS:**
```bash
cd /app/desktop
yarn build:mac
# Gera: dist/ContainerLogix-1.0.0.dmg
```

**Linux x64:**
```bash
cd /app/desktop
yarn build:linux --x64
# Gera: dist/ContainerLogix-1.0.0-x64.AppImage
```

---

## 📞 Suporte

- **Email:** suporte@jalogistica.com.br
- **Website:** www.jalogistica.com.br

---

## 📝 Informações Técnicas

- **Electron:** v28.3.3
- **Node.js:** v16+
- **Tamanho Final:** 100 MB (compactado)
- **Build Tool:** electron-builder v24.13.3

---

**© 2026 J.A Logística - Todos os direitos reservados**

*Desenvolvido com ❤️ para melhor experiência desktop*
