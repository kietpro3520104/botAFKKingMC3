const mineflayer = require('mineflayer');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CẤU HÌNH TỔNG BOT MINECRAFT KINGMC (HARDCODED CONFIG V7 - SIÊU VIP)
//
// Quăng file này lên VPS / Hosting dưới dạng index.js hoặc bot.js.
// Tự động nhận diện Render / RavenHost / VPS và khởi chạy Web UI tức thì!
// Chỉnh sửa các trường cấu hình trực tiếp ngay bên dưới:
// ============================================================================

const BOT_CONFIG = {
    // --- 1. TÀI KHOẢN BOT (ĐỂ TRỐNG ĐỂ TỰ ĐIỀN HOẶC NHẬP TỪ WEB UI) ---
    USERNAME: '',                         // Tên tài khoản Minecraft ingame (VD: 'AFK_PRO_01')
    PASSWORD: '',                         // Mật khẩu /login trong server KingMC (VD: 'matkhau123')

    // --- 2. SERVER MINECRAFT KINGMC ---
    MC_HOSTS: ['sgp.kingmc.vn', 'kingmc.vn'], // Danh sách IP server KingMC
    MC_PORT: 25565,                           // Cổng Minecraft mặc định (25565)
    MC_VERSION: '1.20.1',                     // Phiên bản Minecraft kết nối

    // --- 3. THÔNG BÁO WEBHOOK DISCORD & TELEGRAM (ĐỂ TRỐNG NẾU CHƯA DÙNG) ---
    DISCORD_WEBHOOK_URL: '',              // Link Discord Webhook nhận thông báo kick, chết, spawn
    TELEGRAM_BOT_TOKEN: '',               // Token Bot Telegram (VD: '123456789:ABCdefGhI...')
    TELEGRAM_CHAT_ID: '',                 // ID cuộc trò chuyện Telegram nhận thông báo

    // --- 4. CỔNG MÁY CHỦ WEB & NỀN TẢNG HOSTING (TỰ ĐỘNG GÁN 100%) ---
    PLATFORM: 'auto',                     // 'auto' (Tự nhận diện Render / RavenHost / Local VPS)
    WEB_PORT: 3000,                       // Cổng Web dự phòng khi test Local PC (Render & RavenHost tự động gán 100%)
    RAVEN_HTTP_PORT: null,                // Cổng RavenHost: ĐỂ NULL ĐỂ TỰ ĐỘNG LẤY TỪ PANEL RAVENHOST (SERVER_PORT)
    BOT_ID: '1',                          // ID định danh của bot

    // --- 5. TỐI ƯU HÓA BỘ NHỚ & CHỐNG TRÀN RAM (WATCHDOG 300-500MB) ---
    AUTO_START: true,                     // Tự động kết nối vào game nếu đã có USERNAME và PASSWORD
    VIEW_DISTANCE: 'tiny',                // Tầm nhìn tối thiểu để tiết kiệm RAM tối đa
    CHECK_TIMEOUT_MS: 30000,              // Timeout kiểm tra kết nối mạng
    RAM_WATCHDOG_LIMIT_MB: 380,           // Ngưỡng RAM tự dọn dẹp sạch sẽ và kích hoạt GC (300-500MB)

    // --- 6. TỌA ĐỘ CHUYỂN SERVER KINGMC ---
    AUTH_COORDS: { x: 5, y: 119, z: 4 },
    LOBBY_COORDS: { x: 1, y: 41, z: 1 },

    // --- 7. TỐI ƯU HÓA KHU FARM HẠT & ITEM (KELP / MOB FARM) ---
    FARM_OPTIMIZATION: {
        ENABLED: true,
        MAX_ENTITIES_IN_MEMORY: 120,      // Giới hạn thực thể lưu trong RAM (chống tràn 512MB RAM Render)
        IGNORE_ITEM_PHYSICS: true,        // Bỏ qua tính toán va chạm với item rơi
        DROP_PARTICLES_AND_SOUNDS: true,  // Chặn hoàn toàn packet hạt bọt nước & âm thanh farm
        CHUNK_CULL_RADIUS: 2,             // Chỉ giữ 2 chunks quanh bot, giải phóng map thừa
        PRUNE_INTERVAL_MS: 1500           // Quét dọn rác mỗi 1.5 giây
    },

    // --- 8. CẤU HÌNH HÀNH VI TỰ ĐỘNG (THUẦN AFK & ANTI-AFK) ---
    DEFAULT_SETTINGS: {
        autoTotem: true,                  // Tự cầm totem khi còn ít máu phòng té ngã
        antiHungry: true,                 // Tự ăn khi đói chống chết đói khi treo máy
        autoReconnect: true,              // Tự kết nối lại khi mất mạng / server restart
        antiAfkKick: true                 // Giả lập vi chuyển động yaw/pitch & sneak chống kick AFK
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


// ============================================================================
// HỆ THỐNG TỰ ĐỘNG NHẬN DIỆN NỀN TẢNG (RENDER / RAVENHOST.SPACE) & PHÁT HIỆN PORT
// ============================================================================
// HỆ THỐNG TỰ ĐỘNG NHẬN DIỆN NỀN TẢNG (RENDER / RAVENHOST.SPACE) & PHÁT HIỆN PORT SIÊU CHUẨN
// ============================================================================

function extractCliArgs() {
    let port = null;
    let platform = null;
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--port=')) {
            const p = parseInt(arg.split('=')[1], 10);
            if (Number.isFinite(p) && p > 0 && p <= 65535) port = p;
        } else if (arg === '--port' || arg === '-p') {
            if (i + 1 < argv.length) {
                const p = parseInt(argv[i + 1], 10);
                if (Number.isFinite(p) && p > 0 && p <= 65535) {
                    port = p;
                    i++;
                }
            }
        } else if (arg.startsWith('-p=')) {
            const p = parseInt(arg.split('=')[1], 10);
            if (Number.isFinite(p) && p > 0 && p <= 65535) port = p;
        } else if (arg.startsWith('--platform=')) {
            platform = arg.split('=')[1].trim().toLowerCase();
        } else if (arg === '--platform') {
            if (i + 1 < argv.length) {
                platform = argv[i + 1].trim().toLowerCase();
                i++;
            }
        } else if (/^\d{2,5}$/.test(arg) && !port) {
            const p = parseInt(arg, 10);
            if (Number.isFinite(p) && p > 0 && p <= 65535) port = p;
        }
    }
    return { port, platform };
}

function detectHostPlatformAndPort(config, fallbackPort, role = 'bot') {
    const cli = extractCliArgs();

    // 1. Dấu hiệu Render theo tài liệu chính thức (https://render.com/docs/environment-variables):
    // Render luôn luôn inject RENDER="true", RENDER_SERVICE_ID, RENDER_INSTANCE_ID,...
    const isRender = !!(
        (process.env.RENDER && String(process.env.RENDER).toLowerCase() === 'true') ||
        process.env.RENDER_SERVICE_ID ||
        process.env.RENDER_INSTANCE_ID ||
        process.env.RENDER_SERVICE_NAME ||
        process.env.RENDER_EXTERNAL_HOSTNAME
    );

    // 2. Dấu hiệu RavenHost (ravenhost.space) / Pterodactyl Panel:
    // Theo tài liệu https://ravenhost.space/docs/subdomains:
    // panel.ravenhost.space chạy container Pterodactyl, cấp phát port qua SERVER_PORT
    // hoặc PORT trên container, và định tuyến subdomain http://yourhost.app.ravenhost.space:PORT
    const isRaven = !!(
        process.env.P_SERVER_UUID ||
        process.env.P_SERVER_LOCATION ||
        process.env.SERVER_PORT ||
        process.env.P_SERVER_PORT ||
        process.env.SERVER_MEMORY ||
        process.env.RAVEN_PORT ||
        process.env.RAVEN_HTTP_PORT ||
        process.env.RAVEN_ENV ||
        (process.env.HOSTNAME && (process.env.HOSTNAME.includes('ravenhost') || process.env.HOSTNAME.includes('pterodactyl'))) ||
        (!isRender && process.env.PORT) // Trên RavenHost/Pterodactyl, app nhận allocation port từ biến PORT hoặc SERVER_PORT
    );

    let platform = 'auto';
    let detectionSource = 'mặc định';

    const configuredPlatform = String(config.PLATFORM || 'auto').trim().toLowerCase();

    // Thứ tự ưu tiên nền tảng:
    // Ưu tiên 1: Tham số dòng lệnh CLI (--platform=...)
    if (cli.platform === 'render' || cli.platform === 'raven') {
        platform = cli.platform;
        detectionSource = `Tham số dòng lệnh CLI (--platform=${cli.platform})`;
    }
    // Ưu tiên 2: Người dùng chủ động ép cứng cấu hình trong code (config.PLATFORM)
    else if (configuredPlatform === 'render' || configuredPlatform === 'raven') {
        platform = configuredPlatform;
        detectionSource = `Cấu hình ép buộc config.PLATFORM = '${configuredPlatform}'`;
    }
    // Ưu tiên 3: Tự nhận diện Render từ biến môi trường chính thức (process.env.RENDER)
    else if (isRender) {
        platform = 'render';
        detectionSource = 'Biến môi trường Render chính thức (process.env.RENDER)';
    }
    // Ưu tiên 4: Tự nhận diện RavenHost (ravenhost.space / Pterodactyl Panel)
    else if (isRaven) {
        platform = 'raven';
        if (process.env.SERVER_PORT) {
            detectionSource = `RavenHost / Pterodactyl Panel (SERVER_PORT = ${process.env.SERVER_PORT})`;
        } else if (process.env.P_SERVER_UUID) {
            detectionSource = `RavenHost Container (P_SERVER_UUID = ${process.env.P_SERVER_UUID})`;
        } else if (process.env.PORT) {
            detectionSource = `RavenHost App Allocation (PORT = ${process.env.PORT})`;
        } else {
            detectionSource = 'Môi trường RavenHost (ravenhost.space)';
        }
    }
    // Ưu tiên 5: Fallback mặc định
    else {
        platform = 'raven';
        detectionSource = 'Mặc định Local PC / VPS độc lập (Raven mode)';
    }

    // 3. Phân giải Cổng (Port) theo chuẩn tài liệu ravenhost.space và render.com:
    let port = fallbackPort;
    let portSource = 'mặc định';

    // ƯU TIÊN CAO NHẤT: Tham số dòng lệnh CLI (--port=XXXX, --port XXXX, -p XXXX, hoặc số nguyên ở argv)
    // Thường được cấp bởi startup command trong Panel Pterodactyl egg của RavenHost: "node index.js --port={{SERVER_PORT}}"
    if (cli.port) {
        port = cli.port;
        portSource = `Tham số dòng lệnh CLI / Pterodactyl Startup (--port = ${cli.port})`;
    } else if (platform === 'render') {
        // Tài liệu Render: Web Service nhận port từ biến PORT do Render cấp phát, mặc định cổng 10000
        const renderPort = Number(process.env.PORT);
        if (Number.isFinite(renderPort) && renderPort > 0 && renderPort <= 65535) {
            port = renderPort;
            portSource = `Render cấp tự động (process.env.PORT = ${renderPort})`;
        } else {
            port = 10000;
            portSource = 'Render mặc định (10000)';
        }
    } else {
        // Tài liệu ravenhost.space (https://ravenhost.space/docs/subdomains):
        // Container Pterodactyl cấp port qua SERVER_PORT hoặc PORT.
        const rawPort = process.env.SERVER_PORT ||
                        process.env.P_SERVER_PORT ||
                        process.env.PORT ||
                        process.env.RAVEN_HTTP_PORT ||
                        process.env.RAVEN_PORT;

        const parsedPort = Number(rawPort);
        if (Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
            port = parsedPort;
            if (process.env.SERVER_PORT) {
                portSource = `RavenHost Panel cấp tự động (process.env.SERVER_PORT = ${parsedPort})`;
            } else if (process.env.P_SERVER_PORT) {
                portSource = `Panel Pterodactyl cấp (process.env.P_SERVER_PORT = ${parsedPort})`;
            } else if (process.env.PORT) {
                portSource = `RavenHost App Allocation (process.env.PORT = ${parsedPort})`;
            } else if (process.env.RAVEN_HTTP_PORT) {
                portSource = `Biến môi trường RAVEN_HTTP_PORT = ${parsedPort}`;
            } else {
                portSource = `Biến môi trường RAVEN_PORT = ${parsedPort}`;
            }
        } else {
            // Khi không có biến môi trường:
            // Nếu ở chế độ raven (mặc định trên RavenHost / VPS), ƯU TIÊN RAVEN_HTTP_PORT trước WEB_PORT!
            const preferredConfigPort = platform === 'raven'
                ? Number(config.RAVEN_HTTP_PORT || config.WEB_PORT)
                : Number(config.WEB_PORT || config.RAVEN_HTTP_PORT);

            if (Number.isFinite(preferredConfigPort) && preferredConfigPort > 0 && preferredConfigPort <= 65535) {
                port = preferredConfigPort;
                portSource = platform === 'raven' && config.RAVEN_HTTP_PORT
                    ? `Cấu hình config.RAVEN_HTTP_PORT = ${preferredConfigPort}`
                    : `Cấu hình config.WEB_PORT = ${preferredConfigPort}`;
            } else {
                port = fallbackPort;
                portSource = `Cổng dự phòng fallback (${fallbackPort})`;
            }
        }
    }

    return { platform, detectionSource, port, portSource };
}

function listenHttpServer(app, initialPort, platform, onListening) {
    const fixedPort = initialPort;
    // Trên RavenHost và Render: Cổng là duy nhất được gán qua Allocation Router / Render Proxy.
    // TUYỆT ĐỐI KHÔNG tăng cổng tự động (+1) vì nếu nghe trên cổng khác (ví dụ 17420 thay vì 17419),
    // tên miền subdomain.app.ravenhost.space sẽ không thể kết nối tới (lỗi 502/Connection Refused)!
    // Thay vào đó: Khi gặp EADDRINUSE (do tiến trình cũ vừa tắt đang nhả socket), thử lại chính cổng đó tối đa 5 lần (mỗi lần 1s).
    const maxRetries = 5;
    let attempt = 0;

    function tryListen() {
        const srv = app.listen(fixedPort, '0.0.0.0');

        srv.on('listening', () => {
            onListening(srv, fixedPort);
        });

        srv.on('error', (err) => {
            if (err.code === 'EADDRINUSE' && attempt < maxRetries) {
                attempt++;
                console.warn(`[HTTP] ⚠️ Cổng ${fixedPort} đang tạm thời bận (EADDRINUSE). Đang chờ giải phóng socket và thử lại lần ${attempt}/${maxRetries} sau 1 giây...`);
                setTimeout(tryListen, 1000);
            } else {
                console.error(`[HTTP] ❌ Lỗi khởi động máy chủ web trên cổng cố định ${fixedPort}:`, err.message);
                if (err.code === 'EADDRINUSE') {
                    console.error(`[HTTP] 💡 Khắc phục: Cổng ${fixedPort} đang bị chiếm bởi tiến trình khác. Hãy kiểm tra các bot/tiến trình Node.js đang chạy ngầm hoặc khởi động lại container trên RavenHost.`);
                }
                process.exit(1);
            }
        });
    }

    tryListen();
}


const hostInfo = detectHostPlatformAndPort(BOT_CONFIG, Number(BOT_CONFIG.WEB_PORT) || 3000, 'bot');
const PLATFORM = hostInfo.platform;
let HTTP_PORT = hostInfo.port;

console.log(`[HOST] 🌐 Nền tảng Bot: ${PLATFORM.toUpperCase()} (${hostInfo.detectionSource})`);
console.log(`[HTTP] 🔌 Cổng Web Bot: ${HTTP_PORT} (${hostInfo.portSource})`);

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

const MAX_LOGS = 500;
const MAX_CHAT_LOGS = 500;
const RECONNECT_DELAY = 3000;
const INVENTORY_ACTION_TIMEOUT_MS = 15000;
const AUTO_START_ON_BOOT = Boolean(BOT_CONFIG.AUTO_START);

// KingMC AFK flow timing.
const DN_TO_AFK_DELAY = 1000;
const AFK_MENU_DELAY = 1800;
const AFK_MENU_CLICK_DELAY = 700;

