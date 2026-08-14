// server/lib/db.js
//
// Single shared Neo4j driver instance pointed at CognoDB Cloud.
// CognoDB speaks openCypher over Bolt, so the official neo4j-driver
// package works against it unmodified.

const neo4j = require("neo4j-driver");

const URI = process.env.COGNODB_URI;
const USER = process.env.COGNODB_USER;
const PASSWORD = process.env.COGNODB_PASSWORD;

let driver = null;
let connectionError = null;

function getDriver() {
  if (driver) return driver;

  if (!URI || !USER || !PASSWORD) {
    connectionError =
      "Missing COGNODB_URI / COGNODB_USER / COGNODB_PASSWORD environment variables. " +
      "Copy .env.example to .env and fill in your CognoDB Cloud connection details.";
    console.error("[db] " + connectionError);
    return null;
  }

  try {
    driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD), {
      maxConnectionPoolSize: 20,
      connectionAcquisitionTimeout: 10000,
    });
    return driver;
  } catch (err) {
    connectionError = err.message;
    console.error("[db] Failed to create driver:", err.message);
    return null;
  }
}

// Verifies connectivity once at startup so the app can report a clear
// error instead of hanging on the first request.
async function verifyConnection() {
  const d = getDriver();
  if (!d) return { ok: false, error: connectionError };
  try {
    await d.verifyConnectivity();
    return { ok: true };
  } catch (err) {
    connectionError = err.message;
    return { ok: false, error: err.message };
  }
}

// Runs a Cypher query with parameters (never string-concatenated) inside
// a managed session, and always closes the session afterwards.
async function runQuery(cypher, params = {}, { write = false } = {}) {
  const d = getDriver();
  if (!d) {
    const err = new Error(connectionError || "Database is not configured.");
    err.code = "DB_UNAVAILABLE";
    throw err;
  }

  const session = d.session({ defaultAccessMode: write ? neo4j.session.WRITE : neo4j.session.READ });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } catch (err) {
    // Normalize common connectivity failures into one code the API layer
    // can map to a friendly 503, rather than leaking driver internals.
    if (
      err.code === "ServiceUnavailable" ||
      err.code === "SessionExpired" ||
      /ECONNREFUSED|ENOTFOUND|timeout/i.test(err.message || "")
    ) {
      const wrapped = new Error("Could not reach the CognoDB instance. Is it running?");
      wrapped.code = "DB_UNAVAILABLE";
      throw wrapped;
    }
    throw err;
  } finally {
    await session.close();
  }
}

async function closeDriver() {
  if (driver) await driver.close();
}

module.exports = { getDriver, verifyConnection, runQuery, closeDriver };
