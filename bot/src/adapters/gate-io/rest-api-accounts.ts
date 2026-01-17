import axios from "axios";
import { createGateIOSignature } from "../signature";

export interface UnifiedCurrency {
  currency: string;
  available: string;
  freeze: string;
  borrowed: string;
  interest: string;
}

export interface UnifiedAccount {
  user_id: number;
  refresh_time: number;
  locked: boolean;
  balances: {
    [currency: string]: UnifiedCurrency;
  };
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
}

export interface UnifiedAccountConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  currency?: string;
}

export async function getUnifiedAccounts(
  config: UnifiedAccountConfig
): Promise<UnifiedAccount> {
  const method = "GET";
  const path = "/api/v4/unified/accounts";

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
      ? `${config.baseUrl}/api/v4/unified/accounts?${queryString}`
      : `${config.baseUrl}/api/v4/unified/accounts`;

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
