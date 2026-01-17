import WebSocket from "ws";

/**
 * Конфигурация для Heartbeat
 */
export interface HeartbeatConfig {
  pingInterval: number; // Интервал ping в мс
  pongTimeout: number; // Таймаут ожидания pong в мс
  channel: string; // Канал ping: "spot.ping" или "futures.ping"
  onPongReceived?: () => void;
  onPongTimeout?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Класс для управления Ping-Pong механизмом WebSocket
 */
export class WsHeartbeat {
  private ws: WebSocket | null = null;
  private config: Required<HeartbeatConfig>;
  private pingIntervalId: NodeJS.Timeout | null = null;
  private pongTimeoutId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastPongTime: number = 0;
  private waitingForPong: boolean = false;
  private pongChannel: string;

  constructor(config: HeartbeatConfig) {
    this.config = {
      pingInterval: config.pingInterval || 15000,
      pongTimeout: config.pongTimeout || 3000,
      channel: config.channel,
      onPongReceived: config.onPongReceived || (() => {}),
      onPongTimeout: config.onPongTimeout || (() => {}),
      onError: config.onError || (() => {}),
    };

    // Определяем pong канал на основе ping канала
    this.pongChannel = config.channel.replace(".ping", ".pong");
  }

  start(ws: WebSocket): void {
    if (this.isRunning) {
      console.warn("⚠️  Heartbeat уже запущен");
      return;
    }

    this.ws = ws;
    this.isRunning = true;
    this.lastPongTime = Date.now();

    console.log("💓 Heartbeat запущен");
    console.log(`   Ping канал: ${this.config.channel}`);
    console.log(`   Pong канал: ${this.pongChannel}`);
    console.log(`   Ping интервал: ${this.config.pingInterval}ms`);
    console.log(`   Pong timeout: ${this.config.pongTimeout}ms`);

    this.pingIntervalId = setInterval(() => {
      this.sendPing();
    }, this.config.pingInterval);
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log("💔 Остановка Heartbeat");

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
    this.ws = null;
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("⚠️  WebSocket не готов для ping");
      return;
    }

    try {
      const pingMessage = {
        time: Math.floor(Date.now() / 1000),
        channel: this.config.channel,
      };

      this.ws.send(JSON.stringify(pingMessage));
      console.log(`🏓 Ping отправлен (${this.config.channel})`);

      this.waitingForPong = true;
      this.startPongTimer();
    } catch (error) {
      const err = error as Error;
      console.error("❌ Ошибка отправки ping:", err.message);
      this.config.onError(err);
    }
  }

  private startPongTimer(): void {
    if (this.pongTimeoutId) {
      clearTimeout(this.pongTimeoutId);
    }

    this.pongTimeoutId = setTimeout(() => {
      if (this.waitingForPong) {
        console.error("❌ Pong timeout! Нет ответа от сервера");
        this.handlePongTimeout();
      }
    }, this.config.pongTimeout);
  }

  handlePongReceived(): void {
    if (!this.waitingForPong) {
      return;
    }

    this.waitingForPong = false;

    if (this.pongTimeoutId) {
      clearTimeout(this.pongTimeoutId);
      this.pongTimeoutId = null;
    }

    const now = Date.now();
    const latency = now - this.lastPongTime;
    this.lastPongTime = now;

    console.log(`✅ Pong получен (latency: ${latency}ms)`);
    this.config.onPongReceived();
  }

  private handlePongTimeout(): void {
    console.error("💀 Pong timeout - соединение потеряно!");
    this.config.onPongTimeout();
    this.stop();
  }

  getLastPongTime(): number {
    return this.lastPongTime;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getPongChannel(): string {
    return this.pongChannel;
  }
}

export default WsHeartbeat;
