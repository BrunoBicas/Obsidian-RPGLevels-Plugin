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
		taskEasy: number;
        taskMedium: number; 
        taskHard: number;
	};
	achievements: {
		[key: string]: boolean;
	};
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
	xpGainRates: {
		createNote: 10,
		editNote: 5,
		createLink: 3,
		addTag: 2,
		dailyStreak: 20,
		taskEasy: 5,
        taskMedium: 15,
        taskHard: 30
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
	}
}