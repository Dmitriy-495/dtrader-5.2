/**
 * WebSocket Manager - управление соединением с Gate.io
 */

import WebSocket from 'ws';

export interface WebSocketConfig {
  url: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
}

export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  FAILED = 'FAILED',
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private reconnectAttempts: number = 0;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor(config: WebSocketConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.status === ConnectionStatus.CONNECTED) return;
    if (this.status === ConnectionStatus.CONNECTING) return;

    this.status = ConnectionStatus.CONNECTING;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.on('open', () => {
          this.status = ConnectionStatus.CONNECTED;
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error: Error) => {
          if (this.status === ConnectionStatus.CONNECTING) {
            reject(error);
          }
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.handleClose(code, reason);
        });

        setTimeout(() => {
          if (this.status === ConnectionStatus.CONNECTING) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Normal closure');
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
      const message = typeof data === 'string' ? data : JSON.stringify(data);
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

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Маршрутизируем по канальу
      if (message.channel) {
        const handler = this.messageHandlers.get(message.channel);
        if (handler) {
          handler(message);
        }
      }
    } catch (error) {
      // Игнорируем ошибки парсинга
    }
  }

  private handleClose(code: number, reason: Buffer): void {
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
      this.connect().catch(() => {
        // Retry handled in connect
      });
    }, delay);
  }
}

export default WebSocketManager;
