import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import {
  AmbientLight,
  BufferGeometry,
  Camera,
  Clock,
  Color,
  DirectionalLight,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  BULLET_DAMAGE,
  createInitialCombatHudState,
  tickZombieAttack,
  ZOMBIE_ATTACK_INTERVAL,
  ZOMBIE_COUNT
} from "./combat";
import { CharacterAnimator, getHeroLayer } from "./CharacterAnimator";
import { CollisionWorld } from "./CollisionWorld";
import { type GameKey, stepLookPitch, toGameKey } from "./controls";
import type {
  CombatHudState,
  SessionState,
  WorldDefinition,
  XrSessionState
} from "./types";
import { XrHudPanel } from "./XrHudPanel";
import {
  createUncheckedXrSessionState,
  createXrSessionState,
  deriveXrActionState,
  getInitialXrSessionState,
  isReferenceSpaceFallbackCandidate
} from "./xr";
import { zombieModelUrl, heroModelUrl } from "./worlds";
import { ZombieActor, type ZombieTemplate, ZOMBIE_TARGET_HEIGHT } from "./ZombieActor";

const STAND_HEIGHT = 1.72;
const STAND_EYE_HEIGHT = 1.56;
const PLAYER_RADIUS = 0.34;
const RUN_SPEED = 4.8;
const GRAVITY = 22;
const JUMP_VELOCITY = 8.6;
const SHOT_INTERVAL = 0.18;
const IMPACT_LIFETIME_MS = 180;
const BLOOD_SPLASH_LIFETIME_MS = 320;
const CAMERA_SMOOTHING = 14;
const TURN_SPEED = 1.2;
const XR_TURN_SPEED = 2.9;
const LOOK_SPEED = 0.6;
const THIRD_PERSON_DISTANCE = 2.45;
const THIRD_PERSON_HEIGHT_OFFSET = 0.38;
const THIRD_PERSON_SHOULDER_OFFSET = 0.44;
const THIRD_PERSON_LOOK_AHEAD = 4;
const THIRD_PERSON_COLLISION_PADDING = 0.18;
const UP_AXIS = new Vector3(0, 1, 0);
const ZOMBIE_SPEED = 1.9;
const ZOMBIE_RADIUS = 0.26;
const ZOMBIE_ATTACK_RANGE = 1.5;
const ZOMBIE_STOP_DISTANCE = 1.05;
const ZOMBIE_MIN_SPAWN_DISTANCE = 6;
const ZOMBIE_MIN_SPACING = 1.5;
const ZOMBIE_SPAWN_ATTEMPTS = 240;
const ZOMBIE_SEPARATION_DISTANCE = 0.9;
const ZOMBIE_SEPARATION_DISTANCE_SQ = ZOMBIE_SEPARATION_DISTANCE * ZOMBIE_SEPARATION_DISTANCE;
const SHOT_MAX_DISTANCE = 180;
const ZOMBIE_GROUND_RAY_HEIGHT = 8;
const ZOMBIE_FACING_IDLE = new Vector3(0, 0, -1);
const BLOOD_PARTICLE_COUNT = 7;
const BLOOD_GRAVITY = 7;
const XR_AIM_DISTANCE = 10;
const XR_RETICLE_RADIUS = 0.03;
const MODEL_LOAD_TIMEOUT_MS = 30_000;
const GENERATED_COLLISION_LOAD_TIMEOUT_MS = 90_000;
const PRESET_COLLISION_LOAD_TIMEOUT_MS = 60_000;
const GENERATED_SPLAT_LOAD_TIMEOUT_MS = 90_000;
const PRESET_SPLAT_LOAD_TIMEOUT_MS = 60_000;

interface EffectMarker {
  mesh: Mesh;
  expiresAt: number;
  velocity: Vector3 | null;
}

interface ZombieRaycastHit {
  zombie: ZombieActor;
  distance: number;
  point: Vector3;
}

interface ShotTraceResult {
  type: "world" | "zombie";
  distance: number;
  point: Vector3;
  zombie?: ZombieActor;
}

interface GameCallbacks {
  onLoadStatusChange: (message: string) => void;
  onReady: () => void;
  onShotFeedback: () => void;
  onPlayerHit: () => void;
  onDebugCameraUpdate: (info: DebugCameraInfo) => void;
  onCombatUpdate: (state: CombatHudState) => void;
  onXrStateChange: (state: XrSessionState) => void;
}

interface FpsGameOptions {
  container: HTMLElement;
  world: WorldDefinition;
  session: SessionState;
  callbacks: GameCallbacks;
}

interface PlayerState {
  position: Vector3;
  velocity: Vector3;
  height: number;
  eyeHeight: number;
  onGround: boolean;
  jumpQueued: boolean;
}

interface NormalizedInputState {
  moveX: number;
  moveZ: number;
  turnX: number;
  lookDirection: number;
  jumpPressed: boolean;
  shootPressed: boolean;
}

interface XrControllerSlot {
  index: number;
  controller: Object3D;
  handedness: XRHandedness | "none";
  inputSource: XRInputSource | null;
}

export interface DebugCameraInfo {
  enabled: boolean;
  mode: "firstPerson" | "thirdPerson" | "debug";
  position: {
    x: number;
    y: number;
    z: number;
  };
}

