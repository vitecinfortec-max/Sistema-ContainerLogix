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

### 14/10/2026 a 17/10/2026 (Sessão Atual) - Auditoria grupo a grupo do menu
Cada grupo do menu foi revisado de ponta a ponta (backend, telas e regras de negócio), com um commit
e um arquivo de testes por grupo (`backend/tests/test_<grupo>.py`). Padrões aplicados em todos:
lista sem corte, campo apagado na edição grava vazio, cadastro Inativo/Bloqueado fora das telas de
lançamento novo (mas visível na edição), exclusão bloqueada quando o registro está em uso (com a
sugestão de mudar para Inativo), duplicados recusados, filtros aplicados enquanto se digita.

- **Interface e geral (14-15/10) ✅**
  - Skeleton de carregamento nas listas, aria-labels nos botões só com ícone, variantes de modo
    escuro em 26 badges, menos animação decorativa, uma política única de movimento reduzido
  - Telas em branco corrigidas (Ordem de Serviço, Contrato de Frete, Ordem de Carregamento)
  - EIR: status de rascunho no cabeçalho e erro por campo obrigatório; barra de salvar fixa no celular
  - Gate com coluna Container e colunas ordenáveis; navegação por teclado nas sugestões
  - Dashboard ordenado por urgência (alertas no topo); botão "Filtrar" removido de 12 listas
  - Menu e cabeçalho não recarregam a cada tela; cenas 3D só carregam quando aparecem na tela
  - **Horário de Brasília em todo o sistema** (itens apareciam 3 horas adiantados): backend, PDFs e
    datas padrão do frontend
- **Manutenção ✅**
  - OS canceladas não entram mais no "Valor total" nem no valor médio (tela de OS, Relatório de
    Serviços, gráfico, PDF e Excel)
  - Hodômetro: lista em ordem da data da leitura (era a hora do cadastro); leituras de Abastecimento
    mostram "Abast. #N" (o número repetia o do lançamento manual); "KM atual" usa o maior KM lançado,
    não o último cadastrado
  - Revisão: editar não ignora mais campos apagados e grava a data no mesmo formato do cadastro
  - Controle de Revisão: indicadores, coluna "Situação do veículo" e botão Editar (o backend já
    permitia, a tela não)
  - Hodômetro: filtro por placa e origem, edição de lançamento manual, "Próximo item" que vence,
    "vencido há X km" e mais urgentes primeiro
  - Relatório de Serviços: tabela das OS do filtro; gráfico renomeado para "Valor de serviços por dia"
  - Formulário de Revisão no padrão dos demais; itens de menu "Checklist de Veículo" e "Categorias de
    OS" iguais aos títulos das telas
- **Abastecimento ✅**
  - Nível do Tanque: recargas acima da capacidade mostram "Acima da capacidade" (antes "Nível OK"),
    com aviso no medidor; o diálogo mostra o espaço livre e pede confirmação se passar dele
  - Abastecimento do Tanque Próprio não exige mais Fornecedor (nem mostra Cidade/UF)
  - Histórico do tanque: saídas mostram "Abast. #N" (numeração diferente das recargas) e coluna de
    saldo após cada movimento
  - Relatórios de Abastecimento e de Serviços: filtro de Equipamento/Fornecedor por trecho (com o
    filtro automático, a placa incompleta zerava a lista)
  - Abastecimento: filtros de período e fonte; coluna da Ordem vinculada
  - Ordem de Abastecimento: filtro de situação (Pendente/Lançada) e coluna "Autorizado"
    (litros/valor/tanque cheio)
  - Relatório de Abastecimento: tabela dos abastecimentos do filtro e filtro de fonte
  - Nível do Tanque: botão "Configurar tanque" para administradores
