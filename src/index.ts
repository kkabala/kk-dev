export { runCli } from "./cli.ts";
export type { CliIo } from "./cli.ts";
export {
  isReviewRequestPacket,
  isTaskDecisionPacket,
  parseSha256Digest,
  RUN_STATES,
} from "./domain.ts";
export type {
  CandidateProductDecisionPacket,
  CandidateReviewRequestPacket,
  DecisionPacket,
  DecisionQuestion,
  DecisionRequest,
  DecisionSubject,
  DirectTaskSource,
  Intent,
  NonEmptyReadonlyArray,
  RunState,
  Sha256Digest,
  Task,
  TaskProductDecisionPacket,
} from "./domain.ts";
export {
  discoverRepositoryFacts,
  isIntakePacket,
  normalizeTask,
} from "./intake.ts";
export type { IntakeDecision, RepositoryFacts } from "./intake.ts";
export {
  computeEvidenceKey,
  isUncertainEvidenceKey,
  serializeCanonical,
} from "./evidence-key.ts";
export type {
  CertainNamedArtifact,
  CertainRepositoryObject,
  EvidenceGate,
  EvidenceKey,
  EvidenceKeyResult,
  NamedArtifact,
  RepositoryObject,
  RunnerEnvironment,
  UncertainEvidenceKey,
  UncertainNamedArtifact,
  UncertainRepositoryObject,
} from "./evidence-key.ts";
export { FileEvidenceStore } from "./evidence-store.ts";
export type {
  ConsultResult,
  Measurement,
  ReuseDecision,
} from "./evidence-store.ts";
export { FilePreparationStore } from "./preparation-store.ts";
export {
  GATE_CLASSES,
  isResolvedProtectedCommand,
  parseGateTemplate,
  parseGateTemplateCatalog,
  resolveProtectedTemplate,
} from "./gate-template.ts";
export type {
  GateClass,
  GateCommand,
  GateTemplate,
  GateTemplateCatalog,
  ProtectedTemplateRequest,
  ResolvedProtectedCommand,
} from "./gate-template.ts";
export {
  deriveEngineeringStatus,
  ENGINEERING_STATUSES,
  GATE_RESULTS,
  MERGE_MODES,
  RUN_EVENTS,
  RUNNER_ATTEMPTS,
  transitionRunState,
} from "./run-state.ts";
export type {
  EngineeringStatus,
  EngineeringStatusInput,
  GateResult,
  MergeMode,
  RequiredGateEvaluation,
  RunnerAttempt,
  RunEvent,
} from "./run-state.ts";
export { FileRunStateStore } from "./run-state-store.ts";
export type { PersistedRunState } from "./run-state-store.ts";
export { productInfo } from "./product.ts";
export type { ProductInfo } from "./product.ts";
