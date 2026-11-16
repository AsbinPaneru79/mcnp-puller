require('dotenv').config();
const http = require('http');
const mineflayer = require('mineflayer');

// Configuration with sensible defaults and environment overrides
const CONFIG = {
  host: process.env.MC_HOST || process.env.SERVER_IP || 'mcnp.network',
  port: parseInt(process.env.MC_PORT || process.env.SERVER_PORT, 10) || 25565,
  username: process.env.MC_USERNAME || '_QuickPuller',
  loginPassword: process.env.MC_PASSWORD || 'tynorix',
  version: process.env.MC_VERSION || false, // false enables auto protocol version detection
  
  // Hotbar navigation (0-indexed: slot 1 is 2nd slot in the hotbar)
  hotbarSlot: parseInt(process.env.HOTBAR_SLOT, 10) || 1,
  
  // Pickaxe preference for GUI navigation
  preferredPickaxe: (process.env.PICKAXE_TYPE || 'diamond').toLowerCase(),
  overrideSlot: process.env.TARGET_SLOT !== undefined ? parseInt(process.env.TARGET_SLOT, 10) : null,
  
  // Optional slot to hold in Survival (e.g. fishing rod or weapon), defaults to null (keep current)
  pullSlot: process.env.PULL_SLOT !== undefined ? parseInt(process.env.PULL_SLOT, 10) : null,
  
  // Speed of quick clicks (ms)
  clickDelayMs: parseInt(process.env.CLICK_DELAY_MS, 10) || 150,
  
  // Auto-reconnect delay
  reconnectDelayMs: parseInt(process.env.RECONNECT_DELAY_MS, 10) || 10000,
  
  // HTTP Health check port (defaults to 8080 for Fly.io, or 3000 for Railway/local)
  webPort: parseInt(process.env.PORT, 10) || 8080
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let bot = null;
let isReconnecting = false;
let isPulling = false;
let pullCount = 0;
let lastPullTimestamp = 0;
let botState = 'STARTING';
let inSurvival = false;

// 1. Lightweight Web Server for Fly.io / Railway Healthchecks & Monitoring
function handleHealthRequest(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const statusInfo = {
    app: 'MCNP-Puller',
    status: bot && bot.entity ? 'ONLINE' : 'CONNECTING/OFFLINE',
    botState: botState,
    inSurvival: inSurvival,
    botUsername: CONFIG.username,
    targetServer: `${CONFIG.host}:${CONFIG.port}`,
    pullsExecuted: pullCount,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  };
  res.end(JSON.stringify(statusInfo, null, 2));
}

const server = http.createServer(handleHealthRequest);
server.listen(CONFIG.webPort, '0.0.0.0', () => {
  console.log(`[Web Server] HTTP health-check listening on 0.0.0.0:${CONFIG.webPort}`);
});

// Dual-port listening: If primary port is 8080, also listen on 3000 (or vice versa)
const secondaryPort = CONFIG.webPort === 8080 ? 3000 : 8080;
try {
  const secondaryServer = http.createServer(handleHealthRequest);
  secondaryServer.listen(secondaryPort, '0.0.0.0', () => {
    console.log(`[Web Server] Secondary listener active on 0.0.0.0:${secondaryPort}`);
  });
  secondaryServer.on('error', () => {});
} catch (e) {}

// 2. Action: 1x Left-Click, 2x Right-Click Quickly
async function executePullCombo(sender) {
  const now = Date.now();
  // Prevent duplicate trigger within 800ms
  if (now - lastPullTimestamp < 800) {
    console.log(`[Pull Action] Debounced rapid trigger from ${sender} (${now - lastPullTimestamp}ms since last)`);
    return;
  }
  lastPullTimestamp = now;

  if (isPulling) {
    console.log('[Pull Action] Action already in progress, skipping.');
    return;
  }

  isPulling = true;
  pullCount++;
  console.log(`\n========================================`);
  console.log(`[Pull Action #${pullCount}] Triggered by "${sender}"!`);
  console.log(`[Combo] Executing: 1x Left-Click -> 2x Right-Click quickly...`);
  console.log(`========================================`);

  try {
    // If a specific pull slot is configured, switch to it
    if (CONFIG.pullSlot !== null) {
      bot.setQuickBarSlot(CONFIG.pullSlot);
      await delay(50);
    }

    // --- STEP 1: Left Click Once ---
    console.log('[Combo 1/3] Left Click (Arm Swing / Attack)...');
    bot.swingArm('right');
    if (bot.entityAtCursor) {
      const targetEntity = bot.entityAtCursor(3.5);
      if (targetEntity) {
        console.log(`[Combo 1/3] Hit entity in crosshair: ${targetEntity.username || targetEntity.name || targetEntity.type}`);
        bot.attack(targetEntity);
      }
    }

    await delay(CONFIG.clickDelayMs);

    // --- STEP 2: Right Click #1 ---
    console.log('[Combo 2/3] Right Click #1 (Activate Item)...');
    bot.activateItem(false);

    await delay(CONFIG.clickDelayMs);

    // --- STEP 3: Right Click #2 ---
    console.log('[Combo 3/3] Right Click #2 (Activate Item)...');
    bot.deactivateItem();
    bot.activateItem(false);

    console.log(`[Pull Action #${pullCount}] Combo executed successfully!\n`);
  } catch (err) {
    console.error('[Pull Action] Error executing combo:', err.message);
  } finally {
    // Release lock after short safety buffer
    setTimeout(() => {
      isPulling = false;
    }, 400);
  }
}

// 3. Helper to detect if a chat string matches ONLY "Pull" (case-insensitive)
function isExactPullMessage(msg) {
  if (!msg || typeof msg !== 'string') return false;
  const clean = msg.trim();
  
  // Exact match for "Pull" or "pull" or "PULL"
  if (/^"?pull"?$/i.test(clean)) return true;

  // Handles standard server formats like:
  // "Player: Pull", "[Rank] Player: Pull", "Player » Pull", "<Player> Pull"
  const delimiterMatch = clean.match(/(?:[:»>]|\bchat\b)\s*"?pull"?$/i);
  if (delimiterMatch) {
    // Ensure the message does not come from automated system announcements
    const isSystemAnnouncement = /^(?:\[server\]|\[broadcast\]|\[announcement\]|\[alert\]|\[tip\])/i.test(clean);
    if (!isSystemAnnouncement) {
      return true;
    }
  }

  return false;
}

// 4. Main Bot Connection Logic
function createBot() {
  if (bot) {
    bot.removeAllListeners();
    bot = null;
  }

  botState = 'CONNECTING';
  inSurvival = false;
  let hasLoggedIn = false;
  let isNavigating = false;

  console.log(`[Bot] Connecting to ${CONFIG.host}:${CONFIG.port} as "${CONFIG.username}"...`);

  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version || undefined,
    auth: 'offline',
    checkTimeoutInterval: 60000
  });

  // Handle incoming messages and AuthMe /login prompts
  bot.on('message', async (jsonMsg) => {
    const rawText = jsonMsg.toString().trim();
    if (rawText) {
      console.log(`[Chat] ${rawText}`);
    }

    // 1. Auth prompt detection
    if (rawText.toLowerCase().includes('/login') && !hasLoggedIn) {
      hasLoggedIn = true;
      botState = 'LOGGING_IN';
      console.log(`[Auth] Detected login prompt. Sending /login in 1s...`);
      await delay(1000);
      bot.chat(`/login ${CONFIG.loginPassword}`);
    }

    // 2. Chat trigger check on raw message (catches custom Spigot/Paper formatted chat)
    if (isExactPullMessage(rawText)) {
      // Don't trigger from bot's own messages
      if (!rawText.toLowerCase().includes(CONFIG.username.toLowerCase())) {
        executePullCombo('Chat-Parser');
      }
    }
  });

  // Standard Mineflayer chat event (catches vanilla formatted chat)
  bot.on('chat', (sender, message) => {
    if (sender === CONFIG.username) return;
    if (isExactPullMessage(message)) {
      executePullCombo(sender);
    }
  });

  // Spawn Event (fires when connecting to Lobby, and again when entering Survival)
  bot.on('spawn', async () => {
    console.log('[Bot] Spawn event triggered.');

    if (inSurvival) {
      botState = 'IN_SURVIVAL';
      console.log('[Bot] Already in Survival server! Ready and listening for "Pull"...');
      return;
    }

    if (isNavigating) return;
    isNavigating = true;
    botState = 'IN_LOBBY';

    try {
      // Fallback: If server didn't prompt via chat, send /login after short wait
      if (!hasLoggedIn) {
        hasLoggedIn = true;
        await delay(1500);
        console.log(`[Auth] Fallback: Sending /login command...`);
        bot.chat(`/login ${CONFIG.loginPassword}`);
      }

      // Wait for lobby items to sync
      await delay(2500);
      console.log(`[Lobby] Selecting 2nd hotbar slot (index ${CONFIG.hotbarSlot})...`);
      bot.setQuickBarSlot(CONFIG.hotbarSlot);

      await delay(1000);
      console.log('[Lobby] Right-clicking held item to open Game Modes GUI...');
      bot.activateItem();
    } catch (err) {
      console.error('[Lobby] Navigation error:', err.message);
      isNavigating = false;
    }
  });

  // Handle GUI Window (Matches the "GAMEMODES" 27-slot GUI)
  bot.on('windowOpen', async (window) => {
    console.log(`[GUI] Opened window: "${window.title}" (Total slots: ${window.slots.length})`);
    botState = 'GUI_OPEN';

    // Allow window items to arrive from server
    await delay(1200);

    let targetSlot = null;

    if (CONFIG.overrideSlot !== null) {
      targetSlot = CONFIG.overrideSlot;
      console.log(`[GUI] Using manually configured slot: ${targetSlot}`);
    } else {
      // 1. Look for Diamond Pickaxe (Survival in GAMEMODES GUI)
      const preferredPick = window.slots.find(
        (s) => s && s.name && s.name.toLowerCase().includes(`${CONFIG.preferredPickaxe}_pickaxe`)
      );

      if (preferredPick) {
        targetSlot = preferredPick.slot;
        console.log(`[GUI] Found ${CONFIG.preferredPickaxe} pickaxe at slot ${targetSlot} ("${preferredPick.displayName || preferredPick.name}")`);
      } else {
        // 2. Fallback: Search for any pickaxe
        const anyPick = window.slots.find(
          (s) => s && s.name && s.name.toLowerCase().includes('pickaxe')
        );
        if (anyPick) {
          targetSlot = anyPick.slot;
          console.log(`[GUI] Fallback: Found pickaxe at slot ${targetSlot} ("${anyPick.displayName || anyPick.name}")`);
        } else if (window.slots[10]) {
          // 3. Fallback: Slot 10 (Row 2, column 2 in 9x3 chest GUI)
          targetSlot = 10;
          console.log('[GUI] Fallback: Using slot 10 from GUI layout');
        }
      }
    }

    if (targetSlot !== null) {
      console.log(`[GUI] Clicking pickaxe in slot ${targetSlot} to join Survival...`);
      try {
        inSurvival = true;
        isNavigating = false;
        await bot.clickWindow(targetSlot, 0, 0);
        console.log('[GUI] Click successful! Transferring to Survival server...');

        setTimeout(() => {
          botState = 'IN_SURVIVAL';
          console.log('[Bot] Successfully arrived in Survival!');
          console.log('[Bot] Listening 24/7 for the chat message: "Pull"');
        }, 5000);
      } catch (err) {
        console.error('[GUI] Failed to click window slot:', err.message);
      }
    } else {
      console.warn('[GUI] Could not locate pickaxe slot in the opened menu.');
    }
  });

  // Disconnection and Error Handling with infinite auto-reconnect
  bot.on('kicked', (reason) => {
    botState = 'KICKED';
    console.warn(`[Bot] Kicked from server. Reason: ${reason}`);
    triggerReconnect();
  });

  bot.on('error', (err) => {
    botState = 'ERROR';
    console.error(`[Bot] Connection error: ${err.message}`);
    triggerReconnect();
  });

  bot.on('end', () => {
    botState = 'DISCONNECTED';
    console.warn('[Bot] Disconnected from server.');
    triggerReconnect();
  });
}

function triggerReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  inSurvival = false;

  console.log(`[Bot] Reconnecting in ${CONFIG.reconnectDelayMs / 1000} seconds...`);
  setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, CONFIG.reconnectDelayMs);
}

// Start bot
createBot();
