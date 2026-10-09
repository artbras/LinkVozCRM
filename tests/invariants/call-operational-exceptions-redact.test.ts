import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const pool = new pg.Pool({
  connectionString: `postgres://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});
afterAll(() => pool.end());

const ORG = "8d430000-0000-4000-8000-0000000000a1";
const SESSION = "8d430000-3333-4000-8000-0000000000a1";
const CONTACT_TARGET = "8d430000-1111-4000-8000-0000000000a1";
const CONTACT_NEIGHBOR = "8d430000-1111-4000-8000-0000000000b1";
const CONVERSATION_TARGET = "8d430000-2222-4000-8000-0000000000a1";
const CONVERSATION_NEIGHBOR = "8d430000-2222-4000-8000-0000000000b1";
const EVENT_TARGET = "call-lgpd-target-83401";
const EVENT_NEIGHBOR = "call-lgpd-neighbor-83401";
const EVENT_LATE = "call-lgpd-late-83401";
const EVENT_CONVERSATION_ONLY = "call-lgpd-conversation-only-83401";
const EVENT_LATE_CONVERSATION = "call-lgpd-late-conversation-83401";
const CONTACT_CONCURRENT = "8d430000-1111-4000-8000-0000000000c1";
const EVENT_CONCURRENT = "call-lgpd-concurrent-83401";
const CONTACT_INSERT_CONCURRENT = "8d430000-1111-4000-8000-0000000000c2";
const EVENT_INSERT_CONCURRENT = "call-lgpd-insert-concurrent-83401";

type ExceptionSnapshot = {
  contact_id: string | null;
  conversation_id: string | null;
  payload: Record<string, unknown>;
  handoff_result: Record<string, unknown> | null;
  pii_redacted_at: string | null;
  franchise_id: number;
  service_id: number;
  event_id: string;
  category: string;
  severity: string;
  status: string;
  handoff_requested: boolean;
  created_at: string;
  updated_after_created_at: boolean;
};

function excecao(eventId: string): ExceptionSnapshot {
  return JSON.parse(sql(`
    select jsonb_build_object(
      'contact_id', contact_id,
      'conversation_id', conversation_id,
      'payload', payload,
      'handoff_result', handoff_result,
      'pii_redacted_at', pii_redacted_at,
      'franchise_id', franchise_id,
      'service_id', service_id,
      'event_id', event_id,
      'category', category,
      'severity', severity,
      'status', status,
      'handoff_requested', handoff_requested_at is not null,
      'created_at', created_at,
      'updated_after_created_at', updated_at > created_at
    )::text
      from public.call_operational_exceptions
     where organization_id = '${ORG}' and event_id = '${eventId}';
  `)) as ExceptionSnapshot;
}

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
    values ('${ORG}', 'call-lgpd-83401', 'Call LGPD 83401', 'Call LGPD 83401')
    on conflict (id) do nothing;

    insert into public.channel_sessions
      (id, organization_id, waha_session_name, webhook_secret_encrypted)
    values ('${SESSION}', '${ORG}', 'call-lgpd-83401', decode('00', 'hex'))
    on conflict (id) do nothing;

    insert into public.contacts (id, organization_id, name) values
      ('${CONTACT_TARGET}', '${ORG}', 'Maria Silva'),
      ('${CONTACT_NEIGHBOR}', '${ORG}', 'Joao Pereira'),
      ('${CONTACT_CONCURRENT}', '${ORG}', 'Ana Costa'),
      ('${CONTACT_INSERT_CONCURRENT}', '${ORG}', 'Luisa Prado')
    on conflict (id) do nothing;

    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONVERSATION_TARGET}', '${ORG}', '${CONTACT_TARGET}', '${SESSION}', 'open'),
      ('${CONVERSATION_NEIGHBOR}', '${ORG}', '${CONTACT_NEIGHBOR}', '${SESSION}', 'open')
    on conflict (id) do nothing;

    insert into public.call_operational_exceptions
      (organization_id, franchise_id, service_id, event_id, category, severity, status,
       contact_id, conversation_id, payload, handoff_requested_at, handoff_result, created_at, updated_at)
    values
      ('${ORG}', 1, 83401, '${EVENT_TARGET}', 'no_driver', 'high', 'handoff_requested',
       '${CONTACT_TARGET}', '${CONVERSATION_TARGET}',
       '{"nome":"Maria Silva","telefone":"5511999999999","mensagem":"precisa de carro"}'::jsonb,
       '2026-01-01T00:00:00Z',
       '{"nota":"Ligar para Maria Silva","telefone":"5511999999999"}'::jsonb,
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('${ORG}', 1, 83402, '${EVENT_NEIGHBOR}', 'no_driver', 'high', 'handoff_requested',
       '${CONTACT_NEIGHBOR}', '${CONVERSATION_NEIGHBOR}',
       '{"nome":"Joao Pereira","telefone":"5511888888888","mensagem":"aguarda corrida"}'::jsonb,
       '2026-01-01T00:00:00Z',
       '{"nota":"Ligar para Joao Pereira","telefone":"5511888888888"}'::jsonb,
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('${ORG}', 1, 83404, '${EVENT_CONVERSATION_ONLY}', 'no_driver', 'high', 'open',
       null, '${CONVERSATION_TARGET}',
       '{"nome":"Maria Silva","telefone":"5511999999999"}'::jsonb,
       null, '{"nota":"Ligar para Maria Silva"}'::jsonb,
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('${ORG}', 1, 83406, '${EVENT_CONCURRENT}', 'no_driver', 'high', 'open',
       '${CONTACT_CONCURRENT}', null,
       '{"nome":"Ana Costa","telefone":"5511777777777"}'::jsonb,
       null, null, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    on conflict (organization_id, event_id) do update set
      contact_id = excluded.contact_id,
      conversation_id = excluded.conversation_id,
      payload = excluded.payload,
      handoff_result = excluded.handoff_result,
      updated_at = excluded.updated_at;
  `);
});

