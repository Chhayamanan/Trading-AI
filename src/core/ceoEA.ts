import { Trade } from "../models/trade";
import { CEOPA } from "./ceoPA";

export class CEOEA {
  static reportTrade(trade: Trade) {
    console.log("===== FINAL TRADE REPORT =====");
    console.log(trade);
    CEOPA.addTradeToPortfolio({
      symbol: trade.symbol,
      entry: trade.entry,
      quantity: trade.quantity
    });
  }
}
