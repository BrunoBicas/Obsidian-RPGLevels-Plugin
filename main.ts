import { App, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, Notice, Modal, TFolder, TAbstractFile, FuzzySuggestModal, MarkdownRenderer } from 'obsidian';
import { Dice } from "./dice";


interface CharacterStats {
	Strength: number;
	Dexterity: number;
	Constitution: number;
	Intelligence: number;
	Wisdom: number;
	Charisma: number;
}


interface CharacterDefenses {
    resistances: { [damageType: string]: string[] }; // Fontes de resistência
    immunities: { [damageType: string]: string[] };  // Fontes de imunidade
    // vulnerabilities?: { [damageType: string]: string[] }; // Para expansão futura
}

interface EffectData {
  notePath: string;
  startDate?: string;
  durationDays?: number;
  permanent?: boolean;
  active: boolean;
  hpBonus?: number;
  tempHP?: number;
  [key: string]: any;
}

interface HealthData {
  baseDie: number;
  autoHpMode: "rolar" | "media" | "maximo";
  hpPerLevel: number[];
  maxHP: number;
  currentHP: number;
  tempHP: number; // This will store temp HP from items/effects
  manualTempHP?: number; // Temp HP from manual grants
  lastMaxHP: number;
}

interface SkillDefinition {
    name: string;
    baseAbility: keyof CharacterStats; // e.g., "Dexterity"
}

interface LoadedSkillDefinition {
    id: string; // Nome do arquivo sem .md (e.g., "Acrobatics")
    displayName: string; // Nome para exibição
    baseAbility: keyof CharacterStats;
    filePath: string; // Path completo da nota, para referência
}

interface TrainingEntry {
  weekStart: string;
  lastAttempt?: string;
  attempts: number;
  success: boolean;
}


interface RPGLevelsSettings {
	currentXP: number;
	level: number;
	characterStats: CharacterStats;
	xpToNextLevel: number;
	obtainedFeats: string[]; // List of note paths or names
    featFolders: string[]; // All possible feats (also note paths or names)
	featPoints: number;
    extraFeatPointsGranted: number; // contador para bônus a cada 200k XP
    spentFeatPoints: {
	 feats: string[];
	 statIncreases: { [stat: string]: number };
    };
	effectFolders: string[];
	repeatableEffectFolders: string[];    // efeitos que podem ser aplicados várias vezes
    effects: { [id: string]: EffectData };
	xpGainRates: {
		createNote: number;
		editNote: number;
		createLink: number;
		addTag: number;
		dailyStreak: number;
		taskEasy: number;
        taskMedium: number; 
        taskHard: number;
		questComplete: number;
	};
	
	health: HealthData;

	trainingLog: Record<number, TrainingEntry>;
 

	quests: {
		[id: string]: {
			title: string;
			description: string;
			xpReward: number;
			respawnDays: number; // How many days before the quest reappears
			lastCompleted: string; // Date string when last completed
			availableDate: string; // Optional specific date when the quest is available
			completed: boolean;
		}
	};
	questNoteLinks?: { [id: string]: string };
	achievements: {
		[key: string]: boolean;
	};
	characterImagePath?: string; // na interface
    characterNotePath?: string;
	lastActive: string;
	streakDays: number;
	dailyXpAwarded: boolean;
	initializedNoteCount: boolean;
	editDebounceTime: number; // Time in milliseconds to wait before awarding edit XP
	minEditLength: number; // Minimum number of characters changed to award XP
	damageTypes: string[];
    defenses: CharacterDefenses;
	proficiencyBonus: number; //
    proficiencies: { /* ... */ }; //
    skillProficiencies: {
        [skillName: string]: {
            level: "none" | "proficient" | "expert";
            sources: string[]; // Paths das notas de feat/effect
        }
    };
	skillFolders: string[];
}

const DEFAULT_SETTINGS: RPGLevelsSettings = {
	currentXP: 0,
	level: 1,
	xpToNextLevel: 100,
	characterStats: {
		Strength: 10,
		Dexterity: 10,
		Constitution: 10,
		Intelligence: 10,
		Wisdom: 10,
		Charisma: 10,
	  },
	health: {
  baseDie: 8,
  autoHpMode: "rolar",
  hpPerLevel: [8],
  maxHP: 8,
  currentHP: 8,
  lastMaxHP: 0,
  tempHP: 0, // Temp HP from items/effects
  manualTempHP: 0 // Temp HP from manual grants
 },

    trainingLog: {},
	damageTypes: [
        'Slashing', 'Piercing', 'Bludgeoning', 'Fire', 'Cold', 'Lightning',
        'Thunder', 'Poison', 'Acid', 'Psychic', 'Necrotic', 'Radiant', 'Force',
        'Typeless' // Dano sem tipo específico
    ],
    defenses: {
        resistances: {},
        immunities: {}
    },
	proficiencyBonus: 2, //
    proficiencies: { /* ... */ }, //


    skillProficiencies: {}, // Será populado por applyAllPassiveEffects
	skillFolders: [],

	


	effectFolders: [],
	repeatableEffectFolders: [],
    effects: {},
	obtainedFeats: [],
    featFolders: [], // You manually populate this in settings
	featPoints: 0,
	extraFeatPointsGranted: 0,
	spentFeatPoints: {
		feats: [],
		statIncreases: {
			Strength: 0,
			Dexterity: 0,
			Constitution: 0,
			Intelligence: 0,
			Wisdom: 0,
			Charisma: 0
		}
	},
	quests: {},
	questNoteLinks: {},
	xpGainRates: {
		createNote: 10,
		editNote: 5,
		createLink: 3,
		addTag: 2,
		dailyStreak: 20,
		taskEasy: 5,
        taskMedium: 15,
        taskHard: 30,
		questComplete: 0 // Pode deixar como 0, já que o valor real virá do próprio quest
	},
	characterImagePath: '', // em DEFAULT_SETTINGS
    characterNotePath: '',
	achievements: {
		"first_note": false,
		"reach_level_5": false,
		"create_10_notes": false,
		"create_50_links": false,
		"7_day_streak": false
	},
	lastActive: '',
	streakDays: 0,
	dailyXpAwarded: false,
	initializedNoteCount: false,
	editDebounceTime: 10000, // Default: 10 seconds
	minEditLength: 20 // Default: 20 characters
};

function calcularHPPorNivel(baseDie: number, modo: "rolar" | "media" | "maximo"): number {
  const dado = new Dice(baseDie);
  if (modo === "rolar") return dado.roll();
  if (modo === "media") return dado.average();
  return dado.sides; // modo === "maximo"
}

// Define a type for achievement info
interface AchievementInfo {
	title: string;
	description: string;
}

// Define a type for the achievements dictionary
type AchievementsDict = {
	[key: string]: AchievementInfo;
};

export default class RPGLevelsPlugin extends Plugin {
	settings: RPGLevelsSettings;
	statusBarEl: HTMLElement;
	linkCount: number = 0;
	noteCount: number = 0;
	isInitializing: boolean = true; // Flag to track initialization state
	
	isEffectExpired(effect: EffectData): boolean {
  if (effect.permanent || !effect.startDate || !effect.durationDays) return false;

  const start = new Date(effect.startDate);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= effect.durationDays;
 } 

 public getAbilityModifier(statValue: number): number {
    return Math.floor((statValue - 10) / 2);
 }
  // Calculate Proficiency Bonus based on D&D 5e rules
 public calculateProficiencyBonus(): number {
    const level = this.settings.level;
    if (level >= 17) return 6;
    if (level >= 13) return 5;
    if (level >= 9) return 4;
    if (level >= 5) return 3;
    return 2; // Levels 1-4
  }

  public async loadSkillDefinitions(): Promise<LoadedSkillDefinition[]> {
    const loadedSkills: LoadedSkillDefinition[] = [];
    if (!this.settings.skillFolders || this.settings.skillFolders.length === 0) {
        return [];
    }

    for (const folderPath of this.settings.skillFolders) {
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (folder instanceof TFolder) {
            for (const file of folder.children) {
                if (file instanceof TFile && file.extension === "md") {
                    const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
                    if (metadata && metadata.baseAbility) {
                        const baseAbility = metadata.baseAbility as keyof CharacterStats;
                        // Valida se baseAbility é uma chave válida de CharacterStats
                        if (Object.keys(this.settings.characterStats).includes(baseAbility)) {
                            const skillId = file.basename; // Nome do arquivo sem extensão
                            loadedSkills.push({
                                id: skillId,
                                displayName: metadata.displayName || skillId, // Usa displayName do frontmatter ou o nome do arquivo
                                baseAbility: baseAbility,
                                filePath: file.path
                            });
                        } else {
                            new Notice(`Skill note "${file.path}" has an invalid baseAbility: ${baseAbility}. Skipping.`);
                        }
                    } else {
                        // Opcional: Avisar sobre notas de skill sem frontmatter 'baseAbility'
                        // new Notice(`Skill note "${file.path}" is missing 'baseAbility' in frontmatter. Skipping.`);
                    }
                }
            }
        }
    }
    // Ordenar alfabeticamente pelo displayName para consistência na UI
    loadedSkills.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return loadedSkills;
  }
  

 public getEffectsFromSpecificFolder(folderPath: string, activeEffectPathsToExclude: string[] = [], allowDuplicates: boolean): TFile[] {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    const availableEffects: TFile[] = [];
    if (folder instanceof TFolder) { // [cite: 65]
        for (const child of folder.children) { // [cite: 65]
            if (child instanceof TFile && child.extension === "md") { // [cite: 65]
                if (allowDuplicates || !activeEffectPathsToExclude.includes(child.path)) {
                    availableEffects.push(child);
                }
            }
        }
    }
    return availableEffects;
 }

 getDaysRemaining(effect: EffectData): number | null {
  if (effect.permanent || !effect.startDate || !effect.durationDays) return null;

  const start = new Date(effect.startDate);
  const now = new Date();
  const diff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  const remaining = effect.durationDays - diff;
  return remaining > 0 ? remaining : 0;
 }

 getTimeRemaining(effect: EffectData): { days: number; hours: number } | null {
  if (effect.permanent || !effect.startDate || !effect.durationDays) return null;

  const start = new Date(effect.startDate);
  const now = new Date();

  const msTotal = start.getTime() + effect.durationDays * 24 * 60 * 60 * 1000 - now.getTime();
  if (msTotal <= 0) return { days: 0, hours: 0 };

  const days = Math.floor(msTotal / (1000 * 60 * 60 * 24));
  const hours = Math.floor((msTotal % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  return { days, hours };
}



	
	// New variables for edit tracking
	private editTimer: NodeJS.Timeout | null = null;
	private currentEditFile: string | null = null;
	private originalContent: string = '';
	private hasActiveFile: boolean = false; // New flag to track if we have an active file
	
	async onload() {
		await this.loadSettings();
		
		// Add status bar item to show current level and XP
		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar();

		this.addRibbonIcon("dice", "Show Character Stats", () => {
			new StatsModal(this.app, this).open();
		});
		
		this.addCommand({
			id: "open-character-stats",
			name: "Open Character Stats",
			callback: () => {
				new StatsModal(this.app, this).open();
			}
		});
		
		
		// Add settings tab
		this.addSettingTab(new RPGLevelsSettingTab(this.app, this));
		
		// Initialize note count without awarding XP
		try {
			const files = await this.app.vault.getMarkdownFiles();
			this.noteCount = files.length;
			// Just check achievements for already earned ones
			this.checkAchievementsNoXP();
		} catch (error) {
			console.error("Error initializing note count:", error);
			this.noteCount = 0;
		}
		
		// Wait a short time before registering events to ensure initialization is complete
		setTimeout(() => {
			this.isInitializing = false; // Initialization is complete
			
			// Register events to earn XP - only after initialization
			this.registerEvent(
				this.app.vault.on('create', (file) => {
					if (file instanceof TFile && file.extension === 'md') {
						this.noteCount++;
						// Only award XP if we're not in initialization
						if (!this.isInitializing) {
							this.awardXP('createNote', `Created note: +${this.settings.xpGainRates.createNote}XP`);
							this.checkAchievements();
						}
					}
				}),
			);
			
			// Modified to start tracking edits and initialize the current file right away
			this.registerEvent(
				this.app.workspace.on('file-open', async (file) => {
					if (file instanceof TFile && file.extension === 'md') {
						// Store the original content when a file is opened
						this.currentEditFile = file.path;
						this.originalContent = await this.app.vault.read(file);
						this.hasActiveFile = true; // Mark that we have an active file
					}
				})
			);
			
			// Track when a file is modified
			this.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (file instanceof TFile && file.extension === 'md' && !this.isInitializing) {
						this.handleFileModified(file);
					}
				})
			);
			
			// Track internal links
			this.registerEvent(
				this.app.workspace.on('editor-change', (editor) => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view) {
						const text = editor.getValue();
						const linkCountNew = (text.match(/\[\[.*?\]\]/g) || []).length;
						
						if (linkCountNew > this.linkCount) {
							const diff = linkCountNew - this.linkCount;
							for (let i = 0; i < diff; i++) {
								this.awardXP('createLink', `Created link: +${this.settings.xpGainRates.createLink}XP`);
							}
							this.linkCount = linkCountNew;
							this.checkAchievements();
						}
					}
				})
			);
			
			// Track tags
			this.registerEvent(
				this.app.workspace.on('editor-change', (editor) => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view) {
						const text = editor.getValue();
						const currentTags = text.match(/#[a-zA-Z0-9_-]+/g) || [];
						const prevContent = view.data;
						const prevTags = prevContent.match(/#[a-zA-Z0-9_-]+/g) || [];
						
						if (currentTags.length > prevTags.length) {
							this.awardXP('addTag', `Added tag: +${this.settings.xpGainRates.addTag}XP`);
						}
					}
				})
			);
			// Track task completion
			this.registerEvent(
				this.app.workspace.on('editor-change', (editor) => {
					// Get the active view to determine which file is being edited
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					
					// Only proceed if we have a valid markdown view
					if (view && view.file) {
						// Get the name of the file being edited
						const fileName = view.file.basename;
						
						// Check if this is a daily tasks note (by checking the filename)
						if (fileName.includes('Daily Tasks') || fileName.includes('daily tasks')) {
							// Get the current text and cursor position
							const text = editor.getValue();
							const cursorPos = editor.getCursor();
							const line = editor.getLine(cursorPos.line);
							
							// This regex checks for a task that was just checked AND has a difficulty tag
							// But doesn't already have the "completed" marker
							if (line.match(/- \[x\] .+#(easy|medium|hard)/i) && 
								!line.match(/- \[x\] .+#(easy|medium|hard) \(completed\)/i)) {
								
								// Determine which difficulty level this task has
								let xpAmount = this.settings.xpGainRates.taskEasy; // Default
								let difficultyName = 'easy';
								
								if (line.toLowerCase().includes('#medium')) {
									xpAmount = this.settings.xpGainRates.taskMedium;
									difficultyName = 'medium';
								}
								if (line.toLowerCase().includes('#hard')) {
									xpAmount = this.settings.xpGainRates.taskHard;
									difficultyName = 'hard';
								}
								
								// Add XP directly without using awardXP to avoid type issues
								this.settings.currentXP += xpAmount;
								
								// Check if level up
								if (this.settings.currentXP >= this.settings.xpToNextLevel) {
									this.levelUp();
								} else {
									this.updateStatusBar();
									this.saveSettings();
									new Notice(`Completed ${difficultyName} task: +${xpAmount}XP`);
								}
								
								// Mark task as completed to prevent giving XP multiple times
								const newLine = line + ' (completed)';
								editor.setLine(cursorPos.line, newLine);
							}
						}
					}
				})
			);
			
			// Check for daily streak when Obsidian loads, but only award XP once per day
			this.checkDailyStreak();

			// ADDED: Initialize with currently open file, if any
			this.initializeCurrentFile();
		}, 1000); // 1 second delay
		await this.applyAllPassiveEffects();

		
		// Add commands
		this.addCommand({
			id: 'view-rpg-stats',
			name: 'View RPG Stats',
			callback: () => {
				this.showStatsModal();
			}
		});

