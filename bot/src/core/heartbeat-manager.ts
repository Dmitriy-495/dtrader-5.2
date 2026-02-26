/**
 * Heartbeat Manager - управление ping-pong механизмом
 * FIX: Используем spot.ping для Unified API (не futures.ping!)
 * FIX: Добавляем UNIQUE ID каждому ping'у для отслеживания
 * FIX: Рекурсивный setTimeout вместо setInterval (правильный timing!)
 */

import { WebSocketManager } from "../adapters/gate-io/websocket-manager";
import { Logger } from "../utils/logger";

export interface HeartbeatConfig {
  pingInterval: number;
  pongTimeout: number;
}

export interface HeartbeatStats {
  totalPings: number;
  successfulPongs: number;
  failedPongs: number;
  lastLatency: number | null;
  lastPongTime: number | null;
  status: "online" | "offline";
}

export class HeartbeatManager {
  private wsManager: WebSocketManager;
  private config: HeartbeatConfig;
  private logger: Logger;
  private pingLoopId: NodeJS.Timeout | null = null; // ← Рекурсивный setTimeout
  private pongTimeoutId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private currentPingId: number = 0; // ← UNIQUE ID каждого пинга
  private pendingPingTimestamp: number = 0;
  private stats: HeartbeatStats = {
    totalPings: 0,
    successfulPongs: 0,
    failedPongs: 0,
    lastLatency: null,
    lastPongTime: null,
    status: "online",
  };
  private messageCallback: (event: string, data: any) => Promise<void>;
  private retryAttempt: number = 0;
  private maxRetries: number = 3;
  private retryDelays: number[] = [1000, 2000, 4000];

  constructor(
    wsManager: WebSocketManager,
    config: HeartbeatConfig,
    logger: Logger,
    messageCallback: (event: string, data: any) => Promise<void>,
  ) {
    this.wsManager = wsManager;
    this.config = config;
    this.logger = logger;
    this.messageCallback = messageCallback;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.pendingPingTimestamp = Date.now();
    this.currentPingId = 0;

    this.logger.info("HEARTBEAT_STARTED", {
      ping_interval: this.config.pingInterval,
      pong_timeout: this.config.pongTimeout,
      channel: "spot.ping (Unified API)",
      strategy: "recursive_setTimeout (accurate timing)",
    });

    // Подписываемся на pong события (UNIFIED API использует spot.pong!)
    this.wsManager.onMessage("spot.pong", (data) => {
      this.handlePong(data);
    });

    // 🔥 РЕКУРСИВНЫЙ setTimeout вместо setInterval!
    // Это обеспечивает ТОЧНЫЙ интервал между ОТПРАВКАМИ
    // независимо от времени обработки ответов!
    this.startPingLoop();
  }

  stop(): void {
    if (!this.isRunning) return;

    this.logger.info("HEARTBEAT_STOPPED");

    if (this.pingLoopId) {
      clearTimeout(this.pingLoopId);
      this.pingLoopId = null;
    }

    if (this.pongTimeoutId) {
      clearTimeout(this.pongTimeoutId);
      this.pongTimeoutId = null;
    }

    this.isRunning = false;
  }

  /**
   * 🔥 РЕКУРСИВНЫЙ PING LOOP
   * Отправляет пинг и планирует следующий через точный интервал
   */
  private startPingLoop(): void {
    if (!this.isRunning) return;

    // Отправляем текущий ping
    this.sendPing();

    // 🔥 КЛЮЧЕВОЕ: Планируем СЛЕДУЮЩИЙ ping через ТОЧНЫЙ интервал
    // независимо от того, когда пришёл ответ!
    this.pingLoopId = setTimeout(() => {
      this.startPingLoop(); // ← РЕКУРСИЯ!
    }, this.config.pingInterval);
  }

