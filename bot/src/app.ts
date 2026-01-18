/**
 * DTrader-5.2 Bot - Entry Point
 * 
 * Функции:
 * 1. Загрузить конфигурацию
 * 2. Подключиться к Redis
 * 3. Загрузить начальный баланс (REST API)
 * 4. Запустить WebSocket Service (heartbeat + баланс обновления)
 * 5. Graceful shutdown на SIGINT
 */

import * as dotenv from 'dotenv';
import { createClient } from 'redis';
import { createHmac, createHash } from 'crypto';
import * as https from 'https';
import { AppConfig, UnifiedAccount, WalletBalance, AccountBalance, SystemHeartbeat, BalanceChangedMessage } from './types';
import { WebSocketService } from './adapters/gate-io/websocket-service';

dotenv.config();

// ============================================
// CONFIG LOADER
// ============================================

function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development') as 'development' | 'production';
  
  const config: AppConfig = {
    nodeEnv,
    gateio: {
      apiKey: process.env.GATEIO_API_KEY || '',
      apiSecret: process.env.GATEIO_API_SECRET || '',
      baseUrlRest: process.env.BASE_URL_REST || 'https://api.gateio.ws',
      baseUrlWs: process.env.BASE_URL_WS || 'wss://fx-ws.gateio.ws/v4/ws/usdt',
      testNetRestUrl: process.env.BASE_URL_TEST_NET_REST,
      testNetWsUrl: process.env.BASE_URL_TEST_NET_WS,
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    websocket: {
      pingInterval: parseInt(process.env.WS_PING_INTERVAL || '15000'),
      pongTimeout: parseInt(process.env.WS_PING_TIMEOUT || '3000'),
    },
    trading: {
      tradingPairs: (process.env.TRADING_PAIRS || 'BTC_USDT,ETH_USDT').split(','),
      orderbookDepth: parseInt(process.env.ORDERBOOK_DEPTH || '20'),
      orderbookUpdateSpeed: process.env.ORDERBOOK_UPDATE_SPEED || '100ms',
    },
  };

  // Validation
  if (!config.gateio.apiKey || !config.gateio.apiSecret) {
    throw new Error('❌ GATEIO_API_KEY и GATEIO_API_SECRET обязательны в .env');
  }

  return config;
}

// ============================================
// LOGGER
// ============================================

function logJson(level: 'info' | 'error' | 'warn', event: string, data?: any, error?: string): void {
  const logEntry = {
    timestamp: Date.now(),
    level,
    service: 'bot',
    event,
    ...(data && { data }),
    ...(error && { error }),
  };
  
  if (level === 'error') {
    console.error(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }
}

// ============================================
// SIMPLE LOGGER FOR WEBSOCKET SERVICE
// ============================================

class SimpleLogger {
  info(event: string, data?: any): void {
    logJson('info', event, data);
  }

  error(event: string, message: string, data?: any): void {
    logJson('error', event, data, message);
  }

  warn(event: string, data?: any): void {
    logJson('warn', event, data);
  }
}

// ============================================
// GATE.IO REST API CLIENT
// ============================================

function createGateIOSignature(
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
  queryString: string = '',
  payloadString: string = ''
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const hashedPayload = createHash('sha512')
    .update(payloadString || '')
    .digest('hex');

  const signString = [
    method.toUpperCase(),
    path,
    queryString || '',
    hashedPayload,
    timestamp,
  ].join('\n');

  const signature = createHmac('sha512', apiSecret)
    .update(signString)
    .digest('hex');

  return {
    KEY: apiKey,
    Timestamp: timestamp,
    SIGN: signature,
  };
}

async function fetchUnifiedAccounts(config: AppConfig): Promise<UnifiedAccount> {
  return new Promise((resolve, reject) => {
    const method = 'GET';
    const path = '/api/v4/unified/accounts';
    const queryString = '';
    const payloadString = '';

    const headers = createGateIOSignature(
      config.gateio.apiKey,
      config.gateio.apiSecret,
      method,
      path,
      queryString,
      payloadString
    );

    const url = new URL(`${config.gateio.baseUrlRest}${path}`);
    const urlStr = url.toString();

    https.get(urlStr, {
      headers: {
        ...headers,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const account = JSON.parse(data);
          resolve(account);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e}`));
        }
      });
    }).on('error', reject);
  });
}

async function fetchWalletTotalBalance(config: AppConfig): Promise<WalletBalance> {
  return new Promise((resolve, reject) => {
    const method = 'GET';
    const path = '/api/v4/wallet/total_balance';
    const queryString = '';
    const payloadString = '';

    const headers = createGateIOSignature(
      config.gateio.apiKey,
      config.gateio.apiSecret,
      method,
      path,
      queryString,
      payloadString
    );

    const url = new URL(`${config.gateio.baseUrlRest}${path}`);
    const urlStr = url.toString();

    https.get(urlStr, {
      headers: {
        ...headers,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const balance = JSON.parse(data);
          resolve(balance);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e}`));
        }
      });
    }).on('error', reject);
  });
}