		this.addCommand({
			id: 'view-quests',
			name: 'View Available Quests',
			callback: () => {
				this.showQuestsModal();
			}
		});
	}
	getAvailableFeatsFromFolders(): string[] {
		const feats: string[] = [];
	
		for (const folderPath of this.settings.featFolders) {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (folder instanceof TFolder) {
				for (const file of folder.children) {
					if (file instanceof TFile && file.extension === "md") {
						feats.push(file.path);
					}
				}
			}
		}
	
		return feats;
	}

   getAvailableEffectsFromFolders(): string[] {
   const effects: string[] = [];

   for (const folderPath of this.settings.effectFolders) {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      for (const file of folder.children) {
        if (file instanceof TFile && file.extension === "md") {
          effects.push(file.path);
        }
      }
    }
   }

   return effects;
  }

  getAvailableRepeatableEffects(): string[] {
  const effects: string[] = [];

  for (const folderPath of this.settings.repeatableEffectFolders) {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      for (const file of folder.children) {
        if (file instanceof TFile && file.extension === "md") {
          effects.push(file.path);
        }
      }
    }
  }

  return effects;
 }

 async applyAllPassiveEffects() {
    const statsBase = { // [cite: 74]
        Strength: 10, Dexterity: 10, Constitution: 10, Intelligence: 10, Wisdom: 10, Charisma: 10 // [cite: 74]
    };
    const statBonus: Partial<CharacterStats> = { // [cite: 75]
        Strength: 0, Dexterity: 0, Constitution: 0, Intelligence: 0, Wisdom: 0, Charisma: 0 // [cite: 75]
    };
    let featHpBonus = 0; // [cite: 76]
    let featTempHP = 0; // [cite: 76]

    // Inicializa ou limpa defesas para reconstrução
    if (!this.settings.defenses) {
        this.settings.defenses = { resistances: {}, immunities: {} };
    } else {
        this.settings.defenses.resistances = {};
        this.settings.defenses.immunities = {};
    }
	// NOVA INICIALIZAÇÃO PARA SKILL PROFICIENCIES
    this.settings.skillProficiencies = {};

    const allSources = [ // [cite: 76]
        ...this.settings.obtainedFeats, // [cite: 76]
        ...Object.values(this.settings.effects).filter(e => e.active && !this.isEffectExpired(e)).map(e => e.notePath) // [cite: 76]
    ];

    // Garante que hpPerLevel tenha entradas suficientes
    while (this.settings.health.hpPerLevel.length < this.settings.level) { // [cite: 77]
        this.settings.health.hpPerLevel.push(calcularHPPorNivel(this.settings.health.baseDie, this.settings.health.autoHpMode)); // Similar to [cite: 77, 111]
    }

    for (const path of allSources) { // [cite: 77]
        const data = await this.loadEffectFromNote(path); // [cite: 77]
        if (data.hpBonus) featHpBonus += data.hpBonus; // [cite: 78]
        if (data.tempHP) featTempHP = Math.max(featTempHP, data.tempHP); // [cite: 78]

        for (const [key, value] of Object.entries(data)) { // [cite: 79]
            if (key in statBonus && typeof value === "number") { // [cite: 79]
                (statBonus[key as keyof CharacterStats]! as number) += value; // [cite: 79, 80]
            }
        }

        // Processar resistências concedidas
        if (data.grantsResistances && Array.isArray(data.grantsResistances)) {
            data.grantsResistances.forEach(type => {
                if (typeof type === 'string') { // Checagem de tipo
                    if (!this.settings.defenses.resistances[type]) {
                        this.settings.defenses.resistances[type] = [];
                    }
                    if (!this.settings.defenses.resistances[type].includes(path)) {
                        this.settings.defenses.resistances[type].push(path);
                    }
                }
            });
        }

        // Processar imunidades concedidas
        if (data.grantsImmunities && Array.isArray(data.grantsImmunities)) {
            data.grantsImmunities.forEach(type => {
                if (typeof type === 'string') { // Checagem de tipo
                    if (!this.settings.defenses.immunities[type]) {
                        this.settings.defenses.immunities[type] = [];
                    }
                    if (!this.settings.defenses.immunities[type].includes(path)) {
                        this.settings.defenses.immunities[type].push(path);
                    }
                }
            });
        }

		const processSkillLevel = (skillName: string, level: "proficient" | "expert", sourcePath: string) => {
            if (!this.settings.skillProficiencies[skillName]) {
                this.settings.skillProficiencies[skillName] = { level: "none", sources: [] };
            }

            const current = this.settings.skillProficiencies[skillName];
            // Expertise sobrescreve proficiência. Proficiência sobrescreve none.
            if (level === "expert") {
                current.level = "expert";
            } else if (level === "proficient" && current.level !== "expert") {
                current.level = "proficient";
            }

            if (!current.sources.includes(sourcePath)) {
                current.sources.push(sourcePath);
            }
        };

        if (data.grantsSkillProficiency && Array.isArray(data.grantsSkillProficiency)) {
            data.grantsSkillProficiency.forEach(skillName => {
                if (typeof skillName === 'string') { //
                    processSkillLevel(skillName, "proficient", path);
                }
            });
        }
        if (data.grantsSkillExpertise && Array.isArray(data.grantsSkillExpertise)) {
            data.grantsSkillExpertise.forEach(skillName => {
                if (typeof skillName === 'string') { //
                    processSkillLevel(skillName, "expert", path);
                }
            });
        }
    }
	

    const statLevelBonus = Math.floor(this.settings.level / 4); // [cite: 80]
    const finalStats: CharacterStats = {} as CharacterStats; // [cite: 81]

    for (const key of Object.keys(statsBase)) { // [cite: 81]
        finalStats[key as keyof CharacterStats] = // [cite: 81]
            statsBase[key as keyof CharacterStats]! + // [cite: 81, 82]
            statLevelBonus + // [cite: 82]
            (this.settings.spentFeatPoints.statIncreases[key as keyof CharacterStats] ?? 0) + // [cite: 82]
            (statBonus[key as keyof CharacterStats] ?? 0); // [cite: 82]
    }

    this.settings.characterStats = finalStats; // [cite: 83]
    
    // Health
    const baseHP = this.settings.health.hpPerLevel.reduce((a, b) => a + b, 0); // [cite: 83]
    const conMod = Math.floor((this.settings.characterStats.Constitution -10) / 2); // Similar to [cite: 84, 109]
    const conBonusHP = conMod * this.settings.level; // [cite: 84]
    const newMaxHP = baseHP + featHpBonus + conBonusHP; // [cite: 85]

    // ATUALIZAÇÃO PARA TEMP HP (considerando manualTempHP)
    this.settings.health.tempHP = featTempHP; // Armazena temp HP de itens/efeitos
    // O tempHP efetivo será max(itemTempHP, manualTempHP) no momento do uso/exibição

    this.settings.health.maxHP = newMaxHP; // [cite: 85]

    const currentHP = this.settings.health.currentHP; // [cite: 85]
    const lastMaxHP = this.settings.health.lastMaxHP ?? 0; // [cite: 86]

    if (newMaxHP > lastMaxHP) { // [cite: 86]
        const delta = newMaxHP - lastMaxHP; // [cite: 86]
        this.settings.health.currentHP = Math.min(currentHP + delta, newMaxHP); // [cite: 87]
    } else if (newMaxHP < lastMaxHP && currentHP > newMaxHP) { // Adaptado de [cite: 87, 88]
        // Se perdeu maxHP e currentHP está acima do novo maxHP,
        // o excesso não vira tempHP automaticamente aqui, a menos que uma regra específica dite.
        // Geralmente, currentHP é limitado ao novo maxHP.
        // A lógica original de converter excesso em tempHP é mais uma regra de casa.
        // Mantendo simples por enquanto:
        this.settings.health.currentHP = Math.min(currentHP, newMaxHP);
        // Se quiser a lógica de overflow para tempHP:
        // const overflow = currentHP - newMaxHP;
        // if (overflow > 0) {
        //    this.settings.health.currentHP = newMaxHP;
        //    this.settings.health.manualTempHP = Math.max(this.settings.health.manualTempHP ?? 0, overflow);
        // }
    }


    this.settings.health.lastMaxHP = newMaxHP; // [cite: 89]
	this.settings.proficiencyBonus = this.calculateProficiencyBonus();
    await this.saveSettings(); // [cite: 89]
}


	

	// New method to initialize with currently open file
	async initializeCurrentFile() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.file) {
			this.currentEditFile = activeView.file.path;
			this.originalContent = await this.app.vault.read(activeView.file);
			this.hasActiveFile = true;
			
			// Count existing links in the current file
			const text = activeView.editor.getValue();
			this.linkCount = (text.match(/\[\[.*?\]\]/g) || []).length;
		}
	}
	
	// New method to handle file modifications
	async handleFileModified(file: TFile) {
		// Clear any existing timer
		if (this.editTimer) {
			clearTimeout(this.editTimer);
		}
		
		// Set a new timer to award XP after the debounce time
		this.editTimer = setTimeout(async () => {
			try {
				// Only process if this is the currently edited file
				if (this.currentEditFile === file.path && this.hasActiveFile) { // Changed condition to check hasActiveFile
					// Read the new content
					const newContent = await this.app.vault.read(file);
					
					// Calculate the difference in content length as a simple way to measure edit size
					const contentDifference = Math.abs(newContent.length - this.originalContent.length);
					
					// Only award XP if the edit is significant
					if (contentDifference >= this.settings.minEditLength) {
						this.awardXP('editNote', `Completed edit: +${this.settings.xpGainRates.editNote}XP`);
						// Update the original content to the new state
						this.originalContent = newContent;
					}
				}
			} catch (error) {
				console.error("Error processing file edit:", error);
			}
		}, this.settings.editDebounceTime);

		await this.applyAllPassiveEffects();
	}
	
	onunload() {
		// Clear any pending timers
		if (this.editTimer) {
			clearTimeout(this.editTimer);
		}
		
		// Save settings when plugin unloads
		this.saveSettings();
	}
	
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		
		// Make sure the new properties exist
		if (this.settings.initializedNoteCount === undefined) {
			this.settings.initializedNoteCount = false;
		}
		if (this.settings.editDebounceTime === undefined) {
			this.settings.editDebounceTime = DEFAULT_SETTINGS.editDebounceTime;
		}
		if (this.settings.minEditLength === undefined) {
			this.settings.minEditLength = DEFAULT_SETTINGS.minEditLength;
		}
	}
	
	async saveSettings() {
		await this.saveData(this.settings);
	}
	
	updateStatusBar() {
		this.statusBarEl.setText(`Level ${this.settings.level} | XP: ${this.settings.currentXP}/${this.settings.xpToNextLevel}`);
	}
	
	awardXP(type: keyof typeof DEFAULT_SETTINGS.xpGainRates, message: string, customXPAmount?: number) {
		// Don't award XP during initialization
		if (this.isInitializing) return;
		
		const xpAmount = customXPAmount ?? this.settings.xpGainRates[type];
	    this.settings.currentXP += xpAmount;
		
		// Check if level up
		if (this.settings.currentXP >= this.settings.xpToNextLevel) {
			this.levelUp();
		} 
		if (this.settings.level > 20) {
			const xpSinceLevel20 = this.settings.currentXP + this.getTotalXPUpToLevel(this.settings.level - 1) - this.getTotalXPUpToLevel(20);
			const bonusPoints = Math.floor(xpSinceLevel20 / 200000);
		
			if (bonusPoints > (this.settings.extraFeatPointsGranted || 0)) {
				const extra = bonusPoints - (this.settings.extraFeatPointsGranted || 0);
				this.settings.featPoints += extra;
				this.settings.extraFeatPointsGranted = bonusPoints;
			}
		}
		else {
			this.updateStatusBar();
			this.saveSettings();
			new Notice(message);
		}
	}

	async loadEffectFromNote(path: string): Promise<Partial<EffectData>> { //
    const file = this.app.vault.getAbstractFileByPath(path); //
    if (!(file instanceof TFile)) return {}; //

    const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter; //
    if (!metadata) return {}; //

    const result: Partial<EffectData> = {}; //

    for (const [key, value] of Object.entries(metadata)) { //
        if (typeof value === "number") { //
            result[key] = value; //
        } else if ((key === "grantsResistances" || key === "grantsImmunities") && Array.isArray(value)) { //
            if (value.every(item => typeof item === 'string')) { //
                result[key as 'grantsResistances' | 'grantsImmunities'] = value as string[]; //
            }
        }
        // NOVA LÓGICA PARA SKILL PROFICIENCIES E EXPERTISE
        else if ((key === "grantsSkillProficiency" || key === "grantsSkillExpertise") && Array.isArray(value)) {
            if (value.every(item => typeof item === 'string')) {
                result[key as 'grantsSkillProficiency' | 'grantsSkillExpertise'] = value as string[];
            }
        }
        // FIM DA NOVA LÓGICA PARA SKILLS
        else if (key === "permanent" && typeof value === "boolean") { //
            result[key] = value; //
        }
    }
    return result; //
 }

	
	rollHP(): number {
  return Math.ceil(Math.random() * this.settings.health.baseDie);
 }

	levelUp() {
		this.settings.level++;
		if (this.settings.level >= 20) {
			this.settings.featPoints = (this.settings.featPoints || 0) + 1;
		}
		this.settings.currentXP = this.settings.currentXP - this.settings.xpToNextLevel;
		this.settings.xpToNextLevel = Math.floor(this.settings.xpToNextLevel * 1.5); // Increase XP required for next level
		
		this.updateStatusBar();
		this.saveSettings();
		this.checkAchievements();

		const statBonus = Math.floor(this.settings.level / 4);
		this.settings.characterStats = {
		  Strength: 10 + statBonus,
		  Dexterity: 10 + statBonus,
		  Constitution: 10 + statBonus,
		  Intelligence: 10 + statBonus,
		  Wisdom: 10 + statBonus,
		  Charisma: 10 + statBonus,
		};

		const conMod = Math.floor((this.settings.characterStats.Constitution - 10) / 2);
        const modoHP = this.settings.health.autoHpMode ?? "maximo";
        const baseDie = this.settings.health.baseDie;

       let hpBase: number;

      if (this.settings.level === 1) {
       hpBase = baseDie; // Sempre ganha o máximo no nível 1
       } else {
       hpBase = calcularHPPorNivel(baseDie, modoHP);
      }

     const gainedHP = Math.max(1, hpBase + conMod);


        this.settings.health.hpPerLevel.push(gainedHP);
        this.settings.health.maxHP += gainedHP;
        this.settings.health.currentHP += gainedHP; // opcional: cura ao upar   


		const featLevels = [2, 4, 8, 12, 16, 19];
		if (featLevels.includes(this.settings.level)) {
			this.settings.featPoints = (this.settings.featPoints ?? 0) + 1;
			new Notice(`Ganhou 1 Feat Point por alcançar o nível ${this.settings.level}!`);
		}
		
		// Show level up message with more fanfare
		new Notice(`🎉 LEVEL UP! 🎉 You reached level ${this.settings.level}!`, 5000);
	}

	getTotalXPUpToLevel(level: number): number {
		let xp = 0;
		let req = 1000;
		for (let i = 1; i < level; i++) {
			xp += req;
			req = Math.floor(req * 1.5);
		}
		return xp;
	}
	
	totalSpentFeatPoints(): number {
		const spentFeats = this.settings.spentFeatPoints?.feats?.length || 0;
		const spentStats = Object.values(this.settings.spentFeatPoints?.statIncreases || {}).reduce((a, b) => a + b, 0);
		return spentFeats + spentStats;
	}
	
	
	checkDailyStreak() {
		const today = new Date().toDateString();
		
		if (this.settings.lastActive === '') {
			// First time using the plugin
			this.settings.lastActive = today;
			this.settings.streakDays = 1;
			this.settings.dailyXpAwarded = true;
			this.saveSettings();
			return;
		}
		
		const lastActiveDate = new Date(this.settings.lastActive);
		const currentDate = new Date(today);
		
		// Calculate the difference in days
		const timeDiff = currentDate.getTime() - lastActiveDate.getTime();
		const dayDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
		
		// Check if we're on a new day and haven't awarded XP yet today
		if (dayDiff >= 1 && !this.settings.dailyXpAwarded) {
			if (dayDiff === 1) {
				// Consecutive day
				this.settings.streakDays++;
				
				// Only award XP if not initializing
				if (!this.isInitializing) {
					this.awardXP('dailyStreak', `Daily streak (${this.settings.streakDays} days): +${this.settings.xpGainRates.dailyStreak}XP`);
				}
				this.checkAchievements();
			} else if (dayDiff > 1) {
				// Streak broken
				if (!this.isInitializing) {
					new Notice(`Streak reset! You were away for ${dayDiff} days.`);
				}
				this.settings.streakDays = 1;
			}
			
			// Mark that we've awarded XP for today
			this.settings.dailyXpAwarded = true;
		}
		
		// Always update the last active date
		if (this.settings.lastActive !== today) {
			this.settings.lastActive = today;
			// Reset the dailyXpAwarded flag when it's a new day
			this.settings.dailyXpAwarded = false;
		}
		
		this.saveSettings();
	}
	
	// Check achievements but don't award XP - for initialization
	checkAchievementsNoXP() {
		const achievements = this.settings.achievements;
		let earned = false;
		
		if (!achievements.first_note && this.noteCount > 0) {
			achievements.first_note = true;
			earned = true;
		}
		
		if (!achievements.reach_level_5 && this.settings.level >= 5) {
			achievements.reach_level_5 = true;
			earned = true;
		}
		
		if (!achievements.create_10_notes && this.noteCount >= 10) {
			achievements.create_10_notes = true;
			earned = true;
		}
		
		if (!achievements.create_50_links && this.linkCount >= 50) {
			achievements.create_50_links = true;
			earned = true;
		}
		
		if (!achievements["7_day_streak"] && this.settings.streakDays >= 7) {
			achievements["7_day_streak"] = true;
			earned = true;
		}
		
		if (earned) {
			this.saveSettings();
		}
	}
	
	checkAchievements() {
		const achievements = this.settings.achievements;
		let earned = false;
		
		if (!achievements.first_note && this.noteCount > 0) {
			achievements.first_note = true;
			earned = true;
			// Only show achievement notice if not initializing
			if (!this.isInitializing) {
				this.showAchievementNotice("First Note Created", "You've begun your knowledge journey!");
			}
		}
		
		if (!achievements.reach_level_5 && this.settings.level >= 5) {
			achievements.reach_level_5 = true;
			earned = true;
			if (!this.isInitializing) {
				this.showAchievementNotice("Knowledge Apprentice", "Reached level 5");
			}
		}
		
		if (!achievements.create_10_notes && this.noteCount >= 10) {
			achievements.create_10_notes = true;
			earned = true;
			if (!this.isInitializing) {
				this.showAchievementNotice("Prolific Scholar", "Created 10 notes");
			}
		}
		
		if (!achievements.create_50_links && this.linkCount >= 50) {
			achievements.create_50_links = true;
			earned = true;
			if (!this.isInitializing) {
				this.showAchievementNotice("Master Connector", "Created 50 links between your notes");
			}
		}
		
		if (!achievements["7_day_streak"] && this.settings.streakDays >= 7) {
			achievements["7_day_streak"] = true;
			earned = true;
			if (!this.isInitializing) {
				this.showAchievementNotice("Dedication", "Used Obsidian for 7 days in a row");
			}
		}
		
		if (earned) {
			this.saveSettings();
		}
	}
	
	showAchievementNotice(title: string, description: string) {
		// Don't show notices during initialization
		if (this.isInitializing) return;
		
		new Notice(`🏆 ACHIEVEMENT UNLOCKED! 🏆\n${title}: ${description}`, 7000);
		
		// Bonus XP for achievements
		this.settings.currentXP += 25;
		
		// Check if level up after achievement XP
		if (this.settings.currentXP >= this.settings.xpToNextLevel) {
			this.levelUp();
		} else {
			this.updateStatusBar();
			this.saveSettings();
		}
	}
	
	showStatsModal() {
		const achievementsEarned = Object.values(this.settings.achievements).filter(Boolean).length;
		const achievementsTotal = Object.keys(this.settings.achievements).length;
		
		
		const statsHtml = `
			<div style="padding: 20px;">
				<h2>Your Knowledge Journey Stats</h2>
				<div style="margin: 20px 0; background-color: var(--background-secondary); padding: 10px; border-radius: 5px;">
					<div style="font-size: 1.2em; margin-bottom: 10px;">Level ${this.settings.level} Knowledge Seeker</div>
					<div>XP: ${this.settings.currentXP}/${this.settings.xpToNextLevel}</div>
					<div class="progress-bar" style="height: 10px; background-color: var(--background-modifier-border); border-radius: 5px; margin-top: 5px;">
						<div style="height: 100%; width: ${(this.settings.currentXP / this.settings.xpToNextLevel) * 100}%; background-color: var(--interactive-accent); border-radius: 5px;"></div>
					</div>
				</div>
				
				<div>
					<h3>Your Stats</h3>
					<ul>
						<li>Notes Created: ${this.noteCount}</li>
						<li>Links Created: ${this.linkCount}</li>
						<li>Daily Streak: ${this.settings.streakDays} days</li>
						<li>Achievements: ${achievementsEarned}/${achievementsTotal}</li>
					</ul>
				</div>
				
				<div>
					<h3>Achievements</h3>
					<ul style="list-style-type: none; padding: 0;">
						${Object.entries(this.settings.achievements).map(([key, earned]) => {
							const achievementInfo = this.getAchievementInfo(key);
							return `<li style="margin-bottom: 5px; ${earned ? '' : 'opacity: 0.5;'}">
								${earned ? '🏆' : '🔒'} <strong>${achievementInfo.title}</strong>: ${achievementInfo.description}
							</li>`;
						}).join('')}
					</ul>
				</div>
			</div>
		`;
		
		const modal = this.app.workspace.createLeafInParent(this.app.workspace.rootSplit, 0).setViewState({
			type: 'empty',
			state: { html: statsHtml }
		});
	}
	
	showQuestsModal() {
		// Get today's date as string
		const today = new Date().toISOString().split('T')[0];
		
		// Filter available quests (not completed or respawn time has passed)
		const availableQuests = Object.entries(this.settings.quests).filter(([id, quest]) => {
			// If the quest has a specific available date, check if it's today
			if (quest.availableDate && quest.availableDate !== today) {
				return false;
			}
			
			// If the quest is completed, check if respawn time has passed
			if (quest.lastCompleted) {
				const lastCompletedDate = new Date(quest.lastCompleted);
				const respawnDate = new Date(lastCompletedDate);
				respawnDate.setDate(respawnDate.getDate() + quest.respawnDays);
				
				if (new Date() < respawnDate) {
					return false;
				}
			}
			
			return !quest.completed || quest.respawnDays > 0;
		});
		
		
		const questsHtml = `
			<div style="padding: 20px;">
				<h2>Available Quests</h2>
				
				${availableQuests.length > 0 ? `
					<div style="margin-top: 20px;">
						${availableQuests.map(([id, quest]) => `
							<div style="margin-bottom: 20px; background-color: var(--background-secondary); padding: 15px; border-radius: 5px;">
								<h3 style="margin-top: 0;">${quest.title}</h3>
								<p>${quest.description}</p>
								<div style="display: flex; justify-content: space-between; align-items: center;">
									<span style="font-weight: bold;">Reward: ${quest.xpReward} XP</span>
									<button class="mod-cta complete-quest" data-quest-id="${id}">Complete Quest</button>
								</div>
							</div>
						`).join('')}
					</div>
				` : `
					<div style="text-align: center; margin-top: 30px;">
						<p>No available quests. Create some in the plugin settings!</p>
					</div>
				`}
			</div>
		`;
		
		const modalDiv = document.createElement('div');
		modalDiv.innerHTML = questsHtml;
		
		// Add event listeners to Complete Quest buttons
		modalDiv.querySelectorAll('.complete-quest').forEach(button => {
			button.addEventListener('click', (e) => {
				const questId = (e.target as HTMLElement).dataset.questId;
				if (questId && this.settings.quests[questId]) {
					const quest = this.settings.quests[questId];
					
					// Award XP
					this.settings.currentXP += quest.xpReward;
					
					// Mark as completed
					quest.completed = true;
					quest.lastCompleted = new Date().toISOString().split('T')[0];
					
					// Check for level up
					this.awardXP("taskEasy", `Quest completed: ${quest.title} (+${quest.xpReward}XP)`);
					
					// Show notification
					new Notice(`Quest completed: ${quest.title} (+${quest.xpReward}XP)`);
					
					// Close and reopen modal to refresh
					modal.close();
					this.showQuestsModal();
				}
			});
		});
		
		const modal = new Modal(this.app);
		modal.contentEl.appendChild(modalDiv);
		modal.open();
	}

	
	
	getAchievementInfo(key: string): AchievementInfo {
		const achievements: AchievementsDict = {
			"first_note": { title: "First Note Created", description: "You've begun your knowledge journey!" },
			"reach_level_5": { title: "Knowledge Apprentice", description: "Reached level 5" },
			"create_10_notes": { title: "Prolific Scholar", description: "Created 10 notes" },
			"create_50_links": { title: "Master Connector", description: "Created 50 links between your notes" },
			"7_day_streak": { title: "Dedication", description: "Used Obsidian for 7 days in a row" }
		};
		
		// Safely return the achievement info or a default if key doesn't exist
		return achievements[key] || { title: key, description: "" };
	}
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	app: App;
	onChooseFolder: (folderPath: string) => void = () => {};

	constructor(app: App) {
		super(app);
		this.app = app;
	}

	getItems(): TFolder[] {
		const folders: TFolder[] = [];

		const recurse = (folder: TFolder) => {
			folders.push(folder);
			for (const child of folder.children) {
				if (child instanceof TFolder) recurse(child);
			}
		};

		recurse(this.app.vault.getRoot());
		return folders;
	}

	getItemText(item: TFolder): string {
		return item.path;
	}

	onChooseItem(item: TFolder) {
		this.onChooseFolder(item.path);
	}
}

