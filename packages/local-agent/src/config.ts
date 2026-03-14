import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface AgentConfig {
  apiUrl: string;
  agentToken: string;
  name: string;
  workspaceRoot: string;
}

const CONFIG_DIR = join(homedir(), ".catapult");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function loadConfig(): AgentConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as AgentConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: AgentConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
