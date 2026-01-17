/**
 * DTrader-5.2 Bot - TypeScript Types & Interfaces
 */

// ============================================
// CONFIG
// ============================================

export interface GateioConfig {
  apiKey: string;
  apiSecret: string;
  baseUrlRest: string;
  baseUrlWs: string;
  testNetRestUrl?: string;
  testNetWsUrl?: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface WebSocketConfig {
  pingInterval: number;
  pongTimeout: number;
}

export interface TradingConfig {
  tradingPairs: string[];
  orderbookDepth: number;
  orderbookUpdateSpeed: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'production';
  gateio: GateioConfig;
  redis: RedisConfig;
  websocket: WebSocketConfig;
  trading: TradingConfig;
}

// ============================================
// REDIS DATA STRUCTURES
// ============================================

export interface AccountBalance {
  usdt: string;
  updated_at: string;
}

export interface SystemHeartbeat {
  status: 'online' | 'offline';
  latency: string;
  updated_at: string;
}

// ============================================
// PUB/SUB MESSAGES (Style B)
// ============================================

export interface BalanceChangedMessage {
  usdt: string;
  updated_at: string;
  source: 'bot';
}

export interface HeartbeatPongMessage {
  status: 'online' | 'offline';
  latency: number;
  updated_at: string;
  source: 'bot';
}

export interface BotStoppedMessage {
  status: 'stopped';
  reason: string;
  timestamp: string;
  source: 'bot';
}

// ============================================
// GATE.IO API RESPONSES
// ============================================

export interface UnifiedAccount {
  user_id: number;
  refresh_time: number;
  locked: boolean;
  total: string;
  borrowed: string;
  total_initial_margin: string;
  total_margin_balance: string;
  total_maintenance_margin: string;
  total_initial_margin_rate: string;
  total_maintenance_margin_rate: string;
  total_available_margin: string;
  unified_account_total: string;
  unified_account_total_liab: string;
  unified_account_total_equity: string;
  leverage: string;
  spread: string;
  enable_credit: boolean;
  position_leverage: string;
  order_leverage: string;
  balances?: Record<string, any>;
}

export interface WalletBalance {
  total: {
    currency: string;
    amount: string;
  };
  details?: Record<string, any>;
}

export interface UnifiedPosition {
  user_id: number;
  contract: string;
  size: number;
  leverage: string;
  risk_limit: string;
  leverage_max: string;
  maintenance_rate: string;
  value: string;
  margin: string;
  entry_price: string;
  liq_price: string;
  mark_price: string;
  unrealised_pnl: string;
  realised_pnl: string;
  history_pnl: string;
  last_close_pnl: string;
  realised_point: string;
  history_point: string;
  adl_ranking: number;
  pending_orders: number;
  close_order: {
    id: number;
    price: string;
    is_liq: boolean;
  } | null;
  mode: string;
  cross_leverage_limit: string;
  update_time: number;
  open_time: number;
}

// ============================================
// WEBSOCKET EVENTS
// ============================================

export interface WebSocketPongData {
  time_ms?: number;
  time?: number;
  channel: string;
}

export interface WebSocketBalanceUpdate {
  channel: string;
  event: string;
  result?: any;
}

// ============================================
// LOGGING
// ============================================

export type LogLevel = 'info' | 'error' | 'debug';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  service: string;
  event: string;
  data?: any;
  error?: string;
}

// ============================================
// ERROR HANDLING
// ============================================

export class BotError extends Error {
  constructor(
    public code: string,
    public message: string,
    public context?: any
  ) {
    super(message);
    this.name = 'BotError';
  }
}

export enum ErrorCode {
  CONFIG_INVALID = 'CONFIG_INVALID',
  REDIS_CONNECT_FAILED = 'REDIS_CONNECT_FAILED',
  GATEIO_API_FAILED = 'GATEIO_API_FAILED',
  WS_CONNECT_FAILED = 'WS_CONNECT_FAILED',
  WS_PONG_TIMEOUT = 'WS_PONG_TIMEOUT',
}
