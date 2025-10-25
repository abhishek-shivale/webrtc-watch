import { Server } from "socket.io";
import mediasoup from "mediasoup";
import {
  connectConsumerTransport,
  connectProducerTransport,
  consume,
  createConsumerTransport,
  createPlainRtpTransport,
  createProducerTransport,
  getHLSPlaylist,
  getHLSStreams,
  getProducers,
  produce,
  resumeConsumer,
  rtpCapabilities,
} from "./events";
import { consumers, producers, transports } from "./constant";
import { hlsManager } from "./hls-manager";

declare module "socket.io" {
  interface Socket {
    rtpCapabilities?: mediasoup.types.RtpCapabilities;
  }
}

let io: Server;

const corsOptions = {
  origin: "*",
  methods: ["GET", "POST"],
};

export function initSocketIO(httpServer: any) {
  io = new Server(httpServer, {
    transports: ["websocket"],
    cors: corsOptions,
  });

  io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    socket.on("rtpCapabilities", rtpCapabilities);

    socket.on("createProducerTransport", (callback) => {
      createProducerTransport(callback, socket.id);
    });

    socket.on("createConsumerTransport", (callback) => {
      createConsumerTransport(callback, socket.id);
    });

    socket.on(
      "connectProducerTransport",
      async ({ dtlsParameters }, callback) => {
        connectProducerTransport(callback, dtlsParameters, socket.id);
      }
    );

    socket.on(
      "connectConsumerTransport",
      async ({ dtlsParameters }, callback) => {
        connectConsumerTransport(callback, dtlsParameters, socket.id);
      }
    );

    socket.on("produce", async ({ kind, rtpParameters }, callback) => {
      produce(kind, rtpParameters, callback, socket);
    });

    socket.on("consumer", async ({ producerId }, callback) => {
      consume(producerId, callback, socket);
    });

    socket.on("resumeConsumer", async ({ consumerId }, callback) => {
      resumeConsumer(consumerId, callback, socket.id);
    });

    socket.on("getProducers", (callback) => {
      getProducers(callback, socket.id);
    });

    socket.on("setRtpCapabilities", (rtpCapabilities) => {
      socket.rtpCapabilities = rtpCapabilities;
    });

    socket.on("getHLSStreams", (callback) => {
      console.log("Client requesting HLS streams");
      getHLSStreams(callback);
    });

    socket.on("getHLSPlaylist", ({ producerId }, callback) => {
      console.log("Client requesting HLS playlist for producer:", producerId);
      getHLSPlaylist(producerId, callback);
    });

    socket.on("disconnect", () => {
      const producerData = producers.get(socket.id);
      if (producerData) {
        // Stop HLS stream
        hlsManager.stopHLSStream(producerData.producer.id);
      }

      producers.delete(socket.id);
      transports.delete(`${socket.id}-producer`);
      transports.delete(`${socket.id}-consumer`);
      consumers.delete(socket.id);
      io.emit("clientDisconnected", socket.id);
      console.log("A client disconnected");
    });
  });
}
