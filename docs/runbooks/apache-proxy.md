# Proxy Apache no host (atualizações)

Este runbook cobre instalações existentes em que o Apache roda no host e encaminha
as requisições para `127.0.0.1:3100`. O Compose de produção mantém essa porta em
loopback; o overlay `docker-compose.apache.yml` desativa o serviço Caddy para que
`update.sh` não tente ocupar as portas 80/443.

No `.env` da instalação, declare:

```dotenv
REVERSE_PROXY=apache
```

Rode atualizações pelo kit, que seleciona o overlay automaticamente:

```bash
bash hostgator-setup-kit/update.sh
```

Esse modo preserva o vhost, TLS e regras existentes do Apache; o kit não os
edita nem gerencia certificados. Confirme que o vhost ainda encaminha para
`127.0.0.1:3100`. Não rode `docker compose up -d` usando apenas
`docker-compose.prod.yml`, pois isso pode iniciar o Caddy junto do Apache.

Este fluxo é para atualizar uma instalação já configurada. `install.sh` não
cria nem configura vhosts do Apache; instalações novas devem seguir o runbook
de instalação do proxy correspondente.
