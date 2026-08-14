const express = require("express");
const { runQuery } = require("../lib/db");
const queries = require("../lib/queries");

const router = express.Router();

function nodeProps(node) {
  return node ? node.properties : null;
}

// GET /api/developers?q=search+term
router.get("/", async (req, res, next) => {
  try {
    const term = (req.query.q || "").trim();
    if (!term) {
      const records = await runQuery(queries.listTechnologies);
      return res.json({
        mode: "technologies",
        technologies: records.map((r) => ({
          name: r.get("name"),
          developerCount: r.get("developerCount").toInt(),
          repoCount: r.get("repoCount").toInt(),
        })),
      });
    }
    const records = await runQuery(queries.searchDevelopers, { term });
    res.json({
      mode: "developers",
      developers: records.map((r) => ({
        ...nodeProps(r.get("d")),
        skills: r.get("skills"),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/developers/tech/:name — developers skilled in a given technology
router.get("/tech/:name", async (req, res, next) => {
  try {
    const records = await runQuery(queries.developersByTechnology, { tech: req.params.name });
    res.json({
      technology: req.params.name,
      developers: records.map((r) => ({ ...nodeProps(r.get("d")), level: r.get("level") })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/developers/:id — full profile
router.get("/:id", async (req, res, next) => {
  try {
    const records = await runQuery(queries.getDeveloperProfile, { id: req.params.id });
    if (records.length === 0 || !records[0].get("d")) {
      return res.status(404).json({ error: "Developer not found." });
    }
    const r = records[0];
    res.json({
      ...nodeProps(r.get("d")),
      skills: r.get("skills").filter((s) => s.name),
      repos: r.get("repos").filter((rp) => rp.id),
      organizations: r.get("organizations").filter(Boolean),
      connections: r.get("connections").filter((c) => c.id),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/developers/:id/recommendations — the multi-hop collaborator query
router.get("/:id/recommendations", async (req, res, next) => {
  try {
    const records = await runQuery(queries.recommendCollaborators, { id: req.params.id });
    res.json({
      recommendations: records.map((r) => ({
        ...nodeProps(r.get("candidate")),
        sharedTechnologies: r.get("sharedTech"),
        sharedTechCount: r.get("sharedTechCount").toInt(),
        mutualConnections: r.get("mutualConnections").toInt(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/developers/:id/network — ego network for the graph visualization
router.get("/:id/network", async (req, res, next) => {
  try {
    const records = await runQuery(queries.egoNetwork, { id: req.params.id });
    if (records.length === 0 || !records[0].get("d")) {
      return res.status(404).json({ error: "Developer not found." });
    }
    const r = records[0];
    const center = nodeProps(r.get("d"));
    const nodes = [{ id: center.id, name: center.name, kind: "Developer", center: true }];
    const edges = [];

    r.get("peers")
      .filter((p) => p.id)
      .forEach((p) => {
        nodes.push({ id: p.id, name: p.name, kind: "Developer" });
        edges.push({ source: center.id, target: p.id, type: "KNOWS" });
      });
    r.get("repos")
      .filter((rp) => rp.id)
      .forEach((rp) => {
        nodes.push({ id: rp.id, name: rp.name, kind: "Repository" });
        edges.push({ source: center.id, target: rp.id, type: "CONTRIBUTED_TO" });
      });
    r.get("technologies")
      .filter((t) => t.id)
      .forEach((t) => {
        nodes.push({ id: t.id, name: t.name, kind: "Technology" });
        edges.push({ source: center.id, target: t.id, type: "SKILLED_IN" });
      });

    res.json({ nodes, edges });
  } catch (err) {
    next(err);
  }
});

// GET /api/repositories/:id
router.get("/repo/:id", async (req, res, next) => {
  try {
    const records = await runQuery(queries.repositoryDetail, { id: req.params.id });
    if (records.length === 0 || !records[0].get("r")) {
      return res.status(404).json({ error: "Repository not found." });
    }
    const r = records[0];
    res.json({
      ...nodeProps(r.get("r")),
      technologies: r.get("technologies").filter(Boolean),
      contributors: r.get("contributors").filter((c) => c.id),
      organizations: r.get("organizations").filter(Boolean),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
