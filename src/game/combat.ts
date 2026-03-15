import type { CombatHudState } from "./types";

export const PLAYER_STARTING_HEALTH = 100;
export const BULLET_DAMAGE = 10;
export const ZOMBIE_STARTING_HEALTH = BULLET_DAMAGE;
export const ZOMBIE_ATTACK_DAMAGE = 10;
export const ZOMBIE_ATTACK_INTERVAL = 2;
export const KILL_SCORE = 100;
export const ZOMBIE_COUNT = 5;

export interface BulletDamageResult {
  nextHealth: number;
  alive: boolean;
  killed: boolean;
  scoreDelta: number;
}

export interface ZombieAttackTickResult {
  playerHealth: number;
  attackCooldown: number;
  attacked: boolean;
  gameOver: boolean;
}

export function createInitialCombatHudState(
  zombiesRemaining = ZOMBIE_COUNT
): CombatHudState {
  return {
    playerHealth: PLAYER_STARTING_HEALTH,
    score: 0,
    zombiesRemaining,
    gameOver: false
  };
}

export function applyBulletDamage(
  currentHealth: number,
  damage: number
): BulletDamageResult {
  if (currentHealth <= 0) {
    return {
      nextHealth: 0,
      alive: false,
      killed: false,
      scoreDelta: 0
    };
  }

  const nextHealth = Math.max(0, currentHealth - damage);
  const killed = currentHealth > 0 && nextHealth === 0;

  return {
    nextHealth,
    alive: nextHealth > 0,
    killed,
    scoreDelta: killed ? KILL_SCORE : 0
  };
}

export function tickZombieAttack(params: {
  playerHealth: number;
  attackCooldown: number;
  inRange: boolean;
  deltaSeconds: number;
  attackDamage?: number;
  attackInterval?: number;
}): ZombieAttackTickResult {
  const attackDamage = params.attackDamage ?? ZOMBIE_ATTACK_DAMAGE;
  const attackInterval = params.attackInterval ?? ZOMBIE_ATTACK_INTERVAL;
  const cooledDown = Math.max(0, params.attackCooldown - params.deltaSeconds);

  if (!params.inRange || params.playerHealth <= 0) {
    return {
      playerHealth: params.playerHealth,
      attackCooldown: cooledDown,
      attacked: false,
      gameOver: params.playerHealth <= 0
    };
  }

  if (cooledDown > 0) {
    return {
      playerHealth: params.playerHealth,
      attackCooldown: cooledDown,
      attacked: false,
      gameOver: false
    };
  }

  const playerHealth = Math.max(0, params.playerHealth - attackDamage);

  return {
    playerHealth,
    attackCooldown: attackInterval,
    attacked: true,
    gameOver: playerHealth === 0
  };
}
