import { rmSync } from "node:fs";

rmSync(new URL("../dist-extension-tests", import.meta.url), { recursive: true, force: true });
