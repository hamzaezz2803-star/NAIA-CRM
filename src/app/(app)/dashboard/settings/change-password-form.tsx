"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { changePasswordAction } from "@/platform/auth/actions";

export function ChangePasswordForm() {
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleSubmit(formData: FormData) {
    setIsPending(true);
    setMessage(null);

    const newPassword = formData.get("newPassword") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    if (newPassword !== confirmPassword) {
      setMessage({
        type: "error",
        text: "Les mots de passe ne correspondent pas.",
      });
      setIsPending(false);
      return;
    }

    try {
      const result = await changePasswordAction(formData);
      if (result.error) {
        setMessage({ type: "error", text: result.error });
      } else {
        setMessage({
          type: "success",
          text: "Votre mot de passe a été mis à jour avec succès.",
        });
        // Optional: clear the form
        (
          document.getElementById("change-password-form") as HTMLFormElement
        ).reset();
      }
    } catch {
      setMessage({
        type: "error",
        text: "Une erreur inattendue s'est produite.",
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      id="change-password-form"
      action={handleSubmit}
      className="mt-4 space-y-4"
    >
      {message && (
        <div
          className={`p-3 rounded-md text-sm ${message.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"}`}
        >
          {message.text}
        </div>
      )}
      <div className="grid gap-2">
        <label
          className="text-sm font-medium text-stone-700"
          htmlFor="newPassword"
        >
          Nouveau mot de passe
        </label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            placeholder="Min. 6 caractères"
            required
            className="w-full rounded-md border border-stone-200 py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            minLength={6}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <label
          className="text-sm font-medium text-stone-700"
          htmlFor="confirmPassword"
        >
          Confirmer le mot de passe
        </label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            placeholder="Répétez le mot de passe"
            required
            className="w-full rounded-md border border-stone-200 py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            minLength={6}
          />
        </div>
      </div>
      <Button
        type="submit"
        disabled={isPending}
        className="w-full sm:w-auto bg-stone-900 hover:bg-stone-800 text-white"
      >
        {isPending ? "Mise à jour..." : "Mettre à jour le mot de passe"}
      </Button>
    </form>
  );
}
