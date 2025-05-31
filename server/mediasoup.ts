import * as mediasoup from "mediasoup";

export const createWorker = async () => {
  const worker = await mediasoup.createWorker({
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp', 'bwe'],
  });
  
  worker.on('died', () => {
    console.error('mediasoup worker has died');
    process.exit(1);
  });
  
  return worker;
}

export const createRouter = async (worker: mediasoup.types.Worker) => {
  const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
    {
      kind: "audio" as mediasoup.types.MediaKind,
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: "video" as mediasoup.types.MediaKind,
      mimeType: "video/VP8",
      clockRate: 90000,
    },
    {
      kind: "video" as mediasoup.types.MediaKind,
      mimeType: "video/H264",
      clockRate: 90000,
      parameters: {
        "packetization-mode": 1,
        "profile-level-id": "42e01f",
        "level-asymmetry-allowed": 1,
      },
    },
  ];

  const router = await worker.createRouter({ mediaCodecs });
  return router;
};

export const createTransport = async (router: mediasoup.types.Router) => {
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  
  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
  }

  console.log('Using local IP:', localIp);

  const transport: mediasoup.types.WebRtcTransport = await router.createWebRtcTransport({
    listenInfos: [
      { ip: "0.0.0.0", announcedIp: localIp, protocol: 'udp' }, 
      { ip: "127.0.0.1", protocol: 'udp' } 
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,

  });

  return transport;
};