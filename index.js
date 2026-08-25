const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const HTTP_PORT = Number(process.env.PORT || 10000);

const MAX_LOGS = 100;
const RECONNECT_DELAY = 10000;
const STATUS_POLL_MS = 1000;
const UPTIME_UPDATE_MS = 250;

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
        id: 1,

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

        reconnectTimer: null,
        afkTimers: [],
        lastAuthTime: 0,

        logs: [],
        logRevision: 0
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

function clearAllTimers(state) {
    clearAfkTimers(state);
    clearReconnectTimer(state);
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

function publicBotState(state) {
    return {
        id: state.id,
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
            state.logRevision
    };
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

    state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;

        if (!state.manuallyStopped) {
            connectBot(state);
        }
    }, RECONNECT_DELAY);

    addLog(
        state,
        `Sẽ reconnect sau ${RECONNECT_DELAY / 1000}s.`
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

        addLog(
            state,
            `Bị kick: ${cleanMinecraftText(reasonText)}`
        );
    });

    bot.on('end', () => {
        if (state.bot === bot) {
            state.bot = null;
        }

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

    if (shouldShowMcLog) {
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
                    }, 2500);

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
                }, 4000);

            state.afkTimers.push(
                clickTimer
            );
        }, 6000);

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
  background:#18222d
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
        BOT 1
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

      <h3>Chat / Command</h3>

      <form
        class="chat-row"
        onsubmit="sendMessage(event)"
      >

        <input
          id="messageInput"
          autocomplete="off"
          placeholder="Nhập gì gửi y nguyên lên Minecraft..."
        >

        <button
          class="primary"
          type="submit"
        >
          Gửi
        </button>

      </form>

      <div class="note">
        Không phân biệt chat hay command.
        Nhập gì sẽ gửi nguyên văn bằng Mineflayer.
      </div>

    </div>

    <div class="panel">

      <h3>Log</h3>

      <div
        id="logs"
        class="log"
      ></div>

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

let lastLogRevision = -1;

let logRequestInFlight = false;

let uptimeSyncAt = Date.now();

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
      bot.uptime || '0h 0m 0s';

  document
    .getElementById(
      'detailReconnects'
    )
    .textContent =
      String(
        bot.reconnectCount ?? 0
      );

  // Intentionally do not pre-fill usernameInput.
  // This prevents refresh() from rolling back what the user is typing.

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

async function loadLogs(force = false) {

  if (logRequestInFlight) {
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

  try {

    await getBot();

    renderDetail();

    await loadLogs();

  } catch (_) {

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

    await loadLogs(true);

  } catch (_) {

    showToast(
      'Không thể kết nối tới server web.'
    );

  }
}

async function saveAccount() {

  const username =
    document
      .getElementById('usernameInput')
      .value
      .trim();

  const password =
    document
      .getElementById('passwordInput')
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
          method: 'POST',

          headers: {
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
  ${STATUS_POLL_MS}
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

  const hoursText =
    hours + 'h ';

  const minutesText =
    minutes + 'm ';

  const secondsText =
    seconds + 's';

  const element =
    document.getElementById(
      'detailUptime'
    );

  if (element) {
    element.textContent =
      hoursText +
      minutesText +
      secondsText;
  }
}

setInterval(
  updateUptimeDisplay,
  ${UPTIME_UPDATE_MS}
);

</script>

</body>
</html>`;

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
                    'Bot 1 đang chạy.'
            });
        }

        startBot(
            botState
        );

        res.json({
            ok: true,
            message:
                'Đã chạy Bot 1.'
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
                'Đã dừng Bot 1.'
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

        setTimeout(() => {

            botState.manuallyStopped =
                false;

            startBot(
                botState
            );

        }, 500);

        res.json({
            ok: true,
            message:
                'Đã chạy lại Bot 1 từ đầu.'
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
                    'Bot 1 chưa online.'
            });

        }

        try {

            botState.bot.chat(
                text
            );

            addLog(
                botState,
                `[WEB] → ${text}`
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
            connectedAt: botState.connectedAt
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
//
// Lưu ý:
// Phần này chỉ là marker kết thúc file.
// Không cần thêm code khác sau đây.
// ============================================================================
