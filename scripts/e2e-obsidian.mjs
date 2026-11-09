import { createKnowledgeClient } from "../runtime/knowledge/index.js";

const client = createKnowledgeClient();
const stamp = Date.now();
const path = `01-Inbox/Nexus-MCP-E2E-${stamp}.md`;
const uniquePhrase = `nexus-e2e-validation-${stamp}`;
const results = {};

try {
  await client.write(path, `# Nexus E2E Validation\n\nUnique phrase: ${uniquePhrase}\n`);
  results.create = "PASS";

  const readBack = await client.read(path);
  results.read = readBack.includes(uniquePhrase) ? "PASS" : `FAIL (content mismatch: ${readBack})`;

  const meta = await client.metadata(path);
  results.metadata = meta && meta.path === path ? "PASS" : `FAIL (${JSON.stringify(meta)})`;

  await client.update(path, `# Nexus E2E Validation\n\nUnique phrase: ${uniquePhrase}\n\nUpdated: yes\n`);
  const updated = await client.read(path);
  results.update = updated.includes("Updated: yes") ? "PASS" : `FAIL (${updated})`;

  const searchResults = await client.search(uniquePhrase);
  const found = Array.isArray(searchResults) && searchResults.some((r) => r.filename === path);
  results.search = found ? "PASS" : `FAIL (${JSON.stringify(searchResults)})`;

  await client.delete(path);
  results.delete = "PASS";

  let deleted = false;
  try {
    await client.read(path);
  } catch (error) {
    if (error.status === 404) {
      deleted = true;
    } else {
      throw error;
    }
  }
  results.deletionVerified = deleted ? "PASS" : "FAIL (note still readable)";
} catch (error) {
  results.error = `${error.name ?? "Error"}: ${error.message}`;
}

const failed = Object.values(results).some((v) => typeof v === "string" && v.startsWith("FAIL"))
  || Object.prototype.hasOwnProperty.call(results, "error");

console.log(JSON.stringify({ path, uniquePhrase, results }, null, 2));
if (failed) process.exitCode = 1;
