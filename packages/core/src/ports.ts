import type {
  ApprovalEnvelope,
  CommandMetadata,
  CreateTaskInput,
  EffectivePolicy,
  ExecutionAttempt,
  ExecutionResult,
  FrozenDecision,
  PersistedEvidence,
  PersistedTaskEvent,
  PricingSnapshot,
  SkillCatalog,
  SkillDefinition,
  Task,
  TrustedOrganizationContext,
} from './domain.js';

export interface ClockPort {
  now(): Date;
}

export interface IdentifierPort {
  next(): string;
}

export interface ResolutionContext {
  readonly organizationId: string;
  readonly taskId: string;
  readonly intent: string;
}

export interface PricingContext extends ResolutionContext {
  readonly skill: SkillDefinition;
}

export interface SkillCatalogProvider {
  loadCurrentCatalog(context: ResolutionContext): Promise<SkillCatalog>;
}

export interface EffectivePolicyProvider {
  loadEffectivePolicy(context: ResolutionContext): Promise<EffectivePolicy>;
}

export interface PricingProvider {
  loadCurrentPricing(context: PricingContext): Promise<PricingSnapshot>;
}

export interface ExecutorEligibilityProvider {
  isEligible(skill: SkillDefinition): Promise<boolean>;
}

export interface ExecuteContext {
  readonly task: Task;
  readonly decision: FrozenDecision;
  readonly attemptId: string;
  readonly idempotencyKey: string;
  readonly maximumCredits: bigint;
}

export interface SkillExecutor {
  execute(context: ExecuteContext): Promise<ExecutionResult>;
}

export interface ExecutionSnapshot {
  readonly task: Task;
  readonly decision: FrozenDecision;
  readonly attempt: ExecutionAttempt;
  readonly evidence: readonly PersistedEvidence[];
}

export interface ExecutionClaim {
  readonly task: Task;
  readonly decision: FrozenDecision;
  readonly attempt: ExecutionAttempt;
  readonly acquired: boolean;
}

export interface VersionedTaskCommand {
  readonly context: TrustedOrganizationContext;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export interface KernelStore {
  createTask(
    context: TrustedOrganizationContext,
    input: CreateTaskInput,
    command: CommandMetadata,
  ): Promise<Task>;
  getTask(
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<Task | null>;
  getFrozenDecision(
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<FrozenDecision | null>;
  classifyTask(
    context: TrustedOrganizationContext,
    task: Task,
    command: CommandMetadata,
  ): Promise<Task>;
  failTask(
    context: TrustedOrganizationContext,
    task: Task,
    failureCode: string,
    command: CommandMetadata,
  ): Promise<Task>;
  freezeDecision(
    context: TrustedOrganizationContext,
    task: Task,
    decision: FrozenDecision,
    command: CommandMetadata,
  ): Promise<Task>;
  blockForApproval(
    context: TrustedOrganizationContext,
    task: Task,
    envelope: ApprovalEnvelope,
    command: CommandMetadata,
  ): Promise<Task>;
  gateAutomatically(
    context: TrustedOrganizationContext,
    task: Task,
    decision: FrozenDecision,
    command: CommandMetadata,
  ): Promise<Task>;
  approveAndTryGate(
    context: TrustedOrganizationContext,
    taskId: string,
    approvalEnvelopeId: string,
    reason: string | null,
    command: CommandMetadata,
  ): Promise<Task>;
  resumeApproved(
    context: TrustedOrganizationContext,
    taskId: string,
    command: CommandMetadata,
  ): Promise<Task>;
  reject(
    context: TrustedOrganizationContext,
    taskId: string,
    approvalEnvelopeId: string,
    reason: string | null,
    command: CommandMetadata,
  ): Promise<Task>;
  claimExecution(
    context: TrustedOrganizationContext,
    task: Task,
    workerId: string,
    leaseUntil: Date,
    command: CommandMetadata,
  ): Promise<ExecutionClaim>;
  dispatchExecution(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    command: CommandMetadata,
  ): Promise<ExecutionClaim>;
  recordExecutionSuccess(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    result: ExecutionResult,
    command: CommandMetadata,
  ): Promise<Task>;
  recordExecutionFailure(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    result: ExecutionResult | null,
    failureCode: string,
    command: CommandMetadata,
  ): Promise<Task>;
  recordBudgetOverrun(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    result: ExecutionResult,
    command: CommandMetadata,
  ): Promise<Task>;
  recordPostExecutionPersistenceFailure(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    result: ExecutionResult | null,
    failureCode: string,
    command: CommandMetadata,
  ): Promise<Task>;
  getExecutionSnapshot(
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<ExecutionSnapshot | null>;
  listTaskEvidence(
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<readonly PersistedEvidence[]>;
  listTaskEvents(
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<readonly PersistedTaskEvent[]>;
  markVerified(input: VersionedTaskCommand): Promise<Task>;
  commitTask(input: VersionedTaskCommand): Promise<Task>;
}