- **Transporte ✅**
  - Veículo, Contrato de Frete e Ordem de Carregamento: campo esvaziado na edição agora é apagado
    (antes o valor antigo voltava)
  - Pagamento Frete: lançamento Pago que volta pra Pendente sai da Ordem de Pagamento (recibo e total
    refeitos; ordem vazia é apagada); seleção zerada ao filtrar e ações só sobre o que está visível;
    marcar pago só atinge lançamentos ainda pendentes
  - Ordem de Carregamento: excluir uma ordem aprovada cancela o frete pendente; editar uma ordem
    aprovada atualiza valor/motorista/rota do lançamento pendente; filtros de status, tipo e período;
    busca por Nº, booking e cliente
  - Filtros de período (Pagamento Frete, Contrato de Frete) no dia de Brasília
  - Cadastro de Veículo: indicadores, filtros de tipo/status e coluna Documentos com
    CRLV/licenciamento/tacógrafo/vistoria vencidos ou a vencer
  - Contrato de Frete: indicadores e filtro de período pela data do contrato
  - Rota: filtro de status, ordem alfabética, rota já usada não é excluída
- **Terminal ✅**
  - **Estoque Atual**: container está no pátio quando a última movimentação dele é uma ENTRADA (regra
    única em `movements.in_stock_movements`). Antes contava entradas x saídas do histórico inteiro:
    uma entrada em dobro deixava o container no estoque pra sempre. Vale pro relatório (PDF/Excel),
    Controle de Pátio, Dashboard e Auditoria
  - Registro Fotográfico: fotos enviadas em paralelo não se apagam mais (`$push` com limite /
    `$pull`); Vistoria também passa a usar `$pull` e limite
  - Flex Tank: filtro De/Até da lista e do Excel comparava data com texto (não trazia nada); agora
    pelo dia da movimentação, extremos inclusive
  - Editar EIR: trocar container ou tipo passa pela trava de duplicidade
  - Editar Segregação: container já segregado pra outro cliente é bloqueado
  - Auditoria: status/observação/foto alteram só o item, sem regravar a lista
  - Relatório de Movimentação: prévia na tela (totais + tabela paginada) com as mesmas linhas do
    PDF/Excel
- **Operacional ✅**
  - Faturamento Portuário: fatura cancelada não pode ser reaberta (os serviços já foram liberados e
    podiam ser cobrados 2x); a tela trava o status e confirma antes de cancelar
  - Serviço Portuário faturado: não pode ser excluído nem ter valor/cliente trocados sem cancelar a
    fatura (os demais campos seguem editáveis)
  - Status de Entrega: um por Programação (salvo se o outro foi cancelado); excluir o Status devolve a
    Programação pra Ativa; Programação com Status de Entrega não pode ser excluída
  - update-status: repetir o mesmo status não responde mais "não encontrado"
  - Programação: indicadores, filtro de status e Cancelar/Reativar (a tela chamava uma rota
    inexistente)
  - Serviço Portuário: indicadores, filtros de período/turno/situação/faturado e coluna Fatura (Nº)
  - Status de Entrega: indicadores e busca por cliente/motorista/container
- **Financeiro ✅**
  - Faturas: cancelar devolve as movimentações e é definitivo (sem reabrir nem editar); excluir só
    desfatura o que ainda é da fatura; buscas de fatura ignoram as canceladas; filtro de Status e
    indicadores por status
  - Removida a rota `POST /billing/report` (marcava como faturado sem fatura); aviso claro para
    movimentação faturada sem fatura ativa
  - Status repetido não dá mais 404 (Invoice Internacional, Diária, Prestação de Contas)
  - Prestação de Contas concluída não aceita anexar/remover recibo
  - Solicitação de Diária: edição só quando pendente, valores negativos e lista vazia recusados,
    atualização dos itens corrigida, ações em lote com `Promise.allSettled`
  - Invoice Internacional: itens validados, totais arredondados, número reservado depois da
    validação, cancelada não é editável
  - Relatório de Faturamento: prévia na tela com indicadores e validação de período