describe("a anonimização do contato redige exceções do Call sem apagar o fato operacional", () => {
  it("remove dados pessoais vinculados, preserva metadados mínimos e não toca outro contato", () => {
    const antes = excecao(EVENT_TARGET);
    expect(antes.payload).toMatchObject({ nome: "Maria Silva", telefone: "5511999999999" });
    expect(antes.handoff_result).toMatchObject({ nota: "Ligar para Maria Silva" });
    expect(antes.contact_id).toBe(CONTACT_TARGET);
    expect(antes.conversation_id).toBe(CONVERSATION_TARGET);

    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG}', '${CONTACT_TARGET}', gen_random_uuid());`);

    const depois = excecao(EVENT_TARGET);
    expect(depois).toMatchObject({
      contact_id: null,
      conversation_id: null,
      payload: {},
      handoff_result: null,
      franchise_id: 1,
      service_id: 83401,
      event_id: EVENT_TARGET,
      category: "no_driver",
      severity: "high",
      status: "handoff_requested",
      handoff_requested: true,
      updated_after_created_at: true,
    });
    expect(depois.pii_redacted_at).toBeTruthy();

    const conversationOnly = excecao(EVENT_CONVERSATION_ONLY);
    expect(conversationOnly).toMatchObject({
      contact_id: null,
      conversation_id: null,
      payload: {},
      handoff_result: null,
      service_id: 83404,
      status: "open",
    });
    expect(conversationOnly.pii_redacted_at).toBeTruthy();

    sql(`
      insert into public.call_operational_exceptions
        (organization_id, franchise_id, service_id, event_id, category, severity, status,
         contact_id, conversation_id, payload, handoff_result)
      values
        ('${ORG}', 1, 83403, '${EVENT_LATE}', 'no_driver', 'high', 'open',
         '${CONTACT_TARGET}', '${CONVERSATION_TARGET}',
         '{"nome":"Maria Silva","telefone":"5511999999999"}'::jsonb,
         '{"nota":"Ligar para Maria Silva","telefone":"5511999999999"}'::jsonb);
    `);
    const tardia = excecao(EVENT_LATE);
    expect(tardia).toMatchObject({
      contact_id: null,
      conversation_id: null,
      payload: {},
      handoff_result: null,
      franchise_id: 1,
      service_id: 83403,
      event_id: EVENT_LATE,
      status: "open",
    });
    expect(tardia.pii_redacted_at).toBeTruthy();

    sql(`
      update public.call_operational_exceptions
         set payload = '{"nome":"Maria Silva","telefone":"5511999999999"}'::jsonb,
             handoff_result = '{"nota":"Ligar para Maria Silva"}'::jsonb,
             pii_redacted_at = null
       where organization_id = '${ORG}' and event_id = '${EVENT_LATE}';
    `);
    const tardiaAtualizada = excecao(EVENT_LATE);
    expect(tardiaAtualizada).toMatchObject({
      contact_id: null,
      conversation_id: null,
      payload: {},
      handoff_result: null,
      status: "open",
    });
    expect(tardiaAtualizada.pii_redacted_at).toBe(tardia.pii_redacted_at);

    sql(`
      insert into public.call_operational_exceptions
        (organization_id, franchise_id, service_id, event_id, category, severity, status,
         conversation_id, payload, handoff_result)
      values
        ('${ORG}', 1, 83405, '${EVENT_LATE_CONVERSATION}', 'no_driver', 'high', 'open',
         '${CONVERSATION_TARGET}', '{"telefone":"5511999999999"}'::jsonb,
         '{"nota":"Ligar para Maria Silva"}'::jsonb);
    `);
    const tardiaPorConversa = excecao(EVENT_LATE_CONVERSATION);
    expect(tardiaPorConversa).toMatchObject({
      contact_id: null,
      conversation_id: null,
      payload: {},
      handoff_result: null,
      service_id: 83405,
      status: "open",
    });
    expect(tardiaPorConversa.pii_redacted_at).toBeTruthy();

    const vizinho = excecao(EVENT_NEIGHBOR);
    expect(vizinho).toMatchObject({
      contact_id: CONTACT_NEIGHBOR,
      conversation_id: CONVERSATION_NEIGHBOR,
      payload: { nome: "Joao Pereira", telefone: "5511888888888" },
      handoff_result: { nota: "Ligar para Joao Pereira", telefone: "5511888888888" },
      service_id: 83402,
      status: "handoff_requested",
    });
  });
});

