import { SETTINGS } from "../config/settings";
import { YahooService } from "../services/yahooService";
import { MstockService } from "../services/mstockService";

export interface PortfolioHolding {
  symbol: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  value: number;
}

export class CEOPA {
  private static holdings: PortfolioHolding[] = [
    { symbol: "TCS.NS", qty: 10, avgPrice: 3850, currentPrice: 3850, pnl: 0, value: 38500 },
    { symbol: "RELIANCE.NS", qty: 12, avgPrice: 2450, currentPrice: 2450, pnl: 0, value: 29400 },
    { symbol: "ZYDUSLIFE.NS", qty: 8, avgPrice: 1018, currentPrice: 1018, pnl: 0, value: 8144 }
  ];

  static approveTrade(capitalRequired: number) {
    const availableCapital = SETTINGS.CAPITAL;
    // Risk management: Max 10% of capital per trade
    if (capitalRequired > availableCapital * 0.1) {
      return false;
    }
    return true;
  }

  static addTradeToPortfolio(trade: { symbol: string; entry: number; quantity: number }) {
    // Standardize symbol with NSE suffix if needed
    let sym = trade.symbol;
    if (!sym.includes(".") && !sym.includes("^")) {
      sym = `${sym}.NS`;
    }

    const existing = this.holdings.find(h => h.symbol.toUpperCase() === sym.toUpperCase());
    if (existing) {
      const newQty = existing.qty + trade.quantity;
      const newAvg = (existing.qty * existing.avgPrice + trade.quantity * trade.entry) / newQty;
      existing.qty = newQty;
      existing.avgPrice = Number(newAvg.toFixed(2));
      existing.currentPrice = trade.entry;
      existing.value = Number((existing.qty * trade.entry).toFixed(2));
      existing.pnl = Number((existing.value - (existing.qty * existing.avgPrice)).toFixed(2));
    } else {
      this.holdings.push({
        symbol: sym,
        qty: trade.quantity,
        avgPrice: trade.entry,
        currentPrice: trade.entry,
        pnl: 0,
        value: Number((trade.quantity * trade.entry).toFixed(2))
      });
    }
    console.log(`[PORTFOLIO AGENT] Added trade to portfolio: ${sym} x ${trade.quantity} @ ₹${trade.entry}`);
  }

  static async getPortfolio() {
    // Keep a copy of cash from SETTINGS
    const cash = SETTINGS.CAPITAL;
    let activeHoldings = [...this.holdings];
    let liveSource = false;

    try {
      const rawHoldings = await MstockService.getPortfolioHoldings();
      if (rawHoldings) {
        const normalized = MstockService.normalizeHoldings(rawHoldings);
        if (normalized && normalized.length > 0) {
          activeHoldings = normalized;
          liveSource = true;
        }
      }
    } catch (e: any) {
      console.error("[PORTFOLIO AGENT] Error updating portfolio from m.Stock holdings API:", e.message);
    }

    try {
      const symbols = activeHoldings.map(h => h.symbol);
      if (symbols.length > 0) {
        // Fetch fresh prices from Yahoo Finance
        const prices = await YahooService.getCurrentPrices(symbols);
        for (const h of activeHoldings) {
          const livePriceData = prices[h.symbol] || prices[h.symbol.replace(".NS", "")];
          if (livePriceData && typeof livePriceData === 'object') {
            const price = livePriceData.price || 0;
            h.currentPrice = price;
            h.value = Number((h.qty * price).toFixed(2));
            h.pnl = Number((h.value - (h.qty * h.avgPrice)).toFixed(2));
          }
        }
      }
    } catch (e) {
      console.error("[PORTFOLIO AGENT] Error updating portfolio live prices:", e);
    }

    const totalHoldingsValue = activeHoldings.reduce((sum, h) => sum + h.value, 0);
    const totalPnl = activeHoldings.reduce((sum, h) => sum + h.pnl, 0);
    const initialInvested = totalHoldingsValue - totalPnl;
    const pnlPercent = initialInvested > 0 ? (totalPnl / initialInvested) * 100 : 0;

    return {
      holdings: activeHoldings,
      summary: {
        invested: Number(initialInvested.toFixed(2)),
        totalValue: Number((totalHoldingsValue + cash).toFixed(2)),
        holdingsValue: Number(totalHoldingsValue.toFixed(2)),
        totalPnl: Number(totalPnl.toFixed(2)),
        pnlPercent: Number(pnlPercent.toFixed(2)),
        cash: cash,
        isLiveAccount: liveSource
      }
    };
  }
}
