export interface DatabaseHealth {
  readonly latencyMilliseconds: number;
  readonly status: 'healthy' | 'unavailable';
}

export interface DatabaseHealthPort {
  check(): Promise<DatabaseHealth>;
}

export interface TransactionPort {
  run<Result>(operation: () => Promise<Result>): Promise<Result>;
}
