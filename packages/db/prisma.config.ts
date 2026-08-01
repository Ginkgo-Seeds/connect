import 'dotenv/config';

import { defineConfig } from 'prisma/config';

const localDatabaseUrl =
  'postgresql://ginkgo_admin:local-postgres-admin-change-me@127.0.0.1:15432/ginkgo_connect';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_ADMIN_URL ?? localDatabaseUrl,
  },
});
