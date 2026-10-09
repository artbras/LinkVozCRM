import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const ORG_A = "8d420000-0000-4000-8000-0000000000a1";
const ORG_B = "8d420000-0000-4000-8000-0000000000b1";
const SERVICE_ID = 83401;

const SERVER_ONLY_TABLES = [
  "call_webhook_events",
  "call_service_drafts",
  "call_service_operational_state",
  "call_operational_exceptions",
] as const;

function insertForServiceRole(table: (typeof SERVER_ONLY_TABLES)[number]): { sql: string; expected: string } {
  switch (table) {
    case "call_webhook_events":
      return {
        sql: `insert into public.call_webhook_events (event_id, event_type, franchise_id, service_id, organization_id, payload) values ('call-rls-service-role-83401', 'service.updated', 1, ${SERVICE_ID}, '${ORG_A}', '{}'::jsonb) on conflict (event_id) do update set payload = excluded.payload; select count(*) from public.call_webhook_events where event_id = 'call-rls-service-role-83401';`,
        expected: "1",
      };
    case "call_service_drafts":
      return {
        sql: `insert into public.call_service_drafts (id, organization_id, franchise_id, service_payload, state) values ('8d420000-0000-4000-8000-0000000000a3', '${ORG_A}', 1, '{}'::jsonb, 'awaiting_confirmation') on conflict (id) do update set service_payload = excluded.service_payload; select count(*) from public.call_service_drafts where id = '8d420000-0000-4000-8000-0000000000a3';`,
        expected: "1",
      };
    case "call_service_operational_state":
      return {
        sql: `insert into public.call_service_operational_state (organization_id, franchise_id, service_id, status, event_id) values ('${ORG_A}', 1, ${SERVICE_ID + 1}, 'on_the_way', 'call-rls-service-state-83401') on conflict (organization_id, service_id) do update set event_id = excluded.event_id; select count(*) from public.call_service_operational_state where organization_id = '${ORG_A}' and service_id = ${SERVICE_ID + 1};`,
        expected: "1",
      };
    case "call_operational_exceptions":
      return {
        sql: `insert into public.call_operational_exceptions (organization_id, franchise_id, service_id, event_id, category, severity, status, payload) values ('${ORG_A}', 1, ${SERVICE_ID + 1}, 'call-rls-service-exception-83401', 'no_driver', 'high', 'open', '{}'::jsonb) on conflict (organization_id, event_id) do update set payload = excluded.payload; select count(*) from public.call_operational_exceptions where organization_id = '${ORG_A}' and event_id = 'call-rls-service-exception-83401';`,
        expected: "1",
      };
  }
}

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'call-rls-a-83401', 'Call RLS A', 'Call RLS A'),
      ('${ORG_B}', 'call-rls-b-83401', 'Call RLS B', 'Call RLS B')
      on conflict (id) do nothing;

    insert into public.call_webhook_events
      (event_id, event_type, franchise_id, service_id, organization_id, payload)
    values
      ('call-rls-a-83401', 'service.updated', 1, ${SERVICE_ID}, '${ORG_A}', '{"mensagem":"PORTA"}'::jsonb),
      ('call-rls-b-83401', 'service.updated', 1, ${SERVICE_ID}, '${ORG_B}', '{"mensagem":"PORTA"}'::jsonb)
    on conflict (event_id) do nothing;

    insert into public.call_service_drafts
      (id, organization_id, franchise_id, service_payload, state)
    values
      ('8d420000-0000-4000-8000-0000000000a2', '${ORG_A}', 1, '{"nome":"A"}'::jsonb, 'awaiting_confirmation'),
      ('8d420000-0000-4000-8000-0000000000b2', '${ORG_B}', 1, '{"nome":"B"}'::jsonb, 'awaiting_confirmation')
    on conflict (id) do nothing;

    insert into public.call_service_operational_state
      (organization_id, franchise_id, service_id, status, event_id)
    values
      ('${ORG_A}', 1, ${SERVICE_ID}, 'on_the_way', 'call-rls-a-83401'),
      ('${ORG_B}', 1, ${SERVICE_ID}, 'on_the_way', 'call-rls-b-83401')
    on conflict (organization_id, service_id) do nothing;

    insert into public.call_operational_exceptions
      (organization_id, franchise_id, service_id, event_id, category, severity, status, payload)
    values
      ('${ORG_A}', 1, ${SERVICE_ID}, 'call-rls-a-83401', 'no_driver', 'high', 'open', '{"note":"A"}'::jsonb),
      ('${ORG_B}', 1, ${SERVICE_ID}, 'call-rls-b-83401', 'no_driver', 'high', 'open', '{"note":"B"}'::jsonb)
    on conflict (organization_id, event_id) do nothing;
  `);
});

describe("as tabelas operacionais do Call são exclusivas do servidor", () => {
  it.each(SERVER_ONLY_TABLES)("%s mantém RLS, sem policies ou grants de cliente", (table) => {
    expect(
      sql(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass;`),
    ).toBe("t");
    expect(
      sql(`select count(*) from pg_policies where schemaname = 'public' and tablename = '${table}';`),
    ).toBe("0");

    for (const role of ["anon", "authenticated"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(
          sql(`select has_table_privilege('${role}', 'public.${table}', '${privilege}');`),
          `${role} não deve ter ${privilege} em ${table}`,
        ).toBe("f");
      }
    }

    for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
      expect(
        sql(`select has_table_privilege('service_role', 'public.${table}', '${privilege}');`),
      ).toBe("t");
    }
  });

  it.each(SERVER_ONLY_TABLES)("%s recusa leitura direta, mas mantém leitura operacional", (table) => {
    for (const role of ["anon", "authenticated"]) {
      expect(() =>
        sql(`
          set role ${role};
          select count(*) from public.${table}
           where organization_id in ('${ORG_A}', '${ORG_B}');
        `),
      ).toThrow();
    }

    const result = sql(`
      set role service_role;
      select count(*) from public.${table}
       where organization_id in ('${ORG_A}', '${ORG_B}');
    `).trim().split(/\r?\n/).at(-1);
    expect(result).toBe("2");
  });

  it.each(SERVER_ONLY_TABLES)("%s permite escrita operacional apenas a service_role", (table) => {
    const insert = insertForServiceRole(table);
    const result = sql(`set role service_role; ${insert.sql}`).trim().split(/\r?\n/).at(-1);
    expect(result).toBe(insert.expected);
  });
});
