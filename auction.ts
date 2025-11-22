import { Modal, Notice } from 'obsidian';
import RPGInventoryPlugin, { InventoryItem, ActiveListing, MarketRegion } from './inventory';

function getRarity(item: InventoryItem): string {  
    if (!item) return "Common";
    if (item.description && item.description.toLowerCase().includes("#legendary")) return "Legendary";
    if (item.description && item.description.toLowerCase().includes("#epic")) return "Epic";
    if ((item.description && item.description.toLowerCase().includes("#rare")) || (item as any).isRare) return "Rare";
    if (item.description && item.description.toLowerCase().includes("#uncommon")) return "Uncommon";
    return "Common";
}

export class auctionShopModal extends Modal {
    plugin: RPGInventoryPlugin;
    
    constructor(app: any, plugin: RPGInventoryPlugin) {
        super(app);
        this.plugin = plugin;
    }

    getGameTime(): number {
        return Date.now() + (this.plugin.settings.gameDateOffset || 0);
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rpg-auction-shop');

        // --- GARANTIA DE DADOS ---
        if (!this.plugin.settings.activeListings) {
            this.plugin.settings.activeListings = [];
        }

        // --- HEADER ---
        const header = contentEl.createEl('div', { cls: 'shop-header' });
        header.createEl('h2', { text: '⚖️ Auction Shop' });
        
        // Controles de Tempo
        const timeControls = header.createEl('div', { cls: 'time-controls' });
        const date = new Date(this.getGameTime());
        timeControls.createEl('span', { text: `📅 ${date.toLocaleDateString()} ` });
        
        const advanceBtn = timeControls.createEl('button', { text: '⏩ Advance 1 Day' });
        advanceBtn.addEventListener('click', async () => {
            this.plugin.settings.gameDateOffset = (this.plugin.settings.gameDateOffset || 0) + (24 * 60 * 60 * 1000);
            await this.plugin.saveSettings();
            const changed = await this.processListings();
            if (changed) new Notice("Some items found buyers!");
            this.onOpen(); 
        });

        contentEl.createEl('hr');

        // --- SELETOR DE REGIÃO & RESET ---
        const regionContainer = contentEl.createEl('div', { cls: 'region-container' });
        regionContainer.style.display = 'flex';
        regionContainer.style.alignItems = 'center';
        regionContainer.style.gap = '10px';
        regionContainer.style.marginBottom = '15px';

        regionContainer.createEl('span', { text: '📍 Region: ' });
        const regionSelect = regionContainer.createEl('select');
        
        // Renderiza opções
        if (this.plugin.settings.regions) {
            this.plugin.settings.regions.forEach((region: MarketRegion, index: number) => {
                const option = regionSelect.createEl('option', { text: region.name, value: index.toString() });
                if (index === this.plugin.settings.currentRegionIndex) option.selected = true;
            });
        }
        
        regionSelect.addEventListener('change', async () => {
            this.plugin.settings.currentRegionIndex = parseInt(regionSelect.value);
            await this.plugin.saveSettings();
            this.onOpen();
        });

        // --- BOTÃO DE CORREÇÃO (RESET) ---
        // Este botão resolve o problema das regiões antigas presas no save
        const resetRegionsBtn = regionContainer.createEl('button', { text: '♻️ Reset/Fix Regions' });
        resetRegionsBtn.setAttribute('title', 'Click this if regions are old or broken');
        resetRegionsBtn.addEventListener('click', async () => {
            if(confirm("Reset regions to default settings? This fixes bugs with old save data.")) {
                this.plugin.settings.regions = [
                    {
                        name: "Standard Kingdom",
                        description: "Normal trade routes.",
                        priceModifiers: {},
                        rarityRules: {
                            "Common": { daysToWait: 2, chanceToFindBuyer: 100 },
                            "Uncommon": { daysToWait: 5, chanceToFindBuyer: 100 },
                            "Rare": { daysToWait: 10, chanceToFindBuyer: 70 },
                            "Epic": { daysToWait: 10, chanceToFindBuyer: 20 },
                            "Legendary": { daysToWait: 10, chanceToFindBuyer: 1 }
                        }
                    },
                    {
                        name: "High Magic Capital",
                        description: "Faster trade for magical items.",
                        priceModifiers: { "Rare": 1.2, "Epic": 1.5 },
                        rarityRules: {
                            "Common": { daysToWait: 1, chanceToFindBuyer: 100 },
                            "Uncommon": { daysToWait: 3, chanceToFindBuyer: 100 },
                            "Rare": { daysToWait: 5, chanceToFindBuyer: 80 },
                            "Epic": { daysToWait: 7, chanceToFindBuyer: 30 },
                            "Legendary": { daysToWait: 10, chanceToFindBuyer: 5 }
                        }
                    }
                ];
                this.plugin.settings.currentRegionIndex = 0;
                await this.plugin.saveSettings();
                new Notice("Regions reset to defaults!");
                this.onOpen();
            }
        });

        // --- LAYOUT PRINCIPAL ---
        const container = contentEl.createEl('div', { cls: 'auction-container' });
        container.style.display = 'flex';
        container.style.gap = '20px';

        // COLUNA 1: INVENTÁRIO
        const inventoryCol = container.createEl('div', { cls: 'inventory-col' });
        inventoryCol.style.flex = '1';
        inventoryCol.createEl('h3', { text: '🎒 Your Inventory' });
        
        if (!this.plugin.settings.inventory || this.plugin.settings.inventory.length === 0) {
            inventoryCol.createEl('p', { text: 'Empty.' });
        } else {
            const list = inventoryCol.createEl('div', { cls: 'inventory-list' });
            this.plugin.settings.inventory.forEach((item: InventoryItem) => {
                const itemRow = list.createEl('div', { cls: 'inventory-item-row' });
                itemRow.style.border = '1px solid var(--background-modifier-border)';
                itemRow.style.padding = '5px';
                itemRow.style.marginBottom = '5px';
                itemRow.style.display = 'flex';
                itemRow.style.justifyContent = 'space-between';
                itemRow.style.alignItems = 'center';

                itemRow.createEl('span', { text: `${item.name} (x${item.quantity})` });
                const sellBtn = itemRow.createEl('button', { text: 'List' });
                sellBtn.addEventListener('click', async () => {
                    await this.createListing(item);
                    this.onOpen();
                });
            });
        }

        // COLUNA 2: SLOTS DE VENDA
        const slotsCol = container.createEl('div', { cls: 'slots-col' });
        slotsCol.style.flex = '2'; 
        slotsCol.createEl('h3', { text: '🏪 Active Sales Slots' });

        const listings = this.plugin.settings.activeListings;
        if (!listings || listings.length === 0) {
            slotsCol.createEl('p', { text: 'No items listed.' });
        } else {
            listings.forEach((listing: ActiveListing) => {
                this.renderListingCard(slotsCol, listing);
            });
        }
    }

