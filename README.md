# Local Dev Companion

Uma extensão de Visual Studio Code com dois runtimes de agente construídos exclusivamente sobre primitivas do **LangChain**, executados localmente e conectados somente ao endpoint **Chat Completions** de um gateway LiteLLM.

O usuário escolhe entre **LangChain Agent** (`createAgent`), mais enxuto e previsível, e **Deep Agent** (`createDeepAgent`), preparado para tarefas longas com planejamento, compactação de contexto e subagentes locais. Modelo (`ChatOpenAICompletions`), ferramentas (`tool` + Zod), estado (`MemorySaver`), callbacks e middleware continuam sendo do ecossistema LangChain. Contexto, histórico, memória e ferramentas rodam na máquina do usuário. A única chamada externa feita pela extensão é:

```text
POST <LITELLM_BASE_URL>/chat/completions
```

Não há runtime Codex, loop próprio paralelo, login ChatGPT, OpenAI Platform, ferramentas hospedadas, web search, MCP externo, LangSmith, telemetria ou verificação de atualização.

## Capacidades

- Chat na Secondary Sidebar, à direita do editor.
- Seletor visível entre **LangChain Agent** e **Deep Agent**, persistido por workspace.
- Contexto automático do arquivo ativo, seleção, cursor, diagnósticos, arquivos abertos e amostra da árvore.
- Contexto fixado pelo menu **Local Companion: Add Selection to Context**.
- Estado de curto prazo gerenciado por `MemorySaver`, com histórico recente preservado localmente por workspace.
- Memória durável e auditável em `.codex-agent/memory.md`.
- Planejamento apresentado na própria sidebar.
- Ferramentas locais para listar, pesquisar e ler arquivos sob demanda.
- Edição por substituição exata e criação de arquivos, sempre dentro do workspace.
- Execução de comandos sem shell, com confirmação modal do usuário e ambiente sem a chave LiteLLM.
- Modos **Execute** e **Plan only**.
- Cancelamento de turnos e de comandos em andamento.
- Streaming de Chat Completions e function calling gerenciados por `ChatOpenAICompletions` e pelo runtime escolhido.
- Chave virtual LiteLLM armazenada exclusivamente no Secret Storage do VS Code.
- Bundle PEM corporativo opcional, mantido dentro do workspace.

