const mineflayer = require('mineflayer');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============================================================================
// HARD-CODED BOT CONFIG
//
// Chỉ cần sửa phần này khi đổi tài khoản, server hoặc host chạy bot.
// Không cần BOT/username/password/server ENV cho bot.
//
// PLATFORM:
//   'raven'  -> dùng RAVEN_HTTP_PORT bên dưới.
//   'render' -> tự dùng process.env.PORT do Render cấp; KHÔNG cần nhập port.
// ============================================================================

const BOT_CONFIG = {
    // Host platform
    PLATFORM: 'render',

    // Bot identity
    BOT_ID: '7',

    // KingMC account
    USERNAME: '',
    PASSWORD: '',

    // HTTP/Web port
    // Raven: mỗi bot phải có port riêng.
    // Render: KHÔNG dùng giá trị này; Render tự cấp process.env.PORT.
    RAVEN_HTTP_PORT: 17419,

    // Minecraft server
    MC_HOSTS: ['sgp.kingmc.vn'],
    MC_PORT: 25565,
    MC_VERSION: '1.20.1',

    // Startup
    AUTO_START: true,

    // Mineflayer tuning
    VIEW_DISTANCE: 'tiny',
    CHECK_TIMEOUT_MS: 30000,

    // KingMC location flow
    AUTH_COORDS: { x: 5, y: 119, z: 4 },
    LOBBY_COORDS: { x: 1, y: 41, z: 1 },

    // Initial runtime settings
    DEFAULT_SETTINGS: {
        autoTotem: true,
        antiHungry: true,
        autoReconnect: true
    }
};

const app = express();

function readPositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return fallback;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), min), max);
}

const PLATFORM = String(BOT_CONFIG.PLATFORM || 'render').trim().toLowerCase();

if (!['raven', 'render'].includes(PLATFORM)) {
    throw new Error(
        `[CONFIG] PLATFORM không hợp lệ: ${BOT_CONFIG.PLATFORM}. Chỉ dùng 'raven' hoặc 'render'.`
    );
}

// Raven: lấy port riêng đã nhập trong BOT_CONFIG.
// Render: luôn ưu tiên PORT mà Render cấp cho Web Service.
const HTTP_PORT =
    PLATFORM === 'raven'
        ? readPositiveInt(BOT_CONFIG.RAVEN_HTTP_PORT, 17419, 1, 65535)
        : readPositiveInt(process.env.PORT, 10000, 1, 65535);

const BOT_ID_RAW = String(BOT_CONFIG.BOT_ID).trim() || '1';
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
const INVENTORY_ACTION_TIMEOUT_MS = 15000;
const AUTO_START_ON_BOOT = Boolean(BOT_CONFIG.AUTO_START);

// KingMC AFK flow timing.
const DN_TO_AFK_DELAY = 1000;
const AFK_MENU_DELAY = 1800;
const AFK_MENU_CLICK_DELAY = 700;

// Background inventory / survival managers.
const AUTO_EAT_INTERVAL_MS = 2000;
const AUTO_TOTEM_INTERVAL_MS = 1500;
const INVENTORY_SCAN_INTERVAL_MS = 1000;

const MC_VERSION = BOT_CONFIG.MC_VERSION;
const HOSTS = Array.isArray(BOT_CONFIG.MC_HOSTS)
    ? BOT_CONFIG.MC_HOSTS
        .map(host => String(host).trim())
        .filter(Boolean)
    : [];
const PORT = readPositiveInt(BOT_CONFIG.MC_PORT, 25565, 1, 65535);

// Network / client-load tuning.
// Mineflayer officially supports far / normal / short / tiny / numeric view distance.
// tiny is the lowest named setting and is appropriate for an AFK bot.
const VIEW_DISTANCE = BOT_CONFIG.VIEW_DISTANCE || 'tiny';
const CHECK_TIMEOUT_INTERVAL = readPositiveInt(
    BOT_CONFIG.CHECK_TIMEOUT_MS,
    30000,
    5000,
    300000
);

const AUTH_COORDS = Object.freeze({
    ...BOT_CONFIG.AUTH_COORDS
});
const LOBBY_COORDS = Object.freeze({
    ...BOT_CONFIG.LOBBY_COORDS
});
const COORD_SCAN_INTERVAL_MS = 250;
const AFK_CONFIRM_DELAY_MS = 700;
const LOCATION_RETRY_BASE_MS = 1000;
const LOCATION_RETRY_MAX_MS = 30000;
const LOCATION_ACTION_COOLDOWN_MS = 2500;
const IP_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const SETTINGS_FILE = path.join(__dirname, 'bot_settings.json');
const DEFAULT_SETTINGS = Object.freeze({
    ...BOT_CONFIG.DEFAULT_SETTINGS
});

function sanitizeAutoChatSchedules(input) {
    if (!Array.isArray(input)) {
        return [];
    }

    const result = [];

    for (const raw of input.slice(0, 100)) {
        if (!raw || typeof raw !== 'object') {
            continue;
        }

        const mode = raw.mode === 'fixed' ? 'fixed' : 'interval';
        const messages = Array.isArray(raw.messages)
            ? raw.messages
                .map(value => String(value ?? '').trim())
                .filter(Boolean)
                .slice(0, 50)
            : [];

        const times = Array.isArray(raw.times)
            ? raw.times
                .map(value => String(value ?? '').trim())
                .filter(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))
                .slice(0, 50)
            : [];

        const intervalSeconds = readPositiveInt(
            raw.intervalSeconds,
            3600,
            10,
            7 * 24 * 60 * 60
        );

        const messageDelaySeconds = readPositiveInt(
            raw.messageDelaySeconds,
            2,
            0,
            3600
        );

        if (!messages.length) {
            continue;
        }

        if (mode === 'fixed' && !times.length) {
            continue;
        }

        const id = String(raw.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

        result.push({
            id,
            enabled: raw.enabled !== false,
            mode,
            intervalSeconds,
            times,
            messages,
            messageDelaySeconds,
            lastIntervalRunAt: 0,
            lastFixedRunKey: '',
            running: false
        });
    }

    return result;
}

function loadBotSettings() {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) {
            return {
                settings: { ...DEFAULT_SETTINGS },
                autoChatSchedules: []
            };
        }

        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const settings = parsed && typeof parsed.settings === 'object'
            ? parsed.settings
            : {};

        return {
            settings: {
                autoTotem: settings.autoTotem !== false,
                antiHungry: settings.antiHungry !== false,
                autoReconnect: settings.autoReconnect !== false
            },
            autoChatSchedules: sanitizeAutoChatSchedules(parsed?.autoChatSchedules)
        };
    } catch (err) {
        console.error(`[SETTINGS] Không đọc được ${SETTINGS_FILE}: ${err.message}`);
        return {
            settings: { ...DEFAULT_SETTINGS },
            autoChatSchedules: []
        };
    }
}

function saveBotSettingsFile(settings, autoChatSchedules) {
    try {
        const payload = {
            version: 1,
            settings: {
                autoTotem: settings.autoTotem !== false,
                antiHungry: settings.antiHungry !== false,
                autoReconnect: settings.autoReconnect !== false
            },
            autoChatSchedules: sanitizeAutoChatSchedules(autoChatSchedules)
                .map(schedule => ({
                    id: schedule.id,
                    enabled: schedule.enabled !== false,
                    mode: schedule.mode,
                    intervalSeconds: schedule.intervalSeconds,
                    times: schedule.times,
                    messages: schedule.messages,
                    messageDelaySeconds: schedule.messageDelaySeconds
                }))
        };

        const tmpFile = `${SETTINGS_FILE}.tmp-${process.pid}`;

        fs.writeFileSync(
            tmpFile,
            JSON.stringify(payload, null, 2),
            'utf8'
        );

        fs.renameSync(
            tmpFile,
            SETTINGS_FILE
        );

        return true;
    } catch (err) {
        try {
            const tmpFile = `${SETTINGS_FILE}.tmp-${process.pid}`;
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        } catch (_) {}
        console.error(`[SETTINGS] Không lưu được ${SETTINGS_FILE}: ${err.message}`);
        return false;
    }
}

const INITIAL_SETTINGS = loadBotSettings();

app.use(express.json({ limit: '512kb', strict: true }));

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

app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
        return res.status(400).json({ error: 'JSON request không hợp lệ.' });
    }
    if (err) {
        console.error(`[HTTP] ${req.method} ${req.originalUrl || req.url}: ${err.message || err}`);
        return res.status(500).json({ error: 'Lỗi máy chủ.' });
    }
    return next();
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

function getConfiguredCredentials() {
    return {
        username: String(BOT_CONFIG.USERNAME || '').trim(),
        password: String(BOT_CONFIG.PASSWORD || '')
    };
}

