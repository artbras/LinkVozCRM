# Token do fluxo de release no fork artbras/LinkVozCRM

O workflow `.github/workflows/release.yml` não usa o GitHub App do upstream. Para que a abertura do PR de release e a criação da tag disparem os workflows de CI/publicação neste repositório, ele usa um **fine-grained personal access token (PAT)** guardado como secret `RELEASE_TOKEN`.

## Criar o token

1. Entre no GitHub com uma conta mantenedora que tenha acesso de escrita a `artbras/LinkVozCRM`.
2. Abra **Settings do perfil → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
3. Em **Resource owner**, selecione `artbras`.
4. Em **Repository access**, selecione somente `LinkVozCRM`.
5. Conceda apenas estas permissões:
   - **Contents: Read and write** — criar o branch/commit de release, tag e GitHub Release.
   - **Pull requests: Read and write** — abrir o PR de release e consultar o PR de origem do corte.
   - **Metadata: Read-only** — permissão obrigatória/default do GitHub.
6. Defina validade conforme a política do mantenedor. A pessoa responsável deve renovar o token antes de expirar.
7. Gere o token e, sem copiá-lo para chat ou arquivos do projeto, cadastre-o em **`artbras/LinkVozCRM → Settings → Secrets and variables → Actions → New repository secret`**, nome `RELEASE_TOKEN`.

Se a organização exigir aprovação para fine-grained PATs, um administrador de `artbras` precisa aprovar o token. Não conceda acesso a outros repositórios nem permissões `Workflows`, `Actions` ou `Packages`: a publicação das imagens usa o `GITHUB_TOKEN` restrito a `packages: write` no workflow próprio.

## Verificação

Depois de publicar esta alteração no `main` e cadastrar `RELEASE_TOKEN`, execute **Actions → release → Run workflow**. O workflow deve abrir um PR com head `release/<versão>` neste mesmo repositório. O CI desse PR precisa passar; ao fazer merge, o workflow corta a tag e `publish-image.yml` publica as imagens. O próprio workflow da release verifica os manifestos no GHCR e falha se a tag ou `stable` não estiverem disponíveis.

O token é uma credencial de escrita do repositório. Restrinja seu acesso, não o exponha nos logs, e revogue-o se a conta responsável perder autorização.