  private sendPing(): void {
    if (!this.wsManager.isConnected()) {
      this.logger.warn("PING_SKIPPED_NOT_CONNECTED");
      return;
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);

      // 🔥 УНИКАЛЬНЫЙ ID для каждого ping'а!
      this.currentPingId++;
      const pingId = this.currentPingId;

      // ✅ ПРАВИЛЬНЫЙ ФОРМАТ для Unified API Gate.io
      const pingMessage = {
        time: timestamp,
        channel: "spot.ping",
      };

      const sent = this.wsManager.send(pingMessage);

      if (sent) {
        this.stats.totalPings++;
        this.pendingPingTimestamp = Date.now();
        this.retryAttempt = 0;

        // 🔥 ДЕТАЛЬНЫЙ TIMING ЛОГИРОВАНИЕ
        const now = new Date(this.pendingPingTimestamp);
        const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${now.getMilliseconds().toString().padStart(3, "0")}`;

        this.logger.info("PING_SENT_DETAILED", {
          ping_number: this.stats.totalPings,
          ping_id: pingId,
          sent_at: timeStr,
          sent_at_ms: this.pendingPingTimestamp,
          timestamp,
          channel: "spot.ping",
        });

        this.startPongTimer(pingId);
      } else {
        this.logger.warn("PING_SEND_FAILED", {
          ping_id: pingId,
        });
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error("PING_ERROR", err.message);
    }
  }

  private startPongTimer(pingId: number): void {
    // Очищаем старый таймер
    if (this.pongTimeoutId) {
      clearTimeout(this.pongTimeoutId);
    }

    // Запускаем новый таймер с привязкой к pingId
    this.pongTimeoutId = setTimeout(() => {
      // ✅ Проверяем что это timeout для ТЕКУЩЕГО ping'а
      if (this.currentPingId === pingId) {
        this.handlePongTimeout(pingId);
      } else {
        this.logger.warn("PONG_TIMEOUT_IGNORED_WRONG_ID", {
          expected_ping_id: this.currentPingId,
          received_ping_id: pingId,
        });
      }
    }, this.config.pongTimeout);
  }

  private handlePong(data: any): void {
    // ✅ Проверяем что это pong для ТЕКУЩЕГО ожидаемого ping'а
    if (this.currentPingId === 0) {
      this.logger.warn("PONG_RECEIVED_NO_PENDING_PING", {
        pong_time: data.time,
      });
      return;
    }

    // Очищаем таймер
    if (this.pongTimeoutId) {
      clearTimeout(this.pongTimeoutId);
      this.pongTimeoutId = null;
    }

    const now = Date.now();
    const latency = now - this.pendingPingTimestamp;

    this.stats.successfulPongs++;
    this.stats.lastLatency = latency;
    this.stats.lastPongTime = now;
    this.stats.status = "online";
    this.retryAttempt = 0;

    // 🔥 ДЕТАЛЬНЫЙ TIMING ЛОГИРОВАНИЕ
    const nowDate = new Date(now);
    const sentDate = new Date(this.pendingPingTimestamp);
    const receivedTimeStr = `${nowDate.getHours().toString().padStart(2, "0")}:${nowDate.getMinutes().toString().padStart(2, "0")}:${nowDate.getSeconds().toString().padStart(2, "0")}.${nowDate.getMilliseconds().toString().padStart(3, "0")}`;
    const sentTimeStr = `${sentDate.getHours().toString().padStart(2, "0")}:${sentDate.getMinutes().toString().padStart(2, "0")}:${sentDate.getSeconds().toString().padStart(2, "0")}.${sentDate.getMilliseconds().toString().padStart(3, "0")}`;

    this.logger.info("PONG_RECEIVED_DETAILED", {
      pong_number: this.stats.successfulPongs,
      ping_id: this.currentPingId,
      sent_at: sentTimeStr,
      sent_at_ms: this.pendingPingTimestamp,
      received_at: receivedTimeStr,
      received_at_ms: now,
      latency_ms: latency,
      total_pings: this.stats.totalPings,
      pong_time: data.time,
    });

    // ✅ НЕ сбрасываем ID! Пусть инкрементируется при следующем ping'е

    // Публикуем событие
    this.publishPongEvent(latency);

    // Если были failed - публикуем recovery
    if (this.stats.failedPongs > 0) {
      this.publishRecoveryEvent();
      this.stats.failedPongs = 0;
    }
  }

  private handlePongTimeout(pingId: number): void {
    this.stats.failedPongs++;
    this.stats.status = "offline";

    this.logger.warn("PONG_TIMEOUT", {
      ping_id: pingId,
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

      this.logger.info("HEARTBEAT_RETRY", {
        ping_id: pingId,
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
      this.logger.warn("HEARTBEAT_RETRY_EXHAUSTED", {
        ping_id: pingId,
        max_retries: this.maxRetries,
      });
    }
  }

  private publishPongEvent(latency: number): void {
    this.messageCallback("event:heartbeat:pong", {
      status: "online",
      latency,
      ping_id: this.currentPingId,
      pong_number: this.stats.successfulPongs,
      updated_at: Date.now().toString(),
      source: "bot",
    }).catch((error) => {
      const err = error as Error;
      this.logger.error("PUBLISH_PONG_FAILED", err.message);
    });
  }

  private publishFailedEvent(): void {
    this.messageCallback("event:heartbeat:failed", {
      status: "offline",
      reason: "pong_timeout",
      timestamp: Date.now().toString(),
      source: "bot",
    }).catch((error) => {
      const err = error as Error;
      this.logger.error("PUBLISH_FAILED_FAILED", err.message);
    });
  }

  private publishRecoveryEvent(): void {
    this.messageCallback("event:heartbeat:recovered", {
      status: "online",
      recovered_at: Date.now().toString(),
      source: "bot",
    }).catch((error) => {
      const err = error as Error;
      this.logger.error("PUBLISH_RECOVERED_FAILED", err.message);
    });
  }

  getStats(): HeartbeatStats {
    return { ...this.stats };
  }

  isHealthy(): boolean {
    return this.stats.status === "online";
  }
}

export default HeartbeatManager;
