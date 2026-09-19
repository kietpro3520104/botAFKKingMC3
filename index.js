const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const HTTP_PORT = Number(process.env.PORT || 10000);

const BOT_ID_RAW = String(process.env.BOT || '1').trim() || '1';
const BOT_ID_NUMBER_PARSED =
    Number.parseInt(BOT_ID_RAW, 10);

const BOT_ID_NUMBER =
    Number.isFinite(BOT_ID_NUMBER_PARSED)
        ? BOT_ID_NUMBER_PARSED
        : 1;

const BOT_ID =
    String(BOT_ID_RAW || BOT_ID_NUMBER);
const BOT_LABEL = `Bot ${BOT_ID}`;

const MAX_LOGS = 100;
const RECONNECT_DELAY = 3000;
const STATUS_POLL_MS = 1000;
const UPTIME_UPDATE_MS = 250;

// KingMC AFK flow timing.
const DN_TO_AFK_DELAY = 1000;
const AFK_MENU_DELAY = 1800;
const AFK_MENU_CLICK_DELAY = 700;

// Background inventory / survival managers.
const AUTO_EAT_INTERVAL_MS = 2000;
const AUTO_TOTEM_INTERVAL_MS = 1500;
const INVENTORY_SCAN_INTERVAL_MS = 1000;

const MC_VERSION = '1.20.1';
const HOSTS = (process.env.MC_SERVER_HOSTS || 'sgp.kingmc.vn,kingmc.vn')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean);
const PORT = Number(process.env.MC_SERVER_PORT || 25565);

// Network / client-load tuning.
// Mineflayer officially supports far / normal / short / tiny / numeric view distance.
// tiny is the lowest named setting and is appropriate for an AFK bot.
const VIEW_DISTANCE = process.env.MC_VIEW_DISTANCE || 'tiny';
const CHECK_TIMEOUT_INTERVAL = Number(
    process.env.MC_CHECK_TIMEOUT_MS || 30000
);

app.use(express.json({ limit: '8kb' }));

// API responses should not be cached. The central dashboard communicates
// with child bots server-to-server, so wildcard CORS is intentionally disabled.
app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') {
        res.setHeader(
            'Cache-Control',
            'no-store, no-cache, must-revalidate, proxy-revalidate'
        );
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }

    res.setHeader('X-Bot-ID', BOT_ID);
    res.setHeader('X-Bot-Protocol', '2');

    next();
});

function cleanMinecraftText(text) {
    if (!text) return '';

    return String(text)
        .replace(/§x(§[0-9a-f]){6}/gi, '')
        .replace(/&x(&[0-9a-f]){6}/gi, '')
        .replace(/&#[0-9a-f]{6}/gi, '')
        .replace(/§#[0-9a-f]{6}/gi, '')
        .replace(/§[0-9a-fk-or]/gi, '')
        .replace(/&[0-9a-fk-or]/gi, '')
        .replace(/§./g, '')
        .replace(/[\u00A0\u200B\uFEFF]/g, ' ')
        .normalize('NFC')
        .trim();
}

function getEnvCredentials() {
    return {
        username:
            process.env.BOT1_USERNAME ||
            process.env.MC_USERNAME ||
            '',

        password:
            process.env.BOT1_PASSWORD ||
            process.env.MC_PASSWORD ||
            ''
    };
}

function createBotState() {
    const credentials = getEnvCredentials();

    return {
        id: BOT_ID_NUMBER,
        botId: BOT_ID,

        username: credentials.username,
        password: credentials.password,

        bot: null,
        hostIndex: 0,

        status: 'offline',
        ready: false,
        manuallyStopped: true,
        connectedAt: null,

        // AFK uptime statistics.
        // Uptime counts only while status === 'afk'.
        afkElapsedSeconds: 0,
        afkStartedAt: null,
        reconnectCount: 0,
        reconnectAttempts: 0,

        reconnectTimer: null,
        afkTimers: [],
        lastAuthTime: 0,

        inventoryState: {
            revision: 0,
            health: 20,
            food: 20,
            saturation: 20,
            foodCount: 0,
            goldenAppleCount: 0,
            totemCount: 0,
            offhand: null,
            selectedHotbar: 0,
            selectedSlot: 0,
            armor: {
                head: null,
                torso: null,
                legs: null,
                feet: null
            },
            hotbar: [],
            inventory: [],
            slots: {}
        },

        isEating: false,
        inventoryScanTimer: null,
        totemTimer: null,
        eatTimer: null,

        inventoryLogSignature: '',
        previousInventorySnapshot: null,
        inventoryRevision: 0,
        inventoryActionBusy: false,
        foodMissingLogged: false,
        totemLogState: null,
        isEquippingTotem: false,

        logs: [],
        logRevision: 0,

        chatLogs: [],
        chatLogRevision: 0,
        recentChatMessages: [],
        lastWebChatText: '',
        lastWebChatAt: 0
    };
}

const botState = createBotState();

function addLog(state, message) {
    const time = new Date().toLocaleTimeString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false
    });

    const line = `${time} ${message}`;

    state.logs.push(line);
    state.logRevision++;

    if (state.logs.length > MAX_LOGS) {
        state.logs.splice(
            0,
            state.logs.length - MAX_LOGS
        );
    }

    console.log(`[BOT ${state.id}] ${message}`);
}


function addChatLog(
    state,
    username,
    message,
    role = ''
) {
    const time = new Date().toLocaleTimeString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false
    });

    const cleanMessage =
        cleanMinecraftText(message);

    const cleanUsername =
        cleanMinecraftText(username);

    const cleanRole =
        cleanMinecraftText(role);

    if (!cleanMessage) {
        return;
    }

    let line;

    if (cleanRole && cleanUsername) {
        line =
            `${time} ${cleanRole}| ${cleanUsername}: ${cleanMessage}`;
    } else if (cleanUsername) {
        line =
            `${time} <${cleanUsername}> ${cleanMessage}`;
    } else {
        line =
            `${time} ${cleanMessage}`;
    }

    state.chatLogs.push(line);
    state.chatLogRevision++;

    if (state.chatLogs.length > 200) {
        state.chatLogs.splice(
            0,
            state.chatLogs.length - 200
        );
    }

    state.recentChatMessages.push({
        key:
            `${cleanRole}|${cleanUsername}|${cleanMessage}`,
        role: cleanRole,
        username: cleanUsername,
        text: cleanMessage,
        at: Date.now()
    });

    if (state.recentChatMessages.length > 30) {
        state.recentChatMessages.splice(
            0,
            state.recentChatMessages.length - 30
        );
    }

    console.log(
        `[BOT ${state.id}] [CHAT] ${line}`
    );
}

function isRecentChatMessage(
    state,
    cleanMsg,
    username = '',
    role = ''
) {
    const now = Date.now();
    const wantedText = cleanMinecraftText(cleanMsg);
    const wantedUsername = cleanMinecraftText(username);
    const wantedRole = cleanMinecraftText(role);

    state.recentChatMessages =
        state.recentChatMessages.filter(
            entry => now - entry.at <= 2500
        );

    return state.recentChatMessages.some(
        entry => {
            if (entry.text !== wantedText) {
                return false;
            }

            if (
                wantedUsername &&
                entry.username &&
                entry.username !== wantedUsername
            ) {
                return false;
            }

            if (
                wantedRole &&
                entry.role &&
                entry.role !== wantedRole
            ) {
                return false;
            }

            return true;
        }
    );
}

function parseCustomChatLine(cleanMsg) {
    const candidate =
        cleanMsg.replace(
            /^\[MC\]\s*/i,
            ''
        );

    const match =
        candidate.match(
            /^(.+?)\|\s*([A-Za-z0-9_]{1,16})\s*:\s*(.+)$/u
        );

    if (!match) {
        return null;
    }

    const role =
        cleanMinecraftText(match[1]);

    const username =
        cleanMinecraftText(match[2]);

    const message =
        cleanMinecraftText(match[3]);

    if (
        !role ||
        !username ||
        !message
    ) {
        return null;
    }

    return {
        role,
        username,
        message
    };
}

function clearAfkTimers(state) {
    for (const timer of state.afkTimers) {
        clearTimeout(timer);
    }

    state.afkTimers = [];
}

function clearReconnectTimer(state) {
    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }
}

function clearManagerTimers(state) {
    if (state.eatTimer) {
        clearInterval(state.eatTimer);
        state.eatTimer = null;
    }

    if (state.totemTimer) {
        clearInterval(state.totemTimer);
        state.totemTimer = null;
    }

    if (state.inventoryScanTimer) {
        clearInterval(state.inventoryScanTimer);
        state.inventoryScanTimer = null;
    }

    state.isEating = false;
    state.isEquippingTotem = false;
}

function clearAllTimers(state) {
    clearAfkTimers(state);
    clearReconnectTimer(state);
    clearManagerTimers(state);
}

const FOOD_PRIORITY = [
    'golden_apple',
    'cooked_beef',
    'cooked_porkchop',
    'cooked_chicken',
    'baked_potato',
    'bread',
    'cooked_mutton',
    'cooked_salmon'
];

function rememberSelectedSlot(state) {
    if (
        !state.bot ||
        !Number.isInteger(state.bot.quickBarSlot)
    ) {
        return 0;
    }

    const slot = state.bot.quickBarSlot;

    if (slot < 0 || slot > 8) {
        return 0;
    }

    return slot;
}

function restoreSelectedSlot(state, slot) {
    if (
        !state.bot ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot > 8 ||
        typeof state.bot.setQuickBarSlot !== 'function'
    ) {
        return false;
    }

    try {
        state.bot.setQuickBarSlot(slot);
        return true;
    } catch (err) {
        addLog(
            state,
            `[HOTBAR] Không thể khôi phục slot ${slot}: ${err.message}`
        );
        return false;
    }
}

function selectHotbarSlot(state, slot) {
    if (
        !state.bot ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot > 8 ||
        typeof state.bot.setQuickBarSlot !== 'function'
    ) {
        return false;
    }

    try {
        state.bot.setQuickBarSlot(slot);
        return true;
    } catch (err) {
        addLog(
            state,
            `[HOTBAR] Không thể chọn slot ${slot}: ${err.message}`
        );
        return false;
    }
}

function resetInventoryState(state) {
    state.inventoryState = {
        revision: state.inventoryRevision || 0,
        health: 20,
        food: 20,
        saturation: 20,
        foodCount: 0,
        goldenAppleCount: 0,
        totemCount: 0,
        offhand: null,
        selectedHotbar: 0,
        selectedSlot: 0,
        armor: {
            head: null,
            torso: null,
            legs: null,
            feet: null
        },
        hotbar: [],
        inventory: [],
        slots: {}
    };

    state.inventoryLogSignature = '';
    state.previousInventorySnapshot = null;
    state.inventoryActionBusy = false;
    state.foodMissingLogged = false;
    state.totemLogState = null;
    state.isEquippingTotem = false;
}

function getOffhandSlot(bot) {
    if (
        bot &&
        typeof bot.getEquipmentDestSlot === 'function'
    ) {
        try {
            return bot.getEquipmentDestSlot('off-hand');
        } catch (_) {
        }
    }

    return 45;
}

function itemToInventoryData(item, slot = null) {
    if (!item) {
        return null;
    }

    return {
        slot:
            Number.isInteger(slot)
                ? slot
                : Number.isInteger(item.slot)
                    ? item.slot
                    : null,
        name: item.name || '',
        displayName:
            item.displayName ||
            item.name ||
            '',
        count:
            Number(item.count || 0),
        metadata:
            item.metadata ?? null
    };
}

function getSlotLabel(slot) {
    if (slot >= 36 && slot <= 44) {
        return `HOTBAR ${slot - 35}`;
    }

    if (slot >= 9 && slot <= 35) {
        return `INV ${slot}`;
    }

    if (slot === 5) return 'ARMOR head';
    if (slot === 6) return 'ARMOR torso';
    if (slot === 7) return 'ARMOR legs';
    if (slot === 8) return 'ARMOR feet';
    if (slot === 45) return 'OFFHAND';

    return `SLOT ${slot}`;
}

function itemSummary(item) {
    if (!item) {
        return 'empty';
    }

    const count =
        Number(item.count || 0);

    return `${item.displayName || item.name || 'unknown'} x${count}`;
}

function itemSignature(item) {
    if (!item) {
        return 'empty';
    }

    return [
        item.name || '',
        Number(item.count || 0),
        item.metadata ?? ''
    ].join('|');
}

function buildSlotState(slots) {
    const slotState = {};

    for (let slot = 5; slot <= 45; slot++) {
        slotState[String(slot)] =
            itemToInventoryData(
                slots[slot] || null,
                slot
            );
    }

    return slotState;
}

function buildInventorySnapshot(
    nextState
) {
    const slotSignatures = {};
    const slotSummaries = {};

    const slots =
        nextState.slots || {};

    for (
        let slot = 5;
        slot <= 45;
        slot++
    ) {
        const key = String(slot);
        const item =
            slots[key] || null;

        slotSignatures[key] =
            itemSignature(item);

        slotSummaries[key] =
            itemSummary(item);
    }

    return {
        health:
            Number(nextState.health ?? 20),
        food:
            Number(nextState.food ?? 20),
        saturation:
            Number(nextState.saturation ?? 20),
        foodCount:
            Number(nextState.foodCount ?? 0),
        goldenAppleCount:
            Number(nextState.goldenAppleCount ?? 0),
        totemCount:
            Number(nextState.totemCount ?? 0),
        selectedSlot:
            Number(nextState.selectedSlot ?? 0),
        slotSignatures,
        slotSummaries
    };
}

function countSlotChanges(
    previous,
    next,
    start,
    end
) {
    let count = 0;

    const previousSignatures =
        previous?.slotSignatures || {};

    const nextSignatures =
        next?.slotSignatures || {};

    for (
        let slot = start;
        slot <= end;
        slot++
    ) {
        const key = String(slot);

        if (
            previousSignatures[key] !==
            nextSignatures[key]
        ) {
            count++;
        }
    }

    return count;
}

