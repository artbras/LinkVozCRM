---
impacto: exige_acao
secao: corrigido
titulo: Exceções do Call são redigidas com a anonimização do contato
---

Ao anonimizar um contato, exceções operacionais vinculadas perdem os vínculos com contato/conversa e os campos livres `payload` e `handoff_result`, que podem conter dados pessoais. Serviço, evento, categoria, severidade, estado e timestamps permanecem como metadados operacionais. A migration 0420 também redige exceções legadas ligadas a contatos já anonimizados. Um marcador `pii_redacted_at` e um trigger de proteção impedem que inserções ou atualizações posteriores voltem a associar ou preencher dados livres dessas exceções; o teste de banco valida os dois cenários e o isolamento de outros contatos. Os eventos brutos e rascunhos Call sem vínculo com contato continuam sujeitos à política própria de retenção, fora do escopo desta migration.

## Requer atenção

Antes do deploy, confirme um backup restaurável do banco. A migration 0420 redige de forma irreversível as exceções ligadas a contatos já anonimizados; os metadados operacionais descritos acima permanecem.
