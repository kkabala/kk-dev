export type NonEmptyReadonlyArray<Value> = readonly [Value, ...Value[]];

declare const sha256DigestBrand: unique symbol;

export type Sha256Digest = string &
  Readonly<{
    [sha256DigestBrand]: "Sha256Digest";
  }>;

const canonicalSha256Digest = /^sha256:[0-9a-f]{64}$/u;

export function parseSha256Digest(value: string): Sha256Digest {
  if (typeof value !== "string" || !canonicalSha256Digest.test(value)) {
    throw new TypeError("Invalid SHA-256 digest");
  }

  return value as Sha256Digest;
}

export type DirectTaskSource = Readonly<{
  kind: "direct_text";
  content_digest: Sha256Digest;
}>;

export type Task = Readonly<{
  schema_version: 1;
  task_id: string;
  requested_outcome: string;
  source: DirectTaskSource;
}>;

export type Intent = Readonly<{
  schema_version: 1;
  intent_id: string;
  task_id: string;
  goals: NonEmptyReadonlyArray<string>;
  non_goals: readonly string[];
  constraints: readonly string[];
  unresolved_decisions: readonly string[];
}>;

export type DecisionQuestion = Readonly<{
  question_id: string;
  prompt: string;
  recommended_answer: string;
  alternatives: NonEmptyReadonlyArray<string>;
}>;

type ProductDecisionRequest = Readonly<{
  kind: "product_decision";
  related_questions: NonEmptyReadonlyArray<DecisionQuestion>;
  review_request?: never;
  recommended_answer?: never;
  alternatives?: never;
}>;

type ReviewRequest = Readonly<{
  kind: "review_request";
  review_request: string;
  recommended_answer: string;
  alternatives: NonEmptyReadonlyArray<string>;
  related_questions?: never;
}>;

export type DecisionRequest = ProductDecisionRequest | ReviewRequest;

type TaskDecisionSubject = Readonly<{
  kind: "task";
  candidate_sha?: never;
}>;

type CandidateDecisionSubject = Readonly<{
  kind: "candidate";
  candidate_sha: string;
}>;

export type DecisionSubject = TaskDecisionSubject | CandidateDecisionSubject;

type DecisionPacketBase = Readonly<{
  schema_version: 1;
  packet_id: string;
  task_id: string;
  why_automation_cannot_decide: string;
  affected_behavior: string;
  risk_summary: string;
  evidence_refs: NonEmptyReadonlyArray<string>;
  expires_at: string;
  required_approver_identity: string;
}>;

export type TaskProductDecisionPacket = DecisionPacketBase &
  Readonly<{
    subject: TaskDecisionSubject;
    request: ProductDecisionRequest;
  }>;

export type CandidateProductDecisionPacket = DecisionPacketBase &
  Readonly<{
    subject: CandidateDecisionSubject;
    request: ProductDecisionRequest;
  }>;

export type CandidateReviewRequestPacket = DecisionPacketBase &
  Readonly<{
    subject: CandidateDecisionSubject;
    request: ReviewRequest;
  }>;

export type DecisionPacket =
  | TaskProductDecisionPacket
  | CandidateProductDecisionPacket
  | CandidateReviewRequestPacket;

export function isTaskDecisionPacket(
  packet: DecisionPacket,
): packet is TaskProductDecisionPacket {
  return packet.subject.kind === "task" &&
    packet.request.kind === "product_decision";
}

export function isReviewRequestPacket(
  packet: DecisionPacket,
): packet is CandidateReviewRequestPacket {
  return packet.subject.kind === "candidate" &&
    packet.request.kind === "review_request";
}

declare const runStateBrand: unique symbol;

type BrandedRunState<Value extends string> = Value &
  Readonly<{
    [runStateBrand]: "RunState";
  }>;

const RUN_STATE_VALUES = {
  INTAKE: "INTAKE",
  WAITING_FOR_INTAKE_DECISION: "WAITING_FOR_INTAKE_DECISION",
  INTAKE_BLOCKED: "INTAKE_BLOCKED",
  IMPLEMENTING: "IMPLEMENTING",
  WAITING_FOR_IMPLEMENTATION_DECISION: "WAITING_FOR_IMPLEMENTATION_DECISION",
  VERIFYING: "VERIFYING",
  VERIFYING_BLOCKED: "VERIFYING_BLOCKED",
  WAITING_FOR_EXCEPTION: "WAITING_FOR_EXCEPTION",
  ENGINEERING_READY_WITH_EXCEPTION: "ENGINEERING_READY_WITH_EXCEPTION",
  ENGINEERING_READY: "ENGINEERING_READY",
  WAITING_FOR_REVIEW: "WAITING_FOR_REVIEW",
  MERGE_READY: "MERGE_READY",
  WAITING_FOR_MERGE: "WAITING_FOR_MERGE",
  MERGING: "MERGING",
  MERGED: "MERGED",
  RELEASE_PENDING: "RELEASE_PENDING",
  DELIVERY_VERIFYING: "DELIVERY_VERIFYING",
  DONE: "DONE",
  WAITING_FOR_REPAIR: "WAITING_FOR_REPAIR",
} as const;

type RunStateCatalog = {
  readonly [StateName in keyof typeof RUN_STATE_VALUES]: BrandedRunState<
    (typeof RUN_STATE_VALUES)[StateName]
  >;
};

// The brand exists only at compile time: persisted states remain plain protocol
// strings, while callers must obtain typed states from this catalog.
export const RUN_STATES = Object.freeze(RUN_STATE_VALUES) as RunStateCatalog;

export type RunState = (typeof RUN_STATES)[keyof typeof RUN_STATES];
