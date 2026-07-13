# 🖥️ GUIA RÁPIDO - ContainerLogix Desktop

## Para Usuários (Instalação Simples)

### Windows
1. Baixe o arquivo `ContainerLogix-Setup-1.0.0.exe`
2. Execute o instalador
3. Clique em "Instalar"
4. Abra o ContainerLogix pelo menu Iniciar

### macOS
1. Baixe o arquivo `ContainerLogix-1.0.0.dmg`
2. Abra o arquivo .dmg
3. Arraste o ContainerLogix para a pasta Aplicativos
4. Abra pelo Launchpad

### Linux
1. Baixe o arquivo `ContainerLogix-1.0.0.AppImage`
2. Torne o arquivo executável: `chmod +x ContainerLogix-1.0.0.AppImage`
3. Execute: `./ContainerLogix-1.0.0.AppImage`

---

## Para Desenvolvedores (Build do Zero)

### Pré-requisitos
- Node.js 16 ou superior
- Yarn (ou npm)

### Passos

1. **Clone ou acesse a pasta do projeto:**
   ```bash
   cd /app/desktop
   ```

2. **Instale as dependências:**
   ```bash
   yarn install
   ```

3. **Execute em modo desenvolvimento:**
   ```bash
   yarn start
   ```

4. **Gere o instalador para sua plataforma:**
   
   **Windows:**
   ```bash
   yarn build:win
   ```
   Resultado: `dist/ContainerLogix-Setup-1.0.0.exe`

   **macOS:**
   ```bash
   yarn build:mac
   ```
   Resultado: `dist/ContainerLogix-1.0.0.dmg`

   **Linux:**
   ```bash
   yarn build:linux
   ```
   Resultado: `dist/ContainerLogix-1.0.0.AppImage`

---

## Estrutura do Projeto

```
/app/desktop/
├── main.js              # Arquivo principal do Electron
├── preload.js           # Script de pré-carregamento
├── package.json         # Configurações e dependências
├── icon.png            # Ícone do aplicativo
├── README.md           # Documentação completa
└── install.sh          # Script de instalação automática
```

---

## Características do Desktop

### ✨ Funcionalidades Exclusivas

- **Aplicativo Nativo**: Não precisa de navegador
- **Menu Customizado**: Menu nativo com atalhos
- **Tela Cheia**: Modo tela cheia com F11
- **Zoom**: Controle de zoom com Ctrl+/Ctrl-
- **Performance**: Otimizado para desktop

### 📊 Funcionalidades do Sistema

Todas as funcionalidades da versão web estão disponíveis:

- ✅ Dashboard com estatísticas
- ✅ Cadastro de movimentações
- ✅ Edição e visualização
- ✅ Gestão de motoristas
- ✅ Gestão de transportadoras
- ✅ Gestão de armadores
- ✅ Relatórios PDF (paisagem)
- ✅ Relatórios Excel
- ✅ Impressão de comprovantes
- ✅ Busca e filtros avançados

---

## Solução de Problemas

### O aplicativo não abre no Windows
- Verifique se você tem permissões de administrador
- Execute como administrador (botão direito > Executar como administrador)

### Erro de certificado no macOS
- Abra Preferências do Sistema > Segurança
- Clique em "Abrir Mesmo Assim"

### Linux: AppImage não executa
```bash
chmod +x ContainerLogix-1.0.0.AppImage
./ContainerLogix-1.0.0.AppImage
```

---

## Configuração Avançada

### Mudar URL do Servidor

Edite `main.js` e altere:
```javascript
const APP_URL = 'https://seu-servidor.com';
```

Depois rebuild:
```bash
yarn build
```

---

## Atualizações

Para atualizar o aplicativo:

1. Baixe a nova versão
2. Desinstale a versão antiga (opcional)
3. Instale a nova versão

Seus dados estão salvos no servidor, então não serão perdidos.

---

## Requisitos de Sistema

| Componente | Mínimo | Recomendado |
|------------|--------|-------------|
| SO | Windows 10 / macOS 10.13 / Linux | Windows 11 / macOS 12+ |
| RAM | 4 GB | 8 GB |
| Disco | 200 MB | 500 MB |
| Resolução | 1024x768 | 1920x1080 |

---

## Suporte

📧 Email: suporte@jalogistica.com.br
🌐 Website: www.jalogistica.com.br

---

**© 2026 J.A Logística - Todos os direitos reservados**
