import { describe, expect, it, vi, afterEach } from "vitest";
import { consultarTarifa, tarifaConfigSchema } from "@/lib/tarifa/consulta";

const config = tarifaConfigSchema.parse({
  cidade: "Rio de Janeiro",
  bandeira_1: { bandeirada: 5, valor_km: 3, hora_parada: 30 },
  bandeira_2: { bandeirada: 7, valor_km: 4, hora_parada: 40 },
  adicionais: { corrida_minima: 10, bagagem: 2, aeroporto: 8, pedagio: 0, retorno: 5, outros: 0 },
  regras: {
    bandeira_2_inicio: "18:00",
    bandeira_2_fim: "06:00",
    bandeira_2_domingo: false,
    bandeira_2_feriado: false,
    feriados: [],
  },
  versao: "teste-1",
});

afterEach(() => vi.restoreAllMocks());

describe("crm_consulta_tarifa", () => {
  it("geocodifica, chama ORS com longitude/latitude e calcula a estimativa", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://nominatim.openstreetmap.org/search")) {
        return new Response(JSON.stringify([{ lat: "-22.9", lon: "-43.2", display_name: "Rio" }]), {
          status: 200,
        });
      }
      expect(url).toBe("https://api.heigit.org/openrouteservice/v2/directions/driving-car");
      expect((init?.headers as Record<string, string>).Authorization).toBe("secret-not-logged");
      const body = JSON.parse(String(init?.body));
      expect(body.coordinates).toEqual([
        [-43.2, -22.9],
        [-43.2, -22.9],
      ]);
      return new Response(
        JSON.stringify({ routes: [{ summary: { distance: 10, duration: 600 } }] }),
        { status: 200 },
      );
    });
    const result = await consultarTarifa({
      origem: "A, Rio",
      destino: "B, Rio",
      data_hora: "2026-10-06T20:00:00-03:00",
      config,
      orsApiKey: "secret-not-logged",
    });
    expect(result).toMatchObject({
      sucesso: true,
      bandeira: 2,
      distancia_km: 10,
      duracao_minutos: 10,
      valor_estimado: 47,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recusa resultado quando a rota não está disponível", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    const result = await consultarTarifa({
      origem: "A, Rio",
      destino: "B, Rio",
      config,
      orsApiKey: "secret-not-logged",
    });
    expect(result).toMatchObject({ erro: "geocoding_indisponivel" });
  });
});
