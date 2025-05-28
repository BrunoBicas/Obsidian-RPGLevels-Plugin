// damage.ts
import RPGLevelsPlugin from './main';
import { Dice } from "./dice"; // se já existir suporte

export interface DamageResult {
  amount: number;
  absorbed: number;
  remaining: number;
}

export interface HealingResult {
  amount: number;
  healed: number;
}

export function applyDamage(plugin: RPGLevelsPlugin, amount: number): DamageResult {
  const health = plugin.settings.health;
  let remaining = amount;
  let absorbed = 0;

  // Usar tempHP primeiro
  if (health.tempHP > 0) {
    const used = Math.min(health.tempHP, remaining);
    health.tempHP -= used;
    remaining -= used;
    absorbed = used;
  }

  // Depois tirar de currentHP
  health.currentHP = Math.max(0, health.currentHP - remaining);

  const result: DamageResult = {
    amount,
    absorbed,
    remaining: amount - absorbed - (health.currentHP < remaining ? remaining - health.currentHP : 0)
  };

  recordDamageEvent(plugin, {
    type: "dano",
    date: new Date().toISOString().split("T")[0],
    amount,
    absorbed
  });

  plugin.saveSettings();
  return result;
}

export function applyHealing(plugin: RPGLevelsPlugin, amount: number): HealingResult {
  const health = plugin.settings.health;
  const healed = Math.min(amount, health.maxHP - health.currentHP);
  health.currentHP += healed;

  recordDamageEvent(plugin, {
    type: "cura",
    date: new Date().toISOString().split("T")[0],
    amount,
    healed
  });

  plugin.saveSettings();
  return {
    amount,
    healed
  };
}

export function recordDamageEvent(
  plugin: RPGLevelsPlugin,
  entry: {
    type: "dano" | "cura";
    date: string;
    amount: number;
    absorbed?: number;
    healed?: number;
  }
) {
  const log = plugin.settings.damageLog ??= { dano: [], cura: [] };
  log[entry.type].push(entry);
}
