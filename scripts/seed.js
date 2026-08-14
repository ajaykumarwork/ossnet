// scripts/seed.js
//
// Loads the synthetic OSSNet dataset into CognoDB. Safe to re-run:
// everything uses MERGE, so running it twice updates rather than
// duplicates. Run with: npm run seed

require("dotenv").config();
const neo4j = require("neo4j-driver");
const { generate } = require("./seed-data");

const URI = process.env.COGNODB_URI;
const USER = process.env.COGNODB_USER;
const PASSWORD = process.env.COGNODB_PASSWORD;

if (!URI || !USER || !PASSWORD) {
  console.error(
    "Missing COGNODB_URI / COGNODB_USER / COGNODB_PASSWORD.\n" +
      "Copy .env.example to .env and fill in your CognoDB Cloud connection details first."
  );
  process.exit(1);
}

async function main() {
  const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

  try {
    await driver.verifyConnectivity();
    console.log("Connected to CognoDB.");
  } catch (err) {
    console.error("Could not connect to CognoDB:", err.message);
    process.exit(1);
  }

  const session = driver.session();
  const data = generate();

  try {
    console.log("Clearing existing OSSNet data (if any)...");
    await session.run(`MATCH (n) WHERE n:Developer OR n:Technology OR n:Repository OR n:Organization DETACH DELETE n`);

    console.log("Creating uniqueness constraints...");
    await session.run(`CREATE CONSTRAINT dev_id IF NOT EXISTS FOR (d:Developer) REQUIRE d.id IS UNIQUE`);
    await session.run(`CREATE CONSTRAINT repo_id IF NOT EXISTS FOR (r:Repository) REQUIRE r.id IS UNIQUE`);
    await session.run(`CREATE CONSTRAINT org_id IF NOT EXISTS FOR (o:Organization) REQUIRE o.id IS UNIQUE`);
    await session.run(`CREATE CONSTRAINT tech_name IF NOT EXISTS FOR (t:Technology) REQUIRE t.name IS UNIQUE`);

    console.log(`Loading ${data.developers.length} developers...`);
    await session.run(
      `UNWIND $rows AS row
       MERGE (d:Developer {id: row.id})
       SET d.name = row.name, d.title = row.title, d.location = row.location,
           d.joinedYear = row.joinedYear, d.bio = row.bio`,
      { rows: data.developers }
    );

    console.log(`Loading ${data.technologies.length} technologies...`);
    await session.run(
      `UNWIND $rows AS row MERGE (t:Technology {name: row.name})`,
      { rows: data.technologies }
    );

    console.log(`Loading ${data.organizations.length} organizations...`);
    await session.run(
      `UNWIND $rows AS row
       MERGE (o:Organization {id: row.id})
       SET o.name = row.name, o.focus = row.focus`,
      { rows: data.organizations }
    );

    console.log(`Loading ${data.repositories.length} repositories...`);
    await session.run(
      `UNWIND $rows AS row
       MERGE (r:Repository {id: row.id})
       SET r.name = row.name, r.description = row.description,
           r.stars = row.stars, r.createdYear = row.createdYear`,
      { rows: data.repositories }
    );

    console.log(`Creating ${data.skilledIn.length} SKILLED_IN relationships...`);
    await session.run(
      `UNWIND $rows AS row
       MATCH (d:Developer {id: row.devId}), (t:Technology {name: row.tech})
       MERGE (d)-[s:SKILLED_IN]->(t)
       SET s.level = row.level`,
      { rows: data.skilledIn }
    );

    console.log(`Creating ${data.builtWith.length} BUILT_WITH relationships...`);
    await session.run(
      `UNWIND $rows AS row
       MATCH (r:Repository {id: row.repoId}), (t:Technology {name: row.tech})
       MERGE (r)-[:BUILT_WITH]->(t)`,
      { rows: data.builtWith }
    );

    console.log(`Creating ${data.ownedBy.length} OWNS relationships...`);
    await session.run(
      `UNWIND $rows AS row
       MATCH (o:Organization {id: row.orgId}), (r:Repository {id: row.repoId})
       MERGE (o)-[:OWNS]->(r)`,
      { rows: data.ownedBy }
    );

    console.log(`Creating ${data.memberOf.length} MEMBER_OF relationships...`);
    await session.run(
      `UNWIND $rows AS row
       MATCH (d:Developer {id: row.devId}), (o:Organization {id: row.orgId})
       MERGE (d)-[:MEMBER_OF]->(o)`,
      { rows: data.memberOf }
    );

    console.log(`Creating ${data.contributedTo.length} CONTRIBUTED_TO relationships...`);
    await session.run(
      `UNWIND $rows AS row
       MATCH (d:Developer {id: row.devId}), (r:Repository {id: row.repoId})
       MERGE (d)-[c:CONTRIBUTED_TO]->(r)
       SET c.commits = row.commits, c.role = row.role`,
      { rows: data.contributedTo }
    );

    console.log(`Creating ${data.knows.length} KNOWS relationships...`);
    await session.run(
      `UNWIND $rows AS row
       MATCH (a:Developer {id: row.aId}), (b:Developer {id: row.bId})
       MERGE (a)-[k:KNOWS]->(b)
       SET k.since = row.since`,
      { rows: data.knows }
    );

    console.log("\nSeed complete. Try these ids in the app:");
    console.log(data.developers.slice(0, 5).map((d) => `  ${d.id} — ${d.name}`).join("\n"));
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
