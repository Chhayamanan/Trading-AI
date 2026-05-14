export interface RSScore {
  symbol: string;
  rpi90: number;
  rpi60: number;
  rpi30: number;
  rpi10: number;
  benchSymbol: string;
}

export class RSAgent {
  static calculateReturn(prices: number[], days: number): number {
    if (prices.length < 2) return 0;
    const endPrice = prices[prices.length - 1];
    const startIndex = Math.max(0, prices.length - 1 - days);
    const startPrice = prices[startIndex];
    if (!startPrice) return 0;
    return ((endPrice - startPrice) / startPrice) * 100;
  }

  static calculateRS(stockPrices: number[], indexPrices: number[], days: number): number {
    const stockRet = this.calculateReturn(stockPrices, days);
    const indexRet = this.calculateReturn(indexPrices, days);
    
    // If index price is flat or data missing, return 0 to avoid confusing the user with 99
    if (Math.abs(indexRet) < 0.001) return 0;
    
    return stockRet / indexRet;
  }

  static analyze(symbol: string, stockData: any, indexData: any, indexSymbol: string): RSScore {
    const stockCloses = stockData.map((c: any) => c.close);
    const indexCloses = indexData.map((c: any) => c.close);

    return {
      symbol,
      benchSymbol: indexSymbol,
      rpi90: parseFloat(this.calculateRS(stockCloses, indexCloses, 90).toFixed(2)),
      rpi60: parseFloat(this.calculateRS(stockCloses, indexCloses, 60).toFixed(2)),
      rpi30: parseFloat(this.calculateRS(stockCloses, indexCloses, 30).toFixed(2)),
      rpi10: parseFloat(this.calculateRS(stockCloses, indexCloses, 10).toFixed(2)),
    };
  }
}
