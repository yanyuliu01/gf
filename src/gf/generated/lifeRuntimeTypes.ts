/**
 * GENERATED FILE. DO NOT EDIT.
 * Source: schemas/life-runtime.schema.json and schemas/common.schema.json
 * Regenerate with: npm run generate:types
 */

export type Id = string;

export type Timestamp = string;

export type PrivacyScope = "internal" | "private_im" | "public_allowed";

export interface SourceRef {
  "source_type": "message" | "event" | "claim" | "external_action" | "canon";
  "source_id": Id;
  "quote_hash"?: string | null;
  "observed_at"?: Timestamp | null;
}

export interface EventSourceRef {
  "source_type": "event";
  "source_id": Id;
  "quote_hash"?: string | null;
  "observed_at"?: Timestamp | null;
}

export interface LifeCommandV1 {
  "primitive": "observe" | "move" | "use_object" | "wait" | "communicate" | "capability_gap";
  "target": string;
  "detail": string;
  "text": string;
}

export interface LifeActivityV1 {
  "id": string;
  "intent": string;
  "primitive": string;
  "target": string;
  "startedAt": string;
  "endsAt": string;
}

export interface LifeStateV1 {
  "version": "s4-life.v1";
  "at": string;
  "nextSampleAt": string;
  "location": "garden" | "office" | "home";
  "activity": {
    "id": string;
    "intent": string;
    "primitive": string;
    "target": string;
    "startedAt": string;
    "endsAt": string;
  } | null;
  "water": number;
  "energy": number;
  "waterUsed": number;
  "energyUsed": number;
  "waterSupplied": number;
  "energySupplied": number;
  "moisture": number;
  "pumpHealth": number;
  "sampleNumber": number;
  "dayNumber": number;
}
