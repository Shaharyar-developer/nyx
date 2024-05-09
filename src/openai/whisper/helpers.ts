import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import { getFeatures, type AudioFeatures } from "./vad";
import { Queue } from "@datastructures-js/queue";
import { nanoid } from "nanoid";
import { sleep } from "bun";

export const captureAudioForFeatures = async (): Promise<string> => {
  let dir = "./tmp";
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  const filePath = `./tmp/${nanoid()}.wav`;
  const writeStream = fs.createWriteStream(filePath);
  writeStream.on("close", async () => {
    controller.end();
  });

  const controller = ffmpeg("default")
    .inputFormat("alsa")
    .native()
    .duration(0.1)
    .audioChannels(1)
    .audioFrequency(16000)
    .outputFormat("wav")
    .pipe(writeStream, { end: true });

  return filePath;
};

export const extractFeaturesFromFile = async (
  filePath: string
): Promise<AudioFeatures[]> => {
  await sleep(200);
  const buffer = Buffer.from(fs.readFileSync(filePath));
  const features = getFeatures(buffer, 1024);
  return features;
};

export type Averages = {
  energy: number;
  zcr: number;
  mfcc: number[];
  rms: number;
  loudness: {
    specific: Float32Array;
    total: number;
  };
};
export type AudioFeatureItem = {
  index: number;
  AudioFeatures: AudioFeatures;
};

export type FeaturesList = AudioFeatureItem[];

let index = 0;
let totalFeatures: Averages = {
  energy: 0,
  zcr: 0,
  mfcc: new Array(10).fill(0),
  rms: 0,
  loudness: {
    specific: new Float32Array(10),
    total: 0,
  },
};

const updateTotalFeatures = (features: AudioFeatures) => {
  totalFeatures.energy += features.energy;
  totalFeatures.zcr += features.zcr;
  totalFeatures.rms += features.rms;
  totalFeatures.loudness.total += features.loudness.total;
  features.mfcc.forEach((v, i) => (totalFeatures.mfcc[i] += v));
  features.loudness.specific.forEach(
    (v, i) => (totalFeatures.loudness.specific[i] += v)
  );
};

const calculateAverages = (count: number): Averages => ({
  energy: totalFeatures.energy / count,
  zcr: totalFeatures.zcr / count,
  rms: totalFeatures.rms / count,
  loudness: {
    specific: totalFeatures.loudness.specific.map((v) => v / count),
    total: totalFeatures.loudness.total / count,
  },
  mfcc: totalFeatures.mfcc.map((v) => v / count),
});
let featuresQueue = new Queue<AudioFeatureItem>();

export async function* getAverageFeaturesFromAudio(): AsyncGenerator<Averages> {
  while (true) {
    const file = await captureAudioForFeatures();
    const featuresArray = await extractFeaturesFromFile(file);
    featuresArray.forEach((features) => {
      featuresQueue.enqueue({
        index: index,
        AudioFeatures: features,
      });
      updateTotalFeatures(features);
      index++;
    });
    if (featuresQueue.size() > 10) {
      const dequeuedItem = featuresQueue.dequeue();
      if (dequeuedItem) {
        updateTotalFeatures(dequeuedItem.AudioFeatures);
      }
    }
    const averages = calculateAverages(featuresQueue.size());
    yield averages;
    fs.unlinkSync(file);
  }
}