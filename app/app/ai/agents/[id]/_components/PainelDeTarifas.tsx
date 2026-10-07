"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { TarifaConfig } from "@/lib/tarifa/consulta";

const vazio: TarifaConfig = {
  cidade: "Rio de Janeiro",
  moeda: "BRL",
  bandeira_1: { bandeirada: 0, valor_km: 0, hora_parada: 0 },
  bandeira_2: { bandeirada: 0, valor_km: 0, hora_parada: 0 },
  adicionais: { bagagem: 0, aeroporto: 0, pedagio: 0, retorno: 0, corrida_minima: 0, outros: 0 },
  regras: {
    bandeira_2_inicio: "00:00",
    bandeira_2_fim: "00:00",
    bandeira_2_domingo: false,
    bandeira_2_feriado: false,
    feriados: [],
    tipos_veiculo_bandeira_2: [],
    arredondamento_centavos: "nearest",
  },
  versao: "1",
};

function num(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function normalizar(v: unknown): TarifaConfig {
  const x = (v && typeof v === "object" ? v : {}) as Partial<TarifaConfig>;
  return {
    ...vazio,
    ...x,
    bandeira_1: { ...vazio.bandeira_1, ...(x.bandeira_1 ?? {}) },
    bandeira_2: { ...vazio.bandeira_2, ...(x.bandeira_2 ?? {}) },
    adicionais: { ...vazio.adicionais, ...(x.adicionais ?? {}) },
    regras: { ...vazio.regras, ...(x.regras ?? {}) },
  };
}

export function PainelDeTarifas({
  agentId,
  inicial,
  disabled,
}: {
  agentId: string;
  inicial: unknown;
  disabled?: boolean;
}) {
  const t = useT();
  const [config, setConfig] = useState(() => normalizar(inicial));
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<TarifaConfig>) => setConfig((old) => ({ ...old, ...patch }));
  const setGrupo = (
    grupo: "bandeira_1" | "bandeira_2" | "adicionais",
    campo: string,
    value: number,
  ) => setConfig((old) => ({ ...old, [grupo]: { ...old[grupo], [campo]: num(value) } }));
  async function salvar() {
    setSaving(true);
    try {
      await apiClient.patch(`/api/v1/ai/agents/${agentId}`, { config: { tarifa: config } });
      toast.success(t("Tabela tarifária salva."));
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }
  const money = (
    grupo: "bandeira_1" | "bandeira_2" | "adicionais",
    campo: string,
    label: string,
  ) => (
    <div className="space-y-1">
      <Label>{t(label)}</Label>
      <Input
        type="number"
        min="0"
        step="0.01"
        value={num(config[grupo][campo as never] as unknown)}
        onChange={(e) => setGrupo(grupo, campo, Number(e.target.value))}
        disabled={disabled || saving}
      />
    </div>
  );
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="text-sm font-medium">{t("Tabela tarifária")}</h3>
        <p className="text-xs text-muted-foreground">
          {t(
            "Usada pela crm_consulta_tarifa para estimar corridas. Preencha os valores oficiais; zero deixa a consulta indisponível na prática.",
          )}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>{t("Cidade")}</Label>
          <Input
            value={config.cidade}
            onChange={(e) => set({ cidade: e.target.value })}
            disabled={disabled || saving}
          />
        </div>
        <div className="space-y-1">
          <Label>{t("Versão da regra")}</Label>
          <Input
            value={config.versao}
            onChange={(e) => set({ versao: e.target.value })}
            disabled={disabled || saving}
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{t("Bandeira 1")}</h4>
          {money("bandeira_1", "bandeirada", "Bandeirada")}
          {money("bandeira_1", "valor_km", "Valor por km")}
          {money("bandeira_1", "hora_parada", "Hora parada")}
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{t("Bandeira 2")}</h4>
          {money("bandeira_2", "bandeirada", "Bandeirada")}
          {money("bandeira_2", "valor_km", "Valor por km")}
          {money("bandeira_2", "hora_parada", "Hora parada")}
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-medium">{t("Adicionais")}</h4>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {money("adicionais", "bagagem", "Bagagem")}
          {money("adicionais", "aeroporto", "Aeroporto")}
          {money("adicionais", "pedagio", "Pedágio")}
          {money("adicionais", "retorno", "Retorno")}
          {money("adicionais", "corrida_minima", "Corrida mínima")}
          {money("adicionais", "outros", "Outros")}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>{t("Início da Bandeira 2")}</Label>
          <Input
            type="time"
            value={config.regras.bandeira_2_inicio}
            onChange={(e) =>
              set({ regras: { ...config.regras, bandeira_2_inicio: e.target.value } })
            }
            disabled={disabled || saving}
          />
        </div>
        <div className="space-y-1">
          <Label>{t("Fim da Bandeira 2")}</Label>
          <Input
            type="time"
            value={config.regras.bandeira_2_fim}
            onChange={(e) => set({ regras: { ...config.regras, bandeira_2_fim: e.target.value } })}
            disabled={disabled || saving}
          />
        </div>
      </div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.regras.bandeira_2_domingo}
            onChange={(e) =>
              set({ regras: { ...config.regras, bandeira_2_domingo: e.target.checked } })
            }
            disabled={disabled || saving}
          />
          {t("Bandeira 2 aos domingos")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.regras.bandeira_2_feriado}
            onChange={(e) =>
              set({ regras: { ...config.regras, bandeira_2_feriado: e.target.checked } })
            }
            disabled={disabled || saving}
          />
          {t("Bandeira 2 em feriados")}
        </label>
      </div>
      <Button type="button" onClick={salvar} disabled={disabled || saving}>
        {saving ? t("Salvando…") : t("Salvar tabela tarifária")}
      </Button>
    </Card>
  );
}