function logInventoryDifferences(
    state,
    previous,
    next
) {
    if (!previous) {
        addLog(
            state,
            '[INV] Inventory đã đồng bộ lần đầu.'
        );
        return;
    }

    const previousHealth =
        Number(previous.health ?? 20);

    const nextHealth =
        Number(next.health ?? 20);

    if (
        previousHealth !==
        nextHealth
    ) {
        addLog(
            state,
            `[HEALTH] ${previousHealth} → ${nextHealth} HP.`
        );
    }

    const previousFood =
        Number(previous.food ?? 20);

    const nextFood =
        Number(next.food ?? 20);

    if (
        previousFood !==
        nextFood
    ) {
        addLog(
            state,
            `[FOOD] Hunger ${previousFood} → ${nextFood}.`
        );
    }

    const previousFoodCount =
        Number(previous.foodCount ?? 0);

    const nextFoodCount =
        Number(next.foodCount ?? 0);

    if (
        previousFoodCount !==
        nextFoodCount
    ) {
        addLog(
            state,
            `[INV] Tổng thức ăn ${previousFoodCount} → ${nextFoodCount}.`
        );
    }

    const previousGolden =
        Number(previous.goldenAppleCount ?? 0);

    const nextGolden =
        Number(next.goldenAppleCount ?? 0);

    if (
        previousGolden !==
        nextGolden
    ) {
        addLog(
            state,
            `[INV] Golden Apple ${previousGolden} → ${nextGolden}.`
        );
    }

    const previousTotem =
        Number(previous.totemCount ?? 0);

    const nextTotem =
        Number(next.totemCount ?? 0);

    if (
        previousTotem !==
        nextTotem
    ) {
        addLog(
            state,
            `[TOTEM] Số Totem ${previousTotem} → ${nextTotem}.`
        );
    }

    const previousSelected =
        Number(previous.selectedSlot ?? 0);

    const nextSelected =
        Number(next.selectedSlot ?? 0);

    if (
        previousSelected !==
        nextSelected
    ) {
        addLog(
            state,
            `[HOTBAR] Selected slot ${previousSelected + 1} → ${nextSelected + 1}.`
        );
    }

    const inventoryChanges =
        countSlotChanges(
            previous,
            next,
            9,
            35
        );

    const hotbarChanges =
        countSlotChanges(
            previous,
            next,
            36,
            44
        );

    const equipmentChanges =
        countSlotChanges(
            previous,
            next,
            5,
            8
        );

    const previousOffhand =
        previous?.slotSignatures?.['45'] ||
        'empty';

    const nextOffhand =
        next?.slotSignatures?.['45'] ||
        'empty';

    if (
        inventoryChanges > 0
    ) {
        addLog(
            state,
            `[INV] Inventory cập nhật: ${inventoryChanges} ô thay đổi.`
        );
    }

    if (
        hotbarChanges > 0
    ) {
        addLog(
            state,
            `[HOTBAR] Hotbar cập nhật: ${hotbarChanges} ô thay đổi.`
        );
    }

    if (
        equipmentChanges > 0
    ) {
        addLog(
            state,
            `[EQUIP] Trang bị cập nhật: ${equipmentChanges} ô thay đổi.`
        );
    }

    if (
        previousOffhand !==
        nextOffhand
    ) {
        const oldText =
            previous?.slotSummaries?.['45'] ||
            'empty';

        const newText =
            next?.slotSummaries?.['45'] ||
            'empty';

        addLog(
            state,
            `[EQUIP] Offhand: ${oldText} → ${newText}.`
        );
    }
}

function buildInventorySignature(
    snapshot
) {
    const slotSignatures =
        snapshot.slotSignatures || {};

    const slotParts = [];

    for (
        let slot = 5;
        slot <= 45;
        slot++
    ) {
        slotParts.push(
            `${slot}:${slotSignatures[String(slot)] || 'empty'}`
        );
    }

    return [
        snapshot.selectedSlot,
        slotParts.join(';')
    ].join('|');
}

function scanInventory(
    state,
    bot = state.bot,
    forceLog = false
) {
    if (
        !bot ||
        state.bot !== bot ||
        !bot.inventory ||
        !Array.isArray(bot.inventory.slots)
    ) {
        return false;
    }

    const slots = bot.inventory.slots;
    const offhandSlot = getOffhandSlot(bot);

    const allMainItems = [];

    for (let slot = 9; slot <= 35; slot++) {
        allMainItems.push(
            itemToInventoryData(
                slots[slot] || null,
                slot
            )
        );
    }

    const hotbar = [];

    for (let quickSlot = 0; quickSlot < 9; quickSlot++) {
        const inventorySlot = 36 + quickSlot;
        hotbar.push(
            itemToInventoryData(
                slots[inventorySlot] || null,
                inventorySlot
            )
        );
    }

    const armor = {
        head: itemToInventoryData(slots[5] || null, 5),
        torso: itemToInventoryData(slots[6] || null, 6),
        legs: itemToInventoryData(slots[7] || null, 7),
        feet: itemToInventoryData(slots[8] || null, 8)
    };

    const offhandItem = slots[offhandSlot] || null;

    let foodCount = 0;
    let goldenAppleCount = 0;
    let totemCount = 0;

    for (let slot = 9; slot <= 45; slot++) {
        const item = slots[slot];

        if (!item || !item.name) {
            continue;
        }

        if (FOOD_PRIORITY.includes(item.name)) {
            foodCount += Number(item.count || 0);
        }

        if (item.name === 'golden_apple') {
            goldenAppleCount += Number(item.count || 0);
        }

        if (item.name === 'totem_of_undying') {
            totemCount += Number(item.count || 0);
        }
    }

    const selectedSlot =
        Number.isInteger(bot.quickBarSlot) &&
        bot.quickBarSlot >= 0 &&
        bot.quickBarSlot <= 8
            ? bot.quickBarSlot
            : 0;

    const nextState = {
        revision: state.inventoryRevision,
        health: Number.isFinite(bot.health)
            ? Math.max(0, Math.min(Number(bot.health), 20))
            : 20,
        food: Number.isFinite(bot.food)
            ? Math.max(0, Math.min(Number(bot.food), 20))
            : 20,
        saturation: Number.isFinite(bot.foodSaturation)
            ? Math.max(0, Number(bot.foodSaturation))
            : 20,
        foodCount,
        goldenAppleCount,
        totemCount,
        offhand: offhandItem && offhandItem.name
            ? offhandItem.name
            : null,
        selectedHotbar: selectedSlot,
        selectedSlot,
        armor,
        hotbar,
        inventory: allMainItems,
        slots: buildSlotState(slots)
    };

    const nextSnapshot = buildInventorySnapshot(nextState);
    const previous = state.previousInventorySnapshot;

    const nextSignature = buildInventorySignature(nextSnapshot);
    const previousSignature = previous
        ? buildInventorySignature(previous)
        : '';

    const slotOrSelectionChanged =
        !previous ||
        previousSignature !== nextSignature;

    const displayStateChanged =
        !previous ||
        previous.health !== nextSnapshot.health ||
        previous.food !== nextSnapshot.food ||
        previous.saturation !== nextSnapshot.saturation;

    if (slotOrSelectionChanged) {
        state.inventoryRevision++;
        nextState.revision = state.inventoryRevision;
    } else {
        nextState.revision = state.inventoryRevision;
    }

    state.inventoryState = nextState;

    if (slotOrSelectionChanged || displayStateChanged) {
        logInventoryDifferences(
            state,
            previous,
            nextSnapshot
        );
    } else if (forceLog) {
        addLog(
            state,
            '[INV] Inventory đã đồng bộ.'
        );
    }

    state.inventoryLogSignature = nextSignature;
    state.previousInventorySnapshot = nextSnapshot;

    return true;
}

function findFoodItem(bot) {
    if (
        !bot ||
        !bot.inventory ||
        !Array.isArray(bot.inventory.slots)
    ) {
        return null;
    }

    const slots = bot.inventory.slots;

    for (const foodName of FOOD_PRIORITY) {
        for (let slot = 9; slot <= 44; slot++) {
            const item = slots[slot];

            if (item && item.name === foodName) {
                return item;
            }
        }
    }

    return null;
}

function findTotemItem(bot) {
    if (
        !bot ||
        !bot.inventory ||
        !Array.isArray(bot.inventory.slots)
    ) {
        return null;
    }

    const offhandSlot = getOffhandSlot(bot);

    for (let slot = 9; slot <= 44; slot++) {
        if (slot === offhandSlot) {
            continue;
        }

        const item = bot.inventory.slots[slot];

        if (item && item.name === 'totem_of_undying') {
            return item;
        }
    }

    return null;
}

async function autoEatTick(state) {
    const bot = state.bot;

    if (
        state.manuallyStopped ||
        !bot ||
        state.bot !== bot ||
        !bot.player ||
        state.isEating ||
        state.inventoryActionBusy
    ) {
        return;
    }

    if (
        state.status === 'offline' ||
        state.status === 'connecting' ||
        state.status === 'authenticating' ||
        state.status === 'entering' ||
        state.status === 'kicked'
    ) {
        return;
    }

    if (bot.currentWindow || bot.usingHeldItem) {
        return;
    }

    const food =
        Number.isFinite(bot.food)
            ? Number(bot.food)
            : 20;

    if (food >= 18) {
        state.foodMissingLogged = false;
        return;
    }

    const foodItem = findFoodItem(bot);

    if (!foodItem) {
        if (!state.foodMissingLogged) {
            addLog(
                state,
                '[FOOD] Không tìm thấy thức ăn.'
            );
            state.foodMissingLogged = true;
        }
        return;
    }

    state.foodMissingLogged = false;
    state.isEating = true;
    state.inventoryActionBusy = true;

    const oldBot = bot;
    const oldSelectedSlot =
        rememberSelectedSlot(state);

    const foodName =
        foodItem.displayName ||
        foodItem.name;

    const oldHeldItem =
        bot.heldItem ||
        (
            bot.inventory &&
            Array.isArray(bot.inventory.slots)
                ? bot.inventory.slots[36 + oldSelectedSlot] || null
                : null
        );

    try {
        addLog(
            state,
            `[FOOD] Bắt đầu ăn ${foodName}.`
        );

        if (
            !selectHotbarSlot(
                state,
                oldSelectedSlot
            )
        ) {
            return;
        }

        addLog(
            state,
            `[FOOD] Equip ${foodName} vào tay.`
        );

        await bot.equip(
            foodItem,
            'hand'
        );

        if (
            state.manuallyStopped ||
            state.bot !== oldBot ||
            !oldBot.player ||
            oldBot.currentWindow
        ) {
            return;
        }

        addLog(
            state,
            `[FOOD] Bắt đầu Consume ${foodName}.`
        );

        await bot.consume();

        if (state.bot === oldBot) {
            addLog(
                state,
                `[FOOD] Đã ăn xong ${foodName}.`
            );
        }
    } catch (err) {
        if (state.bot === oldBot) {
            addLog(
                state,
                `[FOOD] Lỗi khi ăn ${foodName}: ${err.message}`
            );
        }
    } finally {
        state.isEating = false;

        if (
            state.bot !== oldBot ||
            state.manuallyStopped
        ) {
            state.inventoryActionBusy = false;
            return;
        }

        try {
            if (
                oldHeldItem &&
                bot.inventory &&
                Array.isArray(bot.inventory.slots)
            ) {
                let oldItemStillExists = false;

                for (const item of bot.inventory.slots) {
                    if (item === oldHeldItem) {
                        oldItemStillExists = true;
                        break;
                    }
                }

                if (oldItemStillExists) {
                    await bot.equip(
                        oldHeldItem,
                        'hand'
                    );

                    addLog(
                        state,
                        `[FOOD] Đã khôi phục item cũ: ${oldHeldItem.displayName || oldHeldItem.name}.`
                    );
                }
            }
        } catch (err) {
            addLog(
                state,
                `[HOTBAR] Không thể restore item cũ: ${err.message}`
            );
        }

        restoreSelectedSlot(
            state,
            oldSelectedSlot
        );

        scanInventory(
            state,
            bot,
            false
        );

        state.inventoryActionBusy = false;
    }
}

async function autoTotemTick(state) {
    const bot = state.bot;

    if (
        state.manuallyStopped ||
        !bot ||
        state.bot !== bot ||
        !bot.player ||
        !bot.entity ||
        state.isEating ||
        state.isEquippingTotem ||
        state.inventoryActionBusy
    ) {
        return;
    }

    if (
        state.status === 'offline' ||
        state.status === 'connecting' ||
        state.status === 'authenticating' ||
        state.status === 'entering' ||
        state.status === 'kicked'
    ) {
        return;
    }

    if (bot.currentWindow || bot.usingHeldItem) {
        return;
    }

    const offhandSlot =
        getOffhandSlot(bot);

    const offhandItem =
        bot.inventory &&
        Array.isArray(bot.inventory.slots)
            ? bot.inventory.slots[offhandSlot]
            : null;

    if (
        offhandItem &&
        offhandItem.name === 'totem_of_undying'
    ) {
        if (state.totemLogState !== 'has') {
            addLog(
                state,
                '[TOTEM] Offhand đã có Totem.'
            );
            state.totemLogState = 'has';
        }
        return;
    }

    if (
        state.totemLogState === 'has'
    ) {
        addLog(
            state,
            '[TOTEM] Totem offhand đã mất hoặc đã được kích hoạt.'
        );
        state.totemLogState = null;
    }

    const totem =
        findTotemItem(bot);

    if (!totem) {
        if (
            state.totemLogState !== 'empty'
        ) {
            addLog(
                state,
                '[TOTEM] Hết Totem.'
            );
            state.totemLogState = 'empty';
        }
        return;
    }

    state.isEquippingTotem = true;
    state.inventoryActionBusy = true;
    state.totemLogState = 'equipping';

    const oldBot = bot;

    try {
        addLog(
            state,
            '[TOTEM] Đang equip Totem vào offhand.'
        );

        await bot.equip(
            totem,
            'off-hand'
        );

        if (
            state.bot === oldBot &&
            !state.manuallyStopped
        ) {
            addLog(
                state,
                '[TOTEM] Đã trang bị Totem vào offhand.'
            );

            state.totemLogState = 'has';

            scanInventory(
                state,
                bot,
                false
            );
        }
    } catch (err) {
        if (state.bot === oldBot) {
            addLog(
                state,
                `[TOTEM] Lỗi trang bị Totem: ${err.message}`
            );
            state.totemLogState = null;
        }
    } finally {
        state.isEquippingTotem = false;
        state.inventoryActionBusy = false;
    }
}

