import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { RAW_UNIVERSE, MARKET_UNIVERSE, INDICES } from "./services/marketDataService";
import { DarvasScanner } from "./groups/darvas/scanner";
import { DarvasValidator } from "./groups/darvas/validator";
import { DarvasAuthenticator } from "./groups/darvas/authenticator";
import { GroupLeader } from "./core/groupLeader";
import { DarvasExecuter } from "./groups/darvas/executer";
import { CEOEA } from "./core/ceoEA";
import { SETTINGS } from "./config/settings";

import { DataKeeper } from "./core/dataKeeper";
import { VolumeSpikeScanner } from "./groups/darvas/volumeSpikeScanner";
import { BacktestScanner } from "./groups/backtest/scanner";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Data Keeper Sync Endpoint
  app.post("/api/data-keeper/sync", async (req, res) => {
    req.setTimeout(600000); // 10 mins
    try {
      const result = await DataKeeper.fetchAndStore(MARKET_UNIVERSE);
      res.json({ success: true, lastSync: result.lastSync });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get("/api/data-keeper/status", async (req, res) => {
    const lastSync = await DataKeeper.getLastSyncTime();
    const healthy = await DataKeeper.isCacheHealthy();
    res.json({ lastSync, healthy });
  });

  app.get("/api/data-keeper/export", async (req, res) => {
    try {
      const type = req.query.type as string;
      const cache = type === "intraday" 
        ? await DataKeeper.getFullIntradayCache() 
        : await DataKeeper.getFullCache();
      
      if (!cache) {
        return res.status(404).json({ success: false, error: "Cache empty or not found" });
      }

      res.json({ success: true, cache });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // API Routes
  app.post("/api/run-all-scans", async (req, res) => {
    try {
      console.log(`===== STARTING UNIFIED SCAN =====`);
      const { customFilters, multiplier, excludeSymbols = [] } = req.body;
      
      const targetUniverse = RAW_UNIVERSE.filter(s => !excludeSymbols.includes(s));
      
      const darvasCandidates = await DarvasScanner.scan(targetUniverse, { volumeMultiplier: multiplier });
      const { signals: darvasSignals, liveMetrics: darvasLiveMetrics } = await DarvasValidator.validate(darvasCandidates, multiplier);
      
      const darvasTrades = [];
      const rejections: any[] = [];
      for (const signal of darvasSignals) {
        const authenticated = await DarvasAuthenticator.authenticate(signal, multiplier);
        const reviewed = await GroupLeader.review(authenticated);
        if (!reviewed.approved) {
          rejections.push({ symbol: signal.symbol, reason: reviewed.reason });
          continue;
        }
        try {
          const trade = await DarvasExecuter.execute(reviewed.signal.symbol, reviewed.signal.entry);
          if (trade) {
            CEOEA.reportTrade(trade);
            darvasTrades.push(trade);
          }
        } catch (e: any) {
          rejections.push({ symbol: signal.symbol, reason: e.message || 'Broker execution failed' });
        }
      }
      
      const rsTrendCandidates = await DarvasScanner.scan(RAW_UNIVERSE, { rsTrendOnly: true });
      const { liveMetrics: rsLiveMetrics } = await DarvasValidator.validate(rsTrendCandidates);
      
      const customCandidates = await DarvasScanner.scan(RAW_UNIVERSE, { customFilters });
      const { liveMetrics: customLiveMetrics } = await DarvasValidator.validate(customCandidates);

      const combinedLiveMetrics = { ...darvasLiveMetrics, ...rsLiveMetrics, ...customLiveMetrics };
      
      res.json({
        success: true,
        darvas: { candidates: darvasCandidates, signals: darvasSignals, executedTrades: darvasTrades, rejections },
        rsTrend: { candidates: rsTrendCandidates },
        custom: { candidates: customCandidates },
        liveMetrics: combinedLiveMetrics
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/run-darvas-system", async (req, res) => {
    try {
      const multiplier = req.query.multiplier ? parseFloat(req.query.multiplier as string) : SETTINGS.VOLUME_MULTIPLIER;
      
      console.log(`===== STARTING DARVAS ENGINE (Vol Mult: ${multiplier}) =====`);

      // STEP 1: SCANNER
      const candidates = await DarvasScanner.scan(RAW_UNIVERSE, { volumeMultiplier: multiplier });
      
      // STEP 2: VALIDATOR
      const { signals, liveMetrics } = await DarvasValidator.validate(candidates, multiplier);
      
      const executedTrades = [];
      const rejections: any[] = [];

      for (const signal of signals) {
        // STEP 3: AUTHENTICATOR
        const authenticated = await DarvasAuthenticator.authenticate(signal, multiplier);

        // STEP 4: GROUP LEADER
        const reviewed = await GroupLeader.review(authenticated);

        if (!reviewed.approved) {
          rejections.push({ symbol: signal.symbol, reason: reviewed.reason });
          continue;
        }

        // STEP 5: EXECUTER
        try {
          const trade = await DarvasExecuter.execute(
            reviewed.signal.symbol,
            reviewed.signal.entry
          );
          if (trade) {
            CEOEA.reportTrade(trade);
            executedTrades.push(trade);
          }
        } catch (e: any) {
          rejections.push({ symbol: signal.symbol, reason: e.message || 'Broker execution failed' });
        }
      }

      res.json({
        success: true,
        candidates,
        signals,
        liveMetrics,
        executedTrades,
        rejections,
        config: { ...SETTINGS, VOLUME_MULTIPLIER: multiplier }
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/run-rs-trend-scan", async (req, res) => {
    try {
      console.log(`===== STARTING RS TREND SCAN (Scan 2) =====`);
      const candidates = await DarvasScanner.scan(RAW_UNIVERSE, { rsTrendOnly: true });
      const { liveMetrics } = await DarvasValidator.validate(candidates);
      
      res.json({
        success: true,
        candidates,
        signals: [],
        liveMetrics,
        executedTrades: [],
        config: SETTINGS
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/run-custom-scan", async (req, res) => {
    try {
      console.log(`===== STARTING CUSTOM SCAN (Scan 3) =====`);
      const { filters } = req.body;
      const candidates = await DarvasScanner.scan(RAW_UNIVERSE, { customFilters: filters });
      const { liveMetrics } = await DarvasValidator.validate(candidates);
      
      res.json({
        success: true,
        candidates,
        signals: [],
        liveMetrics,
        executedTrades: [],
        config: SETTINGS
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  app.get("/api/run-volume-spike-scan", async (req, res) => {
    try {
      console.log(`===== STARTING VOLUME SPIKE SCAN (Scan 4) =====`);
      const factor = req.query.factor ? parseFloat(req.query.factor as string) : 3;
      const spikes = await VolumeSpikeScanner.scan(RAW_UNIVERSE, factor);
      
      res.json({
        success: true,
        spikes,
        config: { ...SETTINGS, VOLUME_SPIKE_FACTOR: factor }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/run-backtest", async (req, res) => {
    try {
      console.log(`===== STARTING INDEX BACKTEST (Indices) =====`);
      const symbols = ["^NSEI", "^NSEBANK", "^BSESN"];
      const results = await BacktestScanner.run(symbols);
      
      res.json({
        success: true,
        results
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/re-validate", async (req, res) => {
    try {
      const { candidates, multiplier } = req.body;
      const result = await DarvasValidator.validate(candidates, multiplier);
      
      const executedTrades = [];
      const rejections: any[] = [];
      for (const signal of result.signals) {
        const authenticated = await DarvasAuthenticator.authenticate(signal, multiplier);
        const reviewed = await GroupLeader.review(authenticated);
        if (!reviewed.approved) {
          rejections.push({ symbol: signal.symbol, reason: reviewed.reason });
          continue;
        }
        try {
          const trade = await DarvasExecuter.execute(reviewed.signal.symbol, reviewed.signal.entry);
          if (trade) {
            CEOEA.reportTrade(trade);
            executedTrades.push(trade);
          }
        } catch (e: any) {
          rejections.push({ symbol: signal.symbol, reason: e.message || 'Broker execution failed' });
        }
      }

      res.json({ success: true, ...result, executedTrades, rejections });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
