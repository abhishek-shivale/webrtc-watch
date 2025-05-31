declare global {
  interface Window {
    Hls: typeof import('hls.js').default;
  }
}