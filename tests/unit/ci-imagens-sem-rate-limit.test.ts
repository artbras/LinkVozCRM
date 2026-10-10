import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const raiz = process.cwd();
const ler = (arquivo: string) => readFileSync(path.join(raiz, arquivo), "utf8");

describe("imagens de CI evitam pull anônimo do Docker Hub", () => {
  it("Dockerfiles usam mirror.gcr.io nas bases Node e Alpine", () => {
    for (const arquivo of ["Dockerfile", "Dockerfile.worker", "Dockerfile.voice-agent", "Dockerfile.scheduler"]) {
      const bases = [...ler(arquivo).matchAll(/^FROM\s+([^\s]+)/gm)].map((m) => m[1] ?? "");
      expect(bases.length, `${arquivo} não declarou imagem base`).toBeGreaterThan(0);
      expect(bases.every((base) => base.startsWith("mirror.gcr.io/")), `${arquivo}: ${bases.join(", ")}`).toBe(true);
    }
    expect(ler("Dockerfile")).toContain("# syntax=mirror.gcr.io/docker/dockerfile:1");
  });

  it("jobs de banco e E2E usam o mirror, sem alterar imagens de runtime", () => {
    const ci = ler(".github/workflows/ci.yml");
    const e2e = ler(".github/workflows/e2e.yml");
    const publish = ler(".github/workflows/publish-image.yml");
    const builders = publish.match(/uses: docker\/setup-buildx-action@/g)?.length ?? 0;
    const mirroredBuilders = publish.match(/driver-opts: image=mirror.gcr.io\/moby\/buildkit:buildx-stable-1/g)?.length ?? 0;
    expect(builders).toBeGreaterThan(0);
    expect(mirroredBuilders).toBe(builders);
    expect(ci).toContain("TEST_DB_IMAGE: mirror.gcr.io/pgvector/pgvector:pg${{ matrix.pg }}");
    expect(e2e).toContain("WAHA_IMAGE: mirror.gcr.io/devlikeapro/waha:latest-2026.7.2");
    expect(e2e).toContain("REDIS_IMAGE: mirror.gcr.io/redis:7-alpine");
    expect(e2e).toContain("SRH_IMAGE: mirror.gcr.io/hiett/serverless-redis-http@sha256:5b0bb9239fce53abf87b2018a7a0deb9ec7bd900c5360738fe5fbeeb426f9150");

    const compose = ler("docker-compose.prod.yml");
    expect(compose).toContain("image: ${WAHA_IMAGE:-devlikeapro/waha:latest-2026.7.2}");
    expect(compose).toContain("image: redis:7-alpine");
    expect(compose).toContain("image: hiett/serverless-redis-http@sha256:5b0bb9239fce53abf87b2018a7a0deb9ec7bd900c5360738fe5fbeeb426f9150");
  });
});
