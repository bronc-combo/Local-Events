import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function resolveAliasedPath(specifier) {
  const basePath = path.join(ROOT_DIR, specifier.slice(2));
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? basePath;
}

function resolveRelativePath(specifier, context) {
  const parentUrl = context.parentURL ?? pathToFileURL(ROOT_DIR).href;
  const parentDir = path.dirname(fileURLToPath(parentUrl));
  const basePath = path.resolve(parentDir, specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? basePath;
}

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === "server-only") {
    return {
      url: "data:text/javascript,export {};",
      shortCircuit: true,
    };
  }

  if (specifier === "next/cache") {
    return {
      url: pathToFileURL(path.join(ROOT_DIR, "node_modules", "next", "cache.js")).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith("@/")) {
    const mappedPath = resolveAliasedPath(specifier);
    return {
      url: pathToFileURL(mappedPath).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    const mappedPath = resolveRelativePath(specifier, context);
    return {
      url: pathToFileURL(mappedPath).href,
      shortCircuit: true,
    };
  }

  return defaultResolve(specifier, context, defaultResolve);
}
