import fs from "fs/promises";
import path from "path";
import { YahooService } from "../services/yahooService";

const STORAGE_PATH = path.join(process.cwd(), "market_cache.json");
const INTRADAY_STORAGE_PATH = path.join(process.cwd(), "market_intraday_cache.json");

export interface CachedData {
  lastSync: number;
  data: Record<string, any>;
}

export class DataKeeper {
  private static memoryCache: CachedData | null = null;
  private static memoryIntradayCache: CachedData | null = null;
  private static lastCacheLoad = 0;
  private static lastIntradayLoad = 0;

  static async fetchAndStore(symbols: string[]) {
    // Unique symbols only
    const uniqueSymbols = [...new Set(symbols)];
    console.log(`[DATA KEEPER] Starting synchronization for ${uniqueSymbols.length} unique symbols...`);
    
    const currentCache = await this.readCache();
    const currentIntraday = await this.readIntradayCache();

    const cache: CachedData = {
      lastSync: Date.now(),
      data: currentCache?.data || {}
    };

    const intradayCache: CachedData = {
      lastSync: Date.now(),
      data: currentIntraday?.data || {}
    };

    const BATCH_SIZE = 25;
    for (let i = 0; i < uniqueSymbols.length; i += BATCH_SIZE) {
      const batch = uniqueSymbols.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (symbol) => {
        try {
          // Standard Daily Data
          const candles = await YahooService.get90DayData(symbol);
          cache.data[symbol] = candles;

          console.log(`[DATA KEEPER] Updated ${symbol} (${i + batch.indexOf(symbol) + 1}/${uniqueSymbols.length})`);
        } catch (err) {
          console.error(`[DATA KEEPER] Failed to fetch ${symbol}:`, err);
        }
      }));
      
      // Small delay to be nice to Yahoo
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Save only once at the end to avoid massive I/O
    console.log(`[DATA KEEPER] Saving cache to disk...`);
    await fs.writeFile(STORAGE_PATH, JSON.stringify(cache));
    await fs.writeFile(INTRADAY_STORAGE_PATH, JSON.stringify(intradayCache));

    this.memoryCache = cache;
    this.lastCacheLoad = Date.now();
    this.memoryIntradayCache = intradayCache;
    this.lastIntradayLoad = Date.now();

    console.log(`[DATA KEEPER] Synchronization complete.`);
    return cache;
  }

  static async getData(symbol: string) {
    const cache = await this.readCache();
    if (!cache || !cache.data[symbol]) return null;
    
    return cache.data[symbol];
  }

  static async getIntradayData(symbol: string) {
    const cache = await this.readIntradayCache();
    if (!cache || !cache.data[symbol]) return null;
    
    return cache.data[symbol];
  }

  static async getLastSyncTime() {
    const cache = await this.readCache();
    return cache ? cache.lastSync : 0;
  }

  static async isCacheHealthy() {
    const lastSync = await this.getLastSyncTime();
    if (!lastSync) return false;
    
    const twelveHours = 12 * 60 * 60 * 1000;
    return (Date.now() - lastSync) < twelveHours;
  }

  static async getFullCache() {
    return this.readCache();
  }

  static async getFullIntradayCache() {
    return this.readIntradayCache();
  }

  private static async readCache(): Promise<CachedData | null> {
    const now = Date.now();
    if (this.memoryCache && (now - this.lastCacheLoad < 300000)) return this.memoryCache;
    try {
      const content = await fs.readFile(STORAGE_PATH, "utf-8");
      this.memoryCache = JSON.parse(content);
      this.lastCacheLoad = now;
      return this.memoryCache;
    } catch (err) {
      return null;
    }
  }

  private static async readIntradayCache(): Promise<CachedData | null> {
    const now = Date.now();
    if (this.memoryIntradayCache && (now - this.lastIntradayLoad < 300000)) return this.memoryIntradayCache;
    try {
      const content = await fs.readFile(INTRADAY_STORAGE_PATH, "utf-8");
      this.memoryIntradayCache = JSON.parse(content);
      this.lastIntradayLoad = now;
      return this.memoryIntradayCache;
    } catch (err) {
      return null;
    }
  }
}
