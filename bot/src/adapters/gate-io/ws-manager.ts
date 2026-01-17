import WebSocket from "ws";
import { WsHeartbeat } from "./channels/heartbeat";

export interface WsManagerConfig {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
}

export enum ConnectionStatus {
  DISCONNECTED = "DISCONNECTED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  RECONNECTING = "RECONNECTING",
  FAILED = "FAILED",
}

export class WsManager {
  private config: Required<WsManagerConfig>;
  private ws: WebSocket | null = null;
  private heartbeat: WsHeartbeat | null = null;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private reconnectAttempts: number = 0;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor(config: WsManagerConfig) {
    this.config = {
      url: config.url,
      reconnectInterval: config.reconnectInterval || 5000,
      maxReconnectAttempts: config.maxReconnectAttempts || 10,
      pingInterval: config.pingInterval || 15000,
      pongTimeout: config.pongTimeout || 3000,
    };
  }

  async connect(): Promise<void> {
    if (this.status === ConnectionStatus.CONNECTED) return;
    if (this.status === ConnectionStatus.CONNECTING) return;

    this.status = ConnectionStatus.CONNECTING;

    try {
      this.ws = new WebSocket(this.config.url);
      this.ws.on("open", () => this.handleOpen());
      this.ws.on("message", (data: WebSocket.Data) => this.handleMessage(data));
      this.ws.on("error", (error: Error) => this.handleError(error));
      this.ws.on("close", (code: number, reason: Buffer) =>
        this.handleClose(code, reason)
      );
    } catch (error) {
      const err = error as Error;
      console.error("❌ WS connection error:", err.message);
      this.handleConnectionFailure();
    }
  }

  disconnect(): void {
    if (this.heartbeat) {
      this.heartbeat.stop();
      this.heartbeat = null;
    }

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, "Normal closure");
      }
      this.ws = null;
    }

    this.status = ConnectionStatus.DISCONNECTED;
    this.reconnectAttempts = 0;
  }

  send(data: any): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      const message = typeof data === "string" ? data : JSON.stringify(data);
      this.ws.send(message);
      return true;
    } catch (error) {
      return false;
    }
  }

  onMessage(channel: string, handler: (data: any) => void): void {
    this.messageHandlers.set(channel, handler);
  }

  offMessage(channel: string): void {
    this.messageHandlers.delete(channel);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === ConnectionStatus.CONNECTED;
  }

  private handleOpen(): void {
    this.status = ConnectionStatus.CONNECTED;
    this.reconnectAttempts = 0;
    this.startHeartbeat();
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Обрабатываем pong
      if (message.channel && message.channel.endsWith(".pong")) {
        if (this.heartbeat) {
          this.heartbeat.handlePongReceived();
        }

        const handler = this.messageHandlers.get(message.channel);
        if (handler) {
          handler(message);
        }
        return;
      }

      // Другие сообщения
      const handler = this.messageHandlers.get(message.channel);
      if (handler) {
        handler(message);
      }
    } catch (error) {
      // Игнорируем ошибки парсинга
    }
  }

  private handleError(error: Error): void {
    console.error("❌ WS error:", error.message);
  }

  private handleClose(code: number, reason: Buffer): void {
    if (this.heartbeat) {
      this.heartbeat.stop();
      this.heartbeat = null;
    }

    if (code !== 1000) {
      this.handleConnectionFailure();
    } else {
      this.status = ConnectionStatus.DISCONNECTED;
    }
  }

  private handleConnectionFailure(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.status = ConnectionStatus.FAILED;
      return;
    }

    this.reconnectAttempts++;
    this.status = ConnectionStatus.RECONNECTING;

    const delay = this.config.reconnectInterval * this.reconnectAttempts;

    this.reconnectTimeoutId = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    if (!this.ws) return;

    this.heartbeat = new WsHeartbeat({
      channel: this.getPingChannel(),
      pingInterval: this.config.pingInterval,
      pongTimeout: this.config.pongTimeout,
      onPongReceived: () => {},
      onPongTimeout: () => {
        this.disconnect();
        this.handleConnectionFailure();
      },
      onError: () => {},
    });

    this.heartbeat.start(this.ws);
  }

  private getPingChannel(): string {
    if (this.config.url.includes("fx-ws")) {
      return "futures.ping";
    }
    return "spot.ping";
  }
}

export default WsManager;