// [[NO SEU ARQUIVO 10.txt, SUBSTITUA A CLASSE EffectsModal EXISTENTE POR ESTA]]

class EffectsModal extends Modal {
  plugin: RPGLevelsPlugin;

  constructor(app: App, plugin: RPGLevelsPlugin) {
    super(app);
    this.plugin = plugin; // [cite: 162]
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty(); // Limpa conteúdo anterior para evitar duplicação ao reabrir
    contentEl.createEl("h2", { text: "Efeitos Ativos e Disponíveis" }); // [cite: 162]

    // === Limpa efeitos expirados ===
    const rawEffects: Record<string, EffectData> = this.plugin.settings.effects ?? {}; // [cite: 163]
    const activeEffectsFromSettings: Record<string, EffectData> = {}; // [cite: 164]
    let expiredCount = 0; // [cite: 164]
    for (const [id, effect] of Object.entries(rawEffects)) { // [cite: 165]
        if (this.plugin.isEffectExpired(effect)) { // [cite: 165]
            expiredCount++; // [cite: 165]
            continue; // [cite: 165]
        }
        activeEffectsFromSettings[id] = effect; // [cite: 166]
    }

    this.plugin.settings.effects = activeEffectsFromSettings; // [cite: 166]
    if (expiredCount > 0) { // [cite: 167]
        this.plugin.saveSettings(); // [cite: 167]
        new Notice(`${expiredCount} efeito(s) expirado(s) foram removidos.`); // [cite: 167]
    }

    // === Renderiza efeitos ativos ===
    contentEl.createEl("h3", { text: "Efeitos Ativos Atualmente" });
    const effectKeys = Object.keys(activeEffectsFromSettings); // [cite: 168]
    if (effectKeys.length === 0) { // [cite: 169]
        contentEl.createEl("p", { text: "Nenhum efeito ativo." }); // [cite: 169]
    } else {
        effectKeys.forEach(key => { // [cite: 170]
            const effect = activeEffectsFromSettings[key]; // [cite: 170]
            const isExpired = this.plugin.isEffectExpired(effect); // [cite: 170]
            const remaining = this.plugin.getTimeRemaining(effect); // [cite: 170]

            const effectDiv = contentEl.createDiv({ cls: "effect-item" }); // [cite: 170]
            // ... (estilização do effectDiv como no seu código original) ...
            effectDiv.style.border = "1px solid var(--background-modifier-border)"; // [cite: 170]
            effectDiv.style.borderRadius = "5px"; // [cite: 170]
            effectDiv.style.padding = "10px"; // [cite: 170]
            effectDiv.style.marginBottom = "10px"; // [cite: 170]


            effectDiv.createEl("h4", { text: effect.notePath }); // [cite: 170]
            effectDiv.createEl("p", { // [cite: 171]
                text: effect.permanent // [cite: 171]
                    ? "⏳ Permanente" // [cite: 171]
                    : isExpired // [cite: 171]
                        ? "❌ Expirado" // [cite: 171]
                        : `🕒 ${remaining?.days} dia(s) e ${remaining?.hours} hora(s) restantes` // [cite: 171]
            });

            if (isExpired) { // [cite: 171]
                effectDiv.style.opacity = "0.5"; // [cite: 171]
            }

            const buttonRow = effectDiv.createDiv({ cls: "button-row" }); // [cite: 172]
            const openBtn = buttonRow.createEl("button", { text: "Abrir Nota" }); // [cite: 172]
            openBtn.onclick = () => { // [cite: 173]
                this.app.workspace.openLinkText(effect.notePath, '', false); // [cite: 173]
            };
            const removeBtn = buttonRow.createEl("button", { text: "Remover Efeito" }); // [cite: 174]
            removeBtn.onclick = async () => { // [cite: 174]
                delete this.plugin.settings.effects[key]; // [cite: 174]
                await this.plugin.applyAllPassiveEffects(); // Adicionado para recalcular status
                await this.plugin.saveSettings(); // [cite: 175]
                this.onOpen(); // Recarrega o modal para atualizar a lista
            };
        });
    }
    contentEl.createEl("hr");

    // === Seção de Adição de Efeitos (com pastas recolhíveis) ===
    const currentActiveEffectPaths = Object.values(activeEffectsFromSettings).map(e => e.notePath); // [cite: 176]

    // --- Efeitos Únicos Disponíveis ---
    contentEl.createEl("h3", { text: "Efeitos Únicos Disponíveis (por Pasta)" }); // [cite: 175]
    if (this.plugin.settings.effectFolders.length === 0) {
        contentEl.createEl("p", {text: "Nenhuma pasta de efeitos únicos configurada nas settings."});
    }
    this.plugin.settings.effectFolders.forEach(folderPath => { // Adaptado de [cite: 360]
        const folderDetails = contentEl.createEl("details");
        folderDetails.createEl("summary", { text: folderPath });
        // Usando o novo método da classe principal
        const effectsInFolder = this.plugin.getEffectsFromSpecificFolder(folderPath, currentActiveEffectPaths, false);
        
        if (effectsInFolder.length === 0) { // [cite: 177]
            folderDetails.createEl("p", { text: "Nenhum efeito único novo disponível nesta pasta." }); // Parcialmente de [cite: 177]
        } else {
            effectsInFolder.forEach(effectFile => { // Adaptado de [cite: 178]
                this.renderEffectEntry(folderDetails, effectFile.path, false); // Passa false para isRepeatable
            });
        }
    });

    // --- Efeitos Repetíveis Disponíveis ---
    contentEl.createEl("h3", { text: "Efeitos Repetíveis Disponíveis (por Pasta)" }); // [cite: 179]
    if (this.plugin.settings.repeatableEffectFolders.length === 0) {
        contentEl.createEl("p", {text: "Nenhuma pasta de efeitos repetíveis configurada nas settings."}); // [cite: 180]
    }
    this.plugin.settings.repeatableEffectFolders.forEach(folderPath => { // Adaptado de [cite: 363]
        const folderDetails = contentEl.createEl("details");
        folderDetails.createEl("summary", { text: folderPath });
        // Para repetíveis, não excluímos com base nos ativos
        const effectsInFolder = this.plugin.getEffectsFromSpecificFolder(folderPath, [], true);
        
        if (effectsInFolder.length === 0) { // [cite: 180]
            folderDetails.createEl("p", { text: "Nenhum efeito repetível disponível nesta pasta." }); // [cite: 180]
        } else {
            effectsInFolder.forEach(effectFile => { // Adaptado de [cite: 181]
                this.renderEffectEntry(folderDetails, effectFile.path, true); // Passa true para isRepeatable
            });
        }
    });
  }

