# Local Dev Companion

Uma extensão de Visual Studio Code com dois runtimes de agente construídos exclusivamente sobre primitivas do **LangChain**, executados localmente e conectados somente a endpoints configurados pelo usuário no gateway LiteLLM.

O usuário escolhe entre **LangChain Agent** (`createAgent`), mais enxuto e previsível, e **Deep Agent** (`createDeepAgent`), preparado para tarefas longas com planejamento, compactação de contexto e subagentes locais. Modelo (`ChatOpenAICompletions`), ferramentas (`tool` + Zod), estado (`MemorySaver`), callbacks, vector store e middleware continuam sendo do ecossistema LangChain. Contexto, histórico, ChromaDB, memória e ferramentas rodam na máquina do usuário. As únicas chamadas externas feitas pela extensão são:

```text
POST <LITELLM_BASE_URL>/chat/completions
POST <LITELLM_BASE_URL>/embeddings       # opcional, se a memória semântica for configurada
GET  <MODELS_URL>  # opcional, somente quando o usuário clica em Load
```

Não há runtime Codex, loop próprio paralelo, login ChatGPT, OpenAI Platform, ferramentas hospedadas, web search, MCP externo, LangSmith, telemetria ou verificação de atualização.

## Capacidades

- Chat na Secondary Sidebar, à direita do editor.
- Seletor visível entre **LangChain Agent** e **Deep Agent**, persistido por workspace.
- Contexto automático do arquivo ativo, seleção, cursor, diagnósticos, arquivos abertos e amostra da árvore.
- Contexto fixado pelo menu **Local Companion: Add Selection to Context**.
- Checkpoints da thread ativa gerenciados por `MemorySaver`, com uma projeção limitada de usuário/assistente no armazenamento local do workspace para restauração.
- Memória durável e auditável em `.codex-agent/memory.md`, com recuperação semântica opcional pelo ChromaDB local.
- Planejamento apresentado na própria sidebar.
- Ferramentas locais para listar, pesquisar e ler arquivos sob demanda.
- Edição por substituição exata e criação de arquivos, sempre dentro do workspace.
- Execução de comandos sem shell, com confirmação modal do usuário e ambiente sem a chave LiteLLM.
- Modos **Execute** e **Plan only**.
- Cancelamento de turnos e de comandos em andamento.
- Streaming de Chat Completions e function calling gerenciados por `ChatOpenAICompletions` e pelo runtime escolhido.
- Chave virtual LiteLLM armazenada exclusivamente no Secret Storage do VS Code.
- Bundle PEM corporativo opcional, importado uma vez para o armazenamento global local da extensão.
- Catálogo de modelos opcional carregado da URL informada pelo usuário com `Cache-Control: no-cache` e `api-key` usando a chave do Secret Storage.

