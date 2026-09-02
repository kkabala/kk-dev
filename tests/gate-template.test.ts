import assert from "node:assert/strict";
import test from "node:test";

import {
  GATE_CLASSES,
  isResolvedProtectedCommand,
  parseGateTemplate,
  parseGateTemplateCatalog,
  resolveProtectedTemplate,
} from "../src/index.ts";
import type {
  GateTemplate,
  ProtectedTemplateRequest,
  ResolvedProtectedCommand,
} from "../src/index.ts";

const ordersExportTemplate = {
  schema_version: 1,
  id: "g2.orders-export",
  gate_class: "G2",
  command: {
    argv: ["npm", "test", "--", "tests/acceptance/orders-export.test.ts"],
  },
  timeout_seconds: 300,
  network: "none",
  writable_roots: ["tmp"],
  result_schema: "schemas/orders-export-result.json",
  artifact_allowlist: ["screenshots/**", "traces/**"],
} as const;

const engineeringLintTemplate = {
  schema_version: 1,
  id: "g1.lint",
  gate_class: "G1",
  command: {
    argv: ["npm", "run", "lint"],
  },
  timeout_seconds: 120,
  network: "none",
  writable_roots: [],
  result_schema: "schemas/g1-lint-result.json",
  artifact_allowlist: [],
} as const;

const catalog = {
  schema_version: 1,
  templates: [ordersExportTemplate, engineeringLintTemplate],
} as const;

function jsonRoundTrip<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function rawCommandError(): {
  name: "TypeError";
  message: "Raw command is not allowed";
} {
  return {
    name: "TypeError",
    message: "Raw command is not allowed",
  };
}

if (false) {
  const stringCommand = {
    ...ordersExportTemplate,
    command: "npm test -- tests/acceptance/orders-export.test.ts",
  } as const;
  // @ts-expect-error protected templates cannot store shell command text
  const invalidStringCommand: GateTemplate = stringCommand;
  void invalidStringCommand;

  const requestWithArgv = {
    gate_id: "g2.orders-export",
    argv: ["npm", "test"],
  } as const;
  // @ts-expect-error callers cannot supply argv when selecting a gate
  const invalidRequest: ProtectedTemplateRequest = requestWithArgv;
  void invalidRequest;

  const shellCommand = {
    argv: ["npm", "test"],
    shell: true,
  } as const;
  // @ts-expect-error command objects cannot enable a shell
  const invalidShellCommand: GateTemplate["command"] = shellCommand;
  void invalidShellCommand;
}

test("the gate-template schema accepts protected argv definitions and rejects raw command text", () => {
  const parsed = parseGateTemplate(ordersExportTemplate);

  assert.deepEqual(parsed, ordersExportTemplate);
  assert.deepEqual(jsonRoundTrip(parsed), ordersExportTemplate);
  assert.equal(parsed.gate_class, GATE_CLASSES.G2);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.command), true);
  assert.equal(Object.isFrozen(parsed.command.argv), true);
  assert.deepEqual(Object.keys(parsed), [
    "schema_version",
    "id",
    "gate_class",
    "command",
    "timeout_seconds",
    "network",
    "writable_roots",
    "result_schema",
    "artifact_allowlist",
  ]);
  assert.deepEqual(Object.keys(parsed.command), ["argv"]);

  const rawTemplates = [
    {
      ...ordersExportTemplate,
      command: "npm test -- tests/acceptance/orders-export.test.ts",
    },
    {
      ...ordersExportTemplate,
      command: {
        argv: ["npm", "test"],
        shell: true,
      },
    },
    {
      ...ordersExportTemplate,
      command: {
        shell: "npm test -- tests/acceptance/orders-export.test.ts",
      },
    },
    {
      ...ordersExportTemplate,
      cmd: "npm test",
    },
    {
      ...ordersExportTemplate,
      command: {
        argv: "npm test -- tests/acceptance/orders-export.test.ts",
      },
    },
    {
      ...ordersExportTemplate,
      command: {
        argv: ["bash", "-c", "npm test"],
      },
    },
    {
      ...ordersExportTemplate,
      command: {
        argv: ["npm", "test", "--cmd", "rm -rf /"],
      },
    },
    {
      ...ordersExportTemplate,
      command: {
        argv: ["npm", "test", "--", "$HOME/tests/export.test.ts"],
      },
    },
    {
      ...ordersExportTemplate,
      command: {
        argv: ["npm", "test", "--", "`id`"],
      },
    },
  ];

  for (const rawTemplate of rawTemplates) {
    assert.throws(
      () => parseGateTemplate(rawTemplate),
      rawCommandError(),
      "raw or caller-shaped commands must not become protected templates",
    );
  }
});

