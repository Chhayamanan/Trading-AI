import fs from 'fs/promises';
import path from 'path';

const TOKENS_FILE = path.join(process.cwd(), 'src', 'data', 'tokens.json');

export class AngelOneTokenManager {
  private static tokenMap: Map<string, string> | null = null;
  private static isFetching = false;

  static async initialize() {
    if (this.tokenMap) return;
    if (this.isFetching) {
      // wait until fetched
      while (this.isFetching) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return;
    }

    this.isFetching = true;
    this.tokenMap = new Map();

    try {
      const content = await fs.readFile(TOKENS_FILE, 'utf-8');
      const data: Record<string, string> = JSON.parse(content);
      for (const [symbol, token] of Object.entries(data)) {
        this.tokenMap.set(symbol, token);
      }
      console.log(`[AngelOne] Loaded ${this.tokenMap.size} NSE tokens from static list.`);
    } catch (err) {
      console.error('[AngelOne] Failed to load tokens.json. Please run update-tokens script:', err);
    } finally {
      this.isFetching = false;
    }
  }

  static async getToken(tradingSymbol: string): Promise<string | null> {
    await this.initialize();
    return this.tokenMap?.get(tradingSymbol) || null;
  }
}
