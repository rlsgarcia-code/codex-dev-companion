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
code --install-extension ./codex-dev-companion-0.3.0.vsix
```

Execute esses comandos na própria máquina em que a extensão será usada. O `npm ci` instala o runtime nativo do Codex correspondente ao sistema operacional e à arquitetura atuais; por isso, um VSIX gerado no macOS não deve ser reutilizado no Windows ou Linux.

Se o comando `code` não estiver disponível:

1. Abra **Extensions** no VS Code.
2. Clique no menu `…` do painel.
3. Escolha **Install from VSIX…**.
4. Selecione `codex-dev-companion-0.3.0.vsix` na pasta clonada.
5. Reinicie o VS Code quando solicitado.

### Primeiro uso

1. Abra uma pasta de projeto no VS Code.
2. Pressione `Ctrl/Cmd + Shift + P` e execute **Codex Companion: Configure Azure OpenAI**.
3. Complete as quatro etapas numeradas usando o mapeamento abaixo.
4. Abra o ícone **Codex Companion** na barra lateral.

Depois do primeiro setup, clique em **Azure** no rodapé da própria sidebar para alterar rapidamente **Deployment ID**, **API Version**, base e chave. Deixar o campo da chave vazio preserva o valor já guardado no Secret Storage. Use **Setup wizard / PEM** somente quando precisar trocar a CA corporativa ou revisar a configuração completa.

| Variável que você já possui | Campo da extensão | Formato esperado |
| --- | --- | --- |
| `OPENAI_API_BASE` | **OpenAI API Base** | `https://seu-recurso.openai.azure.com/openai` |
| Deployment ID | **Deployment ID** | Nome exato do deployment, sem URL |
| API Version | **API version** | Por exemplo, `2025-04-01-preview` |
| API Key | **API key** | Chave do recurso Azure OpenAI |

Se seu `OPENAI_API_BASE` terminar em `/openai/deployments/<id>`, informe somente a parte até `/openai`; o Deployment ID é preenchido separadamente. A extensão não instancia nem recebe um objeto `AzureChatOpenAI`: ela aplica esses mesmos quatro valores diretamente ao provider Azure do Codex SDK.

Gateways corporativos HTTPS também são aceitos. Quando o host não pertence diretamente ao Azure, a extensão exige uma confirmação explícita, preserva o caminho completo configurado e envia a chave no cabeçalho `api-key`. O gateway precisa expor `POST <OPENAI_API_BASE>/responses` com streaming e tool calls; compatibilidade apenas com Chat Completions não é suficiente.

Se o cliente `httpx`/`AzureChatOpenAI` usa `verify="arquivo.pem"`, selecione o mesmo bundle PEM na quinta etapa. O arquivo deve estar dentro do workspace. A extensão guarda apenas seu caminho relativo e passa o caminho absoluto ao processo local por `CODEX_CA_CERTIFICATE`, conforme o suporte oficial do Codex; o conteúdo do certificado não é copiado, enviado ao modelo ou incluído no VSIX.

### Aviso `Model metadata not found`

Esse aviso indica que o Deployment ID não foi encontrado no catálogo de modelos conhecido pelo Codex. O runtime continua com metadados de fallback, mas recursos como limites de contexto, opções de raciocínio e suporte a ferramentas podem ficar imprecisos.

- Se o deployment usa o nome real de um modelo suportado, corrija o **Deployment ID** no formulário **Azure**.
- Se ele é um alias criado pelo gateway corporativo, peça à equipe responsável um catálogo JSON compatível com a versão instalada do Codex e com o modelo real por trás do alias. No formulário **Azure**, use **Select JSON** em **Model metadata**. O arquivo permanece local e precisa estar dentro do workspace.

Não invente os metadados do alias: eles devem corresponder ao modelo upstream. A estrutura e o processo de geração são descritos na documentação oficial em [Roll out a gateway — Add model metadata](https://learn.chatgpt.com/docs/enterprise/roll-out-a-gateway#add-model-metadata).

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
code --install-extension codex-dev-companion-0.3.0.vsix
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
- O endpoint é validado como HTTPS; hosts Azure são aceitos diretamente e gateways corporativos exigem confirmação explícita.
- A única chamada externa em runtime é `Codex local → Azure OpenAI Responses API`.
- A política de aprovação é `never` porque o SDK em modo não interativo não oferece uma interface de aprovação no meio do turno; o sandbox do workspace continua sendo a fronteira de execução.
- Revise alterações antes de fazer commit e mantenha segredos fora do workspace.

## Configurações

| Configuração | Padrão | Finalidade |
| --- | --- | --- |
| `codexDevCompanion.azureEndpoint` | vazio | OpenAI API Base HTTPS do Azure terminando em `/openai`. |
| `codexDevCompanion.azureDeployment` | vazio | Deployment ID Azure usado como modelo. |
| `codexDevCompanion.azureApiVersion` | `2025-04-01-preview` | Versão da Responses API no Azure. |
| `codexDevCompanion.allowCorporateGateway` | `false` | Autoriza o host HTTPS configurado como gateway corporativo após confirmação explícita. |
| `codexDevCompanion.corporateCaCertificatePath` | vazio | Caminho relativo, dentro do workspace, para o bundle CA `.pem` corporativo. |
| `codexDevCompanion.modelCatalogPath` | vazio | Caminho relativo para um catálogo JSON local usado por aliases de deployment. |
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
