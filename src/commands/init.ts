import { writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import { ensureDirs } from "../store.js";
import { MEMENTO_DIR, CONFIG_FILE } from "../paths.js";

export async function init(): Promise<void> {
  await ensureDirs();

  if (!existsSync(CONFIG_FILE)) {
    await writeFile(
      CONFIG_FILE,
      JSON.stringify({ watch_interval: 30, auto_snapshot: true }, null, 2)
    );
  }

  const hookPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../memento-hook.zsh"
  );
  const binDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

  console.log(`${chalk.green("✓")} Memento initialized at ${chalk.bold(MEMENTO_DIR)}`);
  console.log();
  console.log(`Add this to your ${chalk.bold("~/.zshrc")}:`);
  console.log();
  console.log(chalk.cyan(`  # Memento session tracker`));
  console.log(chalk.cyan(`  export PATH="${binDir}/node_modules/.bin:${binDir}:$PATH"`));
  console.log(chalk.cyan(`  source "${hookPath}"`));
  console.log();
  console.log(`Then restart your shell or run: ${chalk.bold("source ~/.zshrc")}`);
}
