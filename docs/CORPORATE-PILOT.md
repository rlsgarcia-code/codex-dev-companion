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

1. Instale o VSIX em um perfil de teste do VS Code e reinicie a janela.
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
12. Inicie uma tarefa longa, recolha a faixa de atividade, cancele a execução e recarregue a janela. O estado deve ser coerente e a solicitação interrompida deve oferecer recuperação explícita.
13. Repita uma tarefa curta com cada perfil de modelo disponível. Altere `reasoning_effort`, `temperature` e `top_p` somente quando o modelo suportar; erros incompatíveis devem oferecer uma correção explícita, nunca silenciosa.

## Critério de aprovação

O piloto passa quando:

- nenhuma ativação, nova thread, troca de janela ou cancelamento congela a interface;
- nenhum arquivo fora do workspace é lido ou alterado;
- nenhuma mutação ou comando ocorre sem a política de autonomia correspondente;
- chave, endpoint, PEM e conteúdo do projeto não aparecem em logs, memória ou bundle de suporte;
- os dois runtimes completam pelo menos uma tarefa curta;
- o Chroma inicia e encerra localmente em duas janelas sem disputa;
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