function startBackgroundManagers(state, bot) {
    clearManagerTimers(state);

    scanInventory(
        state,
        bot,
        true
    );

    state.inventoryScanTimer =
        setInterval(
            () => {
                if (
                    state.manuallyStopped ||
                    state.bot !== bot
                ) {
                    return;
                }

                scanInventory(
                    state,
                    bot,
                    false
                );
            },
            INVENTORY_SCAN_INTERVAL_MS
        );

    state.eatTimer =
        setInterval(
            () => {
                if (
                    state.manuallyStopped ||
                    state.bot !== bot
                ) {
                    return;
                }

                autoEatTick(state)
                    .catch(err => {
                        if (state.bot === bot) {
                            addLog(
                                state,
                                `[FOOD] Lỗi manager: ${err.message}`
                            );
                        }
                    });
            },
            AUTO_EAT_INTERVAL_MS
        );

    state.totemTimer =
        setInterval(
            () => {
                if (
                    state.manuallyStopped ||
                    state.bot !== bot
                ) {
                    return;
                }

                autoTotemTick(state)
                    .catch(err => {
                        if (state.bot === bot) {
                            addLog(
                                state,
                                `[TOTEM] Lỗi manager: ${err.message}`
                            );
                        }
                    });
            },
            AUTO_TOTEM_INTERVAL_MS
        );
}

function publicInventoryState(state) {
    const inventory = state.inventoryState || {};

    return {
        revision:
            Number(inventory.revision ?? state.inventoryRevision ?? 0),

        health:
            Number(inventory.health ?? 20),

        food:
            Number(inventory.food ?? 20),

        saturation:
            Number(inventory.saturation ?? 20),

        foodCount:
            Number(inventory.foodCount ?? 0),

        goldenAppleCount:
            Number(inventory.goldenAppleCount ?? 0),

        totemCount:
            Number(inventory.totemCount ?? 0),

        offhand:
            inventory.offhand ?? null,

        selectedHotbar:
            Number(inventory.selectedHotbar ?? 0),

        selectedSlot:
            Number(inventory.selectedSlot ?? 0),

        armor:
            inventory.armor || {
                head: null,
                torso: null,
                legs: null,
                feet: null
            },

        hotbar:
            Array.isArray(inventory.hotbar)
                ? inventory.hotbar
                : [],

        inventory:
            Array.isArray(inventory.inventory)
                ? inventory.inventory
                : [],

        slots:
            inventory.slots || {}
    };
}

function currentHost(state) {
    return (
        HOSTS[state.hostIndex] ||
        HOSTS[0] ||
        'sgp.kingmc.vn'
    );
}

function getPing(state) {
    if (!state.bot) return null;

    if (
        state.bot.player &&
        Number.isFinite(state.bot.player.ping)
    ) {
        return state.bot.player.ping;
    }

    if (
        state.bot._client &&
        Number.isFinite(state.bot._client.latency)
    ) {
        return state.bot._client.latency;
    }

    return null;
}

function updateAfkUptime(state) {
    if (
        state.afkStartedAt &&
        state.status === 'afk'
    ) {
        state.afkElapsedSeconds +=
            Math.floor(
                (Date.now() - state.afkStartedAt) / 1000
            );

        state.afkStartedAt =
            Date.now();
    }
}

function setBotStatus(state, status) {
    if (
        state.status === 'afk' &&
        status !== 'afk'
    ) {
        updateAfkUptime(state);
        state.afkStartedAt = null;
    }

    if (
        status === 'afk' &&
        state.status !== 'afk'
    ) {
        state.afkStartedAt = Date.now();
    }

    state.status = status;
}

function getUptimeSeconds(state) {
    let total =
        state.afkElapsedSeconds || 0;

    if (
        state.status === 'afk' &&
        state.afkStartedAt
    ) {
        total +=
            Math.floor(
                (Date.now() - state.afkStartedAt) / 1000
            );
    }

    return Math.min(
        Math.max(total, 0),
        (999 * 60 * 60) - 1
    );
}

function formatUptime(state) {
    const totalSeconds =
        getUptimeSeconds(state);

    const hours =
        Math.floor(
            totalSeconds / 3600
        );

    const minutes =
        Math.floor(
            (totalSeconds % 3600) / 60
        );

    const seconds =
        totalSeconds % 60;

    return (
        `${hours}h ` +
        `${minutes}m ` +
        `${seconds}s`
    );
}

function getBotPosition(state) {
    if (
        !state.bot ||
        !state.bot.entity ||
        !state.bot.entity.position
    ) {
        return null;
    }

    const position =
        state.bot.entity.position;

    const x = Number(position.x);
    const y = Number(position.y);
    const z = Number(position.z);

    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z)
    ) {
        return null;
    }

    return {
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        z: Number(z.toFixed(2))
    };
}

function getBotDimension(state) {
    if (!state.bot) {
        return null;
    }

    if (
        typeof state.bot.game?.dimension ===
        'string'
    ) {
        return state.bot.game.dimension;
    }

    return null;
}

function publicBotState(state) {
    return {
        id: state.id,
        botId: BOT_ID,
        nodeId: BOT_ID,
        label: BOT_LABEL,
        username: state.username || '',
        status: state.status,
        ready: state.ready,
        ping: getPing(state),
        host: currentHost(state),
        port: PORT,

        uptimeSeconds:
            getUptimeSeconds(state),

        uptime:
            formatUptime(state),

        reconnectCount:
            state.reconnectCount,

        connectedAt:
            state.connectedAt,

        logRevision:
            state.logRevision,

        chatLogRevision:
            state.chatLogRevision,

        position:
            getBotPosition(state),

        dimension:
            getBotDimension(state)
    };
}

function getReconnectDelay(state) {
    const attempt =
        Math.max(
            Number(state.reconnectAttempts || 0),
            0
        );

    const multiplier =
        Math.min(
            Math.pow(1.5, attempt),
            5
        );

    return Math.min(
        Math.round(
            RECONNECT_DELAY * multiplier
        ),
        15000
    );
}

function scheduleReconnect(state) {
    if (
        state.manuallyStopped ||
        state.reconnectTimer
    ) {
        return;
    }

    clearAfkTimers(state);

    state.ready = false;
    setBotStatus(state, 'connecting');

    const reconnectDelay =
        getReconnectDelay(state);

    state.reconnectAttempts++;

    state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;

        if (!state.manuallyStopped) {
            connectBot(state);
        }
    }, reconnectDelay);

    addLog(
        state,
        `Sẽ reconnect sau ${reconnectDelay / 1000}s.`
    );
}

function disconnectBot(
    state,
    reason = 'Stopped'
) {
    clearAllTimers(state);

    state.ready = false;
    setBotStatus(state, 'offline');
    state.connectedAt = null;

    const currentBot = state.bot;

    state.bot = null;
    resetInventoryState(state);

    if (!currentBot) {
        return;
    }

    try {
        currentBot.removeAllListeners();

        if (
            typeof currentBot.quit === 'function'
        ) {
            currentBot.quit(reason);
        }
    } catch (err) {
        console.log(
            `[BOT ${state.id}] Shutdown error: ${err.message}`
        );
    }
}

function stopBot(state) {
    state.manuallyStopped = true;

    addLog(
        state,
        'Dừng bot từ web.'
    );

    disconnectBot(
        state,
        'Stopped from web panel'
    );
}

function startBot(state) {
    if (
        !state.username ||
        !state.password
    ) {
        addLog(
            state,
            'Không thể chạy: thiếu username hoặc password.'
        );

        setBotStatus(state, 'offline');

        return false;
    }

    state.manuallyStopped = false;

    clearAllTimers(state);

    state.hostIndex = 0;
    state.ready = false;
    state.connectedAt = null;
    state.reconnectAttempts = 0;
    setBotStatus(state, 'connecting');

    if (state.bot) {
        disconnectBot(
            state,
            'Restart from web panel'
        );

        state.manuallyStopped = false;
    }

    connectBot(state);

    return true;
}

function registerEvents(state, bot) {
    bot.on('chat', (username, message, translate, jsonMsg) => {
        if (
            !message ||
            state.bot !== bot
        ) {
            return;
        }

        const cleanMessage =
            cleanMinecraftText(message);

        if (!cleanMessage) {
            return;
        }

        if (
            username === bot.username &&
            state.lastWebChatText === cleanMessage &&
            Date.now() - state.lastWebChatAt <= 1500
        ) {
            return;
        }

        if (
            isRecentChatMessage(
                state,
                cleanMessage,
                username,
                ''
            )
        ) {
            return;
        }

        addChatLog(
            state,
            username,
            cleanMessage
        );
    });

    bot.on('error', err => {
        addLog(
            state,
            `Lỗi kết nối: ${err.message}`
        );
    });

    bot.on('kicked', reason => {
        const reasonText =
            typeof reason === 'string'
                ? reason
                : JSON.stringify(reason);

        setBotStatus(state, 'kicked');
        state.ready = false;
        clearManagerTimers(state);

        addLog(
            state,
            `Bị kick: ${cleanMinecraftText(reasonText)}`
        );
    });

    bot.on('end', () => {
        const isCurrentBot = state.bot === bot;

        if (isCurrentBot) {
            state.bot = null;
        }

        clearManagerTimers(state);

        state.ready = false;
        state.connectedAt = null;

        if (state.manuallyStopped) {
            setBotStatus(state, 'offline');

            addLog(
                state,
                'Đã ngắt kết nối.'
            );

            return;
        }

        setBotStatus(state, 'offline');

        addLog(
            state,
            'Mất kết nối.'
        );

        // Unexpected disconnect: count reconnect.
        // AFK uptime is frozen because status is no longer AFK.
        state.reconnectCount++;

        addLog(
            state,
            `Reconnect #${state.reconnectCount}.`
        );

        if (HOSTS.length > 1) {
            state.hostIndex =
                (state.hostIndex + 1) %
                HOSTS.length;
        }

        scheduleReconnect(state);
    });

    bot.once('spawn', () => {
        setBotStatus(state, 'online');
        state.ready = false;
        state.connectedAt = Date.now();
        state.reconnectAttempts = 0;

        startBackgroundManagers(
            state,
            bot
        );
    });

    bot.on('death', () => {
        if (state.bot === bot) {
            addLog(
                state,
                '[LIFE] Bot đã chết.'
            );
        }
    });

    bot.on('message', jsonMsg => {
        handleServerMessage(
            state,
            bot,
            jsonMsg
        );
    });

    bot.on('windowOpen', window => {
        let title = '';

        try {
            const rawTitle =
                window && window.title
                    ? window.title
                    : '';

            if (typeof rawTitle === 'string') {
                title =
                    cleanMinecraftText(
                        rawTitle
                    );
            } else if (
                rawTitle &&
                typeof rawTitle === 'object'
            ) {
                title =
                    cleanMinecraftText(
                        rawTitle.text ||
                        rawTitle.toString()
                    );
            } else if (rawTitle) {
                title =
                    cleanMinecraftText(
                        rawTitle.toString()
                    );
            }
        } catch (_) {
            title = '';
        }

        if (title) {
            addLog(
                state,
                `Đã mở GUI ${title}.`
            );
        } else {
            addLog(
                state,
                'Đã mở GUI.'
            );
        }
    });
}

function connectBot(state) {
    if (state.manuallyStopped) {
        return;
    }

    clearAfkTimers(state);
    clearReconnectTimer(state);

    state.ready = false;
    setBotStatus(state, 'connecting');

    const host = currentHost(state);

    addLog(
        state,
        `Đang kết nối tới ${host}:${PORT} | ` +
        `Minecraft ${MC_VERSION} | ` +
        `ViewDistance ${VIEW_DISTANCE}`
    );

    let bot;

    try {
        bot = mineflayer.createBot({
            host,
            port: PORT,
            username: state.username,
            version: MC_VERSION,
            auth: 'offline',

            keepAlive: true,
            checkTimeoutInterval:
                CHECK_TIMEOUT_INTERVAL,

            viewDistance:
                VIEW_DISTANCE,

            logErrors: false,

            chat: 'enabled',
            defaultChatPatterns: true
        });
    } catch (err) {
        setBotStatus(state, 'offline');

        addLog(
            state,
            `Lỗi khởi tạo Mineflayer: ${err.message}`
        );

        scheduleReconnect(state);

        return;
    }

    state.bot = bot;

    registerEvents(
        state,
        bot
    );
}