function createBotState() {
    const credentials = getConfiguredCredentials();

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
        stateRevision: 0,
        connectionGeneration: 0,
        restartTimer: null,
        shuttingDown: false,

        // AFK uptime statistics.
        // Uptime counts only while status === 'afk'.
        afkElapsedSeconds: 0,
        afkStartedAt: null,
        reconnectCount: 0,
        reconnectAttempts: 0,

        reconnectTimer: null,
        afkTimers: [],
        locationMonitorTimer: null,
        locationRetryTimer: null,
        locationConfirmTimer: null,
        locationRetryAttempt: 0,
        locationRetryReason: '',
        locationActionBusy: false,
        pendingAfkConfirmation: false,
        locationState: 'unknown',
        menuCommandIndex: 0,
        lastLoginActionAt: 0,
        lastDnActionAt: 0,
        locationFlowBusy: false,
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
        autoChatTimer: null,
        autoChatGeneration: 0,

        settings: { ...INITIAL_SETTINGS.settings },
        autoChatSchedules: INITIAL_SETTINGS.autoChatSchedules,

        publicIp: '',
        publicIpUpdatedAt: 0,
        publicIpTimer: null,

        inventoryLogSignature: '',
        previousInventorySnapshot: null,
        inventoryRevision: 0,
        inventoryActionBusy: false,
        inventoryActionBot: null,
        inventoryActionToken: 0,
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

function isCurrentBot(state, bot) {
    return !!bot && state.bot === bot;
}

function beginInventoryAction(state, bot) {
    state.inventoryActionBusy = true;
    state.inventoryActionBot = bot;
    state.inventoryActionToken++;
    return state.inventoryActionToken;
}

function endInventoryAction(state, bot, token) {
    if (
        state.inventoryActionBot === bot &&
        state.inventoryActionToken === token
    ) {
        state.inventoryActionBusy = false;
        state.inventoryActionBot = null;
    }
}

function isInventoryActionCurrent(state, bot, token) {
    return (
        state.bot === bot &&
        state.inventoryActionBot === bot &&
        state.inventoryActionToken === token &&
        !state.manuallyStopped
    );
}

function invalidateInventoryAction(state) {
    state.inventoryActionToken++;
    state.inventoryActionBusy = false;
    state.inventoryActionBot = null;
}

function cleanupBotResources(bot) {
    if (!bot) return;

    try {
        bot.removeAllListeners();
        // Keep a no-op error listener so a late EventEmitter 'error' from a
        // fully disconnected client can never become an uncaught exception.
        bot.on('error', () => {});
    } catch (_) {
    }

    const client = bot._client;

    if (!client) return;

    try {
        if (typeof client.removeAllListeners === 'function') {
            client.removeAllListeners();
        }
        if (typeof client.on === 'function') {
            client.on('error', () => {});
        }
    } catch (_) {
    }

    try {
        const socket = client.socket;
        if (socket && typeof socket.destroy === 'function' && !socket.destroyed) {
            socket.destroy();
        }
    } catch (_) {
    }
}

function withTimeout(promise, timeoutMs, label = 'Thao tác') {
    let timer = null;

    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label} quá thời gian chờ.`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
    });
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

    if (state.autoChatTimer) {
        clearInterval(state.autoChatTimer);
        state.autoChatTimer = null;
    }

    state.autoChatGeneration++;

    state.isEating = false;
    state.isEquippingTotem = false;
}

function clearRestartTimer(state) {
    if (state.restartTimer) {
        clearTimeout(state.restartTimer);
        state.restartTimer = null;
    }
}

function clearLocationTimers(state) {
    if (state.locationMonitorTimer) {
        clearInterval(state.locationMonitorTimer);
        state.locationMonitorTimer = null;
    }

    if (state.locationRetryTimer) {
        clearTimeout(state.locationRetryTimer);
        state.locationRetryTimer = null;
    }

    if (state.locationConfirmTimer) {
        clearTimeout(state.locationConfirmTimer);
        state.locationConfirmTimer = null;
    }

    state.locationActionBusy = false;
    state.locationFlowBusy = false;
    state.pendingAfkConfirmation = false;
    state.locationRetryAttempt = 0;
    state.locationRetryReason = '';
}

function clearAllTimers(state) {
    clearAfkTimers(state);
    clearReconnectTimer(state);
    clearLocationTimers(state);
    clearRestartTimer(state);
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
    state.inventoryRevision++;
    invalidateInventoryAction(state);

    state.inventoryState = {
        revision: state.inventoryRevision,
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
        !state.settings.antiHungry ||
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
    const actionToken = beginInventoryAction(state, bot);

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

        await withTimeout(
            bot.equip(foodItem, 'hand'),
            INVENTORY_ACTION_TIMEOUT_MS,
            'Equip thức ăn'
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

        await withTimeout(
            bot.consume(),
            INVENTORY_ACTION_TIMEOUT_MS,
            'Ăn thức ăn'
        );

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
            endInventoryAction(state, oldBot, actionToken);
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
                    await withTimeout(
                        bot.equip(oldHeldItem, 'hand'),
                        INVENTORY_ACTION_TIMEOUT_MS,
                        'Khôi phục item cũ'
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

        endInventoryAction(state, oldBot, actionToken);
    }
}

async function autoTotemTick(state) {
    const bot = state.bot;

    if (
        !state.settings.autoTotem ||
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
    const actionToken = beginInventoryAction(state, bot);
    state.totemLogState = 'equipping';

    const oldBot = bot;

    try {
        addLog(
            state,
            '[TOTEM] Đang equip Totem vào offhand.'
        );

        await withTimeout(
            bot.equip(totem, 'off-hand'),
            INVENTORY_ACTION_TIMEOUT_MS,
            'Equip Totem'
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
        endInventoryAction(state, oldBot, actionToken);
    }
}

function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function currentVietnamTimeParts(date = new Date()) {
    const text = date.toLocaleString('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})$/);
    if (!match) {
        return { dateKey: '', timeKey: '' };
    }

    return {
        dateKey: `${match[3]}-${match[2]}-${match[1]}`,
        timeKey: `${match[4]}:${match[5]}`
    };
}

function isAutoChatBotReady(state) {
    return (
        !state.manuallyStopped &&
        !!state.bot &&
        !!state.bot.player &&
        state.status !== 'offline' &&
        state.status !== 'connecting' &&
        state.status !== 'authenticating' &&
        state.status !== 'entering' &&
        state.status !== 'kicked'
    );
}

async function runAutoChatSchedule(state, schedule) {
    if (
        schedule.running ||
        !schedule.enabled ||
        !isAutoChatBotReady(state)
    ) {
        return;
    }

    const generation = state.autoChatGeneration;
    schedule.running = true;

    try {
        for (const message of schedule.messages) {
            if (
                generation !== state.autoChatGeneration ||
                !state.autoChatSchedules.includes(schedule) ||
                !isAutoChatBotReady(state)
            ) {
                break;
            }

            try {
                state.bot.chat(message);
                state.lastWebChatText = cleanMinecraftText(message);
                state.lastWebChatAt = Date.now();
                addChatLog(state, 'AUTO', `→ ${message}`);
                addLog(state, `[AUTOCHAT] Đã gửi: ${message}`);
            } catch (err) {
                addLog(state, `[AUTOCHAT] Gửi lỗi: ${err.message}`);
                break;
            }

            const delay = Number(schedule.messageDelaySeconds || 0) * 1000;
            if (delay > 0) {
                await sleepMs(delay);
            }
        }
    } finally {
        schedule.running = false;
    }
}

async function autoChatTick(state) {
    if (!isAutoChatBotReady(state)) {
        return;
    }

    const now = Date.now();
    const timeParts = currentVietnamTimeParts(new Date(now));

    for (const schedule of state.autoChatSchedules) {
        if (!schedule.enabled || !schedule.messages.length || schedule.running) {
            continue;
        }

        if (schedule.mode === 'fixed') {
            for (const timeKey of schedule.times) {
                const currentKey = `${timeParts.dateKey} ${timeKey}`;
                if (
                    timeParts.timeKey === timeKey &&
                    schedule.lastFixedRunKey !== currentKey
                ) {
                    schedule.lastFixedRunKey = currentKey;
                    void runAutoChatSchedule(state, schedule);
                    break;
                }
            }
        } else {
            if (
                !schedule.lastIntervalRunAt ||
                now - schedule.lastIntervalRunAt >= Number(schedule.intervalSeconds || 3600) * 1000
            ) {
                schedule.lastIntervalRunAt = now;
                void runAutoChatSchedule(state, schedule);
            }
        }
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

    state.autoChatTimer =
        setInterval(
            () => {
                if (
                    state.manuallyStopped ||
                    state.bot !== bot
                ) {
                    return;
                }

                autoChatTick(state)
                    .catch(err => {
                        if (state.bot === bot) {
                            addLog(
                                state,
                                `[AUTOCHAT] Lỗi manager: ${err.message}`
                            );
                        }
                    });
            },
            1000
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

    if (state.status !== status) {
        state.status = status;
        state.stateRevision++;
    }
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

function getRoundedBotCoordinates(bot) {
    if (!bot || !bot.entity || !bot.entity.position) {
        return null;
    }

    const x = Number(bot.entity.position.x);
    const y = Number(bot.entity.position.y);
    const z = Number(bot.entity.position.z);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return null;
    }

    return {
        x: Math.round(x),
        y: Math.round(y),
        z: Math.round(z)
    };
}

function sameCoordinates(a, b) {
    return !!a && !!b &&
        a.x === b.x &&
        a.y === b.y &&
        a.z === b.z;
}

function getLocationKind(bot) {
    const coordinates = getRoundedBotCoordinates(bot);

    if (!coordinates) {
        return 'unknown';
    }

    if (sameCoordinates(coordinates, AUTH_COORDS)) {
        return 'login';
    }

    if (sameCoordinates(coordinates, LOBBY_COORDS)) {
        return 'lobby';
    }

    return 'other';
}

function getLocationRetryDelay(state) {
    const attempt = Math.max(Number(state.locationRetryAttempt || 1), 1);
    return Math.min(
        Math.round(LOCATION_RETRY_BASE_MS * Math.pow(1.7, attempt - 1)),
        LOCATION_RETRY_MAX_MS
    );
}

function scheduleLocationRetry(state, bot, reason, preserveAfkConfirmation = false) {
    if (
        state.shuttingDown ||
        state.manuallyStopped ||
        state.bot !== bot
    ) {
        return;
    }

    if (!state.settings.autoReconnect) {
        state.locationRetryTimer = null;
        state.locationFlowBusy = false;
        state.pendingAfkConfirmation = false;
        state.ready = false;
        return;
    }

    if (state.locationRetryTimer) {
        return;
    }

    state.locationRetryAttempt++;
    state.locationRetryReason = reason;
    state.ready = false;
    state.locationFlowBusy = true;

    if (!preserveAfkConfirmation) {
        state.pendingAfkConfirmation = false;
    }

    const delay = getLocationRetryDelay(state);

    if (reason === 'login') {
        setBotStatus(state, 'authenticating');
    } else {
        setBotStatus(state, 'entering');
    }

    addLog(
        state,
        `[FLOW] Thử lại ${reason} lần #${state.locationRetryAttempt} sau ${delay / 1000}s.`
    );

    state.locationRetryTimer = setTimeout(() => {
        state.locationRetryTimer = null;

        if (
            state.shuttingDown ||
            state.manuallyStopped ||
            state.bot !== bot
        ) {
            return;
        }

        if (preserveAfkConfirmation) {
            const kind = getLocationKind(bot);

            if (kind === 'other') {
                state.pendingAfkConfirmation = true;
                state.locationFlowBusy = true;

                if (!state.locationConfirmTimer) {
                    state.locationConfirmTimer = setTimeout(() => {
                        state.locationConfirmTimer = null;
                        confirmAfkAfterClick(state, bot);
                    }, AFK_CONFIRM_DELAY_MS);
                }
                return;
            }

            if (reason === 'menu-confirm' && kind === 'lobby') {
                state.pendingAfkConfirmation = true;
                state.locationFlowBusy = true;
                startAfkRoutine(state, bot);
                return;
            }

            state.pendingAfkConfirmation = false;
        }

        state.locationFlowBusy = false;
    }, delay);
}

function confirmAfkAfterClick(state, bot) {
    if (
        state.shuttingDown ||
        state.manuallyStopped ||
        state.bot !== bot ||
        !state.pendingAfkConfirmation
    ) {
        return;
    }

    const kind = getLocationKind(bot);
    state.locationState = kind;

    if (kind === 'other') {
        state.pendingAfkConfirmation = false;
        state.locationFlowBusy = false;
        state.ready = true;
        state.locationRetryAttempt = 0;
        state.locationRetryReason = '';
        state.menuCommandIndex = 0;
        setBotStatus(state, 'afk');

        addLog(state, '[FLOW] Xác nhận tọa độ sau click: đã rời LOGIN/LOBBY.');
        addLog(state, '✅ Đã xác nhận trạng thái AFK.');
        return;
    }

    state.ready = false;

    if (kind === 'login') {
        state.pendingAfkConfirmation = false;
        state.locationFlowBusy = false;
        setBotStatus(state, 'authenticating');
        scheduleLocationRetry(state, bot, 'login');
        return;
    }

    if (kind === 'lobby') {
        setBotStatus(state, 'entering');
        scheduleLocationRetry(state, bot, 'menu-confirm', true);
        return;
    }

    scheduleLocationRetry(state, bot, 'coordinate', true);
}

