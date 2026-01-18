/**
 * WebSocket Service - управление всеми WebSocket операциями
 * Координирует heartbeat, баланс и другие подписки
 * FIX: Используем Unified API endpoint (api.gateio.ws/ws/v4/)
 */

import { createClient, RedisClientType } from "redis";
import { WebSocketManager } from "./websocket-manager";
import { HeartbeatManager } from "../../core/heartbeat-manager";
import { Logger } from "../../utils/logger";
import { GateioConfig } from "../../types";

export class WebSocketService {
  private wsManager: WebSocketManager | null = null;
  private heartbeatManager: HeartbeatManager | null = null;
  private redisClient: RedisClientType;
  private logger: Logger;
  private config: GateioConfig;
  private isConnected: boolean = false;

  constructor(
    config: GateioConfig,
    redisClient: RedisClientType,
    logger: Logger,
  ) {
    this.config = config;
    this.redisClient = redisClient;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      // ✅ Используем Unified API WebSocket endpoint
      // Это работает для всех типов торговли (spot, futures, margin и т.д.)
      const wsUrl = "wss://api.gateio.ws/ws/v4/";

      // Создаём WebSocket Manager
      this.wsManager = new WebSocketManager({
        url: wsUrl,
        reconnectInterval: 5000,
        maxReconnectAttempts: 10,
      });

      await this.wsManager.connect();
      this.logger.info("WEBSOCKET_CONNECTED", { url: wsUrl });

      // Подписываемся на баланс обновления (если нужно)
      // Примечание: для Unified API структура может отличаться
      this.wsManager.onMessage("spot.balance_notify", (data) => {
        this.handleBalanceUpdate(data);
      });

      // Создаём Heartbeat Manager
      // Он использует spot.ping/spot.pong (Unified API)
      this.heartbeatManager = new HeartbeatManager(
        this.wsManager,
        {
          pingInterval: 15000, // 15 сек
          pongTimeout: 3000, // 3 сек timeout
        },
        this.logger,
        (event: string, data: any) => this.publishEvent(event, data),
      );

      await this.heartbeatManager.start();
      this.logger.info("HEARTBEAT_MANAGER_STARTED");

      this.isConnected = true;
    } catch (error) {
      const err = error as Error;
      this.logger.error("WEBSOCKET_CONNECTION_FAILED", err.message);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    if (this.heartbeatManager) {
      this.heartbeatManager.stop();
    }

    if (this.wsManager) {
      this.wsManager.disconnect();
    }

    this.isConnected = false;
    this.logger.info("WEBSOCKET_DISCONNECTED");
  }

  private async handleBalanceUpdate(data: any): Promise<void> {
    try {
      if (data.event === "update" && data.result && data.result.balances) {
        const balances = data.result.balances;

        // Ищем USDT баланс
        const usdtBalance = balances.find((b: any) => b.currency === "USDT");

        if (usdtBalance) {
          const usdt = usdtBalance.available;
          const updated_at = Date.now().toString();

          // Сохраняем в Redis Hash
          await this.redisClient.hSet("account:balance", {
            usdt,
            updated_at,
          });

          this.logger.info("BALANCE_UPDATED_WEBSOCKET", {
            usdt,
            timestamp: updated_at,
          });

          // Публикуем событие
          await this.publishEvent("event:balance:changed", {
            usdt,
            updated_at,
            source: "bot",
          });
        }
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error("BALANCE_UPDATE_FAILED", err.message);
    }
  }

  private async publishEvent(channel: string, data: any): Promise<void> {
    try {
      const payload = JSON.stringify(data);
      await this.redisClient.publish(channel, payload);

      this.logger.info("EVENT_PUBLISHED", {
        channel,
        event: data.status || data.event || "unknown",
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error("PUBLISH_EVENT_FAILED", err.message, { channel });
    }
  }

  isConnected_(): boolean {
    return this.isConnected && (this.wsManager?.isConnected() || true );
  }

  getHeartbeatStats(): any {
    if (this.heartbeatManager) {
      return this.heartbeatManager.getStats();
    }
    return null;
  }

  isHeartbeatHealthy(): boolean {
    if (this.heartbeatManager) {
      return this.heartbeatManager.isHealthy();
    }
    return false;
  }
}

export default WebSocketService;