O modelo disponibilizado no LiteLLM precisa suportar **Chat Completions function calling**. A arquitetura segue a [documentação de Agents do LangChain](https://docs.langchain.com/oss/javascript/langchain/agents), a [documentação oficial de Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview), a [memória de curto prazo](https://docs.langchain.com/oss/javascript/langchain/short-term-memory) e a referência de [`ChatOpenAI`](https://reference.langchain.com/javascript/langchain-openai/ChatOpenAI).

## Pré-requisitos

- Node.js 22 ou superior.
- Visual Studio Code 1.106 ou superior.
- Gateway LiteLLM acessível por HTTPS.
- URL base HTTPS do gateway ou URL completa terminando em `/chat/completions`.
- Alias de modelo com suporte a function calling.
- Chave de API ou subscription key esperada pelo gateway.

## Clonou o repositório? Instale assim

```bash
git clone https://github.com/rlsgarcia-code/codex-dev-companion.git
cd codex-dev-companion
npm ci
npm test
npm run package
code --install-extension ./codex-dev-companion-0.10.1.vsix
```

Se o comando `code` não estiver disponível:

1. Abra **Extensions** no VS Code.
2. Clique no menu `…` do painel.
3. Escolha **Install from VSIX…**.
4. Selecione `codex-dev-companion-0.10.1.vsix` na pasta clonada.
5. Reinicie o VS Code quando solicitado.

O VSIX contém o binário local do ChromaDB para a plataforma em que foi gerado. Gere o pacote no mesmo sistema/arquitetura em que ele será instalado (macOS arm64/x64, Linux arm64/x64 ou Windows x64). Não é necessário Docker nem instalar um servidor Chroma separadamente. Os binários necessários são fornecidos por pacotes npm específicos da plataforma e o projeto desabilita scripts de lifecycle durante a instalação de dependências.

## Primeiro uso

1. Abra uma pasta de projeto no VS Code.
2. Pressione `Ctrl/Cmd + Shift + P`.
3. Execute **Local Companion: Configure LiteLLM**.
4. Escolha o runtime e informe os valores de conexão e as capacidades do modelo abaixo.
5. Abra **Local Companion** na barra lateral direita.

| Valor | Campo | Exemplo |
| --- | --- | --- |
| Runtime local | **Agent runtime** | `LangChain Agent` ou `Deep Agent` |
| Base ou rota completa | **Gateway Base URL** | `https://gateway.empresa.com/v1` ou `https://gateway.empresa.com/ia/chat/completions` |
| Catálogo opcional | **Models URL** | `https://gateway.empresa.com/ia/models` |
| Alias liberado | **Model Alias** | `modelo-corporativo` |
| Compatibilidade | **Compatibility profile** | automático, família GPT/Claude ou customizado |
| Reasoning opcional | **Reasoning effort** | omitir ou `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| Temperatura opcional | **Temperature** | vazio para omitir, ou um número aceito pelo modelo |
| Amostragem opcional | **Top P** | vazio para omitir, ou valor entre `0` e `1` |
| Cabeçalho da chave | **Key Header** | `Authorization: Bearer`, `api-key` ou `Ocp-Apim-Subscription-Key` |
| Chave | **Gateway Key** | chave individual/scoped ou subscription key |
| CA opcional | **Gateway CA certificate** | importe o `.pem` uma vez para todos os workspaces |
| Memória semântica | **Embedding Model Alias** | alias LiteLLM de embeddings; deixe vazio para desativar vetores |
| Rota de embeddings | **Embeddings URL** | opcional; se vazia, é derivada da base do chat |

Se for informada uma URL base, a extensão acrescenta `/chat/completions`. Se a rota completa já for informada, ela será usada sem duplicação. Caminhos corporativos intermediários são aceitos; query parameters são recusados para evitar que segredos sejam gravados em settings.

Também é possível trocar o runtime no seletor ao lado de **Execute / Plan only**. A escolha vale para o workspace atual. Clique em **LiteLLM** no rodapé para alterar URL, alias, capacidades, cabeçalho ou chave. Informe **Models URL** e clique em **Load** para preencher os aliases; essa consulta usa `GET`, `Cache-Control: no-cache` e `api-key: <chave>`. Reasoning, temperatura, Top P e preset são lembrados separadamente para cada alias exato. Se a chave ficar vazia, o valor já armazenado no Secret Storage é preservado. Use **Setup wizard / CA** para importar, trocar ou remover o certificado corporativo. A cópia importada fica somente no armazenamento global local da extensão e é reutilizada por todas as janelas e workspaces do mesmo perfil e ambiente do VS Code.

Para ativar recuperação semântica, abra **LiteLLM**, informe **Models URL**, clique em **Load** e selecione um alias em **Embedding Model**. O mesmo catálogo preenche tanto o modelo de chat quanto o modelo de embeddings. A extensão inicia o ChromaDB empacotado em `127.0.0.1`, salva os vetores no armazenamento privado local do VS Code e indexa somente entradas de `.codex-agent/memory.md`. O arquivo Markdown continua sendo a fonte de verdade legível e versionável. A mesma chave, cabeçalho e CA do gateway são usados no `POST /embeddings`; nenhum dado é enviado ao Chroma Cloud.

### Compatibilidade por modelo

O preset **Auto-detect from alias** aplica a matriz abaixo. Para aliases corporativos opacos ou gateways com tradução própria, selecione **Custom / gateway-defined**.

| Família | Function tools no Chat Completions | Reasoning exposto | Temperature / Top P |
| --- | --- | --- | --- |
| GPT-6 Sol / Luna | somente com `reasoning_effort: none` | `none`, `low`, `medium`, `high`, `xhigh`, `max` | opcionais somente com `none` |
| GPT-6 Astra / GPT-6.1 Sol | incompatível neste agente: tools exigem Responses API | `low` a `max` | omitidos |
| GPT-5.6 | perfil de tools usa `none` | `none`, `low`, `medium`, `high`, `xhigh`, `max` | opcionais somente com `none` |
| GPT-5.2–5.5 | perfil conservador de Chat Completions | conforme modelo | somente com `none` |
| GPT-4 / GPT-4o | suportado | não enviado | opcionais; escolha Temperature ou Top P |
| Claude 4.7+ / 5 | suportado via LiteLLM | `low`, `medium`, `high`, `xhigh`, `max`, conforme modelo | omitidos |
| Claude 4.6 | suportado via LiteLLM | `low`, `medium`, `high`, `max` | somente com reasoning omitido |
| Claude 4.5 ou anterior | suportado via LiteLLM | traduzido para thinking quando disponível | somente com reasoning omitido |

A OpenAI documenta que GPT-6 Sol/Luna aceitam function calling no Chat Completions apenas com `reasoning_effort: none`, e que sampling deve ser removido quando reasoning não é `none`: [OpenAI API deployment checklist](https://developers.openai.com/api/docs/guides/deployment-checklist). A Anthropic documenta os níveis de effort e informa que Claude 4.7+ rejeita `temperature`, `top_p` e `top_k` não padrão: [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort) e [Claude model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations). O LiteLLM fornece a interface OpenAI compatível e traduz os parâmetros para cada provider: [LiteLLM providers](https://docs.litellm.ai/docs/providers).

### Erro “missing subscription key”

Esse erro normalmente vem do Azure API Management e significa que a chave chegou no cabeçalho errado. Selecione:

- **Authorization: Bearer** para um LiteLLM padrão;
- **api-key** quando a integração equivalente funciona com `AzureChatOpenAI` ou quando o hub corporativo exige compatibilidade Azure;
- **Ocp-Apim-Subscription-Key** quando o gateway exige o cabeçalho padrão de subscription key do Azure API Management.

A escolha muda somente o cabeçalho HTTPS enviado ao gateway configurado. A chave continua armazenada exclusivamente no Secret Storage.

### Erro “Function tools with reasoning_effort are not supported”

Algumas implantações usam reasoning por padrão, mas não aceitam reasoning junto de function tools no endpoint Chat Completions. Como o agente precisa das ferramentas locais e este projeto não usa Responses API, abra **LiteLLM** e selecione `none` em **Reasoning effort** para o alias afetado.

O formulário detecta a família pelo alias e limita as opções conhecidas, mas o preset pode ser alterado manualmente. Se aparecer erro de temperatura incompatível, deixe **Temperature** e **Top P** em branco ou use o preset customizado conforme o contrato real do gateway.

## Como o agente trabalha

Em cada turno, o runtime local:

1. coleta o contexto atual do editor;
2. lê a memória durável do projeto;
3. recupera a thread ativa pelo `MemorySaver` ou restaura sua projeção local limitada e aplica o middleware de janela de contexto;
4. quando configurado, indexa e consulta a memória do projeto no ChromaDB local por meio do vector store LangChain;
5. instancia `ChatOpenAICompletions` sobre a base URL do LiteLLM;
6. entrega mensagens e ferramentas ao `createAgent` ou `createDeepAgent`, conforme a escolha do usuário;
7. valida cada chamada por schema Zod e executa a ferramenta local correspondente;
8. deixa o runtime LangChain devolver resultados como `ToolMessage` e repetir o ciclo até a resposta final.

No **LangChain Agent**, a janela de conversa é limitada por middleware e todas as ferramentas são as implementações locais explícitas do projeto. No **Deep Agent**, a orquestração de tarefas longas, a compactação, o filesystem e a delegação para subagentes vêm de `deepagents`; o limite artificial de 50 passos foi removido em favor do limite nativo alto do Deep Agent. O projeto fica montado em `/workspace`, enquanto o `StateBackend` mantém arquivos grandes/offload no estado LangGraph. O plano visível continua sendo publicado pela ferramenta local `update_plan`.

Não existe cliente HTTP alternativo nem loop manual de function calling no projeto. A classe `ChatOpenAICompletions` força o caminho Chat Completions e não usa Responses API. O tracing externo do LangChain/LangSmith é explicitamente desativado pelo runtime.

As ferramentas de leitura usam caminhos relativos e validam caminhos reais para impedir escape por `..` ou links simbólicos. Os comandos não passam por um shell, exigem confirmação e recebem somente um conjunto mínimo de variáveis do sistema — nunca a chave do LiteLLM.

No modo **Plan only**, ferramentas de escrita, memória e execução de comandos não são disponibilizadas. No Deep Agent, o middleware de filesystem também aplica permissão de escrita negada como defesa adicional.

## Desenvolvimento

```bash
npm install
npm run check
npm run build
npm test
npm run smoke:litellm
```

Abra esta pasta no VS Code e pressione `F5`. Na janela **Extension Development Host**, abra uma pasta de código e clique em **Local Companion** na Secondary Sidebar.

Para recompilar continuamente:

```bash
npm run watch
```

Para gerar e reinstalar o pacote:

```bash
npm run package
code --install-extension codex-dev-companion-0.10.1.vsix
```

## Memória

O arquivo `.codex-agent/memory.md` é a fonte de verdade da memória do projeto. Ele deve conter somente decisões, fatos e convenções duráveis e verificáveis. Quando um alias de embeddings está configurado, a extensão transforma essas entradas em chunks limitados, gera embeddings pelo LiteLLM e mantém o índice no ChromaDB local.

Nunca armazene nele credenciais, tokens, dados pessoais, hipóteses, status transitório ou transcrições do chat.

## Segurança e privacidade

- A chave LiteLLM fica exclusivamente no Secret Storage do VS Code.
- A chave não é escrita em settings, logs, prompts, memória ou arquivos do projeto.
- O endpoint precisa usar HTTPS.
- O certificado PEM opcional é validado e copiado para o armazenamento global local da extensão; o caminho original não é persistido.
- Arquivos só podem ser lidos ou alterados dentro do workspace aberto.
- Comandos são executados diretamente, sem shell, depois de confirmação do usuário.
- Clientes de rede e operações de download, publicação e Git remoto são bloqueados nas ferramentas do agente.
- O histórico do agente fica no armazenamento local do workspace do VS Code; não é copiado para `memory.md`.
- A projeção limitada da conversa fica no estado local do workspace; os vetores Chroma ficam no armazenamento privado local da extensão, fora do repositório.
- O LiteLLM recebe apenas as mensagens necessárias para inferência, incluindo trechos de arquivos e resultados de ferramentas usados naquele turno.
- Revise as alterações antes de fazer commit.

## Configurações

| Configuração | Padrão | Finalidade |
| --- | --- | --- |
| `codexDevCompanion.agentRuntime` | `standard` | Escolhe `LangChain Agent` (`standard`) ou `Deep Agent` (`deep`) por workspace. |
| `codexDevCompanion.liteLlmEndpoint` | vazio | Base HTTPS do LiteLLM ou URL completa de Chat Completions. |
| `codexDevCompanion.liteLlmModelsEndpoint` | vazio | URL HTTPS opcional do catálogo consultado sob demanda com `api-key` e sem cache. |
| `codexDevCompanion.liteLlmAuthHeader` | `authorization` | Cabeçalho que transporta a chave até o gateway. |
| `codexDevCompanion.liteLlmModel` | vazio | Alias exato do modelo liberado. |
| `codexDevCompanion.liteLlmModelProfiles` | `{}` | Preset e parâmetros opcionais de reasoning/sampling por alias; campos ausentes não são enviados. |
| `codexDevCompanion.gatewayCaCertificatePath` | vazio | Configuração legada por workspace; certificados existentes são migrados automaticamente para o armazenamento global local. |
| `codexDevCompanion.autoContext` | `true` | Inclui contexto atual do editor. |
| `codexDevCompanion.maxContextCharacters` | `24000` | Limite do contexto coletado por turno. |
| `codexDevCompanion.maxConversationCharacters` | `48000` | Limite do histórico recente enviado ao modelo. |
| `codexDevCompanion.semanticMemoryEnabled` | `true` | Habilita recuperação semântica local quando há alias de embeddings. |
| `codexDevCompanion.embeddingModel` | vazio | Alias LiteLLM usado em `POST /embeddings`; vazio mantém somente memória textual. |
| `codexDevCompanion.embeddingsEndpoint` | vazio | Base/rota de embeddings opcional; por padrão deriva da base do chat. |
| `codexDevCompanion.semanticMemoryResults` | `5` | Número máximo de chunks relevantes recuperados por turno. |
| `codexDevCompanion.standardRecursionLimit` | `200` | Limite LangGraph do runtime padrão; o Deep Agent usa o limite nativo alto. |

O prefixo `codexDevCompanion` foi mantido para que configurações e segredos de instalações anteriores continuem válidos.

## Arquitetura

```text
VS Code Secondary Sidebar
    │
    ├── AgentViewProvider ── chat, timeline, plano e configurações
    ├── ContextCollector ─── editor, seleção, diagnósticos e arquivos
    ├── ProjectMemory ────── .codex-agent/memory.md (fonte de verdade)
    └── DevelopmentAgent ─── orquestra primitivas LangChain
            │
            ├── runtime escolhido por workspace
            │     ├── createAgent · enxuto e explícito
            │     └── createDeepAgent · planejamento, compactação e subagentes
            ├── MemorySaver + projeção local limitada
            ├── Chroma vector store local ──► 127.0.0.1 (opcional)
            ├── ChatOpenAICompletions
            ├── LocalToolHost (`tool()` + Zod)
            │     ├── list/search/read
            │     ├── edit/create
            │     ├── approved command execution
            │     └── plan/memory
            │
            ├── HTTPS ──► LiteLLM POST /v1/chat/completions
            ├── HTTPS ──► LiteLLM POST /v1/embeddings (opcional)
            └── HTTPS ──► catálogo GET /models (opcional e sob demanda)
```

## Limitações

- A qualidade do planejamento e do uso de ferramentas depende do modelo disponibilizado pelo gateway.
- Modelos sem function calling não são compatíveis com o runtime do agente.
- A extensão não executa um sandbox de sistema operacional. Por isso, comandos exigem confirmação explícita e recebem um ambiente mínimo.
- O LangChain Agent mantém turnos recentes inteiros dentro do limite configurado. O Deep Agent pode compactar conversas antigas usando o mesmo modelo via LiteLLM.
- A memória semântica requer que o gateway disponibilize um modelo compatível com a API OpenAI de embeddings.
- O pacote VSIX é específico de plataforma por conter o binário local do ChromaDB.
- Não há suporte a ferramentas hospedadas, web search, MCP remoto ou execução em nuvem.
