// DamageModal.ts
import { App, Modal, Notice } from "obsidian";
import RPGLevelsPlugin from "./main"; 



export class DamageModal extends Modal {
  plugin: RPGLevelsPlugin;

  constructor(app: App, plugin: RPGLevelsPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "⚔️ Aplicar Dano / Cura" });

    const health = this.plugin.settings.health;
    const status = contentEl.createEl("p", {
      text: `❤️ HP Atual: ${health.currentHP}/${health.maxHP} | 🧪 Temp HP: ${health.tempHP}`
    });

    const input = contentEl.createEl("input", { type: "text", placeholder: "Ex: 2d6+3 ou 10" });

    const buttonRow = contentEl.createDiv({ cls: "button-row" });
    const applyButton = buttonRow.createEl("button", { text: "⚔️ Causar Dano" });
    const healButton = buttonRow.createEl("button", { text: "💊 Curar" });
    const fullHealButton = buttonRow.createEl("button", { text: "🔁 Curar totalmente" });

    const effectSection = contentEl.createEl("div", { cls: "effect-section" });
    effectSection.createEl("h3", { text: "✨ Aplicar Efeito" });

    const effectInput = effectSection.createEl("textarea", {
      placeholder: "JSON do efeito temporário ou permanente"
    });

    const applyEffectButton = effectSection.createEl("button", { text: "✨ Aplicar Efeito" });


    fullHealButton.onclick = async () => {
      const healed = this.plugin.settings.health.maxHP - this.plugin.settings.health.currentHP;
      this.plugin.settings.health.currentHP = this.plugin.settings.health.maxHP;
      await this.plugin.saveSettings();
      new Notice(`Curado totalmente (${healed} HP).`);
      this.close();
    };

    applyEffectButton.onclick = async () => {
      try {
        const effect = JSON.parse(effectInput.value);

        if (!effect.notePath || typeof effect.notePath !== "string") {
          throw new Error("Efeito precisa de um 'notePath'.");
        }

        const id = Date.now().toString();
        this.plugin.settings.effects[id] = {
          active: true,
          ...effect,
        };
        await this.plugin.saveSettings();
        new Notice("✨ Efeito aplicado com sucesso.");
        this.close();
      } catch (e) {
        new Notice("Erro ao aplicar efeito: " + e.message);
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Para uso externo (por comandos ou plugins)
export function openDamageModal(app: App, plugin: RPGLevelsPlugin) {
  new DamageModal(app, plugin).open();
}

// Comando para registrar no plugin
export function registerDamageCommand(plugin: RPGLevelsPlugin) {
  plugin.addCommand({
    id: "abrir-dano",
    name: "Abrir Gerenciador de Dano",
    callback: () => openDamageModal(plugin.app, plugin)
  });
}

// Utilitário para botão embutido
export function createDamageButton(container: HTMLElement, plugin: RPGLevelsPlugin) {
  container.createEl("button", {
    text: "⚔️ Dano & Cura",
    cls: "damage-button"
  }).onclick = () => {
    openDamageModal(plugin.app, plugin);
  };
}
