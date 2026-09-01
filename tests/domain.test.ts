import assert from "node:assert/strict";
import test from "node:test";

import {
  isReviewRequestPacket,
  isTaskDecisionPacket,
  parseSha256Digest,
  RUN_STATES,
} from "../src/index.ts";
import type {
  CandidateProductDecisionPacket,
  CandidateReviewRequestPacket,
  DecisionPacket,
  DecisionRequest,
  DecisionSubject,
  Intent,
  RunState,
  Sha256Digest,
  Task,
  TaskProductDecisionPacket,
} from "../src/index.ts";

const directTextDigest = parseSha256Digest(
  "sha256:2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
);

const task = {
  schema_version: 1,
  task_id: "TASK-184",
  requested_outcome: "Add CSV export to the orders page.",
  source: {
    kind: "direct_text",
    content_digest: directTextDigest,
  },
} satisfies Task;

const intent = {
  schema_version: 1,
  intent_id: "INTENT-184",
  task_id: task.task_id,
  goals: ["Customers can export their visible orders as CSV."],
  non_goals: ["Changing the order filtering model."],
  constraints: ["Preserve the existing orders-page authorization boundary."],
  unresolved_decisions: [],
} satisfies Intent;

const readonlyTask: Task = task;
const readonlyIntent: Intent = intent;

const exportScopeQuestion = {
  question_id: "QUESTION-184-SCOPE",
  prompt: "Should the export contain all matching orders or only the visible page?",
  recommended_answer: "Export all orders matching the active filters.",
  alternatives: ["Export only the currently visible page."],
} as const;

const timestampTimezoneQuestion = {
  question_id: "QUESTION-184-TIMEZONE",
  prompt: "Which timezone should timestamp columns use?",
  recommended_answer: "Use the timezone currently displayed on the orders page.",
  alternatives: ["Use UTC for every exported timestamp."],
} as const;

const productDecisionPacket = {
  schema_version: 1,
  packet_id: "PACKET-184-INTAKE",
  task_id: task.task_id,
  subject: {
    kind: "task",
  },
  request: {
    kind: "product_decision",
    related_questions: [exportScopeQuestion, timestampTimezoneQuestion],
  },
  why_automation_cannot_decide:
    "Both choices change customer-visible export behavior and the repository has no policy.",
  affected_behavior: "CSV row selection and timestamp rendering.",
  risk_summary: "A guessed answer could silently export the wrong records.",
  evidence_refs: ["evidence://TASK-184/intake/repository-search"],
  expires_at: "2026-09-02T12:00:00.000Z",
  required_approver_identity: "user:orders-product-owner",
} satisfies DecisionPacket;

const reviewRequestPacket = {
  schema_version: 1,
  packet_id: "PACKET-184-REVIEW",
  task_id: task.task_id,
  subject: {
    kind: "candidate",
    candidate_sha: "def456",
  },
  request: {
    kind: "review_request",
    review_request: "Confirm the accepted security exception for this candidate.",
    recommended_answer: "Reject the exception until the export is access-scoped.",
    alternatives: ["Approve once with compensating audit evidence."],
  },
  why_automation_cannot_decide:
    "Repository policy requires an authenticated human exception decision.",
  affected_behavior: "Which order rows may be exported.",
  risk_summary: "An incorrect approval could expose another account's order data.",
  evidence_refs: ["evidence://TASK-184/run-22"],
  expires_at: "2026-09-02T13:00:00.000Z",
  required_approver_identity: "team:orders-security-owners",
} satisfies DecisionPacket;

const candidateProductDecisionPacket = {
  ...productDecisionPacket,
  packet_id: "PACKET-184-IMPLEMENTATION",
  subject: {
    kind: "candidate",
    candidate_sha: "def456",
  },
} satisfies DecisionPacket;

const readonlyProductDecisionPacket: DecisionPacket = productDecisionPacket;

