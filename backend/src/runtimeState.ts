type RuntimeStatus = 'booting' | 'ready' | 'failed';

interface RuntimeState {
  status: RuntimeStatus;
  error: string | null;
  updatedAt: string;
}

let runtimeState: RuntimeState = {
  status: 'booting',
  error: null,
  updatedAt: new Date().toISOString(),
};

function updateRuntimeState(status: RuntimeStatus, error: string | null = null): void {
  runtimeState = {
    status,
    error,
    updatedAt: new Date().toISOString(),
  };
}

export function markRuntimeBooting(): void {
  updateRuntimeState('booting');
}

export function markRuntimeReady(): void {
  updateRuntimeState('ready');
}

export function markRuntimeFailed(error: string): void {
  updateRuntimeState('failed', error);
}

export function getRuntimeState(): RuntimeState {
  return runtimeState;
}