function startLocationMonitor(state, bot) {
    clearLocationTimers(state);

    const tick = () => {
        if (
            state.shuttingDown ||
            state.manuallyStopped ||
            state.bot !== bot ||
            !bot.entity
        ) {
            return;
        }

        const kind = getLocationKind(bot);
        state.locationState = kind;

        if (state.pendingAfkConfirmation && kind !== 'unknown') {
            if (!state.locationConfirmTimer) {
                state.locationConfirmTimer = setTimeout(() => {
                    state.locationConfirmTimer = null;
                    confirmAfkAfterClick(state, bot);
                }, AFK_CONFIRM_DELAY_MS);
            }
            return;
        }

        if (state.locationRetryTimer || state.locationActionBusy) {
            return;
        }

        if (state.locationFlowBusy || state.pendingAfkConfirmation) {
            return;
        }

        if (kind === 'login') {
            if (state.status === 'afk') {
                state.ready = false;
                setBotStatus(state, 'authenticating');
            }

            const now = Date.now();
            if (
                state.settings.autoReconnect &&
                state.password &&
                now - state.lastLoginActionAt >= LOCATION_ACTION_COOLDOWN_MS
            ) {
                state.lastLoginActionAt = now;
                state.locationActionBusy = true;
                state.locationFlowBusy = true;
                state.ready = false;
                setBotStatus(state, 'authenticating');

                try {
                    bot.chat(`/login ${state.password}`);
                    addLog(state, '[FLOW] Tọa độ LOGIN xác nhận → gửi /login.');
                } catch (err) {
                    addLog(state, `[FLOW] /login lỗi: ${err.message}`);
                } finally {
                    state.locationActionBusy = false;
                }

                const verifyTimer = setTimeout(() => {
                    if (state.bot !== bot || state.manuallyStopped) return;
                    if (getLocationKind(bot) === 'login') {
                        state.locationFlowBusy = false;
                        scheduleLocationRetry(state, bot, 'login');
                    } else {
                        state.locationFlowBusy = false;
                        state.locationRetryAttempt = 0;
                    }
                }, 1200);
                state.afkTimers.push(verifyTimer);
            }

            return;
        }

        if (kind === 'lobby') {
            if (state.status === 'afk') {
                state.ready = false;
                setBotStatus(state, 'entering');
            }

            if (!state.password) {
                return;
            }

            if (state.locationFlowBusy || state.pendingAfkConfirmation) {
                return;
            }

            const now = Date.now();
            if (
                state.settings.autoReconnect &&
                now - state.lastDnActionAt >= LOCATION_ACTION_COOLDOWN_MS
            ) {
                state.lastDnActionAt = now;
                state.locationFlowBusy = true;
                state.ready = false;
                setBotStatus(state, 'entering');

                try {
                    bot.chat(`/dn ${state.password}`);
                    addLog(state, '[FLOW] Tọa độ LOBBY xác nhận → gửi /dn.');
                } catch (err) {
                    state.locationFlowBusy = false;
                    addLog(state, `[FLOW] /dn lỗi: ${err.message}`);
                    scheduleLocationRetry(state, bot, 'lobby');
                    return;
                }

                const timer = setTimeout(() => {
                    if (
                        state.bot === bot &&
                        !state.manuallyStopped &&
                        getLocationKind(bot) === 'lobby'
                    ) {
                        startAfkRoutine(state, bot);
                    } else {
                        state.locationFlowBusy = false;
                    }
                }, DN_TO_AFK_DELAY);

                state.afkTimers.push(timer);
            }

            return;
        }

        if (state.status === 'afk' && state.ready) {
            return;
        }

        if (!state.pendingAfkConfirmation && state.status === 'authenticating') {
            state.ready = false;
        }
    };

    tick();

    state.locationMonitorTimer = setInterval(
        tick,
        COORD_SCAN_INTERVAL_MS
    );
}

