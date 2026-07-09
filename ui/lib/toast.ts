import { Toast } from "@base-ui/react/toast";

// Module-level singleton so any code (event handlers, lib/actions.ts,
// lib/api.ts) can raise a toast without needing a React hook.
export const toastManager = Toast.createToastManager();

export const toast = {
  error: (description: string, title = "Something went wrong") =>
    toastManager.add({ title, description, type: "error", timeout: 6000 }),
  success: (description: string, title = "Done") =>
    toastManager.add({ title, description, type: "success", timeout: 4000 }),
};
