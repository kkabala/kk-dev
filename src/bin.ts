#!/usr/bin/env node

import process from "node:process";

import { runCli } from "./cli.ts";

process.exitCode = runCli(process.argv.slice(2), console);
