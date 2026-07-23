/**
 * Tests ciblés — Greeting NAIA & Autoplay Bypass
 *
 * Importe et teste les fonctions réelles de `src/features/naia/greeting.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shouldTriggerGreeting, buildFirstClickHandler } from "./greeting";

describe("Greeting — shouldTriggerGreeting", () => {
  it("ne se déclenche pas si le profil n'est pas encore chargé", () => {
    expect(
      shouldTriggerGreeting({
        alreadyTriggered: false,
        isProfileLoaded: false,
        userName: "Ali",
        selectedVoiceId: "voice-xyz",
      }),
    ).toBe(false);
  });

  it("ne se déclenche pas si userName est vide (profil vide ou erreur réseau)", () => {
    expect(
      shouldTriggerGreeting({
        alreadyTriggered: false,
        isProfileLoaded: true,
        userName: "",
        selectedVoiceId: "voice-xyz",
      }),
    ).toBe(false);
  });

  it("ne se déclenche pas si selectedVoiceId est vide", () => {
    expect(
      shouldTriggerGreeting({
        alreadyTriggered: false,
        isProfileLoaded: true,
        userName: "Ali",
        selectedVoiceId: "",
      }),
    ).toBe(false);
  });

  it("ne se déclenche pas si le greeting a déjà été déclenché", () => {
    expect(
      shouldTriggerGreeting({
        alreadyTriggered: true,
        isProfileLoaded: true,
        userName: "Ali",
        selectedVoiceId: "voice-xyz",
      }),
    ).toBe(false);
  });

  it("se déclenche quand toutes les conditions sont remplies", () => {
    expect(
      shouldTriggerGreeting({
        alreadyTriggered: false,
        isProfileLoaded: true,
        userName: "Hamza",
        selectedVoiceId: "voice-xyz",
      }),
    ).toBe(true);
  });
});

describe("Greeting — buildFirstClickHandler", () => {
  let primeVoice: () => void;
  let speak: () => void;
  let clearTimer: () => void;
  let cleanup: () => void;

  beforeEach(() => {
    primeVoice = vi.fn();
    speak = vi.fn();
    clearTimer = vi.fn();
    cleanup = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appelle primeVoice(), clearTimer(), et speak() si l'audio n'a pas encore démarré", () => {
    const greetingPlayedRef = { current: false };
    const handler = buildFirstClickHandler({
      greetingPlayedRef,
      primeVoice,
      speak,
      clearTimer,
      cleanup,
    });

    handler();

    expect(primeVoice).toHaveBeenCalledOnce();
    expect(clearTimer).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("ne rejoue pas speak() ni primeVoice() si greetingPlayedRef est true", () => {
    const greetingPlayedRef = { current: true };
    const handler = buildFirstClickHandler({
      greetingPlayedRef,
      primeVoice,
      speak,
      clearTimer,
      cleanup,
    });

    handler();

    expect(primeVoice).not.toHaveBeenCalled();
    expect(clearTimer).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
