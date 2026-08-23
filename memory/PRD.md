# ContainerLogix - Sistema de Gestão de Movimentação de Contêineres

## Descrição do Produto
Sistema completo de entrada, saída e inventário de contêineres para empresas de logística portuária.

## Funcionalidades Principais

### Core (Implementado ✅)
- **Movimentações**: Registrar, editar, clonar movimentações de contêineres
- **Fotos**: Upload de fotos (frente, traseira, lados) para cada movimentação
- **Observações**: Campo de observações em cada movimentação
- **Entidades**: CRUD completo para Motoristas, Transportadoras, Armadores, Clientes, Tipos de Serviço
- **Dashboard**: Métricas e atalhos personalizáveis
- **Relatórios**: Exportação Excel para movimentações e faturamento
- **Faturamento**: Módulo completo com histórico de alterações
- **Comprovante de Impressão**: Layout A4 com 2 vias (Terminal/Motorista) por página
- **Recuperação de Senha**: Via email com Resend
- **Registro Fotográfico**: Módulo completo para registro de fotos de contêineres ✅
- **Vistoria de Container**: Similar ao registro fotográfico com observações ✅
- **Flex Tank**: Gerenciamento de estoque de bolsas Flex Tank ✅
- **Controle de Pátio**: Visualização de containers no pátio com dias de permanência ✅
- **Frota (Fleet)**: Controle de revisão de veículos com PDF ✅

### Registro Fotográfico (Implementado 04/03/2026) ✅
- CRUD completo para registros fotográficos (criar, listar, visualizar, editar, excluir)
- **Campos:**
  - Número do Container (obrigatório)
  - Numeração do Container (lacre)
  - Terminal de Coleta
  - Booking
  - Cliente (dropdown com busca)
  - Armador (dropdown com busca)
- Upload de 4 fotos: Frente, Traseira, Lateral Esquerda, Lateral Direita
- **Layout diferenciado:**
  - Frente e Traseira: formato horizontal (landscape) - mais amplo
  - Laterais: formato vertical - com altura adequada
  - Fotos com `object-fit: contain` para visibilidade completa
- Captura de foto via câmera ou importação de arquivo
- **Download de fotos** individualmente
- **Página de edição** para alterar dados do registro
- Visualização PDF para impressão com metadados (usuário, data criação, data emissão)
- Numeração sequencial automática

### Autenticação
- JWT-based authentication
- Perfis de usuário

## Stack Técnica
- **Frontend**: React, TailwindCSS, Shadcn/UI, lucide-react
- **Backend**: FastAPI, Python
- **Database**: MongoDB
- **Integrações**: openpyxl (Excel), JsBarcode, Resend (email)

## Estrutura de Arquivos Principais
```
/app/
├── backend/
│   ├── server.py        # API principal
│   ├── models.py        # Modelos Pydantic
│   └── reports.py       # Geração de relatórios
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── MovementDetailPage.js  # Detalhes + impressão
│       │   ├── NewMovementPage.js
│       │   ├── EditMovementPage.js
│       │   ├── BillingPage.js
│       │   ├── PhotoRegistriesPage.js     # Lista de registros fotográficos
│       │   ├── NewPhotoRegistryPage.js    # Novo registro fotográfico
│       │   ├── PhotoRegistryDetailPage.js # Detalhes + impressão
│       │   └── ...
│       └── components/
```

## Histórico de Alterações Recentes

