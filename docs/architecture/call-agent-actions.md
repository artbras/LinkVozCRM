# Ações disponíveis em `POST /internal/agent` (Call)

Fonte do inventário: `services/communication/src/api/internal-client.js`.
A rota aceita somente chamadas loopback (`127.0.0.1`, `::1` ou IPv4-mapped loopback). O corpo usa `acao`; ações desconhecidas retornam `404 ACTION_NOT_FOUND`.

## Resumo

| Ação Call        | Tipo            | Efeito                                                                                              | Tool CRM                  |
| ---------------- | --------------- | --------------------------------------------------------------------------------------------------- | ------------------------- |
| `cliente`        | leitura         | Consulta cadastro, endereços, histórico, franquia, tarifas, empresa e centros de custo por telefone | `crm_call_lookup_client`  |
| `empresa`        | leitura         | Consulta empresa e centros de custo por ID                                                          | `crm_call_lookup_company` |
| `add_service`    | escrita         | Pode criar/atualizar cliente e endereço e cria uma solicitação de corrida                           | `crm_call_create_service` |
| `cancel_service` | escrita crítica | Cancela a solicitação, remove ações vinculadas e registra cancelamento para a unidade               | `crm_call_cancel_service` |
| `return_service` | escrita         | Cria ou atualiza pedido de retorno e registra a mensagem operacional                                | `crm_call_request_return` |

## Contrato das leituras

### `cliente`

Entrada relevante:

- `acao`: `cliente`.
- `idf` ou `id_franquia`: inteiro positivo da franquia.
- `telefone` ou `numero`: 10–15 dígitos após normalização.

Sucesso: `200 { success: true, data }`, com `id_cliente`, nome, e-mail, telefone normalizado, quantidade de solicitações, endereços, histórico de `servico_acao`, franquia, tarifas e, quando existir, empresa e centros de custo.

Erros observados no handler:

- `422 INVALID_CLIENT_LOOKUP`, com detalhes de validação.
- `404 CLIENT_NOT_FOUND`.
- falha de infraestrutura: encaminhada pelo middleware da API.

### `empresa`

Entrada relevante:

- `acao`: `empresa`.
- `idf` ou `id_franquia`: inteiro positivo da franquia.
- `empresa_id` ou `empresa`: inteiro positivo.

Sucesso: `200 { success: true, data }`, com ID, nome fantasia, registro completo da empresa e `centros_custos`.

Erros observados:

- `422 INVALID_COMPANY_LOOKUP`.
- `404 COMPANY_NOT_FOUND`.

## Contrato das escritas

### `add_service`

Tool: `crm_call_create_service`.

Campos exigidos pela fachada do agente: `nome_passageiro`, `telefone`, `endereco`, `bairro` e `cidade`.
Campos opcionais: `numero`, `complemento`, `telefone_retorno`, `destino`, `alerta`, `pagamento`, `valor_servico`, `desconto`, `exigencias`, `data_servico`, `tempo_chamada`, `empresa_id`, `centro_id`, `cliente_id`, `lat`, `lng` e `nr_documento`.

Efeitos confirmados no código do Call:

1. valida franquia ativa;
2. valida empresa e centro de custo quando informados;
3. localiza cliente por `cliente_id` ou telefone;
4. pode criar cliente e telefone;
5. incrementa a quantidade de solicitações de cliente existente;
6. cria ou atualiza endereço;
7. insere a solicitação em `servico`;
8. confirma em transação e retorna `id_servico` e `id_cliente`.

Erros de negócio relevantes: `INVALID_SERVICE`, `FRANCHISE_NOT_FOUND`, `INVALID_COMPANY`, `INVALID_COST_CENTER`, `CLIENT_NOT_FOUND`, `PHONE_NOT_OWNED_BY_CLIENT` e `PHONE_ASSIGNED_TO_ANOTHER_FRANCHISE`.

### `cancel_service`

Tool: `crm_call_cancel_service`.

Entrada: `servico_id` positivo. A franquia é obtida da configuração do agente, não do modelo.

Efeitos: bloqueia a linha, rejeita serviço inexistente ou já cancelado, registra mensagem `CANCELADA` para a unidade quando aplicável, remove registros de `servico_acao`, atualiza `dt_cancelada` e `status = CANCELADA`, e confirma em transação.

Esse efeito é crítico e não deve ser executado sem solicitação explícita do cliente e confirmação do serviço correto.

### `return_service`

Tool: `crm_call_request_return`.

Entrada: `servico_id` positivo e `mensagem` de 3–250 caracteres.

Efeitos: verifica a solicitação, identifica a unidade vinculada, cria ou atualiza `servico_retorno`, registra `servico_retorno_mensagem` e, quando existe unidade, cria mensagem operacional para ela.

