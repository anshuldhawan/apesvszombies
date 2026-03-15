import "./styles.css";

import { createInitialCombatHudState, ZOMBIE_COUNT } from "./game/combat";
import { FpsGame, type DebugCameraInfo } from "./game/FpsGame";
import { buildMenuWorlds, rememberGeneratedWorld } from "./game/world-menu";
import { generateWorldFromLocation, normalizeLocationInput } from "./game/worldlabs";
import { worldDefinitions } from "./game/worlds";
import { createUncheckedXrSessionState } from "./game/xr";
import type {
  AppState,
  CombatHudState,
  SessionState,
  WorldDefinition,
  XrSessionState
} from "./game/types";

class NeverDeadApp {
  private readonly root: HTMLElement;
  private readonly session: SessionState = {
    playerText: "",
    selectedWorldId: null
  };
  private readonly shell = document.createElement("div");
  private readonly stage = document.createElement("div");
  private readonly menu = document.createElement("div");
  private readonly overlay = document.createElement("div");
  private readonly overlayCard = document.createElement("div");
  private readonly overlayTitle = document.createElement("h2");
  private readonly overlayCopy = document.createElement("p");
  private readonly overlayActions = document.createElement("div");
  private readonly restartButton = document.createElement("button");
  private readonly backButton = document.createElement("button");
  private readonly hud = document.createElement("div");
  private readonly worldTag = document.createElement("div");
  private readonly playerTag = document.createElement("div");
  private readonly healthTag = document.createElement("div");
  private readonly scoreTag = document.createElement("div");
  private readonly zombiesTag = document.createElement("div");
  private readonly hudToolbar = document.createElement("div");
  private readonly quitLevelButton = document.createElement("button");
  private readonly vrButton = document.createElement("button");
  private readonly thirdPersonButton = document.createElement("button");
  private readonly debugButton = document.createElement("button");
  private readonly debugReadout = document.createElement("div");
  private readonly damageFlash = document.createElement("div");
  private readonly crosshair = document.createElement("div");
  private readonly statusNote = document.createElement("div");
  private readonly playerInput = document.createElement("input");
  private readonly inputRow = document.createElement("div");
  private readonly generateButton = document.createElement("button");
  private readonly worldGrid = document.createElement("div");
  private readonly menuError = document.createElement("p");

