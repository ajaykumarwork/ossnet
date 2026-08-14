const express = require("express");
const { runQuery } = require("../lib/db");
const queries = require("../lib/queries");

const router = express.Router();

// GET /api/graph/path?from=dev_1&to=dev_9 — shortest KNOWS path between two developers
router.get("/path", async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "Both 'from' and 'to' developer ids are required." });
    }
    const records = await runQuery(queries.shortestConnectionPath, { fromId: from, toId: to });
    if (records.length === 0) {
      return res.json({ found: false, people: [], hops: 0 });
    }
    res.json({
      found: true,
      people: records[0].get("people"),
      hops: records[0].get("hops").toInt(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/graph/bridges?techA=Rust&techB=React — developers spanning two tech communities
router.get("/bridges", async (req, res, next) => {
  try {
    const { techA, techB } = req.query;
    if (!techA || !techB) {
      return res.status(400).json({ error: "Both 'techA' and 'techB' are required." });
    }
    const records = await runQuery(queries.bridgeDevelopers, { techA, techB });
    res.json({
      developers: records.map((r) => r.get("d").properties),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/graph/mutual-repos?from=dev_1&to=dev_9
router.get("/mutual-repos", async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "Both 'from' and 'to' developer ids are required." });
    }
    const records = await runQuery(queries.mutualRepositories, { fromId: from, toId: to });
    res.json({ repositories: records.map((r) => r.get("r").properties) });
  } catch (err) {
    next(err);
  }
});

// GET /api/graph/stats — headline counts for the empty/landing state
router.get("/stats", async (req, res, next) => {
  try {
    const records = await runQuery(queries.stats);
    const r = records[0];
    res.json({
      developers: r.get("developers").toInt(),
      repositories: r.get("repositories").toInt(),
      technologies: r.get("technologies").toInt(),
      organizations: r.get("organizations").toInt(),
      connections: r.get("connections").toInt(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
