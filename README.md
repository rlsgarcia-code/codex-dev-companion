# Codex Dev Companion

Uma extensão de Visual Studio Code que transforma o **OpenAI Codex agent harness** em um agente de suporte ao desenvolvimento com contexto do editor, planejamento, leitura e edição de arquivos, execução de comandos, memória persistente e retomada de conversas.

O projeto usa o SDK oficial `@openai/codex-sdk`. O harness, shell, ferramentas, memória, contexto e histórico executam inteiramente na máquina do usuário. A única comunicação externa permitida em runtime é a inferência enviada diretamente ao endpoint Azure OpenAI configurado pelo usuário.

## O que já funciona

- Painel lateral de conversa dentro do VS Code.
- Thread persistente por workspace, retomada automaticamente entre sessões.
- Contexto automático: arquivo ativo, seleção, cursor, diagnósticos, arquivos abertos e amostra da árvore do projeto.
- Contexto fixado pelo menu **Codex Companion: Add Selection to Context**.
- Leitura sob demanda de arquivos pelo próprio harness, sem enviar o repositório inteiro a cada turno.
- Planejamento visível por meio dos eventos `todo_list` do Codex.
- Timeline de comandos, alterações de arquivos e ferramentas locais.
- Modos **Execute** e **Plan only**.
- Cancelamento de turnos em andamento.
- Memória auditável em `.codex-agent/memory.md`.
- Sandbox `workspace-write`, rede desativada e comandos limitados ao workspace por padrão.
- Provider Azure OpenAI forçado pelo runtime, sem login ChatGPT ou OpenAI Platform.
- Estado do Codex isolado em um `CODEX_HOME` privado da extensão.
- Telemetria, analytics, feedback, update checks, apps, plugins e servidores MCP externos desativados por configuração de runtime.
- Binário Codex oficial fornecido pelo SDK, sem caminho de executável substituível por configuração.
- Chave Azure armazenada exclusivamente no Secret Storage do VS Code.

## Pré-requisitos

- Node.js 18 ou superior.
- Visual Studio Code 1.96 ou superior.
- Um deployment Azure OpenAI compatível com a Responses API.
- Endpoint, nome do deployment, versão da API e chave do Azure OpenAI.

## Clonou o repositório? Instale assim

Este é o fluxo para usar a extensão normalmente, sem abrir o ambiente de desenvolvimento do VS Code:

```bash
git clone https://github.com/rlsgarcia-code/codex-dev-companion.git
cd codex-dev-companion
npm ci
npm test
npm run package
code --install-extension ./codex-dev-companion-0.2.2.vsix
```

Execute esses comandos na própria máquina em que a extensão será usada. O `npm ci` instala o runtime nativo do Codex correspondente ao sistema operacional e à arquitetura atuais; por isso, um VSIX gerado no macOS não deve ser reutilizado no Windows ou Linux.

Se o comando `code` não estiver disponível:

1. Abra **Extensions** no VS Code.
2. Clique no menu `…` do painel.
3. Escolha **Install from VSIX…**.
4. Selecione `codex-dev-companion-0.2.2.vsix` na pasta clonada.
5. Reinicie o VS Code quando solicitado.

### Primeiro uso

1. Abra uma pasta de projeto no VS Code.
2. Pressione `Ctrl/Cmd + Shift + P` e execute **Codex Companion: Configure Azure OpenAI**.
3. Complete as quatro etapas numeradas usando o mapeamento abaixo.
4. Abra o ícone **Codex Companion** na barra lateral.

| Variável que você já possui | Campo da extensão | Formato esperado |
| --- | --- | --- |
| `OPENAI_API_BASE` | **OpenAI API Base** | `https://seu-recurso.openai.azure.com/openai` |
| Deployment ID | **Deployment ID** | Nome exato do deployment, sem URL |
| API Version | **API version** | Por exemplo, `2025-04-01-preview` |
| API Key | **API key** | Chave do recurso Azure OpenAI |

Se seu `OPENAI_API_BASE` terminar em `/openai/deployments/<id>`, informe somente a parte até `/openai`; o Deployment ID é preenchido separadamente. A extensão não instancia nem recebe um objeto `AzureChatOpenAI`: ela aplica esses mesmos quatro valores diretamente ao provider Azure do Codex SDK.

