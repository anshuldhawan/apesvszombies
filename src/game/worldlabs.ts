import type { WorldDefinition } from "./types";

const WORLD_LABS_API_BASE_URL = "https://api.worldlabs.ai/marble/v1";
const WORLD_LABS_GENERATE_MODEL = "Marble 0.1-mini";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const SPZ_URL_PREFERENCE = ["500k", "full_res", "100k"] as const;

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

export interface GenerationProgressUpdate {
  phase: "requesting" | "polling";
  message: string;
  operationId: string | null;
  worldId: string | null;
}

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
): Promise<WorldDefinition> {
  const location = normalizeLocationInput(inputLocation);
  const promptText = buildShooterWorldPrompt(location);
  const displayName = toDisplayName(location);
  const apiKey = resolveApiKey(options.apiKey);
  const fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const startedAt = now();

  options.onProgress?.({
    phase: "requesting",
    message: "Sending your prompt to World Labs.",
    operationId: null,
    worldId: null
  });

  let operation = parseOperation(
    await requestJson(
      `${WORLD_LABS_API_BASE_URL}/worlds:generate`,
      {
        method: "POST",
        headers: createWorldLabsHeaders(apiKey),
        body: JSON.stringify({
          display_name: displayName,
          model: WORLD_LABS_GENERATE_MODEL,
          world_prompt: {
            type: "text",
            text_prompt: promptText,
            disable_recaption: true
          }
        })
      },
      fetchFn
    )
  );

  while (!operation.done) {
    assertOperationError(operation);
    assertWithinTimeout(startedAt, timeoutMs, now);

    const worldId = getOperationWorldId(operation);
    options.onProgress?.({
      phase: "polling",
      message: getOperationStatusMessage(operation, location),
      operationId: operation.operation_id,
      worldId
    });

    await sleep(pollIntervalMs);

    operation = parseOperation(
      await requestJson(
        `${WORLD_LABS_API_BASE_URL}/operations/${operation.operation_id}`,
        {
          method: "GET",
          headers: createWorldLabsHeaders(apiKey)
        },
        fetchFn
      )
    );
  }

  assertOperationError(operation);

  const worldId = getOperationWorldId(operation);

  try {
    return buildGeneratedWorldDefinition(location, operation.response);
  } catch (error) {
    if (!worldId || !isRecoverableAssetResolutionError(error)) {
      throw error;
    }
  }

  return await waitForWorldAssets({
    location,
    worldId,
    apiKey,
    fetchFn,
    pollIntervalMs,
    timeoutMs,
    startedAt,
    now,
    sleep,
    onProgress: options.onProgress
  });
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

function assertOperationError(operation: WorldLabsOperation): void {
  if (!operation.error) {
    return;
  }

  const message = getOptionalString(operation.error.message);
  if (message) {
    throw new Error(message);
  }

  throw new Error("World Labs reported an unknown generation error.");
}

function assertWithinTimeout(startedAt: number, timeoutMs: number, now: () => number): void {
  if (now() - startedAt >= timeoutMs) {
    throw new Error("World Labs generation timed out after 10 minutes. Please try again.");
  }
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

async function waitForWorldAssets(options: {
  location: string;
  worldId: string;
  apiKey: string;
  fetchFn: typeof fetch;
  pollIntervalMs: number;
  timeoutMs: number;
  startedAt: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onProgress?: (progress: GenerationProgressUpdate) => void;
}): Promise<WorldDefinition> {
  for (;;) {
    const latestWorld = await requestJson(
      `${WORLD_LABS_API_BASE_URL}/worlds/${options.worldId}`,
      {
        method: "GET",
        headers: createWorldLabsHeaders(options.apiKey)
      },
      options.fetchFn
    );

    try {
      return buildGeneratedWorldDefinition(options.location, latestWorld);
    } catch (error) {
      if (!isRecoverableAssetResolutionError(error)) {
        throw error;
      }

      assertWithinTimeout(options.startedAt, options.timeoutMs, options.now);
      options.onProgress?.({
        phase: "polling",
        message: "World generated. Waiting for the collider mesh export to become available.",
        operationId: null,
        worldId: options.worldId
      });
      await options.sleep(options.pollIntervalMs);
    }
  }
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
