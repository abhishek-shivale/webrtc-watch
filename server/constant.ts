import mediasoup from 'mediasoup';
import { createRouter, createWorker } from './mediasoup';

export let worker: mediasoup.types.Worker;
export let router: mediasoup.types.Router;

export const transports = new Map<string, mediasoup.types.Transport>();

export const producers = new Map<
  string,
  { producer: mediasoup.types.Producer; producerId: string }
>();

export const consumers = new Map<
  string,
  { consumer: mediasoup.types.Consumer; consumerId: string }
>();


export async function initMediasoup() {
  try {
    worker = await createWorker();
    router = await createRouter(worker);
  } catch (error) {
    console.error("Error initializing mediasoup:", error);
  }
}