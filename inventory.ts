
// inventory.ts

import { Plugin, Notice, PluginSettingTab, Setting, Modal, MarkdownView, TFile, TFolder, CachedMetadata, MarkdownRenderer } from 'obsidian';

interface InventoryItem {
    name: string;
    file: string;
    quantity: number;
    price: number;
    description: string;
    isConsumable: boolean;
    currentUses: number;
    maxUses: number;
}

interface Shop {
    name: string;
    folderPath: string;
    description: string;
}

interface RandomPool {
    name: string;
    chance: number;
    maxItems: number;
    items: string[];
}

interface CustomShop {
    name: string;
    description: string;
    shopNote: string;
    fixedItems: string[];
    randomPools: RandomPool[];
    randomChance: number;
    maxRandomItems: number;
}

interface CustomTreasure {
    name: string;
    description: string;
    fixedItems: string[];
    randomPools: RandomPool[];
    randomChance: number;
    maxRandomItems: number;
    minRandomItems: number;
    minItems: number;
    maxItems: number;
    chancePercent: number;
}

interface ShopItem {
    name: string;
    file: TFile;
    price: number;
    description: string;
    stock: number;
    isConsumable: boolean;
    currentUses: number;
    maxUses: number;
    isRare?: boolean;
}

interface AllItemsEntry {
    name: string;
    path: string;
}

interface RPGInventorySettings {
    coins: number;
    inventory: InventoryItem[];
    customTreasures: CustomTreasure[];
    customShops: CustomShop[];
    itemFolderPaths: string[];
    shops: Shop[];
    shopStock: Record<string, number>;
    lastRestockDate: number;
    restockDays: number;
    priceVariation: number;
    itemCurrentPrice: Record<string, number>;
    itemFolderPath: string;
    itemBasePrice?: Record<string, number>;
}

const DEFAULT_SETTINGS: RPGInventorySettings = {
    coins: 1000,
    inventory: [],
    customTreasures: [],
    customShops: [
        {
            name: '',
            description: '',
            shopNote: '',
            fixedItems: [],
            randomPools: [],
            randomChance: 0.3,
            maxRandomItems: 3
        }
    ],
    itemFolderPaths: ['Items/', 'Weapons/', 'Armor/'],
    shops: [
        {
            name: "General Store",
            folderPath: "Items/",
            description: "Basic supplies and miscellaneous goods"
        },
        {
            name: "Blacksmith",
            folderPath: "Weapons/",
            description: "Quality weapons and armor"
        },
        {
            name: "Alchemist",
            folderPath: "Potions/",
            description: "Magical potions and herbs"
        }
    ],
    shopStock: {},
    lastRestockDate: Date.now(),
    restockDays: 3,
    priceVariation: 0.3,
    itemCurrentPrice: {},
    itemFolderPath: 'Items/'
};

export default class RPGInventoryPlugin extends Plugin {
    settings: RPGInventorySettings;

    async onload(): Promise<void> {
        console.log('Loading RPG Inventory plugin');

        // Load settings
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        if (this.settings.itemFolderPath) {
            const set = new Set(this.settings.itemFolderPaths || []);
            const p = this.settings.itemFolderPath.endsWith('/')
                ? this.settings.itemFolderPath
                : this.settings.itemFolderPath + '/';
            set.add(p);
            this.settings.itemFolderPaths = Array.from(set);
            await this.saveSettings();
        }
    
        // Check for auto-restock
        await this.checkAndAutoRestock();

        // Register plugin settings tab
        this.addSettingTab(new RPGInventorySettingTab(this.app, this));

        // Register commands
        this.addCommand({
            id: 'open-inventory',
            name: 'Open Inventory',
            callback: () => {
                new InventoryModal(this.app, this).open();
            }
        });

        this.addCommand({
            id: 'open-shop',
            name: 'Open Shop',
            callback: () => {
                new ShopSelectionModal(this.app, this).open();
            }
        });

        // Add ribbon icon to open shop selection
        this.addRibbonIcon('backpack', 'RPG System', () => {
            new InventoryModal(this.app, this).open();
        });

        // Register view for inventory
        this.registerView(
            'rpg-inventory-view',
            (leaf) => new RPGInventoryView(leaf, this)
        );

        // Register markdown codeblock processor
        this.registerMarkdownCodeBlockProcessor('rpg-inventory', (source, el, ctx) => {
            el.createEl('h2', { text: 'RPG Inventory' });
            
            const coinDisplay = el.createEl('div', { cls: 'rpg-inventory-coins' });
            coinDisplay.createEl('span', { text: `Coins: ${this.settings.coins}` });
            
            const inventoryList = el.createEl('div', { cls: 'rpg-inventory-list' });
            if (this.settings.inventory.length === 0) {
                inventoryList.createEl('p', { text: 'Your inventory is empty.' });
            } else {
                const table = inventoryList.createEl('table');
                const headerRow = table.createEl('tr');
                headerRow.createEl('th', { text: 'Item' });
                headerRow.createEl('th', { text: 'Quantity' });
                
                this.settings.inventory.forEach(item => {
                    const row = table.createEl('tr');
                    row.createEl('td', { text: item.name });
                    row.createEl('td', { text: item.quantity.toString() });
                });
            }
            
            // Add shop button
            const shopButton = el.createEl('button', { text: 'Open Shop' });
            shopButton.addEventListener('click', () => {
                new ShopModal(this.app, this).open();
            });
        });

        //rpg treasury loot
        this.registerMarkdownCodeBlockProcessor('rpg-loot', (source, el, ctx) => {
            // Parse the source to get options
            const lines = source.trim().split('\n');
            let lootPath = '';
            let buttonText = 'Find Loot!';
            let minItems = 1;
            let maxItems = 3;
            let chancePercent = 70; // 70% chance to find items by default
        
            // Parse options from the codeblock
            lines.forEach(line => {
                if (line.startsWith('path:')) {
                    lootPath = line.substring(5).trim();
                } else if (line.startsWith('text:')) {
                    buttonText = line.substring(5).trim();
                } else if (line.startsWith('min:')) {
                    minItems = parseInt(line.substring(4).trim()) || 1;
                } else if (line.startsWith('max:')) {
                    maxItems = parseInt(line.substring(4).trim()) || 3;
                } else if (line.startsWith('chance:')) {
                    chancePercent = parseInt(line.substring(7).trim()) || 70;
                }
            });
        
            // Create a title for the loot section
            el.createEl('h3', { text: 'Loot Opportunity' });
        
            // Create the loot button
            const lootButton = el.createEl('button', { 
                text: buttonText,
                cls: 'rpg-loot-button mod-cta'
            });
        
            // Add event listener to the loot button
            lootButton.addEventListener('click', async () => {
                // Check if this is a custom treasure
                const customTreasure = this.settings.customTreasures?.find(t => t.name === lootPath);
                
                if (customTreasure) {
                    // Use custom treasure logic
                    await this.processCustomTreasure(customTreasure);
                } else {
                    // Use original folder-based logic
                    await this.processRegularLoot(lootPath, minItems, maxItems, chancePercent);
                }
            });
        
            // Add a small description
            const customTreasure = this.settings.customTreasures?.find(t => t.name === lootPath);
            if (customTreasure) {
                el.createEl('p', { 
                    text: `Custom treasure: ${customTreasure.description}`,
                    cls: 'rpg-loot-description'
                });
            } else {
                el.createEl('p', { 
                    text: `Chance to find ${minItems}-${maxItems} random items from ${lootPath || 'any item folder'}.`,
                    cls: 'rpg-loot-description'
                });
            }
        });
    }

