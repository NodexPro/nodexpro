import { hostname } from 'node:os';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
loadEnv({ path: resolve(here, '../../api/.env') });
loadEnv();

const { runKnowledgeTrainerWorkerTick } = await import(
  '../../api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts'
);

const workerId = (process.env.KNOWLEDGE_TRAINER_WORKER_ID || hostname() || 'trainer-worker').slice(0, 80);
const idleMs = Number(process.env.KNOWLEDGE_TRAINER_IDLE_MS || 2000);

console.log(`[knowledge-trainer-worker] starting ${workerId}`);

async function loop(): Promise<void> {
  for (;;) {
    try {
      const result = await runKnowledgeTrainerWorkerTick(workerId);
      if (!result.prepared && !result.processed) {
        await new Promise((resolveWait) => setTimeout(resolveWait, idleMs));
      }
    } catch (error) {
      console.error('[knowledge-trainer-worker] tick failed', error);
      await new Promise((resolveWait) => setTimeout(resolveWait, idleMs));
    }
  }
}

void loop();
