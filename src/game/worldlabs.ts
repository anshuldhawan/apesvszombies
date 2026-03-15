import type { WorldDefinition } from "./types";

const WORLD_LABS_API_BASE_URL = "https://api.worldlabs.ai/marble/v1";
const WORLD_LABS_GENERATE_MODEL = "Marble 0.1-plus";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 6 * 60 * 1_000;
const MAX_GENERATION_ATTEMPTS = 2;
// Prefer the lightest gameplay-ready splat first so generated worlds boot faster.
const SPZ_URL_PREFERENCE = ["100k", "500k", "full_res"] as const;

type JsonRecord = Record<string, unknown>;

interface WorldLabsOperationError {
  code?: number;
  message?: string;
}

interface WorldLabsOperation {
  done: boolean;
  operation_id: string;
  error?: WorldLabsOperationError | null;
  metadata?: JsonRecord | null;
  response?: unknown;
}

interface ResolvedWorldAssets {
  worldId: string;
  label: string;
  spzUrl: string;
  collisionGlbUrl: string;
  worldMarbleUrl?: string;
  thumbnailUrl?: string;
  promptText?: string;
}

type GenerationProgressSource = "operation" | "world";
type GenerationFailureCode = "assets_unavailable" | "operation_error" | "request_error";

interface AttemptSuccessResult {
  kind: "success";
  world: WorldDefinition;
  operationId: string;
  worldId: string;
  readinessSource: GenerationProgressSource;
}

interface AttemptFailureResult {
  kind: "failed";
  code: GenerationFailureCode;
  reason: string;
  operationId: string | null;
  worldId: string | null;
  worldMarbleUrl?: string;
  assetSummary: string;
}

export interface GenerationProgressUpdate {
  phase: "requesting" | "polling" | "retrying";
  message: string;
  operationId: string | null;
  worldId: string | null;
  attempt: number;
  elapsedMs: number;
  source: GenerationProgressSource;
}

export interface GenerateWorldSuccessResult {
  kind: "success";
  world: WorldDefinition;
  attemptCount: number;
  readinessSource: GenerationProgressSource;
}

export interface GenerateWorldFailureResult {
  kind: "failed";
  code: GenerationFailureCode;
  reason: string;
  worldId: string | null;
  operationId: string | null;
  worldMarbleUrl?: string;
  assetSummary: string;
  attemptCount: number;
}

export type GenerateWorldResult = GenerateWorldSuccessResult | GenerateWorldFailureResult;

export interface GenerateWorldOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
  onProgress?: (progress: GenerationProgressUpdate) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function normalizeLocationInput(inputLocation: string): string {
  const trimmed = inputLocation.trim();

  if (!trimmed) {
    throw new Error("Enter a location before generating a world.");
  }

  return trimmed;
}

export function buildShooterWorldPrompt(inputLocation: string): string {
  const location = normalizeLocationInput(inputLocation);
  return `Generate a ${location} world that functions as a map and scene for playing a shooter game. i.e it has a way for players to hide behind structures`;
}