function handleServerMessage(
    state,
    bot,
    jsonMsg
) {
    const text = jsonMsg.toString();
    const cleanMsg =
        cleanMinecraftText(text);
    const lowerMsg =
        cleanMsg.toLowerCase();

    const customChat =
        parseCustomChatLine(
            cleanMsg
        );

    const customChatIsOwnRecentWebMessage =
        !!(
            customChat &&
            customChat.username === bot.username &&
            cleanMinecraftText(state.lastWebChatText) === customChat.message &&
            Date.now() - state.lastWebChatAt <= 2500
        );

    if (
        customChat &&
        !customChatIsOwnRecentWebMessage &&
        !isRecentChatMessage(
            state,
            customChat.message,
            customChat.username,
            customChat.role
        )
    ) {
        addChatLog(
            state,
            customChat.username,
            customChat.message,
            customChat.role
        );
    }

    // Giữ toàn bộ [MC] message trên web,
    // chỉ bỏ những message spam/không cần thiết.
    const blockedMcLogPatterns = [
        'đăng nhập bằng lệnh',
        'đăng nhập thành công',
        'phiên đăng nhập đã được kết nối trở lại',
        'dùng lệnh /rtp để dịch chuyển ngẫu nhiên tới nơi sinh tồn và xây căn cứ',
        'donate sẽ góp phần giúp Server',
        'xin lưu ý: giá bán item có thể tăng hoặc giảm để cân bằng server tránh lạm phát',
        'chơi server dưới 180 phút mỗi ngày để đảm bảo sức khỏe...',
        'server nghiêm cấm mọi hành vi',
        'để có rank plus và key (/warp crate), dùng lệnh /key hoặc /donate',
        'có kinh phí để phát triển hơn',
        'những người Donate sẽ nhận được',
        'hack cheat',
        'nếu bị phát hiện sẽ phạt theo luật',
        'xu, Money, Danh vọng được dùng để',
        'mua 1 số vật phẩm trong map',
        'hãy là 1 người chơi văn minh',
        'bạn đã đăng nhập!',
        'đã donate key, rank bằng thẻ được rồi nha (/key)',
        'kingmc.vn',
        'tự do xây dựng, tự do pvp và làm những điều mình thích nhưng phải tuân thủ luật',
        'nếu phát hiện người chơi khác có',
        'hành vi gian lận',
        'và gửi cho admin'
    ];

    const shouldShowMcLog =
        !blockedMcLogPatterns.some(
            pattern =>
                lowerMsg.includes(pattern)
        );

    if (
        shouldShowMcLog &&
        !customChat &&
        !isRecentChatMessage(
            state,
            cleanMsg
        ) &&
        !(
            /^<[^>]{1,32}>\s/.test(cleanMsg) ||
            /^\[[^\]]{1,24}\]\s*\S{1,32}\s*[>:»]\s*/.test(cleanMsg) ||
            /^\S{1,32}\s*[>:»]\s+/.test(cleanMsg)
        )
    ) {
        addLog(
            state,
            `[MC] ${cleanMsg}`
        );
    }

    // -------------------------------------------------------------------------
    // Lobby detection + /dn
    // -------------------------------------------------------------------------

    if (
        lowerMsg.includes('kingmc.vn')
    ) {
        const pos =
            bot && bot.entity
                ? bot.entity.position
                : null;

        let isLobby = false;

        if (pos) {
            const dx =
                Math.abs(pos.x - 0.50);

            const dy =
                Math.abs(pos.y - 41.00);

            const dz =
                Math.abs(pos.z - 0.80);

            if (
                dx <= 2.0 &&
                dy <= 2.0 &&
                dz <= 2.0
            ) {
                isLobby = true;
            }
        }

        if (isLobby) {
            const now = Date.now();

            if (
                !state.lastAuthTime ||
                now - state.lastAuthTime > 5000
            ) {
                state.lastAuthTime = now;

                state.ready = false;
                setBotStatus(state, 'authenticating');

                addLog(
                    state,
                    'Đã nhận diện Lobby KingMC.'
                );

                if (!state.password) {
                    addLog(
                        state,
                        'Thiếu password, không thể gửi /dn.'
                    );

                    return;
                }

                bot.chat(
                    `/dn ${state.password}`
                );

                addLog(
                    state,
                    'Đã gửi /dn.'
                );

                const timer =
                    setTimeout(() => {
                        if (
                            !state.manuallyStopped &&
                            state.bot === bot
                        ) {
                            startAfkRoutine(
                                state
                            );
                        }
                    }, DN_TO_AFK_DELAY);

                state.afkTimers.push(
                    timer
                );
            }
        }

        return;
    }

    // -------------------------------------------------------------------------
    // Fallback /register
    // -------------------------------------------------------------------------

    if (
        state.password &&
        (
            lowerMsg.includes('/dk') ||
            lowerMsg.includes(
                'dang ky bang lenh'
            ) ||
            lowerMsg.includes(
                'dang ky'
            ) ||
            lowerMsg.includes(
                '/register'
            )
        )
    ) {
        const now = Date.now();

        if (
            !state.lastAuthTime ||
            now - state.lastAuthTime > 3000
        ) {
            state.lastAuthTime = now;

            setBotStatus(state, 'authenticating');

            bot.chat(
                `/register ${state.password} ${state.password}`
            );

            addLog(
                state,
                'Đã gửi /register.'
            );
        }

        return;
    }

    // -------------------------------------------------------------------------
    // Fallback /login
    // -------------------------------------------------------------------------

    if (
        state.password &&
        (
            lowerMsg.includes('/dn') ||
            lowerMsg.includes(
                'vui long'
            ) ||
            lowerMsg.includes(
                'dang nhap'
            ) ||
            lowerMsg.includes(
                '/login'
            )
        )
    ) {
        const now = Date.now();

        if (
            !state.lastAuthTime ||
            now - state.lastAuthTime > 3000
        ) {
            state.lastAuthTime = now;

            setBotStatus(state, 'authenticating');

            bot.chat(
                `/login ${state.password}`
            );

            addLog(
                state,
                'Đã gửi /login.'
            );
        }
    }
}

function startAfkRoutine(state) {
    if (
        state.manuallyStopped ||
        !state.bot
    ) {
        return;
    }

    clearAfkTimers(state);

    state.ready = false;
    setBotStatus(state, 'entering');

    const menuTimer =
        setTimeout(() => {
            if (
                state.manuallyStopped ||
                !state.bot
            ) {
                return;
            }

            state.bot.chat('/menu');

            const clickTimer =
                setTimeout(() => {
                    if (
                        state.manuallyStopped ||
                        !state.bot
                    ) {
                        return;
                    }

                    const currentWindow =
                        state.bot.currentWindow;

                    if (!currentWindow) {
                        addLog(
                            state,
                            'Không có GUI /menu. Thử lại routine.'
                        );

                        startAfkRoutine(
                            state
                        );

                        return;
                    }

                    try {
                        state.bot.clickWindow(
                            24,
                            0,
                            0
                        );

                        state.ready = true;
                        setBotStatus(state, 'afk');

                        addLog(
                            state,
                            'Đã click slot 24.'
                        );

                        addLog(
                            state,
                            '✅ Đã vào trạng thái AFK.'
                        );
                    } catch (err) {
                        state.ready = false;
                        setBotStatus(state, 'online');

                        addLog(
                            state,
                            `Lỗi click slot 24: ${err.message}`
                        );
                    }
                }, AFK_MENU_CLICK_DELAY);

            state.afkTimers.push(
                clickTimer
            );
        }, AFK_MENU_DELAY);

    state.afkTimers.push(
        menuTimer
    );
}

const HTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta
    name="viewport"
    content="width=device-width,initial-scale=1"
>
<title>KingMC Bot Manager</title>

<style>
:root{
  color-scheme:dark;
  --bg:#0a0e13;
  --card:#111820;
  --card2:#151f29;
  --border:#273442;
  --text:#eef4f8;
  --muted:#95a3b2;
  --green:#30d158;
  --red:#ff453a;
  --yellow:#ffd60a;
  --blue:#4da3ff;
}

*{
  box-sizing:border-box
}

body{
  margin:0;
  min-height:100vh;
  background:var(--bg);
  color:var(--text);
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif
}

button,
input{
  font:inherit
}

button{
  border:1px solid var(--border);
  border-radius:10px;
  background:#1a2530;
  color:var(--text);
  padding:9px 13px;
  cursor:pointer
}

button:hover{
  background:#22313f
}

button.primary{
  background:#1769aa;
  border-color:#2588d2
}

button.danger{
  background:#3a1717;
  border-color:#682525
}

button:disabled{
  opacity:.45;
  cursor:not-allowed
}

input{
  width:100%;
  padding:11px 12px;
  border-radius:10px;
  border:1px solid var(--border);
  background:#0d1319;
  color:var(--text);
  outline:none
}

input:focus{
  border-color:#3d88c7
}

.app{
  width:min(
    1080px,
    calc(100% - 28px)
  );
  margin:0 auto;
  padding:28px 0 42px
}

h1,
h2,
h3,
p{
  margin:0
}

.topbar{
  display:flex;
  align-items:center;
  gap:12px;
  margin-bottom:18px
}

.detail-title{
  font-size:22px;
  font-weight:750
}

.detail-subtitle{
  color:var(--muted);
  font-size:12px;
  margin-top:3px
}

.grid{
  display:grid;
  grid-template-columns:
    1.1fr .9fr;
  gap:16px
}

.panel{
  border:1px solid var(--border);
  border-radius:16px;
  background:var(--card);
  padding:17px
}

.panel h3{
  font-size:14px;
  margin-bottom:14px
}

.big-status{
  display:flex;
  align-items:center;
  gap:8px;
  font-size:18px;
  font-weight:750;
  margin-bottom:13px
}

.info{
  display:grid;
  grid-template-columns:
    repeat(
      2,
      minmax(0,1fr)
    );
  gap:9px
}

.info-item{
  padding:10px 11px;
  border-radius:10px;
  background:var(--card2)
}

.info-label{
  color:var(--muted);
  font-size:10px;
  margin-bottom:4px
}

.info-value{
  font-size:14px;
  word-break:break-all
}

.controls{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-top:14px
}

.form-row{
  display:grid;
  gap:7px;
  margin-bottom:11px
}

label{
  color:var(--muted);
  font-size:12px
}

.chat-row{
  display:flex;
  gap:8px
}

.log{
  height:380px;
  overflow:auto;
  background:#080b0f;
  border:1px solid var(--border);
  border-radius:10px;
  padding:10px;
  font:
    12px/1.55
    ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  white-space:pre-wrap;
  word-break:break-word
}

.line{
  padding:2px 0
}

.note{
  margin-top:8px;
  color:var(--muted);
  font-size:12px;
  line-height:1.45
}

.toast{
  position:fixed;
  right:14px;
  bottom:14px;
  display:none;
  max-width:340px;
  padding:11px 13px;
  border:1px solid var(--border);
  border-radius:10px;
  background:#18222d;
  z-index:20
}

.dot{
  width:9px;
  height:9px;
  border-radius:50%;
  display:inline-block;
  background:#697582
}

.dot.green{
  background:var(--green)
}

.dot.red{
  background:var(--red)
}

.dot.yellow{
  background:var(--yellow)
}

.dot.blue{
  background:var(--blue)
}

.inventory-grid{
   display:grid;
   grid-template-columns:repeat(2,minmax(0,1fr));
   gap:9px;
   margin-bottom:13px
}

.inventory-stat{
   padding:10px 11px;
   border-radius:10px;
   background:var(--card2)
}

.inventory-stat .info-label{
   margin-bottom:4px
}

.inventory-stat .info-value{
   font-size:14px
}

.bar{
   width:100%;
   height:9px;
   border-radius:999px;
   background:#26313b;
   overflow:hidden;
   margin-top:6px
}

.bar > span{
   display:block;
   height:100%;
   width:0%;
   transition:width .2s ease
}

.health-bar > span{
   background:var(--red)
}

.hunger-bar > span{
   background:var(--yellow)
}

.equipment-row{
   display:grid;
   grid-template-columns:repeat(5,minmax(0,1fr));
   gap:7px;
   margin-bottom:12px
}

.equipment-slot{
   min-width:0;
   min-height:70px;
   border:1px solid var(--border);
   border-radius:9px;
   background:#0d1319;
   display:flex;
   flex-direction:column;
   align-items:center;
   justify-content:center;
   text-align:center;
   padding:6px;
   cursor:pointer
}

.equipment-slot.dragover,
.inventory-slot.dragover{
   border-color:var(--blue);
   box-shadow:0 0 0 1px var(--blue) inset
}

.equipment-slot .equip-label{
   color:var(--muted);
   font-size:9px;
   margin-bottom:4px
}

.inventory-area{
   margin-top:12px
}

.slot-grid{
   display:grid;
   grid-template-columns:repeat(9,minmax(0,1fr));
   gap:5px
}

.inventory-slot{
   min-width:0;
   min-height:55px;
   padding:5px 4px;
   border:1px solid var(--border);
   border-radius:8px;
   background:#0d1319;
   display:flex;
   flex-direction:column;
   align-items:center;
   justify-content:center;
   text-align:center;
   overflow:hidden;
   cursor:grab;
   user-select:none
}

.inventory-slot:active{
   cursor:grabbing
}

.inventory-slot.selected{
   border-color:var(--green);
   box-shadow:0 0 0 1px var(--green) inset
}

.inventory-slot.empty{
   opacity:.7
}

.slot-index{
   color:var(--muted);
   font-size:9px;
   margin-bottom:3px
}

.slot-name{
   font-size:9px;
   line-height:1.2;
   word-break:break-word
}

.slot-count{
   font-size:10px;
   margin-top:3px
}

.inventory-list{
   display:grid;
   gap:5px;
   max-height:180px;
   overflow:auto;
   margin-top:9px
}

.inventory-item-row{
   display:flex;
   align-items:center;
   justify-content:space-between;
   gap:10px;
   padding:7px 9px;
   border-radius:8px;
   background:var(--card2);
   font-size:11px
}

.inventory-item-name{
   min-width:0;
   overflow:hidden;
   text-overflow:ellipsis;
   white-space:nowrap
}

.chat-panel{
   display:flex;
   flex-direction:column
}

.chat-log{
   height:310px
}

.chat-form{
   margin-top:10px
}

.chat-title-row{
   display:flex;
   justify-content:space-between;
   align-items:center;
   gap:8px
}

.revision{
   color:var(--muted);
   font-size:10px
}

.drop-zone{
   margin-top:12px;
   min-height:48px;
   border:1px dashed var(--border);
   border-radius:10px;
   background:#0d1319;
   color:var(--muted);
   display:flex;
   align-items:center;
   justify-content:center;
   text-align:center;
   padding:10px;
   transition:
      border-color .15s ease,
      background .15s ease
}

.drop-zone.dragover{
   border-color:var(--red);
   background:#241416;
   color:var(--text)
}

.position-value{
   font-variant-numeric:tabular-nums
}

