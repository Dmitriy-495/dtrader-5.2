/**
 * Redis Subscriber - слушание Pub/Sub канала event:*
 */

import { createClient, RedisClientType } from 'redis';
import { Logger } from '../utils/logger';

export interface RedisSubscriberConfig {
  host: string;
  port: number;
}

export class RedisSubscriber {
  private client: RedisClientType | null = null;
  private config: RedisSubscriberConfig;
  private isConnected: boolean = false;
  private isReconnecting: boolean = false;
  private messageHandlers: Map<string, (message: string) => void> = new Map();
  private logger: Logger;

  constructor(config: RedisSubscriberConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      this.client = createClient({
        socket: {
          host: this.config.host,
          port: this.config.port,
        },
      });

      this.client.on('error', (err) => {
        this.logger.error('REDIS_SUBSCRIBER_ERROR', err.message);
        this.handleDisconnect();
      });

      this.client.on('connect', () => {
        this.logger.info('REDIS_SUBSCRIBER_CONNECTED', { host: this.config.host, port: this.config.port });
      });

      await this.client.connect();
      this.isConnected = true;
      this.isReconnecting = false;
    } catch (error) {
      const err = error as Error;
      this.logger.error('REDIS_SUBSCRIBER_CONNECTION_FAILED', err.message);
      throw error;
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('Redis subscriber not connected');
    }

    this.messageHandlers.set(channel, handler);

    try {
      await this.client.subscribe(channel, (message) => {
        handler(message);
      });

      this.logger.info('REDIS_SUBSCRIBED', { channel });
    } catch (error) {
      const err = error as Error;
      this.logger.error('REDIS_SUBSCRIBE_FAILED', err.message, { channel });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected || !this.client) return;

    try {
      await this.client.quit();
      this.isConnected = false;
      this.logger.info('REDIS_SUBSCRIBER_DISCONNECTED');
    } catch (error) {
      const err = error as Error;
      this.logger.error('REDIS_SUBSCRIBER_DISCONNECT_FAILED', err.message);
    }
  }

  private handleDisconnect(): void {
    if (this.isReconnecting || !this.isConnected) return;

    this.isConnected = false;
    this.isReconnecting = true;

    this.logger.warn('REDIS_DISCONNECTED', {});

    // Attempt to reconnect (бесконечный retry)
    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    let retryCount = 0;
    const maxRetries = 5;
    const baseDelay = 1000; // 1 second

    const retry = async () => {
      if (!this.isReconnecting) return;

      retryCount++;
      const delay = baseDelay * Math.pow(2, retryCount - 1); // exponential backoff

      this.logger.info('REDIS_RECONNECT_ATTEMPT', { attempt: retryCount, delay });

      setTimeout(async () => {
        try {
          await this.connect();
          this.logger.info('REDIS_RECONNECTED', {});
          this.isReconnecting = false;
        } catch (error) {
          if (retryCount < maxRetries) {
            retry();
          } else {
            this.logger.warn('REDIS_RECONNECT_FAILED_MAX_RETRIES', { max_retries: maxRetries });
            // Continue retrying indefinitely with longer delays
            retryCount = 0;
            retry();
          }
        }
      }, delay);
    };

    retry();
  }

  isReady(): boolean {
    return this.isConnected && !this.isReconnecting;
  }
}

export default RedisSubscriber;
