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

As cinco tools estão registradas no catálogo e no runtime. As duas leituras exigem `mcp:read` e papel `agent`. As três escritas exigem simultaneamente `mcp:write` e papel `ai_operator`; os valores sensíveis são redigidos da auditoria quando aplicável.

O agente publicado da CoopNorte continua, deliberadamente, com apenas as duas tools de leitura até uma aprovação operacional explícita para habilitar escritas. Registrar uma tool não a habilita em um agente publicado: a allowlist da versão do agente ainda precisa incluir o ID e o token precisa possuir `mcp:write`.

Nenhuma escrita foi executada durante a implementação ou os testes. Isso evita criar, cancelar ou alterar uma corrida real enquanto a política de produção não estiver aprovada.
