/**
 * Heartbeat Manager - управление ping-pong механизмом
 */

import { WebSocketManager } from '../adapters/gate-io/websocket-manager';
import { Logger } from '../utils/logger';

export interface HeartbeatConfig {
  pingInterval: number;     // 15000ms
  pongTimeout: number;      // 3000ms
}

export interface HeartbeatStats {
  totalPings: number;
  successfulPongs: number;
  failedPongs: number;
  lastLatency: number | null;
  lastPongTime: number | null;
  status: 'online' | 'offline';
}

export class HeartbeatManager {
  private wsManager: WebSocketManager;
  private config: HeartbeatConfig;
  private logger: Logger;
  private pingIntervalId: NodeJS.Timeout | null = null;
  private pongTimeoutId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private waitingForPong: boolean = false;
  private lastPongTime: number = 0;
  private stats: HeartbeatStats = {
    totalPings: 0,
    successfulPongs: 0,
    failedPongs: 0,
    lastLatency: null,
    lastPongTime: null,
    status: 'online',
  };
  private messageCallback: (event: string, data: any) => Promise<void>;
  private retryAttempt: number = 0;
  private maxRetries: number = 3;
  private retryDelays: number[] = [1000, 2000, 4000]; // exponential backoff

  constructor(
    wsManager: WebSocketManager,
    config: HeartbeatConfig,
    logger: Logger,
    messageCallback: (event: string, data: any) => Promise<void>
  ) {
    this.wsManager = wsManager;
    this.config = config;
    this.logger = logger;
    this.messageCallback = messageCallback;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastPongTime = Date.now();

    this.logger.info('HEARTBEAT_STARTED', {
      ping_interval: this.config.pingInterval,
      pong_timeout: this.config.pongTimeout,
    });

    // Подписываемся на pong события
    this.wsManager.onMessage('futures.pong', (data) => {
      this.handlePong(data);
    });

    // Начинаем ping loop
    this.pingIntervalId = setInterval(() => {
      this.sendPing();
    }, this.config.pingInterval);

    // Отправляем первый ping сразу
    this.sendPing();
  }

  stop(): void {
    if (!this.isRunning) return;

    this.logger.info('HEARTBEAT_STOPPED');

    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }

    if (this.pongTimeoutId) {
      clearTimeout(this.pongTimeoutId);
      this.pongTimeoutId = null;
    }

    this.isRunning = false;
    this.waitingForPong = false;
  }

  private sendPing(): void {
    if (!this.wsManager.isConnected()) {
      this.logger.warn('PING_SKIPPED_NOT_CONNECTED');
      return;
    }

    try {
      const pingMessage = {
        time: Math.floor(Date.now() / 1000),
        channel: 'futures.ping',
      };

      const sent = this.wsManager.send(pingMessage);

      if (sent) {
        this.stats.totalPings++;
        this.waitingForPong = true;
        this.retryAttempt = 0;

        this.logger.info('PING_SENT', {
          ping_number: this.stats.totalPings,
        });

        this.startPongTimer();
      } else {
        this.logger.warn('PING_SEND_FAILED', {});
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error('PING_ERROR', err.message);
    }
  }

  private startPongTimer(): void {
    if (this.pongTimeoutId) {
      clearTimeout(this.pongTimeoutId);
    }

    this.pongTimeoutId = setTimeout(() => {
      if (this.waitingForPong) {
        this.handlePongTimeout();
      }
    }, this.config.pongTimeout);
  }

  private handlePong(data: any): void {
    if (!this.waitingForPong) return;

    this.waitingForPong = false;

    if (this.pongTimeoutId) {
      clearTimeout(this.pongTimeoutId);
      this.pongTimeoutId = null;
    }

    const now = Date.now();
    const latency = now - this.lastPongTime;
    this.lastPongTime = now;

    this.stats.successfulPongs++;
    this.stats.lastLatency = latency;
    this.stats.lastPongTime = now;
    this.stats.status = 'online';
    this.retryAttempt = 0;

    this.logger.info('PONG_RECEIVED', {
      pong_number: this.stats.successfulPongs,
      latency,
      total_pings: this.stats.totalPings,
    });

    // Публикуем событие
    this.publishPongEvent(latency);

    // Если были failed - публикуем recovery
    if (this.stats.failedPongs > 0) {
      this.publishRecoveryEvent();
      this.stats.failedPongs = 0;
    }
  }

  private handlePongTimeout(): void {
    this.stats.failedPongs++;
    this.stats.status = 'offline';

    this.logger.warn('PONG_TIMEOUT', {
      retry_attempt: this.retryAttempt + 1,
      max_retries: this.maxRetries,
      failed_count: this.stats.failedPongs,
    });

    // Публикуем failed событие
    this.publishFailedEvent();

    // Пытаемся повторить ping
    if (this.retryAttempt < this.maxRetries) {
      const delay = this.retryDelays[this.retryAttempt];
      this.retryAttempt++;

      this.logger.info('HEARTBEAT_RETRY', {
        attempt: this.retryAttempt,
        delay,
        max_retries: this.maxRetries,
      });

      setTimeout(() => {
        if (this.isRunning && this.wsManager.isConnected()) {
          this.sendPing();
        }
      }, delay);
    } else {
      this.logger.error('HEARTBEAT_RETRY_EXHAUSTED', {
        attempts: this.maxRetries,
      });

      // После исчерпания retry - ждём следующего interval ping'а
      this.waitingForPong = false;
    }
  }

  private publishPongEvent(latency: number): void {
    this.messageCallback('event:heartbeat:pong', {
      status: 'online',
      latency,
      updated_at: Date.now().toString(),
      source: 'bot',
    }).catch((error) => {
      this.logger.error('PUBLISH_PONG_FAILED', (error as Error).message);
    });
  }

  private publishFailedEvent(): void {
    this.messageCallback('event:heartbeat:failed', {
      status: 'offline',
      reason: 'pong_timeout',
      timestamp: Date.now().toString(),
      source: 'bot',
    }).catch((error) => {
      this.logger.error('PUBLISH_FAILED_FAILED', (error as Error).message);
    });
  }

  private publishRecoveryEvent(): void {
    this.messageCallback('event:heartbeat:recovered', {
      status: 'online',
      recovered_at: Date.now().toString(),
      source: 'bot',
    }).catch((error) => {
      this.logger.error('PUBLISH_RECOVERED_FAILED', (error as Error).message);
    });
  }

  getStats(): HeartbeatStats {
    return { ...this.stats };
  }

  isHealthy(): boolean {
    return this.stats.status === 'online';
  }
}

export default HeartbeatManager;
