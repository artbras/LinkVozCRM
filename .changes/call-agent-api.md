---
impacto: capacidade_nova
secao: adicionado
titulo: O agente passa a ter ações Call de leitura e escrita protegidas por permissão
---

- Adiciona duas ferramentas de consulta somente leitura ao sistema de táxi/call.
- Registra três ferramentas de escrita protegidas por `mcp:write` e pelo papel `ai_operator`: criar solicitação, cancelar solicitação e solicitar retorno.
- Documenta os efeitos, parâmetros, respostas e riscos das cinco ações aceitas por `POST /internal/agent`.
- O agente publicado da CoopNorte continua sem as três escritas até aprovação operacional explícita; nenhuma escrita foi executada.
- Requer configuração de `CALL_AGENT_API_BASE_URL` e `CALL_AGENT_FRANCHISE_ID` no ambiente da instalação.
