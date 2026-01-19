/**
 * DTrader-5.2 WebSocket Test Client
 * Красивый вывод с временем, ping_id, latency, status
 */

require("dotenv").config();
const WebSocket = require("ws");

const config = {
  wsServerUrl: process.env.WS_SERVER_URL || "ws://localhost:2808",
  authToken: process.env.WS_AUTH_TOKEN || "",
};

class WsClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.messageCount = 0;
    this.startTime = Date.now();
    this.lastMessageTime = Date.now();
  }

  /**
   * Форматирует время в HH:MM:SS
   */
  formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  /**
   * Вывод с цветом и emoji
   */
  printMessage(emoji, time, message, color = "") {
    const colors = {
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      red: "\x1b[31m",
      cyan: "\x1b[36m",
      magenta: "\x1b[35m",
      blue: "\x1b[34m",
      white: "\x1b[37m",
      reset: "\x1b[0m",
    };

    const colorCode = colors[color] || "";
    const reset = colors.reset;

    console.log(`${colorCode}${emoji} [${time}] ${message}${reset}`);
  }

  /**
   * Подключение к серверу
   */
  connect() {
    console.clear();
    console.log(
      "╔════════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║       📡 DTrader-5.2 WebSocket Client - Phase 2 📡            ║",
    );
    console.log(
      "╚════════════════════════════════════════════════════════════════╝",
    );
    console.log("");

    const url = `${config.wsServerUrl}?token=${config.authToken}`;

    this.ws = new WebSocket(url);

    this.ws.on("open", () => this.onOpen());
    this.ws.on("message", (data) => this.onMessage(data));
    this.ws.on("error", (error) => this.onError(error));
    this.ws.on("close", (code, reason) => this.onClose(code, reason));
  }

  /**
   * WebSocket открыт
   */
  onOpen() {
    this.isConnected = true;
    const time = this.formatTime(Date.now());
    this.printMessage("✅", time, "Connected to WS-Server", "green");
    console.log("");
  }

  /**
   * Получено сообщение
   */
  onMessage(data) {
    try {
      this.messageCount++;
      this.lastMessageTime = Date.now();
      const message = JSON.parse(data.toString());
      const time = this.formatTime(Date.now());

      // ============================================
      // HEARTBEAT PONG (основное событие)
      // ============================================
      if (message.event === "heartbeat:pong") {
        const pingId = message.data?.ping_id ?? "?";
        const latency = message.data?.latency || "?";
        const status = message.data?.status || "unknown";

        let color = "green";
        if (latency > 500) color = "yellow";
        if (latency > 1000) color = "red";

        const msg = `Latency: ${latency}ms | Status: ${status}`;
        this.printMessage("💓", time, msg, color);
      }

      // ============================================
      // INITIAL STATE (при подключении)
      // ============================================
      else if (message.type === "initial_state") {
        if (message.data?.balance) {
          const balance = message.data.balance.usdt || "?";
          this.printMessage(
            "📊",
            time,
            `Initial Balance: ${balance} USDT`,
            "cyan",
          );
        }
      }

      // ============================================
      // HEARTBEAT FAILED (потеря соединения)
      // ============================================
      else if (message.event === "heartbeat:failed") {
        this.printMessage("❌", time, "Heartbeat Failed - Retrying...", "red");
      }

      // ============================================
      // HEARTBEAT RECOVERED (восстановление)
      // ============================================
      else if (message.event === "heartbeat:recovered") {
        this.printMessage("🔄", time, "Heartbeat Recovered!", "green");
      }

      // ============================================
      // BALANCE CHANGED
      // ============================================
      else if (message.event === "balance:changed") {
        const usdt = message.data?.usdt || "?";
        this.printMessage(
          "💰",
          time,
          `Balance Changed: ${usdt} USDT`,
          "magenta",
        );
      }

      // ============================================
      // REDIS DISCONNECTED
      // ============================================
      else if (message.event === "REDIS_DISCONNECTED") {
        this.printMessage("⚠️ ", time, "Redis Disconnected", "yellow");
      }

      // ============================================
      // REDIS RECONNECTED
      // ============================================
      else if (message.event === "REDIS_RECONNECTED") {
        this.printMessage("✅", time, "Redis Reconnected", "green");
      }

      // ============================================
      // UNKNOWN EVENT
      // ============================================
      else {
        this.printMessage(
          "📬",
          time,
          `Event: ${message.event || "unknown"}`,
          "blue",
        );
      }
    } catch (error) {
      const time = this.formatTime(Date.now());
      this.printMessage("❌", time, `Parse error: ${error.message}`, "red");
    }
  }

  /**
   * Ошибка соединения
   */
  onError(error) {
    const time = this.formatTime(Date.now());
    this.printMessage("❌", time, `Connection error: ${error.message}`, "red");
  }

  /**
   * WebSocket закрыт
   */
  onClose(code, reason) {
    this.isConnected = false;
    const time = this.formatTime(Date.now());
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);

    console.log("");
    this.printMessage("🔌", time, `Disconnected | Code: ${code}`, "yellow");
    console.log("");
    console.log("─".repeat(64));
    console.log(`  📊 Statistics:`);
    console.log(`     Messages received: ${this.messageCount}`);
    console.log(`     Uptime: ${uptimeSec}s`);
    if (this.messageCount > 0) {
      console.log(
        `     Avg interval: ${Math.floor(uptimeSec / this.messageCount)}s`,
      );
    }
    console.log("─".repeat(64));
  }

  /**
   * Отключение
   */
  disconnect() {
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
    }
  }
}

// ============================================
// MAIN
// ============================================

const client = new WsClient();

process.on("SIGINT", () => {
  console.log("");
  client.disconnect();
  setTimeout(() => process.exit(0), 500);
});

process.on("uncaughtException", (error) => {
  console.error(`❌ Error: ${error.message}`);
  client.disconnect();
  process.exit(1);
});

client.connect();
