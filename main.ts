import { App, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, Notice, Modal, TFolder, TAbstractFile, FuzzySuggestModal, MarkdownRenderer } from 'obsidian';

interface CharacterStats {
	Strength: number;
	Dexterity: number;
	Constitution: number;
	Intelligence: number;
	Wisdom: number;
	Charisma: number;
}

interface EffectData {
  notePath: string;
  startDate?: string;
  durationDays?: number;
  permanent?: boolean;
  active: boolean;
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

class EffectsModal extends Modal {
  plugin: RPGLevelsPlugin;

  constructor(app: App, plugin: RPGLevelsPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
  const { contentEl } = this;
  contentEl.createEl("h2", { text: "Efeitos Ativos" });

  // === Limpa efeitos expirados ===
  const rawEffects: Record<string, EffectData> = this.plugin.settings.effects ?? {};
  const activeEffects: Record<string, EffectData> = {};
  let expiredCount = 0;

  for (const [id, effect] of Object.entries(rawEffects)) {
    if (this.plugin.isEffectExpired(effect)) {
      expiredCount++;
      continue;
    }
    activeEffects[id] = effect;
  }

  this.plugin.settings.effects = activeEffects;
  if (expiredCount > 0) {
    this.plugin.saveSettings();
    new Notice(`${expiredCount} efeito(s) expirado(s) foram removidos.`);
  }

  // === Renderiza efeitos ativos ===
  const effectKeys = Object.keys(activeEffects);
  if (effectKeys.length === 0) {
    contentEl.createEl("p", { text: "Nenhum efeito ativo." });
  } else {
    effectKeys.forEach(key => {
      const effect = activeEffects[key];
      const isExpired = this.plugin.isEffectExpired(effect);
      const remaining = this.plugin.getTimeRemaining(effect);

      const effectDiv = contentEl.createDiv({ cls: "effect-item" });
      effectDiv.style.border = "1px solid var(--background-modifier-border)";
      effectDiv.style.borderRadius = "5px";
      effectDiv.style.padding = "10px";
      effectDiv.style.marginBottom = "10px";

      effectDiv.createEl("h4", { text: effect.notePath });

      effectDiv.createEl("p", {
        text: effect.permanent
          ? "⏳ Permanente"
          : isExpired
            ? "❌ Expirado"
            : `🕒 ${remaining?.days} dia(s) e ${remaining?.hours} hora(s) restantes`
      });

      if (isExpired) {
        effectDiv.style.opacity = "0.5";
      }

      const buttonRow = effectDiv.createDiv({ cls: "button-row" });

      const openBtn = buttonRow.createEl("button", { text: "Abrir Nota" });
      openBtn.onclick = () => {
        this.app.workspace.openLinkText(effect.notePath, '', false);
      };

      const removeBtn = buttonRow.createEl("button", { text: "Remover" });
      removeBtn.onclick = async () => {
        delete this.plugin.settings.effects[key];
        await this.plugin.saveSettings();
        this.close();
        new EffectsModal(this.app, this.plugin).open();
      };
    });
  }

  // === Seção de Adição de Efeitos ===
  contentEl.createEl("h3", { text: "Efeitos únicos disponíveis" });

  const addedPaths = Object.values(activeEffects).map(e => e.notePath);
  const uniqueAvailable = this.plugin.getAvailableEffectsFromFolders()
    .filter(p => !addedPaths.includes(p));

  if (uniqueAvailable.length === 0) {
    contentEl.createEl("p", { text: "Nenhum efeito único disponível." });
  } else {
    uniqueAvailable.forEach(path => {
      this.renderEffectEntry(contentEl, path);
    });
  }

  contentEl.createEl("h3", { text: "Efeitos repetíveis disponíveis" });

  const repeatableAvailable = this.plugin.getAvailableRepeatableEffects();

  if (repeatableAvailable.length === 0) {
    contentEl.createEl("p", { text: "Nenhum efeito repetível disponível." });
  } else {
    repeatableAvailable.forEach(path => {
      this.renderEffectEntry(contentEl, path);
    });
  }
}