  renderEffectEntry(parentElement: HTMLElement, path: string, isRepeatable: boolean) {
    // 'isRepeatable' pode ser usado para lógicas futuras, mas não é usado ativamente aqui
    // para diferenciar a adição, já que a filtragem principal ocorre antes.
    const container = parentElement.createDiv({ cls: "effect-entry" }); // [cite: 182]
    // ... (estilização do container, header, toggleBtn, configDiv como no seu código original ou na DamageModal)
    container.style.marginBottom = "10px"; // [cite: 182]
    container.style.padding = "10px"; // [cite: 183]
    container.style.border = "1px solid var(--background-modifier-border)"; // [cite: 183]
    container.style.borderRadius = "5px"; // [cite: 183]

    const header = container.createDiv({ cls: "effect-header" }); // [cite: 183]
    header.style.display = "flex"; // [cite: 184]
    header.style.justifyContent = "space-between"; // [cite: 184]
    header.style.alignItems = "center"; // [cite: 184]

    header.createEl("b", { text: path }); // [cite: 184]
    const toggleBtn = header.createEl("button", { text: "➕ Adicionar" }); // [cite: 185]
    const configDiv = container.createDiv(); // [cite: 185]
    configDiv.style.display = "none"; // [cite: 185]

    toggleBtn.onclick = () => { // [cite: 186]
      const opened = configDiv.style.display === "block"; // [cite: 186]
      configDiv.style.display = opened ? "none" : "block"; // [cite: 187]
      toggleBtn.setText(opened ? "➕ Adicionar" : "✖ Cancelar"); // [cite: 187]
    };

    let duration = 3; // [cite: 187]
    let permanent = false; // [cite: 187]
    new Setting(configDiv) // [cite: 188]
      .setName("Duração (dias)") // [cite: 188]
      .setDesc("Deixe 0 para ignorar se não for permanente") // [cite: 188]
      .addText(text => {
        text.setPlaceholder("Ex: 3") // [cite: 188]
          .setValue(duration.toString()) // [cite: 188]
          .onChange(value => {
            const parsed = parseInt(value); // [cite: 188]
            duration = !isNaN(parsed) && parsed >= 0 ? parsed : 0; // [cite: 189]
           });
      });
    new Setting(configDiv) // [cite: 190]
      .setName("Permanente") // [cite: 190]
      .addToggle(toggle => {
        toggle.setValue(permanent).onChange(value => { // [cite: 190]
          permanent = value; // [cite: 190]
        });
      });
    new Setting(configDiv) // [cite: 191]
      .addButton(button => {
        button.setButtonText("Confirmar") // [cite: 191]
          .setCta() // [cite: 191]
          .onClick(async () => { // [cite: 191]
            const id = `eff_${Date.now()}_${Math.floor(Math.random() * 1000)}`; // [cite: 191]
            this.plugin.settings.effects[id] = { // [cite: 191]
              notePath: path, // [cite: 191]
              startDate: new Date().toISOString(), // [cite: 192]
              durationDays: permanent ? undefined : (duration > 0 ? duration : undefined), // [cite: 192]
              permanent, // [cite: 192]
              active: true // [cite: 192]
            };
			await this.app.metadataCache.trigger("changed", this.app.vault.getAbstractFileByPath(path)!); // [cite: 192]
			await this.plugin.applyAllPassiveEffects(); // [cite: 192]
            await this.plugin.saveSettings(); // [cite: 192]
            this.onOpen(); // Recarrega o modal para atualizar as listas
          });
      });
  }

  onClose() {
    this.contentEl.empty(); // [cite: 194]
  }
}

class StatsModal extends Modal {
  plugin: RPGLevelsPlugin;

  constructor(app: App, plugin: RPGLevelsPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
	await this.plugin.applyAllPassiveEffects();
    const stats = this.plugin.settings.characterStats;
    const proficiencyBonus = this.plugin.settings.proficiencyBonus; // Get proficiency bonus
    const proficiencies = this.plugin.settings.proficiencies; // Get proficiencies

    // Se houver imagem configurada, renderiza
    if (this.plugin.settings.characterImagePath) {
      const imgContainer = contentEl.createDiv();
      const imgPath = this.plugin.settings.characterImagePath;
      const file = this.app.vault.getAbstractFileByPath(imgPath);

      const exts = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
      if (file instanceof TFile && exts.includes(file.extension.toLowerCase())) {
        this.app.vault.readBinary(file).then(data => {
        const blob = new Blob([data], { type: `image/${file.extension}` });
      const url = URL.createObjectURL(blob);
      const img = imgContainer.createEl("img");
      img.src = url;
      img.alt = "Character Image";
      img.style.maxWidth = "250px";           // Tamanho máximo reduzido
      img.style.display = "block";            // Centralizar
      img.style.margin = "0 auto 15px auto";  // Centralizar + margem inferior
      img.style.borderRadius = "10px";        // Cantos arredondados
        }).catch(err => {
          console.error("Erro ao ler imagem:", err);
          imgContainer.createEl("p", { text: `❌ Erro ao carregar imagem.` });
        });
      } else {
        imgContainer.createEl("p", { text: `⚠️ Arquivo de imagem inválido ou não encontrado: ${imgPath}` });
      }
    } 

    // Resto do conteúdo do modal
    const level = this.plugin.settings.level;
    contentEl.createEl("h3", { text: `Feat Points disponíveis: ${this.plugin.settings.featPoints ?? 0}` });

    contentEl.createEl("button", { text: "Manage Quests", cls: "mod-cta" })
      .onclick = () => {
        this.close();
        new QuestModal(this.app, this.plugin).open();
      };

    contentEl.createEl("button", { text: "Manage Feats", cls: "mod-cta" })
      .onclick = () => {
        this.close();
        new FeatsModal(this.app, this.plugin).open();
      };

	  contentEl.createEl("button", { text: "🛡️ View Defenses", cls: "mod-cta" })
      .onclick = () => {
        this.close(); // Fecha o StatsModal atual
        new DefensesModal(this.app, this.plugin).open(); // Abre o DefensesModal
      };

	  contentEl.createEl("hr"); // Separator

    if (this.plugin.settings.characterNotePath) {
      contentEl.createEl("button", { text: "📘 Abrir Página do Personagem", cls: "mod-cta" })
        .onclick = () => {
          this.app.workspace.openLinkText(this.plugin.settings.characterNotePath!, '', false);
        };
    }
	contentEl.createEl("button", { text: "💪 Manage Abilities & Rolls", cls: "mod-cta" })
        .onclick = () => {
            this.close();
            new AbilitiesModal(this.app, this.plugin).open();
        };
    contentEl.createEl("hr"); // Separator

     contentEl.createEl("h2", { text: `Level ${this.plugin.settings.level} - Character Stats` });
    contentEl.createEl("p", {text: `(Proficiency Bonus: +${proficiencyBonus})`}); // Display proficiency bonus

    const abilityOrder: (keyof CharacterStats)[] = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];

    abilityOrder.forEach(statName => {
        const statValue = stats[statName];
        const modifier = this.plugin.getAbilityModifier(statValue);
        const modifierString = modifier >= 0 ? `+${modifier}` : `${modifier}`;
        const saveProficiencyKey = `${statName.toLowerCase()}Save` as keyof typeof proficiencies;

        // Display Stat, Modifier, and a Roll Button
        const statSetting = new Setting(contentEl)
            .setName(`${statName}: ${statValue} (${modifierString})`)
            .setDesc(`Roll 1d20 + ${modifier}${proficiencies[saveProficiencyKey] ? ` + ${proficiencyBonus} (prof)` : ''}`);

        statSetting.addButton(button => button
            .setButtonText("🎲 Roll")
            .onClick(() => {
                const d20Roll = new Dice(20).roll();
                let totalRoll = d20Roll + modifier;
                let rollExplanation = `Rolled ${d20Roll} (d20) + ${modifier} (mod)`;

                if (proficiencies[saveProficiencyKey]) {
                    totalRoll += proficiencyBonus;
                    rollExplanation += ` + ${proficiencyBonus} (prof)`;
                }
                rollExplanation += ` = ${totalRoll}`;
                new Notice(`${statName} Roll: ${totalRoll}\n(${rollExplanation})`, 7000);
            }));
    });
    
    contentEl.createEl("hr");

   const featBtn = contentEl.createEl("button", {
  text: "Usar Feat Point para aumentar atributo",
  cls: "mod-cta"
});

featBtn.onclick = () => {
  if ((this.plugin.settings.featPoints ?? 0) <= 0) {
    new Notice("Você não tem Feat Points disponíveis.");
    return;
  }

  const plugin = this.plugin;
  const parentModal = this;

  new class extends FuzzySuggestModal<string> {
    plugin: RPGLevelsPlugin;
    parentModal: Modal;

    constructor(app: App, plugin: RPGLevelsPlugin, parentModal: Modal) {
      super(app);
      this.plugin = plugin;
      this.parentModal = parentModal;
    }

    getItems(): string[] {
      return Object.keys(this.plugin.settings.characterStats);
    }

    getItemText(item: string): string {
      return item;
    }

    onChooseItem(item: string): void {
      const statKey = item as keyof CharacterStats;

      // Aumenta o contador de bônus persistente
      const increases = this.plugin.settings.spentFeatPoints.statIncreases;
      increases[statKey] = (increases[statKey] ?? 0) + 1;

      // Consome feat point
      this.plugin.settings.featPoints!--;

      this.plugin.applyAllPassiveEffects().then(() => {
        this.plugin.saveSettings().then(() => {
          new Notice(`${statKey} aumentado com Feat!`);
          this.parentModal.close();
          new StatsModal(this.app, this.plugin).open();
        });
      });
    }
  }(this.app, plugin, parentModal).open();
};


	contentEl.createEl("button", {
  text: "❤️ Gerenciar HP",
  cls: "mod-cta"
}).onclick = () => {
  this.close();
  new HPManagementModal(this.app, this.plugin).open();
};


 const health = this.plugin.settings.health;
 contentEl.createEl("h3", { text: "❤️ Health" });
 contentEl.createEl("p", {
  text: `HP: ${health.currentHP}/${health.maxHP} + (${health.tempHP} Temp)`
 });

 let featHpBonus = 0;
let featTempHP = 0;

for (const path of this.plugin.settings.obtainedFeats) {
  const data = await this.plugin.loadEffectFromNote(path);
  if (data.hpBonus) featHpBonus += data.hpBonus;
  if (data.tempHP) featTempHP = Math.max(featTempHP, data.tempHP);
}

this.plugin.settings.health.maxHP += featHpBonus;
this.plugin.settings.health.tempHP = Math.max(this.plugin.settings.health.tempHP, featTempHP);
await this.plugin.saveSettings();


	  	contentEl.createEl("button", {
   text: "Manage Effects",
   cls: "mod-cta"
 }).onclick = () => {
   this.close();
   new EffectsModal(this.app, this.plugin).open();
  };

  const rawEffects = Object.values(this.plugin.settings.effects).filter(e => e.active && !this.plugin.isEffectExpired(e));

 const activeEffects: EffectData[] = [];

 for (const eff of rawEffects) {
  const loadedData = await this.plugin.loadEffectFromNote(eff.notePath);
  activeEffects.push({ ...eff, ...loadedData });
 }

 let totalHpBonus = 0;
let maxTempHp = 0;

for (const effect of activeEffects) {
  if (effect.hpBonus) totalHpBonus += effect.hpBonus;
  if (effect.tempHP) maxTempHp = Math.max(maxTempHp, effect.tempHP);
}

const baseMax = this.plugin.settings.health.hpPerLevel.reduce((a, b) => a + b, 0);
this.plugin.settings.health.maxHP = baseMax + totalHpBonus;
this.plugin.settings.health.tempHP = maxTempHp;

await this.plugin.saveSettings();



 // === Aplicar bônus de HP e HP temporário ===


 for (const effect of activeEffects) {
  if (effect.hpBonus) {
    totalHpBonus += effect.hpBonus;
  }
  if (effect.tempHP) {
    maxTempHp = Math.max(maxTempHp, effect.tempHP);
  }
}

// Atualiza os valores de HP no settings
this.plugin.settings.health.maxHP =
  this.plugin.settings.health.hpPerLevel.reduce((a, b) => a + b, 0) + totalHpBonus;
this.plugin.settings.health.tempHP = maxTempHp;
await this.plugin.saveSettings();

// Exibição dos efeitos
if (activeEffects.length > 0) {
  contentEl.createEl("h3", { text: "🧪 Active Effects" });
  activeEffects.forEach(eff => {
    contentEl.createEl("p", { text: `• ${eff.notePath}` });
  });
}
  } 

  onClose() {
    this.contentEl.empty();
  }
}