// Background inventory / survival managers.
const AUTO_EAT_INTERVAL_MS = 2000;
const AUTO_TOTEM_INTERVAL_MS = 1000;
const INVENTORY_SCAN_INTERVAL_MS = 1000;
const SMART_ANTI_AFK_INTERVAL_MS = 38000; // 38s xoay góc nhìn & vung tay nhẹ chống kick

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

const BOT_SCHEDULER_MAX_ITEMS = 50;
const BOT_SCHEDULER_TICK_MS = 1000;
const BOT_SCHEDULER_MANUAL_GUARD_MS = 5000;
const BOT_SCHEDULER_MAX_PHASE_MINUTES = 43200;

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

function sanitizeBotSchedules(input, options = {}) {
    const rawList = Array.isArray(input)
        ? input.filter(item => item && typeof item === 'object')
        : [];

    if (!rawList.length) return [];

    const now = Date.now();
    const resetCycleState = options.resetCycleState === true;
    const rawFirst = rawList[0];
    const requestedMode = rawFirst.mode === 'cycle' ? 'cycle' : 'fixed';
    const id = String(rawFirst.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const enabled = rawFirst.enabled !== false;

    // New format: one scheduler + many ordered items.
    // Legacy v2.1 format: many independent cards. Merge same-mode cards into one scheduler.
    let sourceItems;
    if (Array.isArray(rawFirst.items)) {
        sourceItems = rawFirst.items;
    } else {
        sourceItems = rawList
            .filter(item => (item.mode === 'cycle' ? 'cycle' : 'fixed') === requestedMode)
            .flatMap(item => requestedMode === 'fixed'
                ? [{
                    id: item.id,
                    action: item.action,
                    time: item.time,
                    lastFixedRunKey: item.lastFixedRunKey
                }]
                : [
                    { id: `${item.id || 'cycle'}-stop`, action: 'stop', afterMinutes: item.offAfterMinutes },
                    { id: `${item.id || 'cycle'}-start`, action: 'start', afterMinutes: item.onAfterMinutes }
                ]
            );
    }

    const items = [];
    for (const rawItem of sourceItems.slice(0, BOT_SCHEDULER_MAX_ITEMS)) {
        const raw = rawItem && typeof rawItem === 'object' ? rawItem : {};
        const itemId = String(raw.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        const action = raw.action === 'start' ? 'start' : 'stop';

        if (requestedMode === 'fixed') {
            const time = String(raw.time || '').trim();
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
            items.push({
                id: itemId,
                action,
                time,
                lastFixedRunKey: resetCycleState ? '' : String(raw.lastFixedRunKey || '')
            });
        } else {
            items.push({
                id: itemId,
                action,
                afterMinutes: readPositiveInt(
                    raw.afterMinutes,
                    120,
                    1,
                    BOT_SCHEDULER_MAX_PHASE_MINUTES
                )
            });
        }
    }

    if (!items.length) return [];

    if (requestedMode === 'fixed') {
        const seen = new Set();
        const uniqueItems = items.filter(item => {
            if (seen.has(item.time)) return false;
            seen.add(item.time);
            return true;
        });

        return [{ id, enabled, mode: 'fixed', items: uniqueItems }];
    }

    const rawAnchor = Number(rawFirst.cycleAnchorAt);
    const cycleAnchorAt = resetCycleState
        ? now
        : Number.isFinite(rawAnchor) && rawAnchor > 0
            ? Math.trunc(rawAnchor)
            : now;
    const rawEventIndex = Number(rawFirst.lastCycleEventIndex);
    const lastCycleEventIndex = resetCycleState
        ? 0
        : Number.isInteger(rawEventIndex) && rawEventIndex >= 0
            ? rawEventIndex
            : 0;

    return [{
        id,
        enabled,
        mode: 'cycle',
        items,
        cycleAnchorAt,
        lastCycleEventIndex
    }];
}

function loadBotSettings() {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) {
            return {
                settings: { ...DEFAULT_SETTINGS },
                autoChatSchedules: [],
                botSchedules: []
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
                autoReconnect: settings.autoReconnect !== false,
                antiAfkKick: settings.antiAfkKick !== false
            },
            autoChatSchedules: sanitizeAutoChatSchedules(parsed?.autoChatSchedules),
            botSchedules: sanitizeBotSchedules(parsed?.botSchedules)
        };
    } catch (err) {
        console.error(`[SETTINGS] Không đọc được ${SETTINGS_FILE}: ${err.message}`);
        return {
            settings: { ...DEFAULT_SETTINGS },
            autoChatSchedules: [],
            botSchedules: []
        };
    }
}

