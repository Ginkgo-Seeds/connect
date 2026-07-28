export const FOUNDATION_STATUS = 'foundation-pending' as const;

export type FoundationStatus = typeof FOUNDATION_STATUS;

export interface Port<Input, Output> {
  execute(input: Input): Promise<Output>;
}
