# Política de segurança

## Versões suportadas

Enquanto o projeto estiver antes da versão `1.0.0`, somente a versão mais recente da linha `0.x` e o branch `main` recebem correções de segurança.

## Como reportar uma vulnerabilidade

Use **Security → Report a vulnerability** no repositório GitHub para enviar um relatório privado. Inclua:

- versão da extensão e plataforma;
- impacto observado;
- passos mínimos para reprodução;
- arquivos ou componentes afetados;
- mitigação conhecida, se houver.

Não inclua chaves, certificados, endpoints corporativos, código proprietário ou conversas reais. Use valores fictícios e um workspace mínimo.

Se o relatório privado não estiver disponível, abra apenas uma issue sem detalhes sensíveis solicitando um canal privado. Não publique provas de conceito exploráveis antes da correção.

## Escopo prioritário

São especialmente relevantes:

- escape do workspace por caminhos ou links simbólicos;
- exposição da chave LiteLLM ou do certificado corporativo;
- chamadas de rede fora das rotas configuradas;
- execução de shell ou comando sem aprovação;
- bypass das confirmações de exclusão ou restauração;
- persistência indevida de conversas, prompts ou dados pessoais;
- execução concorrente capaz de corromper o workspace.

## Proteções locais de credenciais

A chave configurada permanece no Secret Storage do VS Code. Antes de exibir ou devolver dados operacionais ao modelo, a extensão remove localmente a chave conhecida e padrões reconhecíveis de cabeçalhos de autenticação, credenciais em URLs, tokens, senhas e chaves privadas. A mesma proteção cobre diagnósticos, falhas de ferramentas e saídas de comandos, e a memória durável recusa conteúdo detectado como credencial.

O transporte do modelo aceita somente `POST` para as rotas HTTPS exatas de Chat Completions e embeddings derivadas do gateway configurado. Query strings, credenciais na URL, outra origem, outro caminho, outro método e redirects são bloqueados antes da chamada. O catálogo usa somente o endpoint HTTPS explícito, `GET`, `Cache-Control: no-cache` e `api-key`, também sem seguir redirects. Isso impede que uma resposta 3xx encaminhe a chave para uma origem não configurada.

Essa filtragem é defesa em profundidade, não um detector universal de segredos. Não cole credenciais em mensagens, arquivos de contexto ou comandos; revogue imediatamente qualquer segredo que possa ter sido exposto.

A central de memória aplica a mesma filtragem antes de renderizar entradas, não preenche um formulário de edição com conteúdo detectado como credencial e recusa novas entradas sensíveis ou maiores que o limite local. Inclusões, edições e exclusões pela central são bloqueadas enquanto qualquer janela mantém uma execução ativa no workspace; exclusões também exigem confirmação modal.

A ação **Add memory…** exibida em respostas não envia o conteúdo da conversa para a memória. Ela abre um campo vazio para uma anotação explícita e validada, usando o mesmo limite e a mesma filtragem da central. A webview não possui uma mensagem genérica capaz de gravar texto arbitrário da resposta diretamente em `memory.md`.

Perfis de conexão são estritamente versionados e incluem somente endpoint HTTPS, catálogo, aliases, parâmetros compatíveis e preferências de runtime. A exportação nunca inclui chave ou bytes do certificado. A importação limita o tamanho do arquivo, rejeita campos desconhecidos e nomes associados a segredos, exige confirmação humana e preserva o conteúdo existente do Secret Storage. Alterações de provedor também ficam bloqueadas enquanto houver uma execução ativa no workspace.

Bundles de suporte seguem um esquema separado e deliberadamente mais restrito. Eles registram somente versões, plataforma, contagens limitadas, estados booleanos de configuração e o resultado sanitizado dos diagnósticos. Detalhes e rótulos dos testes são descartados; endpoints, aliases, conversas, prompts, caminhos, comandos, nomes de arquivos, chave e certificado não são serializados. A extensão salva o arquivo somente no destino escolhido pelo usuário e nunca o envia. Revise o JSON antes de compartilhá-lo, pois políticas corporativas podem considerar até metadados técnicos como internos.

O Markdown das mensagens é convertido localmente antes de chegar à webview. O renderizador escapa HTML e caracteres de controle, aceita somente uma classe de linguagem estritamente limitada para blocos de código e não cria links, imagens, scripts ou handlers a partir do texto do modelo. A webview conserva um fallback de texto escapado e não executa um parser permissivo sobre conteúdo do chat.

