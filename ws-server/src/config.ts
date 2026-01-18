/**
 * WS-Server Configuration
 */

import * as dotenv from 'dotenv';

dotenv.config();

export interface WsServerConfig {
  nodeEnv: 'development' | 'production';
  redis: {
    host: string;
    port: number;
  };
  websocket: {
    port: number;
    authToken: string;
    maxClients: number;
  };
}

export function loadConfig(): WsServerConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development') as 'development' | 'production';
  
  const config: WsServerConfig = {
    nodeEnv,
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    websocket: {
      port: parseInt(process.env.WS_PORT || '2808'),
      authToken: process.env.WS_AUTH_TOKEN || '',
      maxClients: 4,
    },
  };

  // Validation
  if (!config.websocket.authToken) {
    throw new Error('❌ WS_AUTH_TOKEN обязателен в .env');
  }

  return config;
}

export default loadConfig;