class HPManagementModal extends Modal {
  plugin: RPGLevelsPlugin;

  constructor(app: App, plugin: RPGLevelsPlugin) {
    super(app);
    this.plugin = plugin;
  }
  

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
	await this.plugin.applyAllPassiveEffects();
    contentEl.createEl("h2", { text: "❤️ Gerenciar HP" });
	

    const { health } = this.plugin.settings;
    const totalHPFromLevels = health.hpPerLevel.reduce((a, b) => a + b, 0);

    // Separar hpBonus de feats e efeitos
    let featHPBonus = 0;
    let effectHPBonus = 0;

    for (const path of this.plugin.settings.obtainedFeats) {
      const data = await this.plugin.loadEffectFromNote(path);
      if (typeof data.hpBonus === "number") featHPBonus += data.hpBonus;
    }

    const activeEffects = Object.values(this.plugin.settings.effects)
      .filter(e => e.active && !this.plugin.isEffectExpired(e));

    for (const effect of activeEffects) {
      const data = await this.plugin.loadEffectFromNote(effect.notePath);
      if (typeof data.hpBonus === "number") effectHPBonus += data.hpBonus;
    }

    const totalBonus = featHPBonus + effectHPBonus;

    // Exibir status atual
    contentEl.createEl("h3", {
      text: `❤️ HP Atual: ${health.currentHP}/${health.maxHP}`
    });

    contentEl.createEl("p", {
      text: `🧪 HP Temporário: ${health.tempHP}`
    });

    // Mostrar o dado de HP
    const hpDice = new Dice(health.baseDie);
    contentEl.createEl("p", {
      text: `🎲 Dado de HP usado: ${hpDice.toString()}`
    });

    // Modo de rolagem
    contentEl.createEl("h3", { text: "⚙️ Modo de Ganho de HP por Nível" });

    const select = contentEl.createEl("select");
    ["rolar", "media", "maximo"].forEach(modo => {
      const opt = select.createEl("option", { text: modo });
      if (modo === this.plugin.settings.health.autoHpMode) opt.selected = true;
    });

    select.onchange = () => {
      this.plugin.settings.health.autoHpMode = select.value as "rolar" | "media" | "maximo";
      this.plugin.saveSettings();
      new Notice(`Modo de HP ajustado para: ${select.value}`);
    };

    // Mostrar dados por nível
    contentEl.createEl("h3", { text: "📈 HP por Nível (dados rolados)" });
    const list = contentEl.createEl("ul");
    health.hpPerLevel.forEach((val, idx) => {
      list.createEl("li", { text: `Nível ${idx + 1}: ${val} HP` });
    });

	
	// Botão de treino
    let lastSelectedLevel = 0; // fora da classe


 const trainWrapper = contentEl.createDiv();
 const levelSelect = trainWrapper.createEl("select");
 const trainButton = trainWrapper.createEl("button", { text: "Treinar +1 HP" });

 // Popula opções e mantém seleção
 for (let i = 0; i < health.hpPerLevel.length; i++) {
  const option = levelSelect.createEl("option", {
    text: `Nível ${i + 1}`,
    value: i.toString(),
  });
  if (i === lastSelectedLevel) option.selected = true;
 }

 // Ao clicar no botão
 trainButton.onclick = async () => {
  const index = parseInt(levelSelect.value);
  lastSelectedLevel = index;

  const current = health.hpPerLevel[index];
  const maxPossible = health.baseDie;

  if (current >= maxPossible) {
    new Notice(`Nível ${index + 1} já atingiu o HP máximo possível (${maxPossible}).`);
    return;
  }

  // Determina início da semana (segunda-feira)
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = domingo
  const diffToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const mondayISO = monday.toISOString();

  const log = this.plugin.settings.trainingLog ??= {};

  // Inicializa ou reseta o log do nível
  if (!log[index] || log[index].weekStart !== mondayISO) {
    log[index] = {
      weekStart: mondayISO,
      attempts: 0,
      success: false
    };
  }

  

  const levelLog = log[index];

  if (levelLog.success) {
    new Notice(`Você já teve sucesso treinando o nível ${index + 1} esta semana.`);
    return;
  }

  const todayISO = new Date().toISOString().split("T")[0];

 if (levelLog.lastAttempt === todayISO) {
  new Notice(`Você já treinou o nível ${index + 1} hoje.`);
  return;
 }


  // Tabela de chance por tentativa (acumulada)
  const chanceTable = [0.05, 0.07, 0.10, 0.15, 0.20];
  levelLog.attempts++;
  const totalChance = chanceTable
    .slice(0, levelLog.attempts)
    .reduce((a, b) => a + b, 0);

  const roll = Math.random();
  if (roll <= totalChance) {
    health.hpPerLevel[index]++;
    health.maxHP++;
    health.currentHP++;
    levelLog.success = true;
	levelLog.lastAttempt = todayISO;


    await this.plugin.saveSettings();
    new Notice(`🏋️ Sucesso! Ganhou +1 HP no nível ${index + 1} com ${levelLog.attempts} treino(s) essa semana.`);
  } else {
	levelLog.lastAttempt = todayISO;
    await this.plugin.saveSettings();
    new Notice(`📆 Treinamento registrado. Chance acumulada esta semana: ${(totalChance * 100).toFixed(1)}%.`);
  }

  this.close();
  new HPManagementModal(this.app, this.plugin).open();
 };


 const conMod = Math.floor((this.plugin.settings.characterStats.Constitution - 10) / 2);
 const constitutionHPBonus = conMod * this.plugin.settings.level;

    // Mostrar bônus separados
    contentEl.createEl("h3", { text: "✨ Bônus de HP" });

    contentEl.createEl("p", {
      text: `🧠 De Feats: ${featHPBonus}`
    });
	
	contentEl.createEl("p", {
   text: `💪 De Constituição: ${constitutionHPBonus}`
  });


    contentEl.createEl("p", {
      text: `🌀 De Efeitos/Status Ativos: ${effectHPBonus}`
    });

    contentEl.createEl("h3", {
      text: `🔢 Total de HP Máximo: ${totalHPFromLevels + featHPBonus + effectHPBonus + constitutionHPBonus} = ${totalHPFromLevels} (níveis) + ${featHPBonus} (feats) + ${effectHPBonus} (efeitos) + ${constitutionHPBonus} (Constituição)`
    });

	    contentEl.createEl("hr"); // Optional separator

    const damageButton = contentEl.createEl("button", { 
        text: "⚔️ Damage / Heal / Effects", 
        cls: "mod-cta" 
    });
    damageButton.style.marginTop = "10px"; // Add some spacing
    damageButton.onclick = () => {
      this.close(); // Close HPManagementModal
      new DamageModal(this.app, this.plugin).open(); // Open the new DamageModal
    };

    // Botão: Curar totalmente
    contentEl.createEl("button", { text: "💊 Curar totalmente" }).onclick = async () => {
      this.plugin.settings.health.currentHP = this.plugin.settings.health.maxHP;
      await this.plugin.saveSettings();
      new Notice("Curado!");
      this.close();
      new HPManagementModal(this.app, this.plugin).open();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}


class DamageModal extends Modal {
  plugin: RPGLevelsPlugin;
  // Para armazenar o tipo de dano selecionado nos inputs
  private selectedDamageType: string; 

  constructor(app: App, plugin: RPGLevelsPlugin) {
    super(app);
    this.plugin = plugin;
    // Inicializa com o primeiro tipo de dano ou 'Typeless' se disponível
    this.selectedDamageType = this.plugin.settings.damageTypes[0] || 'Typeless'; 
  }

  getEffectiveTempHP(): number { /* ... (como na resposta anterior) ... */
    const health = this.plugin.settings.health;
    return Math.max(health.tempHP || 0, health.manualTempHP || 0);
  }

  async onOpen() { /* ... (como na resposta anterior, mas selectedDamageType é inicializado no constructor) ... */
    const { contentEl } = this;
    contentEl.empty();
    await this.plugin.applyAllPassiveEffects();

    contentEl.createEl("h2", { text: "⚔️ Damage, Heal & Effects" });

    this.displayCurrentHP(contentEl);
    this.createDamageSection(contentEl); 
    this.createHealingSection(contentEl);
    this.createTempHPSection(contentEl); 
    this.createApplyEffectsSection(contentEl);

    const refreshButton = contentEl.createEl("button", { text: "🔄 Refresh Display", cls: "mod-neutral" });
    refreshButton.style.marginTop = "15px";
    refreshButton.onclick = () => {
        this.onOpen();
    };
  }

  displayCurrentHP(container: HTMLElement) { /* ... (como na resposta anterior) ... */
    const health = this.plugin.settings.health;
    const hpContainer = container.createDiv({ cls: "hp-display-container" });
    hpContainer.style.padding = "10px";
    hpContainer.style.backgroundColor = "var(--background-secondary)";
    hpContainer.style.borderRadius = "5px";
    hpContainer.style.marginBottom = "15px";

    hpContainer.createEl("h4", { text: "Current Health Status" });
    hpContainer.createEl("p", {
      text: `❤️ HP: ${health.currentHP} / ${health.maxHP}`,
    });
    const effectiveTempHP = this.getEffectiveTempHP();
    hpContainer.createEl("p", {
      text: `🛡️ Effective Temporary HP: ${effectiveTempHP}`,
    });
    hpContainer.createEl("p", {
        text: `(Sources: ${health.tempHP || 0} from items/effects, ${health.manualTempHP || 0} from manual grant)`,
        cls: "setting-item-description" 
    });
  }
  
  // Modificado para aceitar damageType
  async applyDamage(damageAmount: number, damageType: string, sourceDescription: string) {
    if (damageAmount < 0) {
        new Notice("Damage cannot be negative.");
        return;
    }

    const initialDamage = damageAmount;
    let finalDamage = damageAmount;
    const defenses = this.plugin.settings.defenses;

    let defenseMessage = "";

    // Aplicar imunidades e resistências apenas se não for 'Typeless'
    if (damageType !== 'Typeless') {
        if (defenses.immunities && defenses.immunities[damageType] && defenses.immunities[damageType].length > 0) {
            finalDamage = 0;
            defenseMessage = `Immune to ${damageType}!`;
        } else if (defenses.resistances && defenses.resistances[damageType] && defenses.resistances[damageType].length > 0) {
            finalDamage = Math.floor(initialDamage / 2);
            defenseMessage = `Resisted ${damageType}! (${initialDamage} -> ${finalDamage})`;
        }
    }
    
    new Notice(`${sourceDescription} for ${initialDamage} ${damageType} damage. ${defenseMessage || `Effective: ${finalDamage}`}`);
    if (finalDamage === 0 && initialDamage > 0 && defenseMessage.includes("Immune")) { // Se imune, não aplica dano
        this.onOpen(); // Apenas atualiza o modal
        return;
    }


    const health = this.plugin.settings.health;
    let remainingDamage = finalDamage; // Usa o dano após resistências/imunidades
    let effectiveTempHP = this.getEffectiveTempHP();

    if (effectiveTempHP > 0 && remainingDamage > 0) {
        const damageToTemp = Math.min(remainingDamage, effectiveTempHP);
        if (health.manualTempHP && health.manualTempHP > 0) {
            const reduceManualBy = Math.min(damageToTemp, health.manualTempHP);
            health.manualTempHP -= reduceManualBy;
        }
        remainingDamage -= damageToTemp;
        new Notice(`Dealt ${damageToTemp} to Temporary HP.`);
    }

    if (remainingDamage > 0) {
        health.currentHP = Math.max(0, health.currentHP - remainingDamage);
        new Notice(`Dealt ${remainingDamage} to Current HP.`);
    }
    
    await this.plugin.saveSettings();
    this.onOpen();
  }

  parseAndRollDice(diceString: string): number | null { /* ... (como na resposta anterior) ... */
    diceString = diceString.replace(/\s/g, ''); 
    const dicePattern = /^(\d*)d(\d+)(?:([+-])(\d+))?$/i; 
    const match = diceString.match(dicePattern);

    if (!match) {
        new Notice(`Invalid dice format: ${diceString}. Use e.g., '2d6', 'd20+3', '3d4-1'.`);
        return null;
    }

    const numDice = match[1] ? parseInt(match[1]) : 1;
    const sides = parseInt(match[2]);
    const operator = match[3]; 
    const modifierValue = match[4] ? parseInt(match[4]) : 0;

    if (sides < 2) { 
        new Notice("Dice must have at least 2 sides."); 
        return null;
    }
    if (numDice <=0) {
        new Notice("Number of dice must be positive.");
        return null;
    }

    const roller = new Dice(sides); 
    let totalRoll = 0;
    for (let i = 0; i < numDice; i++) {
        totalRoll += roller.roll(); 
    }

    if (operator === '+') {
        totalRoll += modifierValue;
    } else if (operator === '-') {
        totalRoll -= modifierValue;
    }
    return totalRoll;
  }

  createDamageSection(container: HTMLElement) {
    const section = container.createDiv({ cls: "damage-section" });
    section.createEl("h3", { text: "💥 Deal Damage" });
    
    // Damage Type Selector - Comum para ambas as seções de dano
    const damageTypeSetting = new Setting(section)
        .setName("Damage Type")
        .addDropdown(dropdown => {
            this.plugin.settings.damageTypes.forEach(type => {
                dropdown.addOption(type, type);
            });
            dropdown.setValue(this.selectedDamageType); // Usa o valor armazenado
            dropdown.onChange(value => {
                this.selectedDamageType = value; // Atualiza o valor armazenado
            });
        });

    // Manual Damage Input
    section.createEl("h4", { text: "Manual Damage Entry" });
    let manualDamageAmount = 0;
    new Setting(section)
      .setName("Damage Amount")
      .addText((text) =>
        text.setPlaceholder("Enter damage").onChange((value) => {
          manualDamageAmount = parseInt(value) || 0;
        })
      )
      .addButton((button) =>
        button
          .setButtonText("Apply Manual Damage")
          .setCta()
          .onClick(async () => {
            if (manualDamageAmount <= 0 && manualDamageAmount !==0) { 
                new Notice("Please enter a non-negative damage amount.");
                return;
            }
            // Usa this.selectedDamageType que é atualizado pelo dropdown
            await this.applyDamage(manualDamageAmount, this.selectedDamageType, "Manually applied"); 
          })
      );
    
    section.createEl("hr");

    // Dice Damage Input
    section.createEl("h4", { text: "🎲 Roll Dice for Damage" });
    let diceString = "1d6"; 
    new Setting(section)
        .setName("Dice Notation")
        .setDesc("E.g., 2d6, d20+3, 3d4-1")
        .addText(text => text
            .setPlaceholder("e.g., 2d6+3")
            .setValue(diceString)
            .onChange(value => {
                diceString = value;
            })
        )
        .addButton(button => button
            .setButtonText("Roll & Apply Damage")
            .onClick(async () => {
                const rolledDamage = this.parseAndRollDice(diceString);
                if (rolledDamage === null) return;
                // Usa this.selectedDamageType que é atualizado pelo dropdown
                await this.applyDamage(rolledDamage, this.selectedDamageType, `Rolled ${diceString}`); 
            })
        );
  }

