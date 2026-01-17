import axios from "axios";
import { createGateIOSignature } from "../signature";

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

export interface UnifiedPositionsConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  currency?: string;
}

export async function getUnifiedPositions(
  config: UnifiedPositionsConfig
): Promise<UnifiedPosition[]> {
  const method = "GET";
  const path = "/api/v4/futures/usdt/positions";

  const queryParams: string[] = [];
  if (config.currency) {
    queryParams.push(`currency=${config.currency}`);
  }
  const queryString = queryParams.join("&");
  const payloadString = "";

  try {
    const headers = createGateIOSignature(
      config.apiKey,
      config.apiSecret,
      method,
      path,
      queryString,
      payloadString
    );

    const url = queryString
      ? `${config.baseUrl}/api/v4/futures/usdt/positions?${queryString}`
      : `${config.baseUrl}/api/v4/futures/usdt/positions`;

    const response = await axios.get(url, {
      headers: {
        ...headers,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    return response.data;
  } catch (error: any) {
    throw error;
  }
}