    renderListingCard(container: HTMLElement, listing: ActiveListing) {
        const card = container.createEl('div', { cls: 'listing-card' });
        card.style.background = 'var(--background-secondary)';
        card.style.padding = '10px';
        card.style.marginBottom = '10px';
        card.style.borderRadius = '8px';
        card.style.borderLeft = listing.status === 'OFFER_PENDING' ? '5px solid #4caf50' : '5px solid #ffa726';

        const header = card.createEl('div', { cls: 'card-header' });
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.createEl('strong', { text: listing.item.name });
        header.createEl('small', { text: getRarity(listing.item) });

        const statusDiv = card.createEl('div', { cls: 'card-status' });
        statusDiv.style.marginTop = '8px';

        if (listing.status === 'SEARCHING') {
            const now = this.getGameTime();
            const msRemaining = listing.nextCheckDate - now;
            const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
            
            statusDiv.setText(daysRemaining <= 0 ? `⌛ Evaluating...` : `🔍 Searching... check in ${daysRemaining} days.`);
            
            const cancelBtn = card.createEl('button', { text: 'Cancel' });
            cancelBtn.style.marginTop = '5px';
            cancelBtn.addEventListener('click', async () => {
                await this.cancelListing(listing);
            });

        } else if (listing.status === 'OFFER_PENDING') {
            statusDiv.createEl('div', { text: `🎉 Offer: ${listing.currentOffer} coins!`, cls: 'offer-text' }).style.fontWeight = 'bold';
            statusDiv.createEl('small', { text: `Quality: ${listing.offerQuality}` });

            const btnGroup = card.createEl('div', { cls: 'btn-group' });
            btnGroup.style.marginTop = '10px';
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '10px';

            const acceptBtn = btnGroup.createEl('button', { text: '✅ Accept', cls: 'mod-cta' });
            acceptBtn.addEventListener('click', async () => {
                this.plugin.settings.coins += listing.currentOffer || 0;
                this.plugin.settings.activeListings = this.plugin.settings.activeListings.filter((l: ActiveListing) => l.id !== listing.id);
                await this.plugin.saveSettings();
                new Notice(`Sold for ${listing.currentOffer} coins!`);
                this.onOpen();
            });

            // CORREÇÃO DO BOTÃO REJEITAR
            const rejectBtn = btnGroup.createEl('button', { text: '❌ Reject' });
            rejectBtn.addEventListener('click', async () => {
                listing.status = 'SEARCHING';
                listing.currentOffer = 0;
                listing.offerQuality = '';
                
                // Lógica de fallback segura para evitar crash
                const region = this.plugin.settings.regions[this.plugin.settings.currentRegionIndex];
                const rarity = getRarity(listing.item);
                
                // Tenta pegar a regra, se não existir (região antiga), usa padrão de 5 dias
                let daysToAdd = 5; 
                if (region && region.rarityRules && region.rarityRules[rarity]) {
                    daysToAdd = region.rarityRules[rarity].daysToWait;
                } else if (region && region.rarityRules && region.rarityRules["Common"]) {
                    daysToAdd = region.rarityRules["Common"].daysToWait;
                }

                listing.nextCheckDate = this.getGameTime() + (daysToAdd * 24 * 60 * 60 * 1000);
                
                await this.plugin.saveSettings();
                new Notice("Offer rejected. Waiting for new buyer...");
                this.onOpen();
            });
        }
    }