  createHealingSection(container: HTMLElement) { /* ... (como na resposta anterior) ... */
    const section = container.createDiv({ cls: "healing-section" });
    section.createEl("h3", { text: "💖 Heal HP" });

    let healAmount = 0;
    new Setting(section)
      .setName("Heal Amount")
      .addText((text) =>
        text.setPlaceholder("Enter healing").onChange((value) => {
          healAmount = parseInt(value) || 0;
        })
      )
      .addButton((button) =>
        button
          .setButtonText("Apply Healing")
          .setCta()
          .onClick(async () => {
            if (healAmount <= 0) {
              new Notice("Please enter a positive healing amount.");
              return;
            }
            const health = this.plugin.settings.health;
            health.currentHP = Math.min(health.maxHP, health.currentHP + healAmount);
            new Notice(`Healed ${healAmount} HP.`);
            await this.plugin.saveSettings();
            this.onOpen(); 
          })
      );
  }

  createTempHPSection(container: HTMLElement) { /* ... (como na resposta anterior) ... */
    const section = container.createDiv({ cls: "temp-hp-section" });
    section.createEl("h3", { text: "🛡️ Grant Manual Temporary HP" });

    let tempHPAmount = 0;
    new Setting(section)
      .setName("Temporary HP Amount")
      .setDesc("Grants new Manual Temp HP. Effective Temp HP will be the max of this and item/effect-based Temp HP.")
      .addText((text) =>
        text.setPlaceholder("Enter Temp HP").onChange((value) => {
          tempHPAmount = parseInt(value) || 0; 
        })
      )
      .addButton((button) =>
        button
          .setButtonText("Grant Manual Temp HP")
          .setCta()
          .onClick(async () => {
            if (tempHPAmount < 0) {
              new Notice("Please enter a non-negative Temp HP amount.");
              return;
            }
            const health = this.plugin.settings.health;
            health.manualTempHP = tempHPAmount; 
            
            new Notice(`Granted ${tempHPAmount} Manual Temporary HP.`);
            await this.plugin.saveSettings();
            this.onOpen(); 
          })
      );
  }

  // Modificado para lista de efeitos recolhível por pasta
  createApplyEffectsSection(contentEl: HTMLElement) {
    contentEl.createEl("hr");
    contentEl.createEl("h3", { text: "✨ Apply New Effect" });

    const activeEffectPaths = Object.values(this.plugin.settings.effects)
                                   .filter(e => e.active && !this.plugin.isEffectExpired(e))
                                   .map(e => e.notePath);

    // === Unique Effects ===
    contentEl.createEl("h4", { text: "Available Unique Effects (by Folder)" });
    if (this.plugin.settings.effectFolders.length === 0) {
        contentEl.createEl("p", {text: "No unique effect folders configured in settings."});
    }
    this.plugin.settings.effectFolders.forEach(folderPath => {
        const folderDetails = contentEl.createEl("details");
        folderDetails.createEl("summary", { text: folderPath });
        const effectsInFolder = this.getEffectsFromSpecificFolder(folderPath, activeEffectPaths, false);
        if (effectsInFolder.length === 0) {
            folderDetails.createEl("p", { text: "No new unique effects available in this folder." });
        } else {
            effectsInFolder.forEach(effect => {
                this.renderEffectEntry(folderDetails, effect.path, false);
            });
        }
    });
    
    // === Repeatable Effects ===
    contentEl.createEl("h4", { text: "Available Repeatable Effects (by Folder)" });
     if (this.plugin.settings.repeatableEffectFolders.length === 0) {
        contentEl.createEl("p", {text: "No repeatable effect folders configured in settings."});
    }
    this.plugin.settings.repeatableEffectFolders.forEach(folderPath => {
        const folderDetails = contentEl.createEl("details");
        folderDetails.createEl("summary", { text: folderPath });
        // Para repetíveis, não filtramos por activeEffectPaths pois podem ser adicionados múltiplos
        const effectsInFolder = this.getEffectsFromSpecificFolder(folderPath, [], true); 
        if (effectsInFolder.length === 0) {
            folderDetails.createEl("p", { text: "No repeatable effects available in this folder." });
        } else {
            effectsInFolder.forEach(effect => {
                this.renderEffectEntry(folderDetails, effect.path, true);
            });
        }
    });
  }
  