// ============================================
// BOT CLASS
// ============================================

class Bot {
  private config: AppConfig;
  private redisClient: any = null;
  private wsService: WebSocketService | null = null;
  private isShuttingDown = false;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    console.clear();
    console.log('╔════════════════════════════════════════════╗');
    console.log('║   🚀 DTrader-5.2 Bot Started 🚀          ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('');

    try {
      // 1. Подключиться к Redis (exit если не удалось)
      await this.connectRedis();
      logJson('info', 'REDIS_CONNECTED', { host: this.config.redis.host, port: this.config.redis.port });

      // 2. Загрузить UnifiedAccount
      logJson('info', 'FETCHING_UNIFIED_ACCOUNTS');
      const account = await fetchUnifiedAccounts(this.config);
      const userId = account.user_id;
      const equity = account.unified_account_total_equity;
      const leverage = account.leverage;
      
      logJson('info', 'UNIFIED_ACCOUNTS_LOADED', {
        user_id: userId,
        equity,
        leverage,
      });

      // 3. Загрузить WalletBalance
      logJson('info', 'FETCHING_WALLET_BALANCE');
      const balance = await fetchWalletTotalBalance(this.config);
      const usdt = balance.total?.amount || '0';
      const currency = balance.total?.currency || 'USDT';

      logJson('info', 'WALLET_BALANCE_LOADED', {
        currency,
        amount: usdt,
      });

      // 4. Сохранить баланс в Redis Hash: account:balance
      const accountBalance: AccountBalance = {
        usdt,
        updated_at: Date.now().toString(),
      };

      await this.redisClient.hSet('account:balance', accountBalance);
      logJson('info', 'BALANCE_SAVED_REDIS', accountBalance);

      // 5. Сохранить heartbeat в Redis Hash: system:heartbeat:bot
      const heartbeat: SystemHeartbeat = {
        status: 'online',
        latency: '0',
        updated_at: Date.now().toString(),
      };

      await this.redisClient.hSet('system:heartbeat:bot', heartbeat);
      logJson('info', 'HEARTBEAT_SAVED_REDIS', heartbeat);

      // 6. Опубликовать в Pub/Sub: event:balance:changed
      const balanceMsg: BalanceChangedMessage = {
        usdt,
        updated_at: Date.now().toString(),
        source: 'bot',
      };

      await this.redisClient.publish('event:balance:changed', JSON.stringify(balanceMsg));
      logJson('info', 'BALANCE_PUBLISHED', balanceMsg);

      // 7. Запустить WebSocket Service (heartbeat + баланс обновления)
      this.wsService = new WebSocketService(
        this.config.gateio,
        this.redisClient,
        new SimpleLogger()
      );

      await this.wsService.connect();
      logJson('info', 'WEBSOCKET_SERVICE_STARTED');

      console.log('');
      console.log('✅ Bot running | WebSocket Service active (heartbeat + balance updates)');
      console.log('');

      // Graceful shutdown
      await new Promise(() => {});
    } catch (error) {
      const err = error as Error;
      logJson('error', 'BOT_STARTUP_FAILED', undefined, err.message);
      await this.stop();
      process.exit(1);
    }
  }

  private async connectRedis(): Promise<void> {
    this.redisClient = createClient({
      socket: {
        host: this.config.redis.host,
        port: this.config.redis.port,
      },
    });

    this.redisClient.on('error', (err: any) => {
      logJson('error', 'REDIS_ERROR', undefined, err.message);
    });

    try {
      await this.redisClient.connect();
    } catch (error) {
      const err = error as Error;
      logJson('error', 'REDIS_CONNECTION_FAILED', undefined, err.message);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logJson('info', 'BOT_SHUTTING_DOWN');

    if (this.wsService) {
      await this.wsService.disconnect();
    }

    if (this.redisClient) {
      await this.redisClient.quit();
    }

    logJson('info', 'BOT_STOPPED');
  }
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  const config = loadConfig();
  const bot = new Bot(config);

  process.on('SIGINT', async () => {
    console.log('');
    await bot.stop();
    process.exit(0);
  });

  process.on('uncaughtException', async (error) => {
    logJson('error', 'UNCAUGHT_EXCEPTION', undefined, error.message);
    await bot.stop();
    process.exit(1);
  });

  await bot.start();
}

main();
