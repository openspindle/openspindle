//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"

export default [
  ...tanstackConfig,
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
      "pnpm/json-enforce-catalog": "off",
    },
  },
  // Layer boundaries: the machine domain is host-agnostic and runs in Electron main
  // (and the dev simulator) with plain relative imports; the renderer only sees its contract.
  {
    files: ["src/machine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message: "src/machine uses relative .ts imports only.",
            },
            {
              group: ["react", "react-dom", "@tanstack/*"],
              message: "src/machine has no UI.",
            },
            {
              group: ["electron", "node:*"],
              message: "Inject host capabilities through core/ports.ts.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "localStorage",
        "process",
        "Buffer",
      ],
    },
  },
  // The machine domain's tests (`npm test`) run on Node's test runner, with its assertions.
  {
    files: ["src/machine/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message: "src/machine uses relative .ts imports only.",
            },
            {
              group: ["react", "react-dom", "@tanstack/*"],
              message: "src/machine has no UI.",
            },
            {
              group: ["electron", "node:*", "!node:test", "!node:assert"],
              message: "Inject host capabilities through core/ports.ts.",
            },
          ],
        },
      ],
    },
  },
  // Layer boundaries: the workspace domain depends on nothing above it, and src/lib is
  // generic building blocks with no domain knowledge (docs/architecture.md, Layers). Each
  // block restates the renderer-wide machine and Electron/Node restrictions below, since a
  // later matching config's no-restricted-imports replaces an earlier one instead of adding
  // to it.
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app", "@/app/*"],
              message:
                "src/app holds application state, command dispatch and diagnostics, above the domain.",
            },
            {
              group: ["@/features", "@/features/*"],
              message: "src/features holds UI; the domain has no UI.",
            },
            {
              group: ["@/components", "@/components/*"],
              message:
                "src/components holds UI components; the domain has no UI.",
            },
            {
              group: ["@/platform", "@/platform/*"],
              message:
                "src/platform is the Host and RPC client layer; the domain is platform-agnostic.",
            },
            {
              group: ["@/persistence", "@/persistence/*"],
              message:
                "src/persistence holds the versioned repositories that store the domain; the domain does not depend on how it is saved.",
            },
            {
              group: ["@/formats", "@/formats/*"],
              message:
                "src/formats holds file formats; the domain models tools, plates and operations, not their file formats.",
            },
            {
              group: ["@/routes", "@/routes/*"],
              message: "src/routes holds routed UI; the domain has no UI.",
            },
            {
              group: ["@/lib", "@/lib/*"],
              message:
                "src/lib holds generic helpers for formats, platform and UI code; the domain keeps its own.",
            },
            {
              group: [
                "@/machine/core/*",
                "@/machine/firmware/*",
                "**/machine/core/*",
                "**/machine/firmware/*",
              ],
              message:
                "The renderer talks to the machine through @/machine/contract and the host only.",
            },
            {
              group: ["/electron", "node:*"],
              message:
                "Renderer code reaches the desktop through @/platform/host.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message:
                "src/lib holds generic building blocks with no domain knowledge; it imports no other layer.",
            },
            {
              group: ["/electron", "node:*"],
              message:
                "Renderer code reaches the desktop through @/platform/host.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/machine/**", "src/domain/**", "src/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/machine/core/*",
                "@/machine/firmware/*",
                "**/machine/core/*",
                "**/machine/firmware/*",
              ],
              message:
                "The renderer talks to the machine through @/machine/contract and the host only.",
            },
            {
              // Electron itself (anchored: @sentry/electron/renderer, whose reports reach Sentry
              // in the main process over the preload's bridge, is allowed).
              group: ["/electron", "node:*"],
              message:
                "Renderer code reaches the desktop through @/platform/host.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["electron/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom"],
              message: "The main process has no React.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      "eslint.config.js",
      ".prettierrc",
      "dist/**",
      "out/**",
      "release/**",
      "node_modules/**",
      "src/routeTree.gen.ts",
    ],
  },
]
