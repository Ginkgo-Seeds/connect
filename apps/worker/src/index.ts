import { FOUNDATION_STATUS, type FoundationStatus } from '@connect/shared';

export interface WorkerCompositionRoot {
  readonly queueConfigured: false;
  readonly status: FoundationStatus;
}

export function createWorkerCompositionRoot(): WorkerCompositionRoot {
  return {
    queueConfigured: false,
    status: FOUNDATION_STATUS,
  };
}
