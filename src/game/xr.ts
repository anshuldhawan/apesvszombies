import type { XrSessionState, XrSessionStatus } from "./types";

export interface XrGamepadButtonLike {
  pressed: boolean;
}

export interface XrInputSourceLike {
  handedness: XRHandedness | "none";
  axes: readonly number[];
  buttons: readonly XrGamepadButtonLike[];
}

export interface XrActionState {
  moveX: number;
  moveZ: number;
  turnX: number;
  shootPressed: boolean;
  jumpPressed: boolean;
  hasLeftController: boolean;
  hasRightController: boolean;
}

export interface XrSupportProbe {
  hasNavigatorXr: boolean;
  isSecureContext: boolean;
}

const DEFAULT_AXIS_DEADZONE = 0.18;
const PRIMARY_TRIGGER_BUTTONS = [0, 1];
const PRIMARY_JUMP_BUTTONS = [4, 5, 3, 1];

export function createUncheckedXrSessionState(): XrSessionState {
  return {
    checked: false,
    supported: false,
    canEnter: false,
    isPresenting: false,
    status: "unsupported",
    message: null
  };
}

export function createXrSessionState(
  status: XrSessionStatus,
  message: string | null = null
): XrSessionState {
  return {
    checked: true,
    supported: status !== "unsupported",
    canEnter: status === "available",
    isPresenting: status === "presenting",
    status,
    message
  };
}

export function getInitialXrSessionState(probe: XrSupportProbe): XrSessionState {
  if (!probe.isSecureContext) {
    return createXrSessionState(
      "unsupported",
      "WebXR needs HTTPS or localhost in this browser."
    );
  }

  if (!probe.hasNavigatorXr) {
    return createXrSessionState(
      "unsupported",
      "This browser does not expose WebXR immersive VR."
    );
  }

  return createXrSessionState("available");
}

export function isReferenceSpaceFallbackCandidate(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotSupportedError" || error.name === "NotFoundError")
  );
}

export function applyXrAxisDeadzone(
  value: number,
  deadzone: number = DEFAULT_AXIS_DEADZONE
): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) {
    return 0;
  }

  const normalized = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(value) * normalized;
}

export function deriveXrActionState(
  inputSources: readonly XrInputSourceLike[]
): XrActionState {
  const state: XrActionState = {
    moveX: 0,
    moveZ: 0,
    turnX: 0,
    shootPressed: false,
    jumpPressed: false,
    hasLeftController: false,
    hasRightController: false
  };

  for (const source of inputSources) {
    const { x, y } = pickPrimaryAxes(source.axes);
    const buttonPressed = (indices: readonly number[]): boolean =>
      indices.some((index) => source.buttons[index]?.pressed === true);

    if (source.handedness === "left") {
      state.hasLeftController = true;
      state.moveX = applyXrAxisDeadzone(x);
      state.moveZ = applyXrAxisDeadzone(y);
      state.jumpPressed = buttonPressed(PRIMARY_JUMP_BUTTONS);
    }

    if (source.handedness === "right") {
      state.hasRightController = true;
      state.turnX = applyXrAxisDeadzone(-x);
      state.shootPressed = buttonPressed(PRIMARY_TRIGGER_BUTTONS);
    }
  }

  return state;
}

function pickPrimaryAxes(axes: readonly number[]): { x: number; y: number } {
  if (axes.length < 2) {
    return { x: 0, y: 0 };
  }

  if (axes.length < 4) {
    return { x: axes[0] ?? 0, y: axes[1] ?? 0 };
  }

  const firstMagnitude = Math.hypot(axes[0] ?? 0, axes[1] ?? 0);
  const secondMagnitude = Math.hypot(axes[2] ?? 0, axes[3] ?? 0);

  if (secondMagnitude > firstMagnitude) {
    return { x: axes[2] ?? 0, y: axes[3] ?? 0 };
  }

  return { x: axes[0] ?? 0, y: axes[1] ?? 0 };
}