- **Cadastro ✅**
  - Clientes/Fornecedores/Funcionários/Terminais/Seguradoras devolvem todos os registros (antes
    cortava em 100 e cliente antigo sumia das telas)
  - CNPJ/CPF repetido recusado em todos os tipos (comparando só dígitos) e nome de cliente repetido
    recusado
  - Excluir cadastro em uso é bloqueado, dizendo onde está em uso e sugerindo Inativar
  - Renomear cliente atualiza Tabela de Serviços e Vínculos de Representante (aviso na tela:
    EIRs/faturas antigos mantêm o nome)
  - Inativo/Bloqueado somem das telas de lançamento novo (EIR, Vistoria, Registro Fotográfico); EIR
    novo recusa cliente/motorista Bloqueado
  - Dados da Empresa grava só os campos enviados (`$set`, não replace)
  - Tela Cadastro: filtro de Status, busca por números e Nome Fantasia, troca rápida de tipo sem
    mostrar a lista do tipo anterior, motivo do erro ao excluir
  - Motoristas: coluna Validade CNH e aviso de CNH vencida/vencendo
- **Comercial ✅** (`routers/commercial.py`)
  - Relatório de Comissão: R$ e US$ em totais separados (antes o dólar entrava somado no real),
    período em dias de Brasília, data inicial depois da final vira aviso, prévia na tela
    (`GET /reports/commission`)
  - Status Ativo/Inativo editável na Tabela de Serviços e no Vínculo; editar não reativa sozinho
  - EIR (novo e edição) só preenche o valor com preço Ativo de cobrança única (nunca a Diária de
    Armazenagem), sem diferenciar maiúsculas; preço único ativo duplicado pro mesmo serviço/cliente
    recusado
  - Representante em uso não pode ser excluído; renomear atualiza os vínculos
  - Validação na API: valor/free time negativo, comissão fora de 0-100%, moeda só BRL/USD, proposta
    sem itens/valor negativo/validade < 1 (o número só é reservado depois de validar)
  - Proposta Comercial: situação Em aberto/Aceita/Recusada com filtro e ações na barra, etiqueta
    Vencida/Vence em Xd; editar mantém a situação
  - Vínculo/Tabela: nome digitado sem escolher da lista não salva o registro anterior; erros de
    exclusão mostram o motivo
- **Estoque ✅** (`routers/stock.py`, `routers/epi_deliveries.py`)
  - Nome repetido em Almoxarifado/Famílias e código de barras repetido no Produto recusados (o código
    de barras casa o item da NF-e com o produto)
  - Produto/serviço usado em OS, ou produto ainda com saldo, não pode ser excluído
  - Almoxarifado/Família digitado sem escolher da lista não grava mais o id anterior
  - Data da movimentação e da entrega de EPI validada; filtro de data e busca por Nº/produto/fornecedor
  - Exclusão da Entrega de EPI devolve o material uma vez só (atômica) e vai pra auditoria
  - Gráfico diário do relatório no horário de Brasília; extrato com código/almoxarifado nas entradas
    por NF-e; filtro de Status em Estoque e Produto
- **Gestão de Container ✅** (`routers/container_*.py`)
  - Excluir a venda devolve a compra para Disponível (antes ficava Vendida para sempre)
  - Vínculo compra↔venda atômico (duas vendas simultâneas pegavam a mesma compra)
  - Compra vendida não pode ser excluída nem trocar de container; excluir Ordem de Carregamento
    desfaz os vínculos antes de apagar
  - Recebido sem valor usa o Valor da Venda; valores negativos recusados
  - Representante: CPF/CNPJ duplicado, exclusão em uso, renomear propaga para vendas e ordens,
    Inativo recusado em venda nova
  - Script `backend/scripts/fix_container_purchases_sem_venda.py` (dry-run por padrão, backup em
    JSON com `--apply`) para devolver a Disponível as compras que ficaram Vendidas sem venda
- **Configurações/Admin ✅** (`routers/users.py`, `module_config.py`, `auth.py`)
  - **Trava de módulos segue o grupo do catálogo**: os itens de Abastecimento têm chave `frota.*`,
    então desativar Abastecimento não bloqueava nada (e desativar Manutenção bloqueava junto).
    `GET /module-config` passou a devolver `module_groups` pro menu usar a mesma regra
  - Login e recuperação de senha sem diferenciar maiúsculas/espaços no email
  - Conta do dono do sistema (`is_superadmin`) protegida do admin do cliente
  - Novo: editar nome/email e redefinir senha de um usuário (encerra as sessões dele)
  - Dados da Empresa: prefixo do Booking validado, logo aceito só como nome de arquivo
  - Configuração de Tanque: capacidade > 0 e alerta mínimo entre 0 e a capacidade
