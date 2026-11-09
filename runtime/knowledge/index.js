import { ObsidianClient } from "../../adapters/obsidian/obsidian-client.js";
import { loadObsidianConfig } from "../config/obsidian.js";

export function createKnowledgeClient(options = loadObsidianConfig()) {
  return new ObsidianClient(options);
}

export { ObsidianApiError, ObsidianClient } from "../../adapters/obsidian/obsidian-client.js";