  renderEffectEntry(contentEl: HTMLElement, path: string) {
    const container = contentEl.createDiv({ cls: "effect-entry" });
    container.style.marginBottom = "10px";
    container.style.padding = "10px";
    container.style.border = "1px solid var(--background-modifier-border)";
    container.style.borderRadius = "5px";

    const header = container.createDiv({ cls: "effect-header" });
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    header.createEl("b", { text: path });

    const toggleBtn = header.createEl("button", { text: "➕ Adicionar" });
    const configDiv = container.createDiv();
    configDiv.style.display = "none";

    toggleBtn.onclick = () => {
      const opened = configDiv.style.display === "block";
      configDiv.style.display = opened ? "none" : "block";
      toggleBtn.setText(opened ? "➕ Adicionar" : "✖ Cancelar");
    };

    let duration = 3;
    let permanent = false;

    new Setting(configDiv)
      .setName("Duração (dias)")
      .setDesc("Deixe 0 para ignorar")
      .addText(text => {
        text.setPlaceholder("Ex: 3")
          .setValue(duration.toString())
          .onChange(value => {
            const parsed = parseInt(value);
            duration = !isNaN(parsed) && parsed >= 0 ? parsed : 0;
          });
      });

    new Setting(configDiv)
      .setName("Permanente")
      .addToggle(toggle => {
        toggle.setValue(permanent).onChange(value => {
          permanent = value;
        });
      });

    new Setting(configDiv)
      .addButton(button => {
        button.setButtonText("Confirmar")
          .setCta()
          .onClick(async () => {
            const id = `eff_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            this.plugin.settings.effects[id] = {
              notePath: path,
              startDate: new Date().toISOString(),
              durationDays: permanent ? undefined : duration,
              permanent,
              active: true
            };
            await this.plugin.saveSettings();
            this.close();
            new EffectsModal(this.app, this.plugin).open();
          });
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class StatsModal extends Modal {
  plugin: RPGLevelsPlugin;

  constructor(app: App, plugin: RPGLevelsPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    const stats = this.plugin.settings.characterStats;

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

    if (this.plugin.settings.characterNotePath) {
      contentEl.createEl("button", { text: "📘 Abrir Página do Personagem", cls: "mod-cta" })
        .onclick = () => {
          this.app.workspace.openLinkText(this.plugin.settings.characterNotePath!, '', false);
        };
    }

    contentEl.createEl("h2", { text: `Level ${level} - Character Stats` });
    for (const [stat, value] of Object.entries(stats)) {
      contentEl.createEl("p", { text: `${stat}: ${value}` });
    }

    contentEl.createEl("button", { text: "Usar Feat Point para aumentar atributo", cls: "mod-cta" })
      .onclick = () => {
        if ((this.plugin.settings.featPoints ?? 0) <= 0) {
          new Notice("Você não tem Feat Points disponíveis.");
          return;
        }

        const plugin = this.plugin;
        const parentModal = this;

        new class extends FuzzySuggestModal<string> {
          stats: CharacterStats;
          plugin: RPGLevelsPlugin;
          parentModal: Modal;

          constructor(app: App, plugin: RPGLevelsPlugin, stats: CharacterStats, parentModal: Modal) {
            super(app);
            this.plugin = plugin;
            this.stats = stats;
            this.parentModal = parentModal;
          }

          getItems(): string[] {
            return Object.keys(this.stats);
          }
          getItemText(item: string): string {
            return item;
          }
          onChooseItem(item: string): void {
            const statKey = item as keyof CharacterStats;
            const atual = this.stats[statKey];

            if (atual >= 30) {
              new Notice(`${statKey} já está no máximo (30).`);
              return;
            }

            this.stats[statKey]++;
            this.plugin.settings.featPoints!--;

            this.plugin.saveSettings().then(() => {
              new Notice(`${statKey} aumentado para ${this.stats[statKey]}!`);
              this.parentModal.close();
              new StatsModal(this.app, this.plugin).open();
            });
          }
        }(this.app, plugin, this.plugin.settings.characterStats, parentModal).open();
      };

	  	contentEl.createEl("button", {
   text: "Manage Effects",
   cls: "mod-cta"
 }).onclick = () => {
   this.close();
   new EffectsModal(this.app, this.plugin).open();
  };

  const activeEffects = Object.values(this.plugin.settings.effects).filter(e => e.active && !this.plugin.isEffectExpired(e));
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

	constructor(app: App, plugin: RPGLevelsPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
  const { contentEl } = this;

  // === Feats obtidos ===
  const obtainedFeats: string[] = this.plugin.settings.obtainedFeats ?? [];
  const allFeats = this.plugin.getAvailableFeatsFromFolders();
  const repeatableFeats = this.plugin.getAvailableRepeatableEffects();
  const alreadyObtained = new Set(obtainedFeats);

  contentEl.createEl("h2", { text: "Manage Feats" });

  contentEl.createEl("h3", { text: "Obtained Feats" });
  if (obtainedFeats.length === 0) {
    contentEl.createEl("p", { text: "No feats yet." });
  } else {
    obtainedFeats.forEach(async (feat: string) => {
      const container = contentEl.createDiv();
      await MarkdownRenderer.renderMarkdown(`[[${feat}]]`, container, '', this.plugin);
      const linkEl = container.querySelector("a.internal-link");
      if (linkEl) {
        linkEl.addEventListener("click", (e) => {
          e.preventDefault();
          this.app.workspace.openLinkText(feat, '', false);
        });
      }
    });
  }

  // === Feats únicos ===
  const uniqueAvailable = allFeats.filter(f => !alreadyObtained.has(f));

  // === Seção de feats disponíveis ===
  contentEl.createEl("h3", { text: "Available Feats" });

  if (uniqueAvailable.length === 0 && repeatableFeats.length === 0) {
    contentEl.createEl("p", { text: "No feats available." });
  } else {
    // 🟩 Feats únicos
    if (uniqueAvailable.length > 0) {
      contentEl.createEl("h4", { text: "Unique Feats" });
      uniqueAvailable.forEach((feat: string) => {
        const row = contentEl.createDiv({ cls: "feat-row" });
        row.createEl("span", { text: feat });

        const pickBtn = row.createEl("button", { text: "Pick Feat" });
        pickBtn.onclick = async () => {
          if ((this.plugin.settings.featPoints ?? 0) <= 0) {
            new Notice("Você não tem pontos de feat suficientes.");
            return;
          }
          this.plugin.settings.obtainedFeats.push(feat);
          this.plugin.settings.featPoints!--;
          await this.plugin.saveSettings();
          this.close();
          new FeatsModal(this.app, this.plugin).open();
        };
      });
    }

    // ♻️ Efeitos repetíveis
    if (repeatableFeats.length > 0) {
      contentEl.createEl("h4", { text: "Repeatable Effects" });
      repeatableFeats.forEach((feat: string) => {
        const row = contentEl.createDiv({ cls: "feat-row" });
        row.createEl("span", { text: feat });

        const pickBtn = row.createEl("button", { text: "Pick Feat" });
        pickBtn.onclick = async () => {
          if ((this.plugin.settings.featPoints ?? 0) <= 0) {
            new Notice("Você não tem pontos de feat suficientes.");
            return;
          }
          this.plugin.settings.obtainedFeats.push(feat); // permite duplicados
          this.plugin.settings.featPoints!--;
          await this.plugin.saveSettings();
          this.close();
          new FeatsModal(this.app, this.plugin).open();
        };
      });
    }
  }
}

	onClose() {
		this.contentEl.empty();
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


	}
}