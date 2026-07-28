import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const packageNames = [
  'boundary',
  'connectors',
  'core',
  'db',
  'exports',
  'llm',
  'shared',
  'ui',
] as const;

const allowedInternalDependencies: Readonly<
  Record<(typeof packageNames)[number], readonly string[]>
> = {
  boundary: ['@connect/core', '@connect/shared'],
  connectors: ['@connect/boundary', '@connect/core', '@connect/shared'],
  core: ['@connect/shared'],
  db: ['@connect/core', '@connect/shared'],
  exports: ['@connect/boundary', '@connect/core', '@connect/shared'],
  llm: ['@connect/core', '@connect/shared'],
  shared: [],
  ui: ['@connect/shared'],
};

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

async function readSourceTree(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return readSourceTree(entryPath);
      }

      return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')
        ? readFile(entryPath, 'utf8')
        : '';
    }),
  );

  return contents.join('\n');
}

describe('workspace dependency boundaries', () => {
  for (const packageName of packageNames) {
    it(`${packageName} declares only its approved internal dependencies`, async () => {
      const manifestPath = path.join(
        process.cwd(),
        'packages',
        packageName,
        'package.json',
      );
      const manifest = JSON.parse(
        await readFile(manifestPath, 'utf8'),
      ) as PackageManifest;
      const dependencies = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
      };
      const internalDependencies = Object.keys(dependencies)
        .filter((dependency) => dependency.startsWith('@connect/'))
        .sort();

      expect(internalDependencies).toEqual(
        [...allowedInternalDependencies[packageName]].sort(),
      );
    });
  }

  it('keeps core free from runtime and vendor dependencies', async () => {
    const source = await readSourceTree(
      path.join(process.cwd(), 'packages', 'core', 'src'),
    );

    expect(source).not.toMatch(
      /@prisma|fastify|bullmq|anthropic|claude|power\s?bi|process\.env/iu,
    );
  });

  it('keeps boundary free from database adapters', async () => {
    const source = await readSourceTree(
      path.join(process.cwd(), 'packages', 'boundary', 'src'),
    );

    expect(source).not.toMatch(/@connect\/db|@prisma|prisma/iu);
  });

  it('prevents packages from importing applications', async () => {
    const sourceTrees = await Promise.all(
      packageNames.map(async (packageName) =>
        readSourceTree(
          path.join(process.cwd(), 'packages', packageName, 'src'),
        ),
      ),
    );

    expect(sourceTrees.join('\n')).not.toMatch(
      /(?:from|import)\s+['"][^'"]*apps\//u,
    );
  });
});