export class FpsGame {
  private readonly container: HTMLElement;
  private readonly world: WorldDefinition;
  private readonly session: SessionState;
  private readonly callbacks: GameCallbacks;
  private readonly scene = new Scene();
  private readonly clock = new Clock();
  private readonly camera = new PerspectiveCamera(75, 1, 0.01, 300);
  private readonly thirdPersonCamera = new PerspectiveCamera(78, 1, 0.1, 300);
  private readonly debugCamera = new PerspectiveCamera(60, 1, 0.1, 600);
  private readonly renderer = new WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: "high-performance"
  });
  private readonly spark = new SparkRenderer({
    renderer: this.renderer,
    clock: this.clock,
    originDistance: 0.75
  });
  private readonly orbitControls = new OrbitControls(this.debugCamera, this.renderer.domElement);
  private readonly playerRoot = new Object3D();
  private readonly pressedKeys = new Set<GameKey>();
  private readonly movementVector = new Vector3();
  private readonly forwardVector = new Vector3();
  private readonly rightVector = new Vector3();
  private readonly shotDirection = new Vector3();
  private readonly shotOrigin = new Vector3();
  private readonly zombieDirection = new Vector3();
  private readonly zombieRaycaster = new Raycaster();
  private readonly thirdPersonAnchor = new Vector3();
  private readonly thirdPersonDesired = new Vector3();
  private readonly thirdPersonLookTarget = new Vector3();
  private readonly thirdPersonRayDirection = new Vector3();
  private readonly thirdPersonForward = new Vector3();
  private readonly thirdPersonRight = new Vector3();
  private readonly xrLocalHeadOffset = new Vector3();
  private readonly xrCameraWorldPosition = new Vector3();
  private readonly xrHeadDirection = new Vector3();
  private readonly xrControllerQuaternion = new Quaternion();
  private readonly impactGeometry = new SphereGeometry(0.07, 12, 12);
  private readonly impactMaterial = new MeshBasicMaterial({
    color: new Color("#ffba63")
  });
  private readonly bloodGeometry = new SphereGeometry(0.045, 8, 8);
  private readonly bloodMaterials = [
    new MeshBasicMaterial({ color: new Color("#c91f37") }),
    new MeshBasicMaterial({ color: new Color("#8a1022") })
  ];
  private readonly bloodVelocity = new Vector3();
  private readonly bloodOffset = new Vector3();
  private readonly xrHud = new XrHudPanel();
  private readonly xrAimGeometry = new BufferGeometry().setFromPoints([
    new Vector3(0, 0, 0),
    new Vector3(0, 0, -1)
  ]);
  private readonly xrAimMaterial = new LineBasicMaterial({
    color: new Color("#ffae58"),
    transparent: true,
    opacity: 0.92
  });
  private readonly xrAimRay = new Line(this.xrAimGeometry, this.xrAimMaterial);
  private readonly xrReticleGeometry = new SphereGeometry(XR_RETICLE_RADIUS, 10, 10);
  private readonly xrReticleMaterial = new MeshBasicMaterial({
    color: new Color("#ffdd8a")
  });
  private readonly xrReticle = new Mesh(this.xrReticleGeometry, this.xrReticleMaterial);
  private readonly xrControllers: XrControllerSlot[] = [];
  private readonly player: PlayerState = {
    position: new Vector3(),
    velocity: new Vector3(),
    height: STAND_HEIGHT,
    eyeHeight: STAND_EYE_HEIGHT,
    onGround: false,
    jumpQueued: false
  };

  private collisionWorld: CollisionWorld | null = null;
  private character: CharacterAnimator | null = null;
  private splatWorld: SplatMesh | null = null;
  private zombies: ZombieActor[] = [];
  private effects: EffectMarker[] = [];
  private shotCooldown = 0;
  private combatState: CombatHudState = createInitialCombatHudState(0);
  private xrState: XrSessionState = createUncheckedXrSessionState();
  private xrReferenceSpaceType: "local-floor" | "local" = "local-floor";
  private debugEnabled = false;
  private thirdPersonEnabled = false;
  private destroyed = false;
  private xrSessionEnding = false;
  private previousJumpPressed = false;
  private cameraBaseX = 0;
  private cameraBaseZ = 0;
  private lookPitch = 0;

  constructor(options: FpsGameOptions) {
    this.container = options.container;
    this.world = options.world;
    this.session = options.session;
    this.callbacks = options.callbacks;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = "srgb";
    this.renderer.setClearColor(new Color("#05070b"));
    this.renderer.xr.enabled = true;

    this.scene.background = new Color("#05070b");
    this.scene.add(this.playerRoot);
    this.playerRoot.add(this.camera);
    this.scene.add(this.thirdPersonCamera);
    this.scene.add(this.debugCamera);
    this.scene.add(this.xrReticle);
    this.camera.layers.enable(getHeroLayer());
    this.camera.add(this.spark);
    this.camera.add(this.xrHud.root);
    this.camera.position.set(this.cameraBaseX, this.player.eyeHeight, this.cameraBaseZ);
    this.camera.rotation.set(0, 0, 0);
    this.thirdPersonCamera.position.set(0, this.player.eyeHeight + 0.8, 2.6);
    this.thirdPersonCamera.lookAt(0, this.player.eyeHeight, 0);
    this.debugCamera.position.set(12, 12, 12);
    this.debugCamera.lookAt(0, 0, 0);
    this.orbitControls.enabled = false;
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.screenSpacePanning = true;

    this.xrAimRay.visible = false;
    this.xrReticle.visible = false;
    this.xrReticle.renderOrder = 12;

    for (let index = 0; index < 2; index += 1) {
      const controller = this.renderer.xr.getController(index);
      controller.addEventListener("connected", (event) => {
        const inputSource = (event as unknown as { data: XRInputSource }).data;
        this.handleXrControllerConnected(index, inputSource);
      });
      controller.addEventListener("disconnected", () => {
        this.handleXrControllerDisconnected(index);
      });
      this.scene.add(controller);
      this.xrControllers.push({
        index,
        controller,
        handedness: "none",
        inputSource: null
      });
    }

    this.scene.add(new AmbientLight("#9ebcff", 0.35));
    const keyLight = new DirectionalLight("#ffd39d", 1.1);
    keyLight.position.set(6, 12, 4);
    this.scene.add(keyLight);
  }

  private updateLoadStatus(message: string): void {
    console.info("[FpsGame] Load status", {
      worldId: this.world.id,
      worldLabel: this.world.label,
      source: this.world.source,
      message
    });
    this.callbacks.onLoadStatusChange(message);
  }

  private async awaitLoadStage<T>(
    stage: string,
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    const startedAt = performance.now();

    console.info("[FpsGame] Starting load stage", {
      stage,
      worldId: this.world.id,
      worldLabel: this.world.label,
      source: this.world.source,
      timeoutMs
    });

    try {
      const result = await withTimeout(promise, timeoutMs, timeoutMessage);

      console.info("[FpsGame] Completed load stage", {
        stage,
        worldId: this.world.id,
        elapsedMs: Math.round(performance.now() - startedAt)
      });

      return result;
    } catch (error) {
      console.error("[FpsGame] Load stage failed", {
        stage,
        worldId: this.world.id,
        elapsedMs: Math.round(performance.now() - startedAt),
        error
      });
      throw error;
    }
  }

  private getCoreAssetLoadStatus(): string {
    return this.world.source === "generated"
      ? "Loading the generated collision mesh, first-person rig, and zombie template."
      : "Loading the selected collision mesh, first-person rig, and zombie template.";
  }

  private getCoreAssetTimeoutMessage(stage: "collision" | "hero" | "zombie"): string {
    if (stage === "collision") {
      return this.world.source === "generated"
        ? "Timed out while building the generated collision mesh. Try Generate & Play again to get a lighter collider."
        : "Timed out while building the selected collision mesh.";
    }

    if (stage === "hero") {
      return "Timed out while loading the first-person rig.";
    }

    return "Timed out while loading the zombie template.";
  }

  private getSplatLoadStatus(): string {
    return this.world.source === "generated"
      ? "Decoding the generated splat scene for real-time shooter gameplay."
      : "Decoding the selected splat scene for real-time shooter gameplay.";
  }

  private getSplatLoadTimeoutMs(): number {
    return this.world.source === "generated"
      ? GENERATED_SPLAT_LOAD_TIMEOUT_MS
      : PRESET_SPLAT_LOAD_TIMEOUT_MS;
  }

  private getSplatLoadTimeoutMessage(): string {
    return this.world.source === "generated"
      ? "Timed out while decoding the generated World Labs splat scene. Try Generate & Play again for a different map."
      : "Timed out while decoding the selected SPZ splat world.";
  }

  async load(): Promise<void> {
    this.container.innerHTML = "";
    this.container.append(this.renderer.domElement);
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    void this.refreshXrAvailability();

    this.updateLoadStatus(this.getCoreAssetLoadStatus());
    const [collisionWorld, character, zombieTemplate] = await Promise.all([
      this.awaitLoadStage(
        "collision-world",
        CollisionWorld.load(this.world.collisionGlbUrl),
        this.world.source === "generated"
          ? GENERATED_COLLISION_LOAD_TIMEOUT_MS
          : PRESET_COLLISION_LOAD_TIMEOUT_MS,
        this.getCoreAssetTimeoutMessage("collision")
      ),
      this.awaitLoadStage(
        "hero-rig",
        CharacterAnimator.load({ modelUrl: heroModelUrl }),
        MODEL_LOAD_TIMEOUT_MS,
        this.getCoreAssetTimeoutMessage("hero")
      ),
      this.awaitLoadStage(
        "zombie-template",
        ZombieActor.loadTemplate(zombieModelUrl),
        MODEL_LOAD_TIMEOUT_MS,
        this.getCoreAssetTimeoutMessage("zombie")
      )
    ]);

    if (this.destroyed) {
      collisionWorld.destroy();
      return;
    }

    this.collisionWorld = collisionWorld;
    this.character = character;
    this.cameraBaseX = 0;
    this.cameraBaseZ = 0;
    this.camera.add(character.root);

    this.updateLoadStatus(this.getSplatLoadStatus());
    this.splatWorld = new SplatMesh({ url: this.world.spzUrl });
    this.splatWorld.position.copy(collisionWorld.rootPosition);
    this.splatWorld.quaternion.copy(collisionWorld.rootQuaternion);
    this.splatWorld.scale.copy(collisionWorld.rootScale);
    this.scene.add(this.splatWorld);
    this.scene.add(collisionWorld.mesh);

    await this.awaitLoadStage(
      "splat-world",
      this.splatWorld.initialized,
      this.getSplatLoadTimeoutMs(),
      this.getSplatLoadTimeoutMessage()
    );

    this.updateLoadStatus("Picking a spawn point and placing the zombie wave.");
    const spawnPoint = collisionWorld.getSpawnPoint(STAND_HEIGHT, this.world.spawnOffset);
    this.player.position.copy(spawnPoint);
    this.playerRoot.position.copy(spawnPoint);
    this.playerRoot.rotation.y = this.world.initialYaw ?? 0;
    this.player.onGround = true;
    this.restoreFlatCameraMode();
    this.updateThirdPersonCamera(1);

    this.spawnZombies(zombieTemplate);
    this.resetDebugCamera();
    this.emitCombatUpdate();
    this.updateXrHudPanel();
    this.updateXrPresentationVisuals();

    this.clock.start();
    this.renderer.setAnimationLoop(this.animate);
    this.pushDebugCameraUpdate();
    this.callbacks.onReady();
  }

  destroy(): void {
    this.destroyed = true;
    void this.endXrSession();
    this.renderer.setAnimationLoop(null);
    this.container.innerHTML = "";
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.collisionWorld?.destroy();
    this.splatWorld?.dispose();
    this.splatWorld?.removeFromParent();
    this.impactGeometry.dispose();
    this.impactMaterial.dispose();
    this.bloodGeometry.dispose();
    this.xrHud.dispose();
    this.xrAimGeometry.dispose();
    this.xrAimMaterial.dispose();
    this.xrReticleGeometry.dispose();
    this.xrReticleMaterial.dispose();
    for (const material of this.bloodMaterials) {
      material.dispose();
    }
    this.orbitControls.dispose();
    this.renderer.dispose();
    this.pressedKeys.clear();
    this.effects = [];
    for (const zombie of this.zombies) {
      zombie.destroy();
    }
    this.zombies = [];
    this.splatWorld = null;
    this.collisionWorld = null;
    this.character = null;
  }

  async enterVr(): Promise<void> {
    if (this.destroyed || !this.collisionWorld || this.combatState.gameOver) {
      return;
    }

    if (!this.xrState.checked) {
      await this.refreshXrAvailability();
    }

    if (!this.xrState.supported || this.xrState.status === "entering" || this.isXrPresenting()) {
      return;
    }

    this.thirdPersonEnabled = false;
    this.debugEnabled = false;
    this.orbitControls.enabled = false;
    this.pressedKeys.clear();
    this.previousJumpPressed = false;
    this.player.jumpQueued = false;
    this.shotCooldown = 0;
    this.attachSparkToActiveCamera();
    this.pushDebugCameraUpdate();
    this.setXrState(createXrSessionState("entering"));

    try {
      try {
        await this.beginXrSession("local-floor");
      } catch (error) {
        if (!isReferenceSpaceFallbackCandidate(error)) {
          throw error;
        }

        await this.beginXrSession("local");
      }

      this.applyVrCameraMode();
      this.updateXrHudPanel();
      this.updateXrPresentationVisuals();
      this.attachSparkToActiveCamera();
      this.pushDebugCameraUpdate();
      this.setXrState(createXrSessionState("presenting"));
    } catch (error) {
      console.error(error);
      this.restoreFlatCameraMode();
      this.updateXrPresentationVisuals();
      this.setXrState(
        createXrSessionState(
          "error",
          "Unable to start immersive VR. Check browser permissions and headset availability."
        )
      );
    }
  }

  async exitVr(): Promise<void> {
    if (!this.isXrPresenting()) {
      return;
    }

    await this.endXrSession();
  }

  getXrState(): XrSessionState {
    return this.xrState;
  }

  toggleDebugMode(): boolean {
    if (
      this.destroyed ||
      !this.collisionWorld ||
      this.combatState.gameOver ||
      this.isXrPresenting()
    ) {
      return this.debugEnabled;
    }

    this.debugEnabled = !this.debugEnabled;
    this.orbitControls.enabled = this.debugEnabled;
    this.pressedKeys.clear();
    this.player.jumpQueued = false;
    this.shotCooldown = 0;

    if (this.debugEnabled) {
      this.resetDebugCamera();
    }

    this.attachSparkToActiveCamera();
    this.pushDebugCameraUpdate();
    return this.debugEnabled;
  }

  toggleThirdPersonMode(): boolean {
    if (
      this.destroyed ||
      !this.collisionWorld ||
      this.combatState.gameOver ||
      this.isXrPresenting()
    ) {
      return this.thirdPersonEnabled;
    }

    this.thirdPersonEnabled = !this.thirdPersonEnabled;

    if (this.debugEnabled) {
      this.debugEnabled = false;
      this.orbitControls.enabled = false;
    }

    this.updateThirdPersonCamera(1);
    this.attachSparkToActiveCamera();
    this.pushDebugCameraUpdate();
    return this.thirdPersonEnabled;
  }

  getDebugCameraInfo(): DebugCameraInfo {
    const activeCamera = this.getRenderCamera();
    const position = activeCamera.getWorldPosition(new Vector3());

    return {
      enabled: this.debugEnabled,
      mode: this.debugEnabled
        ? "debug"
        : this.thirdPersonEnabled && !this.isXrPresenting()
          ? "thirdPerson"
          : "firstPerson",
      position: {
        x: position.x,
        y: position.y,
        z: position.z
      }
    };
  }

  private readonly handleResize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.thirdPersonCamera.aspect = width / height;
    this.thirdPersonCamera.updateProjectionMatrix();
    this.debugCamera.aspect = width / height;
    this.debugCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const code = toGameKey(event.code);
    if (!code) {
      return;
    }

    this.pressedKeys.add(code);
    event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const code = toGameKey(event.code);
    if (!code) {
      return;
    }

    this.pressedKeys.delete(code);
    event.preventDefault();
  };

  private readonly animate = (): void => {
    if (this.destroyed) {
      return;
    }

    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.update(delta);
    this.renderer.render(this.scene, this.getRenderCamera());
  };

  private update(deltaSeconds: number): void {
    this.updateEffects(deltaSeconds);

    if (!this.collisionWorld || !this.character) {
      return;
    }

    this.updateXrPresentationVisuals();

    if (this.debugEnabled || this.combatState.gameOver) {
      if (this.debugEnabled) {
        this.orbitControls.update();
      }

      if (this.combatState.gameOver && this.isXrPresenting()) {
        void this.exitVr();
      }

      this.updateXrAimAssist();
      this.pushDebugCameraUpdate();
      return;
    }

    const input = this.collectInputState();
    const isPresenting = this.isXrPresenting();
    const movementYaw = isPresenting ? this.getXrMovementYaw() : this.playerRoot.rotation.y;
    const xrLocalHeadOffset = isPresenting ? this.getXrLocalHeadOffset(this.xrLocalHeadOffset) : null;

    if (isPresenting && xrLocalHeadOffset) {
      this.player.position.x = this.playerRoot.position.x + xrLocalHeadOffset.x;
      this.player.position.z = this.playerRoot.position.z + xrLocalHeadOffset.z;
      this.player.height = Math.max(STAND_HEIGHT, xrLocalHeadOffset.y + 0.18);
      this.player.eyeHeight = Math.max(1.05, xrLocalHeadOffset.y);
    } else {
      this.player.height = STAND_HEIGHT;
      this.player.eyeHeight = STAND_EYE_HEIGHT;
    }

    if (input.turnX !== 0) {
      const turnSpeed = isPresenting ? XR_TURN_SPEED : TURN_SPEED;
      this.playerRoot.rotation.y += input.turnX * turnSpeed * deltaSeconds;
    }

    if (!this.thirdPersonEnabled && !isPresenting) {
      this.lookPitch = stepLookPitch(
        this.lookPitch,
        input.lookDirection,
        deltaSeconds,
        LOOK_SPEED
      );
      this.camera.rotation.set(this.lookPitch, 0, 0);
    }

    this.movementVector.set(input.moveX, 0, input.moveZ);
    if (this.movementVector.lengthSq() > 1) {
      this.movementVector.normalize();
    }

    this.forwardVector.set(Math.sin(movementYaw), 0, -Math.cos(movementYaw));
    this.rightVector.set(Math.cos(movementYaw), 0, Math.sin(movementYaw));

    const horizontalVelocity = new Vector3()
      .addScaledVector(this.forwardVector, -this.movementVector.z)
      .addScaledVector(this.rightVector, this.movementVector.x);

    if (horizontalVelocity.lengthSq() > 0) {
      horizontalVelocity.normalize().multiplyScalar(RUN_SPEED);
    }

    this.player.velocity.x = horizontalVelocity.x;
    this.player.velocity.z = horizontalVelocity.z;

    if (input.jumpPressed && !this.previousJumpPressed) {
      this.player.jumpQueued = true;
    }
    this.previousJumpPressed = input.jumpPressed;

    if (this.player.onGround && this.player.jumpQueued) {
      this.player.velocity.y = JUMP_VELOCITY;
      this.player.onGround = false;
    }
    this.player.jumpQueued = false;

    this.player.velocity.y -= GRAVITY * deltaSeconds;
    const verticalDisplacement = this.player.velocity.y * deltaSeconds;

    const proposedPosition = this.player.position
      .clone()
      .addScaledVector(horizontalVelocity, deltaSeconds)
      .addScaledVector(UP_AXIS, verticalDisplacement);

    const collision = this.collisionWorld.resolveCapsule(
      proposedPosition,
      this.player.height,
      PLAYER_RADIUS,
      verticalDisplacement
    );

    this.player.position.copy(collision.position);
    this.player.onGround = collision.grounded;

    if (xrLocalHeadOffset) {
      this.playerRoot.position.set(
        this.player.position.x - xrLocalHeadOffset.x,
        this.player.position.y,
        this.player.position.z - xrLocalHeadOffset.z
      );
    } else {
      this.playerRoot.position.copy(this.player.position);
    }

    if (this.player.onGround && this.player.velocity.y < 0) {
      this.player.velocity.y = 0;
    }

    this.shotCooldown -= deltaSeconds;

    if (input.shootPressed && this.shotCooldown <= 0) {
      this.fireShot();
      this.shotCooldown = SHOT_INTERVAL;
    }

    this.updateZombies(deltaSeconds);
    this.updatePlayerCameraFromHead(deltaSeconds);
    this.updateThirdPersonCamera(deltaSeconds);
    this.updateXrAimAssist();
    this.pushDebugCameraUpdate();
  }

  private collectInputState(): NormalizedInputState {
    const state: NormalizedInputState = {
      moveX:
        (this.pressedKeys.has("KeyD") ? 1 : 0) -
        (this.pressedKeys.has("KeyA") ? 1 : 0),
      moveZ:
        (this.pressedKeys.has("KeyS") ? 1 : 0) -
        (this.pressedKeys.has("KeyW") ? 1 : 0),
      turnX:
        (this.pressedKeys.has("ArrowLeft") ? 1 : 0) -
        (this.pressedKeys.has("ArrowRight") ? 1 : 0),
      lookDirection:
        (this.pressedKeys.has("ArrowUp") ? 1 : 0) -
        (this.pressedKeys.has("ArrowDown") ? 1 : 0),
      jumpPressed: this.pressedKeys.has("Space"),
      shootPressed: this.pressedKeys.has("Shoot")
    };

    if (!this.isXrPresenting()) {
      return state;
    }

    const xrState = deriveXrActionState(
      this.xrControllers.flatMap((slot) => {
        const gamepad = slot.inputSource?.gamepad;
        if (!gamepad) {
          return [];
        }

        return [
          {
            handedness: slot.handedness,
            axes: Array.from(gamepad.axes),
            buttons: Array.from(gamepad.buttons, (button) => ({
              pressed: button.pressed
            }))
          }
        ];
      })
    );

    return {
      moveX: xrState.hasLeftController ? xrState.moveX : state.moveX,
      moveZ: xrState.hasLeftController ? xrState.moveZ : state.moveZ,
      turnX: xrState.hasRightController ? xrState.turnX : state.turnX,
      lookDirection: 0,
      jumpPressed: xrState.hasLeftController ? xrState.jumpPressed : state.jumpPressed,
      shootPressed: xrState.hasRightController ? xrState.shootPressed : state.shootPressed
    };
  }

  private spawnZombies(template: ZombieTemplate): void {
    if (!this.collisionWorld) {
      return;
    }

    for (const zombie of this.zombies) {
      zombie.destroy();
    }

    const spawnPoints = this.collisionWorld.getRandomSpawnPoints(
      ZOMBIE_COUNT,
      this.player.position,
      {
        minDistanceFromPlayer: ZOMBIE_MIN_SPAWN_DISTANCE,
        minDistanceBetweenPoints: ZOMBIE_MIN_SPACING,
        sampleAttempts: ZOMBIE_SPAWN_ATTEMPTS
      }
    );

    this.zombies = spawnPoints.map((point, index) => {
      const zombie = ZombieActor.create(template, index, point);
      this.scene.add(zombie.root);
      return zombie;
    });

    this.combatState = createInitialCombatHudState(this.zombies.length);
  }

  private updateZombies(deltaSeconds: number): void {
    if (!this.collisionWorld) {
      return;
    }

    let combatChanged = false;
    const aliveZombies = this.zombies.filter((zombie) => zombie.state.alive);

    for (const zombie of aliveZombies) {
      this.zombieDirection.subVectors(this.player.position, zombie.state.position);
      this.zombieDirection.y = 0;
      const distanceToPlayer = this.zombieDirection.length();
      const inAttackRange = distanceToPlayer <= ZOMBIE_ATTACK_RANGE;
      const attack = tickZombieAttack({
        playerHealth: this.combatState.playerHealth,
        attackCooldown: zombie.state.attackCooldown,
        inRange: inAttackRange,
        deltaSeconds,
        attackInterval: ZOMBIE_ATTACK_INTERVAL
      });

      zombie.state.attackCooldown = attack.attackCooldown;

      if (inAttackRange) {
        zombie.setMode("attacking");
        zombie.state.velocity.set(0, 0, 0);
        zombie.setFacing(
          distanceToPlayer > 0.0001 ? this.zombieDirection.normalize() : ZOMBIE_FACING_IDLE
        );
      } else {
        zombie.setMode("chasing");

        if (distanceToPlayer > ZOMBIE_STOP_DISTANCE) {
          this.zombieDirection.normalize();
          zombie.state.velocity.copy(this.zombieDirection).multiplyScalar(ZOMBIE_SPEED);

          const proposed = zombie.state.position
            .clone()
            .addScaledVector(zombie.state.velocity, deltaSeconds);
          const resolved = this.collisionWorld.resolveCapsule(
            proposed,
            ZOMBIE_TARGET_HEIGHT,
            ZOMBIE_RADIUS,
            0
          );

          zombie.state.position.copy(resolved.position);
          zombie.setFacing(this.zombieDirection);
        } else {
          zombie.state.velocity.set(0, 0, 0);
        }
      }

      if (attack.attacked) {
        this.combatState.playerHealth = attack.playerHealth;
        this.combatState.gameOver = attack.gameOver;
        this.callbacks.onPlayerHit();
        combatChanged = true;
      }
    }

    this.applyZombieSeparation(aliveZombies);

    for (const zombie of aliveZombies) {
      this.snapZombieToGround(zombie);
      zombie.update(deltaSeconds);
    }

    if (combatChanged) {
      this.emitCombatUpdate();

      if (this.combatState.gameOver && this.isXrPresenting()) {
        void this.exitVr();
      }
    }
  }

  private applyZombieSeparation(zombies: ZombieActor[]): void {
    for (let index = 0; index < zombies.length; index += 1) {
      const left = zombies[index];

      for (let otherIndex = index + 1; otherIndex < zombies.length; otherIndex += 1) {
        const right = zombies[otherIndex];
        const dx = left.state.position.x - right.state.position.x;
        const dz = left.state.position.z - right.state.position.z;
        let distanceSq = dx * dx + dz * dz;

        if (distanceSq >= ZOMBIE_SEPARATION_DISTANCE_SQ) {
          continue;
        }

        let pushX = dx;
        let pushZ = dz;

        if (distanceSq < 0.0001) {
          const angle = (index + otherIndex + 1) * 1.7;
          pushX = Math.cos(angle);
          pushZ = Math.sin(angle);
          distanceSq = pushX * pushX + pushZ * pushZ;
        }

        const distance = Math.sqrt(distanceSq);
        const overlap = (ZOMBIE_SEPARATION_DISTANCE - distance) * 0.5;
        const nx = pushX / distance;
        const nz = pushZ / distance;

        left.state.position.x += nx * overlap;
        left.state.position.z += nz * overlap;
        right.state.position.x -= nx * overlap;
        right.state.position.z -= nz * overlap;
      }
    }
  }

  private snapZombieToGround(zombie: ZombieActor): void {
    if (!this.collisionWorld) {
      return;
    }

    const origin = new Vector3(
      zombie.state.position.x,
      this.collisionWorld.bounds.max.y + ZOMBIE_GROUND_RAY_HEIGHT,
      zombie.state.position.z
    );
    const hit = this.collisionWorld.raycast(origin, new Vector3(0, -1, 0), 60);

    if (hit) {
      zombie.state.position.y = hit.point.y + 0.05;
    }
  }

  private updateEffects(deltaSeconds: number): void {
    const now = performance.now();
    this.effects = this.effects.filter((effect) => {
      if (effect.expiresAt > now) {
        if (effect.velocity) {
          effect.mesh.position.addScaledVector(effect.velocity, deltaSeconds);
          effect.velocity.y -= BLOOD_GRAVITY * deltaSeconds;
        }
        return true;
      }

      effect.mesh.removeFromParent();
      return false;
    });
  }

  private fireShot(): void {
    if (!this.collisionWorld || this.combatState.gameOver) {
      return;
    }

    this.scene.updateMatrixWorld(true);
    const origin = this.getShotOriginAndDirection();
    const trace = this.traceShot(origin, this.shotDirection);

    if (!trace) {
      return;
    }

    if (trace.type === "zombie" && trace.zombie) {
      const result = trace.zombie.applyDamage(BULLET_DAMAGE);
      this.spawnBloodSplash(trace.point, this.shotDirection);
      this.callbacks.onShotFeedback();

      if (result.killed) {
        this.combatState.score += result.scoreDelta;
        this.combatState.zombiesRemaining = this.countAliveZombies();
        this.emitCombatUpdate();
      }

      return;
    }

    const impact = new Mesh(this.impactGeometry, this.impactMaterial);
    impact.position.copy(trace.point);
    this.scene.add(impact);
    this.effects.push({
      mesh: impact,
      expiresAt: performance.now() + IMPACT_LIFETIME_MS,
      velocity: null
    });

    this.callbacks.onShotFeedback();
  }

  private traceShot(origin: Vector3, direction: Vector3): ShotTraceResult | null {
    if (!this.collisionWorld) {
      return null;
    }

    const worldHit = this.collisionWorld.raycast(origin, direction, SHOT_MAX_DISTANCE);
    const zombieHit = this.findClosestZombieHit(origin, direction);

    if (zombieHit && (!worldHit || zombieHit.distance < worldHit.distance)) {
      return {
        type: "zombie",
        distance: zombieHit.distance,
        point: zombieHit.point,
        zombie: zombieHit.zombie
      };
    }

    if (!worldHit) {
      return null;
    }

    return {
      type: "world",
      distance: worldHit.distance,
      point: worldHit.point
    };
  }

  private findClosestZombieHit(origin: Vector3, direction: Vector3): ZombieRaycastHit | null {
    this.zombieRaycaster.set(origin, direction.clone().normalize());
    this.zombieRaycaster.near = 0;
    this.zombieRaycaster.far = SHOT_MAX_DISTANCE;

    let nearest: ZombieRaycastHit | null = null;

    for (const zombie of this.zombies) {
      const hit = zombie.raycast(this.zombieRaycaster);

      if (!hit) {
        continue;
      }

      if (!nearest || hit.distance < nearest.distance) {
        nearest = {
          zombie,
          distance: hit.distance,
          point: hit.point.clone()
        };
      }
    }

    return nearest;
  }

  private spawnBloodSplash(point: Vector3, shotDirection: Vector3): void {
    const sprayDirection = this.bloodVelocity.copy(shotDirection).normalize().multiplyScalar(-1);

    for (let index = 0; index < BLOOD_PARTICLE_COUNT; index += 1) {
      const particle = new Mesh(
        this.bloodGeometry,
        this.bloodMaterials[index % this.bloodMaterials.length]
      );
      const jitter = (index - (BLOOD_PARTICLE_COUNT - 1) * 0.5) * 0.03;
      this.bloodOffset
        .copy(UP_AXIS)
        .multiplyScalar(index % 2 === 0 ? 0.018 : -0.01)
        .addScaledVector(new Vector3(-sprayDirection.z, 0, sprayDirection.x), jitter);
      particle.position.copy(point).add(this.bloodOffset);
      this.scene.add(particle);

      const velocity = sprayDirection
        .clone()
        .multiplyScalar(1.2 + Math.random() * 1.1)
        .add(
          new Vector3(
            (Math.random() - 0.5) * 0.7,
            0.5 + Math.random() * 1.1,
            (Math.random() - 0.5) * 0.7
          )
        );

      this.effects.push({
        mesh: particle,
        expiresAt: performance.now() + BLOOD_SPLASH_LIFETIME_MS,
        velocity
      });
    }
  }

  private countAliveZombies(): number {
    return this.zombies.reduce(
      (count, zombie) => count + (zombie.state.alive ? 1 : 0),
      0
    );
  }

  private emitCombatUpdate(): void {
    this.callbacks.onCombatUpdate({ ...this.combatState });
    this.updateXrHudPanel();
  }

  private getRenderCamera(): Camera {
    return this.isXrPresenting() ? this.camera : this.getActiveCamera();
  }

  private getActiveCamera(): Camera {
    if (this.debugEnabled) {
      return this.debugCamera;
    }

    return this.thirdPersonEnabled ? this.thirdPersonCamera : this.camera;
  }

  private attachSparkToActiveCamera(): void {
    const activeCamera = this.getRenderCamera();
    if (this.spark.parent !== activeCamera) {
      activeCamera.add(this.spark);
    }
  }

  private resetDebugCamera(): void {
    if (!this.collisionWorld) {
      return;
    }

    const bounds = this.collisionWorld.bounds;
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const largestDimension = Math.max(size.x, size.y, size.z, 12);
    const offset = new Vector3(
      largestDimension * 1.1,
      largestDimension * 0.85,
      largestDimension * 1.1
    );

    this.debugCamera.position.copy(center).add(offset);
    this.debugCamera.near = 0.1;
    this.debugCamera.far = Math.max(600, largestDimension * 20);
    this.debugCamera.updateProjectionMatrix();
    this.orbitControls.target.copy(center);
    this.orbitControls.minDistance = Math.max(4, largestDimension * 0.2);
    this.orbitControls.maxDistance = Math.max(80, largestDimension * 8);
    this.orbitControls.update();
  }

  private pushDebugCameraUpdate(): void {
    this.callbacks.onDebugCameraUpdate(this.getDebugCameraInfo());
  }

  private updatePlayerCameraFromHead(deltaSeconds: number): void {
    if (this.isXrPresenting()) {
      return;
    }

    this.camera.position.x = MathUtils.damp(
      this.camera.position.x,
      this.cameraBaseX,
      CAMERA_SMOOTHING,
      deltaSeconds
    );
    this.camera.position.y = MathUtils.damp(
      this.camera.position.y,
      this.player.eyeHeight,
      CAMERA_SMOOTHING,
      deltaSeconds
    );
    this.camera.position.z = this.cameraBaseZ;
    this.camera.rotation.set(this.lookPitch, 0, 0);
  }

  private updateThirdPersonCamera(deltaSeconds: number): void {
    if (!this.collisionWorld || this.isXrPresenting()) {
      return;
    }

    const yaw = this.playerRoot.rotation.y;
    this.thirdPersonForward.set(Math.sin(yaw), 0, -Math.cos(yaw));
    this.thirdPersonRight.set(Math.cos(yaw), 0, Math.sin(yaw));

    this.thirdPersonAnchor.copy(this.player.position);
    this.thirdPersonAnchor.y += Math.max(0.92, this.player.eyeHeight - 0.12);

    this.thirdPersonLookTarget
      .copy(this.thirdPersonAnchor)
      .addScaledVector(this.thirdPersonForward, THIRD_PERSON_LOOK_AHEAD);

    this.thirdPersonDesired
      .copy(this.thirdPersonAnchor)
      .addScaledVector(UP_AXIS, THIRD_PERSON_HEIGHT_OFFSET)
      .addScaledVector(this.thirdPersonForward, -THIRD_PERSON_DISTANCE)
      .addScaledVector(this.thirdPersonRight, THIRD_PERSON_SHOULDER_OFFSET);

    this.thirdPersonRayDirection.subVectors(
      this.thirdPersonDesired,
      this.thirdPersonAnchor
    );
    const desiredDistance = this.thirdPersonRayDirection.length();

    if (desiredDistance > 0.0001) {
      this.thirdPersonRayDirection.divideScalar(desiredDistance);
      const hit = this.collisionWorld.raycast(
        this.thirdPersonAnchor,
        this.thirdPersonRayDirection,
        desiredDistance
      );

      if (hit) {
        this.thirdPersonDesired
          .copy(hit.point)
          .addScaledVector(this.thirdPersonRayDirection, -THIRD_PERSON_COLLISION_PADDING);
      }
    }

    this.thirdPersonCamera.position.x = MathUtils.damp(
      this.thirdPersonCamera.position.x,
      this.thirdPersonDesired.x,
      CAMERA_SMOOTHING,
      deltaSeconds
    );
    this.thirdPersonCamera.position.y = MathUtils.damp(
      this.thirdPersonCamera.position.y,
      this.thirdPersonDesired.y,
      CAMERA_SMOOTHING,
      deltaSeconds
    );
    this.thirdPersonCamera.position.z = MathUtils.damp(
      this.thirdPersonCamera.position.z,
      this.thirdPersonDesired.z,
      CAMERA_SMOOTHING,
      deltaSeconds
    );
    this.thirdPersonCamera.lookAt(this.thirdPersonLookTarget);
  }

  private getShotOriginAndDirection(): Vector3 {
    if (this.isXrPresenting()) {
      const rightController = this.getRightXrController();

      if (rightController) {
        rightController.controller.getWorldPosition(this.shotOrigin);
        this.getControllerForward(rightController.controller, this.shotDirection);
        this.shotOrigin.addScaledVector(this.shotDirection, 0.04);
        return this.shotOrigin;
      }

      const xrCamera = this.renderer.xr.getCamera();
      xrCamera.getWorldDirection(this.shotDirection);
      xrCamera.getWorldPosition(this.shotOrigin);
      this.shotDirection.normalize();
      return this.shotOrigin;
    }

    if (!this.thirdPersonEnabled) {
      this.camera.getWorldDirection(this.shotDirection);
      return this.camera.getWorldPosition(this.shotOrigin);
    }

    const yaw = this.playerRoot.rotation.y;
    this.shotDirection.set(Math.sin(yaw), 0, -Math.cos(yaw));
    this.shotOrigin.copy(this.player.position);
    this.shotOrigin.y += Math.max(0.92, this.player.eyeHeight - 0.08);
    this.shotOrigin.addScaledVector(this.shotDirection, 0.58);
    return this.shotOrigin;
  }

  private updateXrAimAssist(): void {
    if (!this.isXrPresenting() || !this.collisionWorld || this.combatState.gameOver) {
      this.xrAimRay.visible = false;
      this.xrReticle.visible = false;
      return;
    }

    const rightController = this.getRightXrController();
    if (!rightController) {
      this.xrAimRay.visible = false;
      this.xrReticle.visible = false;
      return;
    }

    this.attachXrAimRay(rightController.controller);
    rightController.controller.getWorldPosition(this.shotOrigin);
    this.getControllerForward(rightController.controller, this.shotDirection);
    this.shotOrigin.addScaledVector(this.shotDirection, 0.04);
    const trace = this.traceShot(this.shotOrigin, this.shotDirection);
    const targetDistance = trace ? trace.distance : XR_AIM_DISTANCE;

    this.xrAimRay.visible = true;
    this.xrAimRay.scale.set(1, 1, targetDistance);
    this.xrReticle.visible = true;

    if (trace) {
      this.xrReticle.position.copy(trace.point);
      return;
    }

    this.xrReticle.position.copy(this.shotOrigin).addScaledVector(this.shotDirection, XR_AIM_DISTANCE);
  }

  private getXrMovementYaw(): number {
    this.renderer.xr.getCamera().getWorldDirection(this.xrHeadDirection);
    this.xrHeadDirection.y = 0;

    if (this.xrHeadDirection.lengthSq() < 0.0001) {
      return this.playerRoot.rotation.y;
    }

    this.xrHeadDirection.normalize();
    return Math.atan2(this.xrHeadDirection.x, -this.xrHeadDirection.z);
  }

  private getXrLocalHeadOffset(target: Vector3): Vector3 {
    this.playerRoot.updateMatrixWorld(true);
    this.renderer.xr.getCamera().getWorldPosition(this.xrCameraWorldPosition);
    return this.playerRoot.worldToLocal(target.copy(this.xrCameraWorldPosition));
  }

  private getControllerForward(controller: Object3D, target: Vector3): Vector3 {
    controller.getWorldQuaternion(this.xrControllerQuaternion);
    return target.set(0, 0, -1).applyQuaternion(this.xrControllerQuaternion).normalize();
  }

  private getRightXrController(): XrControllerSlot | null {
    return this.xrControllers.find((controller) => controller.handedness === "right") ?? null;
  }

  private setXrState(nextState: XrSessionState): void {
    const current = this.xrState;
    const unchanged =
      current.checked === nextState.checked &&
      current.supported === nextState.supported &&
      current.canEnter === nextState.canEnter &&
      current.isPresenting === nextState.isPresenting &&
      current.status === nextState.status &&
      current.message === nextState.message;

    if (unchanged) {
      return;
    }

    this.xrState = nextState;
    this.callbacks.onXrStateChange({ ...this.xrState });
  }

  private async refreshXrAvailability(): Promise<void> {
    const probe = {
      hasNavigatorXr: typeof navigator !== "undefined" && "xr" in navigator,
      isSecureContext: window.isSecureContext
    };
    const initial = getInitialXrSessionState(probe);

    if (!initial.supported) {
      this.setXrState(initial);
      return;
    }

    try {
      const xr = navigator.xr;
      if (!xr) {
        this.setXrState(
          createXrSessionState(
            "unsupported",
            "This browser does not expose WebXR immersive VR."
          )
        );
        return;
      }

      const supported = await xr.isSessionSupported("immersive-vr");

      if (this.destroyed || this.isXrPresenting()) {
        return;
      }

      this.setXrState(
        supported
          ? createXrSessionState("available")
          : createXrSessionState(
              "unsupported",
              "Immersive VR is not available on this device."
            )
      );
    } catch (error) {
      console.error(error);

      if (this.destroyed || this.isXrPresenting()) {
        return;
      }

      this.setXrState(
        createXrSessionState(
          "error",
          "WebXR support could not be verified in this browser."
        )
      );
    }
  }

  private handleXrControllerConnected(index: number, inputSource: XRInputSource): void {
    const slot = this.xrControllers[index];
    if (!slot) {
      return;
    }

    slot.handedness = inputSource.handedness;
    slot.inputSource = inputSource;

    if (slot.handedness === "right" && this.isXrPresenting()) {
      this.attachXrAimRay(slot.controller);
    }
  }

  private handleXrControllerDisconnected(index: number): void {
    const slot = this.xrControllers[index];
    if (!slot) {
      return;
    }

    if (slot.handedness === "right") {
      this.detachXrAimRay();
      this.xrReticle.visible = false;
    }

    slot.handedness = "none";
    slot.inputSource = null;
  }

  private attachXrAimRay(controller: Object3D): void {
    if (this.xrAimRay.parent !== controller) {
      this.xrAimRay.removeFromParent();
      controller.add(this.xrAimRay);
    }
  }

  private detachXrAimRay(): void {
    this.xrAimRay.removeFromParent();
    this.xrAimRay.visible = false;
  }

  private updateXrPresentationVisuals(): void {
    const presenting = this.isXrPresenting();
    this.xrHud.setVisible(presenting);

    if (this.character) {
      this.character.root.visible = !presenting;
    }

    if (!presenting) {
      this.detachXrAimRay();
      this.xrReticle.visible = false;
      return;
    }

    const rightController = this.getRightXrController();
    if (rightController) {
      this.attachXrAimRay(rightController.controller);
    }
  }

  private updateXrHudPanel(): void {
    this.xrHud.update({
      combat: this.combatState,
      worldLabel: this.world.label,
      playerText: this.session.playerText,
      referenceSpaceLabel:
        this.xrReferenceSpaceType === "local-floor" ? "local-floor" : "local fallback"
    });
  }

  private applyVrCameraMode(): void {
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
  }

  private restoreFlatCameraMode(): void {
    this.player.height = STAND_HEIGHT;
    this.player.eyeHeight = STAND_EYE_HEIGHT;
    this.camera.position.set(this.cameraBaseX, this.player.eyeHeight, this.cameraBaseZ);
    this.camera.rotation.set(this.lookPitch, 0, 0);
    if (this.character) {
      this.character.root.visible = true;
    }
  }

  private async beginXrSession(referenceSpaceType: "local-floor" | "local"): Promise<void> {
    const xr = navigator.xr;
    if (!xr) {
      throw new Error("WebXR is unavailable.");
    }

    const sessionInit: XRSessionInit = {
      optionalFeatures: [
        "bounded-floor",
        "layers",
        ...(referenceSpaceType === "local-floor" ? ["local-floor"] : [])
      ]
    };

    this.renderer.xr.setReferenceSpaceType(referenceSpaceType);
    const session = await xr.requestSession("immersive-vr", sessionInit);

    try {
      session.addEventListener("end", this.handleXrSessionEnded);
      await this.renderer.xr.setSession(session);
      this.xrReferenceSpaceType = referenceSpaceType;
      this.xrSessionEnding = false;
    } catch (error) {
      session.removeEventListener("end", this.handleXrSessionEnded);
      await session.end().catch(() => {});
      throw error;
    }
  }

  private async endXrSession(): Promise<void> {
    const session = this.renderer.xr.getSession();
    if (!session) {
      this.handleXrSessionEnded();
      return;
    }

    if (this.xrSessionEnding) {
      return;
    }

    this.xrSessionEnding = true;

    try {
      await session.end();
    } catch (error) {
      console.warn(error);
      this.handleXrSessionEnded();
    }
  }

  private readonly handleXrSessionEnded = (): void => {
    this.xrSessionEnding = false;
    this.restoreFlatCameraMode();
    this.updateXrPresentationVisuals();
    this.attachSparkToActiveCamera();
    this.pushDebugCameraUpdate();

    if (this.destroyed) {
      return;
    }

    void this.refreshXrAvailability();
  };

  private isXrPresenting(): boolean {
    return this.renderer.xr.isPresenting;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}
