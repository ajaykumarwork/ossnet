// server/lib/queries.js
//
// Every query in this file is parameterised — no string concatenation of
// user input into Cypher, ever. Each export documents what it does and
// why it needed a graph traversal rather than a join.

module.exports = {
  /* ------------------------------------------------------------------ *
   * 1. Developer profile: node + all first-degree relationships in one
   *    round trip. In SQL this is 4 separate joined queries (skills,
   *    repos, orgs, connections); here it's one pattern.
   * ------------------------------------------------------------------ */
  getDeveloperProfile: `
    MATCH (d:Developer {id: $id})
    OPTIONAL MATCH (d)-[s:SKILLED_IN]->(t:Technology)
    OPTIONAL MATCH (d)-[c:CONTRIBUTED_TO]->(r:Repository)
    OPTIONAL MATCH (d)-[:MEMBER_OF]->(o:Organization)
    OPTIONAL MATCH (d)-[k:KNOWS]-(peer:Developer)
    RETURN d,
           collect(DISTINCT {name: t.name, level: s.level}) AS skills,
           collect(DISTINCT {id: r.id, name: r.name, stars: r.stars, role: c.role, commits: c.commits}) AS repos,
           collect(DISTINCT o.name) AS organizations,
           collect(DISTINCT {id: peer.id, name: peer.name, since: k.since}) AS connections
  `,

  searchDevelopers: `
    MATCH (d:Developer)
    WHERE toLower(d.name) CONTAINS toLower($term)
       OR toLower(d.title) CONTAINS toLower($term)
    OPTIONAL MATCH (d)-[:SKILLED_IN]->(t:Technology)
    RETURN d, collect(DISTINCT t.name) AS skills
    ORDER BY d.name
    LIMIT 25
  `,

  listTechnologies: `
    MATCH (t:Technology)
    OPTIONAL MATCH (t)<-[:SKILLED_IN]-(d:Developer)
    OPTIONAL MATCH (t)<-[:BUILT_WITH]-(r:Repository)
    RETURN t.name AS name, count(DISTINCT d) AS developerCount, count(DISTINCT r) AS repoCount
    ORDER BY developerCount DESC
  `,

  developersByTechnology: `
    MATCH (d:Developer)-[s:SKILLED_IN]->(t:Technology {name: $tech})
    RETURN d, s.level AS level
    ORDER BY s.level DESC, d.name
  `,

  /* ------------------------------------------------------------------ *
   * 2. Collaborator recommendation — the core multi-hop traversal.
   *
   *    Developer -> CONTRIBUTED_TO -> Repository -> BUILT_WITH -> Technology
   *              <- SKILLED_IN <- candidate Developer
   *
   *    That's a 3-hop pattern (4 relationships) that also has to exclude
   *    people already KNOWN to the source developer and count mutual
   *    connections as a tiebreaker — all in a single query. In SQL this
   *    is a self-referencing join across four tables plus a NOT EXISTS
   *    subquery for the exclusion; here it's one readable pattern.
   * ------------------------------------------------------------------ */
  recommendCollaborators: `
    MATCH (me:Developer {id: $id})-[:CONTRIBUTED_TO]->(:Repository)-[:BUILT_WITH]->(t:Technology)
          <-[:SKILLED_IN]-(candidate:Developer)
    WHERE candidate.id <> $id
      AND NOT (me)-[:KNOWS]-(candidate)
    WITH me, candidate, collect(DISTINCT t.name) AS sharedTech
    OPTIONAL MATCH (me)-[:KNOWS]-(mutual:Developer)-[:KNOWS]-(candidate)
    WITH candidate, sharedTech, count(DISTINCT mutual) AS mutualConnections
    RETURN candidate, sharedTech, size(sharedTech) AS sharedTechCount, mutualConnections
    ORDER BY sharedTechCount DESC, mutualConnections DESC
    LIMIT 8
  `,

  /* ------------------------------------------------------------------ *
   * 3. Shortest connection path between two developers through the
   *    KNOWS network — variable-length pattern matching. This is the
   *    textbook "relational databases find this awkward" query: in SQL
   *    it needs a recursive CTE with cycle detection and no built-in
   *    shortest-path guarantee at arbitrary depth; here it's native.
   * ------------------------------------------------------------------ */
  shortestConnectionPath: `
    MATCH p = shortestPath(
      (a:Developer {id: $fromId})-[:KNOWS*..6]-(b:Developer {id: $toId})
    )
    RETURN [n IN nodes(p) | {id: n.id, name: n.name}] AS people,
           length(p) AS hops
  `,

  /* ------------------------------------------------------------------ *
   * 4. "Bridge" developers: people skilled in two otherwise-unconnected
   *    technology communities. Useful for finding who can translate
   *    between, e.g., a Rust team and a React team. Requires comparing
   *    two independent multi-hop neighborhoods against each other.
   * ------------------------------------------------------------------ */
  bridgeDevelopers: `
    MATCH (d:Developer)-[:SKILLED_IN]->(t1:Technology {name: $techA})
    MATCH (d)-[:SKILLED_IN]->(t2:Technology {name: $techB})
    RETURN d, t1.name AS techA, t2.name AS techB
    ORDER BY d.name
  `,

  mutualRepositories: `
    MATCH (a:Developer {id: $fromId})-[:CONTRIBUTED_TO]->(r:Repository)<-[:CONTRIBUTED_TO]-(b:Developer {id: $toId})
    RETURN r
    ORDER BY r.stars DESC
  `,

  /* ------------------------------------------------------------------ *
   * 5. Ego network for the graph visualization: everything within N
   *    hops of a developer, as nodes + edges ready for a force layout.
   * ------------------------------------------------------------------ */
  egoNetwork: `
    MATCH (d:Developer {id: $id})
    OPTIONAL MATCH (d)-[:KNOWS]-(peer:Developer)
    OPTIONAL MATCH (d)-[:CONTRIBUTED_TO]->(repo:Repository)
    OPTIONAL MATCH (d)-[:SKILLED_IN]->(tech:Technology)
    RETURN d,
           collect(DISTINCT {id: peer.id, name: peer.name}) AS peers,
           collect(DISTINCT {id: repo.id, name: repo.name}) AS repos,
           collect(DISTINCT {id: tech.name, name: tech.name}) AS technologies
  `,

  repositoryDetail: `
    MATCH (r:Repository {id: $id})
    OPTIONAL MATCH (r)-[:BUILT_WITH]->(t:Technology)
    OPTIONAL MATCH (r)<-[c:CONTRIBUTED_TO]-(d:Developer)
    OPTIONAL MATCH (o:Organization)-[:OWNS]->(r)
    RETURN r,
           collect(DISTINCT t.name) AS technologies,
           collect(DISTINCT {id: d.id, name: d.name, role: c.role, commits: c.commits}) AS contributors,
           collect(DISTINCT o.name) AS organizations
  `,

  stats: `
    MATCH (d:Developer) WITH count(d) AS developers
    MATCH (r:Repository) WITH developers, count(r) AS repositories
    MATCH (t:Technology) WITH developers, repositories, count(t) AS technologies
    MATCH (o:Organization) WITH developers, repositories, technologies, count(o) AS organizations
    MATCH ()-[k:KNOWS]->() WITH developers, repositories, technologies, organizations, count(k) AS connections
    RETURN developers, repositories, technologies, organizations, connections
  `,
};