  private state: AppState = { kind: "menu" };
  private game: FpsGame | null = null;
  private shotFlashTimer: number | null = null;
  private damageFlashTimer: number | null = null;
  private menuErrorMessage: string | null = null;
  private combatHudState: CombatHudState = createInitialCombatHudState(0);
  private xrState: XrSessionState = createUncheckedXrSessionState();
  private debugCameraInfo: DebugCameraInfo = {
    enabled: false,
    mode: "firstPerson",
    position: { x: 0, y: 0, z: 0 }
  };
  private generatedWorlds: WorldDefinition[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.shell.className = "app-shell";
    this.stage.className = "stage";
    this.menu.className = "menu-panel";
    this.overlay.className = "overlay";
    this.overlayCard.className = "overlay-card";
    this.overlayTitle.className = "overlay-title";
    this.overlayCopy.className = "overlay-copy";
    this.overlayActions.className = "overlay-actions";
    this.restartButton.className = "button-primary";
    this.restartButton.textContent = "Restart Same Map";
    this.backButton.className = "button-secondary";
    this.backButton.textContent = "Back To Worlds";
    this.hud.className = "hud";
    this.worldTag.className = "hud-pill";
    this.playerTag.className = "hud-pill";
    this.healthTag.className = "hud-pill";
    this.scoreTag.className = "hud-pill";
    this.zombiesTag.className = "hud-pill";
    this.hudToolbar.className = "hud-toolbar";
    this.quitLevelButton.className = "hud-button";
    this.vrButton.className = "hud-button";
    this.thirdPersonButton.className = "hud-button";
    this.debugButton.className = "hud-button";
    this.debugReadout.className = "debug-readout";
    this.damageFlash.className = "damage-flash";
    this.crosshair.className = "crosshair";
    this.statusNote.className = "status-note";

    const menuCard = document.createElement("div");
    menuCard.className = "menu-card";
    menuCard.innerHTML = `
      <span class="eyebrow">Spark + Three FPS Prototype</span>
      <p class="menu-copy">
        Type a location to generate a World Labs shooter arena, or jump straight into one of the preset splat worlds from the asset folder.
      </p>
      <label class="field-label" for="player-text">Where do you want to play?</label>
    `;

    this.playerInput.className = "player-input";
    this.playerInput.id = "player-text";
    this.playerInput.placeholder = "desert canyon outpost";
    this.playerInput.autocomplete = "off";
    this.playerInput.spellcheck = false;
    this.playerInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      void this.generateAndPlayWorld();
    });

    this.inputRow.className = "input-row";

    this.generateButton.type = "button";
    this.generateButton.className = "button-primary generate-button";
    this.generateButton.textContent = "Generate & Play";
    this.generateButton.addEventListener("click", () => {
      void this.generateAndPlayWorld();
    });

    this.menuError.className = "menu-error";
    this.worldGrid.className = "world-grid";

    this.inputRow.append(this.playerInput, this.generateButton);
    menuCard.append(this.menuError, this.inputRow, this.worldGrid);
    this.menu.append(menuCard);

    this.overlayCard.append(this.overlayTitle, this.overlayCopy, this.overlayActions);
    this.overlayActions.append(this.restartButton, this.backButton);
    this.overlay.append(this.overlayCard);

    const hudBand = document.createElement("div");
    hudBand.className = "hud-band";
    hudBand.append(
      this.worldTag,
      this.healthTag,
      this.scoreTag,
      this.zombiesTag,
      this.playerTag
    );
    this.quitLevelButton.type = "button";
    this.quitLevelButton.textContent = "Quit Level";
    this.quitLevelButton.addEventListener("click", () => {
      if (this.state.kind !== "playing") {
        return;
      }

      this.backToMenu();
    });
    this.vrButton.type = "button";
    this.vrButton.textContent = "Checking VR";
    this.vrButton.addEventListener("click", () => {
      if (!this.game || this.state.kind !== "playing") {
        return;
      }

      if (this.xrState.isPresenting) {
        void this.game.exitVr();
        return;
      }

      void this.game.enterVr();
    });
    this.thirdPersonButton.type = "button";
    this.thirdPersonButton.addEventListener("click", () => {
      if (!this.game || this.state.kind !== "playing" || this.combatHudState.gameOver) {
        return;
      }

      this.game.toggleThirdPersonMode();
      this.debugCameraInfo = this.game.getDebugCameraInfo();
      this.renderHud();
    });
    this.debugButton.type = "button";
    this.debugButton.addEventListener("click", () => {
      if (!this.game || this.state.kind !== "playing" || this.combatHudState.gameOver) {
        return;
      }

      this.debugCameraInfo.enabled = this.game.toggleDebugMode();
      this.debugCameraInfo = this.game.getDebugCameraInfo();
      this.renderHud();
    });
    this.restartButton.addEventListener("click", () => {
      if (this.state.kind !== "playing") {
        return;
      }

      void this.startWorld(this.state.world);
    });
    this.backButton.addEventListener("click", () => {
      this.backToMenu();
    });

    this.hudToolbar.append(
      this.quitLevelButton,
      this.vrButton,
      this.thirdPersonButton,
      this.debugButton,
      this.debugReadout
    );
    this.hud.append(this.damageFlash, hudBand, this.hudToolbar, this.crosshair, this.statusNote);

    this.shell.append(this.stage, this.menu, this.overlay, this.hud);
    this.root.append(this.shell);

    this.playerInput.addEventListener("input", () => {
      this.session.playerText = this.playerInput.value.trim();
      this.renderHud();
    });

    window.addEventListener("keydown", this.handleGlobalKeyDown);

    this.renderWorldButtons();
    this.render();
  }

  private renderWorldButtons(): void {
    const availableWorlds = buildMenuWorlds(worldDefinitions, this.generatedWorlds);

    if (availableWorlds.length === 0) {
      const empty = document.createElement("p");
      empty.className = "menu-copy";
      empty.textContent = "No preset or generated worlds are available yet.";
      this.worldGrid.replaceChildren(empty);
      return;
    }

    const buttons = availableWorlds.map((world, index) => {
      const button = document.createElement("button");
      button.className = `world-button ${world.source === "generated" ? "generated" : ""}`;
      const sourceLabel = world.source === "generated" ? "Generated" : "Preset";
      const meta =
        world.source === "generated"
          ? "Generated live from World Labs and cached for this session."
          : null;

      button.innerHTML = `
        <span class="world-badge">${sourceLabel}</span>
        <span class="world-label">${world.label}</span>
        ${meta ? `<span class="world-meta">${meta}</span>` : ""}
        <span class="world-index">${String(index + 1).padStart(2, "0")}</span>
      `;
      button.title = world.promptText ?? world.label;
      button.addEventListener("click", () => {
        void this.startWorld(world);
      });
      return button;
    });

    this.worldGrid.replaceChildren(...buttons);
  }

  private async generateAndPlayWorld(): Promise<void> {
    if (this.isMenuBusy()) {
      return;
    }

    let location: string;

    try {
      location = normalizeLocationInput(this.playerInput.value);
    } catch (error) {
      this.menuErrorMessage =
        error instanceof Error ? error.message : "Enter a location before generating a world.";
      this.state = { kind: "menu" };
      this.render();
      return;
    }

    this.menuErrorMessage = null;
    this.session.playerText = location;
    this.state = {
      kind: "requesting",
      location,
      statusMessage: "Sending your prompt to World Labs."
    };
    this.render();

    try {
      const world = await generateWorldFromLocation(location, {
        onProgress: (progress) => {
          if (progress.phase === "requesting") {
            this.state = {
              kind: "requesting",
              location,
              statusMessage: progress.message
            };
          } else {
            this.state = {
              kind: "polling",
              location,
              statusMessage: progress.message,
              operationId: progress.operationId
            };
          }

          this.render();
        }
      });

      this.generatedWorlds = rememberGeneratedWorld(this.generatedWorlds, world);
      this.renderWorldButtons();
      await this.startWorld(world);
    } catch (error) {
      console.error(error);
      this.menuErrorMessage =
        error instanceof Error ? error.message : "World generation failed. Please try again.";
      this.state = { kind: "menu" };
      this.render();
    }
  }

  private async startWorld(world: WorldDefinition): Promise<void> {
    this.menuErrorMessage = null;
    this.combatHudState = createInitialCombatHudState(0);
    this.session.playerText =
      this.playerInput.value.trim() || (world.source === "generated" ? world.label : "");
    this.session.selectedWorldId = world.id;
    this.destroyGame();

    this.state = { kind: "loading", world };
    this.render();

    const game = new FpsGame({
      container: this.stage,
      world,
      session: this.session,
      callbacks: {
        onReady: () => {
          this.debugCameraInfo = this.game?.getDebugCameraInfo() ?? this.debugCameraInfo;
          this.xrState = this.game?.getXrState() ?? this.xrState;
          this.state = { kind: "playing", world };
          this.render();
        },
        onShotFeedback: () => {
          this.flashCrosshair();
        },
        onPlayerHit: () => {
          this.flashDamageOverlay();
        },
        onDebugCameraUpdate: (info) => {
          this.debugCameraInfo = info;
          if (this.state.kind === "playing") {
            this.renderHud();
          }
        },
        onCombatUpdate: (state) => {
          this.combatHudState = state;
          if (this.state.kind === "playing") {
            this.render();
          }
        },
        onXrStateChange: (state) => {
          this.xrState = state;
          if (this.state.kind === "playing") {
            this.renderHud();
          }
        }
      }
    });

    this.game = game;

    try {
      await game.load();
    } catch (error) {
      console.error(error);
      this.destroyGame();
      this.menuErrorMessage =
        "This world failed to initialize. Check the browser console and try another world.";
      this.state = { kind: "menu" };
      this.render();
    }
  }

  private backToMenu(): void {
    this.destroyGame();
    this.session.selectedWorldId = null;
    this.combatHudState = createInitialCombatHudState(0);
    this.debugCameraInfo = {
      enabled: false,
      mode: "firstPerson",
      position: { x: 0, y: 0, z: 0 }
    };
    this.xrState = createUncheckedXrSessionState();
    this.state = { kind: "menu" };
    this.render();
  }

  private destroyGame(): void {
    this.game?.destroy();
    this.game = null;
    this.xrState = createUncheckedXrSessionState();
    this.stage.innerHTML = "";
  }

  private render(): void {
    const menuVisible = this.state.kind === "menu" || this.state.kind === "requesting" || this.state.kind === "polling";
    const overlayVisible =
      this.state.kind === "requesting" ||
      this.state.kind === "polling" ||
      this.state.kind === "loading" ||
      this.combatHudState.gameOver;

    this.menu.classList.toggle("hidden", !menuVisible);
    this.overlay.classList.toggle("visible", overlayVisible);
    this.hud.classList.toggle("visible", this.state.kind === "playing");
    this.menuError.textContent = this.menuErrorMessage ?? "";
    this.menuError.hidden = !this.menuErrorMessage;
    this.generateButton.textContent =
      this.state.kind === "requesting" || this.state.kind === "polling"
        ? "Generating..."
        : "Generate & Play";
    this.playerInput.disabled = this.isMenuBusy();
    this.generateButton.disabled = this.isMenuBusy();
    this.renderOverlay();
    this.renderHud();
    this.toggleWorldButtons(this.isMenuBusy());
  }

  private renderOverlay(): void {
    switch (this.state.kind) {
      case "menu":
        this.overlay.classList.remove("visible");
        return;
      case "requesting":
        this.overlayTitle.textContent = `Generating ${this.state.location}`;
        this.overlayCopy.textContent = this.state.statusMessage;
        this.overlayActions.style.display = "none";
        return;
      case "polling":
        this.overlayTitle.textContent = `Generating ${this.state.location}`;
        this.overlayCopy.textContent = this.state.operationId
          ? `${this.state.statusMessage} Operation: ${this.state.operationId}.`
          : this.state.statusMessage;
        this.overlayActions.style.display = "none";
        return;
      case "playing":
        if (!this.combatHudState.gameOver) {
          this.overlay.classList.remove("visible");
          return;
        }

        this.overlayTitle.textContent = "Game Over";
        this.overlayCopy.textContent = `The zombies got you. Final score: ${this.combatHudState.score}. Health: ${this.combatHudState.playerHealth}.`;
        this.overlayActions.style.display = "flex";
        return;
      case "loading":
        this.overlayTitle.textContent = `Loading ${this.state.world.label}`;
        this.overlayCopy.textContent =
          this.state.world.source === "generated"
            ? "World Labs finished the map. Preparing the splat scene, collision mesh, first-person view, and zombie wave."
            : "Parsing the selected SPZ splat world, preparing the matching GLB collision mesh, mounting the first-person view mesh, and spawning zombies.";
        this.overlayActions.style.display = "none";
        break;
    }
  }

  private renderHud(): void {
    const activeWorld =
      this.state.kind === "playing" || this.state.kind === "loading" ? this.state.world : null;

    this.worldTag.textContent = activeWorld ? `World: ${activeWorld.label}` : "World: None";
    this.healthTag.textContent = `Health: ${this.combatHudState.playerHealth}`;
    this.scoreTag.textContent = `Score: ${this.combatHudState.score}`;
    this.zombiesTag.textContent = `Zombies: ${this.combatHudState.zombiesRemaining}`;
    this.playerTag.textContent = this.session.playerText
      ? `Location: ${this.session.playerText}`
      : "Location: Empty";
    this.playerTag.style.display = this.session.playerText ? "" : "none";
    this.vrButton.textContent = this.getVrButtonLabel();
    this.vrButton.disabled =
      !activeWorld ||
      this.state.kind !== "playing" ||
      this.combatHudState.gameOver ||
      !this.xrState.checked ||
      this.xrState.status === "unsupported" ||
      this.xrState.status === "error" ||
      this.xrState.status === "entering";
    this.thirdPersonButton.textContent =
      this.debugCameraInfo.mode === "thirdPerson" ? "First Person" : "Third Person";
    this.quitLevelButton.style.display =
      activeWorld && this.state.kind === "playing" && !this.combatHudState.gameOver ? "" : "none";
    this.vrButton.style.display =
      activeWorld && this.state.kind === "playing" && !this.combatHudState.gameOver ? "" : "none";
    this.thirdPersonButton.style.display =
      activeWorld &&
      this.state.kind === "playing" &&
      !this.combatHudState.gameOver &&
      !this.xrState.isPresenting
        ? ""
        : "none";
    this.debugButton.textContent = this.debugCameraInfo.enabled ? "Exit Debug View" : "Debug View";
    this.debugButton.style.display =
      activeWorld &&
      this.state.kind === "playing" &&
      !this.combatHudState.gameOver &&
      !this.xrState.isPresenting
        ? ""
        : "none";
    this.debugReadout.hidden =
      this.debugCameraInfo.mode === "firstPerson" || this.xrState.isPresenting;
    this.debugReadout.textContent = `${this.getCameraLabel()} ${this.formatAxis(this.debugCameraInfo.position.x)} ${this.formatAxis(this.debugCameraInfo.position.y)} ${this.formatAxis(this.debugCameraInfo.position.z)}`;
    this.crosshair.classList.toggle(
      "hidden",
      this.debugCameraInfo.enabled || this.combatHudState.gameOver || this.xrState.isPresenting
    );
    this.statusNote.textContent = this.combatHudState.gameOver
      ? "Zombies attack for 10 damage every 2 seconds in melee range. Restart to fight the wave again."
      : this.xrState.isPresenting
        ? "VR is active. Left stick moves, right stick turns, right trigger shoots, and the left face button jumps. Leaving the level or dying exits VR."
        : !this.xrState.checked
          ? "Checking WebXR support for this browser."
          : this.xrState.status === "error" || this.xrState.status === "unsupported"
            ? this.xrState.message ?? "Immersive VR is unavailable in this browser."
            : this.xrState.canEnter
              ? "VR is available for this loaded world. Use Enter VR to switch into headset play."
              : this.debugCameraInfo.enabled
                ? "Debug view is active. Drag to orbit, scroll to zoom, and click the button again to return to gameplay."
                : this.debugCameraInfo.mode === "thirdPerson"
                  ? "Third-person camera is active for chase-view debugging. The player view mesh stays first-person only, so no avatar is shown from this camera. Use Debug View for the free orbit camera."
                  : `Use WASD to move, Arrow keys to aim, Space to jump, Option to shoot, and survive ${ZOMBIE_COUNT} zombies with the first-person weapon view locked to the camera.`;
  }

  private isMenuBusy(): boolean {
    return (
      this.state.kind === "requesting" ||
      this.state.kind === "polling" ||
      this.state.kind === "loading"
    );
  }

  private toggleWorldButtons(disabled: boolean): void {
    this.worldGrid.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = disabled;
    });
  }

  private flashCrosshair(): void {
    this.crosshair.classList.add("flash");

    if (this.shotFlashTimer !== null) {
      window.clearTimeout(this.shotFlashTimer);
    }

    this.shotFlashTimer = window.setTimeout(() => {
      this.crosshair.classList.remove("flash");
      this.shotFlashTimer = null;
    }, 90);
  }

  private flashDamageOverlay(): void {
    this.damageFlash.classList.add("active");

    if (this.damageFlashTimer !== null) {
      window.clearTimeout(this.damageFlashTimer);
    }

    this.damageFlashTimer = window.setTimeout(() => {
      this.damageFlash.classList.remove("active");
      this.damageFlashTimer = null;
    }, 220);
  }

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "Escape" || this.state.kind !== "playing") {
      return;
    }

    event.preventDefault();
    this.backToMenu();
  };

  private formatAxis(value: number): string {
    return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
  }

  private getCameraLabel(): string {
    switch (this.debugCameraInfo.mode) {
      case "debug":
        return "Debug Cam";
      case "thirdPerson":
        return "3P Cam";
      default:
        return "Cam";
    }
  }

  private getVrButtonLabel(): string {
    if (this.xrState.isPresenting) {
      return "Exit VR";
    }

    if (!this.xrState.checked) {
      return "Checking VR";
    }

    switch (this.xrState.status) {
      case "available":
        return "Enter VR";
      case "entering":
        return "Entering VR...";
      case "error":
        return "VR Error";
      default:
        return "VR Unavailable";
    }
  }
}

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root element.");
}

new NeverDeadApp(root);
