import { describe, expect, it } from "vitest";

import {
  applyBulletDamage,
  createInitialCombatHudState,
  tickZombieAttack
} from "./combat";

describe("combat rules", () => {
  it("starts each run with a 10 zombie wave", () => {
    expect(createInitialCombatHudState().zombiesRemaining).toBe(10);
  });

  it("kills a zombie in one bullet hit and awards score once", () => {
    let health = 10;
    let score = 0;
    const result = applyBulletDamage(health, 10);
    health = result.nextHealth;
    score += result.scoreDelta;

    expect(health).toBe(0);
    expect(result.killed).toBe(true);
    expect(score).toBe(100);

    const extraHit = applyBulletDamage(health, 10);
    expect(extraHit.killed).toBe(false);
    expect(extraHit.scoreDelta).toBe(0);
  });

  it("prevents zombie melee spam faster than every two seconds", () => {
    let playerHealth = 100;
    let attackCooldown = 0;

    const firstAttack = tickZombieAttack({
      playerHealth,
      attackCooldown,
      inRange: true,
      deltaSeconds: 0.1
    });

    playerHealth = firstAttack.playerHealth;
    attackCooldown = firstAttack.attackCooldown;

    expect(firstAttack.attacked).toBe(true);
    expect(playerHealth).toBe(90);

    const secondTick = tickZombieAttack({
      playerHealth,
      attackCooldown,
      inRange: true,
      deltaSeconds: 1.0
    });

    expect(secondTick.attacked).toBe(false);
    expect(secondTick.playerHealth).toBe(90);

    const thirdTick = tickZombieAttack({
      playerHealth: secondTick.playerHealth,
      attackCooldown: secondTick.attackCooldown,
      inRange: true,
      deltaSeconds: 1.0
    });

    expect(thirdTick.attacked).toBe(true);
    expect(thirdTick.playerHealth).toBe(80);
  });

  it("marks game over when player health reaches zero", () => {
    const state = createInitialCombatHudState();
    const lethalAttack = tickZombieAttack({
      playerHealth: state.playerHealth,
      attackCooldown: 0,
      inRange: true,
      deltaSeconds: 0.1,
      attackDamage: 100
    });

    expect(lethalAttack.playerHealth).toBe(0);
    expect(lethalAttack.gameOver).toBe(true);
  });
});
