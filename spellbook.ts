import { 
	App, 
	Plugin, 
	PluginSettingTab, 
	Setting, 
	WorkspaceLeaf, 
	View,
  TFile, 
	ItemView,
  Notice
} from 'obsidian';

const SPELLBOOK_VIEW_TYPE = 'dnd-spellbook-view';
const KNOWN_SPELLS_VIEW_TYPE = 'dnd-known-spells-view';
const UNKNOWN_SPELLS_VIEW_TYPE = 'dnd-unknown-spells-view';


interface SpellSlot {
  level: number;
  total: number;
  used: number;
  source?: string;
  autoScanned?: boolean; // Added for bonus slots auto-scan
}

interface BonusSpellSlotYAML {
  level: number;
  slots: number;
  source: string;
}


const CANTRIPS_KNOWN_BY_CLASS_LEVEL: { [key: string]: { level: number; cantrips: number; }[] } = {
  'Wizard': [ { level: 1, cantrips: 3 }, { level: 4, cantrips: 4 }, { level: 10, cantrips: 5 } ],
  'Sorcerer': [ { level: 1, cantrips: 4 }, { level: 4, cantrips: 5 }, { level: 10, cantrips: 6 } ],
  'Cleric': [ { level: 1, cantrips: 3 }, { level: 4, cantrips: 4 }, { level: 10, cantrips: 5 } ],
  // Adicione outras classes aqui
};

function getCantripsKnownCount(characterClass: string, level: number): number {
  const className = characterClass ? characterClass.charAt(0).toUpperCase() + characterClass.slice(1).toLowerCase() : '';
  const progression = CANTRIPS_KNOWN_BY_CLASS_LEVEL[className];
  if (!progression) return 0;
  
  let count = 0;
  for (const entry of progression) {
    if (level >= entry.level) {
      count = entry.cantrips;
    } else {
      break;
    }
  }
  return count;
}

function getCantripsKnownCountWithBonus(characterClass: string, level: number, bonuses: SpellBonuses[]): number {
  const baseCantrips = getCantripsKnownCount(characterClass, level);
  const totalBonus = bonuses.reduce((sum, bonus) => sum + (bonus.bonusCantrips || 0), 0);
  return baseCantrips + totalBonus;
}

function getPreparedSpellsMaxCountWithBonus(intModifier: number, charLevel: number, bonuses: SpellBonuses[]): number {
  const baseSpells = getPreparedSpellsMaxCount(intModifier, charLevel);
  const totalBonus = bonuses.reduce((sum, bonus) => sum + (bonus.bonusPreparedSpells || 0), 0);
  return baseSpells + totalBonus;
}

function getPreparedSpellsMaxCount(intModifier: number, charLevel: number): number {
  const count = intModifier + charLevel;
  return Math.max(1, count); 
}

function generateUniqueSpellId(): string {
  return `spell_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function countNonBonusPreparedSpells(knownSpells: Spell[], bonusPreparedSpells: BonusPreparedSpell[], level?: number): number {
  // Filtrar spells preparados por nível (se especificado)
  let spellsToCount = knownSpells.filter(spell => {
    if (level !== undefined && spell.level !== level) return false;
    return spell.isPrepared;
  });
  
  // Remover da contagem os que estão usando bônus ativo
  const activeBonusSpells = bonusPreparedSpells
    .filter(bonus => bonus.isActive)
    .map(bonus => bonus.spellName.toLowerCase());
  
  spellsToCount = spellsToCount.filter(spell => 
    !activeBonusSpells.includes(spell.name.toLowerCase())
  );
  
  console.log(`📊 Contagem de spells preparados (nível ${level ?? 'todos'}):`, {
    totalPrepared: knownSpells.filter(s => level === undefined ? s.isPrepared : (s.level === level && s.isPrepared)).length,
    usingBonus: activeBonusSpells.length,
    countingTowardLimit: spellsToCount.length
  });
  
  return spellsToCount.length;
}

interface BonusPreparedSpell {
  spellName: string;
  source: string;
  isActive: boolean; 
}

interface SpellBonuses {
  bonusCantrips?: number;
  bonusPreparedSpells?: number;
  source?: string;
}

interface DnDSpellbookSettings {
  characterClass: string;
  characterLevel: number;
  intelligenceModifier: number;
  spellSlots: SpellSlot[];
  bonusSpellSlots: SpellSlot[];
  knownSpells: Spell[];
  unknownSpells: Spell[];
  defaultSpellFolder?: string;
  importSpellsFromNotes: boolean;
  spellFolderPath: string;
  extraSpellUses: ExtraSpellUse[];
  cantripFolderPath: string;
  level1FolderPath: string;
  level2FolderPath: string;
  level3FolderPath: string;
  level4FolderPath: string;
  level5FolderPath: string;
  level6FolderPath: string;
  level7FolderPath: string;
  level8FolderPath: string;
  level9FolderPath: string;
  spellBonuses: SpellBonuses[];
  bonusPreparedSpells: BonusPreparedSpell[];
}

interface Spell {
	id: string;
	name: string;
	level: number;
	description: string;
  isPrepared: boolean; 
  path?: string;
}
interface ExtraSpellUse {
  spellName: string;
  uses: number;
  usesRemaining: number;
  source?: string;
}

const DEFAULT_SETTINGS: DnDSpellbookSettings = {
	characterClass: 'wizard',
	characterLevel: 1,
  intelligenceModifier: 0,
	spellSlots: [
		{ level: 1, total: 2, used: 0 },
		{ level: 2, total: 0, used: 0 },
		{ level: 3, total: 0, used: 0 },
		{ level: 4, total: 0, used: 0 },
		{ level: 5, total: 0, used: 0 },
    { level: 6, total: 0, used: 0 },
    { level: 7, total: 0, used: 0 },
    { level: 8, total: 0, used: 0 },
    { level: 9, total: 0, used: 0 }
	],
  defaultSpellFolder: 'Spells',
	knownSpells: [],
  unknownSpells: [],
  importSpellsFromNotes: false,
  spellFolderPath: '',
  extraSpellUses: [],
  cantripFolderPath: '',
  level1FolderPath: '',
  level2FolderPath: '',
  level3FolderPath: '',
  level4FolderPath: '',
  level5FolderPath: '',
  level6FolderPath: '',
  level7FolderPath: '',
  level8FolderPath: '',
  level9FolderPath: '',
  bonusSpellSlots: [],
  spellBonuses: [],
  bonusPreparedSpells: []
};

// Function to calculate spell slots based on class and level
function calculateSpellSlots(characterClass: string, level: number, bonusSlots: SpellSlot[]): SpellSlot[] {
  const slots: SpellSlot[] = [
    { level: 1, total: 0, used: 0 },
    { level: 2, total: 0, used: 0 },
    { level: 3, total: 0, used: 0 },
    { level: 4, total: 0, used: 0 },
    { level: 5, total: 0, used: 0 },
    { level: 6, total: 0, used: 0 },
    { level: 7, total: 0, used: 0 },
    { level: 8, total: 0, used: 0 },
    { level: 9, total: 0, used: 0 }
  ];

  // Full casters: wizard, cleric, druid
  if (characterClass === 'wizard' || characterClass === 'cleric' || characterClass === 'druid') {
    // Level 1
    if (level >= 1) {
      slots[0].total = 2;
    }
    // Level 2
    if (level >= 2) {
      slots[0].total = 3;
    }
    // Level 3
    if (level >= 3) {
      slots[0].total = 4;
      slots[1].total = 2;
    }
    // Level 4
    if (level >= 4) {
      slots[0].total = 4;
      slots[1].total = 3;
    }
    // Level 5
    if (level >= 5) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 2;
    }
    // Level 6
    if (level >= 6) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
    }
    // Level 7
    if (level >= 7) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 1;
    }
    // Level 8
    if (level >= 8) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 2;
    }
    // Level 9
    if (level >= 9) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 1;
    }
    // Level 10
    if (level >= 10) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 2;
    }
    // Level 11
    if (level >= 11) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 2;
      slots[5].total = 1;
    }
    // Level 12
    if (level >= 12) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 2;
      slots[5].total = 1;
    }
    // Level 13
    if (level >= 13) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 2;
      slots[5].total = 1;
      slots[6].total = 1;
    }
    // Level 14
    if (level >= 14) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 2;
      slots[5].total = 1;
      slots[6].total = 1;
    }
    // Level 15
    if (level >= 15) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 2;
      slots[5].total = 1;
      slots[6].total = 1;
      slots[7].total = 1;
    }
    // Level 16
    if (level >= 16) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 2;
      slots[5].total = 1;
      slots[6].total = 1;
      slots[7].total = 1;
    }
    // Level 17
    if (level >= 17) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 2;
      slots[5].total = 1;
      slots[6].total = 1;
      slots[7].total = 1;
      slots[8].total = 1;
    }
    // Level 18
    if (level >= 18) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 3;
      slots[5].total = 1;
      slots[6].total = 1;
      slots[7].total = 1;
      slots[8].total = 1;
    }
    // Level 19
    if (level >= 19) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 3;
      slots[5].total = 2;
      slots[6].total = 1;
      slots[7].total = 1;
      slots[8].total = 1;
    }
    // Level 20
    if (level >= 20) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 3;
      slots[5].total = 2;
      slots[6].total = 2;
      slots[7].total = 1;
      slots[8].total = 1;
    }
  }
  // Half casters: paladin, ranger
  else if (characterClass === 'paladin' || characterClass === 'ranger') {
    // Half casters start getting spell slots at level 2
    if (level >= 2) {
      slots[0].total = 2;
    }
    if (level >= 3) {
      slots[0].total = 3;
    }
    if (level >= 5) {
      slots[0].total = 4;
      slots[1].total = 2;
    }
    if (level >= 7) {
      slots[0].total = 4;
      slots[1].total = 3;
    }
    if (level >= 9) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 2;
    }
    if (level >= 11) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
    }
    if (level >= 13) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 1;
    }
    if (level >= 15) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 2;
    }
    if (level >= 17) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 1;
    }
    if (level >= 19) {
      slots[0].total = 4;
      slots[1].total = 3;
      slots[2].total = 3;
      slots[3].total = 3;
      slots[4].total = 2;
    }
  }
  bonusSlots.forEach(bonus => {
    const slotIndex = slots.findIndex(s => s.level === bonus.level);
    if (slotIndex >= 0) {
      slots[slotIndex].total += bonus.total;
    }
  });

  return slots;
}

class SpellbookView extends ItemView {
	plugin: DnDSpellbookPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: DnDSpellbookPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return SPELLBOOK_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "D&D Spellbook";
	}

	getIcon(): string {
		return "book";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.createDiv({ 
		  cls: 'dnd-spellbook-container modern-spellbook-layout' 
		});
		
		// Close button
		const closeButton = container.createEl('button', {
		  text: '✕ Close',
		  cls: 'close-spellbook-btn'
		});
		closeButton.addEventListener('click', () => {
		  this.app.workspace.detachLeavesOfType(SPELLBOOK_VIEW_TYPE);
		});
		
		// Navigation buttons
		const navButtons = container.createDiv({ cls: 'spellbook-nav-buttons' });
		
		const knownSpellsBtn = navButtons.createEl('button', {
		  text: 'View Known Spells',
		  cls: 'nav-btn'
		});
		knownSpellsBtn.addEventListener('click', () => {
		  this.plugin.activateKnownSpellsView();
		});
		
		// Add scrollable content wrapper
		const scrollContainer = container.createDiv({
		  cls: 'spellbook-scroll-container'
		});
		scrollContainer.style.maxHeight = '70vh';
		scrollContainer.style.overflowY = 'auto';
		scrollContainer.style.paddingRight = '10px';
		
		// Character Info Section
		const charInfoSection = scrollContainer.createDiv({ cls: 'character-info' });
		charInfoSection.createEl('h2', { text: 'Character Information' });
		charInfoSection.createEl('p', { 
		  text: `Class: ${this.plugin.settings.characterClass} | Level: ${this.plugin.settings.characterLevel}` 
		});
		
		// Spell Count Summary
		const known = this.plugin.settings.knownSpells.length;
    const unknown = this.plugin.settings.unknownSpells.length;
    const preparedCantrips = countNonBonusPreparedSpells(this.plugin.settings.knownSpells, this.plugin.settings.bonusPreparedSpells, 0 );    
    const preparedSpells = countNonBonusPreparedSpells(this.plugin.settings.knownSpells.filter(s => s.level > 0), this.plugin.settings.bonusPreparedSpells);  
    const maxCantrips = getCantripsKnownCountWithBonus(this.plugin.settings.characterClass, this.plugin.settings.characterLevel, this.plugin.settings.spellBonuses);
    const maxPreparedSpells = getPreparedSpellsMaxCountWithBonus(this.plugin.settings.intelligenceModifier, this.plugin.settings.characterLevel, this.plugin.settings.spellBonuses);
    const activeBonusCantrips = this.plugin.settings.bonusPreparedSpells.filter(
        bonus => bonus.isActive && this.plugin.settings.knownSpells.some(
          spell => spell.name.toLowerCase() === bonus.spellName.toLowerCase() && spell.level === 0
        )
    ).length;
    const activeBonusSpells = this.plugin.settings.bonusPreparedSpells.filter(
      bonus => bonus.isActive && this.plugin.settings.knownSpells.some(
        spell => spell.name.toLowerCase() === bonus.spellName.toLowerCase() && spell.level > 0
      )
    ).length;

    charInfoSection.createEl('p', {
      text: `📘 Known: ${known} | ❓ Unknown: ${unknown} | Cantrips: ${preparedCantrips}/${maxCantrips} (+${activeBonusCantrips} bonus) ✅ Prepared: ${preparedSpells}/${maxPreparedSpells} (+${activeBonusSpells} bonus)`
    });

	  
		// Spell Slots Section
		const spellSlotsSection = scrollContainer.createDiv({ cls: 'spell-slots-section' });
		spellSlotsSection.createEl('h2', { text: 'Spell Slots' });
		
		this.plugin.settings.spellSlots.forEach(slot => {
		  if (slot.total > 0) {
			const slotDiv = spellSlotsSection.createDiv({ cls: 'spell-slot' });
			slotDiv.createEl('span', { 
			  text: `Level ${slot.level}: ${slot.total - slot.used}/${slot.total}` 
			});
			
			const useButton = slotDiv.createEl('button', { 
			  text: 'Use Slot',
			  cls: 'use-slot-btn'
			});
			
			useButton.addEventListener('click', () => {
			  this.plugin.useSpellSlot(slot.level);
			  this.refresh();
			});
			
			const restoreButton = slotDiv.createEl('button', {
			  text: 'Restore',
			  cls: 'restore-slot-btn'
			});
			
			restoreButton.addEventListener('click', () => {
			  this.plugin.restoreSpellSlot(slot.level);
			  this.refresh();
			});
		  }
		});
	  
		// Add a "Long Rest" button to restore all spell slots
		const longRestBtn = scrollContainer.createEl('button', {
		  text: '🌙 Long Rest (Restore All Slots)',
		  cls: 'long-rest-btn'
		});
		longRestBtn.addEventListener('click', () => {
		  this.plugin.restoreAllSpellSlots();
		  this.refresh();
		  new Notice('All spell slots restored after a long rest!');
		});
	  
		// Add Spell Button
		const addSpellBtn = scrollContainer.createEl('button', { 
		  text: '+ Add New Spell',
		  cls: 'add-spell-btn'
		});
		addSpellBtn.addEventListener('click', () => this.openAddSpellModal());

		// ✅ BARRA DE PESQUISA PARA MAGIAS PREPARADAS
		const searchContainer = scrollContainer.createDiv({ cls: 'search-container' });
		searchContainer.createEl('label', { text: 'Search prepared spells: ' });
		const searchInput = searchContainer.createEl('input', {
		  type: 'text',
		  placeholder: 'Type spell name or description...',
		  cls: 'spell-search-input'
		});
		
		// ✅ FILTRO PARA MAGIAS PREPARADAS
		const filterContainer = scrollContainer.createDiv({ cls: 'filter-container' });
		filterContainer.createEl('label', { text: 'Level: ' });
		const levelFilter = filterContainer.createEl('select');
		levelFilter.createEl('option', { text: 'All Levels', value: 'all' });
		levelFilter.createEl('option', { text: 'Cantrips (Level 0)', value: '0' });
		[1,2,3,4,5,6,7,8,9].forEach(level => {
		  levelFilter.createEl('option', { 
			text: `Level ${level}`, 
			value: level.toString() 
		  });
		});
	  
		// Prepared Spells Section
		const preparedSpellsSection = scrollContainer.createDiv({ cls: 'prepared-spells-section' });
		const preparedCount = this.plugin.settings.knownSpells.filter(spell => spell.isPrepared).length;
    preparedSpellsSection.createEl('h2', { 
      text: `Prepared Cantrips: ${preparedCantrips}/${maxCantrips}\nPrepared Spells (${preparedSpells}/${maxPreparedSpells})` 
    });

		
		// ✅ FUNÇÃO PARA RENDERIZAR MAGIAS PREPARADAS COM FILTROS
		const renderFilteredPreparedSpells = (searchTerm: string = '', levelFilter: string = 'all') => {
		  const preparedSpells = this.plugin.settings.knownSpells.filter(spell => spell.isPrepared);
		  let filteredSpells = [...preparedSpells];
		  
		  // Apply search filter
		  if (searchTerm.trim()) {
			filteredSpells = filteredSpells.filter(spell => 
			  spell.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
			  spell.description.toLowerCase().includes(searchTerm.toLowerCase())
			);
		  }
		  
		  // Apply level filter
		  if (levelFilter !== 'all') {
			const levelNum = parseInt(levelFilter);
			filteredSpells = filteredSpells.filter(spell => spell.level === levelNum);
		  }
		  
		  this.renderPreparedSpells(preparedSpellsSection, filteredSpells, searchTerm, levelFilter);
		};
		
		// Initial render
		renderFilteredPreparedSpells();
		
		// ✅ EVENT LISTENERS
		searchInput.addEventListener('input', () => {
		  renderFilteredPreparedSpells(searchInput.value, levelFilter.value);
		});
		
		levelFilter.addEventListener('change', () => {
		  renderFilteredPreparedSpells(searchInput.value, levelFilter.value);
		});
	}

	// ✅ MÉTODO RENDERIZAÇÃO ATUALIZADO COM MENSAGENS CONTEXTUAIS
	renderPreparedSpells(container: HTMLElement, spells?: Spell[], searchTerm: string = '', levelFilter: string = 'all') {
		// Clear previous content but keep the header
		const existingContent = container.querySelectorAll('.spell-card, .no-spells-message, .prepared-level-section');
		existingContent.forEach(el => el.remove());

		// Use provided spells or get all prepared spells
		const preparedSpells = spells || this.plugin.settings.knownSpells.filter(spell => spell.isPrepared);
		
		if (preparedSpells.length === 0) {
			let message;
			
			if (searchTerm.trim()) {
				message = `No prepared spells found matching "${searchTerm}"`;
				if (levelFilter !== 'all') {
					message += ` in ${levelFilter === '0' ? 'cantrips' : `level ${levelFilter}`}`;
				}
				message += '.';
			} else if (levelFilter !== 'all') {
				const levelText = levelFilter === '0' ? 'cantrips' : `level ${levelFilter} spells`;
				message = `No prepared ${levelText} found.`;
			} else {
				message = 'No spells prepared yet. Prepare spells from your Known Spells list.';
			}
			
			container.createEl('p', { text: message, cls: 'no-spells-message' });
			return;
		}

		// Group by level for better organization
		const spellsByLevel: {[key: number]: Spell[]} = {};
		preparedSpells.forEach(spell => {
			if (!spellsByLevel[spell.level]) {
				spellsByLevel[spell.level] = [];
			}
			spellsByLevel[spell.level].push(spell);
		});

		// Render each level group
		Object.keys(spellsByLevel).sort((a, b) => parseInt(a) - parseInt(b)).forEach(level => {
			const levelNum = parseInt(level);
			const levelSpells = spellsByLevel[levelNum];
			
			if (levelSpells.length > 0) {
				const levelHeading = levelNum === 0 ? 'Prepared Cantrips' : `Prepared Level ${levelNum} Spells`;
				const levelSection = container.createDiv({ cls: 'prepared-level-section' });
				levelSection.createEl('h4', { text: `${levelHeading} (${levelSpells.length})` });

				levelSpells.forEach(spell => {
					const spellDiv = levelSection.createDiv({ cls: 'spell-card prepared' });
					
					// Spell Name and Level
					spellDiv.createEl('h3', { 
						text: `${spell.name} (${spell.level === 0 ? 'Cantrip' : `Level ${spell.level}`})`,
						cls: 'spell-name'
					});

          const bonusPrepared = this.plugin.settings.bonusPreparedSpells.find(
            bonus => bonus.spellName.toLowerCase() === spell.name.toLowerCase() && bonus.isActive
          );

          if (bonusPrepared) {
            // Adiciona um badge visual indicando que é bônus
            const bonusBadge = spellDiv.createDiv({ cls: 'bonus-prepared-badge' });
            bonusBadge.createEl('span', { 
              text: `✨ Bonus from ${bonusPrepared.source}`,
              cls: 'bonus-badge-text'
            });
            bonusBadge.setAttribute('title', `This spell is prepared as a bonus and doesn't count toward your limit`);
          }
                  
					// Add extra spell uses badge if available
					const extraUse = this.plugin.settings.extraSpellUses.find(
						e => e.spellName.toLowerCase() === spell.name.toLowerCase() && e.usesRemaining > 0
					);
					if (extraUse) {
						const extraUsesBadge = spellDiv.createDiv({ cls: 'extra-uses-badge' });
						extraUsesBadge.createEl('span', { 
							text: `+${extraUse.usesRemaining} free uses` 
						});
						extraUsesBadge.setAttribute('title', `Extra uses from ${extraUse.source || 'unknown'}`);
					}

					// Description toggle container
					const descriptionContainer = spellDiv.createDiv({ cls: 'spell-description-container' });
					const descriptionToggle = descriptionContainer.createEl('button', {
						text: 'Show Description',
						cls: 'description-toggle'
					});
					const descriptionDiv = descriptionContainer.createDiv({ 
						cls: 'spell-description hidden' 
					});
					descriptionDiv.createEl('p', { text: spell.description });

					descriptionToggle.addEventListener('click', () => {
						if (descriptionDiv.classList.contains('hidden')) {
							descriptionDiv.classList.remove('hidden');
							descriptionToggle.textContent = 'Hide Description';
						} else {
							descriptionDiv.classList.add('hidden');
							descriptionToggle.textContent = 'Show Description';
						}
					});

					// Button container
					const buttonContainer = spellDiv.createDiv({ cls: 'spell-buttons' });

					// Unprepare Button
					const unprepareBtn = buttonContainer.createEl('button', {
						text: 'Unprepare',
						cls: 'unprepare-btn'
					});
					unprepareBtn.addEventListener('click', () => {
						this.plugin.toggleSpellPreparation(spell.id);
						this.refresh();
					});
					
					const castBtn = buttonContainer.createEl('button', {
						text: 'Cast',
						cls: 'cast-spell-btn'
					});
					castBtn.addEventListener('click', () => {
						this.plugin.castSpell(spell);
						this.refresh();
					});
				});
			}
		});
	}

	openAddSpellModal() {
		const modalContainer = this.containerEl.createDiv({ cls: 'add-spell-modal' });
		modalContainer.createEl('h2', { text: 'Add New Spell' });

		const form = modalContainer.createEl('form');
		
		// Name Input
		form.createEl('label', { text: 'Spell Name' });
		const nameInput = form.createEl('input', { type: 'text' });
		
		// Level Input
		form.createEl('label', { text: 'Spell Level' });
		const levelInput = form.createEl('select');
		[0,1,2,3,4,5,6,7,8,9].forEach(level => {
			levelInput.createEl('option', { 
				text: level === 0 ? 'Cantrip' : `Level ${level}`, 
				value: level.toString() 
			});
		});

		// Description Input
		form.createEl('label', { text: 'Description' });
		const descInput = form.createEl('textarea');

		// Submit Button
		const submitBtn = form.createEl('button', { text: 'Add Spell' });
		submitBtn.addEventListener('click', (e) => {
			e.preventDefault();
			this.plugin.addSpell({
				id: generateUniqueSpellId(),
				name: nameInput.value,
				level: parseInt(levelInput.value),
				description: descInput.value,
				isPrepared: false
			});
			modalContainer.remove();
			this.refresh();
		});
		
		// Cancel Button
		const cancelBtn = form.createEl('button', { 
			text: 'Cancel',
			cls: 'cancel-btn' 
		});
		cancelBtn.addEventListener('click', (e) => {
			e.preventDefault();
			modalContainer.remove();
		});
	}

	async onClose(): Promise<void> {
		this.containerEl.empty();
	}

	refresh() {
		// First make sure settings are saved
		this.plugin.saveSettings();
		
		// Do a complete refresh like the KnownSpellsView does
		this.containerEl.empty();
		this.onOpen();
	}
}