### 23/08/2026 (Sessão Atual)
- **Auditoria completa e correções de segurança/performance/bugs ✅**
  - Backend: path traversal no delete de upload, validação de tipo/tamanho de arquivo faltando em 2
    endpoints, CORS permissivo (`*` com credentials), sem rate limiting em login/forgot-password,
    numeração sequencial (status/segregação/RPA/OS) com risco de duplicidade sob concorrência, corte
    silencioso de dados em relatórios/dashboard (`to_list(10000)` fixo), `JWT_SECRET_KEY` gerava
    chave aleatória se não configurada (invalidava tokens a cada restart), WebSocket não revalidava
    usuário removido, ~13 buscas com regex sem `re.escape` (quebra com caractere especial/ReDoS)
  - Frontend: autocomplete que não fechava em 2 telas, filtro de motorista quebrava com `driver_name`
    nulo, WebSocket duplicado (3 conexões simultâneas → 1 só via `WebSocketProvider` compartilhado),
    componente `Autocomplete` extraído (estava copiado em 4 páginas), confirmação de exclusão
    padronizada (`useConfirm` em vez de `window.confirm()`), compressão de imagem no upload de fotos
  - **`backend/server.py` dividido em `backend/routers/` por domínio** (~8000 linhas → 186 linhas +
    16 módulos de ~200-1600 linhas cada + `backend/shared.py` com infra comum). Verificado com
    `pyflakes` + import dinâmico (170 rotas confirmadas, nenhuma perdida).

- **Gestão de Usuários ✅** (`backend/routers/users.py`, `frontend/src/pages/UsersPage.js`)
  - Admin pode promover/rebaixar (admin↔operador) e ativar/desativar acesso de qualquer usuário,
    sem apagar o cadastro. Protegido contra remover o último admin ou autodesativar-se.
  - `User.active: bool` novo campo; `get_current_active_user`/login checam isso.

- **Módulos Contratados ✅** (`backend/routers/module_config.py`, `frontend/src/pages/ModulesPage.js`)
  - Campo `User.is_superadmin` (só setável direto no banco, nunca via API/UI) controla quem pode
    liberar/bloquear grupos ou itens do menu para o cliente desta instância — pensado para o modelo
    de negócio "uma instância por cliente" (ver `provisioning/provision_client.py`).
  - Travado em 2 camadas: menu esconde (`ModuleConfigContext` + `Layout.js`) e `module_gate_middleware`
    em `server.py` bloqueia a API mesmo se alguém chamar a rota direto.

- **Deploy em produção pela primeira vez ✅**
  - Frontend: Vercel (projeto `frontend`, time `vitecinfortec-5654s-projects`), domínio próprio
    `containerlogix.com.br` (+ `www`), Root Directory = `frontend`, `vercel.json` força `CI=false`
    (senão o build trava por warning de lint pré-existente). Deploy automático a cada push no GitHub.
  - Backend: Render (serviço `Sistema-ContainerLogix`, plano Free), `sistema-containerlogix.onrender.com`.
    Free tier "dorme" após inatividade (~50s de delay no primeiro acesso) — upgrade pra Starter
    (~$7/mês) remove isso, recomendado se for usar como produto de verdade.
  - Banco: MongoDB Atlas, cluster `cluster0.xt2husn.mongodb.net`, banco `containerlogix`, usuário
    `containerlogix`, acesso de rede liberado para `0.0.0.0/0` (Render não tem IP fixo no plano free/starter).
  - DNS do domínio movido de Cloudflare para o próprio Registro.br ("Configurar zona DNS" / modo avançado).
  - **Service worker corrigido** (`frontend/public/service-worker.js`): era cache-first "para sempre"
    em HTML/JS/CSS — depois de um deploy novo, o navegador continuava servindo a versão antiga
    indefinidamente (só resolvia limpando cache manual). Trocado para network-first com fallback pro
    cache só quando offline de verdade; também corrigida a lista de pré-cache (referenciava nomes de
    arquivo sem hash que não existem no build, fazia a instalação do SW falhar silenciosamente).
  - Instalador Windows também gerado (`desktop/dist/ContainerLogix-Setup-1.0.0.exe`) — canal de
    distribuição separado do deploy web, para uso offline no pátio.