async function refreshPublicIp(state) {
    let controller = null;
    let timer = null;
    try {
        controller = new AbortController();
        timer = setTimeout(() => controller.abort(), 10000);
        const response = await fetch('https://api.ipify.org?format=json', {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const ip = String(data?.ip || '').trim();

        if (ip) {
            state.publicIp = ip;
            state.publicIpUpdatedAt = Date.now();
        }
    } catch (err) {
        const message = err?.name === 'AbortError' ? 'Timeout khi lấy IP public.' : (err?.message || 'Lỗi không xác định.');
        addLog(state, `[IP] Không lấy được IP public: ${message}`);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function startPublicIpMonitor(state) {
    if (state.publicIpTimer) {
        clearInterval(state.publicIpTimer);
    }

    void refreshPublicIp(state);
    state.publicIpTimer = setInterval(
        () => void refreshPublicIp(state),
        IP_REFRESH_INTERVAL_MS
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
        x: Math.round(x),
        y: Math.round(y),
        z: Math.round(z)
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

        stateRevision:
            state.stateRevision,

        autoStartOnBoot:
            AUTO_START_ON_BOOT,

        hasCredentials:
            !!(state.username && state.password),

        ipAddress:
            state.publicIp || '',

        ipAddressUpdatedAt:
            state.publicIpUpdatedAt || null,

        settings: {
            autoTotem: state.settings.autoTotem !== false,
            antiHungry: state.settings.antiHungry !== false,
            autoReconnect: state.settings.autoReconnect !== false
        },

        autoChatScheduleCount:
            state.autoChatSchedules.length,

        locationState:
            state.locationState,

        roundedLocation:
            getRoundedBotCoordinates(state.bot),

        position:
            getBotPosition(state),

        dimension:
            getBotDimension(state)
    };
}


function publicBotCredentials(state) {
    return {
        ok: true,
        botId: BOT_ID,
        label: BOT_LABEL,
        username: state.username || '',
        password: state.password || ''
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
        state.shuttingDown ||
        state.manuallyStopped ||
        !state.settings.autoReconnect ||
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
    invalidateInventoryAction(state);

    state.connectionGeneration++;
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
        if (typeof currentBot.quit === 'function') {
            currentBot.quit(reason);
        }
    } catch (err) {
        console.log(
            `[BOT ${state.id}] Shutdown error: ${err.message}`
        );
    } finally {
        cleanupBotResources(currentBot);
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
    if (state.shuttingDown) {
        return false;
    }

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
    if (state.restartTimer) {
        clearTimeout(state.restartTimer);
        state.restartTimer = null;
    }

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

function registerEvents(state, bot, connectionGeneration = state.connectionGeneration) {
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
        if (
            state.bot !== bot ||
            state.connectionGeneration !== connectionGeneration
        ) {
            return;
        }

        addLog(
            state,
            `Lỗi kết nối: ${err.message}`
        );
    });

    bot.on('kicked', reason => {
        if (
            state.bot !== bot ||
            state.connectionGeneration !== connectionGeneration
        ) {
            return;
        }

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

        if (state.settings.autoReconnect) {
            scheduleReconnect(state);
        }
    });

    bot.on('end', () => {
        const isCurrentBot =
            state.bot === bot &&
            state.connectionGeneration === connectionGeneration;

        if (isCurrentBot) {
            state.bot = null;
            clearManagerTimers(state);
            clearAfkTimers(state);
            invalidateInventoryAction(state);
            state.ready = false;
            state.connectedAt = null;
            resetInventoryState(state);
        }

        // Ended/stale Mineflayer instances must not retain listeners or sockets.
        cleanupBotResources(bot);

        if (!isCurrentBot) {
            return;
        }

        if (state.manuallyStopped) {
            setBotStatus(state, 'offline');
            addLog(state, 'Đã ngắt kết nối.');
            return;
        }

        setBotStatus(state, 'offline');
        addLog(state, 'Mất kết nối.');

        state.reconnectCount++;
        addLog(
            state,
            `Reconnect #${state.reconnectCount}.`
        );

        if (!state.settings.autoReconnect) {
            addLog(state, '[RECONNECT] Auto reconnect đang tắt.');
            return;
        }

        if (HOSTS.length > 1 && state.reconnectAttempts >= 3) {
            state.hostIndex = (state.hostIndex + 1) % HOSTS.length;
            state.reconnectAttempts = 0;
            addLog(state, `[HOST] Chuyển sang ${currentHost(state)} sau nhiều lần reconnect thất bại.`);
        }

        scheduleReconnect(state);
    });

    bot.once('spawn', () => {
        if (
            state.bot !== bot ||
            state.connectionGeneration !== connectionGeneration ||
            state.manuallyStopped
        ) {
            return;
        }

        setBotStatus(state, 'online');
        state.ready = false;
        state.connectedAt = Date.now();
        state.reconnectAttempts = 0;

        startBackgroundManagers(
            state,
            bot
        );

        startLocationMonitor(state, bot);
    });

    bot.on('death', () => {
        if (
            state.bot === bot &&
            state.connectionGeneration === connectionGeneration
        ) {
            addLog(
                state,
                '[LIFE] Bot đã chết.'
            );
        }
    });

    bot.on('message', jsonMsg => {
        if (
            state.bot !== bot ||
            state.connectionGeneration !== connectionGeneration
        ) {
            return;
        }

        handleServerMessage(
            state,
            bot,
            jsonMsg
        );
    });

    bot.on('windowOpen', window => {
        if (
            state.bot !== bot ||
            state.connectionGeneration !== connectionGeneration
        ) {
            return;
        }

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
    if (state.shuttingDown || state.manuallyStopped) {
        return;
    }

    clearAfkTimers(state);
    clearReconnectTimer(state);

    if (state.bot) {
        disconnectBot(state, 'Replacing stale connection');
        state.manuallyStopped = false;
    }

    state.connectionGeneration++;
    const connectionGeneration = state.connectionGeneration;

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
        bot,
        connectionGeneration
    );
}

const BLOCKED_MC_LOG_PATTERNS = [
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
        'và gửi cho admin',
        'ai là newbie thì dùng lệnh /commands để xem danh sách lệnh cơ bản, /rules để xem luật'
    ];

function handleServerMessage(
    state,
    bot,
    jsonMsg
) {
    if (!isCurrentBot(state, bot) || state.manuallyStopped) {
        return;
    }

    const text = jsonMsg.toString();
    const cleanMsg = cleanMinecraftText(text);
    const lowerMsg = cleanMsg.toLowerCase();

    const customChat = parseCustomChatLine(cleanMsg);

    const customChatIsOwnRecentWebMessage = !!(
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

    const shouldShowMcLog =
        !BLOCKED_MC_LOG_PATTERNS.some(
            pattern => lowerMsg.includes(pattern)
        );

    if (
        shouldShowMcLog &&
        !customChat &&
        !isRecentChatMessage(state, cleanMsg) &&
        !(
            /^<[^>]{1,32}>\s/.test(cleanMsg) ||
            /^\[[^\]]{1,24}\]\s*\S{1,32}\s*[>:»]\s*/.test(cleanMsg) ||
            /^\S{1,32}\s*[>:»]\s+/.test(cleanMsg)
        )
    ) {
        addLog(state, `[MC] ${cleanMsg}`);
    }

    if (lowerMsg.includes('kingmc.vn')) {
        const kind = getLocationKind(bot);

        if (kind === 'login') {
            state.locationState = 'login';
            state.ready = false;
            if (state.status === 'afk' || state.status === 'online') {
                setBotStatus(state, 'authenticating');
            }
        } else if (kind === 'lobby') {
            state.locationState = 'lobby';
            state.ready = false;
            if (state.status === 'afk' || state.status === 'online') {
                setBotStatus(state, 'entering');
            }
        }

        return;
    }

    // Fallback registration/login messages are retained as a trigger,
    // but coordinate confirmation remains authoritative for status/flow.
    if (
        state.password &&
        (
            lowerMsg.includes('/dk') ||
            lowerMsg.includes('dang ky bang lenh') ||
            lowerMsg.includes('dang ky') ||
            lowerMsg.includes('/register')
        )
    ) {
        const kind = getLocationKind(bot);
        if (kind === 'login' && state.settings.autoReconnect) {
            const now = Date.now();
            if (
                now - state.lastAuthTime > 3000 &&
                now - state.lastLoginActionAt > 1500
            ) {
                state.lastAuthTime = now;
                state.lastLoginActionAt = now;
                try {
                    bot.chat(`/register ${state.password} ${state.password}`);
                    addLog(state, '[FLOW] Message register xác nhận → gửi /register.');
                } catch (err) {
                    addLog(state, `[FLOW] /register lỗi: ${err.message}`);
                }
            }
        }
        return;
    }

    if (
        state.password &&
        (
            lowerMsg.includes('/dn') ||
            lowerMsg.includes('vui long') ||
            lowerMsg.includes('dang nhap') ||
            lowerMsg.includes('/login')
        )
    ) {
        const kind = getLocationKind(bot);
        if (kind === 'login' && state.settings.autoReconnect) {
            const now = Date.now();
            if (
                now - state.lastAuthTime > 3000 &&
                now - state.lastLoginActionAt > 1500
            ) {
                state.lastAuthTime = now;
                state.lastLoginActionAt = now;
                try {
                    bot.chat(`/login ${state.password}`);
                    addLog(state, '[FLOW] Message login xác nhận → gửi /login.');
                } catch (err) {
                    addLog(state, `[FLOW] /login lỗi: ${err.message}`);
                }
            }
        }
    }
}

function startAfkRoutine(state, expectedBot = state.bot) {
    const bot = expectedBot;

    if (
        state.shuttingDown ||
        state.manuallyStopped ||
        !bot ||
        state.bot !== bot
    ) {
        return;
    }

    if (getLocationKind(bot) !== 'lobby') {
        state.ready = false;
        state.locationFlowBusy = false;
        return;
    }

    state.locationFlowBusy = true;
    clearAfkTimers(state);
    if (state.locationConfirmTimer) {
        clearTimeout(state.locationConfirmTimer);
        state.locationConfirmTimer = null;
    }
    state.pendingAfkConfirmation = false;
    state.ready = false;
    setBotStatus(state, 'entering');

    const menuCommands = ['/menu', '/gui'];
    const command = menuCommands[state.menuCommandIndex % menuCommands.length];

    const menuTimer = setTimeout(() => {
        if (
            state.shuttingDown ||
            state.manuallyStopped ||
            state.bot !== bot ||
            getLocationKind(bot) !== 'lobby'
        ) {
            return;
        }

        try {
            bot.chat(command);
            addLog(state, `[FLOW] Gửi ${command}.`);
        } catch (err) {
            addLog(state, `[FLOW] ${command} lỗi: ${err.message}`);
            scheduleLocationRetry(state, bot, 'lobby');
            return;
        }

        const clickTimer = setTimeout(() => {
            if (
                state.shuttingDown ||
                state.manuallyStopped ||
                state.bot !== bot
            ) {
                return;
            }

            const currentWindow = bot.currentWindow;

            if (!currentWindow) {
                state.menuCommandIndex++;
                state.locationFlowBusy = false;
                addLog(state, `Không có GUI sau ${command}. Sẽ thử lại flow.`);
                scheduleLocationRetry(state, bot, 'lobby');
                return;
            }

            try {
                if (getLocationKind(bot) !== 'lobby') {
                    state.ready = false;
                    return;
                }

                bot.clickWindow(24, 0, 0);

                state.ready = false;
                state.pendingAfkConfirmation = true;
                setBotStatus(state, 'entering');

                addLog(state, 'Đã click slot 24. Chờ xác nhận tọa độ trước khi đánh dấu AFK.');

                if (state.locationConfirmTimer) {
                    clearTimeout(state.locationConfirmTimer);
                }

                state.locationConfirmTimer = setTimeout(() => {
                    state.locationConfirmTimer = null;
                    confirmAfkAfterClick(state, bot);
                }, AFK_CONFIRM_DELAY_MS);
            } catch (err) {
                state.ready = false;
                state.pendingAfkConfirmation = false;
                state.locationFlowBusy = false;
                setBotStatus(state, 'entering');
                addLog(state, `Lỗi click slot 24: ${err.message}`);
                scheduleLocationRetry(state, bot, 'lobby');
            }
        }, AFK_MENU_CLICK_DELAY);

        state.afkTimers.push(clickTimer);
    }, AFK_MENU_DELAY);

    state.afkTimers.push(menuTimer);
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
  transition:background .15s ease,border-color .15s ease,transform .05s ease;
  border-radius:10px;
  background:#1a2530;
  color:var(--text);
  padding:9px 13px;
  cursor:pointer
}

button:hover:not(:disabled){
  background:#22313f
}

button:active:not(:disabled){
  transform:translateY(1px)
}

button:focus-visible,
input:focus-visible{
  outline:2px solid #4da3ff;
  outline-offset:2px
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


.setting-list{display:grid;gap:9px;margin-bottom:12px}
.check-row{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:10px;background:var(--card2);font-size:12px;cursor:pointer}
.check-row input{width:auto;accent-color:var(--blue)}
.schedule-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px;margin:10px 0}
.schedule-card{padding:9px;border:1px solid rgba(255,255,255,.08);border-radius:11px;background:linear-gradient(180deg,#151f29,#111a22);display:grid;gap:7px;box-shadow:0 5px 18px rgba(0,0,0,.14)}
.schedule-header{display:flex;align-items:center;justify-content:space-between;gap:8px}
.schedule-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:7px}
.schedule-field{display:grid;gap:4px}
.schedule-field>span{color:var(--muted);font-size:9px}
.schedule-field input,.schedule-field select,.schedule-card textarea{padding:8px 9px;border-radius:8px;font-size:11px}
.schedule-card textarea{min-height:66px;resize:vertical}
.schedule-actions{display:flex;justify-content:flex-end;gap:6px}
.hidden-field{display:none!important}
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
            DIMENSION / LOCATION
          </div>

          <div
            id="detailDimension"
            class="info-value"
          >
            -
          </div>
        </div>

        <div class="info-item">
          <div class="info-label">
            BOT IP
          </div>

          <div
            id="detailIp"
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
        <div style="display:flex;align-items:center;gap:7px;">
          <div id="chatRevision" class="revision">revision 0</div>
          <button class="small danger" type="button" onclick="clearChatHistory()">Xóa lịch sử</button>
        </div>
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
        <div style="display:flex;align-items:center;gap:7px;">
          <div id="eventRevision" class="revision">revision 0</div>
          <button class="small danger" type="button" onclick="clearEventHistory()">Xóa lịch sử</button>
        </div>
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

    <div id="settingsPanel" class="panel">

      <div class="chat-title-row">
        <h3>Settings</h3>
        <div class="revision">Lưu runtime + file setting</div>
      </div>

      <div class="setting-list">
        <label class="check-row"><input id="settingAutoTotem" type="checkbox"> <span>Auto Totem</span></label>
        <label class="check-row"><input id="settingAntiHungry" type="checkbox"> <span>Anti Hungry / Auto Eat</span></label>
        <label class="check-row"><input id="settingAutoReconnect" type="checkbox"> <span>Auto Reconnect + tự thử lại LOGIN/DN/MENU</span></label>
      </div>

      <button class="primary" type="button" onclick="saveSettings()">Lưu setting</button>
      <div class="note">Tọa độ được quét mỗi 250ms. AFK chỉ được xác nhận khi tọa độ sau click không còn ở LOGIN hoặc LOBBY.</div>

    </div>

    <div class="panel">

      <div class="chat-title-row">
        <h3>Auto Chat</h3>
        <button class="small primary" type="button" onclick="addAutoChatSchedule()">＋ Thêm lịch</button>
      </div>

      <div id="autoChatSchedules" class="schedule-list"></div>
      <div class="note">Có thể đặt nhiều lịch cố định hoặc lặp theo khoảng thời gian. Trong mỗi lịch có thể có nhiều tin nhắn và delay giữa từng tin.</div>
      <button class="primary" type="button" onclick="saveSettings()">Lưu Auto Chat</button>

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
          autocomplete="new-password" spellcheck="false"
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
        Khi service khởi động lại, bot sẽ dùng username/password trong BOT_CONFIG để tự kết nối lại.
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
'use strict';

let bot = null;
let inventory = null;
let autoChatSchedules = [];
let lastLogRevision = -1;
let lastChatRevision = -1;
let uptimeSyncAt = Date.now();

let draggedSlot = null;
let inventoryActionInFlight = false;
let refreshInFlight = false;
let refreshQueued = false;
let actionRequestInFlight = false;
let settingsDirty = false;
let settingsSaveInFlight = false;
let refreshGeneration = 0;

function byId(id) {
  return document.getElementById(id);
}


function invalidatePendingReads() {
  refreshGeneration++;
  return refreshGeneration;
}

function renderPublicIp() {
  const element = byId('detailIp');
  if (element) element.textContent = bot?.ipAddress || '-';
}

function renderSettings() {
  if (!bot) return;
  renderPublicSettings({ settings: bot.settings || {} });
}

function runQueuedRefresh() {
  if (
    refreshQueued &&
    !refreshInFlight &&
    !actionRequestInFlight &&
    !inventoryActionInFlight
  ) {
    refreshQueued = false;
    void refresh(true);
  }
}


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message) {
  const toast = byId('toast');
  if (!toast) return;

  toast.textContent = String(message || 'Đã xử lý.');
  toast.style.display = 'block';

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(function() {
    toast.style.display = 'none';
  }, 2600);
}

async function apiJson(url, options) {
  const original = options || {};
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(Number(original.timeoutMs))
    ? Math.max(1000, Math.min(30000, Number(original.timeoutMs)))
    : 15000;
  const timer = setTimeout(function() { controller.abort(); }, timeoutMs);
  const requestOptions = {
    cache: 'no-store',
    ...original,
    signal: original.signal || controller.signal
  };
  delete requestOptions.timeoutMs;

  try {
    const response = await fetch(url, requestOptions);
    const text = await response.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); }
      catch (_) { data = { raw: text }; }
    }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: {
        error: err && err.name === 'AbortError'
          ? 'Request web quá thời gian chờ.'
          : (err.message || 'Không thể kết nối server web.')
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function statusMeta(status, available) {
  if (!available) return ['red', 'OFFLINE / KHÔNG KẾT NỐI'];
  switch (status) {
    case 'afk': return ['green', 'AFK'];
    case 'online': return ['blue', 'ONLINE'];
    case 'connecting': return ['yellow', 'ĐANG KẾT NỐI'];
    case 'authenticating': return ['yellow', 'ĐANG ĐĂNG NHẬP'];
    case 'entering': return ['yellow', 'ĐANG VÀO AFK'];
    case 'kicked': return ['red', 'BỊ KICK'];
    case 'offline':
    default: return ['red', 'OFFLINE'];
  }
}

function renderDimensionLocation() {
  const element = byId('detailDimension');
  if (!element) return;

  const dimension = bot && bot.dimension ? String(bot.dimension) : '-';
  const location = String(bot && bot.locationState || '').toLowerCase();
  const position = bot && bot.roundedLocation;

  let locationLabel = '';
  if (location === 'login') locationLabel = 'LOGIN';
  else if (location === 'lobby') locationLabel = 'LOBBY';
  else if (location === 'other') locationLabel = 'OTHER';

  if (position && Number.isFinite(Number(position.x)) &&
      Number.isFinite(Number(position.y)) &&
      Number.isFinite(Number(position.z))) {
    const coord = '(' +
      Math.round(Number(position.x)) + ' ' +
      Math.round(Number(position.y)) + ' ' +
      Math.round(Number(position.z)) + ')';

    if (locationLabel) {
      element.textContent = dimension + ' • ' + locationLabel + ' ' + coord;
    } else {
      element.textContent = dimension + ' • ' + coord;
    }
    return;
  }

  element.textContent = locationLabel
    ? dimension + ' • ' + locationLabel
    : dimension;
}

function renderBotState() {
  if (!bot) return;

  const statusInfo = statusMeta(bot.status, bot.available !== false);
  const status = byId('detailStatus');
  if (status) {
    status.innerHTML =
      '<span class="dot ' + statusInfo[0] + '"></span>' +
      escapeHtml(statusInfo[1]);
  }

  const title = byId('detailTitle');
  if (title) title.textContent = bot.label || 'KingMC Bot';

  const username = byId('detailUsername');
  if (username) username.textContent = bot.username || 'Chưa đặt';

  const host = byId('detailHost');
  if (host) {
    host.textContent = bot.host
      ? String(bot.host) + ':' + String(bot.port ?? '')
      : '-';
  }

  const ping = byId('detailPing');
  if (ping) ping.textContent =
    bot.ping == null ? '--' : String(bot.ping) + ' ms';

  const reconnects = byId('detailReconnects');
  if (reconnects) reconnects.textContent = String(bot.reconnectCount || 0);

  const position = byId('detailPosition');
  const p = bot.position;

  if (position) {
    position.textContent =
      p && Number.isFinite(Number(p.x)) &&
      Number.isFinite(Number(p.y)) &&
      Number.isFinite(Number(p.z))
        ? Math.round(Number(p.x)) + ' ' +
          Math.round(Number(p.y)) + ' ' +
          Math.round(Number(p.z))
        : '-';
  }

  const ip = byId('detailIp');
  if (ip) ip.textContent = bot.ipAddress || '-';

  renderDimensionLocation();
}

function renderPublicSettings(settingsData) {
  if (!settingsData || !settingsData.settings) return;

  const settings = settingsData.settings;
  const autoTotem = byId('settingAutoTotem');
  const antiHungry = byId('settingAntiHungry');
  const autoReconnect = byId('settingAutoReconnect');

  if (autoTotem) autoTotem.checked = settings.autoTotem !== false;
  if (antiHungry) antiHungry.checked = settings.antiHungry !== false;
  if (autoReconnect) autoReconnect.checked = settings.autoReconnect !== false;
}

function scheduleFieldVisibility(card) {
  if (!card) return;

  const modeElement = card.querySelector('[data-field="mode"]');
  const mode = modeElement && modeElement.value === 'fixed'
    ? 'fixed'
    : 'interval';

  const intervalField = card.querySelector('[data-role="interval-field"]');
  const fixedField = card.querySelector('[data-role="fixed-field"]');

  if (intervalField) {
    intervalField.classList.toggle('hidden-field', mode !== 'interval');
  }

  if (fixedField) {
    fixedField.classList.toggle('hidden-field', mode !== 'fixed');
  }
}

function clampClientNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeScheduleForClient(schedule, index) {
  const raw = schedule && typeof schedule === 'object' ? schedule : {};
  const mode = raw.mode === 'fixed' ? 'fixed' : 'interval';

  return {
    id: String(raw.id || (Date.now() + '-' + index)),
    enabled: raw.enabled !== false,
    mode: mode,
    intervalSeconds: clampClientNumber(raw.intervalSeconds, 3600, 10, 604800),
    times: Array.isArray(raw.times)
      ? raw.times.map(function(value) { return String(value || '').trim(); }).filter(Boolean)
      : [],
    messages: Array.isArray(raw.messages)
      ? raw.messages.map(function(value) { return String(value || '').trim(); }).filter(Boolean)
      : [],
    messageDelaySeconds: clampClientNumber(raw.messageDelaySeconds, 0, 0, 3600)
  };
}

function renderAutoChatSchedules(schedules) {
  const box = byId('autoChatSchedules');
  if (!box) return;

  const list = Array.isArray(schedules)
    ? schedules.map(normalizeScheduleForClient)
    : [];

  autoChatSchedules = list;

  if (!list.length) {
    box.innerHTML =
      '<div class="note">Chưa có lịch auto chat. Bấm “＋ Thêm lịch” để tạo.</div>';
    return;
  }

  box.innerHTML = list.map(function(schedule, index) {
    const intervalHidden = schedule.mode === 'fixed'
      ? ' hidden-field'
      : '';

    const fixedHidden = schedule.mode === 'fixed'
      ? ''
      : ' hidden-field';

    const checked = schedule.enabled ? ' checked' : '';

    return '' +
      '<div class="schedule-card" data-index="' + index +
        '" data-id="' + escapeHtml(schedule.id) + '">' +
        '<div class="schedule-header">' +
          '<strong>Lịch #' + (index + 1) + '</strong>' +
          '<div style="display:flex;align-items:center;gap:6px;">' +
            '<label class="check-row" style="margin:0;padding:4px 7px;">' +
              '<input data-field="enabled" type="checkbox"' + checked + '>' +
              '<span>Bật</span>' +
            '</label>' +
            '<button class="small danger" type="button" onclick="removeAutoChatSchedule(' +
              index + ')">Xóa</button>' +
          '</div>' +
        '</div>' +

        '<div class="schedule-grid">' +
          '<label class="schedule-field">' +
            '<span>Kiểu</span>' +
            '<select data-field="mode" onchange="scheduleModeChanged(this)">' +
              '<option value="interval"' +
                (schedule.mode === 'interval' ? ' selected' : '') +
                '>Lặp lại</option>' +
              '<option value="fixed"' +
                (schedule.mode === 'fixed' ? ' selected' : '') +
                '>Cố định</option>' +
            '</select>' +
          '</label>' +

          '<label class="schedule-field' + intervalHidden +
            '" data-role="interval-field">' +
            '<span>Khoảng lặp (giây)</span>' +
            '<input data-field="intervalSeconds" type="number" min="10" max="604800" value="' +
              schedule.intervalSeconds + '">' +
          '</label>' +

          '<label class="schedule-field' + fixedHidden +
            '" data-role="fixed-field" style="grid-column:1/-1;">' +
            '<span>Giờ cố định (HH:mm, cách nhau bằng dấu phẩy)</span>' +
            '<input data-field="times" value="' +
              escapeHtml(schedule.times.join(', ')) +
              '" placeholder="08:00, 12:00, 18:00">' +
          '</label>' +
        '</div>' +

        '<label class="schedule-field">' +
          '<span>Delay giữa từng tin (giây)</span>' +
          '<input data-field="messageDelaySeconds" type="number" min="0" max="3600" value="' +
            schedule.messageDelaySeconds + '">' +
        '</label>' +

        '<label class="schedule-field">' +
          '<span>Tin nhắn — mỗi dòng một tin</span>' +
          '<textarea class="schedule-messages" data-field="messages" placeholder="Tin 1&#10;Tin 2&#10;Tin 3">' +
            escapeHtml(schedule.messages.join('\\n')) +
          '</textarea>' +
        '</label>' +
      '</div>';
  }).join('');

  box.querySelectorAll('.schedule-card').forEach(scheduleFieldVisibility);
}

function markSettingsDirty() {
  settingsDirty = true;
}

function collectAutoChatSchedules() {
  const box = byId('autoChatSchedules');
  if (!box) return [];

  const cards = Array.from(box.querySelectorAll('.schedule-card'));

  return cards.map(function(card, index) {
    const get = function(field) {
      return card.querySelector('[data-field="' + field + '"]');
    };

    const mode = get('mode') && get('mode').value === 'fixed'
      ? 'fixed'
      : 'interval';

    const id = card.dataset.id ||
      (autoChatSchedules[index] && autoChatSchedules[index].id) ||
      (Date.now() + '-' + index);

    card.dataset.id = id;

    const rawMessages = String(
      get('messages') ? get('messages').value : ''
    );

    const messages = rawMessages
      .split(/\\r?\\n/)
      .map(function(value) { return value.trim(); })
      .filter(Boolean);

    const rawTimes = String(
      get('times') ? get('times').value : ''
    );

    const times = rawTimes
      .split(/[,\\n]+/)
      .map(function(value) { return value.trim(); })
      .filter(Boolean);

    return {
      id: id,
      enabled: !!(get('enabled') && get('enabled').checked),
      mode: mode,
      intervalSeconds: clampClientNumber(
        get('intervalSeconds') && get('intervalSeconds').value,
        3600,
        10,
        604800
      ),
      times: times,
      messages: messages,
      messageDelaySeconds: clampClientNumber(
        get('messageDelaySeconds') && get('messageDelaySeconds').value,
        0,
        0,
        3600
      )
    };
  });
}

function validateAutoChatSchedules(schedules) {
  const validTime = /^([01]\\d|2[0-3]):[0-5]\\d$/;

  for (let i = 0; i < schedules.length; i++) {
    const schedule = schedules[i];

    if (!schedule.messages.length) {
      return 'Lịch #' + (i + 1) + ' chưa có tin nhắn.';
    }

    if (schedule.mode === 'fixed') {
      if (!schedule.times.length) {
        return 'Lịch #' + (i + 1) + ' chưa có giờ cố định.';
      }

      for (const value of schedule.times) {
        if (!validTime.test(value)) {
          return 'Lịch #' + (i + 1) + ' có giờ không hợp lệ: ' + value;
        }
      }
    }
  }

  return '';
}

function scheduleModeChanged(select) {
  scheduleFieldVisibility(select ? select.closest('.schedule-card') : null);
  markSettingsDirty();
}

function addAutoChatSchedule() {
  const current = collectAutoChatSchedules();

  current.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    enabled: true,
    mode: 'interval',
    intervalSeconds: 3600,
    times: [],
    messages: [''],
    messageDelaySeconds: 2
  });

  settingsDirty = true;
  renderAutoChatSchedules(current);

  const cards = byId('autoChatSchedules')
    ? byId('autoChatSchedules').querySelectorAll('.schedule-card')
    : [];

  const last = cards.length ? cards[cards.length - 1] : null;
  const input = last
    ? last.querySelector('[data-field="messages"]')
    : null;

  if (input) input.focus();
}

function removeAutoChatSchedule(index) {
  const current = collectAutoChatSchedules();
  current.splice(index, 1);
  settingsDirty = true;
  renderAutoChatSchedules(current);
}

async function saveSettings() {
  if (settingsSaveInFlight) return;

  const schedules = collectAutoChatSchedules();
  const validationError = validateAutoChatSchedules(schedules);

  if (validationError) {
    showToast(validationError);
    return;
  }

  const payload = {
    settings: {
      autoTotem: !!(byId('settingAutoTotem') && byId('settingAutoTotem').checked),
      antiHungry: !!(byId('settingAntiHungry') && byId('settingAntiHungry').checked),
      autoReconnect: !!(byId('settingAutoReconnect') && byId('settingAutoReconnect').checked)
    },
    autoChatSchedules: schedules
  };

  settingsSaveInFlight = true;
  setSettingsButtonsDisabled(true);

  try {
    const result = await apiJson('/api/settings', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });

    if (!result.ok) {
      showToast(result.data.error || 'Lưu setting thất bại.');
      return;
    }

    settingsDirty = false;

    const serverSchedules = Array.isArray(result.data.autoChatSchedules)
      ? result.data.autoChatSchedules
      : payload.autoChatSchedules;

    renderPublicSettings(result.data);
    renderAutoChatSchedules(serverSchedules);
    showToast(result.data.message || 'Đã lưu setting.');
  } catch (err) {
    showToast(err.message || 'Không thể kết nối server web.');
  } finally {
    settingsSaveInFlight = false;
    setSettingsButtonsDisabled(false);
  }
}

function setSettingsButtonsDisabled(disabled) {
  document.querySelectorAll('#settingsPanel button, #settingsPanel input, #settingsPanel select, #settingsPanel textarea, #autoChatSchedules button, #autoChatSchedules input, #autoChatSchedules select, #autoChatSchedules textarea, [data-settings-action]').forEach(function(element) {
    element.disabled = !!disabled;
  });
}

async function startBot() {
  return runBotAction('start');
}

async function stopBot() {
  return runBotAction('stop');
}

async function restartBot() {
  return runBotAction('restart');
}

async function runBotAction(action) {
  if (actionRequestInFlight) return;

  actionRequestInFlight = true;

  const buttons = [
    byId('startButton'),
    byId('stopButton'),
    byId('restartButton')
  ];

  buttons.forEach(function(button) {
    if (button) button.disabled = true;
  });

  showToast(
    action === 'start'
      ? 'Đang chạy bot...'
      : action === 'stop'
        ? 'Đang dừng bot...'
        : 'Đang khởi động lại bot...'
  );

  try {
    const result = await apiJson('/api/bot/' + action, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}'
    });

    showToast(
      result.data.message ||
      result.data.error ||
      (result.ok ? 'Đã xử lý.' : 'Thao tác thất bại.')
    );

    await refresh(true);
  } catch (err) {
    showToast(err.message || 'Không thể kết nối server web.');
  } finally {
    actionRequestInFlight = false;
    buttons.forEach(function(button) {
      if (button) button.disabled = false;
    });
  }
}