class KnownSpellsView extends ItemView {
  plugin: DnDSpellbookPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: DnDSpellbookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return KNOWN_SPELLS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "D&D Known Spells";
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.createDiv({ 
      cls: 'known-spells-container modern-spellbook-layout' 
    });
    
    // Add scrollable content wrapper
    const scrollContainer = container.createDiv({
      cls: 'spellbook-scroll-container'
    });
    
    // Add some basic CSS to enable scrolling
    scrollContainer.style.maxHeight = '70vh';
    scrollContainer.style.overflowY = 'auto';
    scrollContainer.style.paddingRight = '10px';
    
    // Header
    const known = this.plugin.settings.knownSpells.length;
    const preparedCantrips = this.plugin.settings.knownSpells.filter(s => s.level === 0 && s.isPrepared).length; // MUDANÇA: só cantrips preparados
    const preparedSpells = this.plugin.settings.knownSpells.filter(s => s.level > 0 && s.isPrepared).length;
    const maxCantrips = getCantripsKnownCountWithBonus(this.plugin.settings.characterClass, this.plugin.settings.characterLevel, this.plugin.settings.spellBonuses);
    const maxPreparedSpells = getPreparedSpellsMaxCountWithBonus(this.plugin.settings.intelligenceModifier, this.plugin.settings.characterLevel, this.plugin.settings.spellBonuses);

    scrollContainer.createEl('p', {
      text: `Cantrips: ${preparedCantrips}/${maxCantrips}\n✅ Prepared: ${preparedSpells}/${maxPreparedSpells} | 📘 Total Known Spells: ${known}`
    });
    
    // Close button
    const closeButton = container.createEl('button', {
      text: '✕ Close',
      cls: 'close-spellbook-btn'
    });
    closeButton.addEventListener('click', () => {
      this.app.workspace.detachLeavesOfType(KNOWN_SPELLS_VIEW_TYPE);
    });
    
    // Navigation button to main spellbook
    const navButtons = container.createDiv({ cls: 'spellbook-nav-buttons' });
    
    const spellbookBtn = navButtons.createEl('button', {
      text: 'Back to Spellbook',
      cls: 'nav-btn'
    });
    spellbookBtn.addEventListener('click', () => {
      this.app.workspace.detachLeavesOfType(KNOWN_SPELLS_VIEW_TYPE);
      this.plugin.activateView();
    });
    
    // Add spell button
    const addSpellBtn = scrollContainer.createEl('button', { 
      text: '+ Add New Spell',
      cls: 'add-spell-btn'
    });

    //View Unknown Spells
    addSpellBtn.addEventListener('click', () => this.openAddSpellModal());
    const unknownSpellsBtn = navButtons.createEl('button', {
      text: 'View Unknown Spells',
      cls: 'nav-btn'
    });
    unknownSpellsBtn.addEventListener('click', () => {
      this.plugin.activateUnknownSpellsView();
    });
    
