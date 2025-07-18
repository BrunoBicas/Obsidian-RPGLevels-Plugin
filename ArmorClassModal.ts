import { App, Modal } from "obsidian";
import RPGLevelsPlugin from "./main";

export class ArmorClassModal extends Modal {
  plugin: RPGLevelsPlugin;

  constructor(app: App, plugin: RPGLevelsPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    const ac = this.plugin.settings.armorClass;
    const modName = ac.modifierAbility || "Nenhum";

    const modValue = ac.modifierAbility
      ? this.plugin.getAbilityModifier(this.plugin.settings.characterStats[ac.modifierAbility])
      : 0;

    const totalAC = this.plugin.getCurrentAC();

    contentEl.empty();
    contentEl.createEl("h2", { text: "Classe de Armadura (AC)" });

    contentEl.createEl("p", { text: `AC Total: ${totalAC}` });

    const list = contentEl.createEl("ul");
    list.createEl("li", { text: `Base: ${ac.base}` });
    list.createEl("li", { text: `Modificador (${modName}): ${modValue}` });
    list.createEl("li", { text: `Bônus adicional: ${ac.bonus}` });

    contentEl.createEl("h3", { text: "Fontes:" });
    if (ac.sources.length === 0) {
      contentEl.createEl("p", { text: "Nenhuma fonte registrada." });
    } else {
      const ul = contentEl.createEl("ul");
      ac.sources.forEach((source) => {
        ul.createEl("li", { text: source });
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
