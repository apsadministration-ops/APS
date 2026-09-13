import { defineConfig } from "orval";
import type { InputTransformerFn } from "orval";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const openApiTarget = path.resolve(__dirname, "openapi.yaml");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: openApiTarget,
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
    hooks: {
      afterAllFilesWrite: () => {
        // Orval 8.22 appends generated exports to the existing package barrel.
        // Keep the checked-in barrel's compatibility surface without duplicate
        // exports on repeated codegen runs.
        const indexPath = path.resolve(apiClientReactSrc, "index.ts");
        const lines = readFileSync(indexPath, "utf8").split("\n");
        const seen = new Set<string>();
        const uniqueLines = lines.filter((line) => {
          const key = line.replaceAll("'", '"');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        writeFileSync(indexPath, uniqueLines.join("\n"));
      },
    },
  },
  zod: {
    input: {
      target: openApiTarget,
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      indexFiles: false,
      override: {
        zod: {
          // The workspace uses Zod 3. Keep generated validators compatible
          // with that dependency even when Orval itself detects a newer
          // default output style.
          version: 3,
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
