---
impacto: nada_mudou
secao: corrigido
titulo: Atualizações com Apache não tentam iniciar o Caddy
---

Instalações existentes que encaminham o tráfego pelo Apache no host agora usam um overlay que impede o Compose de subir o Caddy. A porta do CRM continua vinculada a `127.0.0.1:3100`; o vhost do Apache permanece sob gestão de quem opera a VPS. Os jobs de CI também usam o espelho público do Google para pulls de imagens Docker Hub e evitar rate limit nos runners anônimos; as referências do Compose de produção não mudam.
