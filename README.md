# Local Dev Companion

[![CI](https://github.com/rlsgarcia-code/codex-dev-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/rlsgarcia-code/codex-dev-companion/actions/workflows/ci.yml)

Uma extensão de Visual Studio Code com dois runtimes de agente construídos exclusivamente sobre primitivas do **LangChain**, executados localmente e conectados somente a endpoints configurados pelo usuário no gateway LiteLLM.

O usuário escolhe entre **LangChain Agent** (`createAgent`), mais enxuto e previsível, e **Deep Agent** (`createDeepAgent`), preparado para tarefas longas com planejamento, compactação de contexto e subagentes locais. Modelo (`ChatOpenAICompletions`), ferramentas (`tool` + Zod), estado (`MemorySaver`), callbacks, vector store e middleware continuam sendo do ecossistema LangChain. Contexto, histórico, ChromaDB, memória e ferramentas rodam na máquina do usuário. As únicas chamadas externas feitas pela extensão são:

```text
POST <LITELLM_BASE_URL>/chat/completions
POST <LITELLM_BASE_URL>/embeddings       # opcional, se a memória semântica for configurada
GET  <MODELS_URL>  # opcional, somente quando o usuário clica em Load ou Test connection
```

Não há runtime Codex, loop próprio paralelo, login ChatGPT, OpenAI Platform, ferramentas hospedadas, web search, MCP externo, LangSmith, telemetria ou verificação de atualização.

## Capacidades

- Chat na Secondary Sidebar, à direita do editor.
- Estado inicial orientado a tarefas, com rascunhos editáveis para entender o projeto, corrigir um problema, implementar uma mudança ou revisar alterações sem executar nada antes do envio.
- Briefing local opcional para organizar objetivo, escopo, critério de conclusão e restrições em uma solicitação estruturada, sempre inserida como rascunho editável e nunca enviada automaticamente.
- Notificação local de conclusão ou falha quando a sidebar está oculta, com badge e ação para abrir o resultado; pode ser configurada como sempre ou nunca e não inclui conteúdo do projeto ou da conversa.
- Até 30 threads locais por workspace, com busca, fixação, troca, título automático, renomeação e exclusão; threads fixadas permanecem no topo e são protegidas da remoção automática por recência.
- Rascunho independente por thread, preservado localmente ao trocar de conversa ou recarregar a sidebar.
- Recuperação de solicitações interrompidas com **Try again**, **Edit & resend** ou descarte confirmado, sem duplicar a mensagem no contexto do agente nem apagar turnos já concluídos.
- Detecção de execução abandonada após reiniciar o Extension Host, com **Restart request** explícito e preservação do modo original.
- Coordenação defensiva entre janelas: uma execução ativa em outro processo do VS Code bloqueia uma segunda execução no mesmo workspace e oferece atualização manual de status.
- Seletor visível entre **LangChain Agent** e **Deep Agent**, persistido por workspace.
- Contexto automático do arquivo ativo, seleção, cursor, diagnósticos, arquivos abertos e amostra da árvore.
- Orientação local do repositório por `AGENTS.md` (inclusive o mais próximo do arquivo ativo), `.github/copilot-instructions.md`, `CONTRIBUTING.md` e `README.md`, com limites, precedência explícita e proteção contra links que escapem do workspace.
- Contexto fixado por seleção ou arquivo completo, com Quick Pick nativo, inspeção e remoção diretamente acima do compositor.
- Orçamento de contexto visível antes do envio, com estimativa local de tokens, percentual do limite, contribuição automática, anexos fixados, prompt e modo da memória do projeto.
- Atividade ao vivo consolidada em uma faixa expansível, com etapa atual, última ação, duração, progresso do plano e contadores de arquivos/comandos sem poluir a conversa.
- Configuração de execução progressiva: um único controle compacto resume autonomia e runtime, enquanto explicações e escolhas técnicas ficam disponíveis sob demanda sem reduzir a área de escrita.
- Navegação completa por teclado na sidebar, com foco devolvido ao controle de origem, fechamento de painéis por `Esc`, anúncios concisos para leitores de tela e suporte a alto contraste/redução de movimento.
- Centro de revisão ao final de cada execução, reunindo resultado, plano final, arquivos, diffs, restauração, comandos, saídas, verificações, memória e uso do modelo.
- Revisão por arquivo com diff nativo **before ↔ after**, restauração individual e uma ação para desfazer em conjunto todas as alterações de arquivo completamente capturadas, sempre protegidas contra a perda de edições posteriores.
- Checkpoints das threads da sessão gerenciados por `MemorySaver`, com projeções limitadas de usuário/assistente no armazenamento local do workspace para restauração após reiniciar o VS Code.
- Memória durável e auditável em `.codex-agent/memory.md`, com recuperação semântica opcional pelo ChromaDB local.
- Central de memória na sidebar para consultar, adicionar, editar e excluir entradas duráveis, abrir a fonte Markdown e compreender o modo de recuperação ativo.
- Planejamento apresentado na própria sidebar.
- Ferramentas locais para listar, pesquisar e ler arquivos sob demanda.
- Edição por substituição exata e criação de arquivos, sempre dentro do workspace.
- Execução de comandos sem shell e sempre com confirmação modal do usuário, estado de aprovação visível na atividade, aviso destacado para ações destrutivas e ambiente sem a chave LiteLLM.
- Política limitada para globs controlados pelo modelo: brace expansion é recusada e tamanho, operadores e segmentos são limitados antes dos matchers de filesystem.
- Confirmação modal obrigatória antes de qualquer exclusão solicitada pelas ferramentas de filesystem do Deep Agent.
- Modos de autonomia **Ask first**, **Auto edits** e **Plan only**, com padrão seguro persistido por workspace.
- Cancelamento de turnos e de comandos em andamento.
- Streaming de Chat Completions e function calling gerenciados por `ChatOpenAICompletions` e pelo runtime escolhido.
- Chave virtual LiteLLM armazenada exclusivamente no Secret Storage do VS Code.
- Transporte externo restrito às rotas HTTPS exatas de Chat Completions e embeddings derivadas do gateway configurado; métodos inesperados, parâmetros na URL e redirects são recusados antes que credenciais possam sair para outro destino.
- Bundle PEM corporativo opcional, importado uma vez para o armazenamento global local da extensão.
- Catálogo de modelos opcional carregado da URL informada pelo usuário com `Cache-Control: no-cache` e `api-key` usando a chave do Secret Storage.
- Aviso de primeiro uso na própria sidebar enquanto gateway, alias de chat e chave segura ainda não estiverem configurados.
- Diagnósticos acionáveis que oferecem correções locais para reasoning, sampling, header de autenticação, rota, modelo e CA corporativa; parâmetros corrigidos são testados novamente antes de o usuário salvá-los.
- Perfis de conexão JSON versionados para transportar gateway, aliases, compatibilidade, runtime e autonomia entre máquinas sem exportar chave, certificado ou qualquer credencial.
- Bundle de suporte sanitizado, gerado sob demanda, com versões, estado de configuração e resultado dos diagnósticos sem chats, prompts, caminhos, comandos, nomes de arquivos, endpoints, aliases, chaves ou certificados.

O modelo disponibilizado no LiteLLM precisa suportar **Chat Completions function calling**. A arquitetura segue a [documentação de Agents do LangChain](https://docs.langchain.com/oss/javascript/langchain/agents), a [documentação oficial de Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview), a [memória de curto prazo](https://docs.langchain.com/oss/javascript/langchain/short-term-memory) e a referência de [`ChatOpenAI`](https://reference.langchain.com/javascript/langchain-openai/ChatOpenAI).

## Pré-requisitos de uso

- Visual Studio Code 1.106 ou superior.
- Gateway LiteLLM acessível por HTTPS.
- URL base HTTPS do gateway ou URL completa terminando em `/chat/completions`.
- Alias de modelo com suporte a function calling.
- Chave de API ou subscription key esperada pelo gateway.

## Instalação para usuários

Não é necessário clonar o repositório nem instalar Node.js. Abra a página de [Releases](https://github.com/rlsgarcia-code/codex-dev-companion/releases), entre na versão mais recente e baixe o VSIX correspondente à sua máquina:

| Sistema | Arquivo |
| --- | --- |
| Windows 64 bits | `codex-dev-companion-<versão>-win32-x64.vsix` |
| macOS com Apple Silicon | `codex-dev-companion-<versão>-darwin-arm64.vsix` |
| macOS com processador Intel | `codex-dev-companion-<versão>-darwin-x64.vsix` |
| Linux 64 bits | `codex-dev-companion-<versão>-linux-x64.vsix` |
| Linux ARM64 | `codex-dev-companion-<versão>-linux-arm64.vsix` |

Depois:

1. Abra **Extensions** no VS Code.
2. Clique no menu `…` do painel.
3. Escolha **Install from VSIX…**.
4. Selecione o arquivo baixado.
5. Reinicie o VS Code quando solicitado.

Cada release inclui `SHA256SUMS.txt` para ambientes que exigem validação de integridade. O VSIX já contém a extensão e o binário local do ChromaDB para a plataforma escolhida; não é necessário Docker nem instalar um servidor Chroma separadamente.

## Desenvolvedores: gerar localmente

Requer Node.js 22 ou superior. Para gerar um VSIX da plataforma atual:

```bash
git clone https://github.com/rlsgarcia-code/codex-dev-companion.git
cd codex-dev-companion
npm ci --ignore-scripts
npm test
npm run test:extension-host
npm run package
npm run test:vsix-install -- ./codex-dev-companion-0.11.0-<plataforma>.vsix
code --install-extension ./codex-dev-companion-0.11.0-<plataforma>.vsix
```

`npm run package` detecta sistema e arquitetura, grava o `TargetPlatform` no manifesto e gera um nome explícito como `codex-dev-companion-0.11.0-win32-x64.vsix`. O VSIX contém o binário local do ChromaDB para a plataforma em que foi gerado. Gere o pacote no mesmo sistema/arquitetura em que ele será instalado (macOS arm64/x64, Linux arm64/x64 ou Windows x64). Hosts não suportados são recusados em vez de gerar um pacote incorretamente identificado como universal. Não é necessário Docker nem instalar um servidor Chroma separadamente. Os binários necessários são fornecidos por pacotes npm específicos da plataforma e o projeto desabilita scripts de lifecycle durante a instalação de dependências.

`npm run package` funciona como gate de release local: executa type-check, todos os testes, build, smoke de Chat Completions e smoke do Chroma nativo antes de criar o VSIX. Se qualquer verificação falhar, nenhum pacote novo é produzido.

Cada build também produz `dist/licenses/third-party-manifest.json` e `dist/licenses/THIRD_PARTY-LICENSES.txt` a partir das dependências que realmente entraram no bundle. Ambos seguem dentro do VSIX. O empacotamento falha se uma dependência não declarar uma licença revisada ou se o texto correspondente não estiver disponível, evitando distribuir componentes sem inventário auditável.

### Pacotes verificados pelo CI

Cada push para `main` e cada pull request executa type-check, testes, smoke local de Chat Completions e empacotamento em cinco ambientes nativos. No Linux x64 e no Windows x64, o CI também abre um perfil isolado do VS Code 1.106 e verifica ativação, comandos e os fluxos básicos da sidebar em um Extension Host real, sem credenciais nem chamada ao gateway. Depois do empacotamento, instala o VSIX recém-gerado em outro perfil vazio, prova que a cópia carregada veio do diretório de extensões instaladas e repete a ativação e os fluxos básicos; assim o arquivo distribuído, e não apenas o código-fonte, faz parte do gate:

- macOS arm64 e x64;
- Linux arm64 e x64;
- Windows x64.

Os arquivos de validação ficam disponíveis nos artifacts da execução do GitHub Actions por 14 dias. Releases versionadas publicam permanentemente os cinco VSIX nativos e um arquivo de checksums na página de [Releases](https://github.com/rlsgarcia-code/codex-dev-companion/releases). O empacotamento local com `npm run package` continua gerando o VSIX somente para a máquina atual.

O pipeline usa GitHub Actions fixadas por commit imutável. Atualizações de dependências npm e das próprias Actions chegam semanalmente como pull requests do Dependabot e precisam passar pela revisão e por todos os gates; não há atualização ou publicação automática da extensão.

Antes de promover uma versão para uso amplo, execute o [roteiro de piloto corporativo](https://github.com/rlsgarcia-code/codex-dev-companion/blob/main/docs/CORPORATE-PILOT.md) na máquina e rede de destino. Ele cobre compatibilidade do Extension Host, gateway/PEM, modelos, Chroma, duas janelas, recuperação e privacidade, e inclui um formato de retorno que não expõe dados internos.

Falhas reproduzíveis podem ser registradas pelo formulário **Relatar uma falha**, depois da revisão local do bundle sanitizado. O formulário exige confirmação explícita de que nenhum dado corporativo foi incluído. Vulnerabilidades devem usar exclusivamente o [relatório privado de segurança](https://github.com/rlsgarcia-code/codex-dev-companion/security/advisories/new).

## Primeiro uso

1. Abra uma pasta de projeto no VS Code.
2. Pressione `Ctrl/Cmd + Shift + P`.
3. Execute **Local Companion: Configure LiteLLM**.
4. Escolha o runtime e informe os valores de conexão e as capacidades do modelo abaixo.
5. Abra **Local Companion** na barra lateral direita.

O comando abre a Secondary Sidebar diretamente no único formulário de configuração da extensão. **Set up** apresenta o processo em três etapas curtas: **Gateway**, **Models** e **Verify**. A navegação só avança depois dos campos obrigatórios da etapa atual; parâmetros de compatibilidade permanecem recolhidos em **Advanced model settings**. Usuários que já possuem uma configuração também podem percorrer as etapas para revisar somente a parte desejada. Não existe um segundo wizard modal com valores ou regras diferentes.

O VS Code precisa considerar a pasta confiável antes de ativar o agente, pois a extensão lê arquivos e pode executar ferramentas locais após as confirmações aplicáveis. Ao enviar uma mensagem, uma pré-verificação exclusivamente local confirma workspace, concorrência entre janelas, gateway, chave no Secret Storage, perfil do modelo e certificado corporativo. Se algo estiver incompleto, a mensagem volta intacta ao compositor e a configuração relevante é aberta; nenhuma thread, execução ou chamada externa é criada pela pré-verificação.

O compositor entra imediatamente em **Checking local readiness** quando o usuário envia, bloqueando um segundo Enter ou clique enquanto a admissão está em andamento. O controlador mantém uma trava equivalente como defesa contra mensagens duplicadas. `Shift+Enter` continua criando uma nova linha e Enter durante composição IME nunca dispara uma solicitação prematura.

O rodapé mostra apenas um resumo como **Ask first · Standard**. Ao abri-lo, **Agent** explica quando usar o runtime previsível ou o Deep Agent para tarefas longas, e **Changes** descreve claramente o que cada nível de autonomia pode fazer. O painel flutua acima do compositor, fecha com `Esc` ou clique externo e fica indisponível durante execuções locais ou em outra janela.

Use **Brief** quando ainda não souber como escrever uma solicitação técnica. O formulário guarda localmente um objetivo obrigatório e campos opcionais de escopo, conclusão e restrições, todos limitados. **Use in message** acrescenta uma estrutura clara ao rascunho atual, inclui um acordo de trabalho para planejar e validar, e devolve o foco ao compositor. Nenhuma chamada ao gateway é feita e nada é executado até o envio explícito; **Clear** apaga somente os campos do briefing, sem alterar o rascunho da conversa.

Use **＋ File** acima do compositor para localizar e anexar um arquivo do workspace à próxima conversa. Para um trecho específico, selecione o código no editor e execute **Local Companion: Add Selection to Context**. O inspetor mostra exatamente quais itens estão fixados, quais arquivos de orientação serão incluídos, a estimativa de tokens, o uso do limite configurado, o modo da memória e o custo aproximado do prompt antes do envio. A seleção fica bloqueada durante a execução para deixar claro qual contexto pertence à solicitação em andamento. A estimativa local usa quatro caracteres por token; o uso exato continua sendo exibido a partir da resposta do provedor.

Ao final, **Review run** inclui um recibo local de contexto sem copiar seu conteúdo: arquivo ativo, quantidade de diagnósticos e caminhos amostrados, nomes das orientações incluídas, fontes fixadas, modo da memória, uso do orçamento e indicação de truncamento ou fallback semântico. Assim é possível auditar por que o agente recebeu determinada informação sem gravar uma segunda cópia dos arquivos ou da memória.

Tarefas longas podem continuar enquanto a sidebar estiver oculta. Por padrão, o VS Code mostra uma notificação genérica e um badge somente quando a execução termina ou falha fora de vista; a ação **Open result** retorna diretamente à conversa. A mensagem não inclui pedido, resposta, nome do projeto, caminho ou modelo. Procure por **Local Dev Companion: Completion Notifications** nas configurações do VS Code para escolher entre **whenHidden**, **always** e **never**. Execuções canceladas não geram notificação.

Ao selecionar **Cancel run**, a interface primeiro mostra **Stopping…** e desabilita novos cliques enquanto o runtime propaga o sinal para a recuperação de embeddings, a chamada do modelo e as ferramentas locais. A execução só recebe o resultado **Run cancelled** depois que o runtime confirma a interrupção; uma solicitação de parada nunca é apresentada antecipadamente como tarefa já cancelada. O pedido permanece disponível para edição ou nova execução.

Solicitações canceladas, com erro ou interrompidas também oferecem **Discard request**. A confirmação remove somente a última mensagem de usuário sem resposta e preserva todos os turnos completos anteriores. O checkpoint local daquela thread é limpo para que uma execução futura seja reconstruída apenas a partir do histórico visível. Alterações de arquivos, comandos e memória que já tenham ocorrido não são revertidas por essa ação e continuam disponíveis na revisão da execução.

Contexto fixado é uma escolha explícita do usuário: ele permanece incluído mesmo quando `autoContext` está desligado e recebe prioridade quando o limite é atingido. Com contexto automático ativo, a extensão também lê localmente orientações padrão do repositório. Um `AGENTS.md` mais próximo do arquivo ativo é tratado como mais específico que o da raiz; os demais documentos fornecem contexto geral. Essa orientação permanece abaixo do pedido do usuário e das regras operacionais da extensão, recebe uma faixa própria no orçamento e nunca é gravada na memória. Cada arquivo e o conjunto total têm limites, arquivos binários ou grandes são ignorados e links simbólicos para fora do workspace não são lidos. A interface avisa quando haverá truncamento. Arquivos reconhecidos como sensíveis são identificados como excluídos e não contribuem com nome, seleção, diagnósticos ou lista de arquivos abertos para o contexto automático.

Clique em **Memory** para abrir a central local de conhecimento do projeto. Ela apresenta as entradas mais recentes, informa se a recuperação usa memória recente ou embeddings, permite incluir e editar fatos confirmados e exige confirmação modal antes de excluir. **Open memory.md** continua disponível para revisão completa. Alterações preservam o Markdown como fonte de verdade e são reindexadas automaticamente na próxima recuperação semântica; edições pela central ficam bloqueadas durante uma execução ativa para evitar concorrência com o agente.

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

Se for informada uma URL base, a extensão acrescenta `/chat/completions`. Se a rota completa já for informada, ela será usada sem duplicação. Caminhos corporativos intermediários são aceitos; query parameters são recusados para evitar que segredos sejam gravados em settings.

Também é possível trocar o runtime e a autonomia diretamente nos dois seletores do compositor. **Ask first** pede confirmação antes de cada edição, atualização de memória ou comando; **Auto edits** aplica edições de arquivo e memória automaticamente, mas continua pedindo confirmação para comandos e exclusões; **Plan only** disponibiliza somente leitura e planejamento. A escolha de autonomia vale para o workspace atual. Clique em **LiteLLM** no rodapé para alterar URL, alias, cabeçalho ou chave. Informe **Models URL** e clique em **Load** para preencher os aliases; essa consulta usa `GET`, `Cache-Control: no-cache` e `api-key: <chave>`. As opções de reasoning, temperatura, Top P e perfil de compatibilidade ficam recolhidas em **Advanced model settings** e são lembradas separadamente para cada alias exato. Se a chave ficar vazia, o valor já armazenado no Secret Storage é preservado. Use **Corporate CA…** na etapa Gateway para importar, substituir ou remover o certificado sem refazer as demais etapas. A cópia importada fica somente no armazenamento global local da extensão e é reutilizada por todas as janelas e workspaces do mesmo perfil e ambiente do VS Code.

Antes de salvar, clique em **Test connection**. O diagnóstico valida os campos localmente e testa, em sequência, o catálogo configurado, o modelo de Chat Completions com streaming e metadados de function tools e, quando habilitado, o modelo de embeddings. Cada etapa apresenta resultado e duração separadamente. O teste de chat não executa ferramentas, e o teste de embeddings envia apenas uma frase fixa de diagnóstico.

Ao informar o alias de chat, um resumo de compatibilidade aparece imediatamente fora das opções avançadas. Ele diferencia perfil reconhecido e pronto para teste, exigência de `reasoning_effort: none`, modelo conhecido por depender da Responses API e alias corporativo cuja capacidade não pode ser inferida. A indicação é preventiva e nunca substitui **Test connection**, que valida o deployment real do gateway.

Use **Export profile** para salvar um JSON versionado com as configurações não sensíveis da conexão, modelos e workspace. Em outra máquina, **Import profile** valida o formato, apresenta gateway/modelo/runtime para confirmação e aplica somente os campos reconhecidos. A chave permanece separada no Secret Storage e a CA corporativa precisa ser importada localmente quando o perfil indicar essa dependência. Arquivos acima de 256 KB, versões desconhecidas, campos extras, URLs sem HTTPS e qualquer propriedade com aparência de credencial são recusados. Depois da importação, execute **Test connection** antes de usar o agente.

Se precisar de ajuda para diagnosticar uma instalação, clique em **Export support**. O JSON contém versões do aplicativo, plataforma, contagens limitadas e somente o estado booleano das configurações e dos testes. Ele não contém conversas, prompts, conteúdo do workspace, caminhos, comandos, nomes de arquivo, endpoints, aliases de modelo, chave ou certificado. A exportação é totalmente local e só ocorre depois que você escolhe onde salvar. Mesmo assim, revise o arquivo antes de compartilhá-lo conforme a política da sua empresa.

Quando a causa é reconhecida, o próprio resultado apresenta uma ação específica. Por exemplo, é possível aplicar `reasoning_effort: none`, omitir Temperature/Top P ou trocar o header da chave e repetir o teste automaticamente. Correções de URL, alias, chave ou CA apenas direcionam o usuário ao controle apropriado porque esses valores não devem ser adivinhados. Uma correção validada continua pendente até o usuário clicar em **Save connection**.

Para ativar recuperação semântica, abra **LiteLLM**, informe **Models URL**, clique em **Load** e selecione um alias em **Embedding Model**. Uma única consulta alimenta os dois seletores: aliases que contêm `embedd` (sem diferenciar maiúsculas de minúsculas) aparecem somente na lista de embeddings, enquanto os demais aparecem somente na lista de chat. A extensão deriva `POST /embeddings` da mesma base LiteLLM usada por Chat Completions, inicia o ChromaDB empacotado em `127.0.0.1`, salva os vetores no armazenamento privado local do VS Code e indexa somente entradas de `.codex-agent/memory.md`. O arquivo Markdown continua sendo a fonte de verdade legível e versionável. A mesma chave, cabeçalho e CA do gateway são reutilizados; nenhum dado é enviado ao Chroma Cloud.

O serviço Chroma é iniciado sob demanda e compartilhado de forma defensiva entre janelas por um lock de inicialização e leases de clientes identificados pelo processo. Fechar uma janela preserva o serviço enquanto outro Extension Host ainda o utiliza; o último cliente vivo encerra o processo local. Leases órfãos são removidos automaticamente. Heartbeats são aceitos somente no formato esperado da API local. Se a memória vetorial falhar, a execução continua com `memory.md` e registra a causa exata na revisão do turno.

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

1. recupera a thread local selecionada e salva imediatamente a mensagem do usuário; em uma recuperação, substitui a solicitação pendente em vez de duplicá-la;
2. coleta o contexto atual do editor;
3. lê a memória durável do projeto;
4. recupera o checkpoint pelo `MemorySaver` ou restaura sua projeção local limitada e aplica o middleware de janela de contexto;
5. quando configurado, indexa e consulta a memória do projeto no ChromaDB local por meio do vector store LangChain;
6. instancia `ChatOpenAICompletions` sobre a base URL do LiteLLM;
7. entrega mensagens e ferramentas ao `createAgent` ou `createDeepAgent`, conforme a escolha do usuário;
8. valida cada chamada por schema Zod e executa a ferramenta local correspondente;
9. deixa o runtime LangChain devolver resultados como `ToolMessage` e repetir o ciclo até a resposta final.

No **LangChain Agent**, a janela de conversa é limitada por middleware e todas as ferramentas são as implementações locais explícitas do projeto. No **Deep Agent**, a orquestração de tarefas longas, a compactação, o filesystem e a delegação para subagentes vêm de `deepagents`; o limite artificial de 50 passos foi removido em favor do limite nativo alto do Deep Agent. O projeto fica montado em `/workspace`, enquanto o `StateBackend` mantém arquivos grandes/offload no estado LangGraph. O plano visível continua sendo publicado pela ferramenta local `update_plan`.

Durante uma execução, a thread persiste apenas metadados mínimos da tentativa — identificador, modo, runtime, horários e processo proprietário. Um lease atômico separado, mantido no armazenamento privado global da extensão e nunca no repositório, impede que duas janelas executem o agente simultaneamente sobre o mesmo workspace. Se o processo proprietário desaparecer antes de salvar a resposta, o lease pode ser recuperado e a tentativa passa para **interrupted**. O botão **Restart request** repete o último pedido desde o início usando a projeção local restaurada; ele não afirma continuar do ponto exato de um checkpoint perdido. `MemorySaver` permanece o único checkpointer do runtime LangGraph.

Não existe cliente HTTP alternativo nem loop manual de function calling no projeto. A classe `ChatOpenAICompletions` força o caminho Chat Completions e não usa Responses API. O tracing externo do LangChain/LangSmith é explicitamente desativado pelo runtime.

As ferramentas de leitura usam caminhos relativos e validam caminhos reais para impedir escape por `..` ou links simbólicos. Os comandos não passam por um shell, sempre exigem confirmação e recebem somente um conjunto mínimo de variáveis do sistema — nunca a chave do LiteLLM. A política local bloqueia interpretadores de shell, código inline, wrappers de comandos, clientes de rede, URLs remotas, downloads/publicações por gerenciadores de pacotes e operações Git remotas. Comandos capazes de remover ou descartar dados recebem um aviso destrutivo específico antes da execução.

No modo **Ask first**, cada `edit_file`, `create_file`, atualização de memória, escrita/edição do backend do Deep Agent e comando pausa no ponto da ferramenta para aprovação local. No modo **Auto edits**, escritas de arquivo e memória podem prosseguir automaticamente, mas comandos e exclusões continuam confirmados porque a extensão não afirma oferecer um sandbox de sistema operacional. Uma recusa é devolvida ao próprio loop LangChain como resultado da ferramenta e nunca é tratada como autorização implícita para tentar novamente.

Enquanto a confirmação modal aguarda, a faixa de execução mostra **Waiting for your approval**, a categoria, o alvo e o risco já sanitizados. Depois da decisão, a mesma linha registra **Approved** ou **Declined** e o agente continua ou recebe a recusa como resultado da ferramenta. Comandos, alterações padrão, exclusões destrutivas e leituras sensíveis usam a mesma apresentação local; nenhuma aprovação é inferida por timeout ou repetição.

As escritas diretas do agente são acompanhadas por snapshots locais limitados e mantidos somente em memória. O LangChain Agent registra as operações de suas ferramentas explícitas; o Deep Agent usa uma subclasse auditável do `FilesystemBackend` oficial dentro do mesmo `CompositeBackend`. Ao selecionar **Diff**, o VS Code abre a comparação imutável do conteúdo anterior e posterior à execução. **Restore** só é aplicado quando o arquivo atual ainda corresponde exatamente ao snapshot posterior; caso contrário, a operação é recusada para preservar edições mais recentes.

Ao final do turno, **Review run** abre uma gaveta única de evidências. Ela preserva até dez revisões na sessão da sidebar, associa cada botão ao turno correto e diferencia verificações conhecidas de outros comandos. Quando todos os arquivos da execução foram capturados, **Undo all file changes** pré-valida o conjunto inteiro e aplica uma única edição do workspace; se qualquer arquivo tiver mudado depois, nenhum deles é restaurado. A ação é intencionalmente descrita como restauração de arquivos: comandos e atualizações de memória não são revertidos. Se houve snapshots omitidos por tamanho ou limite, a ação em conjunto não é oferecida. Depois que a edição é aplicada, todos os documentos restaurados são salvos; uma falha isolada de gravação não impede as demais tentativas nem deixa o estado da revisão incorreto, e a interface identifica os documentos que precisam ser salvos manualmente. Saídas são mantidas limitadas e mudanças feitas por comandos continuam sendo conferidas pelo Source Control.

Cada resposta do agente oferece ações discretas para **Copy** e **Add memory…**. A cópia usa o clipboard local do VS Code. A ação de memória abre o mesmo formulário vazio e validado da central, exigindo que o usuário registre uma decisão, fato ou convenção concisa; o texto bruto da resposta nunca é usado como entrada automática de `memory.md`.

Conversas longas mostram inicialmente os turnos completos mais recentes. Mensagens anteriores permanecem na projeção local da thread e podem ser reveladas em blocos pelo controle **Show earlier messages**; a posição de leitura é preservada e o limite nunca separa artificialmente uma resposta do pedido imediatamente anterior.

Respostas são formatadas por um renderizador Markdown local e coberto por testes para títulos, listas, citações, ênfase, código inline e blocos com ou sem linguagem. HTML do modelo é sempre escapado, links permanecem texto inerte e blocos sem rótulo preservam a primeira linha; a webview recebe apenas o HTML já sanitizado pela extensão.

O Deep Agent não pode excluir silenciosamente um caminho em nenhum modo: cada chamada à operação `delete` interrompe o backend para uma confirmação modal com o alvo exato. Diretórios são identificados como potencialmente recursivos no aviso, pois a revisão consegue restaurar arquivos de texto rastreados, mas não reconstruir com segurança uma árvore inteira removida.

No modo **Plan only**, ferramentas de escrita, memória e execução de comandos não são disponibilizadas. No Deep Agent, o middleware de filesystem também aplica permissão de escrita negada como defesa adicional.

## Desenvolvimento

```bash
npm install
npm run check
npm run build
npm test
npm run smoke:litellm
npm run smoke:chroma
```

Abra esta pasta no VS Code e pressione `F5`. Na janela **Extension Development Host**, abra uma pasta de código e clique em **Local Companion** na Secondary Sidebar.

Antes de contribuir, leia [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilidades devem seguir [SECURITY.md](SECURITY.md), sem publicar credenciais, endpoints corporativos ou provas de conceito sensíveis em issues.

Para recompilar continuamente:

```bash
npm run watch
```

Para gerar e reinstalar o pacote:

```bash
npm run package
code --install-extension codex-dev-companion-0.11.0.vsix
```

## Memória

O arquivo `.codex-agent/memory.md` é a fonte de verdade da memória do projeto. Ele deve conter somente decisões, fatos e convenções duráveis e verificáveis. A central da sidebar projeta no máximo 200 entradas recentes sem criar um segundo armazenamento; entradas antigas continuam preservadas no Markdown. Cada entrada gerenciada tem limite de 4.000 caracteres e o arquivo é recusado para mutações automáticas acima de 2 MB, evitando regravações parciais. Quando um alias de embeddings está configurado, a extensão transforma essas entradas em chunks limitados, gera embeddings pelo LiteLLM e mantém o índice no ChromaDB local.

Nunca armazene nele credenciais, tokens, dados pessoais, hipóteses, status transitório ou transcrições do chat.

## Segurança e privacidade

- A chave LiteLLM fica exclusivamente no Secret Storage do VS Code.
- A chave não é escrita em settings, logs, prompts, memória ou arquivos do projeto.
- Perfis exportados declaram que uma chave local é necessária, mas nunca contêm a chave ou o certificado corporativo; a importação não altera o segredo já armazenado.
- Erros operacionais, diagnósticos, resultados de leitura/pesquisa e stdout/stderr passam por remoção local de chaves conhecidas, cabeçalhos de autenticação, credenciais em URLs, tokens comuns e blocos de chave privada antes de aparecerem na interface ou retornarem ao modelo.
- A memória do projeto recusa entradas que contenham a chave configurada ou padrões reconhecíveis de credenciais; mensagens normais do usuário e respostas do agente não são reescritas silenciosamente.
- Arquivos normalmente usados para credenciais — como `.env`, `.npmrc`, PEM/chaves privadas, keystores, `tfvars` e credenciais cloud — ficam fora do contexto automático, do seletor e de buscas amplas. Uma leitura direta exige confirmação local para aquele arquivo e ainda remove padrões reconhecidos antes de enviar o texto ao modelo.
- Conversas ficam somente no `workspaceState` local e limitado do VS Code; não são copiadas para `.codex-agent/memory.md`.
- O endpoint precisa usar HTTPS.
- O certificado PEM opcional é validado e copiado para o armazenamento global local da extensão; o caminho original não é persistido.
- Arquivos só podem ser lidos ou alterados dentro do workspace aberto.
- Comandos são executados diretamente, sem shell, depois de confirmação do usuário.
- Interpretadores, código inline, wrappers, clientes de rede e operações de download, publicação e Git remoto são bloqueados nas ferramentas do agente.
- A política de comandos é uma defesa local em profundidade, não um sandbox do sistema operacional: um script já presente no workspace e aprovado pelo usuário pode conter comportamento próprio. Revise o comando e os scripts associados antes de autorizar.
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
| `codexDevCompanion.autonomyMode` | `review` | Autonomia padrão do workspace: `review`, `execute` ou `plan`. |
| `codexDevCompanion.liteLlmModelProfiles` | `{}` | Preset e parâmetros opcionais de reasoning/sampling por alias; campos ausentes não são enviados. |
| `codexDevCompanion.gatewayCaCertificatePath` | vazio | Configuração legada por workspace; certificados existentes são migrados automaticamente para o armazenamento global local. |
| `codexDevCompanion.autoContext` | `true` | Inclui contexto atual do editor e orientação padrão do repositório. |
| `codexDevCompanion.maxContextCharacters` | `24000` | Limite do contexto coletado por turno. |
| `codexDevCompanion.maxConversationCharacters` | `48000` | Limite do histórico recente enviado ao modelo. |
| `codexDevCompanion.semanticMemoryEnabled` | `true` | Habilita recuperação semântica local quando há alias de embeddings. |
| `codexDevCompanion.embeddingModel` | vazio | Alias LiteLLM usado em `POST /embeddings`; vazio mantém somente memória textual. |
| `codexDevCompanion.semanticMemoryResults` | `5` | Número máximo de chunks relevantes recuperados por turno. |
| `codexDevCompanion.standardRecursionLimit` | `200` | Limite LangGraph do runtime padrão; o Deep Agent usa o limite nativo alto. |

O prefixo `codexDevCompanion` foi mantido para que configurações e segredos de instalações anteriores continuem válidos.

## Arquitetura

```text
VS Code Secondary Sidebar
    │
    ├── AgentViewProvider ── chat, threads, timeline, plano e configurações
    ├── ContextCollector ─── editor, seleção, diagnósticos, arquivos e orientação do projeto
    ├── ProjectMemory ────── .codex-agent/memory.md (fonte de verdade)
    ├── ChangeReviewManager  snapshots efêmeros, diff e restauração protegida
    └── DevelopmentAgent ─── orquestra primitivas LangChain
            │
            ├── runtime escolhido por workspace
            │     ├── createAgent · enxuto e explícito
            │     └── createDeepAgent · planejamento, compactação e subagentes
            ├── MemorySaver + até 30 projeções locais limitadas
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
- A extensão não executa um sandbox de sistema operacional. Por isso, comandos exigem confirmação explícita em todos os modos e recebem um ambiente mínimo.
- O LangChain Agent mantém turnos recentes inteiros dentro do limite configurado. O Deep Agent pode compactar conversas antigas usando o mesmo modelo via LiteLLM.
- Cada workspace mantém no máximo 30 threads; cada projeção conserva até 30 mensagens recentes e também respeita `maxConversationCharacters`.
- Cada thread pode manter um rascunho local de até 50 mil caracteres no `workspaceState`; o rascunho é removido ao enviar ou excluir a thread.
- A revisão mantém em memória somente as cinco execuções mais recentes, até 50 arquivos e 6 MB por lado de snapshot em cada execução. Arquivos excedentes são sinalizados na interface.
- A revisão detalhada cobre escritas feitas pelas ferramentas de arquivo. Comandos aprovados podem alterar arquivos adicionais; o Source Control continua sendo a visão completa do workspace.
- A memória semântica requer que o gateway disponibilize um modelo compatível com a API OpenAI de embeddings.
- O pacote VSIX é específico de plataforma por conter o binário local do ChromaDB.
- O inventário de terceiros é derivado do bundle no momento do build; consulte `dist/licenses/third-party-manifest.json` para versões, licenças, fontes e alertas de conformidade exatos do pacote gerado.
- Não há suporte a ferramentas hospedadas, web search, MCP remoto ou execução em nuvem.
