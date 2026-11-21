export interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  classId: number;
  label: string;
}

export interface InferenceResult {
  detections: DetectionBox[];
  inferenceTimeMs: number;
  helmetDetected: boolean;
  unprotectedDetected: boolean;
}

export interface ESP32Status {
  connected: boolean;
  ip: string;
  lastResponse?: string;
  servoAngle: number;
  triggerActive: boolean;
}
