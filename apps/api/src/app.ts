import { FOUNDATION_STATUS } from '@connect/shared';
import Fastify, { type FastifyInstance } from 'fastify';

export function buildApi(): FastifyInstance {
  const api = Fastify({ logger: false });

  api.get('/health', async () => ({
    service: 'api',
    status: FOUNDATION_STATUS,
  }));

  return api;
}