    // ✅ BARRA DE PESQUISA
    const searchContainer = scrollContainer.createDiv({ cls: 'search-container' });
    searchContainer.createEl('label', { text: 'Search spells: ' });
    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Type spell name or description...',
      cls: 'spell-search-input'
    });
    
    // Filter controls
    const filterContainer = scrollContainer.createDiv({ cls: 'filter-container' });
    
    filterContainer.createEl('label', { text: 'Level: ' });
    const levelFilter = filterContainer.createEl('select');
    levelFilter.createEl('option', { text: 'All Levels', value: 'all' });
    levelFilter.createEl('option', { text: 'Cantrips (Level 0)', value: '0' });
    [1,2,3,4,5,6,7,8,9].forEach(level => {
      levelFilter.createEl('option', { 
        text: `Level ${level}`, 
        value: level.toString() 
      });
    });
    
    // ✅ FILTRO DE PREPARAÇÃO
    filterContainer.createEl('label', { text: 'Status: ' });
    const preparedFilter = filterContainer.createEl('select');
    preparedFilter.createEl('option', { text: 'All Spells', value: 'all' });
    preparedFilter.createEl('option', { text: 'Prepared Only', value: 'prepared' });
    preparedFilter.createEl('option', { text: 'Unprepared Only', value: 'unprepared' });
    
    // Sort function for spells
    const sortByLevelName = (a: Spell, b: Spell) => {
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      return a.name.localeCompare(b.name);
    };
    
    // ✅ FUNÇÃO DE RENDERIZAÇÃO COM FILTROS
    const renderFilteredSpells = (searchTerm: string = '', levelFilter: string = 'all', preparedFilter: string = 'all') => {
      let filteredSpells = [...this.plugin.settings.knownSpells];
      
      // Apply search filter
      if (searchTerm.trim()) {
        filteredSpells = filteredSpells.filter(spell => 
          spell.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          spell.description.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }
      
      // Apply level filter
      if (levelFilter !== 'all') {
        const levelNum = parseInt(levelFilter);
        filteredSpells = filteredSpells.filter(spell => spell.level === levelNum);
      }
      
      // Apply preparation filter
      if (preparedFilter === 'prepared') {
        filteredSpells = filteredSpells.filter(spell => spell.isPrepared);
      } else if (preparedFilter === 'unprepared') {
        filteredSpells = filteredSpells.filter(spell => !spell.isPrepared);
      }
      
      // Re-render with filtered list
      const spellsContainer = scrollContainer.querySelector('.spells-list-container');
      if (spellsContainer) {
        spellsContainer.remove();
      }
      
      this.renderSpells(scrollContainer, filteredSpells.sort(sortByLevelName), searchTerm, levelFilter, preparedFilter);
    };
    
    // Render all spells initially
    renderFilteredSpells();
    
    // ✅ EVENT LISTENERS
    searchInput.addEventListener('input', () => {
      renderFilteredSpells(searchInput.value, levelFilter.value, preparedFilter.value);
    });
    
    levelFilter.addEventListener('change', () => {
      renderFilteredSpells(searchInput.value, levelFilter.value, preparedFilter.value);
    });
    
    preparedFilter.addEventListener('change', () => {
      renderFilteredSpells(searchInput.value, levelFilter.value, preparedFilter.value);
    });
  }
  
  // ✅ RENDERIZAÇÃO COM MENSAGENS CONTEXTUAIS
  renderSpells(container: HTMLElement, spells: Spell[], searchTerm: string = '', levelFilter: string = 'all', preparedFilter: string = 'all') {
    // Create a dedicated container for the spells list
    const spellsContainer = container.createDiv({ cls: 'spells-list-container' });
    
    if (spells.length === 0) {
      const noSpellsDiv = spellsContainer.createDiv({ cls: 'no-spells-message' });
      let message;
      
      if (searchTerm.trim()) {
        message = `No spells found matching "${searchTerm}"`;
        if (levelFilter !== 'all') {
          message += ` in ${levelFilter === '0' ? 'cantrips' : `level ${levelFilter}`}`;
        }
        if (preparedFilter !== 'all') {
          message += ` (${preparedFilter} only)`;
        }
        message += '.';
      } else if (levelFilter !== 'all' || preparedFilter !== 'all') {
        const levelText = levelFilter === 'all' ? '' : (levelFilter === '0' ? 'cantrips' : `level ${levelFilter} spells`);
        const prepText = preparedFilter === 'all' ? '' : `${preparedFilter} `;
        message = `No ${prepText}${levelText} found.`.replace(/\s+/g, ' ').trim();
      } else {
        message = 'No spells found. Add some spells to your spellbook!';
      }
      
      noSpellsDiv.createEl('p', { text: message });
      return;
    }
    
    // Group spells by level
    const spellsByLevel: {[key: number]: Spell[]} = {};
    
    spells.forEach(spell => {
      if (!spellsByLevel[spell.level]) {
        spellsByLevel[spell.level] = [];
      }
      spellsByLevel[spell.level].push(spell);
    });
    
    // Render spells by level groups
    Object.keys(spellsByLevel).sort((a, b) => parseInt(a) - parseInt(b)).forEach(level => {
      const levelNum = parseInt(level);
      const levelSpells = spellsByLevel[levelNum];
      
      const levelHeading = levelNum === 0 ? 'Cantrips' : `Level ${levelNum} Spells`;
      const levelSection = spellsContainer.createDiv({ cls: 'spell-level-section' });
      levelSection.createEl('h3', { text: `${levelHeading} (${levelSpells.length})` });
      
      levelSpells.forEach(spell => {
        const spellDiv = levelSection.createDiv({ 
          cls: `spell-card ${spell.isPrepared ? 'prepared' : ''}` 
        });
        
        const headerDiv = spellDiv.createDiv({ cls: 'spell-header' });
        headerDiv.createEl('span', { 
          text: spell.name,
          cls: 'spell-name'
        });
        
        // ✅ INDICADOR DE STATUS
        const statusSpan = headerDiv.createEl('span', { 
          text: spell.isPrepared ? '✅ Prepared' : '⏸ Unprepared',
          cls: `spell-status ${spell.isPrepared ? 'prepared' : 'unprepared'}`
        });
              
        if (spell.isPrepared) {
          const bonusPrepared = this.plugin.settings.bonusPreparedSpells.find(
            bonus => bonus.spellName.toLowerCase() === spell.name.toLowerCase() && bonus.isActive
          );

          if (bonusPrepared) {
            const bonusBadge = spellDiv.createDiv({ cls: 'bonus-prepared-badge' });
            bonusBadge.createEl('span', { 
              text: `✨ Bonus from ${bonusPrepared.source}`,
              cls: 'bonus-badge-text'
            });
            bonusBadge.setAttribute('title', `This spell is prepared as a bonus and doesn't count toward your limit`);
          }
        }

        // Show extra uses badge if available
        const extraUse = this.plugin.settings.extraSpellUses.find(
          e => e.spellName.toLowerCase() === spell.name.toLowerCase() && e.usesRemaining > 0
        );
        if (extraUse) {
          const extraUsesBadge = spellDiv.createDiv({ cls: 'extra-uses-badge' });
          extraUsesBadge.createEl('span', { 
            text: `+${extraUse.usesRemaining} free uses` 
          });
          extraUsesBadge.setAttribute('title', `Extra uses from ${extraUse.source || 'unknown'}`);
        }
        
        // Description with toggle
        const descriptionContainer = spellDiv.createDiv({ cls: 'spell-description-container' });
        const descriptionToggle = descriptionContainer.createEl('button', {
          text: 'Show Description',
          cls: 'description-toggle'
        });
        
        const descriptionDiv = descriptionContainer.createDiv({ 
          cls: 'spell-description hidden' 
        });
        descriptionDiv.createEl('p', { text: spell.description });
        
        if (spell.path) {
          const linkBtn = descriptionContainer.createEl('button', {
            text: '📄 Open Note',
            cls: 'open-note-btn'
          });

          linkBtn.addEventListener('click', async () => {
            const file = this.app.vault.getAbstractFileByPath(spell.path!) as TFile | null;

            if (file && file instanceof TFile) {
              // 🔄 Atualiza a descrição da spell com o conteúdo do arquivo
              const content = await this.app.vault.read(file);
              spell.description = content;

              // Salva nos settings (seja known ou unknown)
              await this.plugin.saveSettings();

              // Abre a nota normalmente
              this.app.workspace.getLeaf().openFile(file);
            } else {
              new Notice("Spell note not found or is not a valid file.");
            }
          });
        }
        
        descriptionToggle.addEventListener('click', () => {
          if (descriptionDiv.classList.contains('hidden')) {
            descriptionDiv.classList.remove('hidden');
            descriptionToggle.textContent = 'Hide Description';
          } else {
            descriptionDiv.classList.add('hidden');
            descriptionToggle.textContent = 'Show Description';
          }
        });
        
        // Control buttons
        const buttonContainer = spellDiv.createDiv({ cls: 'spell-buttons' });
        
        // Prepare/Unprepare Toggle
        const prepareBtn = buttonContainer.createEl('button', {
          text: spell.isPrepared ? 'Unprepare' : 'Prepare',
          cls: spell.isPrepared ? 'unprepare-btn' : 'prepare-btn'
        });
        prepareBtn.addEventListener('click', () => {
          this.plugin.toggleSpellPreparation(spell.id);
          this.refresh();
        });

        if (spell.isPrepared) {
          const castBtn = buttonContainer.createEl('button', {
              text: 'Cast',
              cls: 'cast-btn'
          });
          castBtn.addEventListener('click', () => {
              this.plugin.castSpell(spell);
              this.refresh();
          });
        }
        
        // Delete Spell Button
        const deleteBtn = buttonContainer.createEl('button', {
          text: 'Delete',
          cls: 'delete-btn'
        });
        deleteBtn.addEventListener('click', () => {
          if (confirm(`Are you sure you want to move "${spell.name}" to Unknown Spells?`)) {
            this.plugin.moveSpellToUnknown(spell.id);
            this.refresh();
          }
        });
      });
    });
  }
  
  openAddSpellModal() {
    const modalContainer = this.containerEl.createDiv({ cls: 'add-spell-modal' });
    modalContainer.createEl('h2', { text: 'Add New Spell' });

    const form = modalContainer.createEl('form');
    
    // Name Input
    form.createEl('label', { text: 'Spell Name' });
    const nameInput = form.createEl('input', { type: 'text' });
    
    // Level Input
    form.createEl('label', { text: 'Spell Level' });
    const levelInput = form.createEl('select');
    [0,1,2,3,4,5,6,7,8,9].forEach(level => {
      levelInput.createEl('option', { 
        text: level === 0 ? 'Cantrip' : `Level ${level}`, 
        value: level.toString() 
      });
    });

    // Description Input
    form.createEl('label', { text: 'Description' });
    const descInput = form.createEl('textarea');

    // Submit Button
    const submitBtn = form.createEl('button', { text: 'Add Spell' });
    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.plugin.addSpell({
        id: generateUniqueSpellId(),
        name: nameInput.value,
        level: parseInt(levelInput.value),
        description: descInput.value,
        isPrepared: false
      });
      modalContainer.remove();
      this.refresh();
    });
    
    // Cancel Button
    const cancelBtn = form.createEl('button', { 
      text: 'Cancel',
      cls: 'cancel-btn' 
    });
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      modalContainer.remove();
    });
  }

  async onClose(): Promise<void> {
    this.containerEl.empty();
  }

  refresh() {
    this.containerEl.empty();
    this.onOpen();
  }
}

