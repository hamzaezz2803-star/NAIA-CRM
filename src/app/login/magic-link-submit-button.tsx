"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

type MagicLinkSubmitButtonProps = {
  disabled: boolean;
};

export function MagicLinkSubmitButton({
  disabled,
}: MagicLinkSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      aria-disabled={disabled || pending}
      aria-live="polite"
      className="mt-5 w-full"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? "Sending sign-in link..." : "Send sign-in link"}
    </Button>
  );
}