@media(max-width:520px){
   .inventory-grid{
     grid-template-columns:1fr
   }

   .equipment-row{
     grid-template-columns:repeat(5,minmax(48px,1fr))
   }
}

@media(max-width:820px){
  .grid{
    grid-template-columns:1fr
  }
}
</style>
</head>

<body>

<div class="app">

<section class="detail active">

  <div class="topbar">

    <div>

      <div
        id="detailTitle"
        class="detail-title"
      >
        ${BOT_LABEL}
      </div>

      <div
        class="detail-subtitle"
      >
        Quản lý và theo dõi bot
      </div>

    </div>

  </div>

  <div class="grid">

    <div class="panel">

      <h3>Trạng thái</h3>

      <div
        id="detailStatus"
        class="big-status"
      ></div>

      <div class="info">

        <div class="info-item">
          <div class="info-label">
            USERNAME
          </div>

          <div
            id="detailUsername"
            class="info-value"
          >
            -
          </div>
        </div>

        <div class="info-item">
          <div class="info-label">
            SERVER
          </div>

          <div
            id="detailHost"
            class="info-value"
          >
            -
          </div>
        </div>

        <div class="info-item">
          <div class="info-label">
            PING
          </div>

          <div
            id="detailPing"
            class="info-value"
          >
            -
          </div>
        </div>

        <div class="info-item">
          <div class="info-label">
            UPTIME
          </div>

          <div
            id="detailUptime"
            class="info-value"
          >
            0h 0m 0s
          </div>
        </div>

        <div class="info-item">
          <div class="info-label">
            RECONNECTS
          </div>

          <div
            id="detailReconnects"
            class="info-value"
          >
            0
          </div>
        </div>

        <div class="info-item">
          <div class="info-label">
            COORDINATES
          </div>

          <div
            id="detailPosition"
            class="info-value position-value"
          >
            -
          </div>
        </div>

        <div class="info-item">
          <div class="info-label">
            DIMENSION
          </div>

          <div
            id="detailDimension"
            class="info-value"
          >
            -
          </div>
        </div>
      </div>

      <div class="controls">

        <button
          id="startButton"
          class="primary"
          onclick="startBot()"
        >
          ▶ Chạy
        </button>

        <button
          id="stopButton"
          class="danger"
          onclick="stopBot()"
        >
          ■ Dừng
        </button>

        <button
          id="restartButton"
          onclick="restartBot()"
        >
          ↻ Chạy lại
        </button>

      </div>

    </div>

    <div class="panel">

      <div class="chat-title-row">
        <h3>Chat</h3>
        <div id="chatRevision" class="revision">revision 0</div>
      </div>

      <div
        id="chatLogs"
        class="log chat-log"
      ></div>

      <form
        class="chat-row chat-form"
        onsubmit="sendMessage(event)"
      >

        <input
          id="messageInput"
          autocomplete="off"
          placeholder="Nhập chat hoặc command..."
        >

        <button
          class="primary"
          type="submit"
        >
          Gửi
        </button>

      </form>

      <div class="note">
        Tin nhắn Minecraft và tin gửi từ web được tách riêng khỏi Event Log.
      </div>

    </div>

    <div class="panel">

      <div class="chat-title-row">
        <h3>Event Log</h3>
        <div id="eventRevision" class="revision">revision 0</div>
      </div>

      <div
        id="logs"
        class="log"
      ></div>

    </div>

    <div class="panel">

      <div class="chat-title-row">
        <h3>Inventory Manager</h3>
        <div id="inventoryRevision" class="revision">revision 0</div>
      </div>

      <div class="inventory-grid">

        <div class="inventory-stat">
          <div class="info-label">HEALTH</div>
          <div id="inventoryHealth" class="info-value">20 / 20</div>
          <div class="bar health-bar"><span id="inventoryHealthBar"></span></div>
        </div>

        <div class="inventory-stat">
          <div class="info-label">HUNGER</div>
          <div id="inventoryFood" class="info-value">20 / 20</div>
          <div class="bar hunger-bar"><span id="inventoryFoodBar"></span></div>
        </div>

        <div class="inventory-stat">
          <div class="info-label">GOLDEN APPLE</div>
          <div id="inventoryGoldenApple" class="info-value">0</div>
        </div>

        <div class="inventory-stat">
          <div class="info-label">TOTEM</div>
          <div id="inventoryTotem" class="info-value">0</div>
        </div>

        <div class="inventory-stat">
          <div class="info-label">OFFHAND</div>
          <div id="inventoryOffhand" class="info-value">-</div>
        </div>

        <div class="inventory-stat">
          <div class="info-label">FOOD COUNT</div>
          <div id="inventoryFoodCount" class="info-value">0</div>
        </div>

      </div>

      <div class="info-label">EQUIPMENT / OFFHAND</div>

      <div class="equipment-row">

        <div
          class="equipment-slot"
          data-destination="head"
          draggable="true"
          ondragstart="startEquipmentDrag(event,'head')"
          ondragover="allowDrop(event)"
          ondragleave="clearDragOver(event)"
          ondrop="dropEquip(event,'head')"
          ondblclick="unequipEquipment('head')"
        >
          <div class="equip-label">HEAD</div>
          <div id="equipHead">-</div>
        </div>

        <div
          class="equipment-slot"
          data-destination="torso"
          draggable="true"
          ondragstart="startEquipmentDrag(event,'torso')"
          ondragover="allowDrop(event)"
          ondragleave="clearDragOver(event)"
          ondrop="dropEquip(event,'torso')"
          ondblclick="unequipEquipment('torso')"
        >
          <div class="equip-label">CHEST</div>
          <div id="equipTorso">-</div>
        </div>

        <div
          class="equipment-slot"
          data-destination="legs"
          draggable="true"
          ondragstart="startEquipmentDrag(event,'legs')"
          ondragover="allowDrop(event)"
          ondragleave="clearDragOver(event)"
          ondrop="dropEquip(event,'legs')"
          ondblclick="unequipEquipment('legs')"
        >
          <div class="equip-label">LEGS</div>
          <div id="equipLegs">-</div>
        </div>

        <div
          class="equipment-slot"
          data-destination="feet"
          draggable="true"
          ondragstart="startEquipmentDrag(event,'feet')"
          ondragover="allowDrop(event)"
          ondragleave="clearDragOver(event)"
          ondrop="dropEquip(event,'feet')"
          ondblclick="unequipEquipment('feet')"
        >
          <div class="equip-label">FEET</div>
          <div id="equipFeet">-</div>
        </div>

        <div
          class="equipment-slot"
          data-destination="off-hand"
          draggable="true"
          ondragstart="startEquipmentDrag(event,'off-hand')"
          ondragover="allowDrop(event)"
          ondragleave="clearDragOver(event)"
          ondrop="dropEquip(event,'off-hand')"
          ondblclick="unequipEquipment('off-hand')"
        >
          <div class="equip-label">OFFHAND</div>
          <div id="equipOffhand">-</div>
        </div>

      </div>

      <div class="info-label">INVENTORY 27 SLOTS</div>
      <div id="mainInventory" class="slot-grid inventory-area"></div>

      <div class="info-label" style="margin-top:12px;">HOTBAR 9 SLOTS</div>
      <div id="inventoryHotbar" class="slot-grid inventory-area"></div>

      <div
        id="dropZone"
        class="drop-zone"
        ondragover="allowDrop(event)"
        ondragleave="clearDragOver(event)"
        ondrop="dropItemToWorld(event)"
      >
        Kéo item vào đây để vứt
      </div>

      <div class="note">
        Kéo-thả item để di chuyển. Kéo item vào Head/Chest/Legs/Feet/Offhand để trang bị.
        Click hotbar để chọn slot. Double-click ô trang bị để tháo.
        Inventory được đồng bộ với bot mỗi 1 giây và dùng revision để tránh thao tác trên dữ liệu cũ.
      </div>

    </div>

    <div class="panel">

      <h3>Tài khoản</h3>

      <div class="form-row">

        <label>
          Username
        </label>

        <input
          id="usernameInput"
          autocomplete="off"
          placeholder="Username mới (có thể để trống)"
        >

      </div>

      <div class="form-row">

        <label>
          Password
        </label>

        <input
          id="passwordInput"
          type="password"
          autocomplete="new-password"
          placeholder="Password mới (có thể để trống)"
        >

      </div>

      <button
        class="primary"
        onclick="saveAccount()"
      >
        Lưu thay đổi
      </button>

      <div class="note">
        Có thể đổi username hoặc password riêng lẻ.
        Bấm "Chạy lại" để áp dụng tài khoản mới.
      </div>

    </div>

  </div>

</section>

</div>

<div
  id="toast"
  class="toast"
></div>

<script>

let bot = null;
let inventory = null;

let lastLogRevision = -1;
let lastChatRevision = -1;

let logRequestInFlight = false;
let chatRequestInFlight = false;

let uptimeSyncAt = Date.now();

let draggedSlot = null;
let inventoryActionInFlight = false;
let refreshInFlight = false;

function statusMeta(status) {

  const map = {

    online:[
      'green',
      'ONLINE'
    ],

    afk:[
      'green',
      'AFK'
    ],

    connecting:[
      'yellow',
      'CONNECTING'
    ],

    authenticating:[
      'blue',
      'AUTH'
    ],

    entering:[
      'blue',
      'ENTERING SERVER'
    ],

    kicked:[
      'red',
      'KICKED'
    ],

    offline:[
      'red',
      'OFFLINE'
    ]

  };

  return (
    map[status] ||
    ['red','OFFLINE']
  );
}

async function getBot() {

  const response =
    await fetch(
      '/api/bot',
      {
        cache:'no-store'
      }
    );

  if (!response.ok) {
    throw new Error(
      'Không lấy được trạng thái bot.'
    );
  }

  bot =
    await response.json();

  uptimeSyncAt =
    Date.now();

  return bot;
}

async function getInventory() {

  const response =
    await fetch(
      '/api/inventory',
      {
        cache:'no-store'
      }
    );

  if (!response.ok) {
    throw new Error(
      'Không lấy được inventory.'
    );
  }

  inventory =
    await response.json();

  return inventory;
}

function formatInventoryName(name) {

  if (!name) {
    return '-';
  }

  return String(name)
    .replace(/_/g, ' ');
}

function itemLabel(item) {

  if (!item) {
    return '-';
  }

  const name =
    item.displayName ||
    item.name ||
    '-';

  const count =
    Number(item.count || 0);

  return count > 1
    ? formatInventoryName(name) + ' x' + count
    : formatInventoryName(name);
}

function createInventorySlotElement(
  item,
  slot,
  selected
) {

  const element =
    document.createElement('div');

  element.className =
    'inventory-slot' +
    (
      selected
        ? ' selected'
        : ''
    ) +
    (
      item
        ? ''
        : ' empty'
    );

  element.draggable =
    !!item;

  element.dataset.slot =
    String(slot);

  element.ondragstart =
    function(event) {
      draggedSlot =
        slot;

      try {
        event.dataTransfer.setData(
          'text/plain',
          String(slot)
        );
        event.dataTransfer.effectAllowed =
          'move';
      } catch (_) {
      }
    };

  element.ondragover =
    allowDrop;

  element.ondragleave =
    clearDragOver;

  element.ondrop =
    function(event) {
      dropInventory(
        event,
        slot
      );
    };

  element.onclick =
    function() {

      if (
        slot >= 36 &&
        slot <= 44
      ) {
        selectHotbar(
          slot - 36
        );
      }
    };

  const index =
    document.createElement('div');

  index.className =
    'slot-index';

  if (
    slot >= 36 &&
    slot <= 44
  ) {
    index.textContent =
      String(slot - 35);
  } else if (
    slot >= 9 &&
    slot <= 35
  ) {
    index.textContent =
      String(slot - 8);
  } else {
    index.textContent =
      String(slot);
  }

  const name =
    document.createElement('div');

  name.className =
    'slot-name';

  name.textContent =
    itemLabel(item);

  const count =
    document.createElement('div');

  count.className =
    'slot-count';

  count.textContent =
    item && Number(item.count || 0) > 1
      ? String(item.count)
      : '';

  element.appendChild(
    index
  );

  element.appendChild(
    name
  );

  element.appendChild(
    count
  );

  return element;
}

function renderEquipment(inventoryData) {

  const armor =
    inventoryData.armor || {};

  document.getElementById('equipHead').textContent =
    itemLabel(armor.head);

  document.getElementById('equipTorso').textContent =
    itemLabel(armor.torso);

  document.getElementById('equipLegs').textContent =
    itemLabel(armor.legs);

  document.getElementById('equipFeet').textContent =
    itemLabel(armor.feet);

  document.getElementById('equipOffhand').textContent =
    itemLabel(
      inventoryData.slots
        ? inventoryData.slots['45']
        : null
    );
}

function renderInventory() {

  if (!inventory) {
    return;
  }

  const health =
    Math.max(
      0,
      Math.min(
        20,
        Number(inventory.health || 0)
      )
    );

  const food =
    Math.max(
      0,
      Math.min(
        20,
        Number(inventory.food || 0)
      )
    );

  document.getElementById('inventoryHealth').textContent =
    health.toFixed(1) + ' / 20';

  document.getElementById('inventoryFood').textContent =
    String(food) + ' / 20';

  document.getElementById('inventoryHealthBar').style.width =
    String(
      (health / 20) * 100
    ) + '%';

  document.getElementById('inventoryFoodBar').style.width =
    String(
      (food / 20) * 100
    ) + '%';

  document.getElementById('inventoryGoldenApple').textContent =
    String(
      inventory.goldenAppleCount || 0
    );

  document.getElementById('inventoryTotem').textContent =
    String(
      inventory.totemCount || 0
    );

  document.getElementById('inventoryFoodCount').textContent =
    String(
      inventory.foodCount || 0
    );

  document.getElementById('inventoryOffhand').textContent =
    formatInventoryName(
      inventory.offhand
    );

  document.getElementById('inventoryRevision').textContent =
    'revision ' +
    String(
      inventory.revision || 0
    );

  renderEquipment(
    inventory
  );

  const slots =
    inventory.slots || {};

  const mainInventory =
    document.getElementById(
      'mainInventory'
    );

  mainInventory.innerHTML = '';

  for (
    let slot = 9;
    slot <= 35;
    slot++
  ) {

    const item =
      slots[String(slot)] ||
      null;

    mainInventory.appendChild(
      createInventorySlotElement(
        item,
        slot,
        false
      )
    );
  }

  const hotbar =
    document.getElementById(
      'inventoryHotbar'
    );

  hotbar.innerHTML = '';

  const selected =
    Number(
      inventory.selectedHotbar ??
      inventory.selectedSlot ??
      0
    );

  for (
    let slot = 36;
    slot <= 44;
    slot++
  ) {

    const item =
      slots[String(slot)] ||
      null;

    hotbar.appendChild(
      createInventorySlotElement(
        item,
        slot,
        (slot - 36) === selected
      )
    );
  }
}

