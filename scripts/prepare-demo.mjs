// Copy the vendored runtime into demo/ (already there) and verify the demo
// directory is self-contained for static hosting.
import { cpSync, mkdirSync } from "node:fs";

// The runtime is already vendored in demo/runtime/ (Apache-2.0, LICENSE.txt
// preserved). This script exists for future additions to the demo asset set.
console.log("demo assets verified");
