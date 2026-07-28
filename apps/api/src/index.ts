import { buildApi } from './app.js';

const defaultPort = 3001;
const requestedPort = Number.parseInt(
  process.env.CONNECT_API_PORT ?? `${defaultPort}`,
  10,
);
const port = Number.isNaN(requestedPort) ? defaultPort : requestedPort;
const host = process.env.CONNECT_API_HOST ?? '127.0.0.1';

const api = buildApi();

await api.listen({ host, port });
