/** Regression for the overloaded SQL function present in the production schema. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const RAIZ = process.cwd();
const MIGRATION = readFileSync(
  join(
    RAIZ,
    "supabase/migrations/20261010113050_0483_comando_da_conversa_sem_ambiguidade.sql",
  ),
  "utf8",
);
const BASELINE = readFileSync(join(RAIZ, "supabase/baseline.sql"), "utf8");
const MARCADOR_BLOCO = "-- ---- resolver sobrecargas do comando da conversa (migration 0483) ----";
const MARCADOR_FIM = "-- ---- VARREDURA anon";
const INICIO_BLOCO = BASELINE.indexOf(MARCADOR_BLOCO);
const FIM_BLOCO = BASELINE.indexOf(MARCADOR_FIM, INICIO_BLOCO);
if (INICIO_BLOCO < 0 || FIM_BLOCO < 0) {
  throw new Error("apêndice 0483 não localizado no baseline.sql");
}
const BLOCO_BASELINE = BASELINE.slice(INICIO_BLOCO, FIM_BLOCO);

const ASSINATURAS = `
  select string_agg(p.pronargs::text || ':' || p.pronargdefaults::text, ',' order by p.pronargs)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_comando_da_conversa';
`;
const CHAMADA_LEGADA = `
  select public.fn_comando_da_conversa('open', null, null, false, false, now());
`;
const OVERLOAD_COM_DEFAULT = `
  create or replace function public.fn_comando_da_conversa(
    p_status text,
    p_assigned_to_user_id uuid,
    p_bot_silenced_until timestamptz,
    p_force_human boolean,
    p_is_blocked boolean,
    p_agora timestamptz,
    p_is_group boolean default false
  ) returns text language sql immutable
  as $new$
    select case when p_is_group is true then 'aguardando' else 'automatico' end
  $new$;
`;
const ACL_INCORRETA = `
  revoke execute on function public.fn_comando_da_conversa(
    text,uuid,timestamptz,boolean,boolean,timestamptz,boolean
  ) from public, anon, authenticated, service_role;
  grant execute on function public.fn_comando_da_conversa(
    text,uuid,timestamptz,boolean,boolean,timestamptz,boolean
  ) to public, anon;
  revoke execute on function public.comando_da_conversa(public.conversations)
    from public, anon, authenticated, service_role;
  grant execute on function public.comando_da_conversa(public.conversations)
    to public, anon;
`;
const ACL_FUNCAO = `
  select has_function_privilege('anon', 'public.fn_comando_da_conversa(text,uuid,timestamptz,boolean,boolean,timestamptz,boolean)', 'EXECUTE')::text || ':' ||
         has_function_privilege('authenticated', 'public.fn_comando_da_conversa(text,uuid,timestamptz,boolean,boolean,timestamptz,boolean)', 'EXECUTE')::text || ':' ||
         has_function_privilege('service_role', 'public.fn_comando_da_conversa(text,uuid,timestamptz,boolean,boolean,timestamptz,boolean)', 'EXECUTE')::text;
`;
const ACL_WRAPPER = `
  select has_function_privilege('anon', 'public.comando_da_conversa(public.conversations)', 'EXECUTE')::text || ':' ||
         has_function_privilege('authenticated', 'public.comando_da_conversa(public.conversations)', 'EXECUTE')::text || ':' ||
         has_function_privilege('service_role', 'public.comando_da_conversa(public.conversations)', 'EXECUTE')::text;
`;
const ESPERAR_AMBIGUIDADE = (): void => {
  let erro: unknown;
  try {
    sql(CHAMADA_LEGADA);
  } catch (err) {
    erro = err;
  }
  expect(erro, "a chamada de seis argumentos deveria ficar ambígua").toBeDefined();
  expect(motivoDoErro(erro)).toMatch(/is not unique|could not choose a best candidate/i);
};
const ESPERAR_ACL = (): void => {
  expect(sql(ACL_FUNCAO)).toBe("false:true:true");
  expect(sql(ACL_WRAPPER)).toBe("false:true:true");
};
const ESPERAR_RESULTADOS = (): void => {
  const grupo = sql(`
    select public.comando_da_conversa(
      jsonb_populate_record(null::public.conversations,
        '{"status":"open","is_group":true}'::jsonb)
    );
  `);
  const individual = sql(`
    select public.comando_da_conversa(
      jsonb_populate_record(null::public.conversations,
        '{"status":"open","is_group":false}'::jsonb)
    );
  `);
  expect(grupo).toBe("aguardando");
  expect(individual).toBe("automatico");
};

describe("comando_da_conversa with compatible SQL overloads", () => {
  it("reproduz e corrige a ambiguidade, preservando ACLs no baseline", () => {
    expect(sql(ASSINATURAS)).toBe("6:0,7:0");
    expect(sql(CHAMADA_LEGADA)).toBe("automatico");

    // Restaura o drift de produção: o default torna a chamada de seis argumentos
    // compatível com ambas as sobrecargas e o PostgreSQL precisa recusá-la.
    sql(OVERLOAD_COM_DEFAULT);
    ESPERAR_AMBIGUIDADE();

    // A migration remove o default sem CASCADE e recria as permissões explícitas.
    sql(ACL_INCORRETA);
    sql(MIGRATION);
    sql(MIGRATION); // segunda aplicação da migration também é idempotente.
    expect(sql(ASSINATURAS)).toBe("6:0,7:0");
    expect(sql(CHAMADA_LEGADA)).toBe("automatico");
    ESPERAR_ACL();
    ESPERAR_RESULTADOS();

    // Recria o drift e ACLs indevidas para medir o bloco que o self-hoster aplica.
    sql(OVERLOAD_COM_DEFAULT);
    sql(ACL_INCORRETA);
    ESPERAR_AMBIGUIDADE();
    sql(BLOCO_BASELINE);
    sql(BLOCO_BASELINE); // baseline reaplicado: sem DEFAULT e sem abrir EXECUTE.

    expect(sql(ASSINATURAS)).toBe("6:0,7:0");
    expect(sql(CHAMADA_LEGADA)).toBe("automatico");
    ESPERAR_ACL();
    ESPERAR_RESULTADOS();
  });
});
