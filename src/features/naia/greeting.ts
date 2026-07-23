/**
 * Logic and helpers for NAIA Welcome Greeting behavior.
 */

export type GreetingGuardInput = {
  alreadyTriggered: boolean;
  isProfileLoaded: boolean;
  userName: string;
  selectedVoiceId: string;
};

/**
 * Checks whether the welcome greeting should trigger.
 */
export function shouldTriggerGreeting(input: GreetingGuardInput): boolean {
  return (
    !input.alreadyTriggered &&
    input.isProfileLoaded &&
    Boolean(input.userName.trim()) &&
    Boolean(input.selectedVoiceId)
  );
}

export type FirstClickHandlerOptions = {
  greetingPlayedRef: { current: boolean };
  primeVoice: () => void;
  speak: () => void;
  clearTimer: () => void;
  cleanup: () => void;
};

/**
 * Builds the first-click handler for bypassing browser autoplay restrictions.
 * Calls primeVoice() to unlock WebKit AudioContext/Element under user gesture,
 * clears the fallback timer, and plays greeting if not already started.
 */
export function buildFirstClickHandler(options: FirstClickHandlerOptions) {
  return () => {
    if (!options.greetingPlayedRef.current) {
      options.primeVoice();
      options.clearTimer();
      options.speak();
    }
    options.cleanup();
  };
}
