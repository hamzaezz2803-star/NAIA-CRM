import packageMetadata from "../../../../../package.json";
import { describe, expect, it } from "vitest";
import {
  MEDIAPIPE_TASKS_VISION_VERSION,
  MEDIAPIPE_WASM_BASE,
} from "./mediapipe-config";

describe("MediaPipe browser assets", () => {
  it("loads WASM assets from the same pinned version as the installed package", () => {
    const dependencyVersion =
      packageMetadata.dependencies["@mediapipe/tasks-vision"];

    expect(dependencyVersion).toBe(MEDIAPIPE_TASKS_VISION_VERSION);
    expect(MEDIAPIPE_WASM_BASE).toBe(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${dependencyVersion}/wasm`,
    );
  });
});
