import process from "node:process";

export function loadObsidianConfig(env = process.env) {
  const apiKey = env.NEXUS_OBSIDIAN_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NEXUS_OBSIDIAN_API_KEY is not set. Copy .env.example and export the value without committing it."
    );
  }

  return {
    apiKey,
    baseUrl: env.NEXUS_OBSIDIAN_BASE_URL ?? "https://127.0.0.1:27124",
    caCertPath: env.NEXUS_OBSIDIAN_CA_CERT || undefined,
    allowSelfSigned: env.NEXUS_OBSIDIAN_ALLOW_SELF_SIGNED === "true"
  };
}

