import { Trade } from "../models/trade";

export class CEOEA {
  static reportTrade(trade: Trade) {
    console.log("===== FINAL TRADE REPORT =====");
    console.log(trade);
  }
}
