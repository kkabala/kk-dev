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
export { observeDelivery } from "./delivery.ts";
export type {
  DeliveryActor,
  DeliveryObservation,
  DeliveryTarget,
} from "./delivery.ts";
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
export { evaluateTask } from "./evaluator.ts";
export type { EvaluatedGate, TaskDecision } from "./evaluator.ts";
export { resolveExceptions } from "./exception.ts";
export type {
  AcceptedGap,
  ExceptionCoverage,
  ExceptionDecision,
  ExceptionRecord,
  ExceptionResolution,
  OverrideException,
} from "./exception.ts";
export { FileEvidenceStore } from "./evidence-store.ts";
export type {
  ConsultResult,
  Measurement,
  ReuseDecision,
} from "./evidence-store.ts";
export {
  applyIntendedRedOverlay,
  evaluateCandidatePac,
  evaluateIntendedRed,
  lockPac,
  parsePac,
} from "./pac.ts";
export type {
  IntendedRedOverlay,
  OverlayEntry,
  PacOutcome,
  PacRecord,
  PacRunEvaluation,
} from "./pac.ts";
export { FilePreparationStore } from "./preparation-store.ts";
export { classifyRisk } from "./risk.ts";
export type { PathRisk, RiskDecision } from "./risk.ts";
export { resolveVerificationBoundaries } from "./roles.ts";
export type {
  AgentIdentities,
  HarnessProposal,
  VerificationBoundaries,
} from "./roles.ts";
export { deriveGates } from "./gates.ts";
export type { GatePlan, PlannedGate } from "./gates.ts";
export {
  DEFAULT_INFRASTRUCTURE_RETRIES,
  DEFAULT_MAX_ARTIFACT_BYTES,
  parseRunnerAttempt,
  ProtectedRunner,
  redactText,
} from "./protected-runner.ts";
export type {
  AdvisoryArtifact,
  ArtifactPolicy,
  BoundArtifact,
  ExecuteProtectedCommand,
  ObservedArtifact,
  ParsedRunnerAttempt,
  ProtectedRunRequest,
  RunnerObservation,
  RunnerSessionResult,
} from "./protected-runner.ts";
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
export { matchSurfaces, PATH_CATEGORIES, RISK_TIERS } from "./surfaces.ts";
export type {
  MatchedSurface,
  PathCategory,
  PathClassification,
  PathRule,
  RiskTier,
  SurfaceDecision,
  SurfaceRecord,
} from "./surfaces.ts";
export { productInfo } from "./product.ts";
export type { ProductInfo } from "./product.ts";
export { checkPstackHealth } from "./pstack-health.ts";
export type { PstackEngine, PstackHealth } from "./pstack-health.ts";
export { buildAssignment } from "./pstack-assignment.ts";
export type {
  AssignmentCapabilities,
  PstackAssignment,
} from "./pstack-assignment.ts";
export { collectCandidate } from "./pstack-candidate.ts";
export type {
  AdvisoryObservation,
  PstackCandidate,
} from "./pstack-candidate.ts";
export { resolvePstackRuntime } from "./pstack-runtime.ts";
export type { PstackRuntime } from "./pstack-runtime.ts";
export { evaluateAutoMerge } from "./github-auto-merge.ts";
export type {
  AutoMergeAction,
  AutoMergeDecision,
} from "./github-auto-merge.ts";
export { MERGE_METHODS, resolveMergeCandidate } from "./github-g7.ts";
export type {
  MergeCandidateDecision,
  MergeCandidateIdentity,
  MergeMethod,
  QueueMergeCandidate,
  TupleMergeCandidate,
} from "./github-g7.ts";
export { evaluateGovernance } from "./github-governance.ts";
export type {
  GovernanceDecision,
  GovernanceReviews,
} from "./github-governance.ts";
export { parseGithubState } from "./github.ts";
export type {
  GithubActor,
  GithubPullRequest,
  GithubState,
} from "./github.ts";
export { syncDraftPullRequest } from "./github-pr.ts";
export type {
  DraftPullRequestSync,
  ExoframeCheck,
} from "./github-pr.ts";
export { buildBounce } from "./bounce.ts";
export type { BounceDecision, RepairBounce } from "./bounce.ts";