A webview opera com `default-src 'none'`, estilos e scripts protegidos por nonce e sem origens de rede liberadas. Toda mensagem recebida pelo Extension Host passa por um protocolo Zod discriminado, estrito e limitado por tamanho antes de alcançar qualquer ação. Tipos desconhecidos, campos extras, identificadores ou textos excessivos e diagnósticos não serializáveis são recusados sem ecoar o conteúdo; uma barreira global transforma exceções inesperadas em erro local sanitizado.

Arquivos com nomes ou extensões normalmente associados a credenciais não entram no contexto automático nem em buscas amplas. Isso inclui o nome do arquivo ativo, sua seleção, seus diagnósticos e sua presença na lista de arquivos abertos. A sidebar indica localmente que o arquivo foi excluído, sem enviar esses metadados ao modelo. Se o agente solicitar diretamente um desses arquivos, a extensão exige confirmação local para uma única leitura e aplica a filtragem antes de devolver o conteúdo ao runtime.

As aprovações do runtime passam por um único apresentador local. O modal continua sendo a autoridade da decisão; a timeline recebe apenas uma projeção sanitizada do estado aguardando/aprovado/recusado para explicar por que a execução pausou. Não existe aprovação automática por timeout, repetição, perda de foco ou fechamento da sidebar.

A extensão declara que workspaces não confiáveis não são suportados. Antes de aceitar uma solicitação, uma pré-verificação local confirma confiança, exclusividade da execução, presença da conexão e chave, compatibilidade do perfil do modelo e leitura segura do certificado. Falhas preservam o rascunho e não persistem a mensagem como execução iniciada. As mesmas validações críticas são repetidas depois da aquisição do lease e antes de alterar o estado da thread, evitando que uma corrida entre janelas ou uma mudança de configuração contorne a verificação inicial.

O cancelamento é propagado pelo mesmo `AbortSignal` para chamadas do modelo, embeddings e ferramentas que executam comandos. A interface distingue a solicitação **Stopping…** do resultado confirmado **Run cancelled**, impede solicitações repetidas e verifica novamente o sinal antes de persistir uma resposta final. Operações locais que já entraram em uma chamada indivisível podem precisar retornar ao runtime antes da confirmação visual; não há encerramento forçado do processo do VS Code.

As ferramentas de navegador exigem uma aprovação modal antes de iniciar cada origem de aplicação local. O transporte do navegador aceita somente `http`, `https`, `ws` e `wss` em endereços de loopback; requisições para outras origens são interrompidas e reportadas sem caminho ou query. O contexto é efêmero, service workers e downloads ficam desabilitados e a ferramenta de preenchimento recusa campos de senha. A extensão usa somente Edge, Chrome ou um executável Chromium explicitamente configurado que já esteja instalado; ela não baixa navegador nem instala dependências de sistema.

Texto visível, metadados de controles, console e screenshots são dados do projeto enviados ao alias LiteLLM configurado quando o agente usa essas ferramentas. O modal explica esse limite antes da autorização. Capturas são limitadas, sobrescritas no armazenamento privado local da extensão e apagadas ao encerrar a sessão; elas não entram no repositório, na memória durável nem no bundle de suporte. A janela exibida ao usuário e a sessão automatizada não compartilham cookies ou credenciais.

## Dependências e exceções temporárias

O CI executa `npm run audit:prod` e bloqueia vulnerabilidades de produção `high` ou `critical`. Uma exceção só é aceita quando identifica o advisory e o pacote exatos, documenta a ausência de correção upstream, aponta uma mitigação verificável no código e possui prazo de expiração. A política versionada fica em `security-audit-exceptions.json`; ao expirar, o gate volta a falhar até que o risco seja removido ou revisto explicitamente.

As GitHub Actions usadas para testar, empacotar e publicar a extensão são fixadas por SHA completo, com uma versão legível e revisável preservada em comentário. O Dependabot verifica semanalmente tanto o lockfile npm quanto essas referências e propõe alterações por pull request; nenhuma atualização é aplicada ou publicada automaticamente.

O advisory `GHSA-vfj7-8cjw-p6xm` afeta o `braces` trazido pelo Deep Agents e não possui versão corrigida. A extensão não expõe brace expansion: padrões de glob controlados pelo modelo são limitados em tamanho, operadores e segmentos, e qualquer `{` ou `}` é recusado antes de alcançar `micromatch` ou `fast-glob`. Globs comuns como `src/**/*.ts` continuam disponíveis. Testes exercitam tanto a política pura quanto o backend real do Deep Agent. A exceção tem validade limitada e deve ser removida assim que a dependência deixar de estar vulnerável.

## Expectativa de tratamento

O recebimento deve ser confirmado assim que um mantenedor revisar o relatório. A correção será desenvolvida e validada em privado quando o risco exigir embargo; a divulgação coordenada ocorrerá depois que uma versão corrigida estiver disponível.
