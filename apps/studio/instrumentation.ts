/** Worker startup recovers interrupted jobs before resuming the persisted queue. */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startWorker } = await import("./server/runtime");
    startWorker();
  }
}
