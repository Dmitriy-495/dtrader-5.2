/**
 * DTrader-5.2 - Test BTC_USDT Tickers
 * Получаем live тики BTC_USDT с Gate.io Futures WebSocket
 * https://www.gate.com/docs/developers/futures/ws/en/#tickers-api
 */

const WebSocket = require("ws");

class BtcTickersTest {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.tickCount = 0;
    this.startTime = Date.now();
  }

  /**
   * Подключение к Gate.io Futures WebSocket
   */
  connect() {
    console.clear();
    console.log(
      "╔════════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║       📊 DTrader-5.2 BTC_USDT Tickers Test 📊                 ║",
    );
    console.log(
      "╚════════════════════════════════════════════════════════════════╝",
    );
    console.log("");

    const url = "wss://api.gateio.ws/ws/v4/";

    console.log(`🔗 Подключение к: ${url}`);
    console.log("📝 Подписка на: futures.tickers (BTC_USDT)");
    console.log("");

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
    console.log(`✅ [${time}] Соединение установлено`);
    console.log("");

    // 🔥 ПОДПИСЫВАЕМСЯ НА ТИКИ BTC_USDT
    const subscribeMessage = {
      time: Math.floor(Date.now() / 1000),
      channel: "futures.tickers",
      event: "subscribe",
      payload: ["BTC_USDT"], // ← Только BTC_USDT
    };

    console.log("📤 Отправляем подписку:");
    console.log(JSON.stringify(subscribeMessage, null, 2));
    console.log("");

    this.ws.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Получено сообщение
   */
  onMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      const time = this.formatTime(Date.now());

      // Проверяем что это тики
      if (message.channel === "futures.tickers" && message.event === "update") {
        this.tickCount++;

        // Распаковываем данные тика
        const ticker = message.result;

        if (ticker) {
          const contract = ticker.contract || "?";
          const last = ticker.last || "?";
          const bid = ticker.bid1 || "?";
          const ask = ticker.ask1 || "?";
          const volume = ticker.volume_24h || "?";
          const timestamp = ticker.time || Date.now();

          // Красивый вывод
          console.log(`📊 [${time}] TICKER #${this.tickCount}`);
          console.log(`   Contract: ${contract}`);
          console.log(`   Last: ${last} | Bid: ${bid} | Ask: ${ask}`);
          console.log(`   Volume 24h: ${volume}`);
          console.log(`   Raw timestamp: ${timestamp}`);
          console.log("");
        }
      } else {
        // Логируем другие сообщения
        console.log(
          `📬 [${time}] Event: ${message.event || "unknown"} | Channel: ${message.channel || "unknown"}`,
        );
        if (message.result) {
          console.log(
            `   Data: ${JSON.stringify(message.result).substring(0, 100)}`,
          );
        }
        console.log("");
      }
    } catch (error) {
      const time = this.formatTime(Date.now());
      console.log(`❌ [${time}] Parse error: ${error.message}`);
      console.log(`   Raw data: ${data.toString().substring(0, 200)}`);
      console.log("");
    }
  }

  /**
   * Ошибка соединения
   */
  onError(error) {
    const time = this.formatTime(Date.now());
    console.log(`❌ [${time}] Connection error: ${error.message}`);
  }

  /**
   * WebSocket закрыт
   */
  onClose(code, reason) {
    this.isConnected = false;
    const time = this.formatTime(Date.now());
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);

    console.log("");
    console.log(`🔌 [${time}] Disconnected | Code: ${code}`);
    console.log("");
    console.log("─".repeat(64));
    console.log(`  📊 Statistics:`);
    console.log(`     Tickers received: ${this.tickCount}`);
    console.log(`     Uptime: ${uptimeSec}s`);
    if (this.tickCount > 0) {
      console.log(
        `     Avg frequency: ${(this.tickCount / uptimeSec).toFixed(2)} tickers/sec`,
      );
    }
    console.log("─".repeat(64));
  }

  /**
   * Форматирует время HH:MM:SS.mmm
   */
  formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    const ms = date.getMilliseconds().toString().padStart(3, "0");
    return `${hours}:${minutes}:${seconds}.${ms}`;
  }

  /**
   * Отключение
   */
  disconnect() {
    if (this.ws) {
      this.ws.close(1000, "Test completed");
    }
  }
}

// ============================================
// MAIN
// ============================================

const test = new BtcTickersTest();

process.on("SIGINT", () => {
  console.log("");
  test.disconnect();
  setTimeout(() => process.exit(0), 500);
});

process.on("uncaughtException", (error) => {
  console.error(`❌ Error: ${error.message}`);
  test.disconnect();
  process.exit(1);
});

test.connect();