it("anonimização concorrente e atualização de exceção não entram em deadlock", async () => {
  const a = await pool.connect();
  const b = await pool.connect();
  const observer = await pool.connect();
  const bpid = Number((await b.query("select pg_backend_pid() pid")).rows[0].pid);
  let bPending: Promise<{ error?: unknown }> | undefined;

  try {
    for (const client of [a, b]) {
      await client.query("begin; set local deadlock_timeout='100ms'; set local statement_timeout='5s'");
    }

    // A mantém a exceção; B anonimiza o contato e espera a linha da exceção.
    await a.query(
      "select id from public.call_operational_exceptions where organization_id=$1 and event_id=$2 for update",
      [ORG, EVENT_CONCURRENT],
    );
    bPending = b
      .query(
        "update public.contacts set is_anonymized=true, anonymized_at=coalesce(anonymized_at,now()) where organization_id=$1 and id=$2",
        [ORG, CONTACT_CONCURRENT],
      )
      .then(() => ({}), (error: unknown) => ({ error }));

    await expect
      .poll(
        async () => {
          const row = (
            await observer.query("select wait_event_type from pg_stat_activity where pid=$1", [bpid])
          ).rows[0];
          return row?.wait_event_type === "Lock";
        },
        { timeout: 5_000, interval: 10 },
      )
      .toBe(true);

    let aError: unknown;
    try {
      await a.query(
        "update public.call_operational_exceptions set payload=$1::jsonb where organization_id=$2 and event_id=$3",
        ['{"nome":"Ana Costa","telefone":"5511777777777"}', ORG, EVENT_CONCURRENT],
      );
    } catch (error) {
      aError = error;
    }

    if (aError) await a.query("rollback");
    else await a.query("commit");

    const bOutcome = await bPending;
    if (bOutcome.error) await b.query("rollback");
    else await b.query("commit");

    expect(aError, "a atualização da exceção não deve ser abortada por deadlock").toBeUndefined();
    expect(bOutcome.error, "a anonimização não deve ser abortada por deadlock").toBeUndefined();

    const result = await pool.query(
      "select c.is_anonymized, e.contact_id, e.payload, e.pii_redacted_at from public.contacts c join public.call_operational_exceptions e on e.organization_id=c.organization_id where c.id=$1 and e.event_id=$2",
      [CONTACT_CONCURRENT, EVENT_CONCURRENT],
    );
    expect(result.rows[0]).toMatchObject({
      is_anonymized: true,
      contact_id: null,
      payload: {},
    });
    expect(result.rows[0].pii_redacted_at).toBeTruthy();
  } finally {
    await observer.query("select pg_cancel_backend($1)", [bpid]);
    if (bPending) await bPending;
    await Promise.allSettled([a.query("rollback"), b.query("rollback")]);
    a.release();
    b.release();
    observer.release();
  }
});

it("inserção concorrente à anonimização é redigida sem bloquear nem vazar PII", async () => {
  const anonymization = await pool.connect();
  const insertion = await pool.connect();
  try {
    for (const client of [anonymization, insertion]) {
      await client.query("begin; set local statement_timeout='5s'");
    }

    await anonymization.query(
      "update public.contacts set is_anonymized=true, anonymized_at=coalesce(anonymized_at,now()) where organization_id=$1 and id=$2",
      [ORG, CONTACT_INSERT_CONCURRENT],
    );

    const inserted = await insertion.query(
      `insert into public.call_operational_exceptions
        (organization_id, franchise_id, service_id, event_id, category, severity, status, contact_id, payload)
       values ($1, 1, 83407, $2, 'no_driver', 'high', 'open', $3, $4::jsonb)
       returning contact_id, payload, pii_redacted_at`,
      [ORG, EVENT_INSERT_CONCURRENT, CONTACT_INSERT_CONCURRENT, '{"nome":"Luisa Prado","telefone":"5511666666666"}'],
    );
    expect(inserted.rows[0]).toMatchObject({ contact_id: null, payload: {} });
    expect(inserted.rows[0].pii_redacted_at).toBeTruthy();

    await insertion.query("commit");
    await anonymization.query("commit");

    const persisted = await pool.query(
      "select e.contact_id, e.payload, e.pii_redacted_at, c.is_anonymized from public.call_operational_exceptions e join public.contacts c on c.organization_id=e.organization_id where e.organization_id=$1 and e.event_id=$2",
      [ORG, EVENT_INSERT_CONCURRENT],
    );
    expect(persisted.rows[0]).toMatchObject({
      contact_id: null,
      payload: {},
      is_anonymized: true,
    });
    expect(persisted.rows[0].pii_redacted_at).toBeTruthy();
  } finally {
    await Promise.allSettled([anonymization.query("rollback"), insertion.query("rollback")]);
    anonymization.release();
    insertion.release();
  }
});
