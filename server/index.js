require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { verifyConnection, closeDriver } = require("./lib/db");

const developerRoutes = require("./routes/developers");
const graphRoutes = require("./routes/graph");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Health check — also reports whether CognoDB is actually reachable,
// so the frontend can show a real error state instead of hanging.
app.get("/api/health", async (req, res) => {
  const status = await verifyConnection();
  res.status(status.ok ? 200 : 503).json(status);
});

app.use("/api/developers", developerRoutes);
app.use("/api/graph", graphRoutes);

// Centralised error handler: DB_UNAVAILABLE becomes a friendly 503,
// everything else becomes a generic 500 without leaking internals.
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === "DB_UNAVAILABLE") {
    return res.status(503).json({
      error: "Database unavailable",
      message: err.message,
    });
  }
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(PORT, async () => {
  console.log(`OSSNet running at http://localhost:${PORT}`);
  const status = await verifyConnection();
  if (status.ok) {
    console.log("[db] Connected to CognoDB.");
  } else {
    console.warn(`[db] Not connected: ${status.error}`);
    console.warn("[db] The app will run, but API calls will return 503 until this is fixed.");
  }
});

process.on("SIGINT", async () => {
  await closeDriver();
  process.exit(0);
});