export function selectPreferredSpzUrl(spzUrls: unknown): string | null {
  const urls = asRecord(spzUrls);

  if (!urls) {
    return null;
  }

  for (const key of SPZ_URL_PREFERENCE) {
    const value = getOptionalString(urls[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

export function resolveGeneratedWorldAssets(payload: unknown): ResolvedWorldAssets {
  const world = unwrapWorldEnvelope(payload);
  const worldId = getRequiredWorldId(world);
  const assets = asRecord(world.assets);
  const mesh = asRecord(assets?.mesh);
  const splats = asRecord(assets?.splats);
  const worldPrompt = asRecord(world.world_prompt);
  const label =
    getOptionalString(world.display_name) ??
    getOptionalString(world.title) ??
    getOptionalString(world.name) ??
    worldId;
  const spzUrl = selectPreferredSpzUrl(splats?.spz_urls);

  if (!spzUrl) {
    throw new Error("World Labs did not return a usable SPZ splat URL for this world.");
  }

  return {
    worldId,
    label,
    spzUrl,
    collisionGlbUrl: getRequiredString(
      mesh,
      "collider_mesh_url",
      "World Labs did not return a collider mesh for this world."
    ),
    worldMarbleUrl: getOptionalString(world.world_marble_url) ?? undefined,
    thumbnailUrl: getOptionalString(assets?.thumbnail_url) ?? undefined,
    promptText: getOptionalString(worldPrompt?.text_prompt) ?? undefined
  };
}

export function buildGeneratedWorldDefinition(
  inputLocation: string,
  payload: unknown
): WorldDefinition {
  const location = normalizeLocationInput(inputLocation);
  const resolved = resolveGeneratedWorldAssets(payload);
  const promptText = resolved.promptText ?? buildShooterWorldPrompt(location);

  return {
    id: resolved.worldId,
    label: resolved.label || location,
    spzUrl: resolved.spzUrl,
    collisionGlbUrl: resolved.collisionGlbUrl,
    source: "generated",
    worldLabsId: resolved.worldId,
    promptText,
    worldMarbleUrl: resolved.worldMarbleUrl,
    thumbnailUrl: resolved.thumbnailUrl
  };
}

export async function generateWorldFromLocation(
  inputLocation: string,
  options: GenerateWorldOptions = {}
): Promise<GenerateWorldResult> {
  const location = normalizeLocationInput(inputLocation);
  const promptText = buildShooterWorldPrompt(location);
  const displayName = toDisplayName(location);
  const apiKey = resolveApiKey(options.apiKey);
  const fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  let previousFailure: AttemptFailureResult | null = null;

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    if (attempt === 1) {
      options.onProgress?.({
        phase: "requesting",
        message: "Sending your prompt to World Labs.",
        operationId: null,
        worldId: null,
        attempt,
        elapsedMs: 0,
        source: "operation"
      });
    } else if (previousFailure) {
      options.onProgress?.({
        phase: "retrying",
        message:
          "World Labs generated the splat world but did not provide a collider mesh. Retrying once with the same prompt.",
        operationId: previousFailure.operationId,
        worldId: previousFailure.worldId,
        attempt,
        elapsedMs: 0,
        source: "world"
      });
    }

    const attemptResult = await generateWorldAttempt(
      {
        location,
        promptText,
        displayName,
        apiKey,
        fetchFn,
        pollIntervalMs,
        timeoutMs,
        now,
        sleep,
        onProgress: options.onProgress
      },
      attempt
    );

    if (attemptResult.kind === "success") {
      return {
        kind: "success",
        world: attemptResult.world,
        attemptCount: attempt,
        readinessSource: attemptResult.readinessSource
      };
    }

    if (attemptResult.code !== "assets_unavailable" || attempt === MAX_GENERATION_ATTEMPTS) {
      return {
        ...attemptResult,
        attemptCount: attempt
      };
    }

    previousFailure = attemptResult;
  }

  return {
    kind: "failed",
    code: "request_error",
    reason: "World generation ended unexpectedly before a playable shooter map was produced.",
    worldId: null,
    operationId: null,
    assetSummary: "world payload unavailable",
    attemptCount: MAX_GENERATION_ATTEMPTS
  };
}

async function generateWorldAttempt(
  options: {
    location: string;
    promptText: string;
    displayName: string;
    apiKey: string;
    fetchFn: typeof fetch;
    pollIntervalMs: number;
    timeoutMs: number;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    onProgress?: (progress: GenerationProgressUpdate) => void;
  },
  attempt: number
): Promise<AttemptSuccessResult | AttemptFailureResult> {
  const startedAt = options.now();
  const initialOperationPayload = await safelyRequestJson(
    `${WORLD_LABS_API_BASE_URL}/worlds:generate`,
    {
      method: "POST",
      headers: createWorldLabsHeaders(options.apiKey),
      body: JSON.stringify({
        display_name: options.displayName,
        model: WORLD_LABS_GENERATE_MODEL,
        world_prompt: {
          type: "text",
          text_prompt: options.promptText,
          disable_recaption: true
        }
      })
    },
    options.fetchFn
  );

  if (initialOperationPayload.kind === "failed") {
    return initialOperationPayload;
  }

  let operation = parseOperation(initialOperationPayload.payload);
  let worldId = getOperationWorldId(operation);
  let worldMarbleUrl = getWorldMarbleUrl(operation.response);
  let assetSummary = "world payload unavailable";

  logOperationSnapshot(operation, attempt, options.now() - startedAt);

  for (;;) {
    if (operation.error) {
      return createFailureResult(
        "operation_error",
        getOptionalString(operation.error.message) ??
          "World Labs reported an unknown generation error.",
        worldId,
        operation.operation_id,
        worldMarbleUrl,
        assetSummary
      );
    }

    if (worldId) {
      const worldPayloadResult = await safelyRequestJson(
        `${WORLD_LABS_API_BASE_URL}/worlds/${worldId}`,
        {
          method: "GET",
          headers: createWorldLabsHeaders(options.apiKey)
        },
        options.fetchFn
      );

      if (worldPayloadResult.kind === "failed") {
        return {
          ...worldPayloadResult,
          worldId,
          operationId: operation.operation_id,
          worldMarbleUrl
        };
      }

      const worldPayload = worldPayloadResult.payload;
      worldMarbleUrl = getWorldMarbleUrl(worldPayload) ?? worldMarbleUrl;
      assetSummary = summarizeWorldAssetState(worldPayload);
      logWorldSnapshot(worldPayload, operation.operation_id, attempt, options.now() - startedAt);

      const worldReadiness = inspectWorldReadiness(options.location, worldPayload);

      if (worldReadiness.kind === "ready") {
        return {
          kind: "success",
          world: worldReadiness.world,
          operationId: operation.operation_id,
          worldId: worldReadiness.world.id,
          readinessSource: "world"
        };
      }

      if (worldReadiness.kind === "invalid") {
        return createFailureResult(
          "request_error",
          worldReadiness.reason,
          worldId,
          operation.operation_id,
          worldMarbleUrl,
          assetSummary
        );
      }
    }

    const operationReadiness = inspectWorldReadiness(options.location, operation.response);
    if (operationReadiness.kind === "ready") {
      return {
        kind: "success",
        world: operationReadiness.world,
        operationId: operation.operation_id,
        worldId: operationReadiness.world.id,
        readinessSource: "operation"
      };
    }

    if (operationReadiness.kind === "invalid") {
      return createFailureResult(
        "request_error",
        operationReadiness.reason,
        worldId,
        operation.operation_id,
        worldMarbleUrl,
        assetSummary
      );
    }

    const elapsedMs = options.now() - startedAt;

    if (elapsedMs >= options.timeoutMs) {
      return createFailureResult(
        "assets_unavailable",
        "World Labs generated the splat world but did not provide a collider mesh, so shooter mode cannot start.",
        worldId,
        operation.operation_id,
        worldMarbleUrl,
        assetSummary
      );
    }

    options.onProgress?.({
      phase: "polling",
      message:
        worldId && operationReadiness.kind === "waiting"
          ? `World generated. Waiting for the collider mesh export to become available (${formatElapsedTime(elapsedMs)} elapsed, attempt ${attempt}).`
          : getOperationStatusMessage(operation, options.location),
      operationId: operation.operation_id,
      worldId,
      attempt,
      elapsedMs,
      source: worldId ? "world" : "operation"
    });

    await options.sleep(options.pollIntervalMs);

    const nextOperationPayload = await safelyRequestJson(
      `${WORLD_LABS_API_BASE_URL}/operations/${operation.operation_id}`,
      {
        method: "GET",
        headers: createWorldLabsHeaders(options.apiKey)
      },
      options.fetchFn
    );

    if (nextOperationPayload.kind === "failed") {
      return {
        ...nextOperationPayload,
        worldId,
        operationId: operation.operation_id,
        worldMarbleUrl,
        assetSummary
      };
    }

    operation = parseOperation(nextOperationPayload.payload);
    worldId = getOperationWorldId(operation) ?? worldId;
    worldMarbleUrl = getWorldMarbleUrl(operation.response) ?? worldMarbleUrl;
    logOperationSnapshot(operation, attempt, options.now() - startedAt);
  }
}

function inspectWorldReadiness(
  inputLocation: string,
  payload: unknown
):
  | { kind: "ready"; world: WorldDefinition }
  | { kind: "waiting" }
  | { kind: "invalid"; reason: string } {
  if (!payload) {
    return { kind: "waiting" };
  }

  try {
    return {
      kind: "ready",
      world: buildGeneratedWorldDefinition(inputLocation, payload)
    };
  } catch (error) {
    if (isRecoverableAssetResolutionError(error)) {
      return { kind: "waiting" };
    }

    return {
      kind: "invalid",
      reason:
        error instanceof Error
          ? error.message
          : "World Labs returned an invalid world payload."
    };
  }
}

async function safelyRequestJson(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch
): Promise<{ kind: "success"; payload: unknown } | AttemptFailureResult> {
  try {
    const payload = await requestJson(url, init, fetchFn);
    return {
      kind: "success",
      payload
    };
  } catch (error) {
    return createFailureResult(
      "request_error",
      error instanceof Error ? error.message : "World Labs request failed.",
      null,
      null,
      undefined,
      "world payload unavailable"
    );
  }
}

function createFailureResult(
  code: GenerationFailureCode,
  reason: string,
  worldId: string | null,
  operationId: string | null,
  worldMarbleUrl: string | undefined,
  assetSummary: string
): AttemptFailureResult {
  return {
    kind: "failed",
    code,
    reason,
    worldId,
    operationId,
    worldMarbleUrl,
    assetSummary
  };
}

function resolveApiKey(explicitApiKey?: string): string {
  const apiKey = explicitApiKey ?? import.meta.env.VITE_WORLDLABS_API_KEY;
  const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";

  if (!trimmed) {
    throw new Error(
      "Missing VITE_WORLDLABS_API_KEY. Add it to your .env file before generating worlds."
    );
  }

  return trimmed;
}

function createWorldLabsHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "WLT-Api-Key": apiKey
  };
}

function unwrapWorldEnvelope(payload: unknown): JsonRecord {
  const record = asRecord(payload);

  if (!record) {
    throw new Error("World Labs returned an unreadable world payload.");
  }

  const nestedWorld = asRecord(record.world);
  return nestedWorld ?? record;
}

function parseOperation(payload: unknown): WorldLabsOperation {
  const record = asRecord(payload);

  if (!record) {
    throw new Error("World Labs returned an unreadable operation payload.");
  }

  const done = record.done;
  const operationId = getOptionalString(record.operation_id);

  if (typeof done !== "boolean" || !operationId) {
    throw new Error("World Labs returned an operation response without the expected fields.");
  }

  return {
    done,
    operation_id: operationId,
    error: asRecord(record.error) ?? undefined,
    metadata: asRecord(record.metadata) ?? undefined,
    response: record.response
  };
}

function getOperationWorldId(operation: WorldLabsOperation): string | null {
  const metadataWorldId = getOptionalString(operation.metadata?.world_id);
  if (metadataWorldId) {
    return metadataWorldId;
  }

  const world = asRecord(operation.response);
  return getOptionalWorldId(world);
}

function getOperationStatusMessage(operation: WorldLabsOperation, location: string): string {
  const progress = asRecord(operation.metadata?.progress);
  const description = getOptionalString(progress?.description);

  if (description) {
    return description;
  }

  const status = getOptionalString(progress?.status);
  if (status) {
    return `World Labs status: ${humanizeToken(status)}.`;
  }

  return `Generating a shooter-ready ${location} world.`;
}

function logOperationSnapshot(
  operation: WorldLabsOperation,
  attempt: number,
  elapsedMs: number
): void {
  const progress = asRecord(operation.metadata?.progress);

  console.info("[WorldLabs] Operation snapshot", {
    attempt,
    operationId: operation.operation_id,
    done: operation.done,
    worldId: getOperationWorldId(operation),
    status: getOptionalString(progress?.status) ?? "unknown",
    description: getOptionalString(progress?.description) ?? null,
    elapsedSeconds: Math.round(elapsedMs / 1_000)
  });
}

function logWorldSnapshot(
  payload: unknown,
  operationId: string,
  attempt: number,
  elapsedMs: number
): void {
  const world = unwrapWorldEnvelope(payload);

  console.info("[WorldLabs] World snapshot", {
    attempt,
    operationId,
    worldId: getOptionalWorldId(world),
    elapsedSeconds: Math.round(elapsedMs / 1_000),
    assetSummary: summarizeWorldAssetState(payload),
    payload
  });
}

async function requestJson(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch
): Promise<unknown> {
  const response = await fetchFn(url, init);
  const text = await response.text();
  const payload = text ? parseJson(text) : null;

  if (!response.ok) {
    throw new Error(buildHttpErrorMessage(response.status, payload));
  }

  return payload;
}

function buildHttpErrorMessage(status: number, payload: unknown): string {
  const apiMessage = getApiMessage(payload);

  switch (status) {
    case 401:
    case 403:
      return "World Labs rejected the API key. Check VITE_WORLDLABS_API_KEY and try again.";
    case 402:
      return apiMessage ?? "World Labs credits are insufficient for this generation request.";
    case 429:
      return apiMessage ?? "World Labs is rate limiting requests right now. Please try again.";
    default:
      return apiMessage ?? `World Labs request failed with status ${status}.`;
  }
}

function getApiMessage(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) {
    return typeof payload === "string" && payload.trim() ? payload.trim() : null;
  }

  const directMessage = getOptionalString(record.message);
  if (directMessage) {
    return directMessage;
  }

  const error = asRecord(record.error);
  const nestedMessage = getOptionalString(error?.message);
  if (nestedMessage) {
    return nestedMessage;
  }

  const detail = getOptionalString(record.detail);
  if (detail) {
    return detail;
  }

  const validationErrors = Array.isArray(record.detail) ? record.detail : null;
  if (validationErrors && validationErrors.length > 0) {
    const messages = validationErrors
      .map((entry) => formatValidationError(entry))
      .filter((entry): entry is string => Boolean(entry));

    if (messages.length > 0) {
      return messages.join(" ");
    }
  }

  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getRequiredString(
  record: JsonRecord | null | undefined,
  key: string,
  message: string
): string {
  const value = getOptionalString(record?.[key]);
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function getOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function getOptionalWorldId(record: JsonRecord | null | undefined): string | null {
  return getOptionalString(record?.world_id) ?? getOptionalString(record?.id);
}

function getRequiredWorldId(record: JsonRecord | null | undefined): string {
  const worldId = getOptionalWorldId(record);
  if (!worldId) {
    throw new Error("World Labs did not return a world id.");
  }

  return worldId;
}

function getWorldMarbleUrl(payload: unknown): string | undefined {
  const record = asRecord(payload);
  const world = record ? unwrapWorldEnvelope(payload) : null;
  return getOptionalString(world?.world_marble_url) ?? undefined;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function humanizeToken(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ");
}

function isRecoverableAssetResolutionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "World Labs did not return a collider mesh for this world." ||
    error.message === "World Labs did not return a usable SPZ splat URL for this world."
  );
}

function summarizeWorldAssetState(payload: unknown): string {
  const world = unwrapWorldEnvelope(payload);
  const assets = asRecord(world.assets);
  const mesh = asRecord(assets?.mesh);
  const splats = asRecord(assets?.splats);
  const spzUrls = asRecord(splats?.spz_urls);
  const colliderRaw = mesh ? mesh.collider_mesh_url : undefined;
  const colliderValue =
    colliderRaw === null
      ? "null"
      : getOptionalString(colliderRaw) ?? (mesh ? "missing" : "missing");

  return [
    `worldId=${getOptionalWorldId(world) ?? "missing"}`,
    `assetKeys=${formatKeyList(assets)}`,
    `meshKeys=${formatKeyList(mesh)}`,
    `collider_mesh_url=${colliderValue}`,
    `splatVariants=${formatKeyList(spzUrls)}`
  ].join("; ");
}

function formatKeyList(record: JsonRecord | null | undefined): string {
  if (!record) {
    return "none";
  }

  const keys = Object.keys(record);
  return keys.length > 0 ? keys.join(",") : "none";
}

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function toDisplayName(location: string): string {
  return location.replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatValidationError(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const message = getOptionalString(record.msg);
  if (!message) {
    return null;
  }

  const path = Array.isArray(record.loc)
    ? record.loc
        .map((segment) =>
          typeof segment === "string" || typeof segment === "number" ? String(segment) : null
        )
        .filter((segment): segment is string => Boolean(segment))
        .join(".")
    : "";

  return path ? `${path}: ${message}` : message;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
