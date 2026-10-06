/**
 * Coalescência de rajada inbound — a janela que junta as mensagens de UM contato
 * em UM turno.
 *
 * Morava inline no `drain.ts`; saiu para cá com teste próprio (issue #1390)
 * porque o comportamento carrega duas leis que se cruzam — a janela de debounce
 * e a exclusão do job em HOLD — e as duas precisam de régua própria.
 *
 * Contrato:
 *   - mensagem que chega enquanto há job PENDING **do mesmo contato** com a
 *     janela ainda aberta (`run_after > now()`) viaja de carona nele: o turno lê
 *     o histórico completo e responde a todas as mensagens do lote;
 *   - mensagem que chega dentro da janela mantém o `run_after` do primeiro job;
 *   - se o job foi adiado pela janela horária e a configuração mudou, uma nova
 *     mensagem reabre a janela de debounce vigente em vez de preservar o horário
 *     antigo;
 *   - `debounceMs = 0` desliga a coalescência: job imediato, zero consulta.
 *
 * A janela é ANCORADA no primeiro job, não deslizante: mensagens que chegam
 * dentro dela não empurram o `run_after` para frente, exceto quando o job carrega
 * o motivo explícito de adiamento pela janela horária. Quem mede o pior caso com
 * contato falante é `debounce.medicao.test.ts`.
 */
import type pg from "pg";

interface JobParaCoalescer {
  id: string;
  last_error?: string | null;
}

const SQL_JOB_PARA_COALESCER = `select id, last_error from job_queue
 where organization_id = $1 and contact_id = $2
   and kind = 'inbound_turn' and status = 'pending' and run_after > now()
   and not (payload ? 'held_run_after')
 limit 1`;

const MOTIVO_JANELA_FECHADA = "fora da janela anti-ban de envio";

/** O que fazer com a mensagem que acabou de chegar. */
export type DecisaoDeRajada =
  { tipo: "coalescido"; jobId: string } | { tipo: "enfileirar"; runAfter: Date | undefined };

/** Job pendente do contato que pode receber a mensagem de carona. */
export async function buscarJobParaCoalescer(
  pool: pg.Pool,
  alvo: { organizationId: string; contactId: string },
): Promise<JobParaCoalescer | undefined> {
  const { rows } = await pool.query<JobParaCoalescer>(SQL_JOB_PARA_COALESCER, [
    alvo.organizationId,
    alvo.contactId,
  ]);
  return rows[0];
}

/**
 * Libera um job que ficou estacionado pela janela horária antiga.
 *
 * A configuração da janela pode mudar enquanto o job está pending. Nesse caso,
 * preservar o `run_after` calculado antes da mudança causa starvation: novas
 * mensagens são coalescidas, mas o turno continua esperando a abertura antiga.
 * O job volta para a janela de debounce atual; o inbound-turn ainda revalida a
 * janela vigente antes de falar e o adia novamente se necessário.
 */
async function reabrirJobAdiadoPelaJanela(
  pool: pg.Pool,
  jobId: string,
  runAfter: Date | undefined,
): Promise<void> {
  if (runAfter === undefined) return;
  await pool.query(
    `update job_queue
        set run_after = $2, last_error = null
      where id = $1 and status = 'pending'
        and not (payload ? 'held_run_after')`,
    [jobId, runAfter],
  );
}

/**
 * Janela da rajada aberta por esta mensagem: `undefined` quando não há debounce
 * (o job nasce claimável agora).
 *
 * `agora` é injetável porque a janela é aritmética — o teste prende o número
 * sem depender do relógio.
 */
export function janelaDeRajada(debounceMs: number, agora: number = Date.now()): Date | undefined {
  return debounceMs > 0 ? new Date(agora + debounceMs) : undefined;
}

/** Decide entre carona em job existente e janela nova. */
export async function decidirRajada(
  pool: pg.Pool,
  alvo: { organizationId: string; contactId: string },
  debounceMs: number,
  agora: number = Date.now(),
): Promise<DecisaoDeRajada> {
  if (debounceMs > 0) {
    const job = await buscarJobParaCoalescer(pool, alvo);
    if (job !== undefined) {
      const runAfter = janelaDeRajada(debounceMs, agora);
      if (job.last_error?.includes(MOTIVO_JANELA_FECHADA)) {
        await reabrirJobAdiadoPelaJanela(pool, job.id, runAfter);
      }
      return { tipo: "coalescido", jobId: job.id };
    }
  }
  return { tipo: "enfileirar", runAfter: janelaDeRajada(debounceMs, agora) };
}