O modelo disponibilizado no LiteLLM precisa suportar **Chat Completions function calling**. A arquitetura segue a [documentação de Agents do LangChain](https://docs.langchain.com/oss/javascript/langchain/agents), a [documentação oficial de Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview), a [memória de curto prazo](https://docs.langchain.com/oss/javascript/langchain/short-term-memory) e a referência de [`ChatOpenAI`](https://reference.langchain.com/javascript/langchain-openai/ChatOpenAI).

## Pré-requisitos

- Node.js 22 ou superior.
- Visual Studio Code 1.106 ou superior.
- Gateway LiteLLM acessível por HTTPS.
- URL base HTTPS do gateway ou URL completa terminando em `/chat/completions`.
- Alias de modelo com suporte a function calling.
- Chave virtual scoped do LiteLLM.

## Clonou o repositório? Instale assim

```bash
git clone https://github.com/rlsgarcia-code/codex-dev-companion.git
cd codex-dev-companion
npm ci
npm test
npm run package
code --install-extension ./codex-dev-companion-0.8.0.vsix
```

Se o comando `code` não estiver disponível:

1. Abra **Extensions** no VS Code.
2. Clique no menu `…` do painel.
3. Escolha **Install from VSIX…**.
4. Selecione `codex-dev-companion-0.8.0.vsix` na pasta clonada.
5. Reinicie o VS Code quando solicitado.

O VSIX não contém binário nativo e pode ser instalado em macOS, Windows ou Linux compatíveis com a versão do VS Code indicada.

## Primeiro uso

1. Abra uma pasta de projeto no VS Code.
2. Pressione `Ctrl/Cmd + Shift + P`.
3. Execute **Local Companion: Configure LiteLLM**.
4. Escolha o runtime e informe os quatro valores de conexão abaixo.
5. Abra **Local Companion** na barra lateral direita.

| Valor | Campo | Exemplo |
| --- | --- | --- |
| Runtime local | **Agent runtime** | `LangChain Agent` ou `Deep Agent` |
| Base ou rota completa | **Gateway Base URL** | `https://gateway.empresa.com/v1` ou `https://gateway.empresa.com/ia/chat/completions` |
| Alias liberado | **Model Alias** | `modelo-corporativo` |
| Chave virtual | **Virtual Key** | chave individual/scoped |
| CA opcional | **Gateway CA certificate** | `.pem` dentro do workspace |

Se for informada uma URL base, a extensão acrescenta `/chat/completions`. Se a rota completa já for informada, ela será usada sem duplicação. Caminhos corporativos intermediários são aceitos; query parameters são recusados para evitar que segredos sejam gravados em settings.

Também é possível trocar o runtime no seletor ao lado de **Execute / Plan only**. A escolha vale para o workspace atual. Clique em **LiteLLM** no rodapé para alterar URL, alias ou chave. Se a chave ficar vazia, o valor já armazenado no Secret Storage é preservado. Use **Setup wizard / PEM** para selecionar ou trocar o certificado corporativo.

## Como o agente trabalha

Em cada turno, o runtime local:

1. coleta o contexto atual do editor;
2. lê a memória durável do projeto;
3. recupera a thread pelo `MemorySaver` e aplica o middleware de janela de contexto;
4. instancia `ChatOpenAICompletions` sobre a base URL do LiteLLM;
5. entrega mensagens e ferramentas ao `createAgent` ou `createDeepAgent`, conforme a escolha do usuário;
6. valida cada chamada por schema Zod e executa a ferramenta local correspondente;
7. deixa o runtime LangChain devolver resultados como `ToolMessage` e repetir o ciclo até a resposta final;
8. persiste somente os turnos de usuário/assistente necessários para retomar a conversa após reiniciar o VS Code.

No **LangChain Agent**, a janela de conversa é limitada por middleware e todas as ferramentas são as implementações locais explícitas do projeto. No **Deep Agent**, a orquestração de tarefas longas, a compactação, o filesystem e a delegação para subagentes vêm de `deepagents`; o plano visível continua sendo publicado pela ferramenta LangChain local `update_plan`. O backend de arquivos usa modo virtual preso à raiz do workspace. A compactação mantém seu estado no checkpoint em memória e não grava transcrições no projeto.

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
code --install-extension codex-dev-companion-0.8.0.vsix
```

## Memória

O arquivo `.codex-agent/memory.md` foi preservado para compatibilidade com instalações anteriores. Ele deve conter somente decisões, fatos e convenções duráveis e verificáveis.

Nunca armazene nele credenciais, tokens, dados pessoais, hipóteses, status transitório ou transcrições do chat.

## Segurança e privacidade

- A chave LiteLLM fica exclusivamente no Secret Storage do VS Code.
- A chave não é escrita em settings, logs, prompts, memória ou arquivos do projeto.
- O endpoint precisa usar HTTPS.
- O certificado PEM opcional precisa resolver para um arquivo dentro do workspace.
- Arquivos só podem ser lidos ou alterados dentro do workspace aberto.
- Comandos são executados diretamente, sem shell, depois de confirmação do usuário.
- Clientes de rede e operações de download, publicação e Git remoto são bloqueados nas ferramentas do agente.
- O histórico do agente fica no armazenamento local do workspace do VS Code; não é copiado para `memory.md`.
- O LiteLLM recebe apenas as mensagens necessárias para inferência, incluindo trechos de arquivos e resultados de ferramentas usados naquele turno.
- Revise as alterações antes de fazer commit.

## Configurações

| Configuração | Padrão | Finalidade |
| --- | --- | --- |
| `codexDevCompanion.agentRuntime` | `standard` | Escolhe `LangChain Agent` (`standard`) ou `Deep Agent` (`deep`) por workspace. |
| `codexDevCompanion.liteLlmEndpoint` | vazio | Base HTTPS do LiteLLM ou URL completa de Chat Completions. |
| `codexDevCompanion.liteLlmModel` | vazio | Alias exato do modelo liberado. |
| `codexDevCompanion.gatewayCaCertificatePath` | vazio | Caminho relativo para o bundle CA `.pem`. |
| `codexDevCompanion.autoContext` | `true` | Inclui contexto atual do editor. |
| `codexDevCompanion.maxContextCharacters` | `24000` | Limite do contexto coletado por turno. |
| `codexDevCompanion.maxConversationCharacters` | `48000` | Limite do histórico recente enviado ao modelo. |

O prefixo `codexDevCompanion` foi mantido para que configurações e segredos de instalações anteriores continuem válidos.

## Arquitetura

```text
VS Code Secondary Sidebar
    │
    ├── AgentViewProvider ── chat, timeline, plano e configurações
    ├── ContextCollector ─── editor, seleção, diagnósticos e arquivos
    ├── ProjectMemory ────── .codex-agent/memory.md
    └── DevelopmentAgent ─── orquestra primitivas LangChain
            │
            ├── runtime escolhido por workspace
            │     ├── createAgent · enxuto e explícito
            │     └── createDeepAgent · planejamento, compactação e subagentes
            ├── MemorySaver + middleware
            ├── ChatOpenAICompletions
            ├── LocalToolHost (`tool()` + Zod)
            │     ├── list/search/read
            │     ├── edit/create
            │     ├── approved command execution
            │     └── plan/memory
            │
            └── HTTPS ──► LiteLLM POST /v1/chat/completions
```

## Limitações

- A qualidade do planejamento e do uso de ferramentas depende do modelo disponibilizado pelo gateway.
- Modelos sem function calling podem conversar, mas não conseguem inspecionar ou modificar o workspace autonomamente.
- A extensão não executa um sandbox de sistema operacional. Por isso, comandos exigem confirmação explícita e recebem um ambiente mínimo.
- O LangChain Agent mantém turnos recentes inteiros dentro do limite configurado. O Deep Agent pode compactar conversas antigas usando o mesmo modelo via LiteLLM.
- Não há suporte a ferramentas hospedadas, web search, MCP remoto ou execução em nuvem.
