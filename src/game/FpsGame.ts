import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import {
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
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
import { zombieModelUrl, heroModelUrl } from "./worlds";
import type { CombatHudState, SessionState, WorldDefinition } from "./types";
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
const TURN_SPEED = 2.4;
const LOOK_SPEED = 1.2;
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

interface GameCallbacks {
  onReady: () => void;
  onShotFeedback: () => void;
  onPlayerHit: () => void;
  onDebugCameraUpdate: (info: DebugCameraInfo) => void;
  onCombatUpdate: (state: CombatHudState) => void;
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
  private debugEnabled = false;
  private thirdPersonEnabled = false;
  private destroyed = false;
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

    this.scene.background = new Color("#05070b");
    this.scene.add(this.playerRoot);
    this.playerRoot.add(this.camera);
    this.scene.add(this.thirdPersonCamera);
    this.scene.add(this.debugCamera);
    this.camera.layers.enable(getHeroLayer());
    this.camera.add(this.spark);
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

    this.scene.add(new AmbientLight("#9ebcff", 0.35));
    const keyLight = new DirectionalLight("#ffd39d", 1.1);
    keyLight.position.set(6, 12, 4);
    this.scene.add(keyLight);
  }

  async load(): Promise<void> {
    this.container.innerHTML = "";
    this.container.append(this.renderer.domElement);
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);

    const [collisionWorld, character, zombieTemplate] = await Promise.all([
      CollisionWorld.load(this.world.collisionGlbUrl),
      CharacterAnimator.load({ modelUrl: heroModelUrl }),
      ZombieActor.loadTemplate(zombieModelUrl)
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

    this.splatWorld = new SplatMesh({ url: this.world.spzUrl });
    this.splatWorld.position.copy(collisionWorld.rootPosition);
    this.splatWorld.quaternion.copy(collisionWorld.rootQuaternion);
    this.splatWorld.scale.copy(collisionWorld.rootScale);
    this.scene.add(this.splatWorld);
    this.scene.add(collisionWorld.mesh);

    await this.splatWorld.initialized;

    const spawnPoint = collisionWorld.getSpawnPoint(STAND_HEIGHT);
    this.player.position.copy(spawnPoint);
    this.playerRoot.position.copy(spawnPoint);
    this.player.onGround = true;
    this.camera.position.set(this.cameraBaseX, this.player.eyeHeight, this.cameraBaseZ);
    this.updateThirdPersonCamera(1);

    this.spawnZombies(zombieTemplate);
    this.resetDebugCamera();
    this.emitCombatUpdate();

    this.clock.start();
    this.renderer.setAnimationLoop(this.animate);
    this.pushDebugCameraUpdate();
    this.callbacks.onReady();
  }

  destroy(): void {
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.container.innerHTML = "";
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.collisionWorld?.destroy();
    this.impactGeometry.dispose();
    this.impactMaterial.dispose();
    this.bloodGeometry.dispose();
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
  }

  toggleDebugMode(): boolean {
    if (this.destroyed || !this.collisionWorld || this.combatState.gameOver) {
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
    if (this.destroyed || !this.collisionWorld || this.combatState.gameOver) {
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
    const activeCamera = this.getActiveCamera();
    const position = activeCamera.getWorldPosition(new Vector3());

    return {
      enabled: this.debugEnabled,
      mode: this.debugEnabled
        ? "debug"
        : this.thirdPersonEnabled
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

    if (code === "Space") {
      this.player.jumpQueued = true;
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
    this.renderer.render(this.scene, this.getActiveCamera());
  };

  private update(deltaSeconds: number): void {
    this.updateEffects(deltaSeconds);

    if (!this.collisionWorld || !this.character) {
      return;
    }

    if (this.debugEnabled || this.combatState.gameOver) {
      if (this.debugEnabled) {
        this.orbitControls.update();
      }
      this.pushDebugCameraUpdate();
      return;
    }

    if (this.pressedKeys.has("ArrowLeft")) {
      this.playerRoot.rotation.y += TURN_SPEED * deltaSeconds;
    }
    if (this.pressedKeys.has("ArrowRight")) {
      this.playerRoot.rotation.y -= TURN_SPEED * deltaSeconds;
    }
    if (!this.thirdPersonEnabled) {
      const lookDirection =
        (this.pressedKeys.has("ArrowUp") ? 1 : 0) - (this.pressedKeys.has("ArrowDown") ? 1 : 0);
      this.lookPitch = stepLookPitch(
        this.lookPitch,
        lookDirection,
        deltaSeconds,
        LOOK_SPEED
      );
      this.camera.rotation.set(this.lookPitch, 0, 0);
    }

    this.movementVector.set(0, 0, 0);
    if (this.pressedKeys.has("KeyW")) {
      this.movementVector.z -= 1;
    }
    if (this.pressedKeys.has("KeyS")) {
      this.movementVector.z += 1;
    }
    if (this.pressedKeys.has("KeyA")) {
      this.movementVector.x -= 1;
    }
    if (this.pressedKeys.has("KeyD")) {
      this.movementVector.x += 1;
    }

    if (this.movementVector.lengthSq() > 0) {
      this.movementVector.normalize();
    }

    const yaw = this.playerRoot.rotation.y;
    this.forwardVector.set(Math.sin(yaw), 0, -Math.cos(yaw));
    this.rightVector.set(Math.cos(yaw), 0, Math.sin(yaw));

    const horizontalVelocity = new Vector3()
      .addScaledVector(this.forwardVector, -this.movementVector.z)
      .addScaledVector(this.rightVector, this.movementVector.x);

    if (horizontalVelocity.lengthSq() > 0) {
      horizontalVelocity.normalize().multiplyScalar(RUN_SPEED);
    }

    this.player.velocity.x = horizontalVelocity.x;
    this.player.velocity.z = horizontalVelocity.z;

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
      .addScaledVector(new Vector3(0, 1, 0), verticalDisplacement);

    const collision = this.collisionWorld.resolveCapsule(
      proposedPosition,
      this.player.height,
      PLAYER_RADIUS,
      verticalDisplacement
    );

    this.player.position.copy(collision.position);
    this.playerRoot.position.copy(this.player.position);
    this.player.onGround = collision.grounded;

    if (this.player.onGround && this.player.velocity.y < 0) {
      this.player.velocity.y = 0;
    }

    const isShooting = this.pressedKeys.has("Shoot");
    this.shotCooldown -= deltaSeconds;

    if (isShooting && this.shotCooldown <= 0) {
      this.fireShot();
      this.shotCooldown = SHOT_INTERVAL;
    }

    this.updateZombies(deltaSeconds);
    this.updatePlayerCameraFromHead(deltaSeconds);
    this.updateThirdPersonCamera(deltaSeconds);
    this.pushDebugCameraUpdate();
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
          distanceToPlayer > 0.0001
            ? this.zombieDirection.normalize()
            : ZOMBIE_FACING_IDLE
        );
      } else {
        zombie.setMode("chasing");

        if (distanceToPlayer > ZOMBIE_STOP_DISTANCE) {
          this.zombieDirection.normalize();
          zombie.state.velocity
            .copy(this.zombieDirection)
            .multiplyScalar(ZOMBIE_SPEED);

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
    const worldHit = this.collisionWorld.raycast(origin, this.shotDirection, SHOT_MAX_DISTANCE);
    const zombieHit = this.findClosestZombieHit(origin, this.shotDirection);

    if (zombieHit && (!worldHit || zombieHit.distance < worldHit.distance)) {
      const result = zombieHit.zombie.applyDamage(BULLET_DAMAGE);
      this.spawnBloodSplash(zombieHit.point, this.shotDirection);
      this.callbacks.onShotFeedback();

      if (result.killed) {
        this.combatState.score += result.scoreDelta;
        this.combatState.zombiesRemaining = this.countAliveZombies();
        this.emitCombatUpdate();
      }

      return;
    }

    if (!worldHit) {
      return;
    }

    const impact = new Mesh(this.impactGeometry, this.impactMaterial);
    impact.position.copy(worldHit.point);
    this.scene.add(impact);
    this.effects.push({
      mesh: impact,
      expiresAt: performance.now() + IMPACT_LIFETIME_MS,
      velocity: null
    });

    this.callbacks.onShotFeedback();
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
  }

  private getActiveCamera(): PerspectiveCamera {
    if (this.debugEnabled) {
      return this.debugCamera;
    }

    return this.thirdPersonEnabled ? this.thirdPersonCamera : this.camera;
  }

  private attachSparkToActiveCamera(): void {
    const activeCamera = this.getActiveCamera();
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
    if (!this.collisionWorld) {
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
          .addScaledVector(
            this.thirdPersonRayDirection,
            -THIRD_PERSON_COLLISION_PADDING
          );
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
}