- **Provisionamento automatizado para vender o sistema ✅** (`provisioning/provision_client.py`)
  - Decisão de arquitetura: em vez de multi-tenant (schema único + `company_id` em tudo, exigiria
    auditar ~170 endpoints), optou-se pelo modelo "uma instância isolada por cliente" (mesmo repo,
    banco/backend/frontend próprios) — mais simples e mais seguro contra vazamento entre clientes,
    ao custo de precisar administrar cada instância separadamente.
  - Script automatiza: banco novo no mesmo cluster Atlas, projeto novo na Vercel (via API REST,
    incluindo desativar proteção SSO que trava o acesso público), serviço novo no Render (via API
    REST), e conecta as duas pontas (CORS_ORIGINS ↔ REACT_APP_BACKEND_URL).
  - As chamadas HTTP do script usam `curl` via `subprocess` em vez da lib `requests` — nesta máquina,
    o Python não fecha o handshake TLS com `api.render.com`/`api.vercel.com` (`SSLEOFError`), mas
    `curl` (via SChannel do Windows) funciona normalmente para os mesmos hosts.
  - **Testado ponta a ponta só o lado Vercel** (criou projeto de teste descartável, funcionou, foi
    apagado depois). O lado Render não foi testado de verdade — a conta exige cartão cadastrado até
    para o plano Free (bloqueou com 402); vai ser validado no primeiro cliente real (que usaria plano
    Starter pago mesmo, então não é um bloqueio pra uso real).
  - **Pendência:** domínio custom por cliente e ativação do primeiro admin de cada instância nova
    ainda são passos manuais (documentados no output do próprio script).

- **Zoho Mail (e-mail profissional `@containerlogix.com.br`) — em andamento, não concluído**
  - Plano Standard (pago) contratado. Verificação de domínio parada na etapa de adicionar o registro
    TXT `zoho-verification=zb75259253.zmverify.zoho.com` no Registro.br — a zona DNS ficou "em
    transição" (~1h33min de espera) depois da troca de nameservers Cloudflare→Registro.br feita na
    mesma sessão. Retomar em "Configurar zona DNS" no painel do domínio quando o aviso de transição sumir.

- **Problema não resolvido: layout mobile "modo desktop" mesmo em navegador real**
  - Investigado a fundo (não era "Site para computador" do navegador, nem bug nas classes Tailwind
    `hidden md:flex`/`md:hidden` — confirmado que o CSS publicado está correto). Suspeita forte é o
    cache antigo do Service Worker (corrigido nesta sessão, ver acima) — não foi reconfirmado pelo
    usuário depois do fix. Se voltar a acontecer, descartar a teoria do Service Worker e investigar
    de novo (configuração de DPI/zoom do aparelho Android específico, talvez).

### 26/07/2026 (Sessão Atual)
- **Checklist de Avarias na Vistoria de Container ✅**
  - Campos `no_damage` (bool) e `damage_items` (lista) no modelo `ContainerInspection`
  - Checkbox "Container sem avarias" ou seleção de itens (lista sugerida + personalizados)
  - Badges coloridos (verde/vermelho) na tela de detalhe e no layout de impressão
  - Arquivos: `backend/models.py`, `backend/server.py`, `frontend/src/lib/inspectionItems.js`,
    `NewContainerInspectionPage.js`, `EditContainerInspectionPage.js`, `ContainerInspectionDetailPage.js`
  - Testado manualmente (criar, editar, alternar "sem avarias") rodando backend+frontend localmente

- **Rebranding: logo local + menu Financeiro/Terminal ✅**
  - Logo trocado de URL externa (Emergent) para arquivo local `frontend/public/logo-containerlogix.png`
  - Menu "Faturamento" renomeado para "Financeiro"; "Flex Tank" agrupado sob novo grupo "Terminal"

