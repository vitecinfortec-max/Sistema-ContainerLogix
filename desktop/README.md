# ContainerLogix Desktop

Sistema de Movimentação de Contêineres - Aplicativo Desktop

## 📦 Sobre

ContainerLogix Desktop é a versão desktop do sistema de gestão de movimentação de contêineres da J.A Logística. Esta aplicação oferece uma experiência otimizada para computadores desktop com todas as funcionalidades do sistema web.

## ✨ Características

- ✅ Interface completa do sistema web
- ✅ Otimizado para telas de desktop (1024x768 ou superior)
- ✅ Atalhos de teclado para maior produtividade
- ✅ Menu nativo do sistema operacional
- ✅ Funciona sem navegador (aplicativo standalone)
- ✅ Suporte para Windows, macOS e Linux

## 🚀 Como Executar

### Pré-requisitos

- Node.js 16+ instalado
- Yarn ou npm

### Instalação

1. Navegue até a pasta do projeto desktop:
```bash
cd /app/desktop
```

2. Instale as dependências (já instaladas automaticamente):
```bash
yarn install
```

3. Execute o aplicativo:
```bash
yarn start
```

## 📦 Como Criar Executável

### Windows (.exe)
```bash
yarn build:win
```
O instalador será gerado em: `dist/ContainerLogix Setup 1.0.0.exe`

### macOS (.dmg)
```bash
yarn build:mac
```
O instalador será gerado em: `dist/ContainerLogix-1.0.0.dmg`

### Linux (.AppImage)
```bash
yarn build:linux
```
O instalador será gerado em: `dist/ContainerLogix-1.0.0.AppImage`

## ⌨️ Atalhos de Teclado

### Navegação
- `Ctrl+R` (ou `Cmd+R` no Mac) - Recarregar página
- `F11` - Alternar tela cheia
- `Ctrl+Q` (ou `Cmd+Q` no Mac) - Sair do aplicativo

### Visualização
- `Ctrl++` (ou `Cmd++` no Mac) - Aumentar zoom
- `Ctrl+-` (ou `Cmd+-` no Mac) - Diminuir zoom
- `Ctrl+0` (ou `Cmd+0` no Mac) - Resetar zoom

### Edição
- `Ctrl+Z` - Desfazer
- `Ctrl+Shift+Z` - Refazer
- `Ctrl+X` - Recortar
- `Ctrl+C` - Copiar
- `Ctrl+V` - Colar
- `Ctrl+A` - Selecionar tudo

### Desenvolvedor
- `Ctrl+Shift+I` - Abrir ferramentas do desenvolvedor

## 📋 Funcionalidades

### Dashboard
- Visualização de estatísticas em tempo real
- Entradas e saídas do dia
- Estoque atual
- Movimentações recentes

### Movimentações
- Cadastro de novas movimentações
- Edição de movimentações existentes
- Visualização detalhada
- Impressão de comprovantes
- Filtros e busca avançada

### Cadastros
- Motoristas
- Transportadoras
- Armadores (Shipping Lines)

### Relatórios
- Geração de relatórios em PDF (orientação paisagem)
- Exportação para Excel (.xlsx)
- Filtros por tipo de operação
- Totalizadores automáticos

## 🖥️ Requisitos do Sistema

### Mínimos
- **Sistema Operacional:** Windows 10, macOS 10.13+, ou Linux
- **Memória RAM:** 4 GB
- **Espaço em Disco:** 200 MB
- **Resolução:** 1024x768 ou superior

### Recomendados
- **Sistema Operacional:** Windows 11, macOS 12+, ou Linux (Ubuntu 20.04+)
- **Memória RAM:** 8 GB ou mais
- **Espaço em Disco:** 500 MB
- **Resolução:** 1920x1080 ou superior

## 🔧 Configuração

### Alterando a URL do Backend

Se precisar apontar para um servidor diferente, edite o arquivo `main.js`:

```javascript
const APP_URL = 'https://seu-servidor.com';
```

## 📝 Notas de Versão

### v1.0.0 (2026-02-11)
- ✅ Lançamento inicial
- ✅ Todas as funcionalidades do sistema web
- ✅ Menu nativo personalizado
- ✅ Atalhos de teclado
- ✅ Suporte multiplataforma

## 🆘 Suporte

Para suporte técnico, entre em contato:
- Email: suporte@jalogistica.com.br
- Website: www.jalogistica.com.br

## 📄 Licença

© 2026 J.A Logística - Todos os direitos reservados

---

**Desenvolvido com ❤️ para J.A Logística**
