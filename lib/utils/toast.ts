import { toast } from "@/components/hooks/use-toast";

/**
 * Shows a consistent error toast with the specified operation and error message
 * @param operation The operation that failed (e.g., "saving conversation", "deleting API")
 * @param error The error object or message
 */
export function showErrorToast(operation: string, error: Error | string) {
  const message = error instanceof Error ? error.message : error;
  
  toast({
    title: `Error ${operation}`,
    description: message,
    variant: "destructive",
  });
}

/**
 * Shows a consistent success toast with the specified operation and optional message
 * @param operation The operation that succeeded (e.g., "saved conversation", "deleted API")
 * @param description Optional custom description
 */
export function showSuccessToast(operation: string, description?: string) {
  toast({
    title: operation.charAt(0).toUpperCase() + operation.slice(1),
    description,
    variant: "success",
  });
}