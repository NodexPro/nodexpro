export function createIncomeCommandTimings() {
    const started = Date.now();
    const marks = { request_received_ms: 0 };
    return {
        mark(key) {
            marks[key] = Date.now() - started;
        },
        snapshot() {
            const total_ms = Date.now() - started;
            return { ...marks, request_received_ms: 0, total_ms };
        },
    };
}
export function logIncomeCommandTimings(command, timings, extras) {
    console.info('[income-command-timings]', {
        command,
        ...timings,
        ...extras,
    });
}
