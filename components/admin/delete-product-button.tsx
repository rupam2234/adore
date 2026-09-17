"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface DeleteProductButtonProps {
  id: string;
  name: string;
}

export function DeleteProductButton({ id, name }: DeleteProductButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (deleting) return;
    const confirmed = window.confirm(
      `Delete "${name}" from the storefront? It will be archived, preserving order history. You can restore it later from the product editor.`
    );
    if (!confirmed) return;

    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/products/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to delete product");
        return;
      }
      router.refresh();
    } catch (err) {
      console.error("Delete product error:", err);
      setError("Network error — is the server running?");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
          deleting
            ? "bg-gray-200 text-gray-500 cursor-not-allowed"
            : "text-red-600 hover:text-red-800 hover:bg-red-50"
        }`}
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}