class UnknownSpellsView extends ItemView {
  plugin: DnDSpellbookPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: DnDSpellbookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return UNKNOWN_SPELLS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "D&D Unknown Spells";
  }

  getIcon(): string {
    return "question-mark"; // change icon as desired
  }

 async onOpen(): Promise<void> {
  // Create the main container with navigation
  const container = this.containerEl.createDiv({ cls: 'unknown-spells-container modern-spellbook-layout' });
  
  // Navigation buttons container
  const navButtons = container.createDiv({ cls: 'spellbook-nav-buttons' });
  // "Back to Spellbook" button:
  const backButton = navButtons.createEl('button', {
    text: 'Back to Spellbook',
    cls: 'nav-btn'
  });
  backButton.addEventListener('click', () => {
    this.plugin.activateView();
  });
  
  // ✅ BARRA DE PESQUISA
  const searchContainer = container.createDiv({ cls: 'search-container' });
  searchContainer.createEl('label', { text: 'Search spells: ' });
  const searchInput = searchContainer.createEl('input', {
    type: 'text',
    placeholder: 'Type spell name...',
    cls: 'spell-search-input'
  });
  
  // Create a filter control to choose a level (0-9) or All Levels
  const filterContainer = container.createDiv({ cls: 'filter-container' });
  filterContainer.createEl('label', { text: 'Filter by level: ' });
  const levelFilter = filterContainer.createEl('select');
  levelFilter.createEl('option', { text: 'All Levels', value: 'all' });
  levelFilter.createEl('option', { text: 'Cantrips (Level 0)', value: '0' }); // ✅ ADICIONADO
  for (let i = 1; i <= 9; i++) {
    levelFilter.createEl('option', { text: `Level ${i}`, value: i.toString() });
  }
  
  // Add scrollable content wrapper
  const scrollContainer = container.createDiv({ cls: 'spellbook-scroll-container' });
  scrollContainer.style.maxHeight = '70vh';
  scrollContainer.style.overflowY = 'auto';
  scrollContainer.style.paddingRight = '10px';
  
  // Header for the view
  scrollContainer.createEl('h2', { text: 'Unknown Spells' });
  
  // Function to render unknown spells with optional level and search filters.
  const renderUnknownSpells = (filterLevel: string, searchTerm: string = '') => {
    // Remove any previously rendered groups
    scrollContainer.querySelectorAll('.unknown-spell-group').forEach(e => e.remove());
    
    // Get all unknown spells from settings
    let spells = this.plugin.settings.unknownSpells || [];
    
    // Apply search filter
    if (searchTerm.trim()) {
      spells = spells.filter(spell => 
        spell.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        spell.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply level filter
    if (filterLevel !== 'all') {
      const levelNum = parseInt(filterLevel);
      spells = spells.filter(s => s.level === levelNum);
    }
    
    // Sort the spells by level (ascending)
    spells = spells.sort((a, b) => a.level - b.level);
    
    // Group spells by level (levels 0 to 9) - ✅ INCLUINDO CANTRIPS
    const spellsByLevel: { [key: number]: Spell[] } = {};

    spells.forEach((spell: Spell) => {
      const lvl = spell.level;
      if (!spellsByLevel[lvl]) {
        spellsByLevel[lvl] = [];
      }
      spellsByLevel[lvl].push(spell);
    });
    
    // Render groups for levels 0 to 9 in order - ✅ MUDANÇA AQUI: level = 0
    for (let level = 0; level <= 9; level++) {
      if (spellsByLevel[level] && spellsByLevel[level].length > 0) {
        const levelSection = scrollContainer.createDiv({ cls: 'unknown-spell-group' });
        // ✅ TRATAMENTO ESPECIAL PARA CANTRIPS
        const levelTitle = level === 0 ? 'Cantrips' : `Level ${level} Spells`;
        levelSection.createEl('h3', { text: levelTitle });
        
        spellsByLevel[level].forEach(spell => {
          const spellDiv = levelSection.createDiv({ cls: 'spell-card unknown' });
          
          // Create a header with the spell name and level
          const headerDiv = spellDiv.createDiv({ cls: 'spell-header' });
          headerDiv.createEl('h4', { text: spell.name, cls: 'spell-name' });
          // ✅ TRATAMENTO ESPECIAL PARA MOSTRAR "Cantrip" AO INVÉS DE "Level 0"
          const levelText = spell.level === 0 ? 'Cantrip' : `Level ${spell.level}`;
          headerDiv.createEl('span', { text: levelText, cls: 'spell-level' });
          
          // Add the description (if available) - ✅ MELHORADA COM TOGGLE
          if (spell.description) {
            const descriptionContainer = spellDiv.createDiv({ cls: 'spell-description-container' });
            const descriptionToggle = descriptionContainer.createEl('button', {
              text: 'Show Description',
              cls: 'description-toggle'
            });
            
            const descriptionDiv = descriptionContainer.createDiv({ 
              cls: 'spell-description hidden' 
            });
            descriptionDiv.createEl('p', { text: spell.description });
            
            descriptionToggle.addEventListener('click', () => {
              if (descriptionDiv.classList.contains('hidden')) {
                descriptionDiv.classList.remove('hidden');
                descriptionToggle.textContent = 'Hide Description';
              } else {
                descriptionDiv.classList.add('hidden');
                descriptionToggle.textContent = 'Show Description';
              }
            });
          }
          
          // ✅ CONTAINER PARA BOTÕES
          const buttonContainer = spellDiv.createDiv({ cls: 'spell-buttons' });
          
          // Button to "Learn" the spell (moves it from unknown to known)
          const learnBtn = buttonContainer.createEl('button', { 
            text: 'Learn Spell', 
            cls: 'learn-spell-btn' 
          });
          learnBtn.addEventListener('click', () => {
            this.plugin.learnSpell(spell.id);
            // Immediately refresh the view so the spell is removed from unknowns
            this.refresh();
          });
          
          // ✅ BOTÃO PARA DELETAR PERMANENTEMENTE
          const deleteBtn = buttonContainer.createEl('button', {
            text: 'Delete',
            cls: 'delete-btn'
          });
          deleteBtn.addEventListener('click', () => {
            if (confirm(`Are you sure you want to permanently delete "${spell.name}"?`)) {
              const index = this.plugin.settings.unknownSpells.findIndex(s => s.id === spell.id);
              if (index !== -1) {
                this.plugin.settings.unknownSpells.splice(index, 1);
                this.plugin.saveSettings();
                this.refresh();
                new Notice(`Deleted "${spell.name}" from unknown spells.`);
              }
            }
          });
        });
      }
    }
    
    // ✅ MENSAGEM QUANDO NÃO HÁ MAGIAS
    if (spells.length === 0) {
      const noSpellsDiv = scrollContainer.createDiv({ cls: 'no-spells-message' });
      let message;
      
      if (searchTerm.trim() && filterLevel !== 'all') {
        message = `No spells found matching "${searchTerm}" in ${filterLevel === '0' ? 'cantrips' : `level ${filterLevel}`}.`;
      } else if (searchTerm.trim()) {
        message = `No spells found matching "${searchTerm}".`;
      } else if (filterLevel !== 'all') {
        message = `No unknown ${filterLevel === '0' ? 'cantrips' : `level ${filterLevel} spells`} found.`;
      } else {
        message = 'No unknown spells found. Import spells from notes to populate this list!';
      }
      
      noSpellsDiv.createEl('p', { text: message });
    }
  };

  // Initially render all unknown spells.
  renderUnknownSpells('all', '');

  // ✅ EVENT LISTENERS PARA PESQUISA E FILTRO
  searchInput.addEventListener('input', () => {
    renderUnknownSpells(levelFilter.value, searchInput.value);
  });

  // Update the view when the filter is changed.
  levelFilter.addEventListener('change', () => {
    renderUnknownSpells(levelFilter.value, searchInput.value);
  });
 }

 async onClose(): Promise<void> {
  this.containerEl.empty();
 } 

 refresh() {
  this.containerEl.empty();
  this.onOpen();
 }
}


export default class DnDSpellbookPlugin extends Plugin {
	settings: DnDSpellbookSettings & {
    spellFolderPath?: string;
  };

  async scanSpecificNoteForAllBonuses(file: TFile): Promise<{
    spellBonuses: SpellBonuses | null,
    preparedBonuses: BonusPreparedSpell[],
    slotBonuses: SpellSlot[]
  }> {
    console.log(`🔍 Escaneando arquivo para TODOS os bônus: ${file.basename}`);
    
    try {
      const content = await this.app.vault.read(file);
      console.log(`📄 Conteúdo do arquivo:\n${content.substring(0, 300)}...`);
      
      // Procura por frontmatter YAML
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!yamlMatch) {
        console.log("❌ Nenhum YAML frontmatter encontrado");
        return { spellBonuses: null, preparedBonuses: [], slotBonuses: [] };
      }
      
      const yamlContent = yamlMatch[1];
      console.log(`📋 YAML encontrado:\n${yamlContent}`);
      
      const result = {
        spellBonuses: null as SpellBonuses | null,
        preparedBonuses: [] as BonusPreparedSpell[],
        slotBonuses: [] as SpellSlot[]
      };
      
      // =====================================
      // 🎯 SCAN PARA BÔNUS DE PREPARAÇÃO GERAL
      // =====================================
      
      const cantripBonusMatch = yamlContent.match(/bonus[_-]?cantrips?\s*:\s*(\d+)/i);
      const preparedBonusMatch = yamlContent.match(/bonus[_-]?prepared[_-]?spells?\s*:\s*(\d+)/i);
      
      if (cantripBonusMatch || preparedBonusMatch) {
        console.log("✅ Encontrados bônus gerais de preparação");
        
        result.spellBonuses = {};
        
        if (cantripBonusMatch) {
          result.spellBonuses.bonusCantrips = parseInt(cantripBonusMatch[1]);
          console.log(`🎪 Bônus cantrips: +${result.spellBonuses.bonusCantrips}`);
        }
        
        if (preparedBonusMatch) {
          result.spellBonuses.bonusPreparedSpells = parseInt(preparedBonusMatch[1]);
          console.log(`📚 Bônus prepared spells: +${result.spellBonuses.bonusPreparedSpells}`);
        }
        
        // Remove bônus anterior desta nota para spellBonuses
        this.settings.spellBonuses = this.settings.spellBonuses.filter(
          bonus => bonus.source !== file.basename
        );
        
        // Adiciona o novo bônus geral
        result.spellBonuses.source = file.basename;
        this.settings.spellBonuses.push(result.spellBonuses);
      }
      
      // ==========================================
      // 🎯 SCAN PARA SPELLS PREPARADOS ESPECÍFICOS
      // ==========================================
      
      // Procura por diferentes formatos de spells específicos
      const specificSpellPatterns = [
        /prepared[_-]?spells?\s*:\s*(.+)/i,
        /specific[_-]?prepared\s*:\s*(.+)/i,
        /always[_-]?prepared\s*:\s*(.+)/i,
        /free[_-]?prepared\s*:\s*(.+)/i
      ];
      
      let specificSpellMatch = null;
      for (const pattern of specificSpellPatterns) {
        specificSpellMatch = yamlContent.match(pattern);
        if (specificSpellMatch) {
          console.log(`✅ Padrão de spells específicos encontrado: ${pattern.source}`);
          break;
        }
      }
      
      if (specificSpellMatch) {
        const spellsText = specificSpellMatch[1].trim();
        console.log(`🎯 Texto dos spells específicos: "${spellsText}"`);
        
        let spellNames: string[] = [];
        
        // Se é uma lista [spell1, spell2]
        if (spellsText.startsWith('[') && spellsText.endsWith(']')) {
          console.log("📝 Formato de lista detectado");
          const listContent = spellsText.slice(1, -1);
          spellNames = listContent.split(',').map(s => s.trim().replace(/['"]/g, ''));
        }
        // Se é uma string simples
        else {
          console.log("📝 Formato de string simples detectado");
          spellNames = [spellsText.replace(/['"]/g, '')];
        }
        
        console.log(`🎪 Spells específicos extraídos:`, spellNames);
        
        // Remove bônus anteriores desta nota para bonusPreparedSpells
        this.settings.bonusPreparedSpells = this.settings.bonusPreparedSpells.filter(
          bonus => bonus.source !== file.basename
        );
        
        // Adiciona os novos spells específicos
        for (const spellName of spellNames) {
          if (spellName.trim()) {
            const newBonus = {
              spellName: spellName.trim(),
              source: file.basename,
              isActive: false
            };
            result.preparedBonuses.push(newBonus);
            console.log(`➕ Adicionando spell específico: ${spellName.trim()} de ${file.basename}`);
          }
        }
        
        this.settings.bonusPreparedSpells.push(...result.preparedBonuses);
      }
      
      // ==========================================
      // 🆕 SCAN PARA SPELL SLOTS BÔNUS VIA YAML
      // ==========================================
      
      console.log("🔍 Procurando por spell slots bônus...");
      
      // Padrão 1: bonus_spell_slots: { level1: 2, level3: 1 }
      const bonusSlotObjectMatch = yamlContent.match(/bonus[_-]?spell[_-]?slots?\s*:\s*\{([^}]+)\}/i);
      if (bonusSlotObjectMatch) {
        console.log("✅ Formato de objeto encontrado para spell slots");
        const objectContent = bonusSlotObjectMatch[1];
        console.log(`📋 Conteúdo do objeto: ${objectContent}`);
        
        // Remove bônus anteriores desta fonte
        this.settings.bonusSpellSlots = this.settings.bonusSpellSlots.filter(
          slot => slot.source !== file.basename
        );
        
        // Parse das entradas level1: 2, level3: 1
        const levelMatches = objectContent.matchAll(/level(\d+)\s*:\s*(\d+)/g);
        for (const match of levelMatches) {
          const level = parseInt(match[1]);
          const slots = parseInt(match[2]);
          
          if (level >= 1 && level <= 9 && slots > 0) {
            console.log(`➕ Adicionando ${slots} spell slots de nível ${level}`);
            const newSlot: SpellSlot = {
              level: level,
              total: slots,
              used: 0,
              source: file.basename,
              autoScanned: false // Marca como vindo do YAML, não do scan de tags
            };
            result.slotBonuses.push(newSlot);
            this.settings.bonusSpellSlots.push(newSlot);
          }
        }
      }
      
      // Padrão 2: bonus_spell_slots: [{ level: 1, slots: 2 }, { level: 3, slots: 1 }]
      const bonusSlotArrayMatch = yamlContent.match(/bonus[_-]?spell[_-]?slots?\s*:\s*\[([^\]]+)\]/i);
      if (bonusSlotArrayMatch && !bonusSlotObjectMatch) { // Só executa se não encontrou o formato objeto
        console.log("✅ Formato de array encontrado para spell slots");
        const arrayContent = bonusSlotArrayMatch[1];
        console.log(`📋 Conteúdo do array: ${arrayContent}`);
        
        // Remove bônus anteriores desta fonte
        this.settings.bonusSpellSlots = this.settings.bonusSpellSlots.filter(
          slot => slot.source !== file.basename
        );
        
        // Parse das entradas { level: 1, slots: 2 }
        const itemMatches = arrayContent.matchAll(/\{\s*level\s*:\s*(\d+)\s*,\s*slots\s*:\s*(\d+)\s*\}/g);
        for (const match of itemMatches) {
          const level = parseInt(match[1]);
          const slots = parseInt(match[2]);
          
          if (level >= 1 && level <= 9 && slots > 0) {
            console.log(`➕ Adicionando ${slots} spell slots de nível ${level}`);
            const newSlot: SpellSlot = {
              level: level,
              total: slots,
              used: 0,
              source: file.basename,
              autoScanned: false
            };
            result.slotBonuses.push(newSlot);
            this.settings.bonusSpellSlots.push(newSlot);
          }
        }
      }
      
      // Padrão 3: Simples - level1_slots: 2, level3_slots: 1
      if (!bonusSlotObjectMatch && !bonusSlotArrayMatch) {
        console.log("🔍 Procurando por formato simples de spell slots");
        
        let foundSimpleSlots = false;
        
        for (let level = 1; level <= 9; level++) {
          const patterns = [
            new RegExp(`level${level}[_-]?slots?\\s*:\\s*(\\d+)`, 'i'),
            new RegExp(`${level}[_-]?level[_-]?slots?\\s*:\\s*(\\d+)`, 'i'),
            new RegExp(`spell[_-]?slot[_-]?${level}\\s*:\\s*(\\d+)`, 'i'),
            new RegExp(`spell[_-]?slots?[_-]?level[_-]?${level}\\s*:\\s*(\\d+)`, 'i')
          ];
          
          for (const pattern of patterns) {
            const match = yamlContent.match(pattern);
            if (match) {
              const slots = parseInt(match[1]);
              if (slots > 0) {
                if (!foundSimpleSlots) {
                  // Remove bônus anteriores desta fonte na primeira vez
                  this.settings.bonusSpellSlots = this.settings.bonusSpellSlots.filter(
                    slot => slot.source !== file.basename
                  );
                  foundSimpleSlots = true;
                }
                
                console.log(`➕ Adicionando ${slots} spell slots de nível ${level} (formato simples)`);
                const newSlot: SpellSlot = {
                  level: level,
                  total: slots,
                  used: 0,
                  source: file.basename,
                  autoScanned: false
                };
                result.slotBonuses.push(newSlot);
                this.settings.bonusSpellSlots.push(newSlot);
                break; // Para de procurar outros padrões para este nível
              }
            }
          }
        }
      }
      
      await this.saveSettings();
      
      console.log(`✨ Resultados do scan:`);
      console.log(`- Bônus gerais:`, result.spellBonuses);
      console.log(`- Spells específicos:`, result.preparedBonuses);
      console.log(`- Spell slots bônus:`, result.slotBonuses);
      
      return result;
      
    } catch (error) {
      console.error(`❌ Erro lendo arquivo ${file.path}:`, error);
      return { spellBonuses: null, preparedBonuses: [], slotBonuses: [] };
    }
  }

  
    // Permitir que outro plugin adicione spell slots bônus
	public addBonusSpellSlot(level: number, amount: number, source = "external") {
		const existing = this.settings.bonusSpellSlots.find(s => s.level === level && s.source === source);
		if (existing) {
		  existing.total += amount;
		} else {
		  this.settings.bonusSpellSlots.push({ level, total: amount, used: 0, source });
		}
		this.updateSpellSlots();
		this.saveSettings();
	  }
	
	  // Permitir que outro plugin adicione usos extras de uma magia
	  public addExtraSpellUse(spellName: string, uses: number, source = "external") {
		const existing = this.settings.extraSpellUses.find(e => e.spellName.toLowerCase() === spellName.toLowerCase() && e.source === source);
		if (existing) {
		  existing.uses += uses;
		  existing.usesRemaining += uses;
		} else {
		  this.settings.extraSpellUses.push({
			spellName,
			uses,
			usesRemaining: uses,
			source
		  });
		}
		this.saveSettings();
	  }
	
	

	async onload() {
		await this.loadSettings();
    if (!this.settings.hasOwnProperty('spellFolderPath')) {
      this.settings.spellFolderPath = '';
      await this.saveSettings();
    }
    if (!this.settings.hasOwnProperty('cantripFolderPath')) {
      this.settings.cantripFolderPath = '';
      await this.saveSettings();
    }
    if (!this.settings.hasOwnProperty('level1FolderPath')) {
      this.settings.level1FolderPath = '';
      await this.saveSettings();
    }
    // defaults:
    // ... continue for levels 2-9 ...
    if (!this.settings.hasOwnProperty('level2FolderPath')) {
      this.settings.level2FolderPath = '';
      await this.saveSettings();
    }
    if (!this.settings.hasOwnProperty('level3FolderPath')) {
      this.settings.level3FolderPath = '';
      await this.saveSettings();
    }
    if (!this.settings.hasOwnProperty('level4FolderPath')) {
      this.settings.level4FolderPath = '';
      await this.saveSettings();
    }
    if (!this.settings.hasOwnProperty('level5FolderPath')) {
      this.settings.level5FolderPath = '';
      await this.saveSettings();
    }
    if (!this.settings.hasOwnProperty('level6FolderPath')) {
      this.settings.level6FolderPath = '';
      await this.saveSettings();
    }
    if (!this.settings.hasOwnProperty('level7FolderPath')) {
      this.settings.level7FolderPath = '';
      await this.saveSettings();
    }
    if (!this.settings.hasOwnProperty('level8FolderPath')) {
      this.settings.level8FolderPath = '';
      await this.saveSettings();
    }
    if (!this.settings.hasOwnProperty('level9FolderPath')) {
      this.settings.level9FolderPath = '';
      await this.saveSettings();
    }
  
  // Initialize spell slots based on current class/level when plugin loads
  this.settings.spellSlots = calculateSpellSlots(
    this.settings.characterClass,
    this.settings.characterLevel,
    this.settings.bonusSpellSlots
  );
  await this.saveSettings();
  // Register custom views
  this.registerView(
    SPELLBOOK_VIEW_TYPE, 
    (leaf) => new SpellbookView(leaf, this)
  );
  this.registerView(
    KNOWN_SPELLS_VIEW_TYPE,
    (leaf) => new KnownSpellsView(leaf, this)
  );
  this.registerView(
    UNKNOWN_SPELLS_VIEW_TYPE,
    (leaf) => new UnknownSpellsView(leaf, this)
  );
  
    
		// Add ribbon icon to open spellbook
		this.addRibbonIcon('book', 'D&D Spellbook', async () => {
			await this.activateView();
		});

		// Add settings tab
		this.addSettingTab(new SpellbookSettingTab(this.app, this));
    
    // Add CSS to document head
    this.loadStyles();
	}
  
	loadStyles() {
		const styleElement = document.createElement('link');
		styleElement.rel = 'stylesheet';
		styleElement.href = 'obsidian://css/plugins/dnd-spellbook/styles.css';
		document.head.appendChild(styleElement);
	  }

    refreshAllViews() {
      // Refresh SpellbookView
      const spellbookLeaves = this.app.workspace.getLeavesOfType(SPELLBOOK_VIEW_TYPE);
      spellbookLeaves.forEach(leaf => {
        const view = leaf.view as SpellbookView;
        if (view && view.refresh) {
          view.refresh();
        }
      });
      
      // Refresh KnownSpellsView
      const knownSpellsLeaves = this.app.workspace.getLeavesOfType(KNOWN_SPELLS_VIEW_TYPE);
      knownSpellsLeaves.forEach(leaf => {
        const view = leaf.view as KnownSpellsView;
        if (view && view.refresh) {
          view.refresh();
        }
      });
      
      // Refresh UnknownSpellsView
      const unknownSpellsLeaves = this.app.workspace.getLeavesOfType(UNKNOWN_SPELLS_VIEW_TYPE);
      unknownSpellsLeaves.forEach(leaf => {
        const view = leaf.view as UnknownSpellsView;
        if (view && view.refresh) {
          view.refresh();
        }
      });
    }

    async learnSpell(spellId: string) {
      console.log(`Learning spell with ID: ${spellId}`); // Debug log
      
      const index = this.settings.unknownSpells.findIndex(s => s.id === spellId);
      if (index === -1) {
        console.error(`Spell with ID ${spellId} not found in unknown spells`);
        new Notice('Spell not found!');
        return;
      }

      const spell = this.settings.unknownSpells[index];
      console.log(`Learning spell: ${spell.name}`); // Debug log

      // Remove from unknown spells
      this.settings.unknownSpells.splice(index, 1);

      // Remove any other spells with the same name (case-insensitive)
      this.settings.unknownSpells = this.settings.unknownSpells.filter(
        s => s.name.toLowerCase() !== spell.name.toLowerCase()
      );

      // Add to known spells with new unique ID
      const learnedSpell = {
        ...spell,
        id: generateUniqueSpellId(), // NEW UNIQUE ID
        isPrepared: false
      };

      await this.createSpellWithNote(learnedSpell);
      new Notice(`Learned spell: ${spell.name}`);
      
      // Refresh all views
      this.refreshAllViews();
    }

    async scanNotesForTaggedSpells() {
      const files = this.app.vault.getMarkdownFiles();
      let importCount = 0;
      
      // Clear previous extra spell uses so that a re‐scan won't add duplicates
      this.settings.extraSpellUses = [];
      
      for (const file of files) {
        const content = await this.app.vault.read(file);
        
        // Look for tags in the format #NspellName (e.g., #1fireball, #3magicMissile)
        const tagMatches = content.matchAll(/#(\d+)([a-zA-Z_]+)/g);
        
        for (const match of tagMatches) {
          const uses = parseInt(match[1]);
          const rawSpellName = match[2];
          const spellName = rawSpellName.replace(/_/g, ' ');

          
          // Check if this spell exists in the known spells
          const knownSpell = this.settings.knownSpells.find(
            s => s.name.toLowerCase() === spellName.toLowerCase()
          );
          
          if (knownSpell) {
            // Look for an extra use entry for this spell
            const existingExtraUse = this.settings.extraSpellUses.find(
              e => e.spellName.toLowerCase() === spellName.toLowerCase()
            );
            
            if (existingExtraUse) {
              // Add new uses from this file to the already collected uses.
              existingExtraUse.uses += uses;
              existingExtraUse.usesRemaining += uses;
              // Optionally, append the source name
              existingExtraUse.source = existingExtraUse.source 
                ? `${existingExtraUse.source}, ${file.basename}`
                : file.basename;
            } else {
              // Create a new extra spell use entry
              this.settings.extraSpellUses.push({
                spellName: knownSpell.name,
                uses: uses,
                usesRemaining: uses,
                source: file.basename
              });
              importCount++;
            }
          }
        }
      }
      
      await this.saveSettings();
      return importCount;
    }
    async scanNotesForBonusSpellSlots() {
      const files = this.app.vault.getMarkdownFiles();
      let importCount = 0;
    
      // Remove previously auto-scanned bonus slots, but keep manually added ones.
      // We mark auto-generated bonus slots with a property: autoScanned: true.
      this.settings.bonusSpellSlots = this.settings.bonusSpellSlots.filter(slot => !slot.autoScanned);
    
      // Define a regex to capture tags in the format: #<amount>_spellSlot_<level>
      // For example, "#1_spellSlot_3" adds 1 bonus slot at level 3.
      const bonusTagRegex = /#(\d+)[_]?spell[_]?slot[_]?(\d+)/gi;
    
      for (const file of files) {
        const content = await this.app.vault.read(file);
        const bonusTagMatches = content.matchAll(bonusTagRegex);
        for (const match of bonusTagMatches) {
          const slotsToAdd = parseInt(match[1]);
          const slotLevel = parseInt(match[2]);
    
          // Look for an existing bonus slot entry for this level that was auto-scanned
          let existingBonusSlot = this.settings.bonusSpellSlots.find(slot => slot.level === slotLevel && slot.autoScanned);
          if (existingBonusSlot) {
            // Accumulate the bonus slots if the tag is found in another file
            existingBonusSlot.total += slotsToAdd;
            // Optionally, concatenate source names if desired:
            existingBonusSlot.source = existingBonusSlot.source 
              ? `${existingBonusSlot.source}, ${file.basename}` 
              : file.basename;
          } else {
            // Create a new bonus slot entry from the scan
            this.settings.bonusSpellSlots.push({
              level: slotLevel,
              total: slotsToAdd,
              used: 0,
              source: file.basename,
              autoScanned: true
            });
            importCount++;
          }
        }
      }
    
      await this.saveSettings();
      return importCount;
    }
    

  async activateView() {
    this.updateSpellSlots();
    
    const { workspace } = this.app;

    const leaves = workspace.getLeavesOfType(SPELLBOOK_VIEW_TYPE);

    let leaf: WorkspaceLeaf | null = null;
    if (leaves.length > 0) {
        // If view already exists, activate it
        leaf = leaves[0];
    } else {
        // Create new leaf if not exists
        leaf = workspace.getRightLeaf(false);
    }

    // Null check before setting view state
    if (leaf) {
        await leaf.setViewState({
            type: SPELLBOOK_VIEW_TYPE,
            active: true
        });

        // Ensure the leaf is activated
        workspace.revealLeaf(leaf);
    } else {
        // Fallback error handling
        console.error('Could not create or find a leaf for the Spellbook view');
    }
  }
  
  async activateKnownSpellsView() {
    const { workspace } = this.app;

    const leaves = workspace.getLeavesOfType(KNOWN_SPELLS_VIEW_TYPE);

    let leaf: WorkspaceLeaf | null = null;
    if (leaves.length > 0) {
        // If view already exists, activate it
        leaf = leaves[0];
    } else {
        // Create new leaf if not exists
        leaf = workspace.getRightLeaf(false);
    }

    // Null check before setting view state
    if (leaf) {
        await leaf.setViewState({
            type: KNOWN_SPELLS_VIEW_TYPE,
            active: true
        });

        // Ensure the leaf is activated
        workspace.revealLeaf(leaf);
    } else {
        // Fallback error handling
        console.error('Could not create or find a leaf for the Known Spells view');
    }
  }
  async createSpellWithNote(spell: Spell) {
	if (spell.path) {
		this.settings.knownSpells.push(spell);
		await this.saveSettings();
		new Notice(`Magia "${spell.name}" adicionada com sucesso.`);
		return;
	  }
    const fileName = `${spell.name}.md`;
    const folderPath = this.settings.defaultSpellFolder || "Spells";
    const fullPath = `${folderPath}/${fileName}`;
  
    await this.app.vault.createFolder(folderPath).catch(() => {});
  
    const fileContent = `# ${spell.name}\n\n- **Level:** ${spell.level}\n\n${spell.description}`;
  
    try {
      const file = await this.app.vault.create(fullPath, fileContent);
      spell.path = file.path;
      // (opcional) abrir o arquivo
      // await this.app.workspace.getLeaf().openFile(file);
    } catch (e) {
      console.error("Erro criando nota:", e);
      new Notice("Erro ao criar a nota da magia.");
    }
  
    this.settings.knownSpells.push(spell);
await this.saveSettings();
new Notice(`Magia "${spell.name}" criada com sucesso.`);
  }
  
  async activateUnknownSpellsView() {
    const { workspace } = this.app;
  
    const leaves = workspace.getLeavesOfType(UNKNOWN_SPELLS_VIEW_TYPE);
  
    let leaf: WorkspaceLeaf | null = null;
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
    }
  
    if (leaf) {
      await leaf.setViewState({
        type: UNKNOWN_SPELLS_VIEW_TYPE,
        active: true
      });
      workspace.revealLeaf(leaf);
    } else {
      console.error('Could not create or find a leaf for the Unknown Spells view');
    }
  }  

  async loadSettings() {
	this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	
  if (!this.settings.bonusSpellSlots) {
    this.settings.bonusSpellSlots = [];
  }
	// Ensure spell slots match character class and level
	if (this.settings.characterClass && this.settings.characterLevel) {
	  const newSlots = calculateSpellSlots(
		this.settings.characterClass,
		this.settings.characterLevel,
    this.settings.bonusSpellSlots 
	  );
	  
	  // Create a mapping of used slots from current settings
	  const usedSlotsMap: Record<number, number> = {};
	  this.settings.spellSlots.forEach(slot => {
		usedSlotsMap[slot.level] = slot.used;
	  });
	  
	  // Apply used slots to new configuration
	  newSlots.forEach(slot => {
		if (usedSlotsMap[slot.level] !== undefined) {
		  slot.used = Math.min(usedSlotsMap[slot.level], slot.total);
		}
	  });
	  
	  this.settings.spellSlots = newSlots;
	  await this.saveSettings();
	}
  }

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async addSpell(spell: Spell) {
    await this.createSpellWithNote(spell);
    this.saveSettings();
  }

	deleteSpell(spellId: string) {
		this.settings.knownSpells = this.settings.knownSpells.filter(spell => spell.id !== spellId);
		this.saveSettings();
	}

  moveSpellToUnknown(spellId: string) {
    console.log(`Moving spell to unknown, ID: ${spellId}`); // Debug log
    
    const index = this.settings.knownSpells.findIndex(s => s.id === spellId);
    if (index === -1) {
      console.error(`Spell with ID ${spellId} not found in known spells`);
      new Notice('Spell not found!');
      return;
    }

    const spell = this.settings.knownSpells[index];
    console.log(`Moving spell: ${spell.name}`); // Debug log

    // Remove from known spells
    this.settings.knownSpells.splice(index, 1);

    // Check if already in unknown spells
    const alreadyInUnknown = this.settings.unknownSpells.some(
      s => s.name.toLowerCase() === spell.name.toLowerCase()
    );

    if (!alreadyInUnknown) {
      // Add to unknown spells with new ID to avoid conflicts
      this.settings.unknownSpells.push({
        ...spell,
        id: generateUniqueSpellId(), // NEW UNIQUE ID
        isPrepared: false
      });
    }

    this.saveSettings();
    new Notice(`Moved "${spell.name}" to Unknown Spells.`);
    
    // Refresh all views
    this.refreshAllViews();
  }
  

  toggleSpellPreparation(spellId: string) {
    console.log(`🔄 Toggling preparation for spell ID: ${spellId}`);
    
    const spellIndex = this.settings.knownSpells.findIndex(s => s.id === spellId);
    if (spellIndex === -1) {
      console.error(`❌ Spell with ID ${spellId} not found`);
      new Notice('Spell not found!');
      return;
    }
    
    const spell = this.settings.knownSpells[spellIndex];
    console.log(`🎯 Found spell: "${spell.name}", currently prepared: ${spell.isPrepared}`);
    
    // Verifica se esse spell tem um bônus de preparação disponível
    const bonusPreparedSpell = this.settings.bonusPreparedSpells.find(
      bonus => bonus.spellName.toLowerCase() === spell.name.toLowerCase()
    );
    
    console.log(`🔍 Bônus encontrado para "${spell.name}":`, bonusPreparedSpell);
    
    // Se está tentando preparar um spell
    if (!spell.isPrepared) {
      console.log(`➡️ Tentando preparar spell "${spell.name}"`);
      
      // Primeiro, tenta usar o bônus se disponível
      if (bonusPreparedSpell && !bonusPreparedSpell.isActive) {
        console.log(`✨ Usando bônus de ${bonusPreparedSpell.source} para ${spell.name}`);
        bonusPreparedSpell.isActive = true;
        this.settings.knownSpells[spellIndex].isPrepared = true;
        this.saveSettings();
        this.refreshAllViews();
        new Notice(`✨ Prepared ${spell.name} using bonus from ${bonusPreparedSpell.source}!`);
        return;
      }
      
      // Se não tem bônus disponível, usa as regras normais COM CONTAGEM CORRETA
      if (spell.level === 0) {
        // Para cantrips - CONTA SÓ OS NÃO-BÔNUS
        const preparedCantrips = countNonBonusPreparedSpells(
          this.settings.knownSpells, 
          this.settings.bonusPreparedSpells, 
          0
        );
        const maxCantrips = getCantripsKnownCountWithBonus(
          this.settings.characterClass, 
          this.settings.characterLevel, 
          this.settings.spellBonuses
        );
        
        console.log(`🧮 Cantrips: ${preparedCantrips}/${maxCantrips}`);
        
        if (preparedCantrips >= maxCantrips) {
          new Notice(`You can only prepare ${maxCantrips} cantrips.`);
          return;
        }
      } else {
        // Para spells nível 1+ - CONTA SÓ OS NÃO-BÔNUS
        const preparedSpells = countNonBonusPreparedSpells(
          this.settings.knownSpells.filter(s => s.level > 0), 
          this.settings.bonusPreparedSpells
        );
        const maxPrepared = getPreparedSpellsMaxCountWithBonus(
          this.settings.intelligenceModifier, 
          this.settings.characterLevel, 
          this.settings.spellBonuses
        );
        
        console.log(`🧮 Spells: ${preparedSpells}/${maxPrepared}`);
        
        if (preparedSpells >= maxPrepared) {
          new Notice(`You can only prepare ${maxPrepared} spells.`);
          return;
        }
      }
    } 
    // Se está tentando despreparar um spell
    else {
      // Se este spell está usando um bônus, desativa o bônus
      if (bonusPreparedSpell && bonusPreparedSpell.isActive) {
        console.log(`🔻 Desativando bônus de ${bonusPreparedSpell.source} para ${spell.name}`);
        bonusPreparedSpell.isActive = false;
        this.settings.knownSpells[spellIndex].isPrepared = false;
        this.saveSettings();
        this.refreshAllViews();
        new Notice(`Unprepared ${spell.name} (was using bonus from ${bonusPreparedSpell.source})`);
        return;
      }
    }
    
    // Toggle normal
    this.settings.knownSpells[spellIndex].isPrepared = !this.settings.knownSpells[spellIndex].isPrepared;
    console.log(`Spell ${spell.name} is now prepared: ${this.settings.knownSpells[spellIndex].isPrepared}`);
    
    this.saveSettings();
    this.refreshAllViews();
  }
  

	useSpellSlot(level: number) {
    const slot = this.settings.spellSlots.find(s => s.level === level);
    if (slot && slot.used < slot.total) {
      slot.used++;
      new Notice(`Used a level ${level} spell slot. Remaining: ${slot.total - slot.used}/${slot.total}`);
      this.saveSettings();
      this.updateSpellSlots();
    } else {
      new Notice(`No available level ${level} spell slots!`);
    }
  }
  
  restoreSpellSlot(level: number) {
    const slot = this.settings.spellSlots.find(s => s.level === level);
    if (slot && slot.used > 0) {
      slot.used--;
      this.saveSettings();
      this.updateSpellSlots();
    }
  }

  removeDuplicateUnknownSpells() {
    const seen = new Set<string>();
    this.settings.unknownSpells = this.settings.unknownSpells.filter(spell => {
      const key = spell.name.toLowerCase();
      if (seen.has(key)) {
        return false; // duplicate
      }
      seen.add(key);
      return true;
    });
    this.saveSettings();
    new Notice("Removed duplicate unknown spells.");
  }
  
  restoreAllSpellSlots() {
    this.settings.spellSlots.forEach(slot => {
      slot.used = 0;
    });
    // Restore all extra spell uses too
    this.settings.extraSpellUses.forEach(extraUse => {
      extraUse.usesRemaining = extraUse.uses;
  });
  
  this.saveSettings();
}

  //cast spells
  castSpell(spell: Spell) {
    // First check if we have an extra use available
    const extraUse = this.settings.extraSpellUses.find(
        e => e.spellName.toLowerCase() === spell.name.toLowerCase() && e.usesRemaining > 0
    );
    
    if (extraUse) {
        extraUse.usesRemaining--;
        this.saveSettings();
        new Notice(`Cast ${spell.name} using extra use from ${extraUse.source || 'unknown source'} (${extraUse.usesRemaining}/${extraUse.uses} remaining)`);
        return;
    }
    
    // Original spell casting logic
    if (spell.level === 0) {
        new Notice(`Cast ${spell.name} (Cantrip)`);
        return;
    }
    
    const slot = this.settings.spellSlots.find(s => s.level === spell.level);
    if (slot && slot.total > 0 && slot.used < slot.total) {
        slot.used++;
        this.saveSettings();
        new Notice(`Cast ${spell.name} using a level ${spell.level} spell slot`);
        this.updateSpellSlots();
    } else {
        // Try to find higher level slots
        const availableSlots = this.settings.spellSlots
            .filter(s => s.level > spell.level && s.total > 0 && s.used < s.total)
            .sort((a, b) => a.level - b.level);
        
        if (availableSlots.length > 0) {
            const higherSlot = availableSlots[0];
            higherSlot.used++;
            this.saveSettings();
            new Notice(`Cast ${spell.name} using a level ${higherSlot.level} spell slot (upcast)`);
            this.updateSpellSlots();
        } else {
            new Notice(`No available spell slots to cast ${spell.name}!`);
        }
    }
}

async importSpellsFromNotes(): Promise<number> {
	const files = this.app.vault.getMarkdownFiles();
	let importCount = 0;
  
	const levelFolders = [
	  { level: 0, path: this.settings.cantripFolderPath },
	  { level: 1, path: this.settings.level1FolderPath },
	  { level: 2, path: this.settings.level2FolderPath },
	  { level: 3, path: this.settings.level3FolderPath },
	  { level: 4, path: this.settings.level4FolderPath },
	  { level: 5, path: this.settings.level5FolderPath },
	  { level: 6, path: this.settings.level6FolderPath },
	  { level: 7, path: this.settings.level7FolderPath },
	  { level: 8, path: this.settings.level8FolderPath },
	  { level: 9, path: this.settings.level9FolderPath }
	];
  
	// Adiciona pasta global se existir
	if (this.settings.spellFolderPath) {
	  levelFolders.push({ level: -1, path: this.settings.spellFolderPath });
	}
  
	for (const { level, path } of levelFolders) {
	  if (!path) continue;
  
	  const spellFiles = files.filter(file => file.path.startsWith(path));
  
	  for (const file of spellFiles) {
		const spellName = file.basename.trim();
		const normalizedName = spellName.toLowerCase();
  
		const alreadyKnown = this.settings.knownSpells.some(s => s.name.toLowerCase().trim() === normalizedName);
		const alreadyUnknown = this.settings.unknownSpells.some(s => s.name.toLowerCase().trim() === normalizedName);
		if (alreadyKnown || alreadyUnknown) continue;
  
		const content = await this.app.vault.read(file);
		let spellLevel = level;
  
		if (level === -1) {
		  const levelMatch = spellName.match(/\((\d+)\)$/) || spellName.match(/level\s*(\d+)/i);
		  if (levelMatch) {
			spellLevel = parseInt(levelMatch[1]);
		  } else {
			const contentLevelMatch =
			  content.match(/level\s*(\d+)/i) ||
			  content.match(/(\d+)\w{0,2}\s*level/i) ||
			  content.match(/(\d+)(?:st|nd|rd|th)[-\s]level/i);
  
			if (contentLevelMatch) {
			  spellLevel = parseInt(contentLevelMatch[1]);
			}
  
			if (/cantrip/i.test(content)) {
			  spellLevel = 0;
			}
		  }
		}
  
		this.settings.unknownSpells.push({
		  id: generateUniqueSpellId(),
		  name: spellName,
		  level: spellLevel,
		  description: content,
		  isPrepared: false,
		  path: file.path
		});
  
		importCount++;
	  }
	}
  
	await this.saveSettings();
  
	// ✅ Chama o método agora com segurança
	this.updateSpellSlots();
  
	return importCount;
  }
  
  
  // Update spell slots when class/level changes
  updateSpellSlots() {
    const newSlots = calculateSpellSlots(
      this.settings.characterClass, 
      this.settings.characterLevel,
      this.settings.bonusSpellSlots // Já inclui os slots do YAML
    );
    
    // Create a mapping of used slots from current settings
    const usedSlotsMap: Record<number, number> = {};
    this.settings.spellSlots.forEach(slot => {
      usedSlotsMap[slot.level] = slot.used;
    });
    
    // Apply used slots to new configuration where possible
    newSlots.forEach(slot => {
      if (usedSlotsMap[slot.level] !== undefined) {
        slot.used = Math.min(usedSlotsMap[slot.level], slot.total);
      }
    });
    
    this.settings.spellSlots = newSlots;
    this.saveSettings();
    
    // Refresh views if they're open
    const spellbookLeaves = this.app.workspace.getLeavesOfType(SPELLBOOK_VIEW_TYPE);
    if (spellbookLeaves.length > 0) {
      const view = spellbookLeaves[0].view as SpellbookView;
      if (view && view.refresh) {
        view.refresh();
      }
    }
    
    // Also refresh the known spells view if open
    const knownSpellsLeaves = this.app.workspace.getLeavesOfType(KNOWN_SPELLS_VIEW_TYPE);
    if (knownSpellsLeaves.length > 0) {
      const view = knownSpellsLeaves[0].view as KnownSpellsView;
      if (view && view.refresh) {
        view.refresh();
      }
    }
  }
}
class SpellbookSettingTab extends PluginSettingTab {
  name = 'Spellbook Settings';
	plugin: DnDSpellbookPlugin;

	constructor(app: App, plugin: DnDSpellbookPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
  // Add this method to fix the first error
  getSourceName(bonus: SpellSlot): string {
    return bonus.source || "Unknown Source";
 }



  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    containerEl.createEl('h3', { text: 'Bonus Spell Slots' });
    containerEl.createEl('p', { text: 'Extra spell slots from feats, magic items, YAML notes, or other sources' });
    const bonusContainer = containerEl.createDiv({ cls: 'bonus-slots-container' });

    // Separa os slots por fonte
    const slotsBySource: { [source: string]: SpellSlot[] } = {};
    this.plugin.settings.bonusSpellSlots.forEach(slot => {
      const source = slot.source || "Unknown Source";
      if (!slotsBySource[source]) {
        slotsBySource[source] = [];
      }
      slotsBySource[source].push(slot);
    });

    // Display existing bonus slots agrupados por fonte
    Object.keys(slotsBySource).forEach(source => {
      const sourceSlots = slotsBySource[source];
      const sourceDiv = bonusContainer.createDiv({ cls: 'bonus-source-group' });
      
      // Header da fonte
      const sourceHeader = sourceDiv.createDiv({ cls: 'bonus-source-header' });
      sourceHeader.createEl('h4', { text: `${source}` });
      
      // Indica se veio de scan automático ou YAML
      const isAutoScanned = sourceSlots.some(slot => slot.autoScanned);
      const isYAML = !isAutoScanned && source !== "Unknown Source" && source !== "Test Button";
      
      if (isAutoScanned) {
        sourceHeader.createEl('span', { text: ' (Auto-scanned from tags)', cls: 'source-type-badge' });
      } else if (isYAML) {
        sourceHeader.createEl('span', { text: ' (From YAML)', cls: 'source-type-badge yaml-badge' });
      } else {
        sourceHeader.createEl('span', { text: ' (Manual)', cls: 'source-type-badge manual-badge' });
      }
      
      // Lista os slots desta fonte
      sourceSlots.forEach((slot, slotIndex) => {
        const slotDiv = sourceDiv.createDiv({ cls: 'bonus-slot-item' });
        slotDiv.createEl('span', { 
          text: `Level ${slot.level}: +${slot.total} slots`
        });
        
        const removeBtn = slotDiv.createEl('button', {
          text: 'Remove',
          cls: 'remove-bonus-btn'
        });
        removeBtn.addEventListener('click', async () => {
          // Remove este slot específico
          const globalIndex = this.plugin.settings.bonusSpellSlots.findIndex(
            s => s.level === slot.level && s.source === slot.source && s.total === slot.total
          );
          if (globalIndex !== -1) {
            this.plugin.settings.bonusSpellSlots.splice(globalIndex, 1);
            await this.plugin.saveSettings();
            this.plugin.updateSpellSlots();
            this.display(); // Refresh the settings page
          }
        });
      });
      
      // Botão para remover todos os slots desta fonte
      if (sourceSlots.length > 1) {
        const removeAllBtn = sourceDiv.createEl('button', {
          text: `Remove All from ${source}`,
          cls: 'remove-all-source-btn'
        });
        removeAllBtn.addEventListener('click', async () => {
          if (confirm(`Remove all bonus spell slots from "${source}"?`)) {
            this.plugin.settings.bonusSpellSlots = this.plugin.settings.bonusSpellSlots.filter(
              slot => slot.source !== source
            );
            await this.plugin.saveSettings();
            this.plugin.updateSpellSlots();
            this.display();
          }
        });
      }
    });

    new Setting(containerEl)
      .setName('Scan for Bonus Spell Slots (Tags)')
      .setDesc('Scan notes for bonus spell slot tags (e.g., "#1_spellSlot_3") and update auto-scanned bonus slots.')
      .addButton(button => button
        .setButtonText('Scan Tags')
        .onClick(async () => {
          const count = await this.plugin.scanNotesForBonusSpellSlots();
          new Notice(`Scanned and added bonus slots from ${count} tag occurrences.`);
          this.display(); // Refresh the settings page
        })
      );

    new Setting(containerEl)
      .setName('Add Manual Bonus Spell Slot')
      .setDesc('Manually add a bonus spell slot')
      .addDropdown(dropdown => {
        for (let i = 1; i <= 9; i++) {
          dropdown.addOption(i.toString(), `Level ${i}`);
        }
        dropdown.setValue("1");
        dropdown.selectEl.addClass('add-bonus-dropdown');
        return dropdown;
      })
      .addText(text => {
        text.setPlaceholder("Source (e.g., 'Ring of Spell Storing')");
        text.inputEl.addClass('add-bonus-text');
        return text;
      })
      .addButton(button => {
        button.setButtonText('Add');
        button.onClick(async () => {
          const dropdownElement = document.querySelector('.add-bonus-dropdown') as HTMLSelectElement;
          const level = parseInt(dropdownElement?.value || "1");
          const textElement = document.querySelector('.add-bonus-text') as HTMLInputElement;
          const source = textElement?.value || "Manual";    

          // Add new bonus slot
          this.plugin.settings.bonusSpellSlots.push({
            level,
            total: 1,
            used: 0,
            source,
            autoScanned: false // Manual slots are not auto-scanned
          });
          
          await this.plugin.saveSettings();
          this.plugin.updateSpellSlots();
          this.display(); // Refresh the settings page
        });
      });

    
  
		new Setting(containerEl)
			.setName('Character Class')
			.setDesc('Select your character\'s class')
			.addDropdown(dropdown => dropdown
				.addOption('wizard', 'Wizard')
				.addOption('cleric', 'Cleric')
				.addOption('druid', 'Druid')
				.addOption('paladin', 'Paladin')
				.addOption('ranger', 'Ranger')
				.setValue(this.plugin.settings.characterClass)
				.onChange(async (value) => {
					this.plugin.settings.characterClass = value;
          // Update spell slots when class changes
          this.plugin.updateSpellSlots();
					await this.plugin.saveSettings();
          
          // Show notice about spell slots
          new Notice('Spell slots updated based on character class');
				})
			);
			new Setting(containerEl)
  .setName("Give Bonus Spell Slot (test)")
  .setDesc("Add +1 slot to level 3 (for testing or feats)")
  .addButton(btn =>
    btn.setButtonText("Add Slot")
       .onClick(() => {
         this.plugin.addBonusSpellSlot(3, 1, "Test Button");
         new Notice("Added +1 level 3 slot");
         this.display();
       })
  );
  new Setting(containerEl)
  .setName("Give Extra Spell Use (test)")
  .setDesc("Add +1 use to Fireball (for testing or feats)")
  .addButton(btn =>
    btn.setButtonText("Add Use")
       .onClick(() => {
         this.plugin.addExtraSpellUse("Fireball", 1, "Test Button");
         new Notice("Added +1 Fireball use");
         this.display();
       })
  );

      
      new Setting(containerEl)
  .setName('Learn Unknown Spells')
  .setDesc('Select a spell from the Unknown Spells list to learn it.')
  .addDropdown(dropdown => {
    dropdown.addOption('', 'Select a spell...');
    // Populate the dropdown with unknown spells
    this.plugin.settings.unknownSpells.forEach(spell => {
      dropdown.addOption(spell.id, spell.name);
    });
    dropdown.onChange(async (value: string) => {
      if (value) {
        this.plugin.learnSpell(value);
        // Refresh the settings view to update the lists.
        this.display();
      }
    });
  });
  
  new Setting(containerEl)
  .setName("Default Folder for New Spell Notes")
  .setDesc("The folder where new spell notes will be created.")
  .addText(text =>
    text
      .setPlaceholder("Spells")
      .setValue(this.plugin.settings.defaultSpellFolder || "")
      .onChange(async (value) => {
        this.plugin.settings.defaultSpellFolder = value.trim() || "Spells";
        await this.plugin.saveSettings();
      })
  );


      
      new Setting(containerEl)
      .setName('Import Spells from Notes')
      .setDesc('Specify a folder path to import spells from, or leave blank to scan all notes')
      .addText(text => text
        .setPlaceholder('Spells folder path (optional)')
        .setValue(this.plugin.settings.spellFolderPath || '')
        .onChange(async (value) => {
          this.plugin.settings.spellFolderPath = value;
          await this.plugin.saveSettings();
        })
      );

		new Setting(containerEl)
			.setName('Character Level')
			.setDesc('Set your character\'s current level (1-20)')
			.addSlider(slider => slider
				.setLimits(1, 20, 1)
				.setValue(this.plugin.settings.characterLevel)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.characterLevel = value;
          // Update spell slots when level changes
          this.plugin.updateSpellSlots();
					await this.plugin.saveSettings();
          
          // Show notice about spell slots
          new Notice('Spell slots updated based on character level');
				})
			);

      new Setting(containerEl)
    .setName('Global Spell Folder')
    .setDesc('Optional: Specify a folder path to import spells from (will attempt to detect spell level)')
    .addText(text => text
      .setPlaceholder('Spells folder path (optional)')
      .setValue(this.plugin.settings.spellFolderPath || '')
      .onChange(async (value) => {
        this.plugin.settings.spellFolderPath = value;
        await this.plugin.saveSettings();
      })
    );
  
  // Cantrip folder
  new Setting(containerEl)
    .setName('Cantrips Folder')
    .setDesc('Folder path for cantrips (level 0 spells)')
    .addText(text => text
      .setPlaceholder('Cantrips folder path')
      .setValue(this.plugin.settings.cantripFolderPath || '')
      .onChange(async (value) => {
        this.plugin.settings.cantripFolderPath = value;
        await this.plugin.saveSettings();
      })
    );
    
  // Level 1 spells
  new Setting(containerEl)
    .setName('Level 1 Spells Folder')
    .setDesc('Folder path for level 1 spells')
    .addText(text => text
      .setPlaceholder('Level 1 spells folder path')
      .setValue(this.plugin.settings.level1FolderPath || '')
      .onChange(async (value) => {
        this.plugin.settings.level1FolderPath = value;
        await this.plugin.saveSettings();
      })
    );
    // Continue with settings for levels 2-9...
  // defaults:
  // Level 2 spells
new Setting(containerEl)
.setName('Level 2 Spells Folder')
.setDesc('Folder path for level 2 spells')
.addText(text => text
  .setPlaceholder('Level 2 spells folder path')
  .setValue(this.plugin.settings.level2FolderPath || '')
  .onChange(async (value) => {
    this.plugin.settings.level2FolderPath = value;
    await this.plugin.saveSettings();
  })
);

// Level 3 spells
new Setting(containerEl)
.setName('Level 3 Spells Folder')
.setDesc('Folder path for level 3 spells')
.addText(text => text
  .setPlaceholder('Level 3 spells folder path')
  .setValue(this.plugin.settings.level3FolderPath || '')
  .onChange(async (value) => {
    this.plugin.settings.level3FolderPath = value;
    await this.plugin.saveSettings();
  })
);

// Level 4 spells
new Setting(containerEl)
.setName('Level 4 Spells Folder')
.setDesc('Folder path for level 4 spells')
.addText(text => text
  .setPlaceholder('Level 4 spells folder path')
  .setValue(this.plugin.settings.level4FolderPath || '')
  .onChange(async (value) => {
    this.plugin.settings.level4FolderPath = value;
    await this.plugin.saveSettings();
  })
);

// Level 5 spells
new Setting(containerEl)
.setName('Level 5 Spells Folder')
.setDesc('Folder path for level 5 spells')
.addText(text => text
  .setPlaceholder('Level 5 spells folder path')
  .setValue(this.plugin.settings.level5FolderPath || '')
  .onChange(async (value) => {
    this.plugin.settings.level5FolderPath = value;
    await this.plugin.saveSettings();
  })
);

// Level 6 spells
new Setting(containerEl)
.setName('Level 6 Spells Folder')
.setDesc('Folder path for level 6 spells')
.addText(text => text
  .setPlaceholder('Level 6 spells folder path')
  .setValue(this.plugin.settings.level6FolderPath || '')
  .onChange(async (value) => {
    this.plugin.settings.level6FolderPath = value;
    await this.plugin.saveSettings();
  })
);

// Level 7 spells
new Setting(containerEl)
.setName('Level 7 Spells Folder')
.setDesc('Folder path for level 7 spells')
.addText(text => text
  .setPlaceholder('Level 7 spells folder path')
  .setValue(this.plugin.settings.level7FolderPath || '')
  .onChange(async (value) => {
    this.plugin.settings.level7FolderPath = value;
    await this.plugin.saveSettings();
  })
);

// Level 8 spells
new Setting(containerEl)
.setName('Level 8 Spells Folder')
.setDesc('Folder path for level 8 spells')
.addText(text => text
  .setPlaceholder('Level 8 spells folder path')
  .setValue(this.plugin.settings.level8FolderPath || '')
  .onChange(async (value) => {
    this.plugin.settings.level8FolderPath = value;
    await this.plugin.saveSettings();
  })
);

// Level 9 spells
new Setting(containerEl)
.setName('Level 9 Spells Folder')
.setDesc('Folder path for level 9 spells')
.addText(text => text
  .setPlaceholder('Level 9 spells folder path')
  .setValue(this.plugin.settings.level9FolderPath || '')
  .onChange(async (value) => {
    this.plugin.settings.level9FolderPath = value;
    await this.plugin.saveSettings();
  })
);
new Setting(containerEl)
      .setName('Import Now')
      .setDesc('Import spells from notes based on the folder settings above')
      .addButton(button => button
        .setButtonText('Import Spells')
        .onClick(async () => {
          const count = await this.plugin.importSpellsFromNotes();
          new Notice(`Imported ${count} spells from configured folders`);
        })
      );

      new Setting(containerEl)
  .setName('Remove Duplicate Unknown Spells')
  .setDesc('Clean up duplicates from older scans')
  .addButton(button => 
    button.setButtonText('Clean Now')
      .onClick(() => {
        this.plugin.removeDuplicateUnknownSpells();
        this.display(); // Refresh UI
      })
  );
// Extra Spell Uses section
containerEl.createEl('h3', { text: 'Extra Spell Uses (from Tags)' });
containerEl.createEl('p', { 
  text: 'Spells with extra uses from tags like #1fireball' 
});

const extraUsesContainer = containerEl.createDiv({ cls: 'extra-uses-container' });

// Display existing extra spell uses
this.plugin.settings.extraSpellUses.forEach((extraUse, index) => {
  const extraUseDiv = extraUsesContainer.createDiv({ cls: 'extra-use-item' });
  extraUseDiv.createEl('span', { 
    text: `${extraUse.spellName}: ${extraUse.usesRemaining}/${extraUse.uses} uses (from ${extraUse.source || 'unknown'})` 
  });
  
  const removeBtn = extraUseDiv.createEl('button', {
    text: 'Remove',
    cls: 'remove-extra-use-btn'
  });
  removeBtn.addEventListener('click', async () => {
    this.plugin.settings.extraSpellUses.splice(index, 1);
    await this.plugin.saveSettings();
    this.display(); // Refresh the settings page
  });
});

new Setting(containerEl)
  .setName('Scan Notes for Tagged Spells')
  .setDesc('Look for tags like #1fireball in your notes to find extra spell uses')
  .addButton(button => button
    .setButtonText('Scan Now')
    .onClick(async () => {
      const count = await this.plugin.scanNotesForTaggedSpells();
      new Notice(`Found ${count} tagged spells with extra uses`);
      this.display(); // Refresh the settings page
    })
  );

    // Add a button to reset all spell slots
    new Setting(containerEl)
      .setName('Reset Spell Slots')
      .setDesc('Restore all spell slots (as if after a long rest)')
      .addButton(button => button
        .setButtonText('Long Rest')
        .onClick(async () => {
          this.plugin.restoreAllSpellSlots();
          new Notice('All spell slots restored after a long rest!');
        })
      );
      
    // Add information about known spells
    containerEl.createEl('h3', { text: 'Known Spells' });
    
    const spellCount = this.plugin.settings.knownSpells.length;
    const preparedCount = this.plugin.settings.knownSpells.filter(s => s.isPrepared).length;
    
    containerEl.createEl('p', { 
      text: `You currently know ${spellCount} spells and have ${preparedCount} prepared.` 
    });   

    containerEl.createEl('h3', { text: 'Spell Bonuses from YAML Notes' });
    containerEl.createEl('p', { 
      text: 'Scan notes for YAML that provides extra cantrips, prepared spells, spell slots, and specific always-prepared spells' 
    });


    // Display existing general bonuses
    const generalBonusContainer = containerEl.createDiv({ cls: 'general-bonus-container' });
    generalBonusContainer.createEl('h4', { text: 'General Bonuses' });

    this.plugin.settings.spellBonuses.forEach((bonus, index) => {
      const bonusDiv = generalBonusContainer.createDiv({ cls: 'bonus-item' });
      
      let bonusText = '';
      if (bonus.bonusCantrips) bonusText += `+${bonus.bonusCantrips} cantrips `;
      if (bonus.bonusPreparedSpells) bonusText += `+${bonus.bonusPreparedSpells} prepared spells `;
      bonusText += `(${bonus.source || 'Unknown'})`;
      
      bonusDiv.createEl('span', { text: bonusText });
      
      const removeBtn = bonusDiv.createEl('button', {
        text: 'Remove',
        cls: 'remove-bonus-btn'
      });
      removeBtn.addEventListener('click', async () => {
        this.plugin.settings.spellBonuses.splice(index, 1);
        await this.plugin.saveSettings();
        this.display();
      });
    });

    // Display existing specific prepared spells
    const specificBonusContainer = containerEl.createDiv({ cls: 'specific-bonus-container' });
    specificBonusContainer.createEl('h4', { text: 'Specific Always-Prepared Spells' });

    this.plugin.settings.bonusPreparedSpells.forEach((bonusSpell, index) => {
      const bonusDiv = specificBonusContainer.createDiv({ cls: 'bonus-prepared-item' });
      
      const statusIcon = bonusSpell.isActive ? '✅' : '⭕';
      const statusText = bonusSpell.isActive ? 'ACTIVE' : 'available';
      
      bonusDiv.createEl('span', { 
        text: `${statusIcon} ${bonusSpell.spellName} (${bonusSpell.source}) - ${statusText}`
      });
      
      const removeBtn = bonusDiv.createEl('button', {
        text: 'Remove',
        cls: 'remove-bonus-btn'
      });
      removeBtn.addEventListener('click', async () => {
        // Se o spell estava ativo, despreparar ele primeiro
        if (bonusSpell.isActive) {
          const knownSpell = this.plugin.settings.knownSpells.find(
            s => s.name.toLowerCase() === bonusSpell.spellName.toLowerCase()
          );
          if (knownSpell) {
            knownSpell.isPrepared = false;
          }
        }
        
        this.plugin.settings.bonusPreparedSpells.splice(index, 1);
        await this.plugin.saveSettings();
        this.plugin.refreshAllViews();
        this.display();
      });
    });

    // Dropdown unificado para escanear nota
    new Setting(containerEl)
      .setName('Scan Note for All Bonuses')
      .setDesc('Select a note to scan for ALL types of spell bonuses: general limits, specific spells, AND bonus spell slots')
      .addDropdown(dropdown => {
        dropdown.addOption('', 'Select a note...');
        
        const markdownFiles = this.app.vault.getMarkdownFiles();
        markdownFiles.forEach(file => {
          dropdown.addOption(file.path, file.basename);
        });
        
        dropdown.onChange(async (selectedPath: string) => {
          if (selectedPath) {
            const file = this.app.vault.getAbstractFileByPath(selectedPath) as TFile;
            if (file) {
              const result = await this.plugin.scanSpecificNoteForAllBonuses(file);
              
              let message = '';
              let foundSomething = false;
              
              if (result.spellBonuses) {
                message += `Found general bonuses. `;
                foundSomething = true;
              }
              if (result.preparedBonuses.length > 0) {
                message += `Found ${result.preparedBonuses.length} specific prepared spells. `;
                foundSomething = true;
              }
              if (result.slotBonuses.length > 0) {
                const totalSlots = result.slotBonuses.reduce((sum, slot) => sum + slot.total, 0);
                message += `Found ${totalSlots} bonus spell slots. `;
                foundSomething = true;
              }
              
              if (!foundSomething) {
                message = `No bonuses found in "${file.basename}"`;
              } else {
                message += `in "${file.basename}"`;
              }
              
              new Notice(message);
              
              // Update spell slots if any were found
              if (result.slotBonuses.length > 0) {
                this.plugin.updateSpellSlots();
              }
              
              this.display();
            }
          }
        });
      });

    // ===============================================
    // SEÇÃO DE ADICIONAR BÔNUS MANUAIS
    // ===============================================

    containerEl.createEl('h4', { text: 'Add Manual Bonuses' });

    // Adicionar bônus gerais manuais
    new Setting(containerEl)
      .setName('Add General Bonus (Manual)')
      .setDesc('Manually add bonus cantrips and/or prepared spells')
      .addText(text => {
        text.setPlaceholder("Bonus cantrips (number)");
        text.inputEl.addClass('manual-bonus-cantrips-input');
        return text;
      })
      .addText(text => {
        text.setPlaceholder("Bonus prepared spells (number)");
        text.inputEl.addClass('manual-bonus-prepared-input');
        return text;
      })
      .addText(text => {
        text.setPlaceholder("Source name");
        text.inputEl.addClass('manual-bonus-source-input');
        return text;
      })
      .addButton(button => {
        button.setButtonText('Add General Bonus');
        button.onClick(async () => {
          const cantripsInput = document.querySelector('.manual-bonus-cantrips-input') as HTMLInputElement;
          const preparedInput = document.querySelector('.manual-bonus-prepared-input') as HTMLInputElement;
          const sourceInput = document.querySelector('.manual-bonus-source-input') as HTMLInputElement;
          
          const bonusCantrips = parseInt(cantripsInput?.value || "0") || 0;
          const bonusPrepared = parseInt(preparedInput?.value || "0") || 0;
          const source = sourceInput?.value || "Manual";
          
          if (bonusCantrips > 0 || bonusPrepared > 0) {
            this.plugin.settings.spellBonuses.push({
              bonusCantrips: bonusCantrips > 0 ? bonusCantrips : undefined,
              bonusPreparedSpells: bonusPrepared > 0 ? bonusPrepared : undefined,
              source: source
            });
            
            await this.plugin.saveSettings();
            
            // Clear inputs
            if (cantripsInput) cantripsInput.value = '';
            if (preparedInput) preparedInput.value = '';
            if (sourceInput) sourceInput.value = '';
            
            new Notice(`Added general bonus: +${bonusCantrips} cantrips, +${bonusPrepared} prepared spells`);
            this.display();
          } else {
            new Notice('Please enter at least one bonus value');
          }
        });
      });

    // Adicionar spell específico manual
    new Setting(containerEl)
      .setName('Add Specific Prepared Spell (Manual)')
      .setDesc('Manually add a specific spell that can always be prepared')
      .addText(text => {
        text.setPlaceholder("Spell name (e.g., Fireball)");
        text.inputEl.addClass('manual-specific-spell-input');
        return text;
      })
      .addText(text => {
        text.setPlaceholder("Source name");
        text.inputEl.addClass('manual-specific-source-input');
        return text;
      })
      .addButton(button => {
        button.setButtonText('Add Specific Spell');
        button.onClick(async () => {
          const spellInput = document.querySelector('.manual-specific-spell-input') as HTMLInputElement;
          const sourceInput = document.querySelector('.manual-specific-source-input') as HTMLInputElement;
          
          const spellName = spellInput?.value?.trim() || '';
          const source = sourceInput?.value?.trim() || 'Manual';
          
          if (spellName) {
            // Check if this spell already exists from the same source
            const existing = this.plugin.settings.bonusPreparedSpells.find(
              bonus => bonus.spellName.toLowerCase() === spellName.toLowerCase() && bonus.source === source
            );
            
            if (existing) {
              new Notice(`"${spellName}" from "${source}" already exists`);
              return;
            }
            
            this.plugin.settings.bonusPreparedSpells.push({
              spellName: spellName,
              source: source,
              isActive: false
            });
            
            await this.plugin.saveSettings();
            
            // Clear inputs
            if (spellInput) spellInput.value = '';
            if (sourceInput) sourceInput.value = '';
            
            new Notice(`Added specific prepared spell: "${spellName}" from "${source}"`);
            this.display();
          } else {
            new Notice('Please enter a spell name');
          }
        });
      });

    // Botão para adicionar múltiplos spells específicos de uma vez
    new Setting(containerEl)
      .setName('Add Multiple Specific Spells (Manual)')
      .setDesc('Add multiple spells separated by commas')
      .addTextArea(text => {
        text.setPlaceholder("Spell names separated by commas\nExample: Shield, Mage Armor, Magic Missile");
        text.inputEl.addClass('manual-multiple-spells-input');
        text.inputEl.style.height = '60px';
        return text;
      })
      .addText(text => {
        text.setPlaceholder("Source name");
        text.inputEl.addClass('manual-multiple-source-input');
        return text;
      })
      .addButton(button => {
        button.setButtonText('Add Multiple Spells');
        button.onClick(async () => {
          const spellsInput = document.querySelector('.manual-multiple-spells-input') as HTMLTextAreaElement;
          const sourceInput = document.querySelector('.manual-multiple-source-input') as HTMLInputElement;
          
          const spellsText = spellsInput?.value?.trim() || '';
          const source = sourceInput?.value?.trim() || 'Manual';
          
          if (spellsText) {
            const spellNames = spellsText.split(',').map(s => s.trim()).filter(s => s);
            let addedCount = 0;
            
            for (const spellName of spellNames) {
              // Check if this spell already exists from the same source
              const existing = this.plugin.settings.bonusPreparedSpells.find(
                bonus => bonus.spellName.toLowerCase() === spellName.toLowerCase() && bonus.source === source
              );
              
              if (!existing) {
                this.plugin.settings.bonusPreparedSpells.push({
                  spellName: spellName,
                  source: source,
                  isActive: false
                });
                addedCount++;
              }
            }
            
            if (addedCount > 0) {
              await this.plugin.saveSettings();
              
              // Clear inputs
              if (spellsInput) spellsInput.value = '';
              if (sourceInput) sourceInput.value = '';
              
              new Notice(`Added ${addedCount} specific prepared spells from "${source}"`);
              this.display();
            } else {
              new Notice('All spells already exist or no valid spells provided');
            }
          } else {
            new Notice('Please enter at least one spell name');
          }
        });
      });
	
	new Setting(containerEl)
  .setName("Limpar magias desconhecidas aprendidas")
  .setDesc("Remove da lista de Unknown todas as magias que já foram aprendidas")
  .addButton(btn => 
    btn.setButtonText("🧹 Limpar Unknown")
      .setCta()
      .onClick(async () => {
        const before = this.plugin.settings.unknownSpells.length;

        this.plugin.settings.unknownSpells = this.plugin.settings.unknownSpells.filter(
          s => !this.plugin.settings.knownSpells.some(
            k => k.name.toLowerCase().trim() === s.name.toLowerCase().trim()
          )
        );

        const after = this.plugin.settings.unknownSpells.length;
        const removed = before - after;

        await this.plugin.saveSettings();
        new Notice(`🧙‍♂️ Removidas ${removed} magias da lista de Unknown.`);
      })
  );

    
    new Setting(containerEl)
      .setName('Manage Spells')
      .setDesc('Open the spellbook to add, remove, or prepare spells')
      .addButton(button => button
        .setButtonText('Open Spellbook')
        .onClick(async () => {
          await this.plugin.activateView();
        })
      );
      new Setting(containerEl)
  .setName('Unknown Spells')
  .setDesc('View and manage unknown spells.')
  .addButton(button => button
    .setButtonText('Open Unknown Spells')
    .onClick(async () => {
      await this.plugin.activateUnknownSpellsView();
    })
  );

  new Setting(containerEl)
  .setName('Intelligence Modifier')
  .setDesc('Set your character’s Intelligence modifier (affects the number of prepared spells).')
  .addSlider(slider => slider
    .setLimits(-5, 10, 1)
    .setValue(this.plugin.settings.intelligenceModifier)
    .setDynamicTooltip()
    .onChange(async (value) => {
      this.plugin.settings.intelligenceModifier = value;
      await this.plugin.saveSettings();
      new Notice('Intelligence Modifier updated.');
    })
  );
  new Setting(containerEl)
    .setName("Status de Preparação")
    .setDesc(`Aqui você pode ver um resumo de seus truques e magias.`)
    .addTextArea(text => {
        // Calcula os totais
        const preparedCantrips = countNonBonusPreparedSpells(
          this.plugin.settings.knownSpells, 
          this.plugin.settings.bonusPreparedSpells, 
          0
        );
        const preparedSpells = countNonBonusPreparedSpells(
          this.plugin.settings.knownSpells.filter(s => s.level > 0), 
          this.plugin.settings.bonusPreparedSpells
        );
        const maxCantrips = getCantripsKnownCountWithBonus(this.plugin.settings.characterClass, this.plugin.settings.characterLevel, this.plugin.settings.spellBonuses);
        const maxPreparedSpells = getPreparedSpellsMaxCountWithBonus(this.plugin.settings.intelligenceModifier, this.plugin.settings.characterLevel, this.plugin.settings.spellBonuses);
        // Define o valor e o placeholder da área de texto
         text.setValue(`Truques: ${preparedCantrips}/${maxCantrips}\nMagias Preparadas: ${preparedSpells}/${maxPreparedSpells}`);
        
        // Desabilita a área de texto para que seja apenas leitura
        text.inputEl.setAttr("readonly", true);
        
        // Ajusta a altura para caber o conteúdo
        text.inputEl.style.height = '4em'; 
        text.inputEl.style.resize = 'none';
        text.inputEl.style.backgroundColor = 'var(--background-secondary)';
    });
	}
}