async function sendMessage(event) {
  event.preventDefault();

  const input = byId('messageInput');
  const text = input ? input.value : '';

  if (!text.trim()) return;

  const result = await apiJson('/api/bot/send', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({text: text})
  });

  if (result.ok && input) input.value = '';

  showToast(
    result.data.message ||
    result.data.error ||
    (result.ok ? 'Đã gửi.' : 'Gửi thất bại.')
  );

  if (result.ok) {
    await loadChatLogs(true);
  }
}

async function clearEventHistory() {
  if (!confirm('Xóa toàn bộ Event Log?')) return;

  const result = await apiJson('/api/bot/logs/clear', {
    method: 'POST'
  });

  if (result.ok) {
    lastLogRevision = -1;
    await loadLogs(true);
  }

  showToast(
    result.data.message ||
    result.data.error ||
    'Đã xử lý.'
  );
}

async function clearChatHistory() {
  if (!confirm('Xóa toàn bộ Chat Log?')) return;

  const result = await apiJson('/api/bot/chat-logs/clear', {
    method: 'POST'
  });

  if (result.ok) {
    lastChatRevision = -1;
    await loadChatLogs(true);
  }

  showToast(
    result.data.message ||
    result.data.error ||
    'Đã xử lý.'
  );
}

async function saveAccount() {
  const usernameInput = byId('usernameInput');
  const passwordInput = byId('passwordInput');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  if (!username && !password) {
    showToast('Nhập username hoặc password cần thay đổi.');
    return;
  }

  const result = await apiJson('/api/bot/account', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      username: username,
      password: password
    })
  });

  if (result.ok) {
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    await refresh(true);
  }

  showToast(
    result.data.message ||
    result.data.error ||
    'Đã xử lý.'
  );
}