    onunload(): void {
        console.log('Unloading RPG Inventory plugin');
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    getItemFolders(): string[] {
        const set = new Set(this.settings.itemFolderPaths || []);
        const p = (this.settings.itemFolderPath || '').trim();
        if (p) set.add(p.endsWith('/') ? p : p + '/');
        return Array.from(set);
    }

    async checkAndAutoRestock(): Promise<void> {
        const currentTime = Date.now();
        const daysSinceRestock = Math.floor((currentTime - this.settings.lastRestockDate) / (1000 * 60 * 60 * 24));
        
        if (daysSinceRestock >= this.settings.restockDays) {
            await this.restockShops();
            new Notice(`Shops automatically restocked after ${daysSinceRestock} days!`);
        }
    }

    async restockShops(): Promise<void> {
        // Get all item files from regular shops
        const itemFiles = this.app.vault.getMarkdownFiles().filter(file => {
            // Check if file is in any shop folder
            return this.settings.shops.some(shop => 
                file.path.startsWith(shop.folderPath));
        });
        
        // NOVO: Get all item files from custom shops
        const customShopFiles = new Set<string>();
        if (this.settings.customShops && Array.isArray(this.settings.customShops)) {
            this.settings.customShops.forEach(customShop => {
                // Add fixed items
                if (Array.isArray(customShop.fixedItems)) {
                    customShop.fixedItems.forEach(itemPath => {
                        customShopFiles.add(itemPath);
                    });
                }
                
                // Add items from random pools
                if (Array.isArray(customShop.randomPools)) {
                    customShop.randomPools.forEach(pool => {
                        if (Array.isArray(pool.items)) {
                            pool.items.forEach(itemPath => {
                                customShopFiles.add(itemPath);
                            });
                        }
                    });
                }
            });
        }
        
        // Combine regular shop files with custom shop files
        const allShopFiles = [...itemFiles];
        customShopFiles.forEach(filePath => {
            const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
            if (file && !allShopFiles.some(f => f.path === file.path)) {
                allShopFiles.push(file);
            }
        });
        
        // For each item, get its base price from metadata or content
        for (const file of allShopFiles) {
            // Restock quantity (1-10)
            this.settings.shopStock[file.path] = Math.floor(Math.random() * 10) + 1;
            
            // Apply price variation if item exists in inventory or has a known base price
            if (this.settings.itemBasePrice === undefined) {
                this.settings.itemBasePrice = {};
            }
            
            // Try to get existing base price or determine from file
            if (!this.settings.itemBasePrice[file.path]) {
                // Get the base price from metadata if possible
                try {
                    const metadata = this.app.metadataCache.getFileCache(file);
                    const content = await this.app.vault.read(file);
                    
                    // Check for price in frontmatter
                    let basePrice = metadata?.frontmatter?.price;
                    
                    // If not in frontmatter, check for inline price tag
                    if (!basePrice) {
                        const priceMatch = content.match(/\((\d+)\s+#price\)/);
                        if (priceMatch) {
                            basePrice = parseInt(priceMatch[1]);
                        }
                    }
                    
                    // If still no price, generate a random base price
                    if (!basePrice) {
                        basePrice = Math.floor(Math.random() * 90) + 10;
                    }
                    
                    this.settings.itemBasePrice[file.path] = basePrice;
                } catch (error) {
                    console.error("Error getting base price:", error);
                    this.settings.itemBasePrice[file.path] = Math.floor(Math.random() * 90) + 10;
                }
            }
        
            // Now apply price variation
            const basePrice = this.settings.itemBasePrice[file.path];
            const variation = this.settings.priceVariation; // 0.3 = 30%
            
            // Random variation between -30% to +30%
            const variationFactor = 1 + (Math.random() * variation * 2 - variation);
            
            // Store the current price
            if (this.settings.itemCurrentPrice === undefined) {
                this.settings.itemCurrentPrice = {};
            }
            
            // Calculate new price and round to integer
            this.settings.itemCurrentPrice[file.path] = Math.round(basePrice * variationFactor);
        }
        
        // Update last restock date
        this.settings.lastRestockDate = Date.now();
        
        await this.saveSettings();
    }

        async processCustomTreasure(customTreasure: CustomTreasure): Promise<void> {
        // First, check if there's a chance of finding nothing
        const rollChance = Math.random() * 100;
        if (rollChance > customTreasure.chancePercent) {
            new Notice("You found nothing this time!");
            return;
        }

        const foundItems: InventoryItem[] = [];
        
        // Add fixed items first
        for (const itemPath of customTreasure.fixedItems) {
            const item = await this.createItemFromPath(itemPath, "Fixed treasure item");
            if (item) foundItems.push(item);
        }
        
        // Process random pools
        for (const pool of customTreasure.randomPools) {
            if (Math.random() <= pool.chance && pool.items.length > 0) {
                const shuffled = [...pool.items].sort(() => Math.random() - 0.5);
                const numItemsFromPool = Math.min(pool.maxItems, shuffled.length);
                
                for (let i = 0; i < numItemsFromPool; i++) {
                    const item = await this.createItemFromPath(shuffled[i], "Rare treasure find");
                    if (item) foundItems.push(item);
                }
            }
        }
        
        // Add random items if specified
        if (customTreasure.maxRandomItems > 0) {
            const allPossibleItems = [
                ...customTreasure.fixedItems,
                ...customTreasure.randomPools.flatMap(pool => pool.items)
            ];
            
            if (allPossibleItems.length > 0) {
                // ✅ CORREÇÃO: Usar minRandomItems em vez de minRandomItems
                const minRandom = customTreasure.minRandomItems || 0;
                const maxRandom = customTreasure.maxRandomItems || 3;
                const numRandomItems = Math.floor(Math.random() * (maxRandom - minRandom + 1)) + minRandom;
                
                for (let i = 0; i < numRandomItems; i++) {
                    if (Math.random() <= customTreasure.randomChance) {
                        const randomPath = allPossibleItems[Math.floor(Math.random() * allPossibleItems.length)];
                        const item = await this.createItemFromPath(randomPath, "Random treasure");
                        if (item) foundItems.push(item);
                    }
                }
            }
        }
        
        // Add items to inventory and show result
        await this.addItemsToInventory(foundItems);
    }

    async processRegularLoot(lootPath: string, minItems: number, maxItems: number, chancePercent: number): Promise<void> {
        // First, check if there's a chance of finding nothing
        const rollChance = Math.random() * 100;
        if (rollChance > chancePercent) {
            new Notice("You found nothing this time!");
            return;
        }

        // Get all potential loot items from the specified folder
        const lootFiles = this.app.vault.getMarkdownFiles().filter(file => {
            // If no specific path is given, use any folder with items
            if (!lootPath) {
                return this.getItemFolders().some(path =>
                    file.path.startsWith(path));
                }
            // Otherwise use the specified path
            return file.path.startsWith(lootPath);
        });

        if (lootFiles.length === 0) {
            new Notice(`No loot items found in ${lootPath || 'any item folders'}!`);
            return;
        }

        // Determine how many items to give
        const numItems = Math.floor(Math.random() * (maxItems - minItems + 1)) + minItems;
        
        // Select random items (may include duplicates)
        const foundItems: InventoryItem[] = [];
        for (let i = 0; i < numItems; i++) {
            const randomIndex = Math.floor(Math.random() * lootFiles.length);
            const lootFile = lootFiles[randomIndex];
            const item = await this.createItemFromPath(lootFile.path, "Looted item");
            if (item) foundItems.push(item);
        }
        
        await this.addItemsToInventory(foundItems);
    }

    async createItemFromPath(itemPath: string, defaultDescription: string): Promise<InventoryItem | null> {
        try {
            const lootFile = this.app.vault.getAbstractFileByPath(itemPath) as TFile;
            if (!lootFile) return null;

            // Get file metadata for item properties
            const metadata = this.app.metadataCache.getFileCache(lootFile);
            const content = await this.app.vault.read(lootFile);
            
            // Try to parse properties from file
            const priceMatch = content.match(/\((\d+)\s+#price\)/);
            const descMatch = content.match(/\(([^)]+)\s+#description\)/);
            const consumableMatch = content.match(/(\d+)\/(\d+)\s+#consumable/);
            const isConsumable = content.includes("#consumable");
            
            // Create the item object
            return {
                name: lootFile.basename,
                file: lootFile.path,
                quantity: 1,
                price: (metadata?.frontmatter?.price) || 
                       (priceMatch ? parseInt(priceMatch[1]) : Math.floor(Math.random() * 50) + 5),
                description: (metadata?.frontmatter?.description) || 
                            (descMatch ? descMatch[1] : defaultDescription),
                isConsumable: isConsumable,
                currentUses: consumableMatch ? parseInt(consumableMatch[1]) : 1,
                maxUses: consumableMatch ? parseInt(consumableMatch[2]) : 1
            };
        } catch (error) {
            console.error("Error parsing item:", error);
            return null;
        }
    }

    async addItemsToInventory(foundItems: InventoryItem[]): Promise<void> {
        if (foundItems.length > 0) {
            foundItems.forEach(newItem => {
                // Check if item already exists in inventory
                const existingItem = this.settings.inventory.find(i => i.name === newItem.name);
                if (existingItem) {
                    existingItem.quantity += 1;
                } else {
                    this.settings.inventory.push(newItem);
                }
            });
            
            // Save settings
            await this.saveSettings();
            
            // Create notification message
            const itemNames = foundItems.map(item => item.name).join(", ");
            new Notice(`You found: ${itemNames}!`);
        } else {
            new Notice("You found nothing valuable.");
        }
    }    
}

class RPGInventoryView extends MarkdownView {
    plugin: RPGInventoryPlugin;

    constructor(leaf: any, plugin: RPGInventoryPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return 'rpg-inventory-view';
    }

    getDisplayText(): string {
        return 'RPG Inventory';
    }

    async onOpen(): Promise<void> {
        // View initialization code
    }
}

class InventoryModal extends Modal {
    plugin: RPGInventoryPlugin;

    constructor(app: any, plugin: RPGInventoryPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: 'Your Inventory' });
        
        // Display coins
        const coinDisplay = contentEl.createEl('div', { cls: 'inventory-coins' });
        coinDisplay.createEl('h3', { text: `Coins: ${this.plugin.settings.coins}` });
        
        // Display inventory
        const inventoryContainer = contentEl.createEl('div', { cls: 'inventory-container' });
        
        if (this.plugin.settings.inventory.length === 0) {
            inventoryContainer.createEl('p', { text: 'Your inventory is empty.' });
        } else {
            const table = inventoryContainer.createEl('table');
            const headerRow = table.createEl('tr');
            headerRow.createEl('th', { text: 'Item' });
            headerRow.createEl('th', { text: 'Quantity' });
            headerRow.createEl('th', { text: 'Action' });
            
            this.plugin.settings.inventory.forEach(item => {
                const row = table.createEl('tr');
                
                // For consumable items, show remaining uses
                const nameCell = row.createEl('td');
                if (item.isConsumable) {
                    const itemLink = nameCell.createEl('a', { 
                        text: `${item.name} (${item.currentUses}/${item.maxUses} uses)` 
                    });
                    itemLink.addEventListener('click', (event) => {
                        event.preventDefault();
                        const file = this.app.vault.getAbstractFileByPath(item.file) as TFile;
                        if (file) this.app.workspace.getLeaf().openFile(file);
                    });
                } else {
                    const itemLink = nameCell.createEl('a', { text: item.name });
                    itemLink.addEventListener('click', (event) => {
                        event.preventDefault();
                        const file = this.app.vault.getAbstractFileByPath(item.file) as TFile;
                        if (file) this.app.workspace.getLeaf().openFile(file);
                    });
                }
                
                row.createEl('td', { text: item.quantity.toString() });
                
                const actionCell = row.createEl('td');
                const useButton = actionCell.createEl('button', { text: 'Use' });
                useButton.addEventListener('click', async () => {
                    if (item.isConsumable) {
                        // Decrease uses for consumable items
                        item.currentUses -= 1;
                        
                        // If no uses left, remove one from quantity or remove item
                        if (item.currentUses <= 0) {
                            if (item.quantity > 1) {
                                item.quantity -= 1;
                                // Reset uses for the next item
                                item.currentUses = item.maxUses;
                            } else {
                                // Remove item from inventory if last one
                                const index = this.plugin.settings.inventory.indexOf(item);
                                this.plugin.settings.inventory.splice(index, 1);
                            }
                            new Notice(`Used last charge of ${item.name}!`);
                        } else {
                            new Notice(`Used ${item.name}! ${item.currentUses}/${item.maxUses} uses remaining.`);
                        }
                        
                        await this.plugin.saveSettings();
                        this.onOpen(); // Refresh the modal
                    } else {
                        new Notice(`Used ${item.name}!`);
                    }
                });
                
                const sellButton = actionCell.createEl('button', { text: 'Sell' });
                sellButton.addEventListener('click', async () => {
                    // Calculate sell price (half of buy price or 25 coins minimum)
                    const sellPrice = Math.max(Math.floor((item.price || 50) / 2), 25);
                    
                    // Update inventory
                    if (item.quantity > 1) {
                        item.quantity -= 1;
                    } else {
                        const index = this.plugin.settings.inventory.indexOf(item);
                        this.plugin.settings.inventory.splice(index, 1);
                    }
                    
                    // Add coins
                    this.plugin.settings.coins += sellPrice;
                    await this.plugin.saveSettings();
                    
                    new Notice(`Sold ${item.name} for ${sellPrice} coins!`);
                    this.onOpen(); // Refresh the modal
                });
            });
        }
        
        // Add shop button
        const shopButton = contentEl.createEl('button', { text: 'Open Shop', cls: 'mod-cta' });
        shopButton.addEventListener('click', () => {
            this.close();
            new ShopModal(this.app, this.plugin).open();
        });
        
        // Add adventure button
        const adventureButton = contentEl.createEl('button', { text: 'Find Treasure! 🎲' });
        adventureButton.addEventListener('click', async () => {
            const treasureValue = Math.floor(Math.random() * 100) + 1;
            
            if (treasureValue > 30) {
                this.plugin.settings.coins += treasureValue;
                await this.plugin.saveSettings();
                new Notice(`You found ${treasureValue} coins!`);
                this.onOpen(); // Refresh the modal
            } else {
                new Notice("You found nothing this time. Try again!");
            }
        });

        // Add return to shop selection button
        const returnButton = contentEl.createEl('button', { text: 'Return to Shop Selection' });
        returnButton.addEventListener('click', () => {
            this.close();
            new ShopSelectionModal(this.app, this.plugin).open();
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class ShopModal extends Modal {
    plugin: RPGInventoryPlugin;
    shop?: Shop;

    constructor(app: any, plugin: RPGInventoryPlugin, shop?: Shop) {
        super(app);
        this.plugin = plugin;
        this.shop = shop;
    }
    
    async parseItemContent(content: string): Promise<{ price: number | null; description: string | null }> {
        const priceMatch = content.match(/\((\d+)\s+#price\)/);
        const descMatch = content.match(/\(([^)]+)\s+#description\)/);
        
        return {
            price: priceMatch ? parseInt(priceMatch[1]) : null,
            description: descMatch ? descMatch[1] : null
        };
    }

    async parseItemTags(content: string): Promise<{ isConsumable: boolean; currentUses: number; maxUses: number }> {
        // Check for consumable tag with usage count (e.g., "3/3 #consumable")
        const consumableMatch = content.match(/(\d+)\/(\d+)\s+#consumable/);
        const isConsumable = content.includes("#consumable");
        
        return {
            isConsumable: isConsumable,
            currentUses: consumableMatch ? parseInt(consumableMatch[1]) : 1,
            maxUses: consumableMatch ? parseInt(consumableMatch[2]) : 1
        };
    }

    async onOpen(): Promise<void> {
        if (!this.shop) return;

        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: this.shop.name });
        contentEl.createEl('p', { text: this.shop.description, cls: 'shop-description' });
        
        // Display coins
        const coinDisplay = contentEl.createEl('div', { cls: 'shop-coins' });
        coinDisplay.createEl('h3', { text: `Your Coins: ${this.plugin.settings.coins}` });
        
        // Get items specific to this shop's folder path
        const itemNotes: ShopItem[] = [];
        const shopFolderPath = this.shop.folderPath;
        
        // Get files with #item tag that are in this shop's category
        const itemFiles = this.app.vault.getMarkdownFiles().filter((file: TFile) => {
            // Check if file has relevant tags and its path matches the shop folder
            const cache = this.app.metadataCache.getFileCache(file);
            const hasItemTag = cache && cache.tags && cache.tags.some((tag: any) => tag.tag === '#item');
            return hasItemTag && file.path.startsWith(shopFolderPath);
        });
        
        // Add files from the shop's folder
        const shopFolder = this.app.vault.getAbstractFileByPath(shopFolderPath);
        if (shopFolder && (shopFolder as TFolder).children) {
            (shopFolder as TFolder).children.forEach((file: any) => {
                if (file.extension === 'md' && !itemFiles.some((f: TFile) => f.path === file.path)) {
                    itemFiles.push(file);
                }
            });
        }
        
        // Initialize stock for new items if needed
        itemFiles.forEach((file: TFile) => {
            if (this.plugin.settings.shopStock[file.path] === undefined) {
                // Random stock between 1-10 for new items
                this.plugin.settings.shopStock[file.path] = Math.floor(Math.random() * 10) + 1;
            }
        });
        
        // Get file metadata and create shop items
        for (const file of itemFiles) {
            const metadata = this.app.metadataCache.getFileCache(file);
            const content = await this.app.vault.read(file);
            
            // Extract price and description from content
            const parsedContent = await this.parseItemContent(content);
            const parsedTags = await this.parseItemTags(content);
    
            const item: ShopItem = {
                name: file.basename,
                file: file,
                // Check frontmatter first, then parsed content, then random price
                price: this.plugin.settings.itemCurrentPrice?.[file.path] ||
                (metadata && metadata.frontmatter && metadata.frontmatter.price) || 
                parsedContent?.price ||
                Math.floor(Math.random() * 90) + 10,
                description: (metadata && metadata.frontmatter && metadata.frontmatter.description) || 
                 parsedContent?.description ||
                 "No description available.",
                stock: this.plugin.settings.shopStock[file.path] || 0,
                isConsumable: parsedTags.isConsumable,
                currentUses: parsedTags.currentUses,
                maxUses: parsedTags.maxUses
            };
            
            itemNotes.push(item);
        }
        
        // Display shop items
        const shopContainer = contentEl.createEl('div', { cls: 'shop-container' });
        
        if (itemNotes.length === 0) {
            shopContainer.createEl('p', { text: `No items available in ${this.shop.name}.` });
        } else {
            const table = shopContainer.createEl('table');
            const headerRow = table.createEl('tr');
            headerRow.createEl('th', { text: 'Item' });
            headerRow.createEl('th', { text: 'Price' });
            headerRow.createEl('th', { text: 'Stock' });
            headerRow.createEl('th', { text: 'Description' });
            headerRow.createEl('th', { text: 'Action' });
            
            itemNotes.forEach(item => {
                const row = table.createEl('tr');
                
                const nameCell = row.createEl('td');
                const itemLink = nameCell.createEl('a', { text: item.name });
                itemLink.addEventListener('click', (event) => {
                    event.preventDefault();
                    this.app.workspace.getLeaf().openFile(item.file);
                });
                
                row.createEl('td', { text: item.price.toString() });
                row.createEl('td', { text: item.stock.toString() });
                row.createEl('td', { text: item.description });
                
                const actionCell = row.createEl('td');
                const buyButton = actionCell.createEl('button', { text: 'Buy' });
                
                // Disable buy button if out of stock
                if (item.stock <= 0) {
                    buyButton.disabled = true;
                    buyButton.addClass('button-disabled');
                }
                
                buyButton.addEventListener('click', async () => {
                    // Check if player has enough coins
                    if (this.plugin.settings.coins < item.price) {
                        new Notice("Not enough coins!");
                        return;
                    }
                    
                    // Check if item is in stock
                    if (this.plugin.settings.shopStock[item.file.path] <= 0) {
                        new Notice("Item out of stock!");
                        return;
                    }
                    
                    // Add item to inventory
                    const existingItem = this.plugin.settings.inventory.find(i => i.name === item.name);
                    if (existingItem) {
                        existingItem.quantity += 1;
                    } else {
                        this.plugin.settings.inventory.push({
                            name: item.name,
                            file: item.file.path,
                            quantity: 1,
                            price: item.price,
                            description: item.description,
                            isConsumable: item.isConsumable,
                            currentUses: item.currentUses,
                            maxUses: item.maxUses
                        });
                    }
                    
                    // Deduct coins
                    this.plugin.settings.coins -= item.price;
                    
                    // Reduce stock
                    this.plugin.settings.shopStock[item.file.path] -= 1;
                    
                    await this.plugin.saveSettings();
                    
                    new Notice(`Purchased ${item.name}!`);
                    this.onOpen(); // Refresh the modal
                });
            });
        }
        
        // Navigation buttons
        const buttonContainer = contentEl.createEl('div', { cls: 'shop-buttons' });
        
        // Back to shop selection
        const backButton = buttonContainer.createEl('button', { text: 'Back to Shops' });
        backButton.addEventListener('click', () => {
            this.close();
            new ShopSelectionModal(this.app, this.plugin).open();
        });
        
        // Open inventory
        const inventoryButton = buttonContainer.createEl('button', { text: 'Open Inventory', cls: 'mod-cta' });
        inventoryButton.addEventListener('click', () => {
            this.close();
            new InventoryModal(this.app, this.plugin).open();
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class RPGInventorySettingTab extends PluginSettingTab {
    name = 'RPG Inventory Settings';
    plugin: RPGInventoryPlugin;

    constructor(app: any, plugin: RPGInventoryPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'RPG Inventory Settings' });
        containerEl.createEl('h3', { text: 'Item Folders' });

        // Shop management section
        containerEl.createEl('h3', { text: 'Custom Shop Management' });
        
        // Display current folders with delete buttons
        const folderList = containerEl.createEl('div', { cls: 'rpg-inventory-folder-list' });
        
        this.plugin.settings.itemFolderPaths.forEach((path, index) => {
            const folderDiv = folderList.createEl('div', { cls: 'rpg-inventory-folder-item' });
            folderDiv.createEl('span', { text: path });
            
            const deleteButton = folderDiv.createEl('button', { text: 'Remove' });
            deleteButton.addEventListener('click', async () => {
                this.plugin.settings.itemFolderPaths.splice(index, 1);
                await this.plugin.saveSettings();
                this.display(); // Refresh settings panel
            });
        });
        
        // Add new folder option
        const newFolderDiv = containerEl.createEl('div', { cls: 'rpg-inventory-new-folder' });
        
        const newFolderInput = newFolderDiv.createEl('input', {
            type: 'text',
            placeholder: 'New folder path (e.g., Potions/)'
        }) as HTMLInputElement;
        
        const addButton = newFolderDiv.createEl('button', { text: 'Add Folder' });
        addButton.addEventListener('click', async () => {
            const newPath = newFolderInput.value.trim();
            if (newPath) {
                this.plugin.settings.itemFolderPaths.push(newPath);
                await this.plugin.saveSettings();
                newFolderInput.value = '';
                this.display(); // Refresh settings panel
            }
        });

        new Setting(containerEl)
            .setName('Items Folder Path')
            .setDesc('Folder path where your item notes are stored (e.g., "Items/" or "RPG/Items/")')
            .addText(text => text
                .setPlaceholder('Items/')
                .setValue(this.plugin.settings.itemFolderPath)
                .onChange(async (value) => {
                    const v = value.trim();
                    this.plugin.settings.itemFolderPath = v;

                    if (!Array.isArray(this.plugin.settings.itemFolderPaths)) {
                        this.plugin.settings.itemFolderPaths = [];
                    }
                    const normalized = v && !v.endsWith('/') ? v + '/' : v;
                    if (normalized) {
                        const set = new Set(this.plugin.settings.itemFolderPaths);
                        set.add(normalized);
                        this.plugin.settings.itemFolderPaths = Array.from(set);
                    }
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Normal Shop Management' });
    
        // List existing shops
        const shopList = containerEl.createEl('div', { cls: 'rpg-inventory-shop-list' });

        this.plugin.settings.shops.forEach((shop, index) => {
            const shopDiv = shopList.createEl('div', { cls: 'rpg-inventory-shop-item' });
            
            const shopInfo = shopDiv.createEl('div', { cls: 'rpg-inventory-shop-info' });
            shopInfo.createEl('span', { text: shop.name, cls: 'shop-name' });
            shopInfo.createEl('span', { text: shop.folderPath, cls: 'shop-path' });
            
            const deleteButton = shopDiv.createEl('button', { text: 'Remove' });
            deleteButton.addEventListener('click', async () => {
                this.plugin.settings.shops.splice(index, 1);
                await this.plugin.saveSettings();
                this.display(); // Refresh settings panel
            });
        });

        // Add new shop
        const newShopDiv = containerEl.createEl('div', { cls: 'rpg-inventory-new-shop' });

        const nameInput = newShopDiv.createEl('input', {
            type: 'text',
            placeholder: 'Shop Name'
        }) as HTMLInputElement;
        
        const pathInput = newShopDiv.createEl('input', {
            type: 'text',
            placeholder: 'Folder Path (e.g., Gems/)'
        }) as HTMLInputElement;
        
        const descInput = newShopDiv.createEl('input', {
            type: 'text',
            placeholder: 'Shop Description'
        }) as HTMLInputElement;
        
        const addShopButton = newShopDiv.createEl('button', { text: 'Add Shop' });
        addShopButton.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const path = pathInput.value.trim();
            const desc = descInput.value.trim();
            
            if (name && path) {
                this.plugin.settings.shops.push({
                    name: name,
                    folderPath: path,
                    description: desc || `Shop for ${name} items`
                });
                
                await this.plugin.saveSettings();
                nameInput.value = '';
                pathInput.value = '';
                descInput.value = '';
                this.display(); // Refresh settings panel
            }
        });

        
        new Setting(containerEl)
            .setName('Reset Coins')
            .setDesc('Reset your coin balance')
            .addButton(button => button
                .setButtonText('Reset to 1000 coins')
                .onClick(async () => {
                    this.plugin.settings.coins = 1000;
                    await this.plugin.saveSettings();
                    new Notice('Coins reset to 1000!');
                }));
        
        new Setting(containerEl)
            .setName('Clear Inventory')
            .setDesc('Remove all items from your inventory')
            .addButton(button => button
                .setButtonText('Clear Inventory')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.inventory = [];
                    await this.plugin.saveSettings();
                    new Notice('Inventory cleared!');
                }));
                
        // Stock refresh button
        new Setting(containerEl)
            .setName('Refresh Shop Stock')
            .setDesc('Randomly restock all shop items')
            .addButton(button => button
                .setButtonText('Restock Shops')
                .onClick(async () => {
                    await this.plugin.restockShops();
                    new Notice('Shops have been restocked with price variation!');
                }));

        new Setting(containerEl)
            .setName('Auto-Restock Days')
            .setDesc('Number of days between automatic shop restocks')
            .addSlider(slider => slider
                .setLimits(1, 14, 1)
                .setValue(this.plugin.settings.restockDays)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.restockDays = value;
                    await this.plugin.saveSettings();
                }))
            .addExtraButton(button => button
                .setIcon('reset')
                .setTooltip('Reset to 3 days')
                .onClick(async () => {
                    this.plugin.settings.restockDays = 3;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(containerEl)
            .setName('Price Variation')
            .setDesc('Price variation percentage during restocks (0.3 = ±30%)')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.05)
                .setValue(this.plugin.settings.priceVariation)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.priceVariation = value;
                    await this.plugin.saveSettings();
                }))
            .addExtraButton(button => button
                .setIcon('reset')
                .setTooltip('Reset to 30%')
                .onClick(async () => {
                    this.plugin.settings.priceVariation = 0.3;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // Custom Shop Creation
        containerEl.createEl('h3', { text: 'Custom Shop Creator' });
        const customShopDiv = containerEl.createEl('div', { cls: 'rpg-inventory-custom-shop' });

        const customShopButton = customShopDiv.createEl('button', { 
            text: 'Create Custom Shop', 
            cls: 'mod-cta' 
        });
        customShopButton.addEventListener('click', () => {
            new CustomShopCreatorModal(this.app, this.plugin).open();
        });

        // Display existing custom shops
        if (this.plugin.settings.customShops && this.plugin.settings.customShops.length > 0) {
            const customShopList = containerEl.createEl('div', { cls: 'rpg-inventory-custom-shop-list' });
    
            this.plugin.settings.customShops.forEach((shop, index) => {
                const shopDiv = customShopList.createEl('div', { cls: 'rpg-inventory-shop-item' });
                
                const shopInfo = shopDiv.createEl('div', { cls: 'rpg-inventory-shop-info' });
                shopInfo.createEl('span', { text: shop.name, cls: 'shop-name' });
                const fixedCount = Array.isArray(shop.fixedItems) ? shop.fixedItems.length : 0;
                const poolCount = Array.isArray(shop.randomPools) ? shop.randomPools.length : 0;

                shopInfo.createEl('span', {
                    text: `Fixed Items: ${fixedCount}, Random Pools: ${poolCount}`,
                    cls: 'shop-details'
                });
                
                const deleteButton = shopDiv.createEl('button', { text: 'Remove' });
                deleteButton.addEventListener('click', async () => {
                    this.plugin.settings.customShops.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.display(); // Refresh settings panel
                });

                const editButton = shopDiv.createEl('button', { text: 'Edit' });
                editButton.addEventListener('click', async () => {
                    const editModal = new CustomShopCreatorModal(this.app, this.plugin);
                    editModal.customShop = JSON.parse(JSON.stringify(shop)); // Copy the shop
                    editModal.open();
            
                    // When saving, replace the old one
                    const originalSave = editModal.saveCustomShop;
                    editModal.saveCustomShop = async () => {
                        this.plugin.settings.customShops[index] = editModal.customShop;
                        await this.plugin.saveSettings();
                        this.display(); // Update the list
                        editModal.close();
                    };
                });
            });
        // Custom Treasure Creation
        containerEl.createEl('h3', { text: 'Custom Treasure Creator' });
        const customTreasureDiv = containerEl.createEl('div', { cls: 'rpg-inventory-custom-treasure' });

        const customTreasureButton = customTreasureDiv.createEl('button', { 
            text: 'Create Custom Treasure', 
            cls: 'mod-cta' 
        });
        customTreasureButton.addEventListener('click', () => {
            new CustomTreasureCreatorModal(this.app, this.plugin).open();
        });

        // Display existing custom treasures
        if (this.plugin.settings.customTreasures && this.plugin.settings.customTreasures.length > 0) {
            const customTreasureList = containerEl.createEl('div', { cls: 'rpg-inventory-custom-treasure-list' });
    
            this.plugin.settings.customTreasures.forEach((treasure, index) => {
                const treasureDiv = customTreasureList.createEl('div', { cls: 'rpg-inventory-treasure-item' });
                
                const treasureInfo = treasureDiv.createEl('div', { cls: 'rpg-inventory-treasure-info' });
                treasureInfo.createEl('span', { text: treasure.name, cls: 'treasure-name' });
                const fixedCount = Array.isArray(treasure.fixedItems) ? treasure.fixedItems.length : 0;
                const poolCount = Array.isArray(treasure.randomPools) ? treasure.randomPools.length : 0;

                treasureInfo.createEl('span', {
                    text: `Fixed Items: ${fixedCount}, Random Pools: ${poolCount}, Chance: ${treasure.chancePercent}%`,
                    cls: 'treasure-details'
                });
                
                const deleteButton = treasureDiv.createEl('button', { text: 'Remove' });
                deleteButton.addEventListener('click', async () => {
                    this.plugin.settings.customTreasures.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.display(); // Refresh settings panel
                });

                const editButton = treasureDiv.createEl('button', { text: 'Edit' });
                editButton.addEventListener('click', async () => {
                    const editModal = new CustomTreasureCreatorModal(this.app, this.plugin);
                    editModal.customTreasure = JSON.parse(JSON.stringify(treasure)); // Copy the treasure
                    editModal.open();
            
                    // When saving, replace the old one
                    const originalSave = editModal.saveCustomTreasure;
                    editModal.saveCustomTreasure = async () => {
                        this.plugin.settings.customTreasures[index] = editModal.customTreasure;
                        await this.plugin.saveSettings();
                        this.display(); // Update the list
                        editModal.close();
                    };
                });
            });
        }
        }    
    }
}

class ShopSelectionModal extends Modal {
    plugin: RPGInventoryPlugin;

    constructor(app: any, plugin: RPGInventoryPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: 'Available Shops' });
        
        // Display coins
        const coinDisplay = contentEl.createEl('div', { cls: 'shop-coins' });
        coinDisplay.createEl('h3', { text: `Your Coins: ${this.plugin.settings.coins}` });
        
        // Create shop list
        const shopList = contentEl.createEl('div', { cls: 'shop-selection-list' });
        
        // Regular shops
        this.plugin.settings.shops.forEach(shop => {
            const shopCard = shopList.createEl('div', { cls: 'shop-card' });
            shopCard.createEl('h3', { text: shop.name });
            shopCard.createEl('p', { text: shop.description });
            
            const enterButton = shopCard.createEl('button', { text: 'Enter Shop', cls: 'mod-cta' });
            enterButton.addEventListener('click', () => {
                this.close();
                new ShopModal(this.app, this.plugin, shop).open();
            });
        });
        
        // Custom shops
        if (this.plugin.settings.customShops && this.plugin.settings.customShops.length > 0) {
            contentEl.createEl('h2', { text: 'Custom Shops' });
            const customShopList = contentEl.createEl('div', { cls: 'shop-selection-list' });
            
            this.plugin.settings.customShops.forEach(shop => {
                const shopCard = customShopList.createEl('div', { cls: 'shop-card custom-shop-card' });
                shopCard.createEl('h3', { text: shop.name });
                shopCard.createEl('p', { text: shop.description });
                
                const enterButton = shopCard.createEl('button', { text: 'Enter Shop', cls: 'mod-cta' });
                enterButton.addEventListener('click', () => {
                    this.close();
                    new CustomShopModal(this.app, this.plugin, shop).open();
                });
            });
        }
        
        // Add inventory button
        const inventoryButton = contentEl.createEl('button', { text: 'Open Inventory', cls: 'inventory-button' });
        inventoryButton.addEventListener('click', () => {
            this.close();
            new InventoryModal(this.app, this.plugin).open();
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class CustomShopCreatorModal extends Modal {
    plugin: RPGInventoryPlugin;
    customShop: CustomShop;
    allItems: AllItemsEntry[];
    saveCustomShop: () => Promise<void>;

    constructor(app: any, plugin: RPGInventoryPlugin) {
        super(app);
        this.plugin = plugin;
        this.customShop = {
            name: '',
            description: '',
            shopNote: '',
            fixedItems: [],
            randomPools: [],
            randomChance: 0.3,
            maxRandomItems: 3
        };
        this.allItems = [];
        this.saveCustomShop = this.defaultSaveCustomShop.bind(this);
    }

    async defaultSaveCustomShop(): Promise<void> {
        if (!this.customShop.name) {
            new Notice('Please enter a shop name');
            return;
        }

        if (!Array.isArray(this.plugin.settings.customShops)) {
            this.plugin.settings.customShops = [];
        }

        const existingIndex = this.plugin.settings.customShops.findIndex(shop => shop.name === this.customShop.name);

        if (existingIndex !== -1) {
            this.plugin.settings.customShops[existingIndex] = this.customShop;
        } else {
            this.plugin.settings.customShops.push(this.customShop);
        }

        await this.plugin.saveSettings();
        new Notice(`Custom shop "${this.customShop.name}" saved!`);
        this.close();
    }

    addRandomPool(container: HTMLElement): void {
        const pool: RandomPool = { name: '', chance: 0.3, maxItems: 3, items: [] };
        this.customShop.randomPools.push(pool);
    
        const poolDiv = container.createEl('div', { cls: 'random-pool-block' });
        poolDiv.style.border = "1px solid var(--background-modifier-border)";
        poolDiv.style.padding = "10px";
        poolDiv.style.marginBottom = "10px";
    
        const controlsDiv = poolDiv.createEl('div', { cls: 'pool-controls' });

        // Field for Random Pool Name
        const nameInput = container.createEl('input', { 
            type: 'text', 
            placeholder: 'Pool Name (ex: Rare Items)', 
            cls: 'input-pool-name' 
        }) as HTMLInputElement;
        nameInput.addEventListener('change', () => {
            pool.name = nameInput.value;
        });
    
        const chanceInput = controlsDiv.createEl('input', { 
            type: 'number', 
            value: '30', 
            placeholder: 'Chance %' 
        }) as HTMLInputElement;
        chanceInput.addEventListener('change', () => {
            pool.chance = Math.min(Math.max(parseInt(chanceInput.value) / 100, 0), 1);
        });
    
        const maxInput = controlsDiv.createEl('input', { 
            type: 'number', 
            value: '3', 
            placeholder: 'Max Items' 
        }) as HTMLInputElement;
        maxInput.addEventListener('change', () => {
            pool.maxItems = Math.max(parseInt(maxInput.value), 0);
        });
    
        const removePoolBtn = controlsDiv.createEl('button', { text: 'Remove Pool' });
        removePoolBtn.addEventListener('click', () => {
            const index = this.customShop.randomPools.indexOf(pool);
            if (index !== -1) {
                this.customShop.randomPools.splice(index, 1);
                poolDiv.remove();
            }
        });
    
        const itemList = poolDiv.createEl('div', { cls: 'pool-item-list' });
    
        const addItemButton = poolDiv.createEl('button', { text: 'Add Item to Pool', cls: 'add-item-button' });
        addItemButton.addEventListener('click', () => {
            this.showItemSelector(pool.items, () => {
                itemList.empty();
                pool.items.forEach(path => {
                    const itemDiv = itemList.createEl('div', { text: path.split('/').pop()?.replace('.md', '') || '' });
                });
            });
        });
    }
    
    async loadAllItems(): Promise<void> {
        // Get all markdown files from item folders
        this.allItems = [];
        
        for (const folderPath of this.plugin.getItemFolders()) {
            const itemFiles = this.app.vault.getMarkdownFiles().filter((file: TFile) =>
                file.path.startsWith(folderPath));
                
            for (const file of itemFiles) {
                this.allItems.push({
                    name: file.basename,
                    path: file.path
                });
            }
        }
    }
    
    async onOpen(): Promise<void> {
        await this.loadAllItems();
        
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: 'Create Custom Shop' });
        
        // Basic shop information
        const basicInfoDiv = contentEl.createEl('div', { cls: 'custom-shop-basic-info' });
        
        // Shop name
        const nameDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        nameDiv.createEl('span', { text: 'Shop Name:', cls: 'setting-item-name' });
        const nameInput = nameDiv.createEl('input', { 
            type: 'text',
            value: this.customShop.name,
            placeholder: 'Custom Shop Name'
        }) as HTMLInputElement;
        nameInput.addEventListener('change', () => {
            this.customShop.name = nameInput.value;
        });
        
        // Shop description
        const descDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        descDiv.createEl('span', { text: 'Description:', cls: 'setting-item-name' });
        const descInput = descDiv.createEl('input', { 
            type: 'text',
            value: this.customShop.description,
            placeholder: 'Shop description'
        }) as HTMLInputElement;
        descInput.addEventListener('change', () => {
            this.customShop.description = descInput.value;
        });
        
        // Shop note selector
        const noteDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        noteDiv.createEl('span', { text: 'Shop Note:', cls: 'setting-item-name' });
        const noteButton = noteDiv.createEl('button', { text: 'Select Shop Note' });
        const noteLabel = noteDiv.createEl('span', { 
            text: this.customShop.shopNote || 'No note selected',
            cls: 'shop-note-label' 
        });
        
        noteButton.addEventListener('click', async () => {
            const files = this.app.vault.getMarkdownFiles();
        
            const fileModal = new Modal(this.app);
            fileModal.titleEl.setText('Select Shop Note');
        
            const searchInput = fileModal.contentEl.createEl('input', {
                type: 'text',
                placeholder: 'Search notes...',
                cls: 'shop-note-search'
            }) as HTMLInputElement;
        
            const fileList = fileModal.contentEl.createEl('div', { cls: 'file-selector-list' });
        
            const renderList = (filter = '') => {
                fileList.empty();
        
                const filtered = filter
                    ? files.filter((file: TFile) => file.path.toLowerCase().includes(filter.toLowerCase()))
                    : files;
        
                filtered.forEach((file: TFile) => {
                    const fileItem = fileList.createEl('div', { cls: 'file-item' });
                    fileItem.setText(file.path);
                    fileItem.addEventListener('click', () => {
                        this.customShop.shopNote = file.path;
                        noteLabel.setText(file.path);
                        fileModal.close();
                    });
                });
        
                if (filtered.length === 0) {
                    fileList.createEl('div', { text: 'No matching notes found.', cls: 'no-matches' });
                }
            };
        
            renderList();
        
            searchInput.addEventListener('input', () => {
                renderList(searchInput.value);
            });
        
            fileModal.open();
        });
        
        // Random item settings
        const randomDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        randomDiv.createEl('span', { text: 'Random Item Chance (%):', cls: 'setting-item-name' });
        const chanceInput = randomDiv.createEl('input', { 
            type: 'number',
            value: (this.customShop.randomChance * 100).toString(),
            placeholder: '30'
        }) as HTMLInputElement;
        chanceInput.addEventListener('change', () => {
            let chance = parseInt(chanceInput.value) / 100;
            if (chance < 0) chance = 0;
            if (chance > 1) chance = 1;
            this.customShop.randomChance = chance;
        });
        
        const maxRandomDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        maxRandomDiv.createEl('span', { text: 'Max Random Items:', cls: 'setting-item-name' });
        const maxRandomInput = maxRandomDiv.createEl('input', { 
            type: 'number',
            value: this.customShop.maxRandomItems.toString(),
            placeholder: '3'
        }) as HTMLInputElement;
        maxRandomInput.addEventListener('change', () => {
            let max = parseInt(maxRandomInput.value);
            if (max < 0) max = 0;
            this.customShop.maxRandomItems = max;
        });
        
        // Item Selection
        const itemSelectionDiv = contentEl.createEl('div', { cls: 'custom-shop-item-selection' });
        itemSelectionDiv.createEl('h3', { text: 'Select Items for Shop' });
        
        // Two columns: Available Items and Selected Items
        const columnsDiv = itemSelectionDiv.createEl('div', { cls: 'columns-container' });
        
        // Fixed Items Column
        const fixedItemsDiv = columnsDiv.createEl('div', { cls: 'items-column' });
        fixedItemsDiv.createEl('h4', { text: 'Fixed Items (Always Available)' });
        const fixedList = fixedItemsDiv.createEl('div', { cls: 'item-list fixed-items' });
        
        // Show selected fixed items
        const updateFixedList = () => {
            fixedList.empty();
            this.customShop.fixedItems.forEach((itemPath, index) => {
                const itemDiv = fixedList.createEl('div', { cls: 'selected-item' });
                
                const itemName = itemPath.split('/').pop()?.replace('.md', '') || '';
                itemDiv.createEl('span', { text: itemName });
                
                const removeBtn = itemDiv.createEl('button', { text: 'Remove' });
                removeBtn.addEventListener('click', () => {
                    this.customShop.fixedItems.splice(index, 1);
                    updateFixedList();
                });
            });
            
            // Add button to add fixed items
            const addFixedBtn = fixedList.createEl('button', { 
                text: 'Add Fixed Item', 
                cls: 'add-item-button' 
            });
            addFixedBtn.addEventListener('click', () => {
                this.showItemSelector(this.customShop.fixedItems, updateFixedList);
            });
        };
        
        updateFixedList();

        const randomPoolsDiv = contentEl.createEl('div', { cls: 'random-pools-container' });
        randomPoolsDiv.createEl('h3', { text: 'Random Pools' });

        const addPoolButton = randomPoolsDiv.createEl('button', { 
            text: 'Add New Random Pool', 
            cls: 'mod-cta' 
        });
        addPoolButton.addEventListener('click', () => {
            this.addRandomPool(randomPoolsDiv);
        });

        // Render existing pools
        this.customShop.randomPools.forEach(() => {
            this.addRandomPool(randomPoolsDiv);
        });
        
        const saveButton = contentEl.createEl('button', { cls: 'mod-cta save-custom-shop' });

        const saveIcon = saveButton.createEl('span', { cls: 'save-icon' });
        saveIcon.innerText = '💾'; // Diskette icon (save)

        const saveText = saveButton.createEl('span');
        saveText.innerText = ' Save Custom Shop';

        saveButton.addEventListener('click', async () => {
            await this.saveCustomShop();
        });
    }       
        
    showItemSelector(targetArray: string[], updateCallback: () => void): void {
        // Create a modal with all available items
        const itemModal = new Modal(this.app);
        itemModal.titleEl.setText('Select Items');
        
        const searchInput = itemModal.contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Search items...',
            cls: 'item-search'
        }) as HTMLInputElement;
        
        const itemList = itemModal.contentEl.createEl('div', { cls: 'all-items-list' });
        
        const renderItems = (searchTerm = '') => {
            itemList.empty();
            
            const filteredItems = searchTerm ? 
                this.allItems.filter(item => 
                    item.name.toLowerCase().includes(searchTerm.toLowerCase())) : 
                this.allItems;
            
            filteredItems.forEach(item => {
                const itemDiv = itemList.createEl('div', { cls: 'item-option' });
                itemDiv.setText(item.name);
                
                // Don't show already selected items
                if (targetArray.includes(item.path)) {
                    itemDiv.addClass('item-already-selected');
                    return;
                }
                
                itemDiv.addEventListener('click', () => {
                    targetArray.push(item.path);
                    updateCallback();
                    itemModal.close();
                });
            });
        };
        
        // Initial render
        renderItems();
        
        // Search functionality
        searchInput.addEventListener('input', () => {
            renderItems(searchInput.value);
        });
        
        itemModal.open();
    }
    
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class CustomShopModal extends Modal {
    plugin: RPGInventoryPlugin;
    customShop: CustomShop;
    shopItems: ShopItem[];

    constructor(app: any, plugin: RPGInventoryPlugin, customShop: CustomShop) {
        super(app);
        this.plugin = plugin;
        this.customShop = customShop;
        this.shopItems = [];
    }
    
    async prepareShopItems(): Promise<void> {
        // Start with fixed items
        this.shopItems = [];
        
        // Add all fixed items
        for (const itemPath of this.customShop.fixedItems) {
            const file = this.app.vault.getAbstractFileByPath(itemPath) as TFile;
            if (file) {
                try {
                    const metadata = this.app.metadataCache.getFileCache(file);
                    const content = await this.app.vault.read(file);
                    
                    // Extract price, description, and consumable status
                    const priceMatch = content.match(/\((\d+)\s+#price\)/);
                    const descMatch = content.match(/\(([^)]+)\s+#description\)/);
                    const consumableMatch = content.match(/(\d+)\/(\d+)\s+#consumable/);
                    const isConsumable = content.includes("#consumable");
                    
                    // Create the item
                    this.shopItems.push({
                        name: file.basename,
                        file: file,
                        price: this.plugin.settings.itemCurrentPrice?.[itemPath] ||
                               (metadata?.frontmatter?.price) || 
                               (priceMatch ? parseInt(priceMatch[1]) : Math.floor(Math.random() * 90) + 10),
                        description: (metadata?.frontmatter?.description) || 
                                    (descMatch ? descMatch[1] : "No description available."),
                        stock: this.plugin.settings.shopStock[itemPath] || 
                               Math.floor(Math.random() * 5) + 1, // 1-5 stock for fixed items
                        isConsumable: isConsumable,
                        currentUses: consumableMatch ? parseInt(consumableMatch[1]) : 1,
                        maxUses: consumableMatch ? parseInt(consumableMatch[2]) : 1
                    });
                } catch (error) {
                    console.error("Error loading fixed item:", error);
                }
            }
        }
        
        // For each random pool
        for (const pool of this.customShop.randomPools) {
            const shuffled = [...pool.items].sort(() => Math.random() - 0.5);
            const limit = Math.min(pool.maxItems, shuffled.length);

            for (let i = 0; i < limit; i++) {
                if (Math.random() <= pool.chance) {
                    const itemPath = shuffled[i];
                    const file = this.app.vault.getAbstractFileByPath(itemPath) as TFile;
                    if (file) {
                        try {
                            const metadata = this.app.metadataCache.getFileCache(file);
                            const content = await this.app.vault.read(file);
                            
                            this.shopItems.push({
                                name: file.basename,
                                file: file,
                                price: this.plugin.settings.itemCurrentPrice?.[itemPath] ||
                                       (metadata?.frontmatter?.price) ||
                                       Math.floor(Math.random() * 90) + 10,
                                description: (metadata?.frontmatter?.description) || "Rare find!",
                                stock: Math.floor(Math.random() * 3) + 1,
                                isConsumable: content.includes("#consumable"),
                                currentUses: 1,
                                maxUses: 1,
                                isRare: true
                            });
                        } catch (error) {
                            console.error("Error loading random item:", error);
                        }
                    }
                }
            }
        }
    }
    
    async onOpen(): Promise<void> {
        await this.prepareShopItems();
        
        const { contentEl } = this;
        contentEl.empty();
        
        // Get shop note content if possible
        let shopNoteContent = "";
        try {
            const shopNoteFile = this.app.vault.getAbstractFileByPath(this.customShop.shopNote) as TFile;
            if (shopNoteFile) {
                shopNoteContent = await this.app.vault.read(shopNoteFile);
                
                // Create a div for the shop note with markdown rendering
                const shopNoteDiv = contentEl.createEl('div', { cls: 'shop-note-content' });
                MarkdownRenderer.renderMarkdown(
                    shopNoteContent, 
					shopNoteDiv, 
					this.customShop.shopNote,
					this.plugin
                );
            }
        } catch (error) {
            console.error("Error loading shop note:", error);
        }
        
        contentEl.createEl('h2', { text: this.customShop.name });
        
        contentEl.createEl('p', { text: this.customShop.description, cls: 'shop-description' });
        
        // Shop note link
        const openNoteButton = contentEl.createEl('button', { text: 'Open Shop Note 📝', cls: 'mod-cta' });
        openNoteButton.addEventListener('click', () => {
            const file = this.app.vault.getAbstractFileByPath(this.customShop.shopNote) as TFile;
            if (file) this.app.workspace.getLeaf().openFile(file);
        });
        
        // Display coins
        const coinDisplay = contentEl.createEl('div', { cls: 'shop-coins' });
        coinDisplay.createEl('h3', { text: `Your Coins: ${this.plugin.settings.coins}` });
        
        // Display shop items
        const shopContainer = contentEl.createEl('div', { cls: 'shop-container' });
        
        if (this.shopItems.length === 0) {
            shopContainer.createEl('p', { text: `No items available in ${this.customShop.name}.` });
        } else {
            const table = shopContainer.createEl('table');
            const headerRow = table.createEl('tr');
            headerRow.createEl('th', { text: 'Item' });
            headerRow.createEl('th', { text: 'Price' });
            headerRow.createEl('th', { text: 'Stock' });
            headerRow.createEl('th', { text: 'Description' });
            headerRow.createEl('th', { text: 'Action' });
            
            this.shopItems.forEach(item => {
                const row = table.createEl('tr');
                if (item.isRare) {
                    row.addClass('rare-item-row');
                }
                
                const nameCell = row.createEl('td');
                const itemLink = nameCell.createEl('a', { text: item.name });
                itemLink.addEventListener('click', (event) => {
                    event.preventDefault();
                    this.app.workspace.getLeaf().openFile(item.file);
                });
                
                if (item.isRare) {
                    nameCell.createEl('span', { text: ' ⭐', cls: 'rare-item-star' });
                }
                
                row.createEl('td', { text: item.price.toString() });
                row.createEl('td', { text: item.stock.toString() });
                row.createEl('td', { text: item.description });
                
                const actionCell = row.createEl('td');
                const buyButton = actionCell.createEl('button', { text: 'Buy' });
                
                // Disable buy button if out of stock
                if (item.stock <= 0) {
                    buyButton.disabled = true;
                    buyButton.addClass('button-disabled');
                }
                
                buyButton.addEventListener('click', async () => {
                    // Check if player has enough coins
                    if (this.plugin.settings.coins < item.price) {
                        new Notice("Not enough coins!");
                        return;
                    }
                    
                    // Check if item is in stock
                    if (item.stock <= 0) {
                        new Notice("Item out of stock!");
                        return;
                    }
                    
                    // Add item to inventory
                    const existingItem = this.plugin.settings.inventory.find(i => i.name === item.name);
                    if (existingItem) {
                        existingItem.quantity += 1;
                    } else {
                        this.plugin.settings.inventory.push({
                            name: item.name,
                            file: item.file.path,
                            quantity: 1,
                            price: item.price,
                            description: item.description,
                            isConsumable: item.isConsumable,
                            currentUses: item.currentUses,
                            maxUses: item.maxUses
                        });
                    }
                    
                    // Deduct coins
                    this.plugin.settings.coins -= item.price;
                    
                    // Reduce stock
                    item.stock -= 1;
                    
                    // Also update the global stock if needed
                    if (this.plugin.settings.shopStock[item.file.path] !== undefined) {
                        this.plugin.settings.shopStock[item.file.path] -= 1;
                    } else {
                        this.plugin.settings.shopStock[item.file.path] = item.stock;
                    }
                    
                    await this.plugin.saveSettings();
                    
                    new Notice(`Purchased ${item.name}!`);
                    this.onOpen(); // Refresh the modal
                });
            });
        }
        
        // Navigation buttons
        const buttonContainer = contentEl.createEl('div', { cls: 'shop-buttons' });
        
        // Back to shop selection
        const backButton = buttonContainer.createEl('button', { text: 'Back to Shops' });
        backButton.addEventListener('click', () => {
            this.close();
            new ShopSelectionModal(this.app, this.plugin).open();
        });
        
        // Open inventory
        const inventoryButton = buttonContainer.createEl('button', { text: 'Open Inventory', cls: 'mod-cta' });
        inventoryButton.addEventListener('click', () => {
            this.close();
            new InventoryModal(this.app, this.plugin).open();
        });
    }
    
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class CustomTreasureCreatorModal extends Modal {
    plugin: RPGInventoryPlugin;
    customTreasure: CustomTreasure;
    allItems: AllItemsEntry[];
    saveCustomTreasure: () => Promise<void>;

    constructor(app: any, plugin: RPGInventoryPlugin) {
        super(app);
        this.plugin = plugin;
        this.customTreasure = {
            name: '',
            description: '',
            fixedItems: [],
            randomPools: [],
            randomChance: 0.3,
            maxRandomItems: 3,
            minRandomItems: 1,
            minItems: 1,
            maxItems: 3,
            chancePercent: 70
        };
        this.allItems = [];
        this.saveCustomTreasure = this.defaultSaveCustomTreasure.bind(this);
    }

    async defaultSaveCustomTreasure(): Promise<void> {
        if (!this.customTreasure.name) {
            new Notice('Please enter a treasure name');
            return;
        }

        if (!Array.isArray(this.plugin.settings.customTreasures)) {
            this.plugin.settings.customTreasures = [];
        }

        const existingIndex = this.plugin.settings.customTreasures.findIndex(treasure => treasure.name === this.customTreasure.name);

        if (existingIndex !== -1) {
            this.plugin.settings.customTreasures[existingIndex] = this.customTreasure;
        } else {
            this.plugin.settings.customTreasures.push(this.customTreasure);
        }

        await this.plugin.saveSettings();
        new Notice(`Custom treasure "${this.customTreasure.name}" saved!`);
        this.close();
    }

    addRandomPool(container: HTMLElement): void {
        const pool: RandomPool = { name: '', chance: 0.3, maxItems: 3, items: [] };
        this.customTreasure.randomPools.push(pool);
    
        const poolDiv = container.createEl('div', { cls: 'random-pool-block' });
        poolDiv.style.border = "1px solid var(--background-modifier-border)";
        poolDiv.style.padding = "10px";
        poolDiv.style.marginBottom = "10px";
    
        const controlsDiv = poolDiv.createEl('div', { cls: 'pool-controls' });

        // Field for Random Pool Name
        const nameInput = controlsDiv.createEl('input', { 
            type: 'text', 
            placeholder: 'Pool Name (ex: Rare Gems)', 
            cls: 'input-pool-name' 
        }) as HTMLInputElement;
        nameInput.addEventListener('change', () => {
            pool.name = nameInput.value;
        });
    
        const chanceInput = controlsDiv.createEl('input', { 
            type: 'number', 
            value: '30', 
            placeholder: 'Chance %' 
        }) as HTMLInputElement;
        chanceInput.addEventListener('change', () => {
            pool.chance = Math.min(Math.max(parseInt(chanceInput.value) / 100, 0), 1);
        });
    
        const maxInput = controlsDiv.createEl('input', { 
            type: 'number', 
            value: '3', 
            placeholder: 'Max Items' 
        }) as HTMLInputElement;
        maxInput.addEventListener('change', () => {
            pool.maxItems = Math.max(parseInt(maxInput.value), 0);
        });
    
        const removePoolBtn = controlsDiv.createEl('button', { text: 'Remove Pool' });
        removePoolBtn.addEventListener('click', () => {
            const index = this.customTreasure.randomPools.indexOf(pool);
            if (index !== -1) {
                this.customTreasure.randomPools.splice(index, 1);
                poolDiv.remove();
            }
        });
    
        const itemList = poolDiv.createEl('div', { cls: 'pool-item-list' });
    
        const addItemButton = poolDiv.createEl('button', { text: 'Add Item to Pool', cls: 'add-item-button' });
        addItemButton.addEventListener('click', () => {
            this.showItemSelector(pool.items, () => {
                itemList.empty();
                pool.items.forEach(path => {
                    const itemDiv = itemList.createEl('div', { text: path.split('/').pop()?.replace('.md', '') || '' });
                });
            });
        });
    }
    async loadAllItems(): Promise<void> {
        // Get all markdown files from item folders
        this.allItems = [];
        
        for (const folderPath of this.plugin.getItemFolders()) {
            const itemFiles = this.app.vault.getMarkdownFiles().filter((file: TFile) =>
                file.path.startsWith(folderPath));
                
            for (const file of itemFiles) {
                this.allItems.push({
                    name: file.basename,
                    path: file.path
                });
            }
        }
    }
    
    async onOpen(): Promise<void> {
        await this.loadAllItems();
        
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: 'Create Custom Treasure' });
        
        // Basic treasure information
        const basicInfoDiv = contentEl.createEl('div', { cls: 'custom-treasure-basic-info' });
        
        // Treasure name
        const nameDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        nameDiv.createEl('span', { text: 'Treasure Name:', cls: 'setting-item-name' });
        const nameInput = nameDiv.createEl('input', { 
            type: 'text',
            value: this.customTreasure.name,
            placeholder: 'Custom Treasure Name'
        }) as HTMLInputElement;
        nameInput.addEventListener('change', () => {
            this.customTreasure.name = nameInput.value;
        });
        
        // Treasure description
        const descDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        descDiv.createEl('span', { text: 'Description:', cls: 'setting-item-name' });
        const descInput = descDiv.createEl('input', { 
            type: 'text',
            value: this.customTreasure.description,
            placeholder: 'Treasure description'
        }) as HTMLInputElement;
        descInput.addEventListener('change', () => {
            this.customTreasure.description = descInput.value;
        });
        
        // Treasure chance settings
        const chanceDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        chanceDiv.createEl('span', { text: 'Success Chance (%):', cls: 'setting-item-name' });
        const chanceInput = chanceDiv.createEl('input', { 
            type: 'number',
            value: this.customTreasure.chancePercent.toString(),
            placeholder: '70'
        }) as HTMLInputElement;
        chanceInput.addEventListener('change', () => {
            let chance = parseInt(chanceInput.value);
            if (chance < 0) chance = 0;
            if (chance > 100) chance = 100;
            this.customTreasure.chancePercent = chance;
        });
        
        // Min/Max items
        const minItemsDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        minItemsDiv.createEl('span', { text: 'Min Items:', cls: 'setting-item-name' });
        const minItemsInput = minItemsDiv.createEl('input', { 
            type: 'number',
            value: this.customTreasure.minItems.toString(),
            placeholder: '1'
        }) as HTMLInputElement;
        minItemsInput.addEventListener('change', () => {
            let min = parseInt(minItemsInput.value);
            if (min < 0) min = 0;
            this.customTreasure.minItems = min;
        });
        
        const maxItemsDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        maxItemsDiv.createEl('span', { text: 'Max Items:', cls: 'setting-item-name' });
        const maxItemsInput = maxItemsDiv.createEl('input', { 
            type: 'number',
            value: this.customTreasure.maxItems.toString(),
            placeholder: '3'
        }) as HTMLInputElement;
        maxItemsInput.addEventListener('change', () => {
            let max = parseInt(maxItemsInput.value);
            if (max < 0) max = 0;
            this.customTreasure.maxItems = max;
        });
        
        // Random item settings
        const randomDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        randomDiv.createEl('span', { text: 'Random Item Chance (%):', cls: 'setting-item-name' });
        const randomChanceInput = randomDiv.createEl('input', { 
            type: 'number',
            value: (this.customTreasure.randomChance * 100).toString(),
            placeholder: '30'
        }) as HTMLInputElement;
        randomChanceInput.addEventListener('change', () => {
            let chance = parseInt(randomChanceInput.value) / 100;
            if (chance < 0) chance = 0;
            if (chance > 1) chance = 1;
            this.customTreasure.randomChance = chance;
        });
        
        // Min Random Items
        const minRandomDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        minRandomDiv.createEl('span', { text: 'Min Random Items:', cls: 'setting-item-name' });
        const minRandomInput = minRandomDiv.createEl('input', { 
            type: 'number',
            value: this.customTreasure.minRandomItems.toString(),
            placeholder: '1'
        }) as HTMLInputElement;
        minRandomInput.addEventListener('change', () => {
            let min = parseInt(minRandomInput.value);
            if (min < 0) min = 0;
            this.customTreasure.minRandomItems = min;
        });
        
        const maxRandomDiv = basicInfoDiv.createEl('div', { cls: 'setting-item' });
        maxRandomDiv.createEl('span', { text: 'Max Random Items:', cls: 'setting-item-name' });
        const maxRandomInput = maxRandomDiv.createEl('input', { 
            type: 'number',
            value: this.customTreasure.maxRandomItems.toString(),
            placeholder: '3'
        }) as HTMLInputElement;
        maxRandomInput.addEventListener('change', () => {
            let max = parseInt(maxRandomInput.value);
            if (max < 0) max = 0;
            this.customTreasure.maxRandomItems = max;
        });
        
        // Item Selection
        const itemSelectionDiv = contentEl.createEl('div', { cls: 'custom-treasure-item-selection' });
        itemSelectionDiv.createEl('h3', { text: 'Select Items for Treasure' });
        
        // Fixed Items Column
        const fixedItemsDiv = itemSelectionDiv.createEl('div', { cls: 'items-column' });
        fixedItemsDiv.createEl('h4', { text: 'Fixed Items (Always Obtained)' });
        const fixedList = fixedItemsDiv.createEl('div', { cls: 'item-list fixed-items' });
        
        // Show selected fixed items
        const updateFixedList = () => {
            fixedList.empty();
            this.customTreasure.fixedItems.forEach((itemPath, index) => {
                const itemDiv = fixedList.createEl('div', { cls: 'selected-item' });
                
                const itemName = itemPath.split('/').pop()?.replace('.md', '') || '';
                itemDiv.createEl('span', { text: itemName });
                
                const removeBtn = itemDiv.createEl('button', { text: 'Remove' });
                removeBtn.addEventListener('click', () => {
                    this.customTreasure.fixedItems.splice(index, 1);
                    updateFixedList();
                });
            });
            
            // Add button to add fixed items
            const addFixedBtn = fixedList.createEl('button', { 
                text: 'Add Fixed Item', 
                cls: 'add-item-button' 
            });
            addFixedBtn.addEventListener('click', () => {
                this.showItemSelector(this.customTreasure.fixedItems, updateFixedList);
            });
        };
        
        updateFixedList();

        const randomPoolsDiv = contentEl.createEl('div', { cls: 'random-pools-container' });
        randomPoolsDiv.createEl('h3', { text: 'Random Pools' });

        const addPoolButton = randomPoolsDiv.createEl('button', { 
            text: 'Add New Random Pool', 
            cls: 'mod-cta' 
        });
        addPoolButton.addEventListener('click', () => {
            this.addRandomPool(randomPoolsDiv);
        });

        // Render existing pools
        this.customTreasure.randomPools.forEach(() => {
            this.addRandomPool(randomPoolsDiv);
        });
        
        const saveButton = contentEl.createEl('button', { cls: 'mod-cta save-custom-treasure' });

        const saveIcon = saveButton.createEl('span', { cls: 'save-icon' });
        saveIcon.innerText = '💎'; // Gem icon for treasure

        const saveText = saveButton.createEl('span');
        saveText.innerText = ' Save Custom Treasure';

        saveButton.addEventListener('click', async () => {
            await this.saveCustomTreasure();
        });
    }       
        
    showItemSelector(targetArray: string[], updateCallback: () => void): void {
        // Create a modal with all available items
        const itemModal = new Modal(this.app);
        itemModal.titleEl.setText('Select Items');
        
        const searchInput = itemModal.contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Search items...',
            cls: 'item-search'
        }) as HTMLInputElement;
        
        const itemList = itemModal.contentEl.createEl('div', { cls: 'all-items-list' });
        
        const renderItems = (searchTerm = '') => {
            itemList.empty();
            
            const filteredItems = searchTerm ? 
                this.allItems.filter(item => 
                    item.name.toLowerCase().includes(searchTerm.toLowerCase())) : 
                this.allItems;
            
            filteredItems.forEach(item => {
                const itemDiv = itemList.createEl('div', { cls: 'item-option' });
                itemDiv.setText(item.name);
                
                // Don't show already selected items
                if (targetArray.includes(item.path)) {
                    itemDiv.addClass('item-already-selected');
                    return;
                }
                
                itemDiv.addEventListener('click', () => {
                    targetArray.push(item.path);
                    updateCallback();
                    itemModal.close();
                });
            });
        };
        
        // Initial render
        renderItems();
        
        // Search functionality
        searchInput.addEventListener('input', () => {
            renderItems(searchInput.value);
        });
        
        itemModal.open();
    }
    
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}