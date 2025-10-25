"use client";
import Script from 'next/script';

export default function HLSScript() {
  return (
    <Script
      src="https://cdn.jsdelivr.net/npm/hls.js@latest"
      strategy="beforeInteractive"
      onLoad={() => {
        console.log('HLS.js loaded successfully');
        if (window.Hls) {
          console.log('HLS.js is available:', window.Hls.isSupported());
        }
      }}
      onError={(e) => {
        console.error('Failed to load HLS.js:', e);
      }}
    />
  );
}