Erros relevantes: `INVALID_RETURN` e `SERVICE_NOT_FOUND`.

## Política de exposição ao agente

As tools do Call estão registradas no catálogo e no runtime. As leituras exigem `mcp:read` e papel `agent`. As escritas exigem simultaneamente `mcp:write` e papel `ai_operator`; os valores sensíveis são redigidos da auditoria quando aplicável. A allowlist da versão publicada precisa conter cada ID antes de o agente poder chamá-la.

Nenhuma escrita foi executada durante a implementação ou os testes. Isso evita criar, cancelar ou alterar uma corrida real enquanto a política de produção não estiver aprovada.

## Fase 2 — inventário operacional verificado em 2026-10-06/07

O inventário do checkout efetivamente implantado em `/var/www/call` confirma que a rota `POST /internal/agent` ainda aceita somente:

```text
cliente, empresa, add_service, cancel_service, return_service
```

Ações de despacho, reatribuição, retry, localização, embarque e alteração de corrida não estão expostas nessa rota. O módulo `ride-events.js` possui eventos internos para a unidade, mas não é um contrato de agente e não deve ser chamado pelo CRM sem autenticação, escopo e idempotência próprios.

A integração Call → CRM pelo webhook interno já normaliza e persiste:

- `TEMPO=5|10|15|20` e `TEMPO=QTR`;
- atrasos `+10 MINS` e `MAIS 10MIN`;
- `CANDIDATURA`, `REJEITAR`, `PORTA`, `TRIPULADO`, `FINALIZADO`, `VALOR`;
- `QTA UND`, `QTA PS`, `SEM MOTORISTA`, `SEM VEICULO`;
- `step`, unidade, modelo, placa, ETA e coordenadas quando presentes;
- exceções, severidade, handoff e deduplicação por `event_id`.

A versão publicada da CoopNorte é a versão 6 e contém a tool `crm_call_lookup_operational_state`. As imagens implantadas são:

```text
ghcr.io/artbras/deskcommcrm:f6abea50b
ghcr.io/artbras/deskcomm-worker:f6abea50b
```

Ambos os containers foram verificados como `healthy`.

## O que ainda falta para concluir a Fase 2

### 1. Corrigir ou publicar a leitura de corrida no Call

`crm_call_lookup_service` já existe no CRM, mas a ação `servico` não está presente no checkout efetivamente implantado do Call. É necessário preparar a alteração no repositório oficial do Call, publicar uma revisão identificada e somente então atualizar a imagem da VPS. Até isso ocorrer, a consulta detalhada direta ao Call permanece bloqueada; o espelho de eventos continua disponível.

### 2. Contrato transacional de despacho

Falta um contrato real para:

- iniciar despacho;
- consultar tentativas;
- repetir despacho;
- parar despacho;
- registrar aceite ou recusa;
- reatribuir unidade;
- reconciliar timeout sem duplicar ação.

Sem esse contrato, nenhuma tool de escrita de despacho deve ser liberada ao agente.

### 3. Localização e sequência completa da corrida

O webhook aceita coordenadas quando o Call as envia, mas ainda falta provar um produtor real e definir contrato para:

- localização periódica;
- chegada na origem;
- embarque;
- corrida em andamento;
- conclusão;
- atualização de ETA sem regressão de estado;
- retenção e privacidade das coordenadas.

### 4. Ocorrências e resolução

A abertura e o escalonamento foram implementados. Ainda falta o ciclo completo de resolução:

- confirmação de recebimento pelo atendente;
- atribuição de responsável;
- resolução ou encerramento;
- reabertura quando um novo evento ocorrer;
- SLA e auditoria do resultado.

### 5. Scheduler operacional

Faltam os jobs de:

- lembrete de corrida agendada;
- confirmação próxima do horário;
- expiração de rascunhos sem confirmação;
- escalonamento por ausência de resposta;
- retry controlado de eventos não processados.

### 6. Teste operacional controlado

Ainda falta validar com um contato e uma conversa de teste controlados:

- evento real do Call;
- mensagem proativa no WhatsApp;
- ausência de duplicidade;
- handoff para fila humana;
- consulta pelo agente publicado;
- round trip completo do worker, tool e segunda etapa do modelo.

## Critério de conclusão da Fase 2

A Fase 2 só deve ser marcada como concluída quando houver contrato publicado para a leitura de corrida e, no mínimo, um fluxo controlado comprovando o ciclo:

```text
evento Call → webhook → estado normalizado → tool do agente → resposta proativa ou handoff → auditoria
```

As escritas operacionais de despacho e reatribuição continuam bloqueadas até existir contrato transacional, autenticação entre serviços, idempotência e rollback.
