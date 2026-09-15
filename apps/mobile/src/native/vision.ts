import { requireNativeModule } from 'expo';

export interface VisionLabel {
  identifier: string;
  confidence: number;
}

interface MichikusaVisionModule {
  classify(uri: string, limit: number): Promise<VisionLabel[]>;
}

let visionModule: MichikusaVisionModule | null = null;

try {
  visionModule = requireNativeModule('MichikusaVision') as MichikusaVisionModule;
} catch {
  visionModule = null;
}

export function isVisionAvailable() {
  return visionModule !== null;
}

export async function classifyImage(uri: string) {
  if (!visionModule) {
    throw new Error(
      '온디바이스 Vision 분류기는 Expo Go에 포함되지 않습니다. Michikusa development build가 필요합니다.',
    );
  }

  return visionModule.classify(uri, 20);
}
