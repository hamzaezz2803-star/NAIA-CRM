"use server";

import {
  fetchCrmNavigationSummary,
  fetchCrmPipelineAuxiliary,
  fetchCrmPipelineSnapshot,
} from "./pipeline-data";

export async function fetchCrmPipelineSnapshotAction() {
  return fetchCrmPipelineSnapshot();
}

export async function fetchCrmPipelineAuxiliaryAction() {
  return fetchCrmPipelineAuxiliary();
}

export async function fetchCrmNavigationSummaryAction() {
  return fetchCrmNavigationSummary();
}
