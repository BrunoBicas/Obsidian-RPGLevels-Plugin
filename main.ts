import { App, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, Notice } from 'obsidian';

interface RPGLevelsSettings {
	currentXP: number;
	level: number;
	xpToNextLevel: number;
	xpGainRates: {
		createNote: number;
		editNote: number;
		createLink: number;
		addTag: number;
		dailyStreak: number;
	};
	achievements: {
		[key: string]: boolean;
	};
	lastActive: string;
	streakDays: number;
	dailyXpAwarded: boolean;
	initializedNoteCount: boolean;
}

const DEFAULT_SETTINGS: RPGLevelsSettings = {
	currentXP: 0,
	level: 1,
	xpToNextLevel: 100,
	xpGainRates: {
		createNote: 10,
		editNote: 5,
		createLink: 3,
		addTag: 2,
		dailyStreak: 20
	},
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
	initializedNoteCount: false
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
	
	async onload() {
		await this.loadSettings();
		
		// Add status bar item to show current level and XP
		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar();
		
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
				})
			);
			
			this.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (file instanceof TFile && file.extension === 'md') {
						this.awardXP('editNote', `Edited note: +${this.settings.xpGainRates.editNote}XP`);
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
			
			// Check for daily streak when Obsidian loads, but only award XP once per day
			this.checkDailyStreak();
		}, 1000); // 1 second delay
		
		// Add commands
		this.addCommand({
			id: 'view-rpg-stats',
			name: 'View RPG Stats',
			callback: () => {
				this.showStatsModal();
			}
		});
	}
	
	onunload() {
		// Save settings when plugin unloads
		this.saveSettings();
	}
	
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		
		// Make sure the new initializedNoteCount property exists
		if (this.settings.initializedNoteCount === undefined) {
			this.settings.initializedNoteCount = false;
		}
	}
	
	async saveSettings() {
		await this.saveData(this.settings);
	}
	
	updateStatusBar() {
		this.statusBarEl.setText(`Level ${this.settings.level} | XP: ${this.settings.currentXP}/${this.settings.xpToNextLevel}`);
	}
	
	awardXP(type: keyof typeof DEFAULT_SETTINGS.xpGainRates, message: string) {
		// Don't award XP during initialization
		if (this.isInitializing) return;
		
		const xpAmount = this.settings.xpGainRates[type];
		this.settings.currentXP += xpAmount;
		
		// Check if level up
		if (this.settings.currentXP >= this.settings.xpToNextLevel) {
			this.levelUp();
		} else {
			this.updateStatusBar();
			this.saveSettings();
			new Notice(message);
		}
	}
	
	levelUp() {
		this.settings.level++;
		this.settings.currentXP = this.settings.currentXP - this.settings.xpToNextLevel;
		this.settings.xpToNextLevel = Math.floor(this.settings.xpToNextLevel * 1.5); // Increase XP required for next level
		
		this.updateStatusBar();
		this.saveSettings();
		this.checkAchievements();
		
		// Show level up message with more fanfare
		new Notice(`🎉 LEVEL UP! 🎉 You reached level ${this.settings.level}!`, 5000);
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
	}
}