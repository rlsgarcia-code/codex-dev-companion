import { rmSync } from "node:fs";

rmSync(new URL("../dist-tests", import.meta.url), { recursive: true, force: true });
