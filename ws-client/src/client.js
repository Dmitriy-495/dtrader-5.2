/**
 * DTrader-5.2 WebSocket Test Client
 * Простой Node.js клиент для тестирования WS-Server
 */

require('dotenv').config();
const WebSocket = require('ws');

const config = {
  wsServerUrl: process.env.WS_SERVER_URL || 'ws://localhost:2808',
  authToken: process.env.WS_AUTH_TOKEN || '',
};

class WsClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.messageCount = 0;
    this.startTime = Date.now();
    this.lastMessageTime = Date.now();
  }

  logJson(level, event, data = {}) {
    const log = {
      timestamp: Date.now(),
      level,
      service: 'ws-client',
      event,
      ...data,
    };

    if (level === 'error') {
      console.error(JSON.stringify(log));
    } else {
      console.log(JSON.stringify(log));
    }
  }

  prettyLog(emoji, time, message, color = '') {
    const colorCodes = {
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      cyan: '\x1b[36m',
      magenta: '\x1b[35m',
      reset: '\x1b[0m',
    };

    const colorCode = colorCodes[color] || '';
    const reset = colorCodes.reset;

    console.log(`${colorCode}${emoji} [${time}] ${message}${reset}`);
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  connect() {
    console.clear();
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║       📡 DTrader-5.2 WebSocket Test Client 📡                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

    const url = `${config.wsServerUrl}?token=${config.authToken}`;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data) => this.onMessage(data));
    this.ws.on('error', (error) => this.onError(error));
    this.ws.on('close', (code, reason) => this.onClose(code, reason));
  }

  onOpen() {
    this.isConnected = true;
    const time = this.formatTime(Date.now());
    this.prettyLog('✅', time, 'Connected to WS-Server', 'green');
  }

  onMessage(data) {
    try {
      this.messageCount++;
      this.lastMessageTime = Date.now();
      const message = JSON.parse(data.toString());

      // JSON логирование
      this.logJson('info', `MESSAGE_${this.messageCount}`, {
        event: message.event,
        data: message.data,
      });

      // Pretty-print для консоли
      const time = this.formatTime(Date.now());

      if (message.type === 'initial_state') {
        this.prettyLog('📊', time, 'Initial State Received', 'cyan');
        if (message.data.balance) {
          console.log(`   Balance: ${message.data.balance.usdt} USDT`);
        }
      } else if (message.event === 'balance:changed') {
        this.prettyLog('💰', time, 'Balance Changed', 'magenta');
        console.log(`   USDT: ${message.data.usdt}`);
      } else if (message.event === 'heartbeat:pong') {
        this.prettyLog('💓', time, 'Heartbeat Pong', 'yellow');
        console.log(`   Status: ${message.data.status} | Latency: ${message.data.latency}ms`);
      } else if (message.type === 'error') {
        this.prettyLog('❌', time, `Error: ${message.event}`, 'red');
        console.log(`   ${message.message}`);
      } else if (message.type === 'reconnected') {
        this.prettyLog('🔄', time, 'Reconnected', 'green');
      }
    } catch (error) {
      const time = this.formatTime(Date.now());
      this.prettyLog('❌', time, `Parse error: ${error.message}`, 'red');
      this.logJson('error', 'MESSAGE_PARSE_ERROR', { error: error.message });
    }
  }

  onError(error) {
    const time = this.formatTime(Date.now());
    this.prettyLog('❌', time, `Connection error: ${error.message}`, 'red');
    this.logJson('error', 'WS_ERROR', { error: error.message });
  }

  onClose(code, reason) {
    this.isConnected = false;
    const time = this.formatTime(Date.now());
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);

    console.log('');
    this.prettyLog('🔌', time, `Disconnected | Code: ${code}`, 'yellow');
    console.log('');
    console.log('─'.repeat(64));
    console.log(`  📊 Statistics:`);
    console.log(`     Messages received: ${this.messageCount}`);
    console.log(`     Uptime: ${uptimeSec}s`);
    if (this.messageCount > 0) {
      console.log(`     Avg interval: ${Math.floor(uptimeSec / this.messageCount)}s`);
    }
    console.log('─'.repeat(64));

    this.logJson('info', 'CLIENT_DISCONNECTED', {
      code,
      messages_received: this.messageCount,
      uptime_seconds: uptimeSec,
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
  }
}

// ============================================
// MAIN
// ============================================

const client = new WsClient();

process.on('SIGINT', () => {
  console.log('');
  client.disconnect();
  setTimeout(() => process.exit(0), 500);
});

process.on('uncaughtException', (error) => {
  console.error(`❌ Error: ${error.message}`);
  client.disconnect();
  process.exit(1);
});

client.connect();