// These assignments are executable specifications for the domain's invalid states.
// They remain unreachable at runtime while TypeScript verifies every expectation.
if (false) {
  const aliasedTaskSubjectWithCandidate = {
    kind: "task",
    candidate_sha: "def456",
  } as const;
  // @ts-expect-error aliased task subjects must not carry a candidate identity
  const invalidAliasedTaskSubject: DecisionSubject =
    aliasedTaskSubjectWithCandidate;
  void invalidAliasedTaskSubject;

  const aliasedProductRequestWithReviewFields = {
    ...productDecisionPacket.request,
    review_request: "Review this candidate.",
    recommended_answer: "Approve.",
    alternatives: ["Reject."],
  } as const;
  // @ts-expect-error aliased product requests must not carry review-request fields
  const invalidAliasedProductRequest: DecisionRequest =
    aliasedProductRequestWithReviewFields;
  void invalidAliasedProductRequest;

  // @ts-expect-error goals must contain at least one resolved outcome
  const emptyGoals = { ...intent, goals: [] } satisfies Intent;
  void emptyGoals;

  // @ts-expect-error a product-decision packet must contain at least one related question
  const emptyQuestions = { ...productDecisionPacket.request, related_questions: [] } satisfies DecisionPacket["request"];
  void emptyQuestions;

  type ProductDecisionQuestion = Extract<
    DecisionPacket["request"],
    { kind: "product_decision" }
  >["related_questions"][number];

  // @ts-expect-error every product question must offer at least one alternative
  const emptyQuestionAlternatives = { ...exportScopeQuestion, alternatives: [] } satisfies ProductDecisionQuestion;
  void emptyQuestionAlternatives;

  // @ts-expect-error a review request must offer at least one alternative
  const emptyAlternatives = { ...reviewRequestPacket.request, alternatives: [] } satisfies DecisionPacket["request"];
  void emptyAlternatives;

  // @ts-expect-error a candidate decision subject must identify its exact candidate
  const missingCandidateSha = { kind: "candidate" } satisfies DecisionPacket["subject"];
  void missingCandidateSha;

  // @ts-expect-error an intake task subject must not pretend to have a candidate
  const extraCandidateSha = { kind: "task", candidate_sha: "def456" } satisfies DecisionPacket["subject"];
  void extraCandidateSha;

  // @ts-expect-error request variants cannot mix product questions with review fields
  const mixedRequest = { ...productDecisionPacket.request, recommended_answer: "Guess", alternatives: ["Guess differently"] } satisfies DecisionPacket["request"];
  void mixedRequest;

  // @ts-expect-error intake task subjects cannot request candidate review
  const taskReviewRequest = { ...reviewRequestPacket, subject: { kind: "task" } } satisfies DecisionPacket;
  void taskReviewRequest;

  // @ts-expect-error a decision packet must link at least one evidence record
  const emptyEvidence = { ...productDecisionPacket, evidence_refs: [] } satisfies DecisionPacket;
  void emptyEvidence;

  // @ts-expect-error raw strings cannot bypass canonical SHA-256 parsing
  const rawDigest: Sha256Digest = "sha256:abc";
  void rawDigest;

  // @ts-expect-error Task is a readonly value object
  readonlyTask.requested_outcome = "Change the outcome after intake.";

  // @ts-expect-error Task source identity is readonly at the nested boundary
  readonlyTask.source.content_digest = directTextDigest;

  // @ts-expect-error Intent collections are readonly
  readonlyIntent.goals.push("Expand the outcome after preparation.");

  // @ts-expect-error Decision packet evidence is a readonly collection
  readonlyProductDecisionPacket.evidence_refs.push("evidence://replacement");

  if (readonlyProductDecisionPacket.request.kind === "product_decision") {
    // @ts-expect-error Product decision questions are readonly after packet creation
    readonlyProductDecisionPacket.request.related_questions.push(exportScopeQuestion);
  }

  // @ts-expect-error unknown values are not run states
  const unknownState: RunState = "UNKNOWN";
  void unknownState;

  // @ts-expect-error runner attempt results remain a separate type
  const runnerAttemptState: RunState = "PRODUCT_PASS";
  void runnerAttemptState;

  // @ts-expect-error gate results remain a separate type
  const gateResultState: RunState = "PASS";
  void gateResultState;

  // @ts-expect-error engineering results that are not lifecycle positions remain separate
  const engineeringResultState: RunState = "WAITING_GATES";
  void engineeringResultState;

  const engineeringReady: "ENGINEERING_READY" = "ENGINEERING_READY";
  // @ts-expect-error an engineering-result value must not become a lifecycle state by structural coincidence
  const engineeringReadyState: RunState = engineeringReady;
  void engineeringReadyState;

  const engineeringReadyWithException: "ENGINEERING_READY_WITH_EXCEPTION" =
    "ENGINEERING_READY_WITH_EXCEPTION";
  // @ts-expect-error an engineering-result exception value must remain separate from lifecycle state
  const engineeringReadyWithExceptionState: RunState =
    engineeringReadyWithException;
  void engineeringReadyWithExceptionState;

  const intakeState: RunState = RUN_STATES.INTAKE;
  void intakeState;

  // @ts-expect-error merge modes remain a separate type
  const mergeModeState: RunState = "human_merge";
  void mergeModeState;
}

function jsonRoundTrip<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function exerciseDecisionPacketNarrowing(packet: DecisionPacket): void {
  if (isTaskDecisionPacket(packet)) {
    const taskPacket: TaskProductDecisionPacket = packet;
    const firstQuestion = packet.request.related_questions[0];
    void taskPacket;
    void firstQuestion;
    return;
  }

  if (isReviewRequestPacket(packet)) {
    const reviewPacket: CandidateReviewRequestPacket = packet;
    const candidateSha = packet.subject.candidate_sha;
    const reviewRequest = packet.request.review_request;
    void reviewPacket;
    void candidateSha;
    void reviewRequest;
    return;
  }

  const candidateProductPacket: CandidateProductDecisionPacket = packet;
  const candidateSha = packet.subject.candidate_sha;
  const firstQuestion = packet.request.related_questions[0];
  void candidateProductPacket;
  void candidateSha;
  void firstQuestion;
}

