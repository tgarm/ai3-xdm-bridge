// src/ui/dialogs.js
//
// Toast + modal store replacing Element Plus's ElNotification/ElMessageBox.
// Module is React-free; the host component (DialogHost.jsx) subscribes.
// Semantics kept from the Element Plus usage:
//   duration 0  → sticky until dismissed (chain events the user must see)
//   duration N  → auto-dismiss after N ms

let nextId = 0;
let toasts = [];
let alerts = [];
let snapshot = { toasts, alerts }; // cached: getSnapshot must be referentially stable
const listeners = new Set();

function emit() {
  snapshot = { toasts, alerts };
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot() {
  return snapshot;
}

export function toast({ type = 'info', title, message = '', duration = 2500 }) {
  const id = nextId++;
  toasts = [...toasts, { id, type, title, message }];
  emit();
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

// Resolves when the user confirms; only one dialog is shown at a time
// (FIFO), matching the blocking nature of ElMessageBox.alert.
export function alert({ title, message = '', confirmText = 'OK' }) {
  return new Promise((resolve) => {
    alerts = [...alerts, { id: nextId++, title, message, confirmText, resolve }];
    emit();
  });
}

export function resolveAlert(id) {
  const entry = alerts.find((a) => a.id === id);
  if (!entry) return;
  alerts = alerts.filter((a) => a.id !== id);
  emit();
  entry.resolve();
}