function startEquipmentDrag(event, destination) {
  const slotMap = {
    head: 5,
    torso: 6,
    legs: 7,
    feet: 8,
    'off-hand': 45
  };

  const slot = slotMap[destination];

  if (!Number.isInteger(slot)) {
    return;
  }

  draggedSlot = slot;

  try {
    event.dataTransfer.setData(
      'text/plain',
      String(slot)
    );
    event.dataTransfer.effectAllowed = 'move';
  } catch (_) {
  }
}

function equipmentDestinationFromSlot(slot) {
  if (slot === 5) return 'head';
  if (slot === 6) return 'torso';
  if (slot === 7) return 'legs';
  if (slot === 8) return 'feet';
  if (slot === 45) return 'off-hand';
  return null;
}

function allowDrop(event) {

  event.preventDefault();

  try {
    event.dataTransfer.dropEffect =
      'move';
  } catch (_) {
  }

  if (
    event.currentTarget &&
    event.currentTarget.classList
  ) {
    event.currentTarget.classList.add(
      'dragover'
    );
  }
}

function clearDragOver(event) {

  if (
    event.currentTarget &&
    event.currentTarget.classList
  ) {
    event.currentTarget.classList.remove(
      'dragover'
    );
  }
}

async function dropInventory(
  event,
  destinationSlot
) {

  event.preventDefault();

  clearDragOver(event);

  let sourceSlot =
    draggedSlot;

  try {

    const fromData =
      event.dataTransfer.getData(
        'text/plain'
      );

    if (
      fromData !== ''
    ) {
      sourceSlot =
        Number(fromData);
    }

  } catch (_) {
  }

  draggedSlot = null;

  if (
    !Number.isInteger(sourceSlot) ||
    sourceSlot === destinationSlot
  ) {
    return;
  }

  const equipmentDestination =
    equipmentDestinationFromSlot(sourceSlot);

  if (equipmentDestination) {
    await unequipEquipment(
      equipmentDestination
    );
    return;
  }

  await moveInventoryItem(
    sourceSlot,
    destinationSlot
  );
}

async function dropItemToWorld(
  event
) {
  event.preventDefault();

  clearDragOver(event);

  let sourceSlot =
    draggedSlot;

  try {
    const fromData =
      event.dataTransfer.getData(
        'text/plain'
      );

    if (
      fromData !== ''
    ) {
      sourceSlot =
        Number(fromData);
    }
  } catch (_) {
  }

  draggedSlot = null;

  if (
    !Number.isInteger(sourceSlot)
  ) {
    return;
  }

  await dropInventoryItem(
    sourceSlot
  );
}

async function dropInventoryItem(
  sourceSlot
) {
  if (
    inventoryActionInFlight
  ) {
    showToast(
      'Đang thực hiện thao tác inventory khác.'
    );
    return;
  }

  if (!inventory) {
    return;
  }

  inventoryActionInFlight = true;

  try {
    const response =
      await fetch(
        '/api/inventory/drop',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body: JSON.stringify({
            sourceSlot,
            revision:
              inventory.revision
          })
        }
      );

    const data =
      await response.json();

    if (
      data.inventory
    ) {
      inventory =
        data.inventory;

      renderInventory();
    }

    if (!response.ok) {
      showToast(
        data.error ||
        'Không thể vứt item.'
      );

      await refreshInventoryOnly();
      return;
    }

    showToast(
      data.message ||
      'Đã vứt item.'
    );
  } catch (_) {
    showToast(
      'Không thể kết nối tới server web.'
    );
  } finally {
    inventoryActionInFlight =
      false;
  }
}

