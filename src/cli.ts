import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, lstat, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { parseSha256Digest, RUN_STATES } from "./domain.ts";
import type { Intent, Sha256Digest, Task, TaskProductDecisionPacket } from "./domain.ts";
import {
  computeEvidenceKey,
  isUncertainEvidenceKey,
  serializeCanonical,
} from "./evidence-key.ts";
import { FileEvidenceStore } from "./evidence-store.ts";
import { resolveProtectedTemplate } from "./gate-template.ts";
import type { ResolvedProtectedCommand } from "./gate-template.ts";
import {
  discoverRepositoryFacts,
  isIntakePacket,
  normalizeTask,
} from "./intake.ts";
import { FilePreparationStore } from "./preparation-store.ts";
import { productInfo } from "./product.ts";
import {
  DEFAULT_INFRASTRUCTURE_RETRIES,
  DEFAULT_MAX_ARTIFACT_BYTES,
  ProtectedRunner,
} from "./protected-runner.ts";
import {
  FileRunCatalog,
  isRunCatalogIdentifier,
} from "./run-catalog.ts";
import type { RunCatalogRecord } from "./run-catalog.ts";
import { RUN_EVENTS, transitionRunState } from "./run-state.ts";
import { FileRunStateStore } from "./run-state-store.ts";
import type { PersistedRunState } from "./run-state-store.ts";
import { bootstrapRiskPolicy } from "./risk-bootstrap.ts";
import { matchSurfaces } from "./surfaces.ts";
