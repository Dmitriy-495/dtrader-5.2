/**
 * WebSocket Service - управление всеми WebSocket операциями
 * Координирует heartbeat, баланс и другие подписки
 * FIX: Используем Unified API endpoint (api.gateio.ws/ws/v4/)
 * FIX: Динамический ping interval из config
 */

import { createClient, RedisClientType } from "redis";
import { WebSocketManager } from "./websocket-manager";
import { HeartbeatManager } from "../../core/heartbeat-manager";
import { Logger } from "../../utils/logger";
import { GateioConfig, WebSocketConfig } from "../../types";

export class WebSocketService {
  private wsManager: WebSocketManager | null = null;
  private heartbeatManager: HeartbeatManager | null = null;
  private redisClient: RedisClientType;
  private logger: Logger;
  private gateioConfig: GateioConfig;
  private websocketConfig: WebSocketConfig;
  private isConnected: boolean = false;

  constructor(
    gateioConfig: GateioConfig,
    websocketConfig: WebSocketConfig,
    redisClient: RedisClientType,
    logger: Logger,
  ) {
    this.gateioConfig = gateioConfig;
    this.websocketConfig = websocketConfig;
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

      // 🔥 ДИНАМИЧЕСКИЙ PING INTERVAL ИЗ CONFIG!
      const pingInterval = this.websocketConfig.pingInterval || 15000;
      const pongTimeout = this.websocketConfig.pongTimeout || 3000;

      // Создаём Heartbeat Manager с динамическим интервалом
      this.heartbeatManager = new HeartbeatManager(
        this.wsManager,
        {
          pingInterval: pingInterval, // ✅ БЕРЁМ ИЗ CONFIG!
          pongTimeout: pongTimeout, // ✅ БЕРЁМ ИЗ CONFIG!
        },
        this.logger,
        (event: string, data: any) => this.publishEvent(event, data),
      );

      this.logger.info("HEARTBEAT_MANAGER_STARTED", {
        ping_interval_ms: pingInterval,
        pong_timeout_ms: pongTimeout,
      });

      await this.heartbeatManager.start();

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
    return this.isConnected && (this.wsManager?.isConnected() || false);
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
