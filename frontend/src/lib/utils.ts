import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Alarga (nunca acorta) una promesa para que tarde al menos minMs, incluso si resuelve o
// rechaza antes — así una acción rápida (ej. login en localhost) sigue siendo perceptible.
// El resultado/rechazo real de `promise` se preserva sin tocar.
export async function withMinDuration<T>(promise: Promise<T>, minMs: number): Promise<T> {
  const startedAt = Date.now()
  try {
    return await promise
  } finally {
    const remaining = minMs - (Date.now() - startedAt)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
  }
}
