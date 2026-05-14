import { Trade } from "../models/trade";

export class BrokerService {
  static async executeBuy(
    symbol: string,
    entry: number,
    quantity: number
  ): Promise<Trade> {
    console.log(`[BROKER] BUY ${symbol} @ ${entry}`);
    return {
      symbol,
      entry,
      quantity,
      orderId: `ORD-${Date.now()}`,
      timestamp: new Date().toISOString()
    };
  }
}