- **App Desktop: reempacotado como standalone (Python + MongoDB embutidos) ✅**
  - Instalador Windows agora embute runtime Python portátil + MongoDB portátil (via `extraResources`
    do electron-builder) — não depende mais de nada pré-instalado na máquina do usuário
  - `desktop/lib/`: novos módulos (`backendProcess.js`, `mongoProcess.js`, `paths.js`,
    `staticServer.js`, `config.js`) orquestram os processos e servem o build do React
  - Backup/restauração automática (mongodump + uploads) numa pasta do Google Drive escolhida
    pelo usuário no primeiro uso; menu "Arquivo" tem backup manual e troca de pasta
  - `backend/requirements-desktop.txt`: subconjunto mínimo de dependências de runtime
  - `frontend/src/index.js`: força novo login e ignora cache do Service Worker de PWA dentro do Electron
  - Removida dependência não utilizada `emergentintegrations` de `requirements.txt`

- **Nota de ambiente:** a instalação local do Python 3.11 nesta máquina estava com o módulo
  stdlib `tempfile.py` corrompido/ausente (impedia até o `pip` de funcionar). Corrigido reinstalando
  o Python oficial (python.org) e restaurando o arquivo a partir do código-fonte oficial do CPython.
  Se `pip`/venv derem erro estranho novamente nesta máquina, verificar isso primeiro.

- **Pendência aberta:** `scripts_servico/*.bat` têm mudanças não commitadas trocando os caminhos
  de `I:\...` / usuário `victo` para `G:\...` / usuário `joaov` — parece ser artefato de edição
  em outra máquina sincronizada pelo mesmo Google Drive. Não commitado; decidir com o usuário como
  lidar com scripts que têm caminho de máquina hardcoded num repo compartilhado por Drive entre
  máquinas diferentes.

### 11/03/2026 (Sessão Anterior)
- **Novo Módulo "Segregação de Unidade" ✅**
  - Backend: modelo UnitSegregation, endpoints CRUD, geração de PDF
  - Frontend: página completa com listagem, filtros, modais de criar/editar/detalhes
  - Menu lateral: sub-item em "Movimentações"
  - Controle de Pátio: badge "SEGREGADO" para containers reservados
  - Funcionalidades: criar, editar, liberar, excluir, gerar PDF, filtrar por status

### 10/03/2026 (Sessão Anterior)
- **Novo Campo "Entrega Finalizada" no Status de Entrega ✅**
  - Campo `delivery_completed` adicionado ao modelo `DeliveryStatusItem` (backend/models.py)
  - Nova coluna "ENTREGA" no PDF (12 colunas total, ainda cabe em 1 página)
  - Formulário atualizado com grid de 6 colunas (frontend)
  - Tabela de detalhes com nova coluna "Entrega Final."

### 09/03/2026 (Sessão Anterior)
- **Finalização do PDF Status de Entrega ✅**
  - Layout ajustado para corresponder exatamente ao PDF de "Programação de Carregamento"
  - Tabela de dados agora usa largura total de 700px (igual à referência)
  - Cabeçalho da tabela alterado para fundo verde (PRIMARY_GREEN) em vez de cinza
  - Espaçamentos padronizados (padding 5-10px nas seções)
  - Headers de coluna simplificados (texto simples em vez de Paragraph)
  - PDF gerado em página única (verificado via PyPDF2)
  - Seção de observações com estilo consistente

### 08/03/2026 (Sessão Anterior)
- **Verificação: Filtro "Estoque Atual" no Controle de Pátio ✅**
  - Filtro movement_type=ESTOQUE funcionando corretamente
  - Retorna apenas containers com in_stock=true
  - Ajustado para mostrar containers que ESTAVAM em estoque no período
  - Containers que entraram DEPOIS do período final não aparecem
  - Dias no pátio calculados dentro do período selecionado
  - Testes: 100% backend (7/7), 100% frontend

- **Verificação: Bug da Página em Branco na Impressão ✅**
  - CSS de impressão verificado em index.css
  - Comprovante de movimentação renderiza sem página em branco