  // Novo helper para pegar efeitos de uma pasta específica
  getEffectsFromSpecificFolder(folderPath: string, activeEffectPaths: string[], isRepeatable: boolean): TFile[] {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      const availableEffects: TFile[] = [];
      if (folder instanceof TFolder) {
          for (const file of folder.children) {
              if (file instanceof TFile && file.extension === "md") {
                  if (isRepeatable || !activeEffectPaths.includes(file.path)) {
                      availableEffects.push(file);
                  }
              }
          }
      }
      return availableEffects;
  }
// How to integrate it:
// You can add a button to your HPManagementModal to open this new DamageModal.
// Find the `onOpen()` method of `HPManagementModal` and add this towards the end:

/*
// In HPManagementModal class, inside onOpen() method:

    // ... (existing HPManagementModal content) ...

    contentEl.createEl("hr"); // Optional separator

    const damageButton = contentEl.createEl("button", { 
        text: "⚔️ Damage / Heal / Effects", 
        cls: "mod-cta" 
    });
    damageButton.style.marginTop = "10px"; // Add some spacing
    damageButton.onclick = () => {
      this.close(); // Close HPManagementModal
      new DamageModal(this.app, this.plugin).open(); // Open the new DamageModal
    };

    // ... (rest of HPManagementModal onOpen like "Curar totalmente" button)
*/
 renderEffectEntry(parentElement: HTMLElement, path: string, _isRepeatable: boolean) { /* ... (como na resposta anterior, apenas garanta que parentElement é usado em vez de contentEl diretamente para criar a entrada do efeito) ... */
    const container = parentElement.createDiv({ cls: "effect-entry" });
    container.style.marginBottom = "10px";
    container.style.padding = "10px";
    container.style.border = "1px solid var(--background-modifier-border)";
    container.style.borderRadius = "5px";

    const header = container.createDiv({ cls: "effect-header" });
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    header.createEl("b", { text: path });
    const toggleBtn = header.createEl("button", { text: "➕ Add Effect" });
    const configDiv = container.createDiv();
    configDiv.style.display = "none"; 

    toggleBtn.onclick = () => {
      const opened = configDiv.style.display === "block";
      configDiv.style.display = opened ? "none" : "block";
      toggleBtn.setText(opened ? "➕ Add Effect" : "✖ Cancel");
    };

    let duration = 7; 
    let permanent = false;

    new Setting(configDiv)
      .setName("Duration (days)")
      .setDesc("Set to 0 or leave empty for non-expiring if not permanent.")
      .addText(text => {
        text.setPlaceholder("Ex: 7")
          .setValue(String(duration))
          .onChange(value => {
            const parsed = parseInt(value);
            duration = !isNaN(parsed) && parsed >= 0 ? parsed : 0;
          });
      });

    new Setting(configDiv)
      .setName("Permanent Effect")
      .addToggle(toggle => {
        toggle.setValue(permanent).onChange(value => {
          permanent = value;
        });
      });

    new Setting(configDiv)
      .addButton(button => {
        button.setButtonText("Confirm & Apply Effect")
          .setCta()
          .onClick(async () => {
            const id = `eff_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            this.plugin.settings.effects[id] = { 
              notePath: path,
              startDate: new Date().toISOString(), 
              durationDays: permanent ? undefined : (duration > 0 ? duration : undefined), 
              permanent, 
              active: true 
            };
            
            const effectFile = this.app.vault.getAbstractFileByPath(path);
            if (effectFile) {
                 this.app.metadataCache.trigger("changed", effectFile);
            }
            await this.plugin.applyAllPassiveEffects(); 
            await this.plugin.saveSettings();
            
            new Notice(`Effect "${path}" applied.`);
            this.onOpen(); 
          });
      });
  }

  onClose() { /* ... (como na resposta anterior) ... */
    this.contentEl.empty();
  }
}

class DefensesModal extends Modal {
  plugin: RPGLevelsPlugin;

  constructor(app: App, plugin: RPGLevelsPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    // Garante que as defesas estão atualizadas antes de exibir
    await this.plugin.applyAllPassiveEffects(); 

    contentEl.createEl("h2", { text: "🛡️ Character Defenses" });

    const defenses = this.plugin.settings.defenses;

    // === Display Resistances ===
    contentEl.createEl("h3", { text: "Resistances" });
    const resistancesContainer = contentEl.createDiv();
    if (!defenses || Object.keys(defenses.resistances || {}).length === 0) {
        resistancesContainer.createEl("p", { text: "No active resistances." });
    } else {
        const ul = resistancesContainer.createEl("ul");
        for (const [type, sources] of Object.entries(defenses.resistances)) {
            if (sources && sources.length > 0) {
                const li = ul.createEl("li");
                li.createEl("strong", { text: `${type}: ` });
                // Extrai o nome do arquivo do path para melhor legibilidade
                const sourceNames = sources.map(path => path.substring(path.lastIndexOf('/') + 1).replace(/\.md$/, ''));
                li.appendText(` (Sources: ${sourceNames.join(", ")})`);
            }
        }
    }

    // === Display Immunities ===
    contentEl.createEl("h3", { text: "Immunities" });
    const immunitiesContainer = contentEl.createDiv();
    if (!defenses || Object.keys(defenses.immunities || {}).length === 0) {
        immunitiesContainer.createEl("p", { text: "No active immunities." });
    } else {
        const ul = immunitiesContainer.createEl("ul");
        for (const [type, sources] of Object.entries(defenses.immunities)) {
             if (sources && sources.length > 0) {
                const li = ul.createEl("li");
                li.createEl("strong", { text: `${type}: ` });
                const sourceNames = sources.map(path => path.substring(path.lastIndexOf('/') + 1).replace(/\.md$/, ''));
                li.appendText(` (Sources: ${sourceNames.join(", ")})`);
            }
        }
    }
     // Botão para fechar
    new Setting(contentEl)
        .addButton(btn => btn
            .setButtonText("Close")
            .setCta()
            .onClick(() => {
                this.close();
            }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

// [[ NO SEU ARQUIVO 10.txt, SUBSTITUA A CLASSE AbilitiesModal EXISTENTE POR ESTA ]]

class AbilitiesModal extends Modal {
    plugin: RPGLevelsPlugin;

    constructor(app: App, plugin: RPGLevelsPlugin) { //
        super(app); //
        this.plugin = plugin; //
    }

    async onOpen() { //
        const { contentEl } = this; //
        contentEl.empty(); //
        await this.plugin.applyAllPassiveEffects(); // Garante que proficiências de skill estejam atualizadas

        contentEl.createEl("h2", { text: "💪 Character Abilities, Saves & Skills" }); //

        const stats = this.plugin.settings.characterStats; //
        const saveProficiencies = this.plugin.settings.proficiencies; // Para saves
        const skillProficienciesData = this.plugin.settings.skillProficiencies; // Para skills
        const proficiencyBonus = this.plugin.settings.proficiencyBonus; //
        
        // Carrega as definições de skill dinamicamente
        const loadedSkills = await this.plugin.loadSkillDefinitions(); //

        contentEl.createEl("p", {text: `Current Proficiency Bonus: +${proficiencyBonus}`}); //
        contentEl.createEl("hr"); //

        const abilityOrder: (keyof CharacterStats)[] = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]; //

        contentEl.createEl("h3", { text: "Abilities & Saving Throws" }); //
        abilityOrder.forEach(statName => { //
            const statValue = stats[statName]; //
            const modifier = this.plugin.getAbilityModifier(statValue); //
            const modifierString = modifier >= 0 ? `+${modifier}` : `${modifier}`; //
            const saveProficiencyKey = `${statName.toLowerCase()}Save` as keyof typeof saveProficiencies; //

            const statDiv = contentEl.createDiv({ cls: "ability-entry" }); //
            statDiv.style.marginBottom = "15px"; //
            statDiv.style.padding = "10px"; //
            statDiv.style.border = "1px solid var(--background-modifier-border)"; //
            statDiv.style.borderRadius = "5px"; //

            statDiv.createEl("h4", { text: `${statName}: ${statValue} (${modifierString})` }); //

            new Setting(statDiv) //
                .setName(`${statName} Saving Throw Proficiency`) //
                .addToggle(toggle => toggle //
                    .setValue(saveProficiencies[saveProficiencyKey]) //
                    .onChange(async (value: boolean) => {
                  
                    (saveProficiencies as Record<string, boolean>)[saveProficiencyKey] = value;
                        await this.plugin.saveSettings(); //
                        new Notice(`${statName} Save Proficiency ${value ? 'Enabled' : 'Disabled'}.`); //
                        this.onOpen(); // Re-render para atualizar descrições de botões de rolagem
                    }));

            new Setting(statDiv) //
                .setName(`Roll ${statName} Check/Save`) //
                .setDesc(`1d20 + ${modifier}${saveProficiencies[saveProficiencyKey] ? ` + ${proficiencyBonus} (prof)` : ''}`) //
                .addButton(button => button //
                    .setButtonText("🎲 Roll") //
                    .setCta() //
                    .onClick(() => { //
                        const d20Roll = new Dice(20).roll(); //
                        let totalRoll = d20Roll + modifier; //
                        let rollExplanation = `Rolled ${d20Roll} (d20) + ${modifier} (mod)`; //

                        if (saveProficiencies[saveProficiencyKey]) { //
                            totalRoll += proficiencyBonus; //
                            rollExplanation += ` + ${proficiencyBonus} (prof)`; //
                        }
                        rollExplanation += ` = ${totalRoll}`; //
                        new Notice(`${statName} Roll: ${totalRoll}\n(${rollExplanation})`, 10000); //
                    }));
        });

        contentEl.createEl("hr"); //
        contentEl.createEl("h3", { text: "Skills" }); //

        if (!this.plugin.settings.skillFolders || this.plugin.settings.skillFolders.length === 0) {
            contentEl.createEl("p", { text: "No skill folders configured in settings. Please add skill folders in the plugin settings and create skill notes there." });
        } else if (loadedSkills.length === 0) {
            contentEl.createEl("p", { text: `No skill notes found in the configured folder(s): ${this.plugin.settings.skillFolders.join(', ')}. Ensure notes have 'baseAbility' in their frontmatter.` });
        } else {
            loadedSkills.forEach(skillDef => {
                const skillId = skillDef.id; // Nome do arquivo sem .md
                const skillDisplayName = skillDef.displayName;
                const baseAbilityScore = stats[skillDef.baseAbility];
                const abilityModifier = this.plugin.getAbilityModifier(baseAbilityScore);
                
                const skillProfData = skillProficienciesData[skillId] || { level: "none", sources: [] };
                let skillBonus = abilityModifier;
                let proficiencyDisplay = "None";
                let sourcesDisplay = "";
                if (skillProfData.sources && skillProfData.sources.length > 0) { // Adicionado para verificar se sources existe
                    sourcesDisplay = ` (Sources: ${skillProfData.sources.map(s => s.substring(s.lastIndexOf('/') + 1).replace(/\.md$/, '')).join(', ')})`;
                }


                if (skillProfData.level === "proficient") {
                    skillBonus += proficiencyBonus;
                    proficiencyDisplay = `Proficient (+${proficiencyBonus})`;
                } else if (skillProfData.level === "expert") {
                    skillBonus += (proficiencyBonus * 2);
                    proficiencyDisplay = `Expert (+${proficiencyBonus * 2})`;
                }

                const skillBonusString = skillBonus >= 0 ? `+${skillBonus}` : `${skillBonus}`;

                const skillDiv = contentEl.createDiv({ cls: "skill-entry" });
                skillDiv.style.paddingBlockStart = "8px"; //

                new Setting(skillDiv)
                    .setName(`${skillDisplayName} (${skillDef.baseAbility.substring(0,3)}): ${skillBonusString}`)
                    .setDesc(`Status: ${proficiencyDisplay}${sourcesDisplay}`)
                    .addButton(button => button
                        .setButtonText("🎲 Roll")
                        .onClick(() => {
                            const d20Roll = new Dice(20).roll();
                            const totalRoll = d20Roll + skillBonus;
                            const rollExplanation = `Rolled ${d20Roll} (d20) ${skillBonusString} (bonus) = ${totalRoll}`;
                            new Notice(`${skillDisplayName} Check: ${totalRoll}\n(${rollExplanation})`, 10000);
                        }));
            });
        }
        
        new Setting(contentEl) //
        .addButton(btn => btn //
            .setButtonText("Close") //
            .onClick(() => { //
                this.close(); //
            }));
    }

    onClose() { //
        this.contentEl.empty(); //
    }
}


class QuestModal extends Modal {
	plugin: RPGLevelsPlugin;

	constructor(app: App, plugin: RPGLevelsPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Available Quests" });

		const today = new Date();
		const todayMMDD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

		for (const [id, quest] of Object.entries(this.plugin.settings.quests)) {
			const questEl = contentEl.createDiv({ cls: "quest-item" });

			let isAvailable = false;

			const isRange = quest.availableDate?.includes(" to ");
			if (isRange) {
				const [startStr, endStr] = quest.availableDate.split(" to ");
				const start = this.parseMMDD(startStr);
				const end = this.parseMMDD(endStr);
				const now = new Date(2000, today.getMonth(), today.getDate());

				const startDate = new Date(2000, start.month - 1, start.day);
				const endDate = new Date(2000, end.month - 1, end.day);

				isAvailable = now >= startDate && now <= endDate;
			}
			else if (/^\d{2}-\d{2}$/.test(quest.availableDate)) {
				isAvailable = quest.availableDate === todayMMDD;
			}
			else {
				isAvailable = true;
				if (quest.lastCompleted && quest.respawnDays > 0) {
					const last = new Date(quest.lastCompleted);
					const respawn = new Date(last);
					respawn.setDate(respawn.getDate() + quest.respawnDays);
					isAvailable = today >= respawn;
				}
			}

			if (!isAvailable) {
				questEl.createEl("p", { text: `Quest unavailable until ${quest.availableDate}` });
				continue;
			}

			questEl.createEl("h3", { text: quest.title });
			questEl.createEl("p", { text: quest.description });

			// Container para os botões
			const buttonsDiv = questEl.createDiv();
			buttonsDiv.style.display = "flex";
			buttonsDiv.style.gap = "10px";

			// Botão Claim XP
			const claimBtn = buttonsDiv.createEl("button", { text: "Claim XP" });
			claimBtn.onclick = () => {
				const xpAmount = quest.xpReward;
				this.plugin.awardXP("questComplete", `Quest completed: ${quest.title} (+${xpAmount}XP)`, xpAmount);

				quest.completed = true;

				if (!quest.availableDate?.match(/^\d{2}-\d{2}$/) && !quest.availableDate?.includes(" to ") && quest.respawnDays > 0) {
					const newDate = new Date();
					newDate.setDate(newDate.getDate() + quest.respawnDays);
					quest.availableDate = newDate.toISOString().split("T")[0];
				}

				this.plugin.saveSettings();
				this.close();
			};

			// Botão Abrir Nota se existir configuração
			const notePath = this.plugin.settings.questNoteLinks?.[id];
			if (notePath) {
				const openNoteBtn = buttonsDiv.createEl("button", { text: "📓 Abrir Nota" });
				openNoteBtn.onclick = () => {
					this.app.workspace.openLinkText(notePath, '', false);
				};
			}
		}
	}

	onClose() {
		this.contentEl.empty();
	}

	private parseMMDD(str: string): { month: number; day: number } {
		const [monthStr, dayStr] = str.split("-");
		return {
			month: parseInt(monthStr, 10),
			day: parseInt(dayStr, 10)
		};
	}
}




class FeatsModal extends Modal {
	plugin: RPGLevelsPlugin;
    private allFeatsFromFoldersCache: string[]; // Cache para evitar recálculo
    private availableFeatsContainer: HTMLElement; 
    private searchInputEl: HTMLInputElement; // Referência ao elemento input

	constructor(app: App, plugin: RPGLevelsPlugin) {
		super(app); // [cite: 297]
		this.plugin = plugin; // [cite: 297]
        this.allFeatsFromFoldersCache = []; 
	}

	onOpen() {
        const { contentEl } = this; // [cite: 297]
        contentEl.empty(); 

        // Carrega todos os talentos das pastas uma vez ao abrir o modal
        this.allFeatsFromFoldersCache = this.plugin.getAvailableFeatsFromFolders(); // [cite: 298]

        contentEl.createEl("h2", { text: "Manage Feats" }); // [cite: 300]
        
        // === Feats obtidos ===
        contentEl.createEl("h3", { text: "Obtained Feats" }); // [cite: 300]
        const obtainedFeats: string[] = this.plugin.settings.obtainedFeats ?? []; // [cite: 298]
        const obtainedFeatsContainer = contentEl.createDiv();
        if (obtainedFeats.length === 0) { // [cite: 301]
            obtainedFeatsContainer.createEl("p", { text: "No feats yet." }); // [cite: 301]
        } else {
            obtainedFeats.forEach(async (feat: string) => { // [cite: 302]
                const featItemContainer = obtainedFeatsContainer.createDiv({cls: 'feat-item-obtained'});
                await MarkdownRenderer.renderMarkdown(`[[${feat}]]`, featItemContainer, feat, this.plugin); // [cite: 302]
                const linkEl = featItemContainer.querySelector("a.internal-link"); // [cite: 302]
                if (linkEl) { // [cite: 302]
                    linkEl.addEventListener("click", (e) => { // [cite: 302]
                        e.preventDefault(); // [cite: 302]
                        this.app.workspace.openLinkText(feat, '', false); // [cite: 302]
                    });
                }
            });
        }
        
        const removeFeatBtn = contentEl.createEl("button", { // [cite: 303]
            text: "🗑️ Remover Feat Obtido", // [cite: 303]
            cls: "mod-cta" // [cite: 303]
        });
        removeFeatBtn.onclick = () => { // [cite: 304]
            const feats = this.plugin.settings.obtainedFeats; // [cite: 304]
            if (!feats || feats.length === 0) { // Modificado para checar !feats também // [cite: 305]
                new Notice("Você não tem feats para remover."); // [cite: 305]
                return; // [cite: 305]
            }
            // A sub-classe FuzzySuggestModal para remover feats parece correta
            new class extends FuzzySuggestModal<string> { // [cite: 306]
                plugin: RPGLevelsPlugin; // [cite: 306]
                parentModal: Modal; // [cite: 306]
                constructor(app: App, plugin: RPGLevelsPlugin, parentModal: Modal) { // [cite: 307]
                  super(app); // [cite: 307]
                  this.plugin = plugin; // [cite: 307]
                  this.parentModal = parentModal; // [cite: 307]
                }
                getItems(): string[] { return this.plugin.settings.obtainedFeats; } // [cite: 308]
                getItemText(item: string): string { return item; } // [cite: 309]
                async onChooseItem(item: string) { // [cite: 310]
                  this.plugin.settings.obtainedFeats = this.plugin.settings.obtainedFeats.filter(f => f !== item); // [cite: 310]
                  await this.plugin.applyAllPassiveEffects(); // [cite: 311]
                  await this.plugin.saveSettings(); // [cite: 311]
                  new Notice(`Feat removido: ${item}`); // [cite: 311]
                  this.parentModal.close(); // [cite: 311]
                  new FeatsModal(this.app, this.plugin).open(); // [cite: 311]
                }
            }(this.app, this.plugin, this).open();
        };
        contentEl.createEl("hr");

        // === Seção de feats disponíveis com pesquisa ===
        contentEl.createEl("h3", { text: "Available Feats" }); // [cite: 313]

        this.searchInputEl = contentEl.createEl("input", {
            type: "text",
            placeholder: "Search available feats by name/path..."
        });
        this.searchInputEl.style.width = "100%";
        this.searchInputEl.style.marginBottom = "10px";
        
        // Adiciona o event listener ao elemento input
        this.searchInputEl.addEventListener("input", (event) => {
            const searchTerm = (event.target as HTMLInputElement).value;
            this.renderAvailableFeatsList(searchTerm);
        });

        this.availableFeatsContainer = contentEl.createDiv(); // Cria o container uma vez
        this.renderAvailableFeatsList(""); // Renderiza a lista inicial (todos os talentos)
	}

    renderAvailableFeatsList(searchTerm: string) {
        this.availableFeatsContainer.empty(); // Limpa apenas o container da lista
        const lowerSearchTerm = searchTerm.toLowerCase();

        const obtainedSet = new Set(this.plugin.settings.obtainedFeats ?? []);
        
        const filteredAndAvailableFeats = this.allFeatsFromFoldersCache.filter(featPath => {
            const isNotObtained = !obtainedSet.has(featPath);
            const matchesSearch = featPath.toLowerCase().includes(lowerSearchTerm);
            return isNotObtained && matchesSearch;
        });

        // Seu código original não distinguia entre "unique" e "repeatable" para feats,
        // então vamos listar todos os que passam pelo filtro.
        // A lógica de "repeatableFeats" estava vazia [cite: 298]

        if (filteredAndAvailableFeats.length === 0) { // [cite: 314]
            this.availableFeatsContainer.createEl("p", { text: "No feats available matching your criteria or all taken." }); // Parcialmente de [cite: 314]
        } else {
            filteredAndAvailableFeats.forEach((feat: string) => { // [cite: 316]
                const row = this.availableFeatsContainer.createDiv({ cls: "feat-row" }); // [cite: 316]
                // Estilização da linha
                row.style.display = "flex";
                row.style.justifyContent = "space-between";
                row.style.alignItems = "center";
                row.style.marginBottom = "8px";
                row.style.padding = "5px";
                row.style.border = "1px solid var(--background-modifier-border)";
                row.style.borderRadius = "4px";

                // Nome/Link do Feat (Clicável para abrir a nota)
                const featNameDiv = row.createDiv({cls: 'feat-name-link'});
                featNameDiv.style.flexGrow = "1";
                MarkdownRenderer.renderMarkdown(`[[${feat}]]`, featNameDiv, feat, this.plugin);
                const linkInName = featNameDiv.querySelector('a.internal-link');
                if(linkInName){
                    linkInName.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        this.app.workspace.openLinkText(feat, '', false);
                    });
                }
                
                const pickBtn = row.createEl("button", { text: "Pick Feat" }); // [cite: 316]
                pickBtn.onclick = async () => { // [cite: 316]
                    if ((this.plugin.settings.featPoints ?? 0) <= 0) { // [cite: 316]
                        new Notice("Você não tem pontos de feat suficientes."); // [cite: 316]
                        return; // [cite: 317]
                    }
                    this.plugin.settings.obtainedFeats.push(feat); // [cite: 317]
                    this.plugin.settings.featPoints!--; // [cite: 317]
                    await this.plugin.applyAllPassiveEffects(); // Garante que bônus do talento sejam aplicados [cite: 320]
                    await this.plugin.saveSettings(); // [cite: 317]
                    this.onOpen(); // Recarrega o modal para atualizar as listas e contagem de pontos
                };
            });
        }
    }

	onClose() {
		this.contentEl.empty(); // [cite: 321]
	}
}

const ObsidianHelper = {
	recurseVault(folder: TFolder, result: TFile[]) {
		for (const child of folder.children) {
			if (child instanceof TFile) result.push(child);
			else if (child instanceof TFolder) ObsidianHelper.recurseVault(child, result);
		}
	}
};

class ImageSuggestModal extends FuzzySuggestModal<TFile> {
	plugin: RPGLevelsPlugin;

	constructor(app: App, plugin: RPGLevelsPlugin) {
		super(app);
		this.plugin = plugin;
	}

	getItems(): TFile[] {
  const files: TFile[] = [];
  ObsidianHelper.recurseVault(this.app.vault.getRoot(), files);
  // agora testa o path, que contém o ".png", ".jpg" etc
  return files.filter(f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f.path));
 }



	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.plugin.settings.characterImagePath = item.path;
		this.plugin.saveSettings();
		new Notice(`Imagem selecionada: ${item.path}`);
	}
}



class RPGLevelsSettingTab extends PluginSettingTab {
	plugin: RPGLevelsPlugin;
	
	constructor(app: App, plugin: RPGLevelsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		
		containerEl.createEl('h2', { text: 'RPG Levels Plugin Settings' });

		// Variáveis temporárias
        let questPeriodStart = '';
        let questPeriodEnd = '';

        // Função que une as datas de período
         function updateRangeField() {
	     if (questPeriodStart && questPeriodEnd) {
		 newQuest.availableDate = `${questPeriodStart} to ${questPeriodEnd}`;
	    }
        }
		
		new Setting(containerEl)
			.setName('XP for creating a new note')
			.setDesc('How much XP to award when a new note is created')
			.addSlider(slider => slider
				.setLimits(1, 50, 1)
				.setValue(this.plugin.settings.xpGainRates.createNote)
				.onChange(async (value) => {
					this.plugin.settings.xpGainRates.createNote = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('XP for editing a note')
			.setDesc('How much XP to award when a note is edited')
			.addSlider(slider => slider
				.setLimits(1, 20, 1)
				.setValue(this.plugin.settings.xpGainRates.editNote)
				.onChange(async (value) => {
					this.plugin.settings.xpGainRates.editNote = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Edit cooldown time')
			.setDesc('Time to wait (in seconds) before awarding XP for edits')
			.addSlider(slider => slider
				.setLimits(1, 60, 1)
				.setValue(this.plugin.settings.editDebounceTime / 1000)
				.onChange(async (value) => {
					this.plugin.settings.editDebounceTime = value * 1000; // Convert to milliseconds
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('Minimum edit length')
			.setDesc('Minimum number of characters changed to award XP')
			.addSlider(slider => slider
				.setLimits(5, 100, 5)
				.setValue(this.plugin.settings.minEditLength)
				.onChange(async (value) => {
					this.plugin.settings.minEditLength = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('XP for creating a link')
			.setDesc('How much XP to award when creating an internal link')
			.addSlider(slider => slider
				.setLimits(1, 20, 1)
				.setValue(this.plugin.settings.xpGainRates.createLink)
				.onChange(async (value) => {
					this.plugin.settings.xpGainRates.createLink = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('XP for adding a tag')
			.setDesc('How much XP to award when adding a tag')
			.addSlider(slider => slider
				.setLimits(1, 10, 1)
				.setValue(this.plugin.settings.xpGainRates.addTag)
				.onChange(async (value) => {
					this.plugin.settings.xpGainRates.addTag = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('XP for daily streak')
			.setDesc('How much XP to award for using Obsidian each day')
			.addSlider(slider => slider
				.setLimits(5, 100, 5)
				.setValue(this.plugin.settings.xpGainRates.dailyStreak)
				.onChange(async (value) => {
					this.plugin.settings.xpGainRates.dailyStreak = value;
					await this.plugin.saveSettings();
				}));
		
		containerEl.createEl('h3', { text: 'Current Progress' });
		
		new Setting(containerEl)
			.setName('Level')
			.setDesc('Your current level')
			.addText(text => text
				.setValue(this.plugin.settings.level.toString())
				.setDisabled(true));
		
		new Setting(containerEl)
			.setName('Current XP')
			.setDesc('Your current XP')
			.addText(text => text
				.setValue(`${this.plugin.settings.currentXP}/${this.plugin.settings.xpToNextLevel}`)
				.setDisabled(true));
		
		new Setting(containerEl)
			.setName('Reset Progress')
			.setDesc('Warning: This will reset all your progress')
			.addButton(button => button
				.setButtonText('Reset')
				.onClick(async () => {
					if (window.confirm('Are you sure you want to reset all progress? This cannot be undone.')) {
						this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
						await this.plugin.saveSettings();
						this.plugin.updateStatusBar();
						this.display();
					}
				}));
		new Setting(containerEl)
		.setName('XP for easy tasks')
		.setDesc('How much XP to award when completing an easy task (#easy)')
		.addSlider(slider => slider
			.setLimits(1, 30, 1)
			.setValue(this.plugin.settings.xpGainRates.taskEasy)
			.onChange(async (value) => {
				this.plugin.settings.xpGainRates.taskEasy = value;
				await this.plugin.saveSettings();
			}));
	
	new Setting(containerEl)
		.setName('XP for medium tasks')
		.setDesc('How much XP to award when completing a medium task (#medium)')
		.addSlider(slider => slider
			.setLimits(5, 50, 1)
			.setValue(this.plugin.settings.xpGainRates.taskMedium)
			.onChange(async (value) => {
				this.plugin.settings.xpGainRates.taskMedium = value;
				await this.plugin.saveSettings();
			}));
	
	new Setting(containerEl)
		.setName('XP for hard tasks')
		.setDesc('How much XP to award when completing a hard task (#hard)')
		.addSlider(slider => slider
			.setLimits(10, 100, 5)
			.setValue(this.plugin.settings.xpGainRates.taskHard)
			.onChange(async (value) => {
				this.plugin.settings.xpGainRates.taskHard = value;
				await this.plugin.saveSettings();
			}));

			containerEl.createEl('h3', { text: 'Quest Management' });
			
			const toggleBtn = containerEl.createEl('button', {
	text: '▶ Mostrar Quests',
});
toggleBtn.style.marginBottom = '10px';
toggleBtn.style.cursor = 'pointer';

const questContainer = containerEl.createDiv();
questContainer.style.display = 'none'; // Começa escondido

let isVisible = false;

toggleBtn.addEventListener('click', () => {
	isVisible = !isVisible;
	questContainer.style.display = isVisible ? 'block' : 'none';
	toggleBtn.setText(isVisible ? '▼ Ocultar Quests' : '▶ Mostrar Quests');
});


			// Display existing quests
			
			questContainer.addClass('quests-container');
			questContainer.style.marginBottom = '20px';
			
			Object.entries(this.plugin.settings.quests).forEach(([id, quest]) => {
				const questEl = questContainer.createDiv();
				questEl.addClass('quest-item');
				questEl.style.marginBottom = '10px';
				questEl.style.padding = '10px';
				questEl.style.backgroundColor = 'var(--background-secondary)';
				questEl.style.borderRadius = '5px';
				
				const header = questEl.createDiv();
				header.style.display = 'flex';
				header.style.justifyContent = 'space-between';
				header.style.marginBottom = '5px';
				
				const title = header.createEl('h4');
				title.setText(quest.title);
				title.style.margin = '0';
				
				const controlButtons = header.createDiv();
				
				const deleteButton = controlButtons.createEl('button');
				deleteButton.setText('Delete');
				deleteButton.addEventListener('click', async () => {
					delete this.plugin.settings.quests[id];
					await this.plugin.saveSettings();
					this.display();
				});
				
				questEl.createEl('p', { text: quest.description });
				questEl.createEl('p', { text: `Reward: ${quest.xpReward} XP` });
				questEl.createEl('p', { text: `Respawn after: ${quest.respawnDays} days` });
				if (quest.availableDate) {
					questEl.createEl('p', { text: `Available on: ${quest.availableDate}` });
				}
				if (quest.lastCompleted) {
					questEl.createEl('p', { text: `Last completed: ${quest.lastCompleted}` });
				}
				new Setting(questEl)
	.setName("Nota associada (opcional)")
	.setDesc("Digite o caminho da nota (ex: 'Quests/MinhaNota.md')")
	.addText(text => {
		text.setPlaceholder("Ex: Quests/MinhaNota")
			.setValue(this.plugin.settings.questNoteLinks?.[id] || "")
			.onChange(async (value) => {
				if (!this.plugin.settings.questNoteLinks) {
					this.plugin.settings.questNoteLinks = {};
				}
				this.plugin.settings.questNoteLinks[id] = value.trim();
				await this.plugin.saveSettings();
			});
	});
			});

			new Setting(containerEl)
	.setName("Imagem do personagem")
	.setDesc("Selecione um arquivo de imagem do Vault")
	.addButton(btn => {
		btn.setButtonText("Escolher Imagem")
			.setCta()
			.onClick(() => {
				new ImageSuggestModal(this.app, this.plugin).open();
			});
	})
	.addExtraButton(extra => {
		extra.setIcon("cross")
			.setTooltip("Limpar imagem")
			.onClick(async () => {
				this.plugin.settings.characterImagePath = '';
				await this.plugin.saveSettings();
				this.display();
			});
	})
	.addText(text => {
		text.setValue(this.plugin.settings.characterImagePath || "")
			.setDisabled(true);
	});


new Setting(containerEl)
	.setName("Nota da Página do Personagem")
	.setDesc("Digite o caminho da nota (ex: Personagem/Arya.md)")
	.addText(text => {
		text.setPlaceholder("Personagem/Arya")
			.setValue(this.plugin.settings.characterNotePath || "")
			.onChange(async (value) => {
				this.plugin.settings.characterNotePath = value.trim();
				await this.plugin.saveSettings();
			});
	});

			
			// Add new quest
			containerEl.createEl('h4', { text: 'Add New Quest' });
			
			const questForm = containerEl.createDiv();
			questForm.style.backgroundColor = 'var(--background-secondary)';
			questForm.style.padding = '15px';
			questForm.style.borderRadius = '5px';
			
			let newQuest = {
				title: '',
				description: '',
				xpReward: 50,
				respawnDays: 1,
				availableDate: '',
				completed: false,
				lastCompleted: ''
			};
			
			new Setting(questForm)
				.setName('Quest Title')
				.addText(text => text
					.setPlaceholder('Quest title')
					.onChange(value => {
						newQuest.title = value;
					}));
			
			new Setting(questForm)
				.setName('Quest Description')
				.addTextArea(text => text
					.setPlaceholder('What needs to be done to complete this quest?')
					.onChange(value => {
						newQuest.description = value;
					}));
			
			new Setting(questForm)
				.setName('XP Reward')
				.addSlider(slider => slider
					.setLimits(10, 200, 5)
					.setValue(50)
					.setDynamicTooltip()
					.onChange(value => {
						newQuest.xpReward = value;
					}));
			
			new Setting(questForm)
				.setName('Respawn Days')
				.setDesc('Days before the quest becomes available again after completion (0 for one-time quests)')
				.addSlider(slider => slider
					.setLimits(0, 30, 1)
					.setValue(1)
					.setDynamicTooltip()
					.onChange(value => {
						newQuest.respawnDays = value;
					}));
			
			new Setting(questForm)
	.setName("Specific Date (Optional)")
	.setDesc("Available only on a specific day of the year (MM-DD)")
	.addText(text => {
		text.setPlaceholder("e.g., 12-25")
			.onChange(value => {
				const trimmed = value.trim();
				if (/^\d{2}-\d{2}$/.test(trimmed)) {
					newQuest.availableDate = trimmed;
				} else if (trimmed === '') {
					// Limpa se necessário
				} else {
					new Notice("Invalid format. Use MM-DD.");
				}
			});
	});

new Setting(questForm)
	.setName("Availability Period (Optional)")
	.setDesc("Available every year between two dates (MM-DD to MM-DD)")
	.addText(text => {
		text.setPlaceholder("Start (e.g., 12-20)")
			.onChange(startVal => {
				startVal = startVal.trim();
				if (!/^\d{2}-\d{2}$/.test(startVal) && startVal !== '') {
					new Notice("Invalid start date format. Use MM-DD.");
					return;
				}
				questPeriodStart = startVal;
				updateRangeField();
			});
	})
	.addText(text => {
		text.setPlaceholder("End (e.g., 12-25)")
			.onChange(endVal => {
				endVal = endVal.trim();
				if (!/^\d{2}-\d{2}$/.test(endVal) && endVal !== '') {
					new Notice("Invalid end date format. Use MM-DD.");
					return;
				}
				questPeriodEnd = endVal;
				updateRangeField();
			});
	});
	
			
			
			new Setting(questForm)
				.addButton(button => button
					.setButtonText('Add Quest')
					.setCta()
					.onClick(async () => {
						if (!newQuest.title || !newQuest.description) {
							new Notice('Please provide a title and description for the quest');
							return;
						}
						
						// Generate a unique ID
						const questId = 'quest_' + Date.now();
						
						// Add to settings
						this.plugin.settings.quests[questId] = newQuest;
						await this.plugin.saveSettings();
						
						// Reset form and refresh
						newQuest = {
							title: '',
							description: '',
							xpReward: 50,
							respawnDays: 1,
							availableDate: '',
							completed: false,
							lastCompleted: ''
						};
						
						// Refresh the settings panel
						this.display();
					}));

	new Setting(containerEl)
  .setName("Effect Folder Paths")
  .setDesc("Select folders that contain effect notes.")
  .addButton(button => {
    button.setButtonText("Add Folder");
    button.onClick(async () => {
      const folderModal = new FolderSuggestModal(this.app);
      folderModal.open();
      folderModal.onChooseFolder = (folderPath: string) => {
        if (!this.plugin.settings.effectFolders.includes(folderPath)) {
          this.plugin.settings.effectFolders.push(folderPath);
          this.plugin.saveSettings();
          this.display();
        }
      };
    });
  });

 this.plugin.settings.effectFolders.forEach((folderPath, index) => {
   new Setting(containerEl)
    .setName(`🧪 ${folderPath}`)
    .addButton(button =>
      button.setButtonText("❌")
        .setTooltip("Remove")
        .onClick(() => {
          this.plugin.settings.effectFolders.splice(index, 1);
          this.plugin.saveSettings();
          this.display();
        })
    );
 });

 new Setting(containerEl)
  .setName("Pastas de Efeitos Repetíveis")
  .setDesc("Permite adicionar múltiplas instâncias do mesmo efeito")
  .addButton(button => {
    button.setButtonText("Adicionar Pasta");
    button.onClick(() => {
      const folderModal = new FolderSuggestModal(this.app);
      folderModal.open();
      folderModal.onChooseFolder = (folderPath: string) => {
        if (!this.plugin.settings.repeatableEffectFolders.includes(folderPath)) {
          this.plugin.settings.repeatableEffectFolders.push(folderPath);
          this.plugin.saveSettings();
          this.display();
        }
      };
    });
  });

this.plugin.settings.repeatableEffectFolders.forEach((folderPath, index) => {
  new Setting(containerEl)
    .setName(`♻️ ${folderPath}`)
    .addButton(button =>
      button.setButtonText("❌")
        .setTooltip("Remover")
        .onClick(() => {
          this.plugin.settings.repeatableEffectFolders.splice(index, 1);
          this.plugin.saveSettings();
          this.display();
        })
    );
});



	new Setting(containerEl)
	.setName("Feats Folder Paths")
	.setDesc("Select folders that contain feat notes.")
	.addButton(button => {
		button.setButtonText("Add Folder");
		button.onClick(async () => {
			// Use Obsidian's folder suggestion modal
			const folderModal = new FolderSuggestModal(this.app);
			folderModal.open();

			folderModal.onChooseFolder = (folderPath: string) => {
				if (!this.plugin.settings.featFolders.includes(folderPath)) {
					this.plugin.settings.featFolders.push(folderPath);
					this.plugin.saveSettings();
					this.display(); // Refresh settings UI
				}
			};
		});
	});

this.plugin.settings.featFolders.forEach((folderPath, index) => {
	new Setting(containerEl)
		.setName(`📁 ${folderPath}`)
		.addButton(button =>
			button
				.setButtonText("❌")
				.setTooltip("Remove")
				.onClick(() => {
					this.plugin.settings.featFolders.splice(index, 1);
					this.plugin.saveSettings();
					this.display(); // Refresh
				})
		);
});

new Setting(containerEl)
  .setName("Feat Points")
  .setDesc("Número atual de Feat Points do personagem.")
  .addText(text => text
    .setPlaceholder("0")
    .setValue(String(this.plugin.settings.featPoints ?? 0))
    .onChange(async (value) => {
      const parsed = parseInt(value);
      if (!isNaN(parsed) && parsed >= 0) {
        this.plugin.settings.featPoints = parsed;
        await this.plugin.saveSettings();
      }
    }));

	new Setting(containerEl)
  .setName("Base HP Die (dX)")
  .addText(text => text
    .setPlaceholder("Ex: 6, 8, 10, 12")
    .setValue(this.plugin.settings.health.baseDie.toString())
    .onChange(async (val) => {
      const parsed = parseInt(val);
      if (!isNaN(parsed) && parsed > 0) {
        this.plugin.settings.health.baseDie = parsed;
        await this.plugin.saveSettings();
      }
    }));

	new Setting(containerEl)
  .setName('Modo de ganho de HP por nível')
  .setDesc('Escolha se quer o valor máximo, médio ou rolar o dado para os próximos níveis')
  .addDropdown(drop => {
    drop.addOption("maximo", "Sempre o Máximo");
    drop.addOption("media", "Média");
    drop.addOption("rolar", "Rolar o Dado");

    drop.setValue(this.plugin.settings.health.autoHpMode);
    drop.onChange(async (value: "maximo" | "media" | "rolar") => {
      this.plugin.settings.health.autoHpMode = value;
      await this.plugin.saveSettings();
      new Notice(`Modo de ganho de HP ajustado para: ${value}`);
    });
  });

  new Setting(containerEl)
    .setName("Skill Folders")
    .setDesc("Pastas contendo as notas que definem as skills (perícias). Uma skill por nota. Separe múltiplos caminhos por vírgula.")
    .addTextArea(text => text
        .setPlaceholder("Ex: Skills RPG/Combat, Skills RPG/Social")
        .setValue(this.plugin.settings.skillFolders.join(", "))
        .onChange(async (value) => {
            this.plugin.settings.skillFolders = value.split(",").map(f => f.trim()).filter(f => f.length > 0);
            await this.plugin.saveSettings();
            await this.plugin.applyAllPassiveEffects(); // Para recarregar skills e suas proficiências
        }));



}
}