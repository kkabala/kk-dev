import { productInfo } from "./product.ts";

export type CliIo = Readonly<{
  error(message: string): void;
  log(message: string): void;
}>;

const HELP = [
  "Exoframe — autonomous delivery around pstack",
  "",
  "Usage: exoframe [--help] [--version]",
  "",
  "Task commands are introduced by the Stage 1 run-state implementation.",
].join("\n");

export function runCli(args: readonly string[], io: CliIo): number {
  if (args.length === 0 || (args.length === 1 && ["--help", "-h"].includes(args[0] ?? ""))) {
    io.log(HELP);
    return 0;
  }

  if (args.length === 1 && ["--version", "-v"].includes(args[0] ?? "")) {
    io.log(productInfo().version);
    return 0;
  }

  io.error(`Unknown argument: ${args[0] ?? ""}\nRun exoframe --help for usage.`);
  return 2;
}