A chave é solicitada como senha e guardada somente no Secret Storage do VS Code. Ela não é escrita em `settings.json`, `.env`, `config.toml`, logs ou arquivos do projeto.

## Executar em desenvolvimento

```bash
npm install
npm run check
npm run build
npm test
```

Abra esta pasta no VS Code e pressione `F5`. Na janela **Extension Development Host**, abra uma pasta de código e clique no ícone **Codex Companion** na Activity Bar.

Para recompilar enquanto edita:

```bash
npm run watch
```

## Reinstalar o VSIX após alterações

```bash
npm run package
code --install-extension codex-dev-companion-0.2.2.vsix
```

## Memória

A memória é intencionalmente simples e verificável. O arquivo `.codex-agent/memory.md` pertence ao projeto e pode ser revisado ou versionado como qualquer outro documento.

Use **Codex Companion: Remember Note** para registrar uma decisão durável. Exemplos adequados:

- convenções de arquitetura;
- comandos oficiais de teste e build;
- decisões técnicas confirmadas;
- restrições permanentes do projeto.

Não armazene credenciais, tokens, dados pessoais, hipóteses ou status transitório.

## Segurança e privacidade

- O agente recebe somente o contexto de editor descrito acima e pode ler outros arquivos quando forem relevantes para a tarefa.
- O sandbox padrão permite escrita apenas no workspace.
- Comandos e ferramentas executados pelo agente não recebem acesso de rede.
- Web search, serviços hospedados, atualização automática, login ChatGPT e credenciais OpenAI são desativados.
- Analytics, exportadores OpenTelemetry, feedback, apps, plugins e servidores MCP são desativados explicitamente.
- O processo Codex recebe um ambiente mínimo: variáveis essenciais do sistema, um `CODEX_HOME` isolado e somente a chave Azure.
- O endpoint é validado como HTTPS e deve pertencer a um hostname Azure OpenAI reconhecido.
- A única chamada externa em runtime é `Codex local → Azure OpenAI Responses API`.
- A política de aprovação é `never` porque o SDK em modo não interativo não oferece uma interface de aprovação no meio do turno; o sandbox do workspace continua sendo a fronteira de execução.
- Revise alterações antes de fazer commit e mantenha segredos fora do workspace.

## Configurações

| Configuração | Padrão | Finalidade |
| --- | --- | --- |
| `codexDevCompanion.azureEndpoint` | vazio | OpenAI API Base HTTPS do Azure terminando em `/openai`. |
| `codexDevCompanion.azureDeployment` | vazio | Deployment ID Azure usado como modelo. |
| `codexDevCompanion.azureApiVersion` | `2025-04-01-preview` | Versão da Responses API no Azure. |
| `codexDevCompanion.reasoningEffort` | `high` | Define o esforço de raciocínio. |
| `codexDevCompanion.autoContext` | `true` | Inclui contexto atual do editor. |
| `codexDevCompanion.maxContextCharacters` | `24000` | Limita o contexto coletado pela extensão. |

## Arquitetura

```text
VS Code sidebar
    │  prompt + editor context
    ▼
Extension host
    ├── ContextCollector ── active file / selection / diagnostics
    ├── ProjectMemory ───── .codex-agent/memory.md
    └── Codex SDK
            │  streamed thread events
            ▼
       Codex harness
            ├── planning / context compaction
            ├── shell + file inspection
            ├── apply patches
            ├── persistent local threads
            └── HTTPS ──► Azure OpenAI Responses API
```

As responsabilidades ficam separadas: o VS Code fornece contexto, segredos e interface; o Codex harness local mantém o loop agente, as ferramentas, a thread e a execução sandboxed; a memória continua transparente e editável. O Azure OpenAI recebe apenas as requisições de inferência necessárias para o modelo decidir o próximo passo.

## Limitações atuais

- O painel mostra o resultado final da resposta, não deltas de texto token a token, pois o SDK expõe mensagens concluídas nesse fluxo.
- Aprovações interativas exigiriam um cliente direto do Codex App Server; esta versão usa o SDK com sandbox restrito.
- O VSIX inclui o runtime nativo do Codex e, por isso, pode ser grande e específico da plataforma usada no empacotamento.
- Deployments Chat Completions-only não são compatíveis; o harness exige a Responses API com streaming e tool calls.
