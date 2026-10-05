import { from } from "../casework.js";
export const WORKER_WIRE_MAXIMUM_BYTES = 1024 * 1024;
export const MAXIMUM_PENDING_PROJECTION_SYNCHRONIZATIONS = 32;
export const { MakeTag: workerCall } = from();
export const { MakeTag: workerCapabilityCall } = from();
