export type AssistantState =
  | "disconnected"
  | "connecting"
  | "listening"
  | "speaking";

export type VisionMode = "off" | "camera" | "screen";

export type CameraFacingMode = "user" | "environment";

export interface LiveFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

export interface LiveFunctionResponse {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export interface ToolActionFeedback {
  id: string;
  kind: "website" | "search" | "clipboard" | "vision";
  title: string;
  subtitle?: string;
  url?: string;
  createdAt: number;
}

export interface AudioLevels {
  inputLevel: number;
  outputLevel: number;
  spectrum: number[];
}
