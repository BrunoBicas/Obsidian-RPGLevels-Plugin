import { App, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, Notice, Modal } from 'obsidian';

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
        dailyQuestCompletion: number; // XP for completing daily quest
    };
    achievements: {
        [key: string]: boolean;
        // ... existing achievements
    };
    lastActive: string;
    streakDays: number;
    dailyXpAwarded: boolean;
    initializedNoteCount: boolean;
    editDebounceTime: number;
    minEditLength: number;

    dailyQuest: DailyQuest | null; // Add current daily quest
    dailyQuestCompleted: boolean; // Track if daily quest is completed
    dailyQuestProgress: number; // Track progress towards daily quest
}

interface DailyQuest {
    id: string;
    name: string;
    description: string;
    type: 'createNote' | 'editNote' | 'createLink' | 'addTag'; // Define quest types
    target: number; // Target number for the quest
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
        dailyQuestCompletion: 30, // Default XP for daily quest completion
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
    editDebounceTime: 10000,
    minEditLength: 20,

    dailyQuest: null, // Initially no daily quest
    dailyQuestCompleted: false, // Not completed at start of day
    dailyQuestProgress: 0,     // Progress starts at zero
};

const DAILY_QUESTS: DailyQuest[] = [ // Define some example daily quests
    {
        id: "quest_create_3_notes",
        name: "Note Creator",
        description: "Create 3 new notes today.",
        type: 'createNote',
        target: 3,
    },
    {
        id: "quest_edit_5_notes",
        name: "Note Enhancer",
        description: "Edit 5 notes today.", // Editing counts if minEditLength is met
        type: 'editNote',
        target: 5,
    },
    {
        id: "quest_link_10_notes",
        name: "Link Master",
        description: "Create 10 internal links today.",
        type: 'createLink',
        target: 10,
    },
    {
        id: "quest_tag_20_notes",
        name: "Tag Organizer",
        description: "Add 20 tags to your notes today.",
        type: 'addTag',
        target: 20,
    },
];


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
    isInitializing: boolean = true;

    private editTimer: NodeJS.Timeout | null = null;
    private currentEditFile: string | null = null;
    private originalContent: string = '';
    private hasActiveFile: boolean = false;
    private previousTags: string[] = [];


    async onload() {
        await this.loadSettings();

        this.statusBarEl = this.addStatusBarItem();
        this.updateStatusBar();

        this.addSettingTab(new RPGLevelsSettingTab(this.app, this));

        try {
            const files = await this.app.vault.getMarkdownFiles();
            this.noteCount = files.length;
            this.checkAchievementsNoXP();
        } catch (error) {
            console.error("Error initializing note count:", error);
            this.noteCount = 0;
        }

        setTimeout(() => {
            this.isInitializing = false;

            this.registerEvent(
                this.app.vault.on('create', (file) => {
                    if (file instanceof TFile && file.extension === 'md') {
                        this.noteCount++;
                        if (!this.isInitializing) {
                            this.awardXP('createNote', `Created note: +${this.settings.xpGainRates.createNote}XP`);
                            this.checkAchievements();
                            this.checkDailyQuestProgress('createNote'); // Check daily quest progress
                        }
                    }
                })
            );

            this.registerEvent(
                this.app.workspace.on('file-open', async (file) => {
                    if (file instanceof TFile && file.extension === 'md') {
                        this.currentEditFile = file.path;
                        this.originalContent = await this.app.vault.read(file);
                        this.hasActiveFile = true;
                        
                        // Initialize link count for this file
                        this.linkCount = (this.originalContent.match(/\[\[.*?\]\]/g) || []).length;
                        
                        // Initialize tag tracking for this file
                        this.previousTags = this.extractTags(this.originalContent);
                    }
                })
            );

            this.registerEvent(
                this.app.vault.on('modify', (file) => {
                    if (file instanceof TFile && file.extension === 'md' && !this.isInitializing) {
                        this.handleFileModified(file);
                    }
                })
            );

            this.registerEvent(
                this.app.workspace.on('editor-change', async (editor) => {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (view) {
                        const text = editor.getValue();
                        
                        // Check for new links
                        const linkCountNew = (text.match(/\[\[.*?\]\]/g) || []).length;
                        if (linkCountNew > this.linkCount) {
                            const diff = linkCountNew - this.linkCount;
                            for (let i = 0; i < diff; i++) {
                                this.awardXP('createLink', `Created link: +${this.settings.xpGainRates.createLink}XP`);
                                this.checkDailyQuestProgress('createLink'); // Check daily quest progress
                            }
                            this.linkCount = linkCountNew;
                            this.checkAchievements();
                        }
                        
                        // Check for new tags with improved tag detection
                        const currentTags = this.extractTags(text);
                        const newTags = currentTags.filter(tag => !this.previousTags.includes(tag));
                        
                        if (newTags.length > 0) {
                            for (let i = 0; i < newTags.length; i++) {
                                this.awardXP('addTag', `Added tag: +${this.settings.xpGainRates.addTag}XP`);
                                this.checkDailyQuestProgress('addTag'); // Check daily quest progress
                            }
                            this.previousTags = currentTags;
                        }
                    }
                })
            );

            this.checkDailyStreak();
            this.initializeDailyQuest(); // Initialize daily quest on load
            this.initializeCurrentFile();
        }, 1000);

        this.addCommand({
            id: 'view-rpg-stats',
            name: 'View RPG Stats',
            callback: () => {
                this.showStatsModal();
            }
        });
    }

    // Helper method to extract tags from content
    extractTags(content: string): string[] {
        const tagRegex = /#[a-zA-Z0-9_-]+/g;
        return content.match(tagRegex) || [];
    }

    async initializeCurrentFile() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file) {
            this.currentEditFile = activeView.file.path;
            this.originalContent = await this.app.vault.read(activeView.file);
            this.hasActiveFile = true;
            const text = activeView.editor.getValue();
            this.linkCount = (text.match(/\[\[.*?\]\]/g) || []).length;
            this.previousTags = this.extractTags(text);
        }
    }


    async handleFileModified(file: TFile) {
        if (this.editTimer) {
            clearTimeout(this.editTimer);
        }

        this.editTimer = setTimeout(async () => {
            try {
                if (this.currentEditFile === file.path && this.hasActiveFile) {
                    const newContent = await this.app.vault.read(file);
                    const contentDifference = Math.abs(newContent.length - this.originalContent.length);

                    if (contentDifference >= this.settings.minEditLength) {
                        this.awardXP('editNote', `Completed edit: +${this.settings.xpGainRates.editNote}XP`);
                        this.originalContent = newContent;
                        this.checkDailyQuestProgress('editNote'); // Check daily quest progress
                    }
                }
            } catch (error) {
                console.error("Error processing file edit:", error);
            }
        }, this.settings.editDebounceTime);
    }

    onunload() {
        if (this.editTimer) {
            clearTimeout(this.editTimer);
        }
        this.saveSettings();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        if (this.settings.initializedNoteCount === undefined) {
            this.settings.initializedNoteCount = false;
        }
        if (this.settings.editDebounceTime === undefined) {
            this.settings.editDebounceTime = DEFAULT_SETTINGS.editDebounceTime;
        }
        if (this.settings.minEditLength === undefined) {
            this.settings.minEditLength = DEFAULT_SETTINGS.minEditLength;
        }
        if (this.settings.dailyQuest === undefined) { // Ensure dailyQuest setting exists in older settings
            this.settings.dailyQuest = DEFAULT_SETTINGS.dailyQuest;
        }
        if (this.settings.dailyQuestCompleted === undefined) {
            this.settings.dailyQuestCompleted = DEFAULT_SETTINGS.dailyQuestCompleted;
        }
        if (this.settings.dailyQuestProgress === undefined) {
            this.settings.dailyQuestProgress = DEFAULT_SETTINGS.dailyQuestProgress;
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    updateStatusBar() {
        let statusBarText = `Level ${this.settings.level} | XP: ${this.settings.currentXP}/${this.settings.xpToNextLevel}`;
        if (this.settings.dailyQuest) {
            statusBarText += ` | Quest: ${this.settings.dailyQuest.name} (${this.settings.dailyQuestProgress}/${this.settings.dailyQuest.target})`;
        }
        this.statusBarEl.setText(statusBarText);
    }

    awardXP(type: keyof typeof DEFAULT_SETTINGS.xpGainRates, message: string) {
        if (this.isInitializing) return;

        const xpAmount = this.settings.xpGainRates[type];
        this.settings.currentXP += xpAmount;

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
        this.settings.xpToNextLevel = Math.floor(this.settings.xpToNextLevel * 1.5);

        this.updateStatusBar();
        this.saveSettings();
        this.checkAchievements();

        new Notice(`🎉 LEVEL UP! 🎉 You reached level ${this.settings.level}!`, 5000);
    }

    checkDailyStreak() {
        const today = new Date().toDateString();

        if (this.settings.lastActive === '') {
            this.settings.lastActive = today;
            this.settings.streakDays = 1;
            this.settings.dailyXpAwarded = true;
            this.saveSettings();
            return;
        }

        const lastActiveDate = new Date(this.settings.lastActive);
        const currentDate = new Date(today);

        const timeDiff = currentDate.getTime() - lastActiveDate.getTime();
        const dayDiff = Math.floor(timeDiff / (1000 * 3600 * 24));

        if (dayDiff >= 1 && !this.settings.dailyXpAwarded) {
            if (dayDiff === 1) {
                this.settings.streakDays++;
                if (!this.isInitializing) {
                    this.awardXP('dailyStreak', `Daily streak (${this.settings.streakDays} days): +${this.settings.xpGainRates.dailyStreak}XP`);
                }
                this.checkAchievements();
            } else if (dayDiff > 1) {
                if (!this.isInitializing) {
                    new Notice(`Streak reset! You were away for ${dayDiff} days.`);
                }
                this.settings.streakDays = 1;
            }
            this.settings.dailyXpAwarded = true;

            this.initializeDailyQuest(); // Assign new daily quest on new day
        }

        if (this.settings.lastActive !== today) {
            this.settings.lastActive = today;
            this.settings.dailyXpAwarded = false;
        }

        this.saveSettings();
    }

    initializeDailyQuest() {
        if (!this.settings.dailyQuest || new Date().toDateString() !== new Date(this.settings.lastActive).toDateString()) {
            // Select a random daily quest if none exists or it's a new day
            const randomIndex = Math.floor(Math.random() * DAILY_QUESTS.length);
            this.settings.dailyQuest = DAILY_QUESTS[randomIndex];
            this.settings.dailyQuestCompleted = false;
            this.settings.dailyQuestProgress = 0;
            this.updateStatusBar(); // Update status bar to show new quest
            this.saveSettings();
            if (!this.isInitializing) {
                new Notice(`New daily quest: ${this.settings.dailyQuest.name} - ${this.settings.dailyQuest.description}`);
            }
        }
    }

    checkDailyQuestProgress(actionType: 'createNote' | 'editNote' | 'createLink' | 'addTag') {
        if (!this.settings.dailyQuest || this.settings.dailyQuestCompleted || this.isInitializing) return;

        if (this.settings.dailyQuest.type === actionType) {
            this.settings.dailyQuestProgress++;
            this.updateStatusBar();

            if (this.settings.dailyQuestProgress >= this.settings.dailyQuest.target) {
                this.completeDailyQuest();
            } else {
                this.saveSettings(); // Save progress even if not completed
            }
        }
    }

    completeDailyQuest() {
        if (this.settings.dailyQuest && !this.settings.dailyQuestCompleted) {
            this.settings.dailyQuestCompleted = true;
            this.awardXP('dailyQuestCompletion', `Daily Quest "${this.settings.dailyQuest.name}" Completed! +${this.settings.xpGainRates.dailyQuestCompletion}XP`);
            this.updateStatusBar();
            this.saveSettings();
            new Notice(`Daily Quest Completed: ${this.settings.dailyQuest.name}! +${this.settings.xpGainRates.dailyQuestCompletion}XP`);
        }
    }


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
        if (this.isInitializing) return;

        new Notice(`🏆 ACHIEVEMENT UNLOCKED! 🏆\n${title}: ${description}`, 7000);

        this.settings.currentXP += 25;

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
                        <li>Daily Quest Progress: ${this.settings.dailyQuest ? `${this.settings.dailyQuest.name}: ${this.settings.dailyQuestProgress}/${this.settings.dailyQuest.target} ${this.settings.dailyQuestCompleted ? '✅ Completed!' : ''}` : 'No daily quest today'}</li>
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

        // Create a proper modal instead of a leaf
        const statsModal = new class extends Modal {
            constructor(app: App) {
                super(app);
            }
            
            onOpen() {
                const {contentEl} = this;
                contentEl.innerHTML = statsHtml;
            }
            
            onClose() {
                const {contentEl} = this;
                contentEl.empty();
            }
        }(this.app);

        statsModal.open();
    }

    getAchievementInfo(key: string): AchievementInfo {
        const achievements: AchievementsDict = {
            "first_note": { title: "First Note Created", description: "You've begun your knowledge journey!" },
            "reach_level_5": { title: "Knowledge Apprentice", description: "Reached level 5" },
            "create_10_notes": { title: "Prolific Scholar", description: "Created 10 notes" },
            "create_50_links": { title: "Master Connector", description: "Created 50 links between your notes" },
            "7_day_streak": { title: "Dedication", description: "Used Obsidian for 7 days in a row" }
        };
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
                    this.plugin.settings.editDebounceTime = value * 1000;
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

        new Setting(containerEl)
            .setName('XP for completing daily quest')
            .setDesc('How much XP to award for completing the daily quest')
            .addSlider(slider => slider
                .setLimits(10, 200, 10)
                .setValue(this.plugin.settings.xpGainRates.dailyQuestCompletion)
                .onChange(async (value) => {
                    this.plugin.settings.xpGainRates.dailyQuestCompletion = value;
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
                .setValue(this.plugin.settings.currentXP.toString())
                .setDisabled(true));

        new Setting(containerEl)
            .setName('XP to Next Level')
            .setDesc('XP required to level up')
            .addText(text => text
                .setValue(this.plugin.settings.xpToNextLevel.toString())
                .setDisabled(true));

        new Setting(containerEl)
            .setName('Daily Streak')
            .setDesc('Consecutive days you have used Obsidian')
            .addText(text => text
                .setValue(this.plugin.settings.streakDays.toString())
                .setDisabled(true));

        new Setting(containerEl)
            .setName('Daily Quest')
            .setDesc('Your current daily quest')
            .addText(text => text
                .setValue(this.plugin.settings.dailyQuest 
                    ? `${this.plugin.settings.dailyQuest.name}: ${this.plugin.settings.dailyQuestProgress}/${this.plugin.settings.dailyQuest.target}`
                    : 'No active quest')
                .setDisabled(true));

        containerEl.createEl('h3', { text: 'Reset Progress' });

        new Setting(containerEl)
            .setName('Reset Level and XP')
            .setDesc('Warning: This will reset your level and XP to default values')
            .addButton(button => button
                .setButtonText('Reset Progress')
                .setCta()
                .onClick(async () => {
                    if (confirm('Are you sure you want to reset your progress? This cannot be undone.')) {
                        this.plugin.settings.level = 1;
                        this.plugin.settings.currentXP = 0;
                        this.plugin.settings.xpToNextLevel = 100;
                        await this.plugin.saveSettings();
                        this.plugin.updateStatusBar();
                        new Notice('Progress has been reset');
                        this.display();
                    }
                }));

        new Setting(containerEl)
            .setName('Reset Achievements')
            .setDesc('Warning: This will reset all of your earned achievements')
            .addButton(button => button
                .setButtonText('Reset Achievements')
                .setCta()
                .onClick(async () => {
                    if (confirm('Are you sure you want to reset your achievements? This cannot be undone.')) {
                        this.plugin.settings.achievements = Object.fromEntries(
                            Object.keys(this.plugin.settings.achievements).map(key => [key, false])
                        );
                        await this.plugin.saveSettings();
                        new Notice('Achievements have been reset');
                        this.display();
                    }
                }));
                
        new Setting(containerEl)
            .setName('Reset Daily Streak')
            .setDesc('Warning: This will reset your daily streak count')
            .addButton(button => button
                .setButtonText('Reset Streak')
                .setCta()
                .onClick(async () => {
                    if (confirm('Are you sure you want to reset your daily streak? This cannot be undone.')) {
                        this.plugin.settings.streakDays = 0;
                        this.plugin.settings.dailyXpAwarded = false;
                        await this.plugin.saveSettings();
                        new Notice('Daily streak has been reset');
                        this.display();
                    }
                }));
    }
}