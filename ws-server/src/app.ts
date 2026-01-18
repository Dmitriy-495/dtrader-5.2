/**
 * DTrader-5.2 WS-Server - Entry Point
 * 
 * Функции:
 * 1. Загрузить конфигурацию
 * 2. Подключиться к Redis
 * 3. Подписаться на Pub/Sub каналы (event:*)
 * 4. Создать WebSocket сервер на порту 2808
 * 5. Транслировать события всем подключённым клиентам
 * 6. Graceful shutdown на SIGINT
 */

import * as dotenv from 'dotenv';
import { createClient } from 'redis';
import { loadConfig } from './config';
import { Logger } from './utils/logger';
import { RedisSubscriber } from './services/redis-subscriber';
import { WsServer } from './services/ws-server';

dotenv.config();

// ============================================
// APP CLASS
// ============================================

class WsServerApp {
  private config = loadConfig();
  private logger = new Logger();
  private redisClient: any = null;
  private redisSubscriber: RedisSubscriber | null = null;
  private wsServer: WsServer | null = null;
  private isShuttingDown = false;

  async start(): Promise<void> {
    console.clear();
    console.log('╔════════════════════════════════════════════╗');
    console.log('║  📡 DTrader-5.2 WS-Server Started 📡     ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('');

    try {
      // 1. Подключиться к Redis (основной клиент для HGET)
      await this.connectRedis();

      // 2. Создать Redis subscriber для Pub/Sub
      this.redisSubscriber = new RedisSubscriber(this.config.redis, this.logger);
      await this.redisSubscriber.connect();

      // 3. Создать WebSocket сервер
      this.wsServer = new WsServer(this.config.websocket, this.logger);
      await this.wsServer.start(this.redisClient);

      // 4. Подписаться на все event:* каналы
      await this.subscribeToEvents();

      console.log('');
      console.log('✅ WS-Server ready to accept connections');
      console.log('');

      // Graceful shutdown
      await new Promise(() => {});
    } catch (error) {
      const err = error as Error;
      this.logger.error('WS_SERVER_STARTUP_FAILED', err.message);
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
      this.logger.error('REDIS_ERROR', err.message);
    });

    try {
      await this.redisClient.connect();
      this.logger.info('REDIS_CONNECTED', { host: this.config.redis.host, port: this.config.redis.port });
    } catch (error) {
      const err = error as Error;
      this.logger.error('REDIS_CONNECTION_FAILED', err.message);
      process.exit(1);
    }
  }

  private async subscribeToEvents(): Promise<void> {
    if (!this.redisSubscriber) return;

    // Подписываемся на event:balance:changed
    await this.redisSubscriber.subscribe('event:balance:changed', (message) => {
      try {
        const event = JSON.parse(message);
        const broadcastMessage = {
          event: 'balance:changed',
          source: event.source,
          data: {
            usdt: event.usdt,
            updated_at: event.updated_at,
          },
          timestamp: Date.now(),
        };

        this.wsServer?.broadcast(broadcastMessage);
      } catch (error) {
        this.logger.error('PARSE_BALANCE_CHANGED_FAILED', (error as Error).message);
      }
    });

    // Подписываемся на event:heartbeat:pong
    await this.redisSubscriber.subscribe('event:heartbeat:pong', (message) => {
      try {
        const event = JSON.parse(message);
        const broadcastMessage = {
          event: 'heartbeat:pong',
          source: event.source,
          data: {
            status: event.status,
            latency: event.latency,
            updated_at: event.updated_at,
          },
          timestamp: Date.now(),
        };

        this.wsServer?.broadcast(broadcastMessage);
      } catch (error) {
        this.logger.error('PARSE_HEARTBEAT_PONG_FAILED', (error as Error).message);
      }
    });

    this.logger.info('SUBSCRIBED_TO_EVENTS', { channels: ['event:balance:changed', 'event:heartbeat:pong'] });
  }

  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.logger.info('WS_SERVER_SHUTTING_DOWN');

    if (this.wsServer) {
      await this.wsServer.stop();
    }

    if (this.redisSubscriber) {
      await this.redisSubscriber.disconnect();
    }

    if (this.redisClient) {
      await this.redisClient.quit();
    }

    this.logger.info('WS_SERVER_STOPPED');
  }
}

// ============================================
// MAIN
// ============================================

const app = new WsServerApp();

process.on('SIGINT', async () => {
  console.log('');
  await app.stop();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error(error);
  await app.stop();
  process.exit(1);
});

app.start();
