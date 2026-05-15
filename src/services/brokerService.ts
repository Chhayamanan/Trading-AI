import { Trade } from "../models/trade";
import { AngelOneService } from "./angelOneService";

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
    const orderId = await AngelOneService.placeOrder(symbol, quantity);

    if (orderId && !orderId.startsWith("FAILED") && !orderId.startsWith("ERROR")) {
      this.executedToday.add(symbol);
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
