# Piloto corporativo

Este roteiro valida o Local Dev Companion na máquina e na rede em que ele será realmente usado. Não registre nem compartilhe chave, endpoint, certificado, prompt, caminho interno ou conteúdo de arquivos.

## Antes de começar

Registre apenas informações não sensíveis:

- versão completa do Visual Studio Code;
- sistema operacional e arquitetura (`x64` ou `arm64`);
- execução local, Remote SSH, WSL ou Dev Container;
- nome do arquivo VSIX e SHA-256;
- runtime escolhido: LangChain Agent ou Deep Agent;
- família do modelo: GPT, Claude ou alias corporativo não identificável.

Instale o VSIX correspondente ao sistema em que o **Extension Host** executa. Em uma janela Remote SSH, WSL ou Dev Container, esse sistema pode ser diferente do computador que mostra a interface.

## Validação essencial

1. Instale o VSIX em um perfil de teste do VS Code e reinicie a janela. Ao substituir outro build com o mesmo número de versão, use `code --install-extension <arquivo>.vsix --force` e execute **Developer: Reload Window**.
2. Abra **Developer: Show Running Extensions** e confirme que **Local Dev Companion** está ativo e sem erro.
3. Abra a sidebar direita, crie duas threads, alterne entre elas e recarregue a janela. Os rascunhos e títulos devem permanecer corretos, sem congelamento.
4. Configure gateway, alias, chave segura e, se necessário, importe o PEM. Feche e abra outra janela do VS Code; a conexão deve continuar funcionando sem solicitar o PEM novamente.
5. Execute **Test connection**. O catálogo, Chat Completions com tool metadata e embeddings opcionais devem informar resultados separados e acionáveis.
6. Em **Plan only**, peça uma análise de um arquivo. Nenhum arquivo, memória ou comando deve ser alterado.
7. Em **Ask first**, solicite uma pequena edição reversível. A confirmação deve aparecer antes da gravação; confira o diff em **Review run** e restaure o arquivo.
8. Solicite um comando local somente de leitura. Confirme que há aprovação explícita, saída limitada e nenhuma chave no ambiente ou na revisão.
9. Tente um comando de rede ou shell indireto. A política local deve bloqueá-lo antes da execução.
10. Configure um modelo de embeddings, adicione uma nota não sensível à memória e confirme recuperação semântica. Docker não deve ser necessário.
11. Abra uma segunda janela no mesmo workspace durante uma execução. Apenas uma janela deve manter a execução; a outra deve explicar o bloqueio e se recuperar quando a primeira terminar.
12. Inicie uma tarefa longa e confirme que a resposta cresce em uma única mensagem sem forçar a rolagem enquanto você lê o histórico. Recolha a faixa de atividade, cancele durante o texto e recarregue a janela: a resposta parcial deve reaparecer marcada como incompleta, e a solicitação deve oferecer recuperação explícita sem duplicar mensagens.
13. Repita uma tarefa curta com cada perfil de modelo disponível. Altere `reasoning_effort`, `temperature` e `top_p` somente quando o modelo suportar; erros incompatíveis devem oferecer uma correção explícita, nunca silenciosa.
14. Inicie uma aplicação de teste no workspace e peça ao agente para abrir sua URL de `localhost`. Confirme que o modal aparece antes do acesso, a página é exibida para acompanhamento e DOM, controles e console são inspecionados.
15. Faça a página tentar carregar um recurso remoto e confirme que ele aparece como bloqueado. Verifique também que campo de senha, download e URL não local não podem ser usados pela automação.
16. Com um alias multimodal, solicite uma conferência visual depois de alterar a interface. Com um alias somente de texto, confirme que a falha visual é explicada e que a inspeção estrutural continua utilizável.
17. Peça a identificação de símbolo, referências e Problems de um arquivo suportado pelo VS Code. Confirme que uma comparação após a edição não apresenta diagnósticos novos inesperados.
18. Inicie um servidor de desenvolvimento pelo agente. Confirme aprovação, readiness em `localhost`, logs limitados, reinício e encerramento sem prompt administrativo nem processo órfão.
19. Adicione um playbook fictício em `.codex-agent/playbooks`, peça o fluxo correspondente e confirme que o arquivo é tratado como orientação, não como comando automático.
20. Faça uma pequena mudança com **Final review** em `changes`. A revisão deve citar somente evidência existente, expor verificações ausentes e nunca enviar conteúdo de `.env`, PEM ou outro caminho sensível.
21. Em uma mudança visual, capture um estado anterior e compare com o resultado final. Confirme que **Review run** mostra a observação textual e que nenhuma imagem foi gravada no repositório.
22. Copie um template MCP corporativo com placeholders e headers sensíveis. Importe-o pelo ícone de plugue, confirme que os segredos não aparecem em settings, memória, logs ou arquivos, e execute **Test connection**; nenhuma ferramenta ou SQL deve rodar nesse teste.
23. Em **Ask first**, peça uma consulta usando uma ferramenta MCP permitida. Confirme o modal antes da chamada, recuse uma vez para verificar que não há contorno e depois aprove uma chamada de leitura. Em **Plan only**, confirme que nenhuma ferramenta MCP fica disponível.

## Critério de aprovação

O piloto passa quando:

- nenhuma ativação, nova thread, troca de janela ou cancelamento congela a interface;
- nenhum arquivo fora do workspace é lido ou alterado;
- nenhuma mutação ou comando ocorre sem a política de autonomia correspondente;
- chave, endpoint, PEM e conteúdo do projeto não aparecem em logs, memória ou bundle de suporte;
- os dois runtimes completam pelo menos uma tarefa curta;
- o Chroma inicia e encerra localmente em duas janelas sem disputa;
- a validação de navegador funciona com Edge/Chrome já instalado, sem download, elevação ou tráfego não local;
- inteligência VS Code, mapa estrutural, processos gerenciados, playbooks e revisão final operam sob a conta comum do usuário, sem instalação de serviço ou solicitação administrativa;
- MCP corporativo usa somente a URL HTTPS ou o comando `stdio` importado e aprovado, expõe apenas a allowlist selecionada e nunca persiste credenciais fora do Secret Storage;
- três sessões consecutivas terminam sem falha não recuperável.

## Retorno de falha

Use **Export support bundle** na sidebar e envie somente o JSON sanitizado gerado pela extensão, acompanhado deste resumo:

```text
VS Code:
Sistema/arquitetura:
Local, Remote SSH, WSL ou Dev Container:
VSIX e SHA-256:
Runtime:
Família do modelo:
Etapa do roteiro:
Resultado esperado:
Resultado observado:
O problema se repete após Reload Window? sim/não
```

Não acrescente chaves, URLs internas, certificados, prompts, nomes de projeto ou trechos de código ao relatório.