test("task and intent expose readonly, versioned, JSON-safe public records", () => {
  assert.deepEqual(jsonRoundTrip(task), task);
  assert.deepEqual(jsonRoundTrip(intent), intent);
  assert.deepEqual(Object.keys(task), [
    "schema_version",
    "task_id",
    "requested_outcome",
    "source",
  ]);
  assert.deepEqual(Object.keys(task.source), ["kind", "content_digest"]);
  assert.equal("repository" in task, false);
  assert.equal("base_ref" in task, false);
});

test("SHA-256 digests preserve canonical strings and reject malformed input", () => {
  const validDigest =
    "sha256:2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";

  assert.equal(parseSha256Digest(validDigest), validDigest);
  assert.equal(JSON.stringify(parseSha256Digest(validDigest)), `"${validDigest}"`);

  const invalidDigests = [
    "",
    "sha256:abc",
    `sha256:${"A".repeat(64)}`,
    `sha256:${"g".repeat(64)}`,
    "0".repeat(64),
  ];

  for (const invalidDigest of invalidDigests) {
    assert.throws(
      () => parseSha256Digest(invalidDigest),
      {
        name: "TypeError",
        message: "Invalid SHA-256 digest",
      },
    );
  }

  const coercibleNonStringDigest = {
    toString: () => validDigest,
  };
  assert.throws(
    () => parseSha256Digest(coercibleNonStringDigest as unknown as string),
    {
      name: "TypeError",
      message: "Invalid SHA-256 digest",
    },
    "the runtime parser must not coerce non-string package inputs",
  );
});

test("decision packets preserve distinct intake and candidate-review shapes", () => {
  assert.deepEqual(jsonRoundTrip(productDecisionPacket), productDecisionPacket);
  assert.deepEqual(jsonRoundTrip(reviewRequestPacket), reviewRequestPacket);
  assert.deepEqual(
    jsonRoundTrip(candidateProductDecisionPacket),
    candidateProductDecisionPacket,
  );
  assert.equal("candidate_sha" in productDecisionPacket.subject, false);
  assert.equal(reviewRequestPacket.subject.candidate_sha, "def456");
  assert.equal(candidateProductDecisionPacket.subject.candidate_sha, "def456");
  assert.equal(candidateProductDecisionPacket.request.kind, "product_decision");
  assert.deepEqual(productDecisionPacket.request.related_questions, [
    {
      question_id: "QUESTION-184-SCOPE",
      prompt: "Should the export contain all matching orders or only the visible page?",
      recommended_answer: "Export all orders matching the active filters.",
      alternatives: ["Export only the currently visible page."],
    },
    {
      question_id: "QUESTION-184-TIMEZONE",
      prompt: "Which timezone should timestamp columns use?",
      recommended_answer: "Use the timezone currently displayed on the orders page.",
      alternatives: ["Use UTC for every exported timestamp."],
    },
  ]);
  assert.deepEqual(reviewRequestPacket.request.alternatives, [
    "Approve once with compensating audit evidence.",
  ]);
});

test("decision-packet guards identify task decisions and candidate reviews", () => {
  exerciseDecisionPacketNarrowing(productDecisionPacket);
  exerciseDecisionPacketNarrowing(candidateProductDecisionPacket);
  exerciseDecisionPacketNarrowing(reviewRequestPacket);

  assert.deepEqual(
    [
      isTaskDecisionPacket(productDecisionPacket),
      isReviewRequestPacket(productDecisionPacket),
    ],
    [true, false],
  );
  assert.deepEqual(
    [
      isTaskDecisionPacket(candidateProductDecisionPacket),
      isReviewRequestPacket(candidateProductDecisionPacket),
    ],
    [false, false],
  );
  assert.deepEqual(
    [
      isTaskDecisionPacket(reviewRequestPacket),
      isReviewRequestPacket(reviewRequestPacket),
    ],
    [false, true],
  );
});

test("the frozen run-state catalog contains exactly the 19 lifecycle positions", () => {
  const expectedStates = {
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

  assert.deepEqual(RUN_STATES, expectedStates);
  assert.equal(Object.isFrozen(RUN_STATES), true);
  assert.equal(JSON.stringify(RUN_STATES.INTAKE), '"INTAKE"');

  const stateValues = Object.values(RUN_STATES);
  assert.equal(stateValues.length, 19);
  assert.equal(new Set(stateValues).size, stateValues.length);
});
