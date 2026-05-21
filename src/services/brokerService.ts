import { Trade } from "../models/trade";
import { MstockService } from "./mstockService";

export class BrokerService {
  private static executedToday: Set<string> = new Set();
  private static lastDate: string = new Date().toDateString();

  static async executeBuy(
    symbol: string,
    entry: number,
    quantity: number = 1
  ): Promise<Trade | null> {
    const today = new Date().toDateString();
    
    // Reset cache if it's a new day
    if (today !== this.lastDate) {
      this.executedToday.clear();
      this.lastDate = today;
    }

    if (this.executedToday.has(symbol)) {
      console.log(`[BROKER] Skipping ${symbol} - Already traded today.`);
      return null;
    }

    console.log(`[BROKER] Requesting BUY ${symbol} @ ${entry} QTY: ${quantity}`);
    const orderId = await MstockService.placeOrder(symbol, quantity, entry);

    if (orderId && typeof orderId === 'string' && !orderId.startsWith("FAILED") && !orderId.startsWith("ERROR")) {
      this.executedToday.add(symbol);
    } else {
      console.log(`[BROKER] Trade failed for ${symbol}: ${orderId}`);
      throw new Error(`Broker API: ${orderId}`);
    }

    return {
      symbol,
      entry,
      quantity,
      orderId: orderId,
      timestamp: new Date().toISOString()
    };
  }
}
