import cors from "cors";
import express from "express";

import { RAW_UNIVERSE, MARKET_UNIVERSE } from "./services/marketDataService";
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

  app.use(cors());
  app.use(express.json());

  const PORT = Number(process.env.PORT) || 3000;

  // HEALTH CHECK
  app.get("/", (req, res) => {
    res.json({
      success: true,
      message: "Railway backend running successfully"
    });
  });

  // DATA KEEPER
  app.post("/api/data-keeper/sync", async (req, res) => {
    req.setTimeout(600000);

    try {
      const result = await DataKeeper.fetchAndStore(MARKET_UNIVERSE);

      res.json({
        success: true,
        lastSync: result.lastSync
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: String(error)
      });
    }
  });

  app.get("/api/data-keeper/status", async (req, res) => {
    try {
      const lastSync = await DataKeeper.getLastSyncTime();
      const healthy = await DataKeeper.isCacheHealthy();

      res.json({
        success: true,
        lastSync,
        healthy
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: String(error)
      });
    }
  });

  app.get("/api/data-keeper/export", async (req, res) => {
    try {
      const type = req.query.type as string;

      const cache =
        type === "intraday"
          ? await DataKeeper.getFullIntradayCache()
          : await DataKeeper.getFullCache();

      if (!cache) {
        return res.status(404).json({
          success: false,
          error: "Cache not found"
        });
      }

      res.json({
        success: true,
        cache
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: String(error)
      });
    }
  });

  // DARVAS SYSTEM
  app.get("/api/run-darvas-system", async (req, res) => {
    try {
      const multiplier = req.query.multiplier
        ? parseFloat(req.query.multiplier as string)
        : SETTINGS.VOLUME_MULTIPLIER;

      const candidates = await DarvasScanner.scan(RAW_UNIVERSE, {
        volumeMultiplier: multiplier
      });

      const { signals, liveMetrics } =
        await DarvasValidator.validate(candidates);

      const executedTrades = [];

      for (const signal of signals) {
        const authenticated =
          await DarvasAuthenticator.authenticate(signal);

        const reviewed =
          await GroupLeader.review(authenticated);

        if (!reviewed.approved) continue;

        const trade = await DarvasExecuter.execute(
          reviewed.signal.symbol,
          reviewed.signal.entry
        );

        CEOEA.reportTrade(trade);

        executedTrades.push(trade);
      }

      res.json({
        success: true,
        candidates,
        signals,
        liveMetrics,
        executedTrades
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: String(error)
      });
    }
  });

  // RS TREND
  app.get("/api/run-rs-trend-scan", async (req, res) => {
    try {
      const candidates = await DarvasScanner.scan(RAW_UNIVERSE, {
        rsTrendOnly: true
      });

      const { liveMetrics } =
        await DarvasValidator.validate(candidates);

      res.json({
        success: true,
        candidates,
        liveMetrics
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: String(error)
      });
    }
  });

  // CUSTOM SCAN
  app.post("/api/run-custom-scan", async (req, res) => {
    try {
      const { filters } = req.body;

      const candidates = await DarvasScanner.scan(
        RAW_UNIVERSE,
        { customFilters: filters }
      );

      const { liveMetrics } =
        await DarvasValidator.validate(candidates);

      res.json({
        success: true,
        candidates,
        liveMetrics
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: String(error)
      });
    }
  });

  // VOLUME SPIKE
  app.get("/api/run-volume-spike-scan", async (req, res) => {
    try {
      const factor = req.query.factor
        ? parseFloat(req.query.factor as string)
        : 3;

      const spikes =
        await VolumeSpikeScanner.scan(RAW_UNIVERSE, factor);

      res.json({
        success: true,
        spikes
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: String(error)
      });
    }
  });

  // BACKTEST
  app.get("/api/run-backtest", async (req, res) => {
    try {
      const symbols = ["^NSEI", "^NSEBANK", "^BSESN"];

      const results =
        await BacktestScanner.run(symbols);

      res.json({
        success: true,
        results
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: String(error)
      });
    }
  });

  // REVALIDATE
  app.post("/api/re-validate", async (req, res) => {
    try {
      const { candidates, multiplier } = req.body;

      const result =
        await DarvasValidator.validate(candidates, multiplier);

      res.json({
        success: true,
        ...result
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: String(error)
      });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