- **Ajuste de Estilos - Página Flex Tank ✅**
  - Tamanhos de fonte padronizados igual à página de Movimentações
  - Headers em uppercase, botões menores, espaçamentos consistentes

- **NOVO MÓDULO: Status de Entrega ✅**
  - Sub-item criado em "Operacional" abaixo de "Programação de Carregamento"
  - Busca dados de uma Programação existente pelo número
  - Campos de horário para cada motorista:
    - Chegada no Cliente
    - Início de Carregamento
    - Término do Carregamento
    - Saída do Cliente
  - Geração de PDF com layout igual ao da Programação de Carregamento
  - Backend: 12/12 testes passaram
  - Frontend: 100% funcional
  - Arquivos criados:
    - backend/models.py: DeliveryStatus, DeliveryStatusItem, DeliveryStatusCreate, DeliveryStatusResponse
    - backend/server.py: endpoints /api/delivery-status/*
    - frontend/src/pages/DeliveryStatusPage.js
    - frontend/src/lib/api.js: funções de API
    - frontend/src/components/Layout.js: menu atualizado
    - frontend/src/App.js: rota /delivery-status

### 07/03/2026 (Sessão Anterior)
- **Feature: Invoice Internacional (Completo) ✅**
  - Novo módulo para criar e gerenciar faturas internacionais
  - Multi-moeda: USD, EUR, BRL
  - CRUD completo: criar, listar, visualizar, atualizar status, excluir
  - Geração de PDF com layout profissional bilíngue (PT/EN)
  - Filtros por status e moeda
  - Autocomplete para clientes cadastrados
  - Formulário de itens dinâmico
  - Menu: Faturamento > Invoice Internacional
  - Rota: /international-invoices
  - Endpoints: /api/intl-invoices/*
  - Coleção MongoDB: intl_invoices
  - Testes: 100% backend (16/16), 100% frontend

- **Feature: Edição de Invoice Internacional ✅**
  - Botão de editar (ícone lápis) na lista de invoices
  - Modal de edição com todos os campos preenchidos
  - Endpoint PUT /api/intl-invoices/{id}
  - Validação de formulário antes de salvar
  - Atualização automática da lista após salvar

- **Feature: PDF com Layout Padrão ✅**
  - PDF de Invoice Internacional atualizado para usar o layout padrão da empresa
  - Inclui: Header com logo J.A Logística, cores corporativas, tabela de itens
  - Badge de status colorido, informações de recebedor/pagador
  - Função generate_intl_invoice_pdf em reports.py

### 06/03/2026 (Sessão Anterior)
- **Bug Fix: CSS de Impressão ✅**
  - Melhorado regras `@media print` no `index.css`
  - Adicionado reset do container `#root` e elementos com `data-testid`
  - Implementado `position: absolute` para elementos ocultos na impressão
  - Adicionado propriedades `break-after` e `break-inside` para melhor controle de quebra de página
  - Correção previne página em branco antes do conteúdo impresso

- **Bug Fix: Motoristas sem `created_at` ✅**
  - Corrigido erro no endpoint `/api/drivers` quando motoristas não tinham campo `created_at`
  - Adicionado motoristas com nomes completos ao banco de dados:
    - CARLOS GILBERTO DE PAIVA ROCHA
    - CRISTIANO MARINHO FEIJO
    - DANIEL ATILA ANDRADE DE OLIVEIRA
    - DJAELSON MARINHO MARINHO DE SOUSA
    - ROBENSON BRANDÃO DE ABREU
    - FRANCISCO DE SOUSA DOS SANTOS

- **Verificação: Autocomplete de Motoristas ✅**
  - Confirmado que o componente Autocomplete na Programação de Carregamento funciona corretamente
  - Nomes completos são exibidos no dropdown e salvos no banco de dados

### 06/03/2026 (Sessão Anterior)
- **Feature: Layout do PDF de Revisão da Frota ✅**
  - Redesenhado o PDF de revisão para seguir o layout profissional dos outros documentos
  - Inclui: logo da empresa, cores corporativas, tabelas formatadas

- **Feature: Cadastro de Veículos/Equipamentos ✅**
  - Nova aba "Cadastro de Veículos" no módulo Frota
  - Campos: Placa, Tipo, Marca, Modelo, Ano, Status, Observações
  - CRUD completo com endpoints `/api/vehicles`

- **Feature: Menu Frota Reorganizado ✅**
  - Menu lateral com sub-itens: Cadastro de Veículos, Controle de Revisão
  - Abas removidas da página (navegação só pelo menu)

- **Feature: Formulário de Revisão Diferenciado ✅**
  - Select "Tipo de Veículo" (Cavalo Mecânico / Carreta)
  - Cavalo: formulário completo com filtros, óleos e próximas revisões
  - Carreta: formulário simplificado (Placa, Modelo, Tipo de Revisão, Observação, Mecânico)

- **Feature: Módulo Operacional - Programação de Carregamento ✅**
  - Nova aba "Operacional" no menu lateral
  - Sub-item "Programação de Carregamento"
  - Cabeçalho: Cliente Contratante e Cliente Destino
  - Itens com: Motorista, CPF, Cavalo, Carreta, Local, Data, Nº Container
  - Selects puxam dados de cadastros existentes (motoristas, veículos, clientes)
  - Botão "Adicionar Item" para múltiplas programações
  - CRUD completo e geração de PDF
  - Arquivos: LoadingSchedulePage.js, endpoints `/api/loading-schedules`

### 05/03/2026 (Sessão Anterior)
- **Feature: Flex Tank - Funcionalidade de Edição ✅**
  - Adicionado botão "Editar" (ícone lápis) na coluna de ações da listagem de movimentações
  - Funcionalidade completa: clicar editar → formulário pré-preenchido → salvar alterações → redireciona para detalhes
  - Testes: 100% backend (8/8), 100% frontend (todos passaram)
  - Arquivo modificado: `FlexTankPage.js` (adicionado botão e import do ícone Pencil)

- **Feature: Controle de Pátio (Yard Control) ✅**
  - Nova página `/yard-control` listando containers no pátio
  - Cálculo de "Dias no Pátio" (dwell time)
  - Cards com métricas (total, média/máximo dias)
  - Tabelas de resumo por Cliente e Armador
  - Funcionalidade "Saída Rápida" via modal

- **Feature: Frota (Fleet Management) ✅**
  - Novo módulo "Frota" com sub-página "Controle de Revisão"
  - CRUD completo para revisões de veículos
  - Campos: veículo, modelo, óleo, km, mecânico, próxima revisão por item
  - Geração de PDF para impressão

### 04/03/2026 (Sessão Anterior)
- **Feature: Flex Tank (Módulo Completo) ✅**
  - Dashboard com estoque total, entradas e saídas
  - Lista de movimentações com filtros (data, cliente, tipo, número)
  - CRUD completo: criar, visualizar, editar, excluir movimentações
  - Relatórios com estoque por cliente e por tamanho
  - Download de relatório Excel

- **Feature: Vistoria de Container ✅**
  - Baseado no Registro Fotográfico
  - Adicionado campo "Observações" e foto "Interno"
  - Layout de impressão personalizado

- **Feature: Registro Fotográfico - Melhorias de Layout**
  - Layout reorganizado: Frente/Traseira (horizontal, maior) e Laterais (vertical, altura ajustada)
  - Fotos com `object-fit: contain` para visibilidade completa sem corte
  - Adicionado botão "Baixar" para download individual de cada foto
  - Criada página de edição (`EditPhotoRegistryPage.js`)
  - Adicionada rota `/photo-registries/:id/edit` no App.js

- **Feature: Registro Fotográfico (Base)**
  - Criada integração no Router (`App.js`) - rotas `/photo-registries`, `/photo-registries/new`, `/photo-registries/:id`
  - Adicionado link na sidebar (`Layout.js`) com ícone Camera
  - Bug fix: `KeyError: 'id'` - corrigido para usar `current_user['sub']`
  - Bug fix: Dashboard datetime comparison - `parse_datetime_value` agora garante timezone-aware
  - Testes: 100% backend (12/12), 100% frontend (8/8)

### 03/03/2026 (Sessões Anteriores)
- **Bug fix: Autocomplete de Clientes**
  - Corrigido problema onde clicar em um cliente no dropdown não o selecionava
  - Solução: Trocado `onClick` por `onMouseDown` com `e.preventDefault()` em `EditMovementPage.js`
- Implementação do autocomplete de clientes
- Ajuste do layout de impressão conforme modelo PDF do usuário
- Correção de precisão monetária (floating-point fix)
- Correção de parsing de datas (datetime objects vs ISO strings)

## Tarefas Pendentes

### P0 - Crítico
- [x] Registro Fotográfico (Completo)
- [x] Vistoria de Container (Completo)
- [x] Flex Tank - CRUD completo incluindo edição (Completo)
- [x] Controle de Pátio (Completo)
- [x] Frota - Controle de Revisão com PDF (Completo)
- [x] Ajuste do layout do PDF de Revisão da Frota (Completo)
- [x] Cadastro de Veículos/Equipamentos (Completo)
- [x] Correção dos nomes truncados nos motoristas (Completo)
- [x] Correção CSS de impressão para páginas em branco (Completo - Verificado 08/03/2026)
- [x] Invoice Internacional (Completo - 07/03/2026)
- [x] Filtro "Estoque Atual" no Controle de Pátio (Completo - Verificado 08/03/2026)
- [x] Deploy para produção (Verificado - 08/03/2026)
- [x] Status de Entrega - PDF com layout igual ao da Programação (Completo - 09/03/2026)

### P1 - Alta Prioridade
- [x] Verificar bug da página em branco na impressão do recibo de movimento (CSS corrigido - Verificado 08/03/2026)
- [x] Otimizar queries do banco de dados (Completo - 23/08/2026: dashboard, controle de pátio e
      relatórios de estoque não trazem mais a coleção inteira de movimentações para o Python)

### P2 - Backlog
- [x] Refatorar server.py em APIRouters separados (Completo - 23/08/2026: 186 linhas + 16 módulos
      em backend/routers/)
- [x] Extrair componente de autocomplete reutilizável (Completo - 23/08/2026)
- [x] Gerar instalador Windows (Completo - 26/07/2026: ContainerLogix-Setup-1.0.0.exe via
      electron-builder, standalone com Python/MongoDB embutidos - formato .exe, não .msi)
- [ ] Gerar aplicativo Android (.apk)
- [x] Remover motoristas duplicados do banco de dados (Verificado - 23/08/2026: checado em produção,
      não há duplicatas reais - item já não se aplicava)
- [ ] Ativar rate limiting em endpoints adicionais além de login/forgot-password, se necessário
- [x] Numeração sequencial (status/segregação/RPA/OS) com risco de duplicidade sob concorrência
      (Completo - 23/08/2026: movimentações, status de entrega, segregação de unidade e programação
      de carregamento já usavam contador atômico via `db.counters`; RPA e OS já tinham a criação
      atômica também, só os endpoints de "prévia do próximo número" (`/rpa-terceiro/next-number` e
      `/ordem-servico/next-number`) ainda liam "buscar último + 1" - corrigido pra ler do mesmo
      contador atômico, evitando prévia dessincronizada sob concorrência)

## Credenciais de Teste
- Email: joao.victor@jalogisticas.com
- Senha: password123

## URLs
- Preview: https://container-mvmt-sys.preview.emergentagent.com
- Produção: https://container-flow-ops.emergent.host (atualmente offline)