- **Rate limiting ✅** - ver item em Tarefas Pendentes > P2

### 23/08/2026 (Sessão Anterior)
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
- [x] Gerar aplicativo Android (Completo - 23/08/2026: projeto Capacitor já existia em
      frontend/android desde julho, mas estava desatualizado (build de 12/07) e com o módulo
      capacitor-cordova-android-plugins/build.gradle corrompido/vazio, quebrando o build - corrigido
      regenerando esse arquivo a partir do template do Capacitor CLI + restaurando o `apply from:
      'cordova.variables.gradle'` que faltava. APK release gerado com sucesso, assinado com o
      keystore já existente (containerlogix-release.keystore, válido até 2053), buildado apontando
      pra REACT_APP_BACKEND_URL=https://sistema-containerlogix.onrender.com. Login testado no
      aparelho real deu erro de rede persistente mesmo após liberar CORS - causa raiz real era o
      WebView do Capacitor usando `http://localhost` como origem (não `https://`, como assumido
      inicialmente) - corrigido no CORS_ORIGINS do Render. App também estava seguindo o tema
      escuro do sistema do celular (ThemeContext caía pra dark via prefers-color-scheme) e usando
      cores nativas genéricas do Capacitor (sem colors.xml próprio) - corrigido forçando tema claro
      dentro do Capacitor e criando um colors.xml com a paleta da marca.)
- [x] Remover motoristas duplicados do banco de dados (Verificado - 23/08/2026: checado em produção,
      não há duplicatas reais - item já não se aplicava)
- [x] Ativar rate limiting em endpoints adicionais além de login/forgot-password (Completo - 17/10/2026:
      limite geral por usuário/IP via middleware - gravações 300/min, uploads 120/min, relatórios
      PDF/Excel de período 30/min, PDF de um registro só (Vistoria, EIR, OS...) 300/min pro
      download em lote de dezenas de marcados não ser barrado; troca de senha 5 tentativas/15 min; IP real atrás do proxy do Render (antes todos
      dividiam o IP do proxy); limpeza das chaves antigas da memória)
- [x] Polimento visual do sistema, inspirado numa revisão do TRANSLEO/Bsoft TMS (Completo -
      23/08/2026):
      - Cores de destaque por grupo no menu lateral (Terminal/Frota/Cadastro/Financeiro/
        Operacional), usando os slots `--chart-1..5` do CSS (existiam só no tailwind.config.js,
        nunca foram definidos)
      - Corrigido bug achado nesse processo: itens de menu que só se diferenciam por query
        string (`/fleet` vs `/fleet?tab=revisions`) ficavam os dois marcados como ativos ao
        mesmo tempo - a comparação de rota ativa ignorava a query
      - Card "Alertas do Sistema" no dashboard (containers +30/60/90 dias no pátio, clicável,
        navega já filtrado)
      - `MovementsPage.js` definida pelo usuário como tela de referência "perfeita" - todas as
        outras páginas de listagem padronizadas contra ela (cabeçalho, card de filtro, tabela,
        badges, botões de ação): FleetPage, LoadingSchedulePage, ExpenseReportsPage,
        ContainerInspectionsPage, PhotoRegistriesPage (+ trocou AlertDialog cru por useConfirm),
        RPATerceiroPage (só cor - tirou o verde-esmeralda fora da marca, manteve o componente
        Table), DriversPage, ClientsPage, YardControlPage (1 badge). As telas de filtro
        adicionadas preservam a busca já existente (não inventaram campo novo).
