/** Resume persisted queued jobs when the local Node server starts. */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startWorker } = await import("./server/runtime");
    startWorker();
  }
}
