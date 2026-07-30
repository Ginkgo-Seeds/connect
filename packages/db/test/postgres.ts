import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';

export interface TestDatabase {
  readonly container: StartedPostgreSqlContainer;
  readonly connectionString: string;
  readonly adminConnectionString: string;
  readonly pool: Pool;
  readonly adminPool: Pool;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:17.6-alpine')
    .withDatabase('ginkgo_connect_test')
    .withUsername('ginkgo_admin')
    .withPassword('ginkgo_admin_password')
    .start();
  const adminConnectionString = container.getConnectionUri();
  const adminPool = new Pool({ connectionString: adminConnectionString });
  await adminPool.query(`
    CREATE ROLE ginkgo_app
      LOGIN
      PASSWORD 'ginkgo_app_password'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS
  `);
  const migrationPath = path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '202607280001_foundation_002_kernel',
    'migration.sql',
  );
  const migration = await readFile(migrationPath, 'utf8');
  await adminPool.query(migration);
  const address = new URL(adminConnectionString);
  address.username = 'ginkgo_app';
  address.password = 'ginkgo_app_password';
  const connectionString = address.toString();
  const pool = new Pool({ connectionString, max: 20 });
  return {
    container,
    connectionString,
    adminConnectionString,
    pool,
    adminPool,
  };
}

export async function stopTestDatabase(database: TestDatabase): Promise<void> {
  await database.pool.end();
  await database.adminPool.end();
  await database.container.stop();
}