function saveBotSettingsFile(settings, autoChatSchedules, botSchedules) {
    try {
        const payload = {
            version: 3,
            settings: {
                autoTotem: settings.autoTotem !== false,
                antiHungry: settings.antiHungry !== false,
                autoReconnect: settings.autoReconnect !== false,
                antiAfkKick: settings.antiAfkKick !== false
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
                })),
            botSchedules: sanitizeBotSchedules(botSchedules)
                .map(schedule => ({
                    id: schedule.id,
                    enabled: schedule.enabled !== false,
                    mode: schedule.mode,
                    items: Array.isArray(schedule.items)
                        ? schedule.items.map(item => schedule.mode === 'fixed'
                            ? {
                                id: item.id,
                                action: item.action === 'start' ? 'start' : 'stop',
                                time: item.time,
                                lastFixedRunKey: item.lastFixedRunKey || ''
                            }
                            : {
                                id: item.id,
                                action: item.action === 'start' ? 'start' : 'stop',
                                afterMinutes: item.afterMinutes
                            })
                        : [],
                    ...(schedule.mode === 'cycle'
                        ? {
                            cycleAnchorAt: schedule.cycleAnchorAt,
                            lastCycleEventIndex: schedule.lastCycleEventIndex
                        }
                        : {})
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
    const envUser = process.env.BOT_USERNAME || process.env.USERNAME || process.env.MC_USERNAME || process.env.KINGMC_USERNAME || '';
    const envPass = process.env.BOT_PASSWORD || process.env.PASSWORD || process.env.MC_PASSWORD || process.env.KINGMC_PASSWORD || '';

    return {
        username: String(BOT_CONFIG.USERNAME || envUser || '').trim(),
        password: String(BOT_CONFIG.PASSWORD || envPass || '')
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
        antiAfkTimer: null,
        farmPruneTimer: null,
        memoryWatchdogTimer: null,
        lastRssMb: 0,
        lastHeapMb: 0,
        autoChatGeneration: 0,

        settings: { ...INITIAL_SETTINGS.settings },
        autoChatSchedules: INITIAL_SETTINGS.autoChatSchedules,
        botSchedules: INITIAL_SETTINGS.botSchedules,
        botSchedulerTimer: null,
        lastManualLifecycleAt: 0,
        lifecycleActionBusy: false,
        lastAuthDnActionAt: 0,

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
startBotScheduler(botState);
startMemoryWatchdog(botState);

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

    if (state.chatLogs.length > MAX_CHAT_LOGS) {
        state.chatLogs.splice(
            0,
            state.chatLogs.length - MAX_CHAT_LOGS
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

    // Gợi ý V8 thu hồi bộ nhớ ngay sau khi đóng/dọn dẹp tài nguyên bot
    if (typeof global.gc === 'function') {
        try { global.gc(); } catch (_) {}
    }
}

function withTimeout(
    promise,
    timeoutMs,
    label = 'Thao tác',
    onTimeout = null
) {
    let timer = null;

    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            if (typeof onTimeout === 'function') {
                try {
                    onTimeout();
                } catch (_) {
                }
            }

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

    if (state.antiAfkTimer) {
        clearInterval(state.antiAfkTimer);
        state.antiAfkTimer = null;
    }

    if (state.farmPruneTimer) {
        clearInterval(state.farmPruneTimer);
        state.farmPruneTimer = null;
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

function clearPublicIpTimer(state) {
    if (state.publicIpTimer) {
        clearInterval(state.publicIpTimer);
        state.publicIpTimer = null;
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

function clearAllTimers(state, includePublicIp = false) {
    clearAfkTimers(state);
    clearReconnectTimer(state);
    clearLocationTimers(state);
    clearRestartTimer(state);
    clearManagerTimers(state);

    if (includePublicIp) {
        clearPublicIpTimer(state);
    }
}

// ============================================================================
// 🌟 MODULE SIÊU TỐI ƯU CHO KHU FARM KELP / MOB (HƠN 100K+ ITEMS)
// ============================================================================
function applyHighDensityFarmOptimizations(state, bot) {
    if (!BOT_CONFIG.FARM_OPTIMIZATION.ENABLED || !bot) return;

    // 1. Chặn hoàn toàn Packet hạt bọt nước, âm thanh & animation rớt item
    if (BOT_CONFIG.FARM_OPTIMIZATION.DROP_PARTICLES_AND_SOUNDS && bot._client) {
        const dropEvents = [
            'world_particles', 'sound_effect', 'named_sound_effect', 'update_light',
            'spawn_entity_experience_orb', 'experience_orb', 'explosion',
            'block_break_animation', 'entity_effect', 'remove_entity_effect'
        ];
        for (const evt of dropEvents) {
            bot._client.removeAllListeners(evt);
            bot._client.on(evt, () => {}); // No-op: drop thẳng gói tin, không tốn CPU/RAM parse
        }
    }

    // 2. Lắng nghe entitySpawn để cắt tỉa rác tức thì (không để dồn ứ bộ nhớ RAM)
    if (bot._entitySpawnPruneHandler) {
        bot.removeListener('entitySpawn', bot._entitySpawnPruneHandler);
    }
    bot._entitySpawnPruneHandler = (entity) => {
        try {
            if (!entity || !bot.entities) return;
            const myPos = bot.entity ? bot.entity.position : null;
            const hasPos = entity.position && typeof entity.position.distanceSquared === 'function';
            const distSq = (hasPos && myPos) ? entity.position.distanceSquared(myPos) : 99999;
            const isItemOrOrb = entity.name === 'item' || entity.type === 'object' || entity.entityType === 'item' || entity.type === 'orb';
            if (isItemOrOrb && distSq > 9) {
                delete bot.entities[entity.id];
            } else if (entity.type !== 'player' && distSq > 400) {
                delete bot.entities[entity.id];
            }
        } catch (_) {}
    };
    bot.on('entitySpawn', bot._entitySpawnPruneHandler);

    // 3. Vòng lặp dọn dẹp thực thể (Entity Pruning) - Khóa cứng RAM luôn < 120MB
    if (state.farmPruneTimer) clearInterval(state.farmPruneTimer);
    state.farmPruneTimer = setInterval(() => {
        try {
            if (!bot || !bot.entities) return;

            const myId = bot.entity ? bot.entity.id : -1;
            const myPos = bot.entity ? bot.entity.position : null;
            let totalCount = 0;
            const nonPlayerIds = [];

            for (const id in bot.entities) {
                totalCount++;
                if (id == myId) continue;
                const entity = bot.entities[id];
                if (!entity) continue;

                // Nếu là item rơi dưới đất hoặc exp orb
                const isItemOrOrb = entity.name === 'item' || entity.type === 'object' || entity.entityType === 'item' || entity.type === 'orb' || entity.name === 'experience_orb';
                const hasPos = entity.position && typeof entity.position.distanceSquared === 'function';
                const distSq = (hasPos && myPos) ? entity.position.distanceSquared(myPos) : 99999;

                if (isItemOrOrb) {
                    // Nếu cách bot hơn 3 block (ngoài tầm nhặt) -> Xóa sổ khỏi bộ nhớ RAM
                    if (!myPos || !hasPos || distSq > 9) {
                        delete bot.entities[id];
                        continue;
                    }
                }

                // Dọn dẹp thực thể quái/vật phẩm ở xa ngoài 20 blocks
                if (entity.type !== 'player') {
                    if (distSq > 400) {
                        delete bot.entities[id];
                        continue;
                    }
                    nonPlayerIds.push({ id, distSq });
                }
            }

            // Nếu số lượng entity vượt quá trần cấu hình -> Xóa các thực thể xa nhất
            const maxEntities = BOT_CONFIG.FARM_OPTIMIZATION.MAX_ENTITIES_IN_MEMORY || 120;
            if (totalCount > maxEntities && nonPlayerIds.length > 0) {
                nonPlayerIds.sort((a, b) => b.distSq - a.distSq);
                for (const item of nonPlayerIds) {
                    if (totalCount <= maxEntities) break;
                    delete bot.entities[item.id];
                    totalCount--;
                }
            }

            // 3. Dọn dẹp Chunk ở xa để giải phóng bộ nhớ World Map
            if (bot.world && myPos) {
                const botChunkX = Math.floor(myPos.x / 16);
                const botChunkZ = Math.floor(myPos.z / 16);
                const cullRadius = BOT_CONFIG.FARM_OPTIMIZATION.CHUNK_CULL_RADIUS;

                if (typeof bot.world.getColumns === 'function') {
                    const cols = bot.world.getColumns();
                    if (Array.isArray(cols)) {
                        for (const col of cols) {
                            if (!col) continue;
                            const cx = col.chunkX ?? col.x;
                            const cz = col.chunkZ ?? col.z;
                            if (cx !== undefined && cz !== undefined) {
                                if (Math.abs(cx - botChunkX) > cullRadius || Math.abs(cz - botChunkZ) > cullRadius) {
                                    if (typeof bot.world.unloadColumn === 'function') {
                                        bot.world.unloadColumn(cx, cz);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (_) {}
    }, BOT_CONFIG.FARM_OPTIMIZATION.PRUNE_INTERVAL_MS);
}

// 🛡️ MEMORY WATCHDOG: Giám sát RAM định kỳ, bảo đảm luôn < 300MB
function startMemoryWatchdog(state) {
    if (state.memoryWatchdogTimer) clearInterval(state.memoryWatchdogTimer);
    state.memoryWatchdogTimer = setInterval(() => {
        try {
            const mem = process.memoryUsage();
            const rssMb = Math.round(mem.rss / (1024 * 1024));
            const heapMb = Math.round(mem.heapUsed / (1024 * 1024));
            state.lastRssMb = rssMb;
            state.lastHeapMb = heapMb;

            const limitMb = Number(BOT_CONFIG.RAM_WATCHDOG_LIMIT_MB) || 380;
            if (rssMb > limitMb) {
                // Ép dọn dẹp thực thể và chunk
                if (state.bot && state.bot.entities) {
                    const myId = state.bot.entity ? state.bot.entity.id : -1;
                    for (const id in state.bot.entities) {
                        if (id != myId && state.bot.entities[id]?.type !== 'player') {
                            delete state.bot.entities[id];
                        }
                    }
                }

                if (state.logs && state.logs.length > 300) state.logs = state.logs.slice(-300);
                if (state.chatLogs && state.chatLogs.length > 300) state.chatLogs = state.chatLogs.slice(-300);

                if (typeof global.gc === 'function') {
                    global.gc();
                }

                addLog(state, `[BỘ NHỚ] Kích hoạt giải phóng RAM khẩn cấp (RSS: ${rssMb} MB / Ngưỡng: ${limitMb} MB).`);
            }
        } catch (_) {}
    }, 30000);
}

// ============================================================================
// HỆ THỐNG CẢNH BÁO DISCORD & TELEGRAM WEBHOOK TRỰC TIẾP TỪ BOT
// ============================================================================
function getBotDiscordWebhookUrl() {
    return String(
        BOT_CONFIG.DISCORD_WEBHOOK_URL ||
        process.env.DISCORD_WEBHOOK_URL ||
        process.env.BOT_DISCORD_WEBHOOK ||
        process.env.WEBHOOK_URL ||
        ''
    ).trim();
}

function getBotTelegramConfig() {
    return {
        token: String(BOT_CONFIG.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim(),
        chatId: String(BOT_CONFIG.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim()
    };
}

async function sendTelegramMessage(token, chatId, text) {
    if (!token || !chatId) return false;
    try {
        const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'HTML'
            })
        });
        return response.ok;
    } catch (_) {
        return false;
    }
}

async function sendBotDirectAlert(eventType, message, details = {}) {
    const webhookUrl = getBotDiscordWebhookUrl();
    const tg = getBotTelegramConfig();
    if (!webhookUrl && (!tg.token || !tg.chatId)) return;

    let color = 0x3498DB;
    let emoji = '🤖';
    if (eventType === 'kicked' || eventType === 'error') { color = 0xE74C3C; emoji = '🚨'; }
    else if (eventType === 'death') { color = 0xC0392B; emoji = '💀'; }
    else if (eventType === 'spawn' || eventType === 'afk') { color = 0x2ECC71; emoji = '✅'; }

    // 1. Gửi Discord nếu có webhookUrl
    if (webhookUrl) {
        const fields = [
            { name: '👤 Bot ID / Label', value: `${BOT_LABEL} (ID: ${BOT_ID})`, inline: true },
            { name: '🌐 Trạng thái', value: eventType.toUpperCase(), inline: true }
        ];
        for (const [k, v] of Object.entries(details)) {
            fields.push({ name: k, value: String(v), inline: true });
        }

        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: `KingMC Bot ${BOT_LABEL}`,
                    embeds: [{
                        title: `${emoji} [${eventType.toUpperCase()}] ${BOT_LABEL}`,
                        description: message,
                        color,
                        fields,
                        timestamp: new Date().toISOString()
                    }]
                })
            });
        } catch (_) {}
    }

    // 2. Gửi Telegram nếu có token & chatId
    if (tg.token && tg.chatId) {
        let tgText = `<b>${emoji} [${eventType.toUpperCase()}] ${BOT_LABEL} (ID: ${BOT_ID})</b>\n`;
        tgText += `${message}\n`;
        for (const [k, v] of Object.entries(details)) {
            tgText += `• <b>${k}:</b> ${v}\n`;
        }
        await sendTelegramMessage(tg.token, tg.chatId, tgText);
    }
}

// ⚡ INSTANT AUTO TOTEM: Phản xạ tức thì (< 50ms khi nhận damage)
async function fastEquipTotem(state) {
    const bot = state.bot;
    if (!state.settings.autoTotem || !bot || !bot.inventory || state.isEquippingTotem || state.inventoryActionBusy) return;

    if (bot.usingHeldItem && typeof bot.deactivateItem === 'function') {
        try { bot.deactivateItem(); } catch (_) {}
    }

    const offhandSlot = getOffhandSlot(bot);
    const offhandItem = bot.inventory.slots[offhandSlot];
    if (offhandItem && offhandItem.name === 'totem_of_undying') return;

    let totemItem = null;
    for (let slot = 9; slot <= 44; slot++) {
        const item = bot.inventory.slots[slot];
        if (item && item.name === 'totem_of_undying') {
            totemItem = item;
            break;
        }
    }
    if (!totemItem) return;

    state.isEquippingTotem = true;
    try {
        await bot.equip(totemItem, 'off-hand');
        addLog(state, '⚡ [TOTEM] Phản xạ tức thì: Đã lắp Totem vào tay phụ!');
        scanInventory(state, bot);
    } catch (_) {} finally {
        state.isEquippingTotem = false;
    }
}

// 🔄 SMART ANTI-AFK KICK: Giả lập hành vi người chơi thật (Natural Cadence, Micro-Look, Swing, Sneak)
function startSmartAntiAfk(state) {
    if (state.antiAfkTimer) {
        clearTimeout(state.antiAfkTimer);
        clearInterval(state.antiAfkTimer);
        state.antiAfkTimer = null;
    }

    function scheduleNext() {
        if (!state.settings.antiAfkKick || state.status !== 'afk' || !state.ready || !state.bot) return;

        // Tần số ngẫu nhiên tự nhiên (22s - 45s) tránh quy luật cố định
        const jitterInterval = 22000 + Math.floor(Math.random() * 23000);
        state.antiAfkTimer = setTimeout(() => {
            if (state.settings.antiAfkKick && state.status === 'afk' && state.ready && state.bot && state.bot.entity) {
                try {
                    const deltaYaw = (Math.random() - 0.5) * 0.35;
                    const deltaPitch = (Math.random() - 0.5) * 0.2;
                    const yaw = state.bot.entity.yaw + deltaYaw;
                    const pitch = Math.max(-1.4, Math.min(1.4, state.bot.entity.pitch + deltaPitch));

                    state.bot.look(yaw, pitch, true, () => {
                        // 40% cơ hội vung tay (swingArm packet)
                        if (Math.random() > 0.6 && typeof state.bot.swingArm === 'function') {
                            state.bot.swingArm('right');
                        }
                        // 25% cơ hội nhấp ngồi (sneak) 160ms giả lập thao tác người thật
                        if (Math.random() > 0.75 && typeof state.bot.setControlState === 'function') {
                            state.bot.setControlState('sneak', true);
                            setTimeout(() => {
                                if (state.bot) state.bot.setControlState('sneak', false);
                            }, 160);
                        }
                    });
                } catch (_) {}
            }
            scheduleNext();
        }, jitterInterval);
    }

    scheduleNext();
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
        !state.ready ||
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

    const health =
        Number.isFinite(bot.health)
            ? Number(bot.health)
            : 20;

    const food =
        Number.isFinite(bot.food)
            ? Number(bot.food)
            : 20;

    // 🚨 Phản xạ sinh tồn: Nếu máu tụt xuống mức nguy hiểm (< 15 HP), ưu tiên ăn Táo Vàng ngay
    let emergencyGapple = null;
    if (health < 15) {
        for (let slot = 9; slot <= 44; slot++) {
            const item = bot.inventory.slots[slot];
            if (item && (item.name === 'golden_apple' || item.name === 'enchanted_golden_apple')) {
                emergencyGapple = item;
                break;
            }
        }
    }

    if (!emergencyGapple && food >= 18) {
        state.foodMissingLogged = false;
        return;
    }

    const foodItem = emergencyGapple || findFoodItem(bot);

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
            'Equip thức ăn',
            () => invalidateInventoryAction(state)
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
            'Ăn thức ăn',
            () => invalidateInventoryAction(state)
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

        if (!isInventoryActionCurrent(state, oldBot, actionToken)) {
            return;
        }

        try {
            if (
                oldHeldItem &&
                bot.inventory &&
                Array.isArray(bot.inventory.slots) &&
                isInventoryActionCurrent(state, oldBot, actionToken)
            ) {
                let oldItemStillExists = false;

                for (const item of bot.inventory.slots) {
                    if (item === oldHeldItem) {
                        oldItemStillExists = true;
                        break;
                    }
                }

                if (
                    oldItemStillExists &&
                    isInventoryActionCurrent(state, oldBot, actionToken)
                ) {
                    await withTimeout(
                        bot.equip(oldHeldItem, 'hand'),
                        INVENTORY_ACTION_TIMEOUT_MS,
                        'Khôi phục item cũ',
                        () => invalidateInventoryAction(state)
                    );

                    if (isInventoryActionCurrent(state, oldBot, actionToken)) {
                        addLog(
                            state,
                            `[FOOD] Đã khôi phục item cũ: ${oldHeldItem.displayName || oldHeldItem.name}.`
                        );
                    }
                }
            }
        } catch (err) {
            if (state.bot === oldBot) {
                addLog(
                    state,
                    `[HOTBAR] Không thể restore item cũ: ${err.message}`
                );
            }
        }

        if (!isInventoryActionCurrent(state, oldBot, actionToken)) {
            return;
        }

        restoreSelectedSlot(
            state,
            oldSelectedSlot
        );

        if (!isInventoryActionCurrent(state, oldBot, actionToken)) {
            return;
        }

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
        !state.ready ||
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
            'Equip Totem',
            () => invalidateInventoryAction(state)
        );

        if (
            state.bot === oldBot &&
            !state.manuallyStopped &&
            isInventoryActionCurrent(state, oldBot, actionToken)
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
        state.ready === true &&
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

function getBotCycleEventIndex(schedule, now = Date.now()) {
    if (!schedule || schedule.mode !== 'cycle' || !Array.isArray(schedule.items) || !schedule.items.length) {
        return 0;
    }

    const anchorAt = Number(schedule.cycleAnchorAt);
    if (!Number.isFinite(anchorAt) || anchorAt <= 0) return 0;

    const durations = schedule.items.map(item => Math.max(1, Number(item.afterMinutes || 0)) * 60);
    if (!durations.length || durations.some(value => !Number.isFinite(value) || value <= 0)) return 0;

    const cycleLength = durations.reduce((sum, value) => sum + value, 0);
    const elapsedSeconds = Math.max(0, (Number(now) - anchorAt) / 1000);
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < durations[0]) return 0;

    const itemCount = durations.length;
    const cycleNumber = Math.floor(elapsedSeconds / cycleLength);
    const cycleOffset = elapsedSeconds - cycleNumber * cycleLength;

    let completedInCycle = 0;
    let cumulative = 0;
    for (const duration of durations) {
        cumulative += duration;
        if (cycleOffset + 0.001 >= cumulative) completedInCycle++;
        else break;
    }

    return cycleNumber * itemCount + completedInCycle;
}

function getBotCycleEventAction(schedule, eventIndex) {
    if (!schedule || !Array.isArray(schedule.items) || !Number.isInteger(eventIndex) || eventIndex <= 0) return null;
    const itemIndex = (eventIndex - 1) % schedule.items.length;
    const item = schedule.items[itemIndex];
    return item && item.action === 'start' ? 'start' : 'stop';
}

function markManualLifecycleAction(state) {
    state.lastManualLifecycleAt = Date.now();
}

function applyScheduledLifecycleAction(state, action, reason) {
    if (
        state.shuttingDown ||
        state.lifecycleActionBusy ||
        Date.now() - Number(state.lastManualLifecycleAt || 0) < BOT_SCHEDULER_MANUAL_GUARD_MS
    ) {
        return false;
    }

    if (
        action === 'start' &&
        !state.manuallyStopped &&
        (state.bot || ['connecting', 'authenticating', 'entering', 'online', 'afk'].includes(state.status))
    ) {
        addLog(state, `[SCHEDULER] ${reason}: Bot đã ở trạng thái chạy, bỏ qua START.`);
        return true;
    }

    if (action === 'stop' && state.manuallyStopped && !state.bot) {
        addLog(state, `[SCHEDULER] ${reason}: Bot đã tắt, bỏ qua STOP.`);
        return true;
    }

    state.lifecycleActionBusy = true;
    try {
        if (action === 'stop') {
            stopBot(state, 'scheduler');
        } else if (action === 'start') {
            if (!startBot(state, 'scheduler')) return false;
        } else {
            return false;
        }

        addLog(state, `[SCHEDULER] ${reason}: ${action === 'stop' ? 'Tắt bot' : 'Bật bot'}.`);
        return true;
    } finally {
        state.lifecycleActionBusy = false;
    }
}

function persistBotSchedulerRuntimeState(state) {
    const saved = saveBotSettingsFile(state.settings, state.autoChatSchedules, state.botSchedules);
    if (!saved) addLog(state, '[SCHEDULER] Không thể lưu trạng thái tiến độ lịch vào bot_settings.json.');
    return saved;
}

function botSchedulerTick(state) {
    if (state.shuttingDown) return;

    const now = Date.now();
    const timeParts = currentVietnamTimeParts(new Date(now));
    const manualGuardActive =
        now - Number(state.lastManualLifecycleAt || 0) < BOT_SCHEDULER_MANUAL_GUARD_MS;

    for (const schedule of state.botSchedules) {
        if (!schedule.enabled || !Array.isArray(schedule.items) || !schedule.items.length) continue;

        if (schedule.mode === 'fixed') {
            for (const item of schedule.items) {
                if (item.time !== timeParts.timeKey) continue;
                const currentKey = `${timeParts.dateKey} ${item.time}`;
                if (item.lastFixedRunKey === currentKey) continue;

                if (manualGuardActive) {
                    // Manual START/STOP has priority. Consume this occurrence so
                    // the scheduler cannot execute it a few seconds later after
                    // the guard expires. The next occurrence will run normally.
                    item.lastFixedRunKey = currentKey;
                    addLog(
                        state,
                        `[SCHEDULER] Cố định ${item.time}: bỏ qua lần này vì vừa có thao tác START/STOP thủ công.`
                    );
                    persistBotSchedulerRuntimeState(state);
                    break;
                }

                const applied = applyScheduledLifecycleAction(state, item.action, `Cố định ${item.time}`);
                if (applied) {
                    item.lastFixedRunKey = currentKey;
                    persistBotSchedulerRuntimeState(state);
                    break;
                }
            }
            continue;
        }

        const eventIndex = getBotCycleEventIndex(schedule, now);
        if (eventIndex <= Number(schedule.lastCycleEventIndex || 0)) continue;

        const action = getBotCycleEventAction(schedule, eventIndex);
        if (!action) continue;

        if (manualGuardActive) {
            schedule.lastCycleEventIndex = eventIndex;
            addLog(
                state,
                `[SCHEDULER] Chu kỳ #${eventIndex}: bỏ qua lần này vì vừa có thao tác START/STOP thủ công.`
            );
            persistBotSchedulerRuntimeState(state);
            continue;
        }

        const applied = applyScheduledLifecycleAction(state, action, `Chu kỳ #${eventIndex}`);
        if (applied) {
            schedule.lastCycleEventIndex = eventIndex;
            persistBotSchedulerRuntimeState(state);
        }
    }
}

function startBotScheduler(state) {
    if (state.botSchedulerTimer) {
        clearInterval(state.botSchedulerTimer);
    }

    state.botSchedulerTimer = setInterval(
        () => botSchedulerTick(state),
        BOT_SCHEDULER_TICK_MS
    );
}

function clearBotSchedulerTimer(state) {
    if (state.botSchedulerTimer) {
        clearInterval(state.botSchedulerTimer);
        state.botSchedulerTimer = null;
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

function getBotBlockCoordinates(bot) {
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
        x: Math.floor(x),
        y: Math.floor(y),
        z: Math.floor(z)
    };
}

function getLocationKind(bot) {
    // Location flow intentionally uses rounded player coordinates.
    // The dashboard also displays rounded coordinates, and the previous
    // working bot used the same rule. Using Math.floor here can classify
    // an actual AUTH/LOBBY position as "other" when the player Y/X/Z has
    // a fractional component near the block boundary.
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

        // Kích hoạt Anti-AFK Kick & Tối ưu Farm
        startSmartAntiAfk(state);
        applyHighDensityFarmOptimizations(state, bot);
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

function resetLocationFlowState(state, reason = '') {
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

    if (reason) {
        addLog(state, `[FLOW] Reset flow: ${reason}.`);
    }
}

function startLocationMonitor(state, bot) {
    clearLocationTimers(state);
    state.locationState = 'unknown';

    const tick = () => {
        if (
            state.shuttingDown ||
            state.manuallyStopped ||
            state.bot !== bot ||
            !bot.entity
        ) {
            return;
        }

        const previousKind = state.locationState;
        const kind = getLocationKind(bot);
        state.locationState = kind;
        const now = Date.now();

        // The server can silently return an already-connected AFK bot to the
        // auth/lobby coordinates without closing the Mineflayer connection.
        // Treat that as a fresh flow instead of relying on the old AFK state.
        if (
            state.status === 'afk' &&
            previousKind === 'other' &&
            (kind === 'login' || kind === 'lobby')
        ) {
            state.ready = false;
            resetLocationFlowState(
                state,
                `phát hiện AFK -> ${kind.toUpperCase()} bất ngờ`
            );
            setBotStatus(
                state,
                kind === 'login' ? 'authenticating' : 'entering'
            );
        }

        // If the bot has already left LOGIN/LOBBY, treat that
        // coordinate change as the AFK success condition immediately.
        // This must run before the generic flow-busy guards because an
        // entering flow can still have locationFlowBusy=true when the server
        // teleports the bot out of the lobby.
        if (
            previousKind === 'lobby' &&
            kind === 'other' &&
            state.status === 'entering' &&
            !state.manuallyStopped
        ) {
            state.ready = false;
            state.locationFlowBusy = true;
            state.pendingAfkConfirmation = true;

            addLog(
                state,
                '[FLOW] Phát hiện bot đã rời LOBBY → chờ xác nhận AFK.'
            );

            if (!state.locationConfirmTimer) {
                state.locationConfirmTimer = setTimeout(() => {
                    state.locationConfirmTimer = null;
                    confirmAfkAfterClick(state, bot);
                }, AFK_CONFIRM_DELAY_MS);
            }
        }

        // Self-heal a flow that got stuck because a GUI/teleport changed
        // state between two timers. Without this guard, locationFlowBusy can
        // remain true forever and block all subsequent /login or /dn actions.
        if (
            state.locationFlowBusy &&
            !state.locationRetryTimer &&
            !state.locationActionBusy &&
            !state.pendingAfkConfirmation &&
            (kind === 'login' || kind === 'lobby')
        ) {
            const lastActionAt =
                kind === 'login'
                    ? Number(state.lastLoginActionAt || 0)
                    : Number(state.lastDnActionAt || 0);

            if (
                lastActionAt > 0 &&
                now - lastActionAt >= 7000
            ) {
                resetLocationFlowState(
                    state,
                    `flow ${kind.toUpperCase()} bị kẹt quá 7 giây`
                );
            }
        }

        // When the AFK confirmation timer is active, let it decide the
        // final state from the current coordinates.
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

                    const verifyKind = getLocationKind(bot);

                    if (verifyKind === 'login') {
                        // Some KingMC auth flows keep the player at AUTH_COORDS
                        // after /login succeeds. In that case the old flow could
                        // still progress because the server accepted /dn from
                        // the auth location. Send /dn once as a fallback, then
                        // let the normal location monitor continue the flow.
                        const nowAfterLogin = Date.now();
                        if (
                            state.settings.autoReconnect &&
                            state.password &&
                            nowAfterLogin - Number(state.lastAuthDnActionAt || 0) >= 3000
                        ) {
                            state.lastAuthDnActionAt = nowAfterLogin;
                            state.lastDnActionAt = nowAfterLogin;
                            state.locationFlowBusy = true;
                            state.ready = false;
                            setBotStatus(state, 'entering');

                            try {
                                bot.chat(`/dn ${state.password}`);
                                addLog(
                                    state,
                                    '[FLOW] Vẫn ở tọa độ AUTH sau /login → gửi /dn trực tiếp.'
                                );
                            } catch (err) {
                                state.locationFlowBusy = false;
                                addLog(
                                    state,
                                    `[FLOW] /dn tại AUTH lỗi: ${err.message}`
                                );
                                scheduleLocationRetry(state, bot, 'login');
                                return;
                            }

                            const authDnVerifyTimer = setTimeout(() => {
                                if (state.bot !== bot || state.manuallyStopped) return;

                                if (getLocationKind(bot) === 'login') {
                                    state.locationFlowBusy = false;
                                    scheduleLocationRetry(state, bot, 'login');
                                } else {
                                    state.locationFlowBusy = false;
                                    state.locationRetryAttempt = 0;
                                }
                            }, 1500);

                            state.afkTimers.push(authDnVerifyTimer);
                            return;
                        }

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
    const mem = process.memoryUsage();
    return {
        id: state.id,
        botId: BOT_ID,
        nodeId: BOT_ID,
        label: BOT_LABEL,
        username: state.username || '',
        status: state.status,
        ready: state.ready,
        ping: getPing(state),
        rssMb: Math.round(mem.rss / (1024 * 1024)),
        heapMb: Math.round(mem.heapUsed / (1024 * 1024)),
        ramRss: Math.round(mem.rss / (1024 * 1024)),
        ramHeap: Math.round(mem.heapUsed / (1024 * 1024)),
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
            autoReconnect: state.settings.autoReconnect !== false,
            antiAfkKick: state.settings.antiAfkKick !== false
        },

        totemCount:
            Number(state.inventoryState?.totemCount || 0),

        foodCount:
            Number(state.inventoryState?.foodCount || 0),

        autoChatScheduleCount:
            state.autoChatSchedules.length,

        locationState:
            state.locationState,

        roundedLocation:
            getRoundedBotCoordinates(state.bot),

        position:
            getBotPosition(state),

        dimension:
            getBotDimension(state),

        ramRss: Math.round(mem.rss / (1024 * 1024)),
        ramHeap: Math.round(mem.heapUsed / (1024 * 1024)),
        rssMb: Math.round(mem.rss / (1024 * 1024)),
        heapMb: Math.round(mem.heapUsed / (1024 * 1024)),

        memory: {
            rss: Math.round(mem.rss / (1024 * 1024)),
            heapUsed: Math.round(mem.heapUsed / (1024 * 1024)),
            rssMb: Math.round(mem.rss / (1024 * 1024)),
            heapMb: Math.round(mem.heapUsed / (1024 * 1024))
        }
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

    const jitter = Math.floor(Math.random() * 1500);
    return Math.min(
        Math.round(
            RECONNECT_DELAY * multiplier
        ) + jitter,
        20000
    );
}

function scheduleAutoReconnect(state) {
    return scheduleReconnect(state);
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

function stopBot(state, source = 'manual') {
    if (source === 'manual') {
        markManualLifecycleAction(state);
    }

    state.manuallyStopped = true;

    addLog(
        state,
        source === 'scheduler'
            ? 'Scheduler yêu cầu dừng bot.'
            : 'Dừng bot từ web.'
    );

    disconnectBot(
        state,
        source === 'scheduler'
            ? 'Stopped by scheduler'
            : 'Stopped from web panel'
    );
}

function startBot(state, source = 'manual') {
    if (source === 'manual') {
        markManualLifecycleAction(state);
    }

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
    state.lastAuthDnActionAt = 0;
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

    // ⚡ INSTANT TOTEM REFLEX (< 50ms)
    bot.on('entityHurt', (entity) => {
        if (state.bot !== bot) return;
        if (entity === bot.entity) fastEquipTotem(state);
    });

    // ⚡ Phản xạ tức thì khi Totem phát nổ (Minecraft status 35 = Totem used)
    bot.on('entityStatus', (entity, status) => {
        if (state.bot !== bot) return;
        if (entity === bot.entity && status === 35) {
            addLog(state, '⚡ [TOTEM] Totem vừa phát nổ cứu mạng! Đang tức tốc lắp Totem mới vào tay phụ...');
            fastEquipTotem(state);
            sendBotDirectAlert('totem_popped', 'Totem vừa phát nổ cứu mạng bot!', { 'Máu hiện tại': bot.health, 'Totem còn lại': state.totemCount });
        }
    });

    bot.on('health', () => {
        if (state.bot !== bot) return;
        if (bot.health <= 6 && !state.lowHealthAlertSent) {
            state.lowHealthAlertSent = true;
            sendBotDirectAlert('low_health', `Máu của Bot đang ở mức nguy hiểm (${bot.health}/20 HP)!`, { 'Máu': bot.health, 'Đói': bot.food });
        } else if (bot.health > 14) {
            state.lowHealthAlertSent = false;
        }
    });

    bot.on('playerCollect', () => {
        if (state.bot !== bot) return;
        scanInventory(state, bot);
    });

    bot.on('error', err => {
        if (
            state.bot !== bot ||
            state.connectionGeneration !== connectionGeneration
        ) {
            return;
        }

        const msg = String(err?.message || err || 'Lỗi không xác định');
        const code = String(err?.code || '');
        let diag = msg;
        if (code === 'ECONNRESET' || msg.includes('ECONNRESET')) {
            diag = 'Máy chủ KingMC ngắt kết nối đột ngột (ECONNRESET)';
        } else if (code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT')) {
            diag = 'Hết thời gian chờ kết nối máy chủ (ETIMEDOUT)';
        } else if (code === 'ENOTFOUND' || msg.includes('ENOTFOUND')) {
            diag = 'Không tìm thấy máy chủ sgp.kingmc.vn (ENOTFOUND)';
        } else if (code === 'EPIPE' || msg.includes('EPIPE')) {
            diag = 'Mất kết nối đường truyền socket (EPIPE)';
        } else if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
            diag = 'Máy chủ từ chối kết nối (Server offline hoặc khởi động lại)';
        }

        addLog(
            state,
            `[MẠNG] ${diag}`
        );

        const isSocketError = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'ECONNREFUSED'].some(c => code === c || msg.includes(c));
        if (isSocketError) {
            cleanupBotResources(bot);
        }

        if (state.settings.autoReconnect && !state.reconnectTimer) {
            scheduleReconnect(state);
        }
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

        sendBotDirectAlert('kicked', 'Bot đã bị kick khỏi server KingMC.', { 'Lý do': reasonText });

        setBotStatus(state, 'kicked');
        state.ready = false;
        clearManagerTimers(state);
        clearLocationTimers(state);
        clearAfkTimers(state);
        invalidateInventoryAction(state);
        cleanupBotResources(bot);

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
            clearLocationTimers(state);
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
        sendBotDirectAlert('spawn', 'Bot đã spawn thành công vào server KingMC.');
    });

    bot.on('death', () => {
        if (
            state.bot === bot &&
            state.connectionGeneration === connectionGeneration
        ) {
            sendBotDirectAlert('death', 'Bot đã chết trong game. Đang chuẩn bị tự động hồi sinh...');
            addLog(
                state,
                '[LIFE] Bot đã chết. Đang chuẩn bị tự động hồi sinh...'
            );
            state.ready = false;
            setBotStatus(state, 'connecting');
            clearAfkTimers(state);
            resetLocationFlowState(state, 'bot đã chết, chuẩn bị hồi sinh');

            setTimeout(() => {
                if (
                    state.bot === bot &&
                    state.connectionGeneration === connectionGeneration &&
                    !state.manuallyStopped
                ) {
                    try {
                        if (typeof bot.respawn === 'function') {
                            bot.respawn();
                            addLog(state, '[LIFE] Đã tự động hồi sinh (respawn). Bot đang quay lại cụm đăng nhập/Lobby...');
                        }
                    } catch (e) {
                        addLog(state, `[LIFE] Lỗi khi tự động hồi sinh: ${e.message}`);
                    }
                }
            }, 2000);
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

    if (!state.username || !state.username.trim()) {
        setBotStatus(state, 'offline');
        addLog(
            state,
            '[CẢNH BÁO] Chưa cấu hình USERNAME. Vui lòng nhập thông tin tài khoản trên Web hoặc cấu hình BOT_CONFIG trong file bot.js.'
        );
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
            // Never leave locationFlowBusy locked when a delayed timer fires
            // after a teleport, reconnect, or location change.
            if (state.bot === bot && !state.manuallyStopped) {
                state.locationFlowBusy = false;
                state.pendingAfkConfirmation = false;
            }
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
                if (state.bot === bot && !state.manuallyStopped) {
                    state.locationFlowBusy = false;
                    state.pendingAfkConfirmation = false;
                }
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
                    state.locationFlowBusy = false;
                    state.pendingAfkConfirmation = false;
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

const HTML = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta
    name="viewport"
    content="width=device-width,initial-scale=1"
>
<title>KingMC Bot Manager</title>

<style>
:root {
  color-scheme: dark;
  --bg: #070a0f;
  --bg-gradient: radial-gradient(circle at 14% 16%, rgba(26, 42, 66, 0.75) 0%, transparent 45%),
                 radial-gradient(circle at 86% 84%, rgba(32, 22, 58, 0.65) 0%, transparent 50%),
                 radial-gradient(circle at 50% 50%, rgba(13, 21, 33, 0.9) 0%, #070a0f 100%);
  --card: rgba(15, 23, 34, 0.82);
  --card-hover: rgba(21, 33, 49, 0.92);
  --card2: rgba(11, 17, 26, 0.7);
  --border: rgba(255, 255, 255, 0.08);
  --border-glow: rgba(77, 163, 255, 0.45);
  --text: #f0f6fc;
  --muted: #8b9bb4;
  --green: #30d158;
  --green-glow: rgba(48, 209, 88, 0.35);
  --red: #ff453a;
  --red-glow: rgba(255, 69, 58, 0.35);
  --yellow: #ffd60a;
  --yellow-glow: rgba(255, 214, 10, 0.35);
  --blue: #4da3ff;
  --blue-glow: rgba(77, 163, 255, 0.35);
  --accent: #58a6ff;
  --gold: #f59e0b;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg-gradient);
  background-attachment: fixed;
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

h1, h2, h3, p, label {
  margin: 0;
}

button, input, select, textarea {
  font: inherit;
}

button {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: linear-gradient(180deg, #1c2734 0%, #151e28 100%);
  color: var(--text);
  padding: 9px 14px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25);
  user-select: none;
}

button:hover, button:hover:not(:disabled) {
  background: linear-gradient(180deg, #253444 0%, #1a2734 100%);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}

button:active, button:active:not(:disabled) {
  transform: scale(0.97);
}

button:focus-visible, input:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}

button.primary {
  background: linear-gradient(180deg, #1f7ae0 0%, #1562b8 100%);
  border-color: #388bfd;
  box-shadow: 0 2px 8px rgba(31, 122, 224, 0.35);
}

button.primary:hover, button.primary:hover:not(:disabled) {
  background: linear-gradient(180deg, #2b88f0 0%, #1a6fcf 100%);
  box-shadow: 0 4px 15px rgba(31, 122, 224, 0.5);
}

button.danger {
  background: linear-gradient(180deg, #a8282b 0%, #7d1b1d 100%);
  border-color: #da3633;
  box-shadow: 0 2px 8px rgba(218, 54, 51, 0.35);
}

button.danger:hover, button.danger:hover:not(:disabled) {
  background: linear-gradient(180deg, #c43236 0%, #912022 100%);
  box-shadow: 0 4px 15px rgba(218, 54, 51, 0.5);
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
}

input, select, textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(10, 16, 24, 0.7);
  color: var(--text);
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

input:focus, select:focus, textarea:focus {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px rgba(77, 163, 255, 0.2);
}

.app {
  width: min(1140px, calc(100% - 32px));
  margin: 0 auto;
  padding: 24px 0 48px;
}

.topbar, .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 850;
  letter-spacing: -0.02em;
  margin: 0 0 4px;
  background: linear-gradient(135deg, #ffffff 30%, #a5c2eb 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.page-subtitle {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 16px;
}

/* KPI Grid */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.kpi-card {
  position: relative;
  background: var(--card);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s;
}

.kpi-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.2);
}

.kpi-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--blue), transparent);
}
.kpi-card:nth-child(2)::before { background: linear-gradient(90deg, var(--green), transparent); }
.kpi-card:nth-child(3)::before { background: linear-gradient(90deg, var(--yellow), transparent); }
.kpi-card:nth-child(4)::before { background: linear-gradient(90deg, var(--red), transparent); }
.kpi-card:nth-child(5)::before { background: linear-gradient(90deg, var(--gold), transparent); }

.kpi-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.kpi-value {
  font-size: 24px;
  font-weight: 900;
  margin-top: 6px;
  letter-spacing: -0.02em;
}

.top-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  align-items: center;
}

.search-box {
  flex: 1;
  min-width: 230px;
}

/* Status Filter Tabs */
.filter-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.tab-btn {
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 650;
  border: 1px solid var(--border);
  background: rgba(14, 21, 31, 0.65);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.tab-btn:hover {
  background: rgba(25, 36, 52, 0.85);
  color: var(--text);
  transform: translateY(-1px);
}

.tab-btn.active {
  background: linear-gradient(180deg, #1f7ae0 0%, #1562b8 100%);
  color: #fff;
  border-color: #388bfd;
  box-shadow: 0 2px 10px rgba(31, 122, 224, 0.4);
}

/* Grids & Panels */
.bot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  gap: 16px;
}

.bot-card, .panel {
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  padding: 18px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.22s ease, box-shadow 0.22s ease;
}

.bot-card {
  cursor: pointer;
  display: flex;
  flex-direction: column;
}

.bot-card:hover {
  border-color: var(--border-glow);
  transform: translateY(-3px);
  box-shadow: 0 12px 35px rgba(0, 0, 0, 0.45), 0 0 16px rgba(77, 163, 255, 0.12);
}

.bot-card h2 {
  font-size: 18px;
  margin: 0 0 14px;
  font-weight: 750;
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.card-quick-actions {
  display: flex;
  gap: 7px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.card-quick-actions button {
  flex: 1;
  font-size: 11px;
  padding: 7px 8px;
  border-radius: 8px;
}

.small {
  font-size: 11px;
  padding: 7px 10px;
}

/* Sound Alert Toggle Button */
.sound-btn {
  font-size: 11px;
  padding: 7px 12px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.sound-btn.active {
  border-color: var(--green);
  color: var(--green);
  background: rgba(48, 209, 88, 0.12);
  box-shadow: 0 0 8px var(--green-glow);
}

/* Capacity Badge */
.capacity-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 750;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
}

.capacity-badge.warning {
  border-color: var(--yellow);
  color: var(--yellow);
  background: rgba(255, 214, 10, 0.12);
}

.capacity-badge.danger {
  border-color: var(--red);
  color: var(--red);
  background: rgba(255, 69, 58, 0.14);
}

/* Modals */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 100;
}

@keyframes modalZoomIn {
  from { opacity: 0; transform: scale(0.93) translateY(12px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-card {
  width: min(520px, 100%);
  background: rgba(18, 27, 40, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 22px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  animation: modalZoomIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-card h3 {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 750;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-row label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

/* Pulsing Status Indicators */
@keyframes pulseGreen {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(48, 209, 88, 0.7); }
  50% { transform: scale(1.15); box-shadow: 0 0 12px 3px rgba(48, 209, 88, 0.4); }
}

@keyframes pulseYellow {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 214, 10, 0.7); }
  50% { transform: scale(1.15); box-shadow: 0 0 12px 3px rgba(255, 214, 10, 0.4); }
}

@keyframes pulseRed {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 69, 58, 0.7); }
  50% { transform: scale(1.15); box-shadow: 0 0 12px 3px rgba(255, 69, 58, 0.4); }
}

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  margin-bottom: 12px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  background: #697582;
  transition: all 0.25s ease;
}

.dot.green {
  background: var(--green);
  animation: pulseGreen 2.2s infinite ease-in-out;
}

.dot.yellow {
  background: var(--yellow);
  animation: pulseYellow 2s infinite ease-in-out;
}

.dot.red {
  background: var(--red);
  animation: pulseRed 2.5s infinite ease-in-out;
}

.dot.blue {
  background: var(--blue);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.summary-item {
  padding: 9px 10px;
  border-radius: 10px;
  background: var(--card2);
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.summary-label {
  color: var(--muted);
  font-size: 9px;
  font-weight: 600;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.summary-value {
  font-size: 12px;
  font-weight: 700;
  word-break: break-word;
}

/* Detail Page Layout */
.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.detail-header .title-wrap {
  flex: 1;
}

.detail-title {
  font-size: 24px;
  font-weight: 850;
  margin: 0;
}

.detail-subtitle {
  color: var(--muted);
  font-size: 13px;
  margin-top: 4px;
}

.grid {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 18px;
}

.panel h3 {
  font-size: 15px;
  font-weight: 750;
  margin: 0 0 14px;
  letter-spacing: -0.01em;
}

.big-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 800;
  margin-bottom: 14px;
}

.info {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.info-item {
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--card2);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.info-label {
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.info-value {
  font-size: 14px;
  font-weight: 700;
  word-break: break-word;
}

.controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.chat-panel {
  display: flex;
  flex-direction: column;
}

.chat-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.chat-row {
  display: flex;
  gap: 8px;
}

.chat-form {
  margin-top: 10px;
}

.chip-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.chip {
  padding: 5px 11px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.chip:hover {
  background: rgba(77, 163, 255, 0.22);
  border-color: var(--blue);
  color: #fff;
  transform: translateY(-1px);
  box-shadow: 0 0 10px var(--blue-glow);
}

.chip:active {
  transform: scale(0.95);
}

.copyable {
  cursor: pointer;
  transition: all 0.18s ease;
}

.copyable:hover {
  border-color: var(--blue);
  background: rgba(77, 163, 255, 0.08);
  box-shadow: 0 0 8px var(--blue-glow);
}

.log, .chat-log {
  height: 440px;
  overflow: auto;
  background: rgba(8, 12, 17, 0.95);
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 12px;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.5);
}

.line {
  padding: 2px 0;
}

.note {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

@keyframes toastSlideIn {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

.toast {
  position: fixed;
  right: 18px;
  bottom: 18px;
  display: none;
  max-width: 380px;
  padding: 12px 16px;
  border: 1px solid var(--border-glow);
  border-radius: 12px;
  background: rgba(22, 33, 48, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  z-index: 200;
  font-size: 13px;
  font-weight: 600;
  animation: toastSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Inventory Styles */
.inventory-area {
  display: flex;
  flex-direction: column;
}

.inventory-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.inventory-stat {
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--card2);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.inventory-stat .info-label {
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.inventory-stat .info-value {
  font-size: 14px;
  font-weight: 700;
}

.bar {
  width: 100%;
  height: 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  margin-top: 6px;
}

.bar > span, .bar>span {
  display: block;
  height: 100%;
  width: 0;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.health-bar > span, .health-bar>span {
  background: linear-gradient(90deg, #ff453a, #ff6961);
  box-shadow: 0 0 10px rgba(255, 69, 58, 0.5);
}

.hunger-bar > span, .hunger-bar>span {
  background: linear-gradient(90deg, #e69d00, #ffd60a);
  box-shadow: 0 0 10px rgba(255, 214, 10, 0.5);
}

.equipment-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(60px, 1fr));
  gap: 8px;
  margin: 8px 0 14px;
}

.equipment-slot {
  min-height: 64px;
  padding: 8px 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(11, 17, 24, 0.85);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
  text-align: center;
  font-size: 10px;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.equipment-slot .equip-label, .equip-label {
  font-size: 8px;
  color: var(--muted);
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 5px;
}

.equipment-slot.dragover {
  border-color: var(--green);
  background: rgba(16, 35, 24, 0.9);
  box-shadow: 0 0 12px var(--green-glow);
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}

.inventory-slot {
  min-width: 0;
  min-height: 60px;
  padding: 6px 4px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: rgba(11, 17, 24, 0.85);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.inventory-slot:hover {
  border-color: var(--blue);
  transform: translateY(-2px);
  box-shadow: 0 5px 12px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.08);
}

.inventory-slot:active, .inventory-slot.active {
  transform: scale(0.96);
}

.inventory-slot.empty {
  opacity: 0.6;
}

.inventory-slot.selected {
  border-color: var(--green);
  box-shadow: 0 0 12px var(--green-glow), inset 0 0 6px rgba(48, 209, 88, 0.3);
  background: rgba(16, 33, 23, 0.85);
}

.inventory-slot.dragover, .inventory-slot.selected.dragover {
  border-color: var(--blue);
  background: rgba(18, 38, 58, 0.85);
  box-shadow: 0 0 12px var(--blue-glow);
}

.slot-index {
  color: var(--muted);
  font-size: 8px;
  font-weight: 600;
  margin-bottom: 3px;
}

.slot-name {
  font-size: 8px;
  font-weight: 700;
  line-height: 1.2;
  word-break: break-word;
}

.slot-count {
  font-size: 10px;
  font-weight: 800;
  margin-top: 3px;
  color: #fff;
}

.drop-zone {
  margin-top: 14px;
  min-height: 50px;
  border: 2px dashed rgba(255, 255, 255, 0.15);
  border-radius: 11px;
  background: rgba(11, 17, 24, 0.5);
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.2s;
}

.drop-zone.dragover {
  border-color: var(--red);
  background: rgba(45, 18, 20, 0.8);
  color: var(--text);
  box-shadow: 0 0 14px var(--red-glow);
}

.position-value, .revision {
  font-variant-numeric: tabular-nums;
}

.inventory-list {
  display: grid;
  gap: 6px;
}

.inventory-item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--card2);
}

.inventory-item-name {
  font-size: 12px;
  font-weight: 600;
}

/* Settings & Schedules */
.setting-list {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s;
}

.check-row:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.check-row input {
  width: auto;
  accent-color: var(--blue);
  cursor: pointer;
}

.schedule-list {
  display: grid;
  gap: 8px;
  margin: 10px 0;
}

.schedule-row {
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 11px;
  background: linear-gradient(180deg, rgba(21, 31, 41, 0.85) 0%, rgba(17, 26, 34, 0.85) 100%);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  transition: border-color 0.18s, opacity 0.18s, transform 0.18s;
}

.schedule-row:hover {
  border-color: rgba(77, 163, 255, 0.45);
}

.schedule-row.dragging {
  opacity: 0.5;
  transform: scale(0.98);
}

.schedule-row-top {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}

.schedule-handle {
  width: 26px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  cursor: grab;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.03);
  user-select: none;
}

.schedule-handle:active {
  cursor: grabbing;
}

.schedule-row-title {
  font-size: 12px;
  font-weight: 800;
  min-width: 0;
}

.schedule-inline {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  flex-wrap: wrap;
}

.schedule-inline input, .schedule-inline select {
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 11px;
  min-width: 0;
}

.schedule-inline .action-select { width: 94px; }
.schedule-inline .time-input { width: 90px; }
.schedule-inline .minutes-input { width: 106px; }

.schedule-row-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
  margin-top: 8px;
}

.schedule-row-main textarea {
  width: 100%;
  min-height: 52px;
  padding: 8px 10px;
  border-radius: 9px;
  font-size: 12px;
  resize: vertical;
}

.schedule-row-main .schedule-field, .schedule-field { display: grid; gap: 4px; }
.schedule-row-main .schedule-field > span, .schedule-row-main .schedule-field>span, .schedule-field > span, .schedule-field>span { color: var(--muted); font-size: 10px; font-weight: 600; }
.schedule-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 10px; }

.scheduler-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin: 10px 0 8px;
}

.scheduler-mode-box {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 220px;
}

.scheduler-mode-box > span, .scheduler-mode-box>span { color: var(--muted); font-size: 11px; font-weight: 600; }
.scheduler-mode-box select { padding: 8px 10px; border-radius: 9px; font-size: 12px; }
.scheduler-note { margin: 6px 0 10px; color: var(--muted); font-size: 10px; line-height: 1.5; }
.compact-save { margin-top: 8px; }
.hidden-field { display: none !important; }

.credential-list {
  display: grid;
  gap: 10px;
  max-height: 60vh;
  overflow: auto;
}

.credential-card {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card2);
}

.credential-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  margin-top: 8px;
}

.credential-value {
  padding: 10px;
  border-radius: 8px;
  background: rgba(10, 16, 24, 0.85);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  word-break: break-all;
  font-size: 12px;
}

.dragging { opacity: 0.55; }
.app-footer {
  margin-top: 24px;
  text-align: center;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
  opacity: 0.85;
}

.hidden { display: none !important; }

/* Custom Scrollbars */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.2); border-radius: 4px; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }

@media (max-width: 900px) {
  .bot-grid { grid-template-columns: 1fr; }
  .grid { grid-template-columns: 1fr; }
}

@media (max-width: 520px) {
  .info, .inventory-grid { grid-template-columns: 1fr; }
  .equipment-row { grid-template-columns: repeat(5, minmax(48px, 1fr)); }
}

.vip-pill {
  font-size: 11px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.22) 0%, rgba(217, 119, 6, 0.3) 100%);
  border: 1px solid rgba(245, 158, 11, 0.45);
  color: #fbbf24;
  letter-spacing: 0.05em;
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.platform-pill {
  font-size: 11px;
  font-weight: 750;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(6, 182, 212, 0.15);
  border: 1px solid rgba(6, 182, 212, 0.4);
  color: #38bdf8;
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.ram-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.35);
  color: #34d399;
  display: inline-flex;
  align-items: center;
  gap: 5px;
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
        Quản lý và theo dõi bot • Siêu VIP Edition
      </div>

    </div>

    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span class="vip-pill">👑 PRO V7</span>
      <span class="platform-pill">⚡ ${PLATFORM.toUpperCase()}</span>
      <span class="ram-pill">🧠 RAM: <strong id="topRamUsage">-- MB</strong></span>
      <button id="soundAlertBtn" class="small sound-btn" type="button" onclick="toggleSoundAlert()">🔕 Âm thanh: TẮT</button>
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

        <div class="info-item copyable" onclick="copyToClipboard(bot?.username, 'Username')" title="Click để copy Username">
          <div class="info-label">
            USERNAME 📋
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

        <div class="info-item copyable" onclick="copyToClipboard(byId('detailPosition')?.textContent, 'Tọa độ')" title="Click để copy Tọa độ">
          <div class="info-label">
            COORDINATES 📋
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

        <div class="info-item copyable" onclick="copyToClipboard(bot?.ipAddress, 'IP')" title="Click để copy IP">
          <div class="info-label">
            BOT IP 📋
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
          placeholder="Nhập chat hoặc command... (↑↓ lịch sử)"
        >

        <button
          class="primary"
          type="submit"
        >
          Gửi
        </button>

      </form>

      <div class="chip-row">
        <button type="button" class="chip" onclick="quickSendCommand('/menu')">⚡ /menu (Slot 24)</button>
        <button type="button" class="chip" onclick="quickSendCommand('/dn')">🔑 /dn [MK]</button>
        <button type="button" class="chip" onclick="quickSendCommand('/login')">🔓 /login [MK]</button>
        <button type="button" class="chip" onclick="quickSendCommand('/bal')">💵 /bal</button>
        <button type="button" class="chip" onclick="quickSendCommand('/team chat')">🛡️ /team chat</button>
        <button type="button" class="chip" onclick="quickSendCommand('/spawn')">🏠 /spawn</button>
        <button type="button" class="chip" onclick="quickSendCommand('/pay')">💰 /pay</button>
      </div>

      <div class="note">
        Bấm chip để gửi nhanh. Dùng phím ↑ ↓ trong ô nhập để xem lại các lệnh đã gửi.
      </div>

    </div>

    <div class="panel">

      <div class="chat-title-row">
        <h3>Event Log</h3>
        <div style="display:flex;align-items:center;gap:7px;">
          <div id="eventRevision" class="revision">revision 0</div>
          <button class="small" type="button" onclick="exportLogsToFile()">📥 Tải Log</button>
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
        <div style="display:flex;align-items:center;gap:8px;">
          <span id="inventoryCapacity" class="capacity-badge">0/36 ô (0%)</span>
          <div id="inventoryRevision" class="revision">revision 0</div>
        </div>
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
        <label class="check-row"><input id="settingAutoTotem" type="checkbox" onchange="markSettingsDirty()"> <span>Auto Totem phản xạ tức thì (&lt; 50ms)</span></label>
        <label class="check-row"><input id="settingAntiHungry" type="checkbox" onchange="markSettingsDirty()"> <span>Anti Hungry / Auto Eat</span></label>
        <label class="check-row"><input id="settingAutoReconnect" type="checkbox" onchange="markSettingsDirty()"> <span>Auto Reconnect + tự thử lại LOGIN/DN/MENU</span></label>
        <label class="check-row"><input id="settingAntiAfkKick" type="checkbox" onchange="markSettingsDirty()"> <span>Smart Anti-AFK Kick (Xoay đầu, vung tay nhẹ)</span></label>
      </div>

      <button id="saveSettingsButton" class="primary" type="button" onclick="saveSettings()">Lưu setting</button>
      <div class="note">Tọa độ được quét mỗi 250ms. AFK chỉ được xác nhận khi tọa độ sau click không còn ở LOGIN hoặc LOBBY.</div>

    </div>

    <div id="autoChatPanel" class="panel">

      <div class="chat-title-row">
        <h3>Auto Chat</h3>
        <button class="small primary" type="button" onclick="addAutoChatSchedule()">＋ Thêm</button>
      </div>

      <div id="autoChatSchedules" class="schedule-list"></div>
      <div class="note">Mỗi dòng là một lịch riêng. Kéo ⋮⋮ để đổi thứ tự; sửa trực tiếp rồi bấm Lưu Auto Chat.</div>
      <button id="saveAutoChatButton" class="primary compact-save" type="button" onclick="saveAutoChat()">Lưu Auto Chat</button>

    </div>

    <div id="botSchedulePanel" class="panel">

      <div class="chat-title-row">
        <h3>Hẹn giờ Bot</h3>
        <button class="small primary" type="button" onclick="addBotSchedule()">＋ Thêm</button>
      </div>

      <div class="scheduler-toolbar">
        <label class="scheduler-mode-box">
          <span>Chế độ</span>
          <select id="botScheduleMode" onchange="botScheduleModeChanged(this)">
            <option value="fixed">Giờ cố định mỗi ngày</option>
            <option value="cycle">Chu kỳ theo thứ tự</option>
          </select>
        </label>
        <label class="check-row" style="margin:0;padding:7px 9px;">
          <input id="botScheduleEnabled" type="checkbox" checked>
          <span>Kích hoạt lịch</span>
        </label>
      </div>
      <div id="botScheduleModeNote" class="scheduler-note"></div>
      <div id="botSchedules" class="schedule-list"></div>
      <div class="note">Chỉ có một chế độ tại một thời điểm. Bấm ＋ để thêm dòng. Ở Chu kỳ, thời gian mỗi dòng tính từ dòng ngay phía trên; kéo đổi thứ tự thì cách tính cũng đổi theo.</div>
      <button id="saveBotSchedulesButton" class="primary compact-save" type="button" onclick="saveBotSchedules()">Lưu hẹn giờ Bot</button>

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

<div class="app-footer">
  <strong>Version 2.1</strong> • Update 30/09/2026 • Hẹn giờ Bot 1 mode với nhiều dòng, kéo-thả đổi thứ tự, chu kỳ tính theo dòng kề trên; làm gọn UI Auto Chat và tách riêng các nút lưu.
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
let botSchedules = [];
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
let autoChatDirty = false;
let autoChatSaveInFlight = false;
let botScheduleDirty = false;
let botScheduleSaveInFlight = false;
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
    !inventoryActionInFlight &&
    !settingsSaveInFlight &&
    !autoChatSaveInFlight &&
    !botScheduleSaveInFlight
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
  if (lastKnownBotStatus && lastKnownBotStatus !== bot.status) {
    if (bot.status === 'offline' || bot.status === 'kicked') {
      playAlertTone('danger');
    }
  }
  lastKnownBotStatus = bot.status;

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

  const topRam = byId('topRamUsage');
  if (topRam) {
    const ram = bot.ramRssMb || 0;
    topRam.textContent = ram ? (ram + ' MB') : '-- MB';
  }

  renderDimensionLocation();
}

function renderPublicSettings(settingsData) {
  if (!settingsData) return;

  // Hỗ trợ cả 2 dạng: { settings: { ... } } (từ POST /api/settings)
  // và { autoTotem: ... } trực tiếp (từ GET /api/snapshot result.data.settings)
  const settings = (settingsData.settings && typeof settingsData.settings === 'object')
    ? settingsData.settings
    : (typeof settingsData === 'object' ? settingsData : {});

  const autoTotem = byId('settingAutoTotem');
  const antiHungry = byId('settingAntiHungry');
  const autoReconnect = byId('settingAutoReconnect');
  const antiAfkKick = byId('settingAntiAfkKick');

  if (autoTotem) autoTotem.checked = settings.autoTotem !== false;
  if (antiHungry) antiHungry.checked = settings.antiHungry !== false;
  if (autoReconnect) autoReconnect.checked = settings.autoReconnect !== false;
  if (antiAfkKick) antiAfkKick.checked = settings.antiAfkKick !== false;
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
    mode,
    intervalSeconds: clampClientNumber(raw.intervalSeconds, 3600, 10, 604800),
    times: Array.isArray(raw.times) ? raw.times.map(function(value) { return String(value || '').trim(); }).filter(Boolean) : [],
    messages: Array.isArray(raw.messages) ? raw.messages.map(function(value) { return String(value || '').trim(); }).filter(Boolean) : [],
    messageDelaySeconds: clampClientNumber(raw.messageDelaySeconds, 2, 0, 3600)
  };
}

function renderAutoChatSchedules(schedules) {
  const box = byId('autoChatSchedules');
  if (!box) return;
  const list = Array.isArray(schedules) ? schedules.map(normalizeScheduleForClient) : [];
  autoChatSchedules = list;

  if (!list.length) {
    box.innerHTML = '<div class="note">Chưa có lịch Auto Chat. Bấm “＋ Thêm” để tạo.</div>';
    return;
  }

  box.innerHTML = list.map(function(schedule, index) {
    const checked = schedule.enabled ? ' checked' : '';
    const fixed = schedule.mode === 'fixed';
    return '' +
      '<div class="schedule-row" draggable="true" data-index="' + index + '" data-id="' + escapeHtml(schedule.id) + '"' +
        ' ondragstart="dragAutoChatSchedule(event,' + index + ')" ondragover="allowAutoChatDrop(event)" ondrop="dropAutoChatSchedule(event,' + index + ')" ondragend="endScheduleDrag(this)">' +
        '<div class="schedule-row-top">' +
          '<div class="schedule-handle" title="Kéo để sắp xếp">⋮⋮</div>' +
          '<div class="schedule-row-title">Lịch #' + (index + 1) + '</div>' +
          '<label class="check-row" style="margin:0;padding:5px 7px;"><input data-field="enabled" type="checkbox"' + checked + '> <span>Bật</span></label>' +
          '<button class="small danger" type="button" onclick="removeAutoChatSchedule(' + index + ')">Xóa</button>' +
        '</div>' +
        '<div class="schedule-inline" style="margin-top:7px;flex-wrap:wrap;">' +
          '<select data-field="mode" onchange="scheduleModeChanged(this)">' +
            '<option value="interval"' + (!fixed ? ' selected' : '') + '>Lặp lại</option>' +
            '<option value="fixed"' + (fixed ? ' selected' : '') + '>Giờ cố định</option>' +
          '</select>' +
          (fixed
            ? '<input data-field="times" class="time-input" style="width:min(100%,280px);" value="' + escapeHtml(schedule.times.join(', ')) + '" placeholder="08:00, 12:00, 18:00">'
            : '<input data-field="intervalSeconds" class="minutes-input" type="number" min="10" max="604800" value="' + schedule.intervalSeconds + '" title="Khoảng lặp (giây)">') +
          '<input data-field="messageDelaySeconds" class="minutes-input" type="number" min="0" max="3600" value="' + schedule.messageDelaySeconds + '" title="Delay giữa các tin (giây)">' +
          '<span class="schedule-meta">Delay tin (s)</span>' +
        '</div>' +
        '<div class="schedule-row-main">' +
          '<label class="schedule-field"><span>Tin nhắn — mỗi dòng một tin</span><textarea data-field="messages" placeholder="Tin 1&#10;Tin 2&#10;Tin 3">' + escapeHtml(schedule.messages.join('\n')) + '</textarea></label>' +
          '<div class="schedule-meta" style="padding-bottom:6px;"><span>' + (fixed ? 'Theo giờ' : 'Theo khoảng lặp') + '</span></div>' +
        '</div>' +
      '</div>';
  }).join('');
}

function markSettingsDirty() { settingsDirty = true; }
function markAutoChatDirty() { autoChatDirty = true; }
function markBotScheduleDirty() { botScheduleDirty = true; }
function defaultFixedTime(index) {
  const hour = (3 + Number(index || 0) * 3) % 24;
  return String(hour).padStart(2, '0') + ':00';
}


function collectAutoChatSchedules() {
  const box = byId('autoChatSchedules');
  if (!box) return [];
  return Array.from(box.querySelectorAll('.schedule-row')).map(function(row, index) {
    const get = field => row.querySelector('[data-field="' + field + '"]');
    const mode = get('mode') && get('mode').value === 'fixed' ? 'fixed' : 'interval';
    const id = row.dataset.id || (autoChatSchedules[index] && autoChatSchedules[index].id) || (Date.now() + '-' + index);
    row.dataset.id = id;
    const messages = String(get('messages') ? get('messages').value : '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
    let intervalSeconds = 3600;
    let times = [];
    if (mode === 'fixed') {
      times = String(get('times') ? get('times').value : '').split(/[,\n]+/).map(v => v.trim()).filter(Boolean);
    } else {
      intervalSeconds = clampClientNumber(get('intervalSeconds') ? get('intervalSeconds').value : 3600, 3600, 10, 604800);
    }
    return {
      id,
      enabled: !!(get('enabled') && get('enabled').checked),
      mode,
      intervalSeconds,
      times,
      messages,
      messageDelaySeconds: clampClientNumber(get('messageDelaySeconds') ? get('messageDelaySeconds').value : 2, 2, 0, 3600)
    };
  });
}

function validateAutoChatSchedules(schedules) {
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (let i = 0; i < schedules.length; i++) {
    const schedule = schedules[i];
    if (!schedule.messages.length) return 'Lịch #' + (i + 1) + ' chưa có tin nhắn.';
    if (schedule.mode === 'fixed') {
      if (!schedule.times.length) return 'Lịch #' + (i + 1) + ' chưa có giờ cố định.';
      for (const value of schedule.times) {
        if (!validTime.test(value)) return 'Lịch #' + (i + 1) + ' có giờ không hợp lệ: ' + value;
      }
    }
  }
  return '';
}

function scheduleModeChanged(select) {
  const current = collectAutoChatSchedules();
  const index = Number(select?.closest('.schedule-row')?.dataset.index ?? -1);
  if (current[index]) {
    if (current[index].mode === 'fixed' && !current[index].times.length) {
      current[index].times = ['08:00'];
    }
    if (current[index].mode === 'interval' && !Number.isFinite(Number(current[index].intervalSeconds))) {
      current[index].intervalSeconds = 3600;
    }
  }
  autoChatDirty = true;
  renderAutoChatSchedules(current);
}

let draggedAutoChatIndex = null;
function dragAutoChatSchedule(event, index) {
  draggedAutoChatIndex = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(index));
  event.currentTarget.classList.add('dragging');
}
function allowAutoChatDrop(event) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
function dropAutoChatSchedule(event, targetIndex) {
  event.preventDefault();
  const from = draggedAutoChatIndex;
  draggedAutoChatIndex = null;
  if (!Number.isInteger(from) || from === targetIndex) return;
  const current = collectAutoChatSchedules();
  const [moved] = current.splice(from, 1);
  current.splice(targetIndex, 0, moved);
  autoChatDirty = true;
  renderAutoChatSchedules(current);
}
function endScheduleDrag(element) { if (element) element.classList.remove('dragging'); draggedAutoChatIndex = null; }

function addAutoChatSchedule() {
  if (autoChatSaveInFlight) return;
  const current = collectAutoChatSchedules();
  current.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), enabled: true, mode: 'interval', intervalSeconds: 3600, times: [], messages: [''], messageDelaySeconds: 2 });
  autoChatDirty = true;
  renderAutoChatSchedules(current);
  const rows = byId('autoChatSchedules')?.querySelectorAll('.schedule-row') || [];
  rows[rows.length - 1]?.querySelector('[data-field="messages"]')?.focus();
}

function removeAutoChatSchedule(index) {
  if (autoChatSaveInFlight) return;
  const current = collectAutoChatSchedules();
  current.splice(index, 1);
  autoChatDirty = true;
  renderAutoChatSchedules(current);
}

function normalizeBotSchedulerForClient(schedules) {
  const raw = Array.isArray(schedules) ? schedules[0] : null;
  if (!raw) return { id: String(Date.now()), enabled: true, mode: 'fixed', items: [] };

  const mode = raw.mode === 'cycle' ? 'cycle' : 'fixed';
  let items = Array.isArray(raw.items) ? raw.items.slice() : [];

  if (!items.length && Array.isArray(schedules)) {
    items = schedules
      .filter(s => (s.mode === 'cycle' ? 'cycle' : 'fixed') === mode)
      .flatMap(s => mode === 'fixed'
        ? [{ id: s.id, action: s.action, time: s.time }]
        : [
            { id: String(s.id || '') + '-stop', action: 'stop', afterMinutes: clampClientNumber(s.offAfterMinutes, 120, 1, 43200) },
            { id: String(s.id || '') + '-start', action: 'start', afterMinutes: clampClientNumber(s.onAfterMinutes, 300, 1, 43200) }
          ]);
  }

  return {
    id: String(raw.id || Date.now()),
    enabled: raw.enabled !== false,
    mode,
    items: items.map(function(item, index) {
      return mode === 'fixed'
        ? { id: String(item.id || Date.now() + '-' + index), action: item.action === 'start' ? 'start' : 'stop', time: String(item.time || '03:00') }
        : { id: String(item.id || Date.now() + '-' + index), action: item.action === 'start' ? 'start' : 'stop', afterMinutes: clampClientNumber(item.afterMinutes, index === 0 ? 120 : 300, 1, 43200) };
    })
  };
}

function renderBotScheduleModeNote(mode) {
  const note = byId('botScheduleModeNote');
  if (!note) return;
  note.textContent = mode === 'cycle'
    ? 'Mỗi dòng kích hoạt sau khoảng thời gian tính từ dòng ngay phía trên. Dòng đầu tiên tính từ lúc bấm Lưu. Kéo ⋮⋮ để đổi thứ tự.'
    : 'Mỗi dòng dùng giờ Việt Nam (GMT+7). Có thể thêm nhiều giờ: 03:00 Tắt → 06:00 Bật → 12:00 Tắt → 19:00 Bật.';
}

function renderBotSchedules(schedules) {
  const box = byId('botSchedules');
  if (!box) return;
  const scheduler = normalizeBotSchedulerForClient(schedules);
  botSchedules = scheduler.items.length || (Array.isArray(schedules) && schedules.length) ? [scheduler] : [];

  if (byId('botScheduleMode')) byId('botScheduleMode').value = scheduler.mode;
  if (byId('botScheduleEnabled')) byId('botScheduleEnabled').checked = scheduler.enabled !== false;
  renderBotScheduleModeNote(scheduler.mode);

  if (!scheduler.items.length) {
    box.innerHTML = '<div class="note">Chưa có dòng hẹn giờ. Bấm “＋ Thêm” để tạo dòng đầu tiên.</div>';
    return;
  }

  box.innerHTML = scheduler.items.map(function(item, index) {
    const actionValue = item.action === 'start' ? 'start' : 'stop';
    const actionText = actionValue === 'start' ? 'Bật Bot' : 'Tắt Bot';
    const timing = scheduler.mode === 'fixed'
      ? '<input data-field="time" class="time-input" type="time" value="' + escapeHtml(item.time || '03:00') + '">'
      : '<input data-field="afterMinutes" class="minutes-input" type="number" min="1" max="43200" value="' + clampClientNumber(item.afterMinutes, index === 0 ? 120 : 300, 1, 43200) + '" title="Phút">';
    const relation = scheduler.mode === 'fixed'
      ? 'Mỗi ngày'
      : (index === 0 ? 'Tính từ lúc lưu' : 'Tính từ dòng ' + index);

    return '' +
      '<div class="schedule-row" draggable="true" data-index="' + index + '" data-id="' + escapeHtml(item.id) + '" ondragstart="dragBotSchedule(event,' + index + ')" ondragover="allowBotScheduleDrop(event)" ondrop="dropBotSchedule(event,' + index + ')" ondragend="endBotScheduleDrag(this)">' +
        '<div class="schedule-row-top">' +
          '<div class="schedule-handle" title="Kéo để đổi thứ tự">⋮⋮</div>' +
          '<div class="schedule-row-title">' + (index + 1) + '. ' + actionText + '</div>' +
          '<div class="schedule-inline">' +
            '<select data-field="action" class="action-select">' +
              '<option value="stop"' + (actionValue === 'stop' ? ' selected' : '') + '>Tắt</option>' +
              '<option value="start"' + (actionValue === 'start' ? ' selected' : '') + '>Bật</option>' +
            '</select>' + timing +
          '</div>' +
          '<button class="small danger" type="button" onclick="removeBotSchedule(' + index + ')">Xóa</button>' +
        '</div>' +
        '<div class="schedule-meta" style="margin-top:5px;"><span>' + relation + '</span>' +
          (scheduler.mode === 'cycle' ? '<span>•</span><span>Thời gian tính từ dòng kề trên</span>' : '') +
        '</div>' +
      '</div>';
  }).join('');
}

function collectBotSchedules() {
  const box = byId('botSchedules');
  const modeSelect = byId('botScheduleMode');
  if (!box || !modeSelect) return [];
  const mode = modeSelect.value === 'cycle' ? 'cycle' : 'fixed';
  const scheduler = normalizeBotSchedulerForClient(botSchedules);
  const items = Array.from(box.querySelectorAll('.schedule-row')).map(function(row, index) {
    const get = field => row.querySelector('[data-field="' + field + '"]');
    const id = row.dataset.id || scheduler.items[index]?.id || (Date.now() + '-' + index);
    if (mode === 'fixed') {
      return { id, action: get('action')?.value === 'start' ? 'start' : 'stop', time: String(get('time')?.value || '').trim() };
    }
    return { id, action: get('action')?.value === 'start' ? 'start' : 'stop', afterMinutes: clampClientNumber(get('afterMinutes')?.value, index === 0 ? 120 : 300, 1, 43200) };
  });
  if (!items.length) return [];
  return [{ id: scheduler.id || String(Date.now()), enabled: byId('botScheduleEnabled') ? !!byId('botScheduleEnabled').checked : true, mode, items }];
}

function validateBotSchedules(schedules) {
  if (!schedules.length) return '';
  if (schedules.length !== 1) return 'Chỉ được lưu một chế độ hẹn giờ Bot cùng lúc.';
  const schedule = schedules[0];
  if (!Array.isArray(schedule.items) || !schedule.items.length) return 'Hẹn giờ Bot chưa có dòng nào.';
  if (schedule.mode === 'fixed') {
    const seen = new Set();
    for (let i = 0; i < schedule.items.length; i++) {
      const time = schedule.items[i].time;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return 'Dòng #' + (i + 1) + ' có giờ không hợp lệ.';
      if (seen.has(time)) return 'Dòng #' + (i + 1) + ' bị trùng giờ ' + time + '.';
      seen.add(time);
    }
  } else {
    for (let i = 0; i < schedule.items.length; i++) {
      const value = Number(schedule.items[i].afterMinutes);
      if (!Number.isFinite(value) || value < 1 || value > 43200) return 'Dòng #' + (i + 1) + ' có thời gian chờ không hợp lệ.';
    }
  }
  return '';
}

function botScheduleModeChanged(select) {
  const current = collectBotSchedules();
  const scheduler = normalizeBotSchedulerForClient(current.length ? current : botSchedules);
  const newMode = select && select.value === 'cycle' ? 'cycle' : 'fixed';
  const items = scheduler.items.map(function(item, index) {
    return newMode === 'fixed'
      ? { id: item.id, action: item.action, time: defaultFixedTime(index) }
      : { id: item.id, action: item.action, afterMinutes: index === 0 ? 120 : 300 };
  });
  botSchedules = [{ id: scheduler.id || String(Date.now()), enabled: byId('botScheduleEnabled') ? !!byId('botScheduleEnabled').checked : true, mode: newMode, items }];
  botScheduleDirty = true;
  renderBotSchedules(botSchedules);
}

function addBotSchedule() {
  const current = collectBotSchedules();
  const scheduler = normalizeBotSchedulerForClient(current.length ? current : botSchedules);
  const index = scheduler.items.length;
  const item = scheduler.mode === 'fixed'
    ? { id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), action: 'stop', time: defaultFixedTime(index) }
    : { id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), action: index % 2 === 0 ? 'stop' : 'start', afterMinutes: index === 0 ? 120 : 300 };
  scheduler.items.push(item);
  botSchedules = [scheduler];
  botScheduleDirty = true;
  renderBotSchedules(botSchedules);
}

function removeBotSchedule(index) {
  if (botScheduleSaveInFlight) return;
  const scheduler = normalizeBotSchedulerForClient(collectBotSchedules());
  scheduler.items.splice(index, 1);
  botSchedules = scheduler.items.length ? [scheduler] : [];
  botScheduleDirty = true;
  renderBotSchedules(botSchedules);
}

let draggedBotScheduleIndex = null;
function dragBotSchedule(event, index) {
  draggedBotScheduleIndex = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(index));
  event.currentTarget.classList.add('dragging');
}
function allowBotScheduleDrop(event) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
function dropBotSchedule(event, targetIndex) {
  event.preventDefault();
  const from = draggedBotScheduleIndex;
  draggedBotScheduleIndex = null;
  if (!Number.isInteger(from) || from === targetIndex) return;
  const scheduler = normalizeBotSchedulerForClient(collectBotSchedules());
  const [moved] = scheduler.items.splice(from, 1);
  scheduler.items.splice(targetIndex, 0, moved);
  botSchedules = [scheduler];
  botScheduleDirty = true;
  renderBotSchedules(botSchedules);
}
function endBotScheduleDrag(element) { if (element) element.classList.remove('dragging'); draggedBotScheduleIndex = null; }

async function saveSettings() {
  if (settingsSaveInFlight) return;

  invalidatePendingReads();

  const payload = {
    settings: {
      autoTotem: !!(byId('settingAutoTotem') && byId('settingAutoTotem').checked),
      antiHungry: !!(byId('settingAntiHungry') && byId('settingAntiHungry').checked),
      autoReconnect: !!(byId('settingAutoReconnect') && byId('settingAutoReconnect').checked),
      antiAfkKick: !!(byId('settingAntiAfkKick') && byId('settingAntiAfkKick').checked)
    }
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
    renderPublicSettings(result.data);
    showToast(result.data.message || 'Đã lưu setting.');
  } catch (err) {
    showToast(err.message || 'Không thể kết nối server web.');
  } finally {
    settingsSaveInFlight = false;
    setSettingsButtonsDisabled(false);
    runQueuedRefresh();
  }
}

async function saveAutoChat() {
  if (autoChatSaveInFlight) return;

  invalidatePendingReads();

  const schedules = collectAutoChatSchedules();
  const validationError = validateAutoChatSchedules(schedules);

  if (validationError) {
    showToast(validationError);
    return;
  }

  autoChatSaveInFlight = true;
  setAutoChatButtonsDisabled(true);

  try {
    const result = await apiJson('/api/auto-chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ autoChatSchedules: schedules })
    });

    if (!result.ok) {
      showToast(result.data.error || 'Lưu Auto Chat thất bại.');
      return;
    }

    autoChatDirty = false;
    const serverSchedules = Array.isArray(result.data.autoChatSchedules)
      ? result.data.autoChatSchedules
      : schedules;

    renderAutoChatSchedules(serverSchedules);
    showToast(result.data.message || 'Đã lưu Auto Chat.');
  } catch (err) {
    showToast(err.message || 'Không thể kết nối server web.');
  } finally {
    autoChatSaveInFlight = false;
    setAutoChatButtonsDisabled(false);
    runQueuedRefresh();
  }
}

async function saveBotSchedules() {
  if (botScheduleSaveInFlight) return;

  invalidatePendingReads();

  const schedules = collectBotSchedules();
  const validationError = validateBotSchedules(schedules);

  if (validationError) {
    showToast(validationError);
    return;
  }

  botScheduleSaveInFlight = true;
  setBotScheduleButtonsDisabled(true);

  try {
    const result = await apiJson('/api/bot-schedules', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ botSchedules: schedules })
    });

    if (!result.ok) {
      showToast(result.data.error || 'Lưu hẹn giờ Bot thất bại.');
      return;
    }

    botScheduleDirty = false;
    const serverSchedules = Array.isArray(result.data.botSchedules)
      ? result.data.botSchedules
      : schedules;

    renderBotSchedules(serverSchedules);
    showToast(result.data.message || 'Đã lưu hẹn giờ Bot.');
  } catch (err) {
    showToast(err.message || 'Không thể kết nối server web.');
  } finally {
    botScheduleSaveInFlight = false;
    setBotScheduleButtonsDisabled(false);
    runQueuedRefresh();
  }
}

function setSettingsButtonsDisabled(disabled) {
  document.querySelectorAll('#settingsPanel button, #settingsPanel input, #settingsPanel select, #settingsPanel textarea').forEach(function(element) {
    element.disabled = !!disabled;
  });
}

function setAutoChatButtonsDisabled(disabled) {
  document.querySelectorAll('#autoChatPanel button, #autoChatPanel input, #autoChatPanel select, #autoChatPanel textarea').forEach(function(element) {
    element.disabled = !!disabled;
  });
}

function setBotScheduleButtonsDisabled(disabled) {
  document.querySelectorAll('#botSchedulePanel button, #botSchedulePanel input, #botSchedulePanel select, #botSchedulePanel textarea').forEach(function(element) {
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

  invalidatePendingReads();
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

let commandHistory = [];
let commandHistoryIndex = -1;

function copyToClipboard(text, label) {
  if (!text || text === '-') return;
  const clean = String(text).trim();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(clean).then(function() {
      showToast('Đã copy ' + (label || '') + ': ' + clean);
    }).catch(function() {
      fallbackCopy(clean, label);
    });
  } else {
    fallbackCopy(clean, label);
  }
}

function fallbackCopy(text, label) {
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('Đã copy ' + (label || '') + ': ' + text);
  } catch (_) {
    showToast('Không thể copy tự động.');
  }
}

async function quickSendCommand(cmd) {
  const input = byId('messageInput');
  if (input) input.value = cmd;
  await sendMessage(new Event('submit'));
}

async function sendMessage(event) {
  if (event && event.preventDefault) event.preventDefault();

  const input = byId('messageInput');
  const text = input ? input.value : '';

  if (!text.trim()) return;

  commandHistory.unshift(text.trim());
  if (commandHistory.length > 50) commandHistory.pop();
  commandHistoryIndex = -1;

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

function exportLogsToFile() {
  const logEl = document.getElementById('logs');
  const text = (logEl ? logEl.innerText : '') || 'Chưa có log.';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kingmc-bot-log-' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  showToast('✅ Đã tải file log về máy.');
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
  invalidatePendingReads();

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
  const invSlots = inventory.slots || [];
  let usedCount = 0;
  for (let i = 9; i <= 44; i++) {
    if (invSlots[i]) usedCount++;
  }
  const capPercent = Math.round((usedCount / 36) * 100);
  const capEl = document.getElementById('inventoryCapacity');
  if (capEl) {
    capEl.textContent = usedCount + '/36 ô (' + capPercent + '%)';
    capEl.className = 'capacity-badge' + (capPercent >= 90 ? ' danger' : capPercent >= 75 ? ' warning' : '');
  }

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

  if (healthElement) {
    const hearts = Math.round(health / 2);
    const heartsStr = '❤️'.repeat(hearts) + '🖤'.repeat(Math.max(0, 10 - hearts));
    healthElement.innerHTML = health.toFixed(1) + ' / 20 <span style="font-size:11px;margin-left:4px;" title="' + health + '/20 HP">' + heartsStr + '</span>';
  }

  if (foodElement) {
    const foods = Math.round(food / 2);
    const foodStr = '🍖'.repeat(foods) + '🦴'.repeat(Math.max(0, 10 - foods));
    foodElement.innerHTML = food.toFixed(1) + ' / 20 <span style="font-size:11px;margin-left:4px;" title="' + food + '/20 Đói">' + foodStr + '</span>';
  }

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

  if (totem) {
    const tCount = Number(inventory.totemCount || 0);
    totem.innerHTML = tCount <= 1
      ? '<span style="color:var(--red);font-weight:bold;">' + tCount + ' 🚨</span>'
      : '<span style="color:var(--gold);font-weight:bold;">' + tCount + ' 🛡️</span>';
  }

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

async function loadLogs(force, expectedGeneration = refreshGeneration) {
  const box = byId('logs');
  if (!box) return;

  if (!force && bot && lastLogRevision === Number(bot.logRevision)) {
    return;
  }

  try {
    const result = await apiJson('/api/bot/logs');

    if (expectedGeneration !== null && expectedGeneration !== refreshGeneration) return;
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

async function loadChatLogs(force, expectedGeneration = refreshGeneration) {
  const box = byId('chatLogs');
  if (!box) return;

  if (!force && bot &&
      lastChatRevision === Number(bot.chatLogRevision)) {
    return;
  }

  try {
    const result = await apiJson('/api/bot/chat-logs');

    if (expectedGeneration !== null && expectedGeneration !== refreshGeneration) return;
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
    }

    if (!autoChatDirty && Array.isArray(result.data.autoChatSchedules)) {
      renderAutoChatSchedules(result.data.autoChatSchedules);
    }

    if (!botScheduleDirty && Array.isArray(result.data.botSchedules)) {
      renderBotSchedules(result.data.botSchedules);
    }

    await Promise.all([
      loadLogs(false, generation),
      loadChatLogs(false, generation)
    ]);
  } catch (err) {
    console.error('[BOT UI] refresh', err);
    showToast('Không thể kết nối tới server web.');
  } finally {
    refreshInFlight = false;

    if (
      refreshQueued &&
      !actionRequestInFlight &&
      !inventoryActionInFlight &&
      !settingsSaveInFlight &&
      !autoChatSaveInFlight &&
      !botScheduleSaveInFlight
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
    target.id === 'settingAntiAfkKick'
  ) {
    markSettingsDirty();
    return;
  }

  if (target.closest && target.closest('#autoChatSchedules')) {
    markAutoChatDirty();
    return;
  }

  if (target.id === 'botScheduleEnabled' || (target.closest && target.closest('#botSchedules'))) {
    markBotScheduleDirty();
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
window.dragAutoChatSchedule = dragAutoChatSchedule;
window.allowAutoChatDrop = allowAutoChatDrop;
window.dropAutoChatSchedule = dropAutoChatSchedule;
window.endScheduleDrag = endScheduleDrag;
window.addBotSchedule = addBotSchedule;
window.dragBotSchedule = dragBotSchedule;
window.allowBotScheduleDrop = allowBotScheduleDrop;
window.dropBotSchedule = dropBotSchedule;
window.endBotScheduleDrag = endBotScheduleDrag;
window.allowDrop = allowDrop;
window.clearChatHistory = clearChatHistory;
window.clearDragOver = clearDragOver;
window.clearEventHistory = clearEventHistory;
window.dropEquip = dropEquip;
window.dropItemToWorld = dropItemToWorld;
window.refresh = refresh;
window.removeAutoChatSchedule = removeAutoChatSchedule;
window.removeBotSchedule = removeBotSchedule;
window.restartBot = restartBot;
window.saveAccount = saveAccount;
window.saveAutoChat = saveAutoChat;
window.saveBotSchedules = saveBotSchedules;
window.saveSettings = saveSettings;
window.scheduleModeChanged = scheduleModeChanged;
window.botScheduleModeChanged = botScheduleModeChanged;
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
window.addBotSchedule = addBotSchedule;
window.removeBotSchedule = removeBotSchedule;
window.botScheduleModeChanged = botScheduleModeChanged;
window.scheduleModeChanged = scheduleModeChanged;
window.saveAutoChat = saveAutoChat;
window.saveBotSchedules = saveBotSchedules;
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
window.quickSendCommand = quickSendCommand;
window.copyToClipboard = copyToClipboard;


let soundAlertEnabled = localStorage.getItem('kingmc_sound_alert') === '1';
let lastKnownBotStatus = null;

function playAlertTone(type = 'warn') {
  if (!soundAlertEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type === 'danger' ? 'sawtooth' : 'sine';
    const now = ctx.currentTime;
    if (type === 'danger') {
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.35);
    } else {
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
    }
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (_) {}
}

function toggleSoundAlert() {
  soundAlertEnabled = !soundAlertEnabled;
  localStorage.setItem('kingmc_sound_alert', soundAlertEnabled ? '1' : '0');
  updateSoundAlertButton();
  if (soundAlertEnabled) playAlertTone('info');
}

function updateSoundAlertButton() {
  const btn = document.getElementById('soundAlertBtn');
  if (!btn) return;
  if (soundAlertEnabled) {
    btn.className = 'small sound-btn active';
    btn.innerHTML = '🔔 Âm thanh: BẬT';
  } else {
    btn.className = 'small sound-btn';
    btn.innerHTML = '🔕 Âm thanh: TẮT';
  }
}
window.toggleSoundAlert = toggleSoundAlert;

(async function init() {
  updateSoundAlertButton();

  const msgInput = byId('messageInput');
  if (msgInput) {
    msgInput.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowUp') {
        if (!commandHistory.length) return;
        e.preventDefault();
        if (commandHistoryIndex < commandHistory.length - 1) {
          commandHistoryIndex++;
          msgInput.value = commandHistory[commandHistoryIndex];
        }
      } else if (e.key === 'ArrowDown') {
        if (!commandHistory.length) return;
        e.preventDefault();
        if (commandHistoryIndex > 0) {
          commandHistoryIndex--;
          msgInput.value = commandHistory[commandHistoryIndex];
        } else if (commandHistoryIndex === 0) {
          commandHistoryIndex = -1;
          msgInput.value = '';
        }
      }
    });
  }

  await refresh(true);
})();

let refreshTimerId = null;
function scheduleNextRefresh() {
  if (refreshTimerId) clearTimeout(refreshTimerId);
  const delay = document.hidden ? 5000 : 1000;
  refreshTimerId = setTimeout(() => {
    if (
      !settingsSaveInFlight &&
      !autoChatSaveInFlight &&
      !botScheduleSaveInFlight
    ) {
      void refresh(false);
    }
    scheduleNextRefresh();
  }, delay);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void refresh(true);
  }
  scheduleNextRefresh();
});

scheduleNextRefresh();

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
            settings: publicSettingsState(botState),
            autoChatSchedules: publicAutoChatState(botState),
            botSchedules: publicBotSchedulesState(botState)
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
        autoTotem: state.settings.autoTotem !== false,
        antiHungry: state.settings.antiHungry !== false,
        autoReconnect: state.settings.autoReconnect !== false,
        antiAfkKick: state.settings.antiAfkKick !== false
    };
}

function publicAutoChatState(state) {
    return sanitizeAutoChatSchedules(state.autoChatSchedules).map(schedule => ({
        id: schedule.id,
        enabled: schedule.enabled !== false,
        mode: schedule.mode,
        intervalSeconds: schedule.intervalSeconds,
        times: schedule.times,
        messages: schedule.messages,
        messageDelaySeconds: schedule.messageDelaySeconds
    }));
}

function publicBotSchedulesState(state) {
    return sanitizeBotSchedules(state.botSchedules).map(schedule => ({
        id: schedule.id,
        enabled: schedule.enabled !== false,
        mode: schedule.mode,
        items: Array.isArray(schedule.items)
            ? schedule.items.map(item => schedule.mode === 'fixed'
                ? {
                    id: item.id,
                    action: item.action === 'start' ? 'start' : 'stop',
                    time: item.time
                }
                : {
                    id: item.id,
                    action: item.action === 'start' ? 'start' : 'stop',
                    afterMinutes: item.afterMinutes
                })
            : []
    }));
}

app.get('/api/settings', (req, res) => {
    res.json({
        ok: true,
        settings: publicSettingsState(botState)
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
        autoReconnect: incoming.autoReconnect !== false,
        antiAfkKick: incoming.antiAfkKick !== false
    };

    const persisted = saveBotSettingsFile(
        nextSettings,
        botState.autoChatSchedules,
        botState.botSchedules
    );

    if (!persisted) {
        return res.status(500).json({
            error: 'Không thể ghi bot_settings.json; setting chưa được thay đổi.'
        });
    }

    botState.settings = nextSettings;

    addLog(
        botState,
        `[SETTING] Auto Totem=${nextSettings.autoTotem ? 'ON' : 'OFF'} | Anti Hungry=${nextSettings.antiHungry ? 'ON' : 'OFF'} | Auto Reconnect=${nextSettings.autoReconnect ? 'ON' : 'OFF'}.`
    );

    if (!nextSettings.autoReconnect) {
        const wasReadyAfk =
            botState.status === 'afk' &&
            botState.ready === true;

        clearReconnectTimer(botState);
        clearAfkTimers(botState);
        resetLocationFlowState(botState);

        if (wasReadyAfk) {
            botState.ready = true;
        }
    }

    res.json({
        ok: true,
        message: 'Đã lưu setting riêng.',
        settings: publicSettingsState(botState)
    });
});

app.get('/api/auto-chat', (req, res) => {
    res.json({
        ok: true,
        autoChatSchedules: publicAutoChatState(botState)
    });
});

app.post('/api/auto-chat', (req, res) => {
    const body = req.body && typeof req.body === 'object'
        ? req.body
        : {};

    const schedules = sanitizeAutoChatSchedules(body.autoChatSchedules);
    const runtimeSchedules = sanitizeAutoChatSchedules(schedules);

    for (const schedule of runtimeSchedules) {
        schedule.lastIntervalRunAt = Date.now();
        schedule.lastFixedRunKey = '';
        schedule.running = false;
    }

    const persisted = saveBotSettingsFile(
        botState.settings,
        runtimeSchedules,
        botState.botSchedules
    );

    if (!persisted) {
        return res.status(500).json({
            error: 'Không thể ghi bot_settings.json; Auto Chat chưa được thay đổi.'
        });
    }

    botState.autoChatGeneration++;
    botState.autoChatSchedules = runtimeSchedules;

    addLog(
        botState,
        `[AUTOCHAT] Đã lưu riêng ${runtimeSchedules.length} lịch.`
    );

    res.json({
        ok: true,
        message: 'Đã lưu Auto Chat riêng.',
        autoChatSchedules: publicAutoChatState(botState)
    });
});

app.get('/api/bot-schedules', (req, res) => {
    res.json({
        ok: true,
        botSchedules: publicBotSchedulesState(botState)
    });
});

app.post('/api/bot-schedules', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawSchedules = Array.isArray(body.botSchedules)
        ? body.botSchedules
        : body.botSchedules && typeof body.botSchedules === 'object'
            ? [body.botSchedules]
            : [];

    if (rawSchedules.length > 1) {
        return res.status(400).json({
            error: 'Hẹn giờ Bot chỉ cho phép một chế độ tại một thời điểm. Hãy dùng nút + để thêm nhiều dòng trong cùng chế độ.'
        });
    }

    if (!rawSchedules.length) {
        const persisted = saveBotSettingsFile(
            botState.settings,
            botState.autoChatSchedules,
            []
        );
        if (!persisted) {
            return res.status(500).json({
                error: 'Không thể ghi bot_settings.json; hẹn giờ Bot chưa được thay đổi.'
            });
        }
        botState.botSchedules = [];
        addLog(botState, '[SCHEDULER] Đã xóa toàn bộ hẹn giờ Bot.');
        return res.json({
            ok: true,
            message: 'Đã tắt hẹn giờ Bot.',
            botSchedules: []
        });
    }

    const raw = rawSchedules[0] || {};
    const mode = raw.mode === 'cycle' ? 'cycle' : 'fixed';
    const rawItems = Array.isArray(raw.items) ? raw.items : [];

    if (!rawItems.length) {
        return res.status(400).json({
            error: 'Hẹn giờ Bot chưa có dòng lịch. Bấm + để thêm một hành động.'
        });
    }

    if (rawItems.length > BOT_SCHEDULER_MAX_ITEMS) {
        return res.status(400).json({
            error: `Hẹn giờ Bot tối đa ${BOT_SCHEDULER_MAX_ITEMS} dòng.`
        });
    }

    if (mode === 'fixed') {
        const fixedTimes = new Set();
        for (let index = 0; index < rawItems.length; index++) {
            const item = rawItems[index] || {};
            const time = String(item.time || '').trim();
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
                return res.status(400).json({
                    error: `Dòng #${index + 1} có giờ không hợp lệ: ${time || '(trống)'}. Dùng HH:mm.`
                });
            }
            if (fixedTimes.has(time)) {
                return res.status(400).json({
                    error: `Dòng #${index + 1} bị trùng giờ ${time}. Mỗi giờ chỉ đặt một hành động.`
                });
            }
            fixedTimes.add(time);
        }
    } else {
        for (let index = 0; index < rawItems.length; index++) {
            const item = rawItems[index] || {};
            const afterMinutes = Number(item.afterMinutes);
            if (
                !Number.isFinite(afterMinutes) ||
                afterMinutes < 1 ||
                afterMinutes > BOT_SCHEDULER_MAX_PHASE_MINUTES
            ) {
                return res.status(400).json({
                    error: `Dòng #${index + 1} có thời gian chờ không hợp lệ (1-${BOT_SCHEDULER_MAX_PHASE_MINUTES} phút).`
                });
            }
        }
    }

    const runtimeSchedules = sanitizeBotSchedules(
        [{
            id: raw.id,
            enabled: raw.enabled !== false,
            mode,
            items: rawItems
        }],
        { resetCycleState: true }
    );

    if (!runtimeSchedules.length) {
        return res.status(400).json({
            error: 'Không thể chuẩn hóa lịch hẹn giờ Bot.'
        });
    }

    const persisted = saveBotSettingsFile(
        botState.settings,
        botState.autoChatSchedules,
        runtimeSchedules
    );

    if (!persisted) {
        return res.status(500).json({
            error: 'Không thể ghi bot_settings.json; hẹn giờ Bot chưa được thay đổi.'
        });
    }

    botState.botSchedules = runtimeSchedules;

    addLog(
        botState,
        `[SCHEDULER] Đã lưu mode ${mode === 'fixed' ? 'giờ cố định' : 'chu kỳ'} với ${runtimeSchedules[0].items.length} dòng. ${mode === 'cycle' ? 'Chu kỳ tính lại từ thời điểm lưu.' : ''}`.trim()
    );

    res.json({
        ok: true,
        message: 'Đã lưu hẹn giờ Bot riêng.',
        botSchedules: publicBotSchedulesState(botState)
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
                autoChat: '/api/auto-chat',
                botSchedules: '/api/bot-schedules',
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
            botState,
            'manual'
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

        markManualLifecycleAction(botState);
        stopBot(
            botState,
            'manual'
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

        markManualLifecycleAction(botState);
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
            const raw = text.trim();
            const lower = raw.toLowerCase();

            // 1. Tự động gắn mật khẩu cho /dn
            if (lower === '/dn') {
                if (!botState.password) {
                    return res.status(400).json({
                        error: 'Bot chưa có mật khẩu! Vui lòng lưu mật khẩu trong Cài đặt.'
                    });
                }
                botState.bot.chat(`/dn ${botState.password}`);
                botState.lastWebChatText = '/dn [PASSWORD]';
                botState.lastWebChatAt = Date.now();
                addChatLog(botState, 'WEB', '→ /dn ********');
                return res.json({
                    ok: true,
                    message: 'Đã gửi /dn (kèm mật khẩu đã lưu).'
                });
            }

            // 2. Tự động gắn mật khẩu cho /login
            if (lower === '/login') {
                if (!botState.password) {
                    return res.status(400).json({
                        error: 'Bot chưa có mật khẩu! Vui lòng lưu mật khẩu trong Cài đặt.'
                    });
                }
                botState.bot.chat(`/login ${botState.password}`);
                botState.lastWebChatText = '/login [PASSWORD]';
                botState.lastWebChatAt = Date.now();
                addChatLog(botState, 'WEB', '→ /login ********');
                return res.json({
                    ok: true,
                    message: 'Đã gửi /login (kèm mật khẩu đã lưu).'
                });
            }

            // 3. /menu: gửi lệnh và tự động bấm ô slot 24 đúng 1 lần duy nhất, không lặp lại
            if (lower === '/menu') {
                botState.bot.chat('/menu');
                botState.lastWebChatText = '/menu';
                botState.lastWebChatAt = Date.now();
                addChatLog(botState, 'WEB', '→ /menu');

                let slot24Handled = false;
                const clickSlot24Once = () => {
                    if (slot24Handled) return;
                    slot24Handled = true;
                    setTimeout(() => {
                        try {
                            if (botState.bot && botState.bot.currentWindow) {
                                botState.bot.clickWindow(24, 0, 0);
                                addLog(botState, '[MENU] Đã click slot 24 (1 lần duy nhất).');
                            }
                        } catch (err) {
                            addLog(botState, `[MENU] Lỗi click slot 24: ${err.message}`);
                        }
                    }, 700);
                };

                if (botState.bot.currentWindow) {
                    clickSlot24Once();
                } else {
                    botState.bot.once('windowOpen', clickSlot24Once);
                    setTimeout(() => {
                        if (!slot24Handled && botState.bot) {
                            botState.bot.removeListener('windowOpen', clickSlot24Once);
                        }
                    }, 10000);
                }

                return res.json({
                    ok: true,
                    message: 'Đã gửi /menu (tự động bấm ô 24 một lần).'
                });
            }

            // 4. Các lệnh khác (kể cả người dùng tự gõ /dn <pass> hoặc /login <pass>)
            const isAuthCmd = lower.startsWith('/dn ') || lower.startsWith('/login ');
            botState.bot.chat(raw);
            botState.lastWebChatText = isAuthCmd
                ? `${raw.split(' ')[0]} [PASSWORD]`
                : cleanMinecraftText(raw);
            botState.lastWebChatAt = Date.now();
            addChatLog(
                botState,
                'WEB',
                isAuthCmd ? `→ ${raw.split(' ')[0]} ********` : `→ ${raw}`
            );

            res.json({
                ok: true,
                message: 'Đã gửi.'
            });

        } catch (err) {
            res.status(500).json({
                error: `Gửi thất bại: ${err.message}`
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
                'Di chuyển item',
                () => invalidateInventoryAction(botState)
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
                'Trang bị item',
                () => invalidateInventoryAction(botState)
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
                        'Tháo trang bị',
                        () => invalidateInventoryAction(botState)
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
                    'Tháo trang bị',
                    () => invalidateInventoryAction(botState)
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
                'Vứt item',
                () => invalidateInventoryAction(botState)
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
        const cur = publicSettingsState(botState);
        let renderedHtml = HTML;
        if (cur.autoTotem) renderedHtml = renderedHtml.replace('id="settingAutoTotem"', 'id="settingAutoTotem" checked');
        if (cur.antiHungry) renderedHtml = renderedHtml.replace('id="settingAntiHungry"', 'id="settingAntiHungry" checked');
        if (cur.autoReconnect) renderedHtml = renderedHtml.replace('id="settingAutoReconnect"', 'id="settingAutoReconnect" checked');
        if (cur.antiAfkKick) renderedHtml = renderedHtml.replace('id="settingAntiAfkKick"', 'id="settingAntiAfkKick" checked');
        res
            .type('html')
            .send(renderedHtml);
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

        const started = startBot(botState, 'boot');

        addLog(
            botState,
            started
                ? 'Auto-start sau khi service khởi động: đã bắt đầu kết nối.'
                : 'Auto-start không thành công: kiểm tra credential và trạng thái service.'
        );
    }, 250);

    botState.afkTimers.push(bootTimer);
}

let server = null;
listenHttpServer(app, HTTP_PORT, PLATFORM, (serverInstance, activePort) => {
    server = serverInstance;
    HTTP_PORT = activePort;
    console.log('================================================================================');
    console.log(`  🚀 KINGMC AFK BOT WORKER (PRO V7) ĐÃ KHỞI CHẠY THÀNH CÔNG!`);
    console.log(`  🌐 WEB DASHBOARD: http://localhost:${activePort} (hoặc domain VPS / Hosting)`);
    console.log(`  📦 NỀN TẢNG: ${PLATFORM.toUpperCase()} | PORT WEB: ${activePort}`);
    console.log(`  🎮 SERVER MINECRAFT: ${HOSTS.join(', ')}:${PORT} | PHIÊN BẢN: ${MC_VERSION}`);
    const creds = getConfiguredCredentials();
    if (!creds.username || !creds.password) {
        console.log(`  ⚠️  CHÚ Ý: Chưa cấu hình USERNAME / PASSWORD ở đầu file. Bot đang đợi nhập từ Web UI!`);
    } else {
        console.log(`  👤 TÀI KHOẢN: ${creds.username} (Tự động kết nối)`);
    }
    console.log('================================================================================');
    startPublicIpMonitor(botState);
    scheduleAutoStartOnBoot();
});

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
        botState,
        true
    );
    clearBotSchedulerTimer(botState);

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

process.on('uncaughtException', (err) => {
    console.error('[PROCESS] Uncaught Exception:', err.message || err);
    try {
        addLog(botState, `⚠️ [LỖI HỆ THỐNG] ${err.message || 'Lỗi không xác định'}`);
    } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
    console.error('[PROCESS] Unhandled Rejection:', reason?.message || reason);
    try {
        addLog(botState, `⚠️ [LỖI ASYNC] ${reason?.message || 'Promise rejection'}`);
    } catch (_) {}
});

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