function itemLabel(item) {
  if (!item) return '-';
  const name = item.displayName || item.name || '-';
  const count = Number(item.count || 0);
  return String(name).replace(/_/g, ' ') +
    (count > 1 ? ' x' + count : '');
}

function createInventorySlot(item, slot, selected) {
  const el = document.createElement('div');

  el.className =
    'inventory-slot' +
    (item ? '' : ' empty') +
    (selected ? ' selected' : '');

  el.draggable = !!item;
  el.dataset.slot = String(slot);

  el.ondragstart = function(event) {
    draggedSlot = slot;

    try {
      event.dataTransfer.setData('text/plain', String(slot));
      event.dataTransfer.effectAllowed = 'move';
    } catch (_) {}
  };

  el.ondragover = allowDrop;
  el.ondragleave = clearDragOver;
  el.ondrop = function(event) {
    dropInventorySlot(event, slot);
  };

  if (slot >= 36 && slot <= 44) {
    el.onclick = function() {
      selectHotbar(slot - 36);
    };
  }

  const index = document.createElement('div');
  index.className = 'slot-index';
  index.textContent = slot >= 36
    ? String(slot - 35)
    : String(slot - 8);

  const name = document.createElement('div');
  name.className = 'slot-name';
  name.textContent = itemLabel(item);

  const count = document.createElement('div');
  count.className = 'slot-count';
  count.textContent = item && Number(item.count || 0) > 1
    ? String(item.count)
    : '';

  el.appendChild(index);
  el.appendChild(name);
  el.appendChild(count);

  return el;
}

function renderInventory() {
  if (!inventory) return;

  const health = Math.max(
    0,
    Math.min(20, Number(inventory.health || 0))
  );

  const food = Math.max(
    0,
    Math.min(20, Number(inventory.food || 0))
  );

  const healthElement = byId('inventoryHealth');
  const foodElement = byId('inventoryFood');

  if (healthElement) healthElement.textContent =
    health.toFixed(1) + ' / 20';

  if (foodElement) foodElement.textContent =
    food.toFixed(1) + ' / 20';

  const healthBar = byId('inventoryHealthBar');
  const foodBar = byId('inventoryFoodBar');

  if (healthBar) healthBar.style.width =
    (health / 20 * 100) + '%';

  if (foodBar) foodBar.style.width =
    (food / 20 * 100) + '%';

  const golden = byId('inventoryGoldenApple');
  const totem = byId('inventoryTotem');
  const offhand = byId('inventoryOffhand');
  const foodCount = byId('inventoryFoodCount');

  if (golden) golden.textContent =
    String(inventory.goldenAppleCount || 0);

  if (totem) totem.textContent =
    String(inventory.totemCount || 0);

  if (offhand) offhand.textContent =
    String(inventory.offhand || '-').replace(/_/g, ' ');

  if (foodCount) foodCount.textContent =
    String(inventory.foodCount || 0);

  const armor = inventory.armor || {};

  if (byId('equipHead')) byId('equipHead').textContent = itemLabel(armor.head);
  if (byId('equipTorso')) byId('equipTorso').textContent = itemLabel(armor.torso);
  if (byId('equipLegs')) byId('equipLegs').textContent = itemLabel(armor.legs);
  if (byId('equipFeet')) byId('equipFeet').textContent = itemLabel(armor.feet);

  const off = inventory.slots
    ? inventory.slots['45']
    : null;

  if (byId('equipOffhand')) {
    byId('equipOffhand').textContent = itemLabel(off);
  }

  const revision = byId('inventoryRevision');
  if (revision) revision.textContent =
    'revision ' + String(inventory.revision || 0);

  const slots = inventory.slots || {};
  const main = byId('mainInventory');
  const hotbar = byId('inventoryHotbar');

  if (main) {
    main.innerHTML = '';
    for (let slot = 9; slot <= 35; slot++) {
      main.appendChild(
        createInventorySlot(
          slots[String(slot)] || null,
          slot,
          false
        )
      );
    }
  }

  if (hotbar) {
    hotbar.innerHTML = '';

    const selected = Number(
      inventory.selectedHotbar ??
      inventory.selectedSlot ??
      0
    );

    for (let slot = 36; slot <= 44; slot++) {
      hotbar.appendChild(
        createInventorySlot(
          slots[String(slot)] || null,
          slot,
          slot - 36 === selected
        )
      );
    }
  }
}

function allowDrop(event) {
  event.preventDefault();

  try {
    event.dataTransfer.dropEffect = 'move';
  } catch (_) {}

  if (event.currentTarget && event.currentTarget.classList) {
    event.currentTarget.classList.add('dragover');
  }
}