- [x] Numeração sequencial (status/segregação/RPA/OS) com risco de duplicidade sob concorrência
      (Completo - 23/08/2026: movimentações, status de entrega, segregação de unidade e programação
      de carregamento já usavam contador atômico via `db.counters`; RPA e OS já tinham a criação
      atômica também, só os endpoints de "prévia do próximo número" (`/rpa-terceiro/next-number` e
      `/ordem-servico/next-number`) ainda liam "buscar último + 1" - corrigido pra ler do mesmo
      contador atômico, evitando prévia dessincronizada sob concorrência)

### Próximos passos (17/10/2026)
- [x] Rodar os testes novos e a suíte inteira, mais o build do frontend (Completo - 18/10/2026:
      testes novos passando; build com `CI=false yarn build` sem erros, só avisos de
      `react-hooks/exhaustive-deps` já existentes)
- [x] Commitar por grupo e fazer o push (Completo - 18/10/2026: Comercial, Estoque, Gestão de
      Container, Configurações/Admin e limite de requisições; o commit do Comercial estava preso num
      `main.lock` antigo e foi recuperado)
- [x] Limite de requisições não barra mais o download em lote de PDFs (Completo - 18/10/2026: PDF
      de um registro só tem limite próprio de 300/min; relatórios de período seguem com 30/min)
- [ ] Depois do deploy: rodar `fix_container_purchases_sem_venda.py` **em produção** (shell do
      Render, primeiro sem `--apply`). No banco local já rodou: nada a corrigir
- [x] Testes antigos (requests + `REACT_APP_BACKEND_URL`) voltaram a rodar sem servidor no ar
      (Completo - 18/10/2026: ponte em `tests/conftest.py` responde as chamadas pelo próprio app, com
      banco em memória por arquivo; testes da rota removida `/billing/report`, do campo legado
      `container_photos` e do caminho antigo `/uploads` atualizados; dados que eles esperavam no
      servidor agora são criados no próprio teste. `test_clients_api.py` chamava por padrão um
      servidor externo antigo (preview da Emergent) - corrigido. Suíte: 430 passando, 0 falhando,
      0 pulados)
- [x] `regex=` (descontinuado no FastAPI) trocado por `pattern=` em frota, vistorias e inspeções
- [x] Auditoria geral (Completo - 18/10/2026, `tests/test_auditoria_geral.py`):
      - Tanque Próprio: abastecimento não tira mais do que há no tanque (o nível ficava negativo);
        na edição conta os litros que o próprio lançamento já tirava; recarga só com litros > 0
      - Números negativos recusados (400, `refuse_negative` em shared.py) em Abastecimento, Ordem de
        Abastecimento, Serviço Portuário (abatia o faturamento), Rota de Frete, RPA (campos
        digitados; resultado/saldo/complemento/frete líquido calculados podem ser negativos), OS
        (leituras e itens), Hodômetro, Checklist, Revisão e alíquotas do Produto; `min="0"` nos
        campos dessas telas
      - Editar Abastecimento trocando para Tanque Próprio apaga fornecedor/cidade/UF; editar Ordem de
        Abastecimento trocando o modo apaga os litros/valor do modo anterior (os `null` eram
        descartados)
      - Veículo com histórico (hodômetro, revisão, checklist, abastecimento, ordem, OS, estoque) não
        é excluído - sugere Inativo; a tela mostra o motivo
      - Verificado sem problemas: login em todas as rotas, anexos fora da pasta, WebSocket, buscas
        com texto do usuário, `await` em todo acesso ao banco, datas (tela e filtros), numeração;
        varredura automática sem nenhum 500 em 135 rotas de consulta e 42 módulos com dados
      - Mantido por decisão: operador pode excluir na maioria das telas; anexos comuns abrem pelo
        link sem login (`UPLOADS_REQUIRE_AUTH` desligado por causa do app antigo)
- [ ] Opcional: corrigir os 28 avisos `react-hooks/exhaustive-deps` do build, tela por tela

## Credenciais de Teste
- Email: joao.victor@jalogisticas.com
- Senha: password123

## URLs
- Preview: https://container-mvmt-sys.preview.emergentagent.com
- Produção: https://container-flow-ops.emergent.host (atualmente offline)
