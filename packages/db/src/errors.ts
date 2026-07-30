export class KernelPersistenceError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = 'KernelPersistenceError';
  }
}
