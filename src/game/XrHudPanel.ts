import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace
} from "three";

import type { CombatHudState } from "./types";

interface XrHudSnapshot {
  combat: CombatHudState;
  worldLabel: string;
  playerText: string;
  referenceSpaceLabel: string;
}

const PANEL_WIDTH = 0.64;
const PANEL_HEIGHT = 0.3;
const CANVAS_WIDTH = 768;
const CANVAS_HEIGHT = 384;

export class XrHudPanel {
  readonly root = new Group();

  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly geometry = new PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);
  private readonly mesh: Mesh;

  constructor() {
    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("XR HUD canvas 2D context is unavailable.");
    }

    this.context = context;
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      toneMapped: false
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 20;

    this.root.visible = false;
    this.root.position.set(0, -0.25, -0.72);
    this.root.add(this.mesh);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  update(snapshot: XrHudSnapshot): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const background = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    background.addColorStop(0, "rgba(12, 16, 24, 0.86)");
    background.addColorStop(1, "rgba(5, 8, 14, 0.94)");
    ctx.fillStyle = background;
    roundRect(ctx, 16, 16, CANVAS_WIDTH - 32, CANVAS_HEIGHT - 32, 28);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 214, 145, 0.42)";
    ctx.lineWidth = 3;
    roundRect(ctx, 16, 16, CANVAS_WIDTH - 32, CANVAS_HEIGHT - 32, 28);
    ctx.stroke();

    ctx.fillStyle = "#ffd697";
    ctx.font = "700 28px Trebuchet MS";
    ctx.fillText(snapshot.worldLabel, 40, 68);

    ctx.fillStyle = "rgba(247, 239, 227, 0.92)";
    ctx.font = "600 24px Trebuchet MS";
    ctx.fillText(`Health ${snapshot.combat.playerHealth}`, 40, 124);
    ctx.fillText(`Score ${snapshot.combat.score}`, 248, 124);
    ctx.fillText(`Zombies ${snapshot.combat.zombiesRemaining}`, 430, 124);

    ctx.fillStyle = "rgba(247, 239, 227, 0.76)";
    ctx.font = "500 20px Trebuchet MS";
    const playerText = snapshot.playerText ? `Callsign ${snapshot.playerText}` : "Callsign none";
    ctx.fillText(playerText, 40, 176);
    ctx.fillText(`Reference ${snapshot.referenceSpaceLabel}`, 40, 212);
    ctx.fillText("Left stick move  Right stick turn  Right trigger shoot  Left face button jump", 40, 270);
    ctx.fillText("Death or leaving the level exits VR automatically.", 40, 304);

    this.texture.needsUpdate = true;
  }
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
