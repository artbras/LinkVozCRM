import { describe, expect, it, vi } from 'vitest';

import { anotarUltimaInboundVista } from './turno-ja-respondido';

describe('anotarUltimaInboundVista', () => {
  it('persiste o inbound do job, nunca o inbound mais novo que chegou depois', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await anotarUltimaInboundVista(
      { query },
      {
        organizationId: 'org',
        contactId: 'contact',
        conversationId: 'conversation',
        jobId: 'job',
        inboundMessageId: 'inbound-do-job',
      },
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('m.id = $3'),
      ['org', 'conversation', 'inbound-do-job', 'job'],
    );
    expect(query.mock.calls[0][0]).not.toContain('max(m.created_at)');
  });
});
