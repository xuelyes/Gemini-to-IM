import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ctiHome = mkdtempSync(join(tmpdir(), "gemini-to-im-test-"));

const result = spawnSync(
  process.execPath,
  ["--test", "--import", "tsx", "--test-timeout=15000", "src/__tests__/*.test.ts"],
  {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      CTI_HOME: ctiHome,
    },
  },
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
