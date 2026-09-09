export const taskPollingIntervals = { learning: 800, explanation: 800, summary: 900, transcription: 900, burn: 500 } as const;

export const externalResultPollingPolicy = { intervalMs: 1_000, slowStepMs: 15_000 } as const;
