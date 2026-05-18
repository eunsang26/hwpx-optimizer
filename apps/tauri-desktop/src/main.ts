import "./tauriApi.js";

const healthButton = document.querySelector<HTMLButtonElement>("#health-button");
const healthOutput = document.querySelector<HTMLElement>("#health-output");

healthButton?.addEventListener("click", async () => {
  if (!healthOutput) return;
  try {
    const result = await window.hwpxOptimizer.health();
    healthOutput.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    healthOutput.textContent = error instanceof Error ? error.message : String(error);
  }
});
