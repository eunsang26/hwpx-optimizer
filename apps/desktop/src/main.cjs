globalThis.__hwpxOptimizerElectron = require("electron");

import("./main.js").catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