async function moveInventoryItem(
  sourceSlot,
  destSlot
) {

  if (
    inventoryActionInFlight
  ) {
    showToast(
      'Đang thực hiện thao tác inventory khác.'
    );
    return;
  }

  if (!inventory) {
    return;
  }

  inventoryActionInFlight =
    true;

  try {

    const response =
      await fetch(
        '/api/inventory/move',
        {
          method:'POST',

          headers:{
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              sourceSlot,
              destSlot,
              revision:
                inventory.revision
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      if (
        data.inventory
      ) {
        inventory =
          data.inventory;

        renderInventory();
      }

      showToast(
        data.error ||
        'Di chuyển thất bại.'
      );

      await refreshInventoryOnly();

      return;
    }

    if (
      data.inventory
    ) {
      inventory =
        data.inventory;

      renderInventory();
    }

    showToast(
      data.message ||
      'Đã di chuyển item.'
    );

  } catch (_) {

    showToast(
      'Không thể kết nối tới server web.'
    );

  } finally {

    inventoryActionInFlight =
      false;
  }
}

async function dropEquip(
  event,
  destination
) {

  event.preventDefault();

  clearDragOver(event);

  let sourceSlot =
    draggedSlot;

  try {

    const fromData =
      event.dataTransfer.getData(
        'text/plain'
      );

    if (
      fromData !== ''
    ) {
      sourceSlot =
        Number(fromData);
    }

  } catch (_) {
  }

  draggedSlot = null;

  if (
    !Number.isInteger(sourceSlot)
  ) {
    return;
  }

  await equipInventoryItem(
    sourceSlot,
    destination
  );
}

async function equipInventoryItem(
  sourceSlot,
  destination
) {

  if (
    inventoryActionInFlight
  ) {
    showToast(
      'Đang thực hiện thao tác inventory khác.'
    );
    return;
  }

  if (!inventory) {
    return;
  }

  inventoryActionInFlight =
    true;

  try {

    const response =
      await fetch(
        '/api/inventory/equip',
        {
          method:'POST',

          headers:{
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              sourceSlot,
              destination,
              revision:
                inventory.revision
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      if (
        data.inventory
      ) {
        inventory =
          data.inventory;

        renderInventory();
      }

      showToast(
        data.error ||
        'Trang bị thất bại.'
      );

      await refreshInventoryOnly();

      return;
    }

    if (
      data.inventory
    ) {
      inventory =
        data.inventory;

      renderInventory();
    }

    showToast(
      data.message ||
      'Đã trang bị item.'
    );

  } catch (_) {

    showToast(
      'Không thể kết nối tới server web.'
    );

  } finally {

    inventoryActionInFlight =
      false;
  }
}

async function unequipEquipment(
  destination
) {

  if (
    inventoryActionInFlight
  ) {
    showToast(
      'Đang thực hiện thao tác inventory khác.'
    );
    return;
  }

  if (!inventory) {
    return;
  }

  inventoryActionInFlight =
    true;

  try {

    const response =
      await fetch(
        '/api/inventory/unequip',
        {
          method:'POST',

          headers:{
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              destination,
              revision:
                inventory.revision
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      if (
        data.inventory
      ) {
        inventory =
          data.inventory;

        renderInventory();
      }

      showToast(
        data.error ||
        'Tháo trang bị thất bại.'
      );

      await refreshInventoryOnly();

      return;
    }

    if (
      data.inventory
    ) {
      inventory =
        data.inventory;

      renderInventory();
    }

    showToast(
      data.message ||
      'Đã tháo trang bị.'
    );

  } catch (_) {

    showToast(
      'Không thể kết nối tới server web.'
    );

  } finally {

    inventoryActionInFlight =
      false;
  }
}

async function selectHotbar(slot) {

  if (
    inventoryActionInFlight
  ) {
    return;
  }

  if (!inventory) {
    return;
  }

  inventoryActionInFlight =
    true;

  try {

    const response =
      await fetch(
        '/api/inventory/select',
        {
          method:'POST',

          headers:{
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              slot,
              revision:
                inventory.revision
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      if (
        data.inventory
      ) {
        inventory =
          data.inventory;

        renderInventory();
      }

      showToast(
        data.error ||
        'Không thể chọn hotbar.'
      );

      await refreshInventoryOnly();

      return;
    }

    if (
      data.inventory
    ) {
      inventory =
        data.inventory;

      renderInventory();
    }

  } catch (_) {

    showToast(
      'Không thể kết nối tới server web.'
    );

  } finally {

    inventoryActionInFlight =
      false;
  }
}

async function refreshInventoryOnly() {

  try {

    await getInventory();

    renderInventory();

  } catch (_) {

  }
}

function renderDetail() {

  if (!bot) return;

  const [
    color,
    label
  ] = statusMeta(
    bot.status
  );

  document
    .getElementById(
      'detailStatus'
    )
    .innerHTML =
      '<span class="dot ' +
      color +
      '"></span>' +
      label;

  document
    .getElementById(
      'detailUsername'
    )
    .textContent =
      bot.username ||
      'Chưa đặt';

  document
    .getElementById(
      'detailHost'
    )
    .textContent =
      (bot.host || '-') +
      ':' +
      bot.port;

  document
    .getElementById(
      'detailPing'
    )
    .textContent =
      bot.ping == null
        ? '--'
        : bot.ping +
          ' ms';

  document
    .getElementById(
      'detailUptime'
    )
    .textContent =
      bot.uptime ||
      '0h 0m 0s';

  document
    .getElementById(
      'detailReconnects'
    )
    .textContent =
      String(
        bot.reconnectCount ?? 0
      );

  const positionElement =
    document.getElementById(
      'detailPosition'
    );

  if (positionElement) {
    const position =
      bot.position;

    positionElement.textContent =
      position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      Number.isFinite(position.z)
        ? String(position.x.toFixed(2)) +
          ' ' +
          String(position.y.toFixed(2)) +
          ' ' +
          String(position.z.toFixed(2))
        : '-';
  }

  const dimensionElement =
    document.getElementById(
      'detailDimension'
    );

  if (dimensionElement) {
    dimensionElement.textContent =
      bot.dimension || '-';
  }

  document
    .getElementById(
      'startButton'
    )
    .disabled =
      ![
        'offline',
        'kicked'
      ].includes(
        bot.status
      );

  document
    .getElementById(
      'stopButton'
    )
    .disabled =
      bot.status ===
      'offline';

  document
    .getElementById(
      'restartButton'
    )
    .disabled =
      bot.status ===
      'offline';
}

function isNearLogBottom(box) {

  return (
    box.scrollHeight -
    box.scrollTop -
    box.clientHeight
  ) < 24;
}

async function loadLogs(
  force = false
) {

  if (
    logRequestInFlight
  ) {
    return;
  }

  if (
    !force &&
    bot &&
    bot.logRevision ===
      lastLogRevision
  ) {
    return;
  }

  logRequestInFlight = true;

  try {

    const response =
      await fetch(
        '/api/bot/logs?revision=' +
        (
          bot?.logRevision ??
          -1
        ),
        {
          cache:'no-store'
        }
      );

    if (!response.ok) {
      return;
    }

    const data =
      await response.json();

    const box =
      document.getElementById(
        'logs'
      );

    const keepAtBottom =
      isNearLogBottom(box);

    if (!data.logs.length) {

      box.innerHTML = '';

      lastLogRevision =
        data.revision ?? 0;

      document.getElementById(
        'eventRevision'
      ).textContent =
        'revision ' +
        String(
          data.revision ?? 0
        );

      return;
    }

    box.innerHTML =
      data.logs
        .map(
          line =>
            '<div class="line">' +
            escapeHtml(line) +
            '</div>'
        )
        .join('');

    lastLogRevision =
      data.revision ??
      lastLogRevision;

    document.getElementById(
      'eventRevision'
    ).textContent =
      'revision ' +
      String(
        data.revision ?? 0
      );

    if (keepAtBottom) {
      box.scrollTop =
        box.scrollHeight;
    }

  } catch (_) {

  } finally {

    logRequestInFlight =
      false;

  }
}

async function loadChatLogs(
  force = false
) {

  if (
    chatRequestInFlight
  ) {
    return;
  }

  if (
    !force &&
    lastChatRevision >= 0 &&
    bot &&
    bot.chatLogRevision ===
      lastChatRevision
  ) {
    return;
  }

  chatRequestInFlight = true;

  try {

    const response =
      await fetch(
        '/api/bot/chat-logs',
        {
          cache:'no-store'
        }
      );

    if (!response.ok) {
      return;
    }

    const data =
      await response.json();

    const box =
      document.getElementById(
        'chatLogs'
      );

    const keepAtBottom =
      isNearLogBottom(box);

    box.innerHTML =
      Array.isArray(data.logs)
        ? data.logs
            .map(
              line =>
                '<div class="line">' +
                escapeHtml(line) +
                '</div>'
            )
            .join('')
        : '';

    lastChatRevision =
      data.revision ??
      lastChatRevision;

    document.getElementById(
      'chatRevision'
    ).textContent =
      'revision ' +
      String(
        data.revision ?? 0
      );

    if (keepAtBottom) {
      box.scrollTop =
        box.scrollHeight;
    }

  } catch (_) {

  } finally {

    chatRequestInFlight =
      false;

  }
}

function escapeHtml(value) {

  return String(
    value ?? ''
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );
}

async function refresh() {

  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;

  try {

    await getBot();

    renderDetail();

    await getInventory();

    renderInventory();

    await loadLogs();

    await loadChatLogs();

  } catch (_) {

  } finally {

    refreshInFlight = false;
  }
}

async function postAction(
  url,
  fallback
) {

  try {

    const response =
      await fetch(
        url,
        {
          method:'POST'
        }
      );

    const data =
      await response.json();

    showToast(
      data.message ||
      data.error ||
      fallback
    );

    await refresh();

  } catch (_) {

    showToast(
      'Không thể kết nối tới server web.'
    );

  }
}

async function startBot() {

  await postAction(
    '/api/bot/start',
    'Done'
  );

}

async function stopBot() {

  await postAction(
    '/api/bot/stop',
    'Done'
  );

}

async function restartBot() {

  await postAction(
    '/api/bot/restart',
    'Done'
  );

}

async function sendMessage(event) {

  event.preventDefault();

  const input =
    document.getElementById(
      'messageInput'
    );

  const text =
    input.value;

  if (!text.trim()) {
    return;
  }

  try {

    const response =
      await fetch(
        '/api/bot/send',
        {
          method:'POST',

          headers:{
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              text
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      showToast(
        data.error ||
        'Gửi thất bại.'
      );

      return;
    }

    input.value = '';

    showToast(
      'Đã gửi.'
    );

    await getBot();

    await loadChatLogs(true);

  } catch (_) {

    showToast(
      'Không thể kết nối tới server web.'
    );

  }
}

async function saveAccount() {

  const username =
    document
      .getElementById(
        'usernameInput'
      )
      .value
      .trim();

  const password =
    document
      .getElementById(
        'passwordInput'
      )
      .value;

  if (!username && !password) {
    showToast(
      'Nhập username hoặc password cần thay đổi.'
    );
    return;
  }

  try {

    const response =
      await fetch(
        '/api/bot/account',
        {
          method:'POST',

          headers:{
            'Content-Type':
              'application/json'
          },

          body: JSON.stringify({
            username,
            password
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      showToast(
        data.error ||
        'Lưu thất bại.'
      );
      return;
    }

    document
      .getElementById(
        'usernameInput'
      )
      .value = '';

    document
      .getElementById(
        'passwordInput'
      )
      .value = '';

    showToast(
      data.message ||
      'Đã lưu thay đổi. Bấm "Chạy lại" để áp dụng.'
    );

    await refresh();

  } catch (_) {

    showToast(
      'Không thể kết nối tới server web.'
    );

  }
}

function showToast(message) {

  const toast =
    document.getElementById(
      'toast'
    );

  toast.textContent =
    message;

  toast.style.display =
    'block';

  clearTimeout(
    showToast.timer
  );

  showToast.timer =
    setTimeout(() => {
      toast.style.display =
        'none';
    }, 2200);
}

(async function init() {

  await refresh();

})();

setInterval(
  refresh,
  1000
);

function updateUptimeDisplay() {

  if (!bot) {
    return;
  }

  const syncedSeconds =
    Number(
      bot.uptimeSeconds || 0
    );

  const elapsedSinceSync =
    bot.status === 'afk'
      ? Math.floor(
          (Date.now() - uptimeSyncAt) / 1000
        )
      : 0;

  const uptimeSeconds =
    Math.min(
      syncedSeconds + elapsedSinceSync,
      (999 * 60 * 60) - 1
    );

  const hours =
    Math.floor(
      uptimeSeconds / 3600
    );

  const minutes =
    Math.floor(
      (uptimeSeconds % 3600) / 60
    );

  const seconds =
    uptimeSeconds % 60;

  const element =
    document.getElementById(
      'detailUptime'
    );

  if (element) {
    element.textContent =
      hours + 'h ' +
      minutes + 'm ' +
      seconds + 's';
  }
}

setInterval(
  updateUptimeDisplay,
  250
);

</script>

</body>
</html>`;

// -----------------------------------------------------------------------------
// API: node identity / central dashboard capability discovery
// -----------------------------------------------------------------------------

app.get(
    '/api/node',
    (req, res) => {
        res.json({
            ok: true,
            botId: BOT_ID,
            id: BOT_ID_NUMBER,
            label: BOT_LABEL,
            protocol: 2,
            api: {
                status: '/api/bot',
                node: '/api/node',
                eventLogs: '/api/bot/logs',
                chatLogs: '/api/bot/chat-logs',
                inventory: '/api/inventory',
                health: '/health',
                lightweightStatus: '/api/status',
                start: '/api/bot/start',
                stop: '/api/bot/stop',
                restart: '/api/bot/restart',
                send: '/api/bot/send',
                account: '/api/bot/account',
                moveInventory: '/api/inventory/move',
                equip: '/api/inventory/equip',
                unequip: '/api/inventory/unequip',
                selectHotbar: '/api/inventory/select',
                dropInventory: '/api/inventory/drop'
            }
        });
    }
);

// -----------------------------------------------------------------------------
// API: current bot state
// -----------------------------------------------------------------------------

app.get(
    '/api/bot',
    (req, res) => {
        res.json(
            publicBotState(
                botState
            )
        );
    }
);

// -----------------------------------------------------------------------------
// API: logs
// Revision allows the web client to skip unnecessary log re-renders.
// -----------------------------------------------------------------------------

app.get(
    '/api/bot/logs',
    (req, res) => {
        res.json({
            id: botState.id,
            revision: botState.logRevision,
            logs: botState.logs
        });
    }
);

// -----------------------------------------------------------------------------
// Chat logs
// -----------------------------------------------------------------------------

app.get(
    '/api/bot/chat-logs',
    (req, res) => {
        res.json({
            id: botState.id,
            revision: botState.chatLogRevision,
            logs: botState.chatLogs
        });
    }
);

// -----------------------------------------------------------------------------
// Start bot
// -----------------------------------------------------------------------------

app.post(
    '/api/bot/start',
    (req, res) => {

        if (
            !botState.username ||
            !botState.password
        ) {
            return res.status(400).json({
                error:
                    'Bot chưa có username/password.'
            });
        }

        if (
            botState.status !== 'offline' &&
            botState.status !== 'kicked'
        ) {
            return res.json({
                ok: true,
                message:
                    `${BOT_LABEL} đang chạy.`
            });
        }

        startBot(
            botState
        );

        res.json({
            ok: true,
            message:
                `${BOT_LABEL} đã chạy.`
        });
    }
);

// -----------------------------------------------------------------------------
// Stop bot
// -----------------------------------------------------------------------------

app.post(
    '/api/bot/stop',
    (req, res) => {

        stopBot(
            botState
        );

        res.json({
            ok: true,
            message:
                `${BOT_LABEL} đã dừng.`
        });
    }
);

// -----------------------------------------------------------------------------
// Restart bot
// Luôn chạy lại flow:
// connect -> /dn -> /menu -> slot 24
// -----------------------------------------------------------------------------

app.post(
    '/api/bot/restart',
    (req, res) => {

        if (
            !botState.username ||
            !botState.password
        ) {
            return res.status(400).json({
                error:
                    'Bot chưa có username/password.'
            });
        }

        // "Chạy lại" resets AFK uptime and reconnect count.
        updateAfkUptime(botState);
        botState.afkElapsedSeconds = 0;
        botState.afkStartedAt = null;
        botState.reconnectCount = 0;

        botState.manuallyStopped = true;

        disconnectBot(
            botState,
            'Restart from web panel'
        );

        const restartTimer =
            setTimeout(() => {

                botState.manuallyStopped =
                    false;

                startBot(
                    botState
                );

            }, 500);

        botState.afkTimers.push(
            restartTimer
        );

        res.json({
            ok: true,
            message:
                `${BOT_LABEL} đã chạy lại từ đầu.`
        });
    }
);

// -----------------------------------------------------------------------------
// Chat / command
// -----------------------------------------------------------------------------

app.post(
    '/api/bot/send',
    (req, res) => {

        const text =
            typeof req.body?.text ===
            'string'
                ? req.body.text
                : '';

        if (!text.trim()) {

            return res.status(400).json({
                error:
                    'Nội dung không được trống.'
            });

        }

        if (
            !botState.bot ||
            !botState.bot.player
        ) {

            return res.status(409).json({
                error:
                    `${BOT_LABEL} chưa online.`
            });

        }

        try {

            botState.bot.chat(
                text
            );

            botState.lastWebChatText =
                cleanMinecraftText(text);

            botState.lastWebChatAt =
                Date.now();

            addChatLog(
                botState,
                'WEB',
                `→ ${text}`
            );

            res.json({
                ok: true,
                message:
                    'Đã gửi.'
            });

        } catch (err) {

            res.status(500).json({
                error:
                    `Gửi thất bại: ${err.message}`
            });

        }
    }
);

// -----------------------------------------------------------------------------
// Update account
// Runtime only.
// ENV variables are not changed.
// -----------------------------------------------------------------------------

app.post(
    '/api/bot/account',
    (req, res) => {

        const username =
            typeof req.body?.username === 'string'
                ? req.body.username.trim()
                : '';

        const password =
            typeof req.body?.password === 'string'
                ? req.body.password
                : '';

        if (!username && !password) {
            return res.status(400).json({
                error:
                    'Nhập username hoặc password cần thay đổi.'
            });
        }

        const changed = [];

        if (username) {
            botState.username =
                username;
            changed.push('username');
        }

        if (password) {
            botState.password =
                password;
            changed.push('password');
        }

        addLog(
            botState,
            `Đã thay đổi ${changed.join(' + ')} từ web.`
        );

        res.json({
            ok: true,
            message:
                `Đã lưu ${changed.join(' + ')}.`
        });
    }
);

// -----------------------------------------------------------------------------
// Inventory API
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Inventory manager helpers
// -----------------------------------------------------------------------------

function validateInventoryRevision(state, requestedRevision) {
    const revision =
        Number(requestedRevision);

    if (
        !Number.isInteger(revision) ||
        revision !== Number(state.inventoryRevision)
    ) {
        return false;
    }

    return true;
}

function isValidPlayerInventorySlot(slot) {
    return (
        Number.isInteger(slot) &&
        slot >= 5 &&
        slot <= 45
    );
}

function canUseInventoryAction(state) {
    return (
        !state.manuallyStopped &&
        !!state.bot &&
        !!state.bot.player &&
        !!state.bot.inventory &&
        !state.bot.currentWindow &&
        state.status !== 'offline' &&
        state.status !== 'connecting' &&
        state.status !== 'authenticating' &&
        state.status !== 'entering' &&
        state.status !== 'kicked'
    );
}

async function finishInventoryAction(state, bot) {
    await new Promise(
        resolve => setTimeout(resolve, 120)
    );

    if (
        state.bot !== bot ||
        state.manuallyStopped
    ) {
        return;
    }

    scanInventory(
        state,
        bot,
        false
    );

    await new Promise(
        resolve => setTimeout(resolve, 80)
    );

    if (
        state.bot === bot &&
        !state.manuallyStopped
    ) {
        scanInventory(
            state,
            bot,
            false
        );
    }
}

app.get(
    '/api/inventory',
    (req, res) => {
        res.json(
            publicInventoryState(
                botState
            )
        );
    }
);

app.post(
    '/api/inventory/move',
    async (req, res) => {
        const sourceSlot =
            Number(req.body?.sourceSlot);

        const destSlot =
            Number(req.body?.destSlot);

        const requestedRevision =
            Number(req.body?.revision);

        if (
            !isValidPlayerInventorySlot(sourceSlot) ||
            !isValidPlayerInventorySlot(destSlot)
        ) {
            return res.status(400).json({
                error:
                    'Slot không hợp lệ.'
            });
        }

        if (sourceSlot === destSlot) {
            return res.json({
                ok: true,
                message:
                    'Không có thay đổi.'
            });
        }

        if (
            !validateInventoryRevision(
                botState,
                requestedRevision
            )
        ) {
            return res.status(409).json({
                error:
                    'Inventory đã thay đổi. Đang đồng bộ lại...',
                revision:
                    botState.inventoryRevision,
                inventory:
                    publicInventoryState(
                        botState
                    )
            });
        }

        if (
            botState.inventoryActionBusy
        ) {
            return res.status(409).json({
                error:
                    'Bot đang thực hiện thao tác inventory khác.'
            });
        }

        if (
            !canUseInventoryAction(botState)
        ) {
            return res.status(409).json({
                error:
                    'Bot chưa sẵn sàng thao tác inventory.'
            });
        }

        const bot =
            botState.bot;

        const sourceItem =
            bot.inventory.slots[sourceSlot] ||
            null;

        if (!sourceItem) {
            return res.status(400).json({
                error:
                    'Ô nguồn đang trống.'
            });
        }

        botState.inventoryActionBusy = true;

        try {
            const beforeSource =
                itemSummary(sourceItem);

            const beforeDest =
                itemSummary(
                    bot.inventory.slots[destSlot] ||
                    null
                );

            addLog(
                botState,
                `[INV] Web move: ${getSlotLabel(sourceSlot)} → ${getSlotLabel(destSlot)} | ${beforeSource}.`
            );

            await bot.moveSlotItem(
                sourceSlot,
                destSlot
            );

            await finishInventoryAction(
                botState,
                bot
            );

            addLog(
                botState,
                `[INV] Web move hoàn tất: ${getSlotLabel(sourceSlot)} → ${getSlotLabel(destSlot)}.`
            );

            if (
                beforeDest !== 'empty'
            ) {
                addLog(
                    botState,
                    `[INV] Ô đích trước thao tác: ${beforeDest}.`
                );
            }

            res.json({
                ok: true,
                message:
                    'Đã di chuyển item.',
                revision:
                    botState.inventoryRevision,
                inventory:
                    publicInventoryState(
                        botState
                    )
            });
        } catch (err) {
            addLog(
                botState,
                `[INV] Web move lỗi: ${err.message}`
            );

            res.status(500).json({
                error:
                    `Di chuyển thất bại: ${err.message}`,
                revision:
                    botState.inventoryRevision
            });
        } finally {
            botState.inventoryActionBusy = false;
        }
    }
);

app.post(
    '/api/inventory/equip',
    async (req, res) => {
        const sourceSlot =
            Number(req.body?.sourceSlot);

        const destination =
            typeof req.body?.destination === 'string'
                ? req.body.destination
                : '';

        const requestedRevision =
            Number(req.body?.revision);

        const validDestinations = [
            'head',
            'torso',
            'legs',
            'feet',
            'off-hand'
        ];

        if (
            !isValidPlayerInventorySlot(sourceSlot) ||
            !validDestinations.includes(destination)
        ) {
            return res.status(400).json({
                error:
                    'Nguồn hoặc vị trí trang bị không hợp lệ.'
            });
        }

        if (
            !validateInventoryRevision(
                botState,
                requestedRevision
            )
        ) {
            return res.status(409).json({
                error:
                    'Inventory đã thay đổi. Đang đồng bộ lại...',
                revision:
                    botState.inventoryRevision,
                inventory:
                    publicInventoryState(
                        botState
                    )
            });
        }

        if (
            botState.inventoryActionBusy
        ) {
            return res.status(409).json({
                error:
                    'Bot đang thực hiện thao tác inventory khác.'
            });
        }

        if (
            !canUseInventoryAction(botState)
        ) {
            return res.status(409).json({
                error:
                    'Bot chưa sẵn sàng thao tác inventory.'
            });
        }

        const bot =
            botState.bot;

        const item =
            bot.inventory.slots[sourceSlot] ||
            null;

        if (!item) {
            return res.status(400).json({
                error:
                    'Ô nguồn đang trống.'
            });
        }

        botState.inventoryActionBusy = true;

        try {
            addLog(
                botState,
                `[EQUIP] Web: ${itemSummary(item)} → ${destination}.`
            );

            await bot.equip(
                item,
                destination
            );

            await finishInventoryAction(
                botState,
                bot
            );

            addLog(
                botState,
                `[EQUIP] Hoàn tất: ${itemSummary(item)} → ${destination}.`
            );

            res.json({
                ok: true,
                message:
                    'Đã trang bị item.',
                revision:
                    botState.inventoryRevision,
                inventory:
                    publicInventoryState(
                        botState
                    )
            });
        } catch (err) {
            addLog(
                botState,
                `[EQUIP] Web lỗi: ${err.message}`
            );

            res.status(500).json({
                error:
                    `Trang bị thất bại: ${err.message}`,
                revision:
                    botState.inventoryRevision
            });
        } finally {
            botState.inventoryActionBusy = false;
        }
    }
);

app.post(
    '/api/inventory/unequip',
    async (req, res) => {
        const destination =
            typeof req.body?.destination === 'string'
                ? req.body.destination
                : '';

        const requestedRevision =
            Number(req.body?.revision);

        const validDestinations = [
            'head',
            'torso',
            'legs',
            'feet',
            'off-hand'
        ];

        if (
            !validDestinations.includes(
                destination
            )
        ) {
            return res.status(400).json({
                error:
                    'Vị trí unequip không hợp lệ.'
            });
        }

        if (
            !validateInventoryRevision(
                botState,
                requestedRevision
            )
        ) {
            return res.status(409).json({
                error:
                    'Inventory đã thay đổi. Đang đồng bộ lại...',
                revision:
                    botState.inventoryRevision,
                inventory:
                    publicInventoryState(
                        botState
                    )
            });
        }

        if (
            botState.inventoryActionBusy
        ) {
            return res.status(409).json({
                error:
                    'Bot đang thực hiện thao tác inventory khác.'
            });
        }

        if (
            !canUseInventoryAction(
                botState
            )
        ) {
            return res.status(409).json({
                error:
                    'Bot chưa sẵn sàng thao tác inventory.'
            });
        }

        const bot =
            botState.bot;

        const destinationSlotMap = {
            head: 5,
            torso: 6,
            legs: 7,
            feet: 8,
            'off-hand':
                getOffhandSlot(bot)
        };

        const sourceSlot =
            destinationSlotMap[destination];

        const equippedItem =
            bot.inventory.slots[sourceSlot] ||
            null;

        if (!equippedItem) {
            return res.status(400).json({
                error:
                    'Vị trí trang bị đang trống.'
            });
        }

        let emptySlot = null;

        for (
            let slot = 9;
            slot <= 35;
            slot++
        ) {
            if (
                !bot.inventory.slots[slot]
            ) {
                emptySlot = slot;
                break;
            }
        }

        if (emptySlot === null) {
            return res.status(409).json({
                error:
                    'Inventory không còn ô trống để tháo trang bị.'
            });
        }

        botState.inventoryActionBusy =
            true;

        try {
            const summary =
                itemSummary(equippedItem);

            addLog(
                botState,
                `[EQUIP] Web tháo ${summary} từ ${destination}.`
            );

            let moved = false;

            if (
                typeof bot.moveSlotItem ===
                'function'
            ) {
                try {
                    await bot.moveSlotItem(
                        sourceSlot,
                        emptySlot
                    );

                    moved = true;
                } catch (_) {
                    moved = false;
                }
            }

            if (
                !moved &&
                typeof bot.unequip ===
                'function'
            ) {
                await bot.unequip(
                    destination
                );
            }

            await finishInventoryAction(
                botState,
                bot
            );

            addLog(
                botState,
                `[EQUIP] Đã tháo ${summary} khỏi ${destination}.`
            );

            res.json({
                ok: true,
                message:
                    `Đã tháo trang bị ${destination}.`,
                revision:
                    botState.inventoryRevision,
                inventory:
                    publicInventoryState(
                        botState
                    )
            });
        } catch (err) {
            addLog(
                botState,
                `[EQUIP] Unequip lỗi: ${err.message}`
            );

            res.status(500).json({
                error:
                    `Tháo trang bị thất bại: ${err.message}`,
                revision:
                    botState.inventoryRevision
            });
        } finally {
            botState.inventoryActionBusy =
                false;
        }
    }
);

app.post(
    '/api/inventory/select',
    (req, res) => {
        const slot =
            Number(req.body?.slot);

        const requestedRevision =
            Number(req.body?.revision);

        if (
            !Number.isInteger(slot) ||
            slot < 0 ||
            slot > 8
        ) {
            return res.status(400).json({
                error:
                    'Hotbar slot phải từ 0 đến 8.'
            });
        }

        if (
            !validateInventoryRevision(
                botState,
                requestedRevision
            )
        ) {
            return res.status(409).json({
                error:
                    'Inventory đã thay đổi. Đang đồng bộ lại...',
                revision:
                    botState.inventoryRevision,
                inventory:
                    publicInventoryState(
                        botState
                    )
            });
        }

        if (
            !canUseInventoryAction(botState)
        ) {
            return res.status(409).json({
                error:
                    'Bot chưa sẵn sàng.'
            });
        }

        if (
            !selectHotbarSlot(
                botState,
                slot
            )
        ) {
            return res.status(500).json({
                error:
                    'Không thể chọn hotbar slot.'
            });
        }

        scanInventory(
            botState,
            botState.bot,
            false
        );

        addLog(
            botState,
            `[HOTBAR] Web chọn slot ${slot + 1}.`
        );

        res.json({
            ok: true,
            message:
                `Đã chọn hotbar slot ${slot + 1}.`,
            revision:
                botState.inventoryRevision,
            inventory:
                publicInventoryState(
                    botState
                )
        });
    }
);

// -----------------------------------------------------------------------------
// Drop item outside inventory
// -----------------------------------------------------------------------------

app.post(
    '/api/inventory/drop',
    async (req, res) => {
        const sourceSlot =
            Number(req.body?.sourceSlot);

        const requestedRevision =
            Number(req.body?.revision);

        if (
            !isValidPlayerInventorySlot(
                sourceSlot
            )
        ) {
            return res.status(400).json({
                error:
                    'Slot vứt item không hợp lệ.'
            });
        }

        if (
            !validateInventoryRevision(
                botState,
                requestedRevision
            )
        ) {
            return res.status(409).json({
                error:
                    'Inventory đã thay đổi. Đang đồng bộ lại...',
                revision:
                    botState.inventoryRevision,
                inventory:
                    publicInventoryState(
                        botState
                    )
            });
        }

        if (
            botState.inventoryActionBusy
        ) {
            return res.status(409).json({
                error:
                    'Bot đang thực hiện thao tác inventory khác.'
            });
        }

        if (
            !canUseInventoryAction(
                botState
            )
        ) {
            return res.status(409).json({
                error:
                    'Bot chưa sẵn sàng thao tác inventory.'
            });
        }

        const bot =
            botState.bot;

        const item =
            bot.inventory.slots[sourceSlot] ||
            null;

        if (!item) {
            return res.status(400).json({
                error:
                    'Ô nguồn đang trống.'
            });
        }

        if (
            typeof bot.tossStack !==
            'function'
        ) {
            return res.status(501).json({
                error:
                    'Mineflayer hiện tại không hỗ trợ tossStack.'
            });
        }

        botState.inventoryActionBusy =
            true;

        try {
            const summary =
                itemSummary(item);

            addLog(
                botState,
                `[DROP] Vứt ${summary} từ ${getSlotLabel(sourceSlot)}.`
            );

            await bot.tossStack(
                item
            );

            await finishInventoryAction(
                botState,
                bot
            );

            addLog(
                botState,
                `[DROP] Đã vứt ${summary}.`
            );

            res.json({
                ok: true,
                message:
                    `Đã vứt ${summary}.`,
                revision:
                    botState.inventoryRevision,
                inventory:
                    publicInventoryState(
                        botState
                    )
            });
        } catch (err) {
            addLog(
                botState,
                `[DROP] Lỗi vứt item: ${err.message}`
            );

            res.status(500).json({
                error:
                    `Vứt item thất bại: ${err.message}`,
                revision:
                    botState.inventoryRevision
            });
        } finally {
            botState.inventoryActionBusy =
                false;
        }
    }
);

// -----------------------------------------------------------------------------
// Health endpoint
// Render / Google Apps Script can call /health.
// -----------------------------------------------------------------------------

app.get(
    '/health',
    (req, res) => {

        const online =
            botState.status !==
            'offline'
                ? 1
                : 0;

        res.status(200).json({
            status: 'ok',
            online,

            bot:
                publicBotState(
                    botState
                )
        });
    }
);

// -----------------------------------------------------------------------------
// Dashboard root
// -----------------------------------------------------------------------------

app.get(
    '/',
    (req, res) => {
        res
            .type('html')
            .send(HTML);
    }
);

// -----------------------------------------------------------------------------
// HTTP server
// -----------------------------------------------------------------------------

const server = app.listen(
    HTTP_PORT,
    '0.0.0.0',
    () => {

        console.log(
            `[HTTP] Dashboard listening on ${HTTP_PORT}`
        );

    }
);

// -----------------------------------------------------------------------------
// Extra lightweight status endpoint
//
// Trả về trạng thái tối thiểu cho các request kiểm tra nhanh.
// Không thay thế /api/bot.
// -----------------------------------------------------------------------------

app.get(
    '/api/status',
    (req, res) => {
        res.json({
            status: botState.status,
            ready: botState.ready,
            ping: getPing(botState),
            connectedAt: botState.connectedAt,
            botId: BOT_ID,
            position: getBotPosition(botState),
            dimension: getBotDimension(botState)
        });
    }
);

// -----------------------------------------------------------------------------
// Graceful process shutdown
// -----------------------------------------------------------------------------

function shutdownProcess(signal) {
    console.log(
        `[PROCESS] Nhận ${signal}, đang shutdown...`
    );

    botState.manuallyStopped = true;

    clearAllTimers(
        botState
    );

    if (botState.bot) {
        try {
            botState.bot.removeAllListeners();

            if (
                typeof botState.bot.quit ===
                'function'
            ) {
                botState.bot.quit(
                    `Process ${signal}`
                );
            }
        } catch (err) {
            console.log(
                `[PROCESS] Shutdown bot error: ${err.message}`
            );
        }

        botState.bot = null;
    }

    if (server) {
        server.close(() => {
            console.log(
                '[PROCESS] HTTP server closed.'
            );

            process.exit(0);
        });

        setTimeout(() => {
            process.exit(0);
        }, 5000);
    } else {
        process.exit(0);
    }
}

process.on(
    'SIGTERM',
    () => shutdownProcess('SIGTERM')
);

process.on(
    'SIGINT',
    () => shutdownProcess('SIGINT')
);

// -----------------------------------------------------------------------------
// FINAL STARTUP STATE
//
// Quan trọng:
// - Load credential từ ENV.
// - KHÔNG tự connect.
// - Bot luôn OFFLINE sau khi Render khởi động.
// - Chỉ bấm "▶ Chạy" trên web mới kết nối.
// -----------------------------------------------------------------------------

botState.manuallyStopped = true;
botState.ready = false;
setBotStatus(botState, 'offline');
botState.connectedAt = null;
resetInventoryState(botState);

if (
    botState.username &&
    botState.password
) {
    addLog(
        botState,
        'Đã đọc credential từ ENV. Bot đang OFFLINE và chờ lệnh Chạy từ web.'
    );
} else {
    addLog(
        botState,
        'Bot đang OFFLINE: chưa có username/password. Nhập tài khoản trên web rồi bấm Chạy.'
    );
}

// ============================================================================
// END OF FILE
// ============================================================================
//
// File này là bản 1-bot hoàn chỉnh.
//
// Chức năng giữ lại:
// - Mineflayer
// - Express dashboard
// - Login /dn
// - Fallback /register
// - Fallback /login
// - Lobby detection
// - /menu
// - Click slot 24
// - AFK state
// - Start / Stop / Restart
// - Reconnect + host fallback
// - Chat / command
// - Runtime username/password
// - Health endpoint
// - Lightweight status endpoint
// - Manual start only
// - UTC+7 log time
// - Log filtering
// - Log scroll position preservation
// - View distance tuning
// - Graceful shutdown
// - BOT environment identity
// - CORS + /api/node central dashboard discovery
//
// Lưu ý:
// Phần này chỉ là marker kết thúc file.
// Không cần thêm code khác sau đây.
// ============================================================================
