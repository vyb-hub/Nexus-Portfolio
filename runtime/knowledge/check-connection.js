import { createKnowledgeClient } from "./index.js";

try {
  const client = createKnowledgeClient();
  const status = await client.status();
  const root = await client.list();

  console.log(`Connected to ${status.service}.`);
  console.log(`Authenticated: ${status.authenticated === true ? "yes" : "no"}`);
  console.log(`Vault root entries: ${root.files?.length ?? 0}`);
} catch (error) {
  console.error(`Connection check failed: ${error.message}`);
  process.exitCode = 1;
}

