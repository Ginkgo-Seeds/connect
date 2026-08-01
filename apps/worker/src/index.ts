import { TaskRunner, type TaskRunnerDependencies } from '@connect/core';
import { PrismaKernelStore, type DatabaseClient } from '@connect/db';
import { FOUNDATION_STATUS, type FoundationStatus } from '@connect/shared';

export interface WorkerDependencies extends Omit<
  TaskRunnerDependencies,
  'store'
> {
  readonly database: DatabaseClient;
}

export interface WorkerCompositionRoot {
  readonly kernelStore: PrismaKernelStore;
  readonly queueConfigured: false;
  readonly runner: TaskRunner;
  readonly status: FoundationStatus;
}

export function createWorkerCompositionRoot(
  dependencies: WorkerDependencies,
): WorkerCompositionRoot {
  const kernelStore = new PrismaKernelStore(
    dependencies.database,
    dependencies.clock,
  );
  return {
    kernelStore,
    queueConfigured: false,
    runner: new TaskRunner({ ...dependencies, store: kernelStore }),
    status: FOUNDATION_STATUS,
  };
}
