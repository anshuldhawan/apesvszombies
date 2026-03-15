export type GameKey =
  | "KeyW"
  | "KeyA"
  | "KeyS"
  | "KeyD"
  | "Space"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowDown"
  | "ArrowUp"
  | "Shoot";

export const MAX_LOOK_PITCH = (60 * Math.PI) / 180;

export function toGameKey(code: string): GameKey | null {
  switch (code) {
    case "KeyW":
    case "KeyA":
    case "KeyS":
    case "KeyD":
    case "Space":
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowDown":
    case "ArrowUp":
      return code;
    case "AltLeft":
    case "AltRight":
      return "Shoot";
    default:
      return null;
  }
}

export function clampLookPitch(pitch: number): number {
  return Math.min(MAX_LOOK_PITCH, Math.max(-MAX_LOOK_PITCH, pitch));
}

export function stepLookPitch(
  pitch: number,
  direction: number,
  deltaSeconds: number,
  speed: number
): number {
  return clampLookPitch(pitch + direction * speed * deltaSeconds);
}
