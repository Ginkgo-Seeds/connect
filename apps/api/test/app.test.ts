import { afterEach, describe, expect, it } from 'vitest';

import { buildApi } from '../src/app.js';

const openApis: ReturnType<typeof buildApi>[] = [];

afterEach(async () => {
  await Promise.all(openApis.splice(0).map(async (api) => api.close()));
});

describe('GET /health', () => {
  it('reports the foundation state', async () => {
    const api = buildApi();
    openApis.push(api);

    const response = await api.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: 'api',
      status: 'foundation-pending',
    });
  });
});
