import { App, Modal, Notice, Setting } from "obsidian";
import type RPGLevelsPlugin from "./main"; // ajuste se o nome for diferente

export class Lvl20ShopModal extends Modal {
  plugin: RPGLevelsPlugin;

  constructor(app: App, plugin: RPGLevelsPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Lvl 20 Shop" });

    const level = this.plugin.settings.level;
    const xp = this.plugin.settings.currentXP;

    if (level < 20) {
      contentEl.createEl("p", {
        text: "Você precisa estar no nível 20 ou superior para acessar esta loja.",
      });
      return;
    }

    const possiblePurchases = Math.floor(xp / 200000);
    contentEl.createEl("p", {
      text: `XP atual: ${xp.toLocaleString()} | Feat Points possíveis de comprar: ${possiblePurchases}`,
    });

    new Setting(contentEl)
      .setName("Buy 1 Feat Point")
      .setDesc("200.000 XP")
      .addButton(btn => {
        btn.setButtonText("Buy")
          .setCta()
          .setDisabled(possiblePurchases <= 0)
          .onClick(async () => {
            if (this.plugin.settings.currentXP < 200000) {
              new Notice("XP insuficiente.");
              return;
            }

            this.plugin.settings.currentXP -= 200000;
            this.plugin.settings.extraFeatPointsGranted += 1;
            await this.plugin.applyAllPassiveEffects();
            await this.plugin.saveSettings();
            new Notice("+ 1 Feat Point!");
            this.close();
          });
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}
