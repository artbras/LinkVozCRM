import { z } from "zod";

export const tarifaConfigSchema = z.object({
  cidade: z.string().trim().min(1).max(80).default("Rio de Janeiro"),
  moeda: z.string().trim().length(3).default("BRL"),
  bandeira_1: z.object({
    bandeirada: z.number().nonnegative(),
    valor_km: z.number().nonnegative(),
    hora_parada: z.number().nonnegative(),
  }),
  bandeira_2: z.object({
    bandeirada: z.number().nonnegative(),
    valor_km: z.number().nonnegative(),
    hora_parada: z.number().nonnegative(),
  }),
  adicionais: z
    .object({
      bagagem: z.number().nonnegative().default(0),
      aeroporto: z.number().nonnegative().default(0),
      pedagio: z.number().nonnegative().default(0),
      retorno: z.number().nonnegative().default(0),
      corrida_minima: z.number().nonnegative().default(0),
      outros: z.number().nonnegative().default(0),
    })
    .default({ bagagem: 0, aeroporto: 0, pedagio: 0, retorno: 0, corrida_minima: 0, outros: 0 }),
  regras: z
    .object({
      bandeira_2_inicio: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default("00:00"),
      bandeira_2_fim: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default("00:00"),
      bandeira_2_domingo: z.boolean().default(false),
      bandeira_2_feriado: z.boolean().default(false),
      feriados: z
        .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
        .max(200)
        .default([]),
      regiao: z.string().trim().max(80).optional(),
      tipos_veiculo_bandeira_2: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
      arredondamento_centavos: z.enum(["nearest", "up"]).default("nearest"),
    })
    .default({
      bandeira_2_inicio: "00:00",
      bandeira_2_fim: "00:00",
      bandeira_2_domingo: false,
      bandeira_2_feriado: false,
      feriados: [],
      tipos_veiculo_bandeira_2: [],
      arredondamento_centavos: "nearest",
    }),
  versao: z.string().trim().min(1).max(50).default("1"),
});
export type TarifaConfig = z.infer<typeof tarifaConfigSchema>;

const DEFAULT_USER_AGENT = "LinkVozCRM/consulta-tarifa (contact admin)";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const ORS_URL = "https://api.heigit.org/openrouteservice/v2/directions/driving-car";

export type Coordenada = { latitude: number; longitude: number; endereco_resolvido: string };

function timeoutSignal(ms: number) {
  return AbortSignal.timeout(ms);
}

async function geocodificar(endereco: string): Promise<Coordenada | { erro: string }> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", endereco);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "br");
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": DEFAULT_USER_AGENT },
      signal: timeoutSignal(5000),
      cache: "no-store",
    });
    if (!response.ok) return { erro: "geocoding_indisponivel" };
    const rows = (await response.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
    }>;
    const row = rows[0];
    const latitude = Number(row?.lat);
    const longitude = Number(row?.lon);
    if (!row || !Number.isFinite(latitude) || !Number.isFinite(longitude))
      return { erro: "endereco_nao_localizado" };
    return { latitude, longitude, endereco_resolvido: row.display_name ?? endereco };
  } catch {
    return { erro: "geocoding_indisponivel" };
  }
}

async function obterRota(
  origem: Coordenada,
  destino: Coordenada,
  apiKey: string,
): Promise<{ distancia_m: number; duracao_s: number } | { erro: string }> {
  try {
    const response = await fetch(ORS_URL, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        coordinates: [
          [origem.longitude, origem.latitude],
          [destino.longitude, destino.latitude],
        ],
        instructions: false,
        units: "km",
      }),
      signal: timeoutSignal(8000),
      cache: "no-store",
    });
    if (!response.ok)
      return {
        erro:
          response.status === 401 || response.status === 403
            ? "openrouteservice_nao_autorizado"
            : "rota_indisponivel",
      };
    const body = (await response.json()) as {
      routes?: Array<{ summary?: { distance?: number; duration?: number } }>;
    };
    const summary = body.routes?.[0]?.summary;
    const distance = summary?.distance;
    const duration = summary?.duration;
    if (
      typeof distance !== "number" ||
      !Number.isFinite(distance) ||
      typeof duration !== "number" ||
      !Number.isFinite(duration)
    )
      return { erro: "rota_nao_encontrada" };
    return { distancia_m: distance * 1000, duracao_s: duration };
  } catch {
    return { erro: "openrouteservice_indisponivel" };
  }
}

function horaDentroDaJanela(hora: string, inicio: string, fim: string): boolean {
  if (inicio === fim) return false;
  return inicio < fim ? hora >= inicio && hora < fim : hora >= inicio || hora < fim;
}