function clearDragOver(event) {
  if (event.currentTarget && event.currentTarget.classList) {
    event.currentTarget.classList.remove('dragover');
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

  draggedSlot = slotMap[destination];

  try {
    event.dataTransfer.setData(
      'text/plain',
      String(draggedSlot)
    );
    event.dataTransfer.effectAllowed = 'move';
  } catch (_) {}
}

function getDragSource(event) {
  let source = draggedSlot;

  try {
    const value = event.dataTransfer.getData('text/plain');

    if (value !== '') {
      const parsed = Number(value);

      if (Number.isInteger(parsed)) {
        source = parsed;
      }
    }
  } catch (_) {}

  draggedSlot = null;
  return Number.isInteger(source) ? source : null;
}

async function dropInventorySlot(event, destinationSlot) {
  event.preventDefault();
  clearDragOver(event);

  const sourceSlot = getDragSource(event);

  if (
    !Number.isInteger(sourceSlot) ||
    sourceSlot === destinationSlot
  ) {
    return;
  }

  if (sourceSlot >= 5 && sourceSlot <= 8) {
    const map = {
      5: 'head',
      6: 'torso',
      7: 'legs',
      8: 'feet'
    };

    await unequipAndMove(map[sourceSlot], destinationSlot);
    return;
  }

  if (sourceSlot === 45) {
    await unequipAndMove('off-hand', destinationSlot);
    return;
  }

  await moveInventoryItem(
    sourceSlot,
    destinationSlot
  );
}

async function unequipAndMove(destination, destinationSlot) {
  const result = await postInventory(
    '/inventory/unequip',
    {
      destination: destination,
      revision: inventory
        ? inventory.revision
        : 0
    }
  );

  if (!result.ok) {
    showToast(result.data.error || 'Không thể tháo trang bị.');
    return;
  }

  if (result.data.inventory) {
    inventory = result.data.inventory;
    renderInventory();
  }

  const slots = inventory && inventory.slots
    ? inventory.slots
    : {};

  let sourceSlot = null;

  for (let slot = 9; slot <= 35; slot++) {
    const item = slots[String(slot)];
    if (item && item.name) {
      sourceSlot = slot;
      break;
    }
  }

  if (
    sourceSlot !== null &&
    sourceSlot !== destinationSlot
  ) {
    await moveInventoryItem(
      sourceSlot,
      destinationSlot
    );
  }
}

async function moveInventoryItem(sourceSlot, destSlot) {
  if (inventoryActionInFlight || !inventory) return;

  inventoryActionInFlight = true;

  try {
    const result = await postInventory(
      '/inventory/move',
      {
        sourceSlot: sourceSlot,
        destSlot: destSlot,
        revision: inventory.revision
      }
    );

    if (result.data.inventory) {
      inventory = result.data.inventory;
      renderInventory();
    }

    showToast(
      result.data.message ||
      result.data.error ||
      (result.ok ? 'Đã di chuyển item.' : 'Di chuyển thất bại.')
    );

    if (!result.ok && result.status === 409) {
      await refresh(true);
    }
  } finally {
    inventoryActionInFlight = false;
  }
}

function dropItemToWorld(event) {
  event.preventDefault();
  clearDragOver(event);

  const sourceSlot = getDragSource(event);

  if (!Number.isInteger(sourceSlot)) return;

  if (sourceSlot >= 5 && sourceSlot <= 8) {
    unequipEquipment(
      ['head', 'torso', 'legs', 'feet'][sourceSlot - 5]
    );
    return;
  }

  if (sourceSlot === 45) {
    unequipEquipment('off-hand');
    return;
  }

  dropInventoryItem(sourceSlot);
}

async function dropInventoryItem(sourceSlot) {
  if (inventoryActionInFlight || !inventory) return;

  inventoryActionInFlight = true;

  try {
    const result = await postInventory(
      '/inventory/drop',
      {
        sourceSlot: sourceSlot,
        revision: inventory.revision
      }
    );

    if (result.data.inventory) {
      inventory = result.data.inventory;
      renderInventory();
    }

    showToast(
      result.data.message ||
      result.data.error ||
      (result.ok ? 'Đã vứt item.' : 'Vứt item thất bại.')
    );

    if (!result.ok && result.status === 409) {
      await refresh(true);
    }
  } finally {
    inventoryActionInFlight = false;
  }
}

async function dropEquip(event, destination) {
  event.preventDefault();
  clearDragOver(event);

  const sourceSlot = getDragSource(event);

  if (!Number.isInteger(sourceSlot)) return;

  if (
    (sourceSlot >= 5 && sourceSlot <= 8) ||
    sourceSlot === 45
  ) {
    showToast('Không thể lấy item từ equipment để equip vào chính equipment.');
    return;
  }

  await equipDetailItem(sourceSlot, destination);
}

async function equipDetailItem(sourceSlot, destination) {
  if (inventoryActionInFlight || !inventory) return;

  inventoryActionInFlight = true;

  try {
    const result = await postInventory(
      '/inventory/equip',
      {
        sourceSlot: sourceSlot,
        destination: destination,
        revision: inventory.revision
      }
    );

    if (result.data.inventory) {
      inventory = result.data.inventory;
      renderInventory();
    }

    showToast(
      result.data.message ||
      result.data.error ||
      (result.ok ? 'Đã trang bị item.' : 'Trang bị thất bại.')
    );

    if (!result.ok && result.status === 409) {
      await refresh(true);
    }
  } finally {
    inventoryActionInFlight = false;
  }
}

async function unequipEquipment(destination) {
  if (inventoryActionInFlight || !inventory) return;

  inventoryActionInFlight = true;

  try {
    const result = await postInventory(
      '/inventory/unequip',
      {
        destination: destination,
        revision: inventory.revision
      }
    );

    if (result.data.inventory) {
      inventory = result.data.inventory;
      renderInventory();
    }

    showToast(
      result.data.message ||
      result.data.error ||
      (result.ok ? 'Đã tháo trang bị.' : 'Tháo trang bị thất bại.')
    );

    if (!result.ok && result.status === 409) {
      await refresh(true);
    }
  } finally {
    inventoryActionInFlight = false;
  }
}

async function selectHotbar(slot) {
  if (inventoryActionInFlight || !inventory) return;

  inventoryActionInFlight = true;

  try {
    const result = await postInventory(
      '/inventory/select',
      {
        slot: slot,
        revision: inventory.revision
      }
    );

    if (result.data.inventory) {
      inventory = result.data.inventory;
      renderInventory();
    }

    showToast(
      result.data.message ||
      result.data.error ||
      (result.ok ? 'Đã chọn hotbar.' : 'Không thể chọn hotbar.')
    );

    if (!result.ok && result.status === 409) {
      await refresh(true);
    }
  } finally {
    inventoryActionInFlight = false;
  }
}

async function postInventory(path, body) {
  return apiJson(path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
}

function nearBottom(box) {
  if (!box) return true;
  return box.scrollHeight - box.scrollTop - box.clientHeight < 24;
}

async function loadLogs(force) {
  const box = byId('logs');
  if (!box) return;

  if (!force && bot && lastLogRevision === Number(bot.logRevision)) {
    return;
  }

  try {
    const result = await apiJson('/api/bot/logs');

    if (!result.ok) return;

    const logs = Array.isArray(result.data.logs)
      ? result.data.logs
      : [];

    const keep = nearBottom(box);

    box.innerHTML = logs.map(function(line) {
      return '<div class="line">' +
        escapeHtml(line) +
        '</div>';
    }).join('');

    lastLogRevision = Number(result.data.revision || 0);

    const revision = byId('eventRevision');
    if (revision) revision.textContent =
      'revision ' + lastLogRevision;

    if (keep) box.scrollTop = box.scrollHeight;
  } catch (err) {
    console.error('[BOT UI] loadLogs', err);
  }
}

async function loadChatLogs(force) {
  const box = byId('chatLogs');
  if (!box) return;

  if (!force && bot &&
      lastChatRevision === Number(bot.chatLogRevision)) {
    return;
  }

  try {
    const result = await apiJson('/api/bot/chat-logs');

    if (!result.ok) return;

    const logs = Array.isArray(result.data.logs)
      ? result.data.logs
      : [];

    const keep = nearBottom(box);

    box.innerHTML = logs.map(function(line) {
      return '<div class="line">' +
        escapeHtml(line) +
        '</div>';
    }).join('');

    lastChatRevision = Number(result.data.revision || 0);

    const revision = byId('chatRevision');
    if (revision) revision.textContent =
      'revision ' + lastChatRevision;

    if (keep) box.scrollTop = box.scrollHeight;
  } catch (err) {
    console.error('[BOT UI] loadChatLogs', err);
  }
}

async function refresh(force) {
  if (refreshInFlight) {
    if (force) refreshQueued = true;
    return;
  }

  refreshInFlight = true;
  const generation = ++refreshGeneration;

  try {
    const result = await apiJson('/api/snapshot');

    if (
      generation !== refreshGeneration
    ) {
      return;
    }

    if (!result.ok) {
      showToast(
        result.data.error ||
        'Không thể lấy trạng thái bot.'
      );
      return;
    }

    if (result.data.bot) {
      bot = result.data.bot;
      uptimeSyncAt = Date.now();
      renderBotState();
    }

    if (result.data.inventory) {
      inventory = result.data.inventory;
      renderInventory();
    }

    if (!settingsDirty && result.data.settings) {
      renderPublicSettings(result.data.settings);

      if (Array.isArray(result.data.settings.autoChatSchedules)) {
        renderAutoChatSchedules(
          result.data.settings.autoChatSchedules
        );
      }
    }

    await Promise.all([
      loadLogs(false),
      loadChatLogs(false)
    ]);
  } catch (err) {
    console.error('[BOT UI] refresh', err);
    showToast('Không thể kết nối tới server web.');
  } finally {
    refreshInFlight = false;

    if (
      refreshQueued &&
      !actionRequestInFlight &&
      !inventoryActionInFlight
    ) {
      refreshQueued = false;
      void refresh(true);
    }
  }
}

function markSettingsInputDirty(event) {
  const target = event.target;
  if (!target) return;

  if (
    target.id === 'settingAutoTotem' ||
    target.id === 'settingAntiHungry' ||
    target.id === 'settingAutoReconnect' ||
    (target.closest && target.closest('#autoChatSchedules'))
  ) {
    markSettingsDirty();
  }
}

function updateUptimeDisplay() {
  if (!bot) return;

  const syncedSeconds = Number(bot.uptimeSeconds || 0);
  const elapsed = bot.status === 'afk'
    ? Math.floor((Date.now() - uptimeSyncAt) / 1000)
    : 0;

  const total = Math.min(
    syncedSeconds + elapsed,
    (999 * 60 * 60) - 1
  );

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const element = byId('detailUptime');

  if (element) {
    element.textContent =
      hours + 'h ' +
      minutes + 'm ' +
      seconds + 's';
  }
}

document.addEventListener('input', markSettingsInputDirty);
document.addEventListener('change', markSettingsInputDirty);

window.addAutoChatSchedule = addAutoChatSchedule;
window.allowDrop = allowDrop;
window.clearChatHistory = clearChatHistory;
window.clearDragOver = clearDragOver;
window.clearEventHistory = clearEventHistory;
window.dropEquip = dropEquip;
window.dropItemToWorld = dropItemToWorld;
window.refresh = refresh;
window.removeAutoChatSchedule = removeAutoChatSchedule;
window.restartBot = restartBot;
window.saveAccount = saveAccount;
window.saveSettings = saveSettings;
window.scheduleModeChanged = scheduleModeChanged;
window.sendMessage = sendMessage;
window.showToast = showToast;
window.startBot = startBot;
window.startEquipmentDrag = startEquipmentDrag;
window.stopBot = stopBot;
window.unequipEquipment = unequipEquipment;

window.invalidatePendingReads = invalidatePendingReads;
window.renderPublicIp = renderPublicIp;
window.renderSettings = renderSettings;
window.runQueuedRefresh = runQueuedRefresh;
window.addEventListener('error', function(event) {
  try {
    console.error(
      '[BOT UI]',
      event.error || event.message || 'Unknown UI error'
    );
  } catch (_) {}
});

window.addEventListener('unhandledrejection', function(event) {
  try {
    console.error(
      '[BOT UI] Unhandled rejection',
      event.reason
    );
  } catch (_) {}
});

window.startBot = startBot;
window.stopBot = stopBot;
window.restartBot = restartBot;
window.sendMessage = sendMessage;
window.addAutoChatSchedule = addAutoChatSchedule;
window.removeAutoChatSchedule = removeAutoChatSchedule;
window.scheduleModeChanged = scheduleModeChanged;
window.saveSettings = saveSettings;
window.clearEventHistory = clearEventHistory;
window.clearChatHistory = clearChatHistory;
window.saveAccount = saveAccount;
window.allowDrop = allowDrop;
window.clearDragOver = clearDragOver;
window.startEquipmentDrag = startEquipmentDrag;
window.dropEquip = dropEquip;
window.dropItemToWorld = dropItemToWorld;
window.unequipEquipment = unequipEquipment;

(async function init() {
  await refresh(true);
})();

setInterval(function() {
  if (!settingsSaveInFlight) {
    void refresh(false);
  }
}, 1000);

setInterval(updateUptimeDisplay, 250);
</script>


</body>
</html>`;

// -----------------------------------------------------------------------------
// API: atomic-ish dashboard snapshot
// -----------------------------------------------------------------------------

app.get(
    '/api/snapshot',
    (req, res) => {
        res.json({
            ok: true,
            bot: publicBotState(botState),
            inventory: publicInventoryState(botState),
            settings: publicSettingsState(botState)
        });
    }
);

app.get(
    '/api/diagnostics',
    (req, res) => {
        const memory = process.memoryUsage();

        res.json({
            ok: true,
            pid: process.pid,
            node: process.version,
            processUptimeSeconds: Math.floor(process.uptime()),
            memory: {
                rss: memory.rss,
                heapUsed: memory.heapUsed,
                heapTotal: memory.heapTotal,
                external: memory.external,
                arrayBuffers: memory.arrayBuffers
            },
            botListeners: botState.bot
                ? botState.bot.eventNames().reduce((total, name) => {
                    return total + botState.bot.listenerCount(name);
                }, 0)
                : 0,
            reconnectCount: botState.reconnectCount,
            reconnectAttempts: botState.reconnectAttempts,
            status: botState.status
        });
    }
);

// -----------------------------------------------------------------------------
// Settings / automation / history management
// -----------------------------------------------------------------------------

function publicSettingsState(state) {
    return {
        settings: {
            autoTotem: state.settings.autoTotem !== false,
            antiHungry: state.settings.antiHungry !== false,
            autoReconnect: state.settings.autoReconnect !== false
        },
        autoChatSchedules: sanitizeAutoChatSchedules(state.autoChatSchedules).map(schedule => ({
            id: schedule.id,
            enabled: schedule.enabled !== false,
            mode: schedule.mode,
            intervalSeconds: schedule.intervalSeconds,
            times: schedule.times,
            messages: schedule.messages,
            messageDelaySeconds: schedule.messageDelaySeconds
        }))
    };
}

app.get('/api/settings', (req, res) => {
    res.json({
        ok: true,
        ...publicSettingsState(botState)
    });
});

app.post('/api/settings', (req, res) => {
    const body = req.body && typeof req.body === 'object'
        ? req.body
        : {};

    const incoming = body.settings && typeof body.settings === 'object'
        ? body.settings
        : body;

    const nextSettings = {
        autoTotem: incoming.autoTotem !== false,
        antiHungry: incoming.antiHungry !== false,
        autoReconnect: incoming.autoReconnect !== false
    };

    const schedules = sanitizeAutoChatSchedules(body.autoChatSchedules);

    const runtimeSchedules = sanitizeAutoChatSchedules(schedules);
    for (const schedule of runtimeSchedules) {
        schedule.lastIntervalRunAt = Date.now();
        schedule.lastFixedRunKey = '';
        schedule.running = false;
    }

    const persisted = saveBotSettingsFile(
        nextSettings,
        runtimeSchedules
    );

    if (!persisted) {
        return res.status(500).json({
            error: 'Không thể ghi bot_settings.json; runtime chưa được thay đổi.'
        });
    }

    botState.settings = nextSettings;
    botState.autoChatGeneration++;
    botState.autoChatSchedules = runtimeSchedules;

    addLog(
        botState,
        `[SETTING] Auto Totem=${nextSettings.autoTotem ? 'ON' : 'OFF'} | Anti Hungry=${nextSettings.antiHungry ? 'ON' : 'OFF'} | Auto Reconnect=${nextSettings.autoReconnect ? 'ON' : 'OFF'}.`
    );

    if (!nextSettings.autoReconnect) {
        if (botState.reconnectTimer) {
            clearTimeout(botState.reconnectTimer);
            botState.reconnectTimer = null;
        }
        if (botState.locationRetryTimer) {
            clearTimeout(botState.locationRetryTimer);
            botState.locationRetryTimer = null;
        }
    }

    res.json({
        ok: true,
        message: 'Đã lưu setting.',
        ...publicSettingsState(botState)
    });
});

app.post('/api/bot/logs/clear', (req, res) => {
    botState.logs = [];
    botState.logRevision++;
    res.json({
        ok: true,
        revision: botState.logRevision,
        message: 'Đã xóa lịch sử Event Log.'
    });
});

app.post('/api/bot/chat-logs/clear', (req, res) => {
    botState.chatLogs = [];
    botState.recentChatMessages = [];
    botState.chatLogRevision++;
    res.json({
        ok: true,
        revision: botState.chatLogRevision,
        message: 'Đã xóa lịch sử Chat.'
    });
});

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
                snapshot: '/api/snapshot',
                diagnostics: '/api/diagnostics',
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
                credentials: '/api/bot/credentials',
                moveInventory: '/api/inventory/move',
                equip: '/api/inventory/equip',
                unequip: '/api/inventory/unequip',
                selectHotbar: '/api/inventory/select',
                dropInventory: '/api/inventory/drop',
                settings: '/api/settings',
                clearLogs: '/api/bot/logs/clear',
                clearChatLogs: '/api/bot/chat-logs/clear',
            }
        });
    }
);

// -----------------------------------------------------------------------------
// API: current bot credentials
//
// Used only by the central Manager after the Manager ADMIN password has been
// validated there. Credentials are read directly from runtime botState so a
// runtime account change is reflected immediately.
// -----------------------------------------------------------------------------

app.get(
    '/api/bot/credentials',
    (req, res) => {
        res.json(
            publicBotCredentials(
                botState
            )
        );
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

        if (botState.restartTimer) {
            clearTimeout(botState.restartTimer);
        }

        botState.restartTimer =
            setTimeout(() => {
                botState.restartTimer = null;

                if (
                    botState.username &&
                    botState.password
                ) {
                    botState.manuallyStopped = false;
                    startBot(botState);
                } else {
                    setBotStatus(botState, 'offline');
                }
            }, 500);

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
// BOT_CONFIG là nguồn credential gốc. Thay đổi từ web chỉ áp dụng lúc runtime.
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

        botState.stateRevision++;

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

async function finishInventoryAction(state, bot, token = null) {
    await new Promise(
        resolve => setTimeout(resolve, 120)
    );

    if (
        !isCurrentBot(state, bot) ||
        state.manuallyStopped ||
        (token !== null && !isInventoryActionCurrent(state, bot, token))
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
        isCurrentBot(state, bot) &&
        !state.manuallyStopped &&
        (token === null || isInventoryActionCurrent(state, bot, token))
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

        if (typeof bot.moveSlotItem !== 'function') {
            return res.status(501).json({
                error: 'Mineflayer hiện tại không hỗ trợ moveSlotItem.'
            });
        }

        const sourceItem =
            bot.inventory.slots[sourceSlot] ||
            null;

        if (!sourceItem) {
            return res.status(400).json({
                error:
                    'Ô nguồn đang trống.'
            });
        }

        const actionToken =
            beginInventoryAction(botState, bot);

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

            await withTimeout(
                bot.moveSlotItem(sourceSlot, destSlot),
                INVENTORY_ACTION_TIMEOUT_MS,
                'Di chuyển item'
            );

            if (!isInventoryActionCurrent(botState, bot, actionToken)) {
                return res.status(409).json({
                    error: 'Bot đã reconnect trong lúc thao tác inventory. Đang đồng bộ lại...',
                    revision: botState.inventoryRevision,
                    inventory: publicInventoryState(botState)
                });
            }

            await finishInventoryAction(
                botState,
                bot,
                actionToken
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
            endInventoryAction(botState, bot, actionToken);
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

        if (typeof bot.equip !== 'function') {
            return res.status(501).json({
                error: 'Mineflayer hiện tại không hỗ trợ equip.'
            });
        }

        const item =
            bot.inventory.slots[sourceSlot] ||
            null;

        if (!item) {
            return res.status(400).json({
                error:
                    'Ô nguồn đang trống.'
            });
        }

        const actionToken =
            beginInventoryAction(botState, bot);

        try {
            addLog(
                botState,
                `[EQUIP] Web: ${itemSummary(item)} → ${destination}.`
            );

            await withTimeout(
                bot.equip(item, destination),
                INVENTORY_ACTION_TIMEOUT_MS,
                'Trang bị item'
            );

            if (!isInventoryActionCurrent(botState, bot, actionToken)) {
                return res.status(409).json({
                    error: 'Bot đã reconnect trong lúc thao tác inventory. Đang đồng bộ lại...',
                    revision: botState.inventoryRevision,
                    inventory: publicInventoryState(botState)
                });
            }

            await finishInventoryAction(
                botState,
                bot,
                actionToken
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
            endInventoryAction(botState, bot, actionToken);
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

        if (
            typeof bot.moveSlotItem !== 'function' &&
            typeof bot.unequip !== 'function'
        ) {
            return res.status(501).json({
                error: 'Mineflayer hiện tại không hỗ trợ tháo trang bị.'
            });
        }

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

        const actionToken =
            beginInventoryAction(botState, bot);

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
                    await withTimeout(
                        bot.moveSlotItem(sourceSlot, emptySlot),
                        INVENTORY_ACTION_TIMEOUT_MS,
                        'Tháo trang bị'
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
                await withTimeout(
                    bot.unequip(destination),
                    INVENTORY_ACTION_TIMEOUT_MS,
                    'Tháo trang bị'
                );
                moved = true;
            }

            if (!moved) {
                throw new Error('Không thể tháo trang bị với API Mineflayer hiện tại.');
            }

            if (!isInventoryActionCurrent(botState, bot, actionToken)) {
                return res.status(409).json({
                    error: 'Bot đã reconnect trong lúc thao tác inventory. Đang đồng bộ lại...',
                    revision: botState.inventoryRevision,
                    inventory: publicInventoryState(botState)
                });
            }

            await finishInventoryAction(
                botState,
                bot,
                actionToken
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
            endInventoryAction(botState, bot, actionToken);
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

        const actionToken =
            beginInventoryAction(botState, bot);

        try {
            const summary =
                itemSummary(item);

            addLog(
                botState,
                `[DROP] Vứt ${summary} từ ${getSlotLabel(sourceSlot)}.`
            );

            await withTimeout(
                bot.tossStack(item),
                INVENTORY_ACTION_TIMEOUT_MS,
                'Vứt item'
            );

            if (!isInventoryActionCurrent(botState, bot, actionToken)) {
                return res.status(409).json({
                    error: 'Bot đã reconnect trong lúc thao tác inventory. Đang đồng bộ lại...',
                    revision: botState.inventoryRevision,
                    inventory: publicInventoryState(botState)
                });
            }

            await finishInventoryAction(
                botState,
                bot,
                actionToken
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
            endInventoryAction(botState, bot, actionToken);
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
// Extra lightweight status endpoint
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
// HTTP server
// -----------------------------------------------------------------------------

function scheduleAutoStartOnBoot() {
    const hasConfiguredCredentials =
        !!(BOT_CONFIG.USERNAME && BOT_CONFIG.PASSWORD);

    if (!hasConfiguredCredentials) {
        addLog(
            botState,
            'Bot đang OFFLINE: BOT_CONFIG chưa có username/password. Có thể nhập tài khoản trên web rồi bấm Chạy.'
        );
        return;
    }

    if (!AUTO_START_ON_BOOT) {
        addLog(
            botState,
            'AUTO_START đang tắt trong BOT_CONFIG. Bot đang OFFLINE.'
        );
        return;
    }

    addLog(
        botState,
        'Đã đọc credential từ BOT_CONFIG. Service đã listen, đang tự khởi động bot.'
    );

    clearAfkTimers(botState);

    const bootTimer = setTimeout(() => {
        if (botState.shuttingDown) {
            return;
        }

        if (botState.bot || !botState.manuallyStopped) {
            return;
        }

        const started = startBot(botState);

        addLog(
            botState,
            started
                ? 'Auto-start sau khi service khởi động: đã bắt đầu kết nối.'
                : 'Auto-start không thành công: kiểm tra credential và trạng thái service.'
        );
    }, 250);

    botState.afkTimers.push(bootTimer);
}

const server = app.listen(
    HTTP_PORT,
    '0.0.0.0',
    () => {

        console.log(
            `[HTTP] Dashboard listening on ${HTTP_PORT} | ` +
            `Platform ${PLATFORM}`
        );

        startPublicIpMonitor(botState);
        scheduleAutoStartOnBoot();
    }
);

// -----------------------------------------------------------------------------
// Graceful process shutdown
// -----------------------------------------------------------------------------

function shutdownProcess(signal) {
    if (botState.shuttingDown) {
        return;
    }

    botState.shuttingDown = true;

    console.log(
        `[PROCESS] Nhận ${signal}, đang shutdown...`
    );

    botState.manuallyStopped = true;

    clearAllTimers(
        botState
    );

    if (botState.bot) {
        const currentBot = botState.bot;
        botState.bot = null;

        try {
            if (typeof currentBot.quit === 'function') {
                currentBot.quit(`Process ${signal}`);
            }
        } catch (err) {
            console.log(
                `[PROCESS] Shutdown bot error: ${err.message}`
            );
        } finally {
            cleanupBotResources(currentBot);
        }
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
// - BOT_CONFIG có username/password => tự khởi động sau khi HTTP service listen.
// - BOT_CONFIG thiếu credential => giữ OFFLINE để chờ nhập từ web.
// - AUTO_START=false => tắt auto-start nhưng vẫn giữ nút Chạy thủ công.
// -----------------------------------------------------------------------------

botState.manuallyStopped = true;
botState.ready = false;
setBotStatus(botState, 'offline');
botState.connectedAt = null;
resetInventoryState(botState);

// Auto-start được gọi sau khi HTTP server listen xong để bot chỉ kết nối
// sau khi dashboard/web service đã sẵn sàng.


// ============================================================================
// END OF FILE
// ============================================================================
//
// File này là bản 1-bot hardcoded hoàn chỉnh.
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
// - Credential API cho Manager: /api/bot/credentials
// - Health endpoint
// - Lightweight status endpoint
// - Auto-start từ credential hardcode trong BOT_CONFIG sau khi HTTP listen
// - UTC+7 log time
// - Log filtering
// - Log scroll position preservation
// - View distance tuning
// - Graceful shutdown
// - BOT_ID hardcode trong BOT_CONFIG
// - CORS/API discovery cho central dashboard
//
// Lưu ý:
// Phần này chỉ là marker kết thúc file.
// Không cần thêm code khác sau đây.
// ============================================================================
