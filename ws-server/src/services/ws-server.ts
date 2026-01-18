/**
 * WebSocket Server - принимает подключения, управляет клиентами
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createClient, RedisClientType } from 'redis';
import { Logger } from '../utils/logger';

export interface WsServerConfig {
  port: number;
  authToken: string;
  maxClients: number;
}

interface ConnectedClient {
  ws: WebSocket;
  id: string;
  connectedAt: number;
}

export class WsServer {
  private wss: WebSocketServer | null = null;
  private config: WsServerConfig;
  private clients: Map<string, ConnectedClient> = new Map();
  private redisClient: RedisClientType | null = null;
  private logger: Logger;
  private clientCounter: number = 0;

  constructor(config: WsServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async start(redisClient: RedisClientType): Promise<void> {
    this.redisClient = redisClient;

    this.wss = new WebSocketServer({ port: this.config.port });

    this.wss.on('connection', (ws: WebSocket, req) => {
      this.handleConnection(ws, req);
    });

    this.wss.on('error', (error) => {
      this.logger.error('WS_SERVER_ERROR', error.message);
    });

    this.logger.info('WS_SERVER_STARTED', { port: this.config.port, max_clients: this.config.maxClients });
  }

  async stop(): Promise<void> {
    // Закрываем всех клиентов
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1000, 'Server shutdown');
      }
    });

    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.logger.info('WS_SERVER_STOPPED');
    }
  }

  private handleConnection(ws: WebSocket, req: any): void {
    // 1. Проверяем token
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (token !== this.config.authToken) {
      this.logger.warn('AUTH_FAILED', { reason: 'invalid_token' });
      ws.close(1008, 'Unauthorized');
      return;
    }

    // 2. Проверяем лимит клиентов
    if (this.clients.size >= this.config.maxClients) {
      this.logger.warn('SERVER_AT_CAPACITY', { connected: this.clients.size, max: this.config.maxClients });
      ws.close(1008, 'Server at capacity');
      return;
    }

    // 3. Регистрируем клиента
    this.clientCounter++;
    const clientId = `client_${this.clientCounter}`;
    const client: ConnectedClient = {
      ws,
      id: clientId,
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);
    this.logger.info('CLIENT_CONNECTED', { client_id: clientId, connected_count: this.clients.size });

    // 4. Отправляем current state (HGET account:balance)
    this.sendInitialState(ws);

    // 5. Обработчики сообщений
    ws.on('message', (data) => {
      // Клиент может отправлять команды (потом)
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      this.logger.info('CLIENT_DISCONNECTED', { client_id: clientId, connected_count: this.clients.size });
    });

    ws.on('error', (error) => {
      this.logger.error('WS_CLIENT_ERROR', error.message, { client_id: clientId });
    });
  }

  private async sendInitialState(ws: WebSocket): Promise<void> {
    if (!this.redisClient) return;

    try {
      const balanceData = await this.redisClient.hGetAll('account:balance');

      const message = {
        type: 'initial_state',
        data: {
          balance: Object.keys(balanceData).length > 0 ? balanceData : null,
        },
        timestamp: Date.now(),
      };

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error('SEND_INITIAL_STATE_FAILED', err.message);
    }
  }

  broadcast(message: any): void {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);

    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    });

    this.logger.info('BROADCAST_SENT', { clients_notified: this.clients.size, event: message.event || 'unknown' });
  }

  notifyRedisDisconnected(): void {
    const message = {
      type: 'error',
      event: 'REDIS_DISCONNECTED',
      message: 'Connection to data source lost',
      timestamp: Date.now(),
    };

    this.broadcast(message);
  }

  notifyRedisReconnected(): void {
    const message = {
      type: 'reconnected',
      event: 'REDIS_RECONNECTED',
      message: 'Connection restored',
      timestamp: Date.now(),
    };

    this.broadcast(message);
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export default WsServer;
