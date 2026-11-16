# MCNP-Puller Bot ⛏️🎣

An automated Minecraft bot built with [Mineflayer](https://github.com/PrismarineJS/mineflayer) designed for **mcnp.network**.

It connects as **`_QuickPuller`**, automatically authenticates with `/login tynorix`, switches to the second hotbar slot to open the `GAMEMODES` GUI, clicks the pickaxe to join **Survival**, and continuously listens in chat for the command **`"Pull"`** to trigger a rapid **1x Left-Click and 2x Right-Click** sequence.

---

## 🚀 Features

- **Automated Authentication**: Detects server login prompts and sends `/login tynorix` (with fallback timer).
- **Lobby GUI Navigation**:
  - Automatically selects the **2nd hotbar slot** (index 1).
  - Performs a right-click to open the `GAMEMODES` selector menu.
  - Automatically locates and clicks the **Diamond Pickaxe** (Survival) to transfer servers.
- **Chat Trigger ("Pull")**:
  - Listens continuously for any player typing strictly `"Pull"` (case-insensitive, e.g., `Pull`, `pull`, `PULL`).
  - Supports standard vanilla chat and custom Spigot/Paper chat prefixes (`[Rank] Player: Pull`, `Player » Pull`, `<Player> Pull`).
  - Debounced execution to prevent packet drops and spam kicks.
- **Fast Action Combo**:
  - **1x Left-Click** (`swingArm` and `attack` if an entity is in the crosshair).
  - **2x Right-Click** (`activateItem`) in quick succession.
- **24/7 Auto-Reconnect**: Automatically reconnects after kicks, server restarts, or network hiccups.
- **Railway & Cloud Ready**:
  - Built-in HTTP health-check server (`0.0.0.0:PORT`) returning JSON status.
  - Pre-configured `railway.json` and `Procfile`.

---

## 📋 Architecture & Sequence

```
[Start] ──> Connect to mcnp.network as _QuickPuller
                │
                ▼
        Send /login tynorix
                │
                ▼
    Select Hotbar Slot 2 (Index 1)
                │
                ▼
      Right-Click to open GUI
                │
                ▼
      Click Diamond Pickaxe ──> Join Survival Mode
                                        │
                                        ▼
                           Listen for chat: "Pull"
                                        │
                                        ▼
                         [1x Left-Click] -> [2x Right-Click]
```

---

## 🛠️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `MC_HOST` | `mcnp.network` | Server hostname or IP |
| `MC_PORT` | `25565` | Server port |
| `MC_USERNAME` | `_QuickPuller` | In-game bot username |
| `MC_PASSWORD` | `tynorix` | Password for `/login` |
| `MC_VERSION` | `false` | Minecraft protocol version (`false` for auto-detect) |
| `HOTBAR_SLOT` | `1` | Hotbar index for navigator item (0-8, 1 is 2nd slot) |
| `PICKAXE_TYPE` | `diamond` | Target pickaxe item name in GUI (`diamond` or `netherite`) |
| `CLICK_DELAY_MS` | `150` | Interval in ms between quick clicks |
| `RECONNECT_DELAY_MS` | `10000` | Reconnect timeout in ms |
| `PORT` | `3000` | HTTP port for Railway / health monitor |

---

## 💻 Local Setup & Running

1. **Clone repository**:
   ```bash
   git clone https://github.com/AsbinPaneru79/mcnp-puller.git
   cd mcnp-puller
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the bot**:
   ```bash
   npm start
   ```

---

## ☁️ Deploying to Railway (24/7 Hosting)

1. Go to [Railway Dashboard](https://railway.app/).
2. Click **+ New Project** -> **Deploy from GitHub repo**.
3. Select **`mcnp-puller`**.
4. In **Variables**, add any custom environment variables if needed (the defaults in code already match MCNP and `_QuickPuller`):
   - `MC_HOST`: `mcnp.network`
   - `MC_USERNAME`: `_QuickPuller`
   - `MC_PASSWORD`: `tynorix`
5. Railway will automatically build via `NIXPACKS` and run `node index.js`.
6. Use Railway's generated public domain to ping the `/` endpoint (via UptimeRobot) if you want 100% uptime monitoring.