function escolherBandeira(config: TarifaConfig, dataHora: Date, tipoVeiculo?: string): 1 | 2 {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dataHora);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dataHora);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(dataHora);
  const domingo = weekday === "Sun";
  const feriado = config.regras.feriados.includes(date);
  const veiculoElegivel =
    config.regras.tipos_veiculo_bandeira_2.length === 0 ||
    (tipoVeiculo ? config.regras.tipos_veiculo_bandeira_2.includes(tipoVeiculo) : false);
  if (
    (domingo && config.regras.bandeira_2_domingo) ||
    (feriado && config.regras.bandeira_2_feriado) ||
    (veiculoElegivel &&
      horaDentroDaJanela(local, config.regras.bandeira_2_inicio, config.regras.bandeira_2_fim))
  )
    return 2;
  return 1;
}

export async function consultarTarifa(args: {
  origem: string;
  destino: string;
  data_hora?: string;
  tipo_veiculo?: string;
  bagagem?: boolean;
  aeroporto?: boolean;
  pedagio?: number;
  retorno?: boolean;
  outros?: number;
  tempo_parada_minutos?: number;
  regiao?: string;
  config: TarifaConfig;
  orsApiKey: string;
}) {
  const [origem, destino] = await Promise.all([
    geocodificar(args.origem),
    geocodificar(args.destino),
  ]);
  if ("erro" in origem)
    return {
      erro: origem.erro,
      mensagem: "não consegui localizar a origem com precisão suficiente.",
    };
  if ("erro" in destino)
    return {
      erro: destino.erro,
      mensagem: "não consegui localizar o destino com precisão suficiente.",
    };
  const rota = await obterRota(origem, destino, args.orsApiKey);
  if ("erro" in rota)
    return {
      erro: rota.erro,
      mensagem: "não consegui calcular uma rota confiável entre os endereços.",
    };
  const quando = args.data_hora ? new Date(args.data_hora) : new Date();
  if (Number.isNaN(quando.getTime()))
    return { erro: "data_hora_invalida", mensagem: "a data e hora informadas são inválidas." };
  if (
    args.config.regras.regiao &&
    args.regiao &&
    args.config.regras.regiao.toLocaleLowerCase() !== args.regiao.toLocaleLowerCase()
  ) {
    return {
      erro: "regiao_sem_regra",
      mensagem: "não existe regra tarifária configurada para a região informada.",
    };
  }
  const bandeira = escolherBandeira(args.config, quando, args.tipo_veiculo);
  const tabela = bandeira === 2 ? args.config.bandeira_2 : args.config.bandeira_1;
  const km = rota.distancia_m / 1000;
  const minutos = rota.duracao_s / 60;
  const componentes = {
    bandeirada: tabela.bandeirada,
    distancia: km * tabela.valor_km,
    tempo_parada: ((args.tempo_parada_minutos ?? 0) / 60) * tabela.hora_parada,
    bagagem: args.bagagem ? args.config.adicionais.bagagem : 0,
    aeroporto: args.aeroporto ? args.config.adicionais.aeroporto : 0,
    pedagio: args.pedagio ?? args.config.adicionais.pedagio,
    retorno: args.retorno ? args.config.adicionais.retorno : 0,
    outros: args.outros ?? args.config.adicionais.outros,
  };
  const subtotal = Object.values(componentes).reduce((sum, value) => sum + value, 0);
  const valor = Math.max(subtotal, args.config.adicionais.corrida_minima);
  const arredondado =
    args.config.regras.arredondamento_centavos === "up"
      ? Math.ceil(valor * 100) / 100
      : Math.round(valor * 100) / 100;
  return {
    sucesso: true,
    estimativa: true,
    cidade: args.config.cidade,
    moeda: args.config.moeda,
    bandeira,
    distancia_km: Number(km.toFixed(2)),
    duracao_minutos: Math.ceil(minutos),
    origem: {
      informado: args.origem,
      resolvido: origem.endereco_resolvido,
      latitude: origem.latitude,
      longitude: origem.longitude,
    },
    destino: {
      informado: args.destino,
      resolvido: destino.endereco_resolvido,
      latitude: destino.latitude,
      longitude: destino.longitude,
    },
    componentes: Object.fromEntries(
      Object.entries(componentes).map(([key, value]) => [key, Number(value.toFixed(2))]),
    ),
    valor_estimado: Number(arredondado.toFixed(2)),
    regra_versao: args.config.versao,
    aviso:
      "estimativa sujeita às condições reais, trânsito, rota, pedágios e regras vigentes; não é o preço final cobrado.",
  };
}

export { geocodificar, obterRota };