test("the resolver selects a base template by gate ID and cannot mint authority from caller argv", () => {
  const resolved = resolveProtectedTemplate(catalog, {
    gate_id: "g2.orders-export",
  });

  assert.equal(isResolvedProtectedCommand(resolved), true);
  assert.equal(resolved.gate_id, "g2.orders-export");
  assert.deepEqual(resolved.argv, ordersExportTemplate.command.argv);
  assert.deepEqual(resolved.template, ordersExportTemplate);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.argv), true);
  assert.deepEqual(jsonRoundTrip(resolved.template), ordersExportTemplate);

  const parsedCatalog = parseGateTemplateCatalog(catalog);
  assert.deepEqual(jsonRoundTrip(parsedCatalog), catalog);
  assert.equal(
    resolveProtectedTemplate(parsedCatalog, { gate_id: "g1.lint" }).gate_id,
    "g1.lint",
  );

  const callerSuppliedArgv = ["npm", "test", "--", "tests/acceptance/orders-export.test.ts"];
  const rawRequests = [
    {
      gate_id: "g2.orders-export",
      argv: callerSuppliedArgv,
    },
    {
      gate_id: "g2.orders-export",
      command: {
        argv: callerSuppliedArgv,
      },
    },
    {
      gate_id: "g2.orders-export",
      cmd: "npm test",
    },
    {
      gate_id: "g2.orders-export",
      shell: "npm test",
    },
    {
      gate_id: "g2.orders-export",
      authoritative: true,
    },
  ];

  for (const request of rawRequests) {
    assert.throws(
      () => resolveProtectedTemplate(catalog, request),
      rawCommandError(),
      "caller argv and authority flags must not create a protected command",
    );
  }

  const forged = {
    gate_id: "g2.orders-export",
    template: ordersExportTemplate,
    argv: ["curl", "https://example.invalid"],
  };
  assert.equal(
    isResolvedProtectedCommand(forged),
    false,
    "a caller-assembled command record is not a resolved protected command",
  );
  const typedForge: ResolvedProtectedCommand =
    forged as unknown as ResolvedProtectedCommand;
  assert.equal(isResolvedProtectedCommand(typedForge), false);
});

test("unknown and duplicate gate templates cannot resolve", () => {
  assert.throws(
    () =>
      resolveProtectedTemplate(catalog, {
        gate_id: "g2.missing",
      }),
    {
      name: "TypeError",
      message: "Unknown gate template",
    },
  );

  assert.throws(
    () =>
      parseGateTemplateCatalog({
        schema_version: 1,
        templates: [ordersExportTemplate, ordersExportTemplate],
      }),
    {
      name: "TypeError",
      message: "Duplicate gate template",
    },
  );
});

test("the parser owns dense captured fields and rejects accessors", () => {
  const argvReads = { count: 0 };
  const commandWithAccessor = {
    ...ordersExportTemplate,
    command: Object.defineProperties({}, {
      argv: {
        enumerable: true,
        get: () => {
          argvReads.count += 1;
          return ["npm", "test"];
        },
      },
    }),
  };

  assert.throws(
    () => parseGateTemplate(commandWithAccessor),
    {
      name: "TypeError",
      message: "Invalid gate template",
    },
  );
  assert.equal(argvReads.count, 0, "validation must not invoke external accessors");

  const sparseArgv = {
    ...ordersExportTemplate,
    command: {
      argv: new Array<string>(2),
    },
  };
  sparseArgv.command.argv[0] = "npm";
  assert.throws(
    () => parseGateTemplate(sparseArgv),
    {
      name: "TypeError",
      message: "Invalid gate template",
    },
    "a sparse argv list must not become a protected command",
  );

  const mutatingArgv = ["npm", "test", "--", "tests/acceptance/orders-export.test.ts"];
  Object.defineProperty(mutatingArgv, "map", {
    value: () => ["bash", "-c", "id"],
  });
  const parsed = parseGateTemplate({
    ...ordersExportTemplate,
    command: {
      argv: mutatingArgv,
    },
  });
  assert.deepEqual(parsed.command.argv, ordersExportTemplate.command.argv);

  const extraIndexedArgv = ["npm", "test"] as string[] & { cmd?: string };
  extraIndexedArgv.cmd = "rm -rf /";
  assert.throws(
    () =>
      parseGateTemplate({
        ...ordersExportTemplate,
        command: {
          argv: extraIndexedArgv,
        },
      }),
    rawCommandError(),
  );

  const prototypeKeyTemplate = Object.assign(Object.create(null), ordersExportTemplate, {
    ["__proto__"]: { cmd: "id" },
  });
  assert.throws(
    () => parseGateTemplate(prototypeKeyTemplate),
    {
      name: "TypeError",
    },
    "prototype keys must not smuggle a raw command into a template",
  );
});
