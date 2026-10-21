import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RecallDatabase } from "@recall/database";
import { createRecallServer } from "./server";
import { RecallSynchronizer } from "./synchronizer";

interface Options {
  vaultPath: string;
  databasePath: string;
  port: number;
}

function defaultDataDirectory(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Obsidian Recall");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Obsidian Recall");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "obsidian-recall");
}

function parseOptions(arguments_: string[]): Options {
  let vaultPath = "";
  let databasePath = path.join(defaultDataDirectory(), "recall.sqlite");
  let port = 45871;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--vault" && value) {
      vaultPath = path.resolve(value);
      index += 1;
    } else if (argument === "--database" && value) {
      databasePath = path.resolve(value);
      index += 1;
    } else if (argument === "--port" && value) {
      port = Number(value);
      index += 1;
    }
  }

  if (!vaultPath) {
    throw new Error("Usage: npm run start -- --vault /absolute/path/to/ObsidianVault [--database path] [--port 45871]");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }
  return { vaultPath, databasePath, port };
}

const options = parseOptions(process.argv.slice(2));
await mkdir(path.dirname(options.databasePath), { recursive: true });

const database = new RecallDatabase(options.databasePath);
const synchronizer = new RecallSynchronizer(options.vaultPath, database);

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(moduleDirectory, "../../review-web");
const server = createRecallServer({
  database,
  synchronizer,
  webRoot,
  vaultName: path.basename(options.vaultPath),
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(options.port, "127.0.0.1", () => resolve());
});

console.log(`Obsidian Recall is indexing ${options.vaultPath}`);
console.log(`Inspector: http://127.0.0.1:${options.port}`);
console.log(`Database: ${options.databasePath}`);

await synchronizer.start();

function stop(): void {
  synchronizer.stop();
  server.closeAllConnections();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
