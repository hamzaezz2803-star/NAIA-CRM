"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

type MagicLinkSubmitButtonProps = {
  disabled: boolean;
};

export function MagicLinkSubmitButton({
  disabled,
}: MagicLinkSubmitButtonProps) {
  const { pending } = useFormStatus();
  const [submitted, setSubmitted] = useState(false);
  const isSending = pending || submitted;

  return (
    <Button
      aria-disabled={disabled || isSending}
      aria-live="polite"
      className="mt-5 w-full"
      disabled={disabled || isSending}
      onClick={(event) => {
        const form = event.currentTarget.form;

        if (form?.checkValidity()) {
          setSubmitted(true);
        }
      }}
      type="submit"
    >
      {isSending ? "Sending sign-in link..." : "Send sign-in link"}
    </Button>
  );
}
