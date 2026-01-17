import axios from "axios";
import { createGateIOSignature } from "../signature";

export interface AccountBalance {
  currency: string;
  amount: string;
}

export interface TotalBalance {
  total: AccountBalance;
  details: {
    [accountType: string]: AccountBalance;
  };
}

export interface BalanceConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
}

export async function getWalletTotalBalance(
  config: BalanceConfig
): Promise<TotalBalance> {
  const method = "GET";
  const path = "/api/v4/wallet/total_balance";
  const queryString = "";
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

    const response = await axios.get(
      `${config.baseUrl}/api/v4/wallet/total_balance`,
      {
        headers: {
          ...headers,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    return response.data;
  } catch (error: any) {
    throw error;
  }
}
