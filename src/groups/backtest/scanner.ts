import { DataKeeper } from "../../core/dataKeeper";

export interface Trade {
  type: 'BUY' | 'SELL';
  entryTime: string;
  entryPrice: number;
  exitTime?: string;
  exitPrice?: number;
  pnl?: number;
  status: 'OPEN' | 'TARGET' | 'SL' | 'EXPIRED';
}

export interface BacktestResult {
  symbol: string;
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  trades: Trade[];
}

export class BacktestScanner {
  static async run(symbols: string[]): Promise<BacktestResult[]> {
    const results: BacktestResult[] = [];

    for (const symbol of symbols) {
      try {
        const intraday = await DataKeeper.getIntradayData(symbol);
        if (!intraday || intraday.length < 10) continue;

        const trades: Trade[] = [];
        
        // Pattern Matching
        for (let i = 1; i < intraday.length - 20; i++) {
          const c1 = intraday[i - 1];
          const c2 = intraday[i];

          // BUY Pattern
          const isC1Buy = this.isValidBuyCandle(c1);
          const isC2Buy = this.isValidBuyCandle(c2);

          if (isC1Buy && isC2Buy) {
            const entryPrice = c2.close;
            const entryTime = new Date(c2.date).toLocaleString();
            const trade = this.simulateTrade(intraday, i + 1, entryPrice, entryTime, 'BUY');
            trades.push(trade);
            // Skip forward slightly to not overlap trades if we want (optional)
            // i += 5; 
            continue;
          }

          // SELL Pattern
          const isC1Sell = this.isValidSellCandle(c1);
          const isC2Sell = this.isValidSellCandle(c2);

          if (isC1Sell && isC2Sell) {
            const entryPrice = c2.close;
            const entryTime = new Date(c2.date).toLocaleString();
            const trade = this.simulateTrade(intraday, i + 1, entryPrice, entryTime, 'SELL');
            trades.push(trade);
            // i += 5;
            continue;
          }
        }

        const wins = trades.filter(t => (t.pnl || 0) > 0).length;
        results.push({
          symbol,
          totalTrades: trades.length,
          winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
          totalPnl: trades.reduce((sum, t) => sum + (t.pnl || 0), 0),
          trades
        });
      } catch (err) {
        console.error(`[BACKTEST] Error processing ${symbol}:`, err);
        continue;
      }
    }

    return results;
  }

  private static isValidBuyCandle(c: any): boolean {
    if (c.close <= c.open) return false; // Must be green
    const upperShadow = ((c.high - c.close) / c.close) * 100;
    const lowerShadow = ((c.open - c.low) / c.open) * 100;
    return upperShadow <= 0.05 && lowerShadow <= 0.05;
  }

  private static isValidSellCandle(c: any): boolean {
    if (c.close >= c.open) return false; // Must be red
    const upperShadow = ((c.high - c.open) / c.open) * 100;
    const lowerShadow = ((c.close - c.low) / c.close) * 100;
    return upperShadow <= 0.05 && lowerShadow <= 0.05;
  }

  private static simulateTrade(data: any[], startIndex: number, entryPrice: number, entryTime: string, type: 'BUY' | 'SELL'): Trade {
    const target = entryPrice * (type === 'BUY' ? 1.01 : 0.99);
    const sl = entryPrice * (type === 'BUY' ? 0.995 : 1.005);
    
    for (let j = startIndex; j < data.length; j++) {
      const candle = data[j];
      
      if (type === 'BUY') {
        if (candle.high >= target) {
          return { type, entryTime, entryPrice, exitTime: new Date(candle.date).toLocaleString(), exitPrice: target, pnl: 1, status: 'TARGET' };
        }
        if (candle.low <= sl) {
          return { type, entryTime, entryPrice, exitTime: new Date(candle.date).toLocaleString(), exitPrice: sl, pnl: -0.5, status: 'SL' };
        }
      } else {
        if (candle.low <= target) {
          return { type, entryTime, entryPrice, exitTime: new Date(candle.date).toLocaleString(), exitPrice: target, pnl: 1, status: 'TARGET' };
        }
        if (candle.high >= sl) {
          return { type, entryTime, entryPrice, exitTime: new Date(candle.date).toLocaleString(), exitPrice: sl, pnl: -0.5, status: 'SL' };
        }
      }
    }

    // Trade expired at end of data
    const lastPrice = data[data.length - 1].close;
    const pnl = type === 'BUY' 
      ? ((lastPrice - entryPrice) / entryPrice) * 100 
      : ((entryPrice - lastPrice) / entryPrice) * 100;
      
    return { 
      type, 
      entryTime, 
      entryPrice, 
      exitTime: new Date(data[data.length - 1].date).toLocaleString(), 
      exitPrice: lastPrice, 
      pnl, 
      status: 'OPEN' 
    };
  }
}
