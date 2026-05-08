#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { analyzeHwpxBuffer, optimizeHwpxBufferSafe } from "@hwpx-optimizer/core";

export async function runCli(argv: string[]): Promise<number> {
  const [command, inputPath, ...rest] = argv;
  if (!command || !inputPath) {
    printUsage();
    return 1;
  }

  const options = parseOptions(rest);
  try {
    if (command === "analyze") {
      const report = await analyzeHwpxBuffer(await readFile(inputPath));
      const reportPath = options.report ?? `${inputPath}.report.json`;
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`Analyzed ${inputPath}`);
      console.log(`Report: ${reportPath}`);
      return 0;
    }

    if (command === "optimize") {
      if ((options.mode ?? "safe") !== "safe") {
        console.error("Only --mode safe is supported in v1");
        return 1;
      }
      const result = await optimizeHwpxBufferSafe(await readFile(inputPath));
      const outputPath = options.out ?? defaultOutputPath(inputPath);
      const reportPath = options.report ?? `${outputPath}.report.json`;
      await writeFile(outputPath, result.output);
      await writeFile(reportPath, JSON.stringify(result.report, null, 2));
      console.log(`Optimized ${inputPath}`);
      console.log(`Output: ${outputPath}`);
      console.log(`Report: ${reportPath}`);
      return 0;
    }

    printUsage();
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseOptions(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = args[index + 1];
    if (value && !value.startsWith("--")) {
      options[key] = value;
      index += 1;
    } else {
      options[key] = "true";
    }
  }
  return options;
}

function defaultOutputPath(inputPath: string): string {
  const name = basename(inputPath, ".hwpx");
  return join(dirname(inputPath), `${name}.optimized.hwpx`);
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  hwpx-opt analyze <file.hwpx> [--report report.json]");
  console.error("  hwpx-opt optimize <file.hwpx> --mode safe [--out output.hwpx] [--report report.json]");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli(process.argv.slice(2));
}