    async createListing(item: InventoryItem): Promise<void> {
        if (item.quantity > 1) item.quantity -= 1;
        else this.plugin.settings.inventory = this.plugin.settings.inventory.filter((i: InventoryItem) => i !== item);

        const itemCopy = { ...item, quantity: 1 };
        
        // Fallback seguro ao criar
        if (!this.plugin.settings.regions || !this.plugin.settings.regions[this.plugin.settings.currentRegionIndex]) {
             new Notice("Please click 'Reset Regions' first!");
             this.plugin.settings.inventory.push(itemCopy); // Devolve o item
             return;
        }

        const region = this.plugin.settings.regions[this.plugin.settings.currentRegionIndex];
        const rarity = getRarity(itemCopy);
        const daysToAdd = (region.rarityRules && region.rarityRules[rarity]) ? region.rarityRules[rarity].daysToWait : 2;
        
        const now = this.getGameTime();
        const newListing: ActiveListing = {
            id: Date.now().toString() + Math.random().toString(),
            item: itemCopy,
            dateListed: now,
            nextCheckDate: now + (daysToAdd * 24 * 60 * 60 * 1000),
            status: 'SEARCHING',
            attempts: 0,
            currentOffer: 0,
            offerQuality: ''
        };

        if (!this.plugin.settings.activeListings) this.plugin.settings.activeListings = [];
        this.plugin.settings.activeListings.push(newListing);
        await this.plugin.saveSettings();
        new Notice("Item listed!");
    }

    async cancelListing(listing: ActiveListing): Promise<void> {
        const existing = this.plugin.settings.inventory.find((i: InventoryItem) => i.name === listing.item.name);
        if (existing) existing.quantity += 1;
        else this.plugin.settings.inventory.push(listing.item);

        this.plugin.settings.activeListings = this.plugin.settings.activeListings.filter((l: ActiveListing) => l.id !== listing.id);
        await this.plugin.saveSettings();
        this.onOpen();
    }

    async processListings(): Promise<boolean> {
        const now = this.getGameTime();
        // Proteção contra erro de região
        if (!this.plugin.settings.regions || !this.plugin.settings.regions[this.plugin.settings.currentRegionIndex]) return false;

        const region = this.plugin.settings.regions[this.plugin.settings.currentRegionIndex];
        let changed = false;

        for (const listing of this.plugin.settings.activeListings) {
            if (listing.status === 'SEARCHING' && now >= listing.nextCheckDate) {
                const rarity = getRarity(listing.item);
                // Fallback seguro
                const chance = (region.rarityRules && region.rarityRules[rarity]) ? region.rarityRules[rarity].chanceToFindBuyer : 50;
                const daysToWait = (region.rarityRules && region.rarityRules[rarity]) ? region.rarityRules[rarity].daysToWait : 5;

                const buyerRoll = Math.random() * 100;
                if (buyerRoll <= chance) {
                    // Achou comprador
                    const priceRoll = Math.floor(Math.random() * 100) + 1;
                    let priceMult = 1.0;
                    let quality = "Standard";
                    if (priceRoll <= 40) { priceMult = 0.5; quality = "Low (50%)"; }
                    else if (priceRoll <= 90) { priceMult = 1.0; quality = "Fair (100%)"; }
                    else { priceMult = 1.5; quality = "High (150%)"; }

                    let regionPriceMod = 1.0;
                    if (region.priceModifiers) {
                        for(const key in region.priceModifiers) {
                            if (listing.item.file.includes(key) || rarity === key) {
                                regionPriceMod = Math.max(regionPriceMod, region.priceModifiers[key]);
                            }
                        }
                    }
                    const basePrice = listing.item.price || 50;
                    listing.currentOffer = Math.floor(basePrice * priceMult * regionPriceMod);
                    listing.offerQuality = quality;
                    listing.status = 'OFFER_PENDING';
                } else {
                    // Falhou
                    listing.nextCheckDate = now + (daysToWait * 24 * 60 * 60 * 1000);
                    listing.attempts += 1;
                }
                changed = true;
            }
        }

        if (changed) await this.plugin.saveSettings();
        return changed;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}