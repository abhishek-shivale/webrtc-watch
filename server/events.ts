import { consumers, producers, router, transports } from "./constant";
import { createTransport } from "./mediasoup";
import mediasoup from "mediasoup";
import { hlsManager } from "./hls-manager";
import { PlainTransport, Router } from "mediasoup/types";
import { Producer } from "mediasoup-client/types";


export const rtpCapabilities = (callback: any) => {
  if (!router) {
    console.error("Router is not initialized");
    return;
  }
  const rtpCapabilitie = router.rtpCapabilities;
  if (!rtpCapabilitie) {
    console.error("RTP capabilities not found");
    return;
  }
  callback({ rtpCapabilities: rtpCapabilitie });
};

export const createProducerTransport = async (callback: any, id: string) => {
  if (!router) {
    console.error("Router is not initialized");
    return;
  }

  try {
    if (transports.has(`${id}-producer`)) {
      console.log("Transport already exists for this socket");
      transports.delete(`${id}-producer`);
    }
    const transport = await createTransport(router);
    transports.set(`${id}-producer`, transport);

    const transportOption = {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
    callback(transportOption);
  } catch (error) {
    console.error("Error creating producer transport:", error);
    callback({ error: "Error creating producer transport" });
  }
};

export const createConsumerTransport = async (callback: any, id: string) => {
  try {
    if (transports.has(`${id}-consumer`)) {
      transports.delete(`${id}-consumer`);
      console.log("Transport already exists for this socket");
    }

    const transport = await createTransport(router);
    transports.set(`${id}-consumer`, transport);

    const transportOption = {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
    callback(transportOption);
  } catch (error) {
    console.error("Error creating consumer transport:", error);
    callback({ error: "Error creating consumer transport" });
  }
};

export const connectProducerTransport = async (
  callback: any,
  dtlsParameters: mediasoup.types.DtlsParameters,
  id: string
) => {
  try {
    console.log(`Connecting producer transport for socket: ${id}`);
    const transport = transports.get(`${id}-producer`);
    if (!transport) {
      throw new Error("Producer transport not found");
    }
    await transport.connect({ dtlsParameters });
    console.log(`Producer transport connected successfully for socket: ${id}`);
    callback({ success: true });
  } catch (error) {
    console.error("Error connecting producer transport:", error);
    callback({ error: `Error connecting producer transport: ${error}` });
  }
};

export const connectConsumerTransport = async (
  callback: any,
  dtlsParameters: mediasoup.types.DtlsParameters,
  id: string
) => {
  try {
    console.log(`Connecting consumer transport for socket: ${id}`);
    const transport = transports.get(`${id}-consumer`);
    if (!transport) {
      throw new Error(`Consumer transport not found for socket: ${id}`);
    }

    await transport.connect({ dtlsParameters });

    console.log(`Consumer transport connected successfully for socket: ${id}`);

    callback({ success: true });
  } catch (error) {
    console.error(
      `Error connecting consumer transport for socket ${id}:`,
      error
    );
    callback({ error: `Error connecting consumer transport: ${error}` });
  }
};

export const produce = async (
  kind: mediasoup.types.MediaKind,
  rtpParameters: mediasoup.types.RtpParameters,
  callback: any,
  socket: any
) => {
  try {
    const transport = transports.get(`${socket.id}-producer`);

    if (producers.has(socket.id)) {
      console.log("Producer already exists for this socket");
      const oldProducer = producers.get(socket.id);
      if (oldProducer?.producer) {
        // Stop HLS stream for old producer
        hlsManager.stopHLSStream(oldProducer.producer.id);
        oldProducer.producer.close();
      }
      producers.delete(socket.id);
    }

    if (!transport) {
      throw new Error("Producer transport not found");
    }

    console.log(`Creating producer for socket: ${socket.id}, kind: ${kind}`);
    const producer = await transport.produce({ kind, rtpParameters });

    if (producer.paused) {
      await producer.resume();
      console.log(`Producer ${producer.id} resumed`);
    }

    console.log(`Producer created: ${producer.id} for ${socket.id}`);

    // Start HLS stream for this producer with delay to ensure producer is ready
    setTimeout(async () => {
      try {
        const hlsPlaylist = await hlsManager.startHLSStream(producer, router);
        console.log(
          `HLS stream started for producer ${producer.id}: ${hlsPlaylist}`
        );

        // Emit HLS stream info to all clients
        socket.broadcast.emit("newHLSStream", {
          producerId: producer.id,
          socketId: socket.id,
          playlist: hlsPlaylist,
        });
      } catch (error) {
        console.error("Failed to start HLS stream:", error);
      }
    }, 1000);

    socket.broadcast.emit("newProducer", {
      producerId: producer.id,
      socketId: socket.id,
    });

    producers.set(socket.id, { producer, producerId: producer.id });

    callback({ id: producer.id });
  } catch (error) {
    console.error("Error producing:", error);
    callback({ error: `Error producing: ${error}` });
  }
};

export const consume = async (
  producerId: string,
  callback: any,
  socket: any
) => {
  try {
    console.log(
      `🔄 Attempting to consume producer ${producerId} for socket ${socket.id}`
    );

    if (consumers.has(socket.id)) {
      console.log("Consumer already exists for this socket, cleaning up");
      const oldConsumer = consumers.get(socket.id);
      if (oldConsumer?.consumer) {
        oldConsumer.consumer.close();
      }
      consumers.delete(socket.id);
    }

    const transport = transports.get(`${socket.id}-consumer`);
    const producerData = Array.from(producers.values()).find(
      (producer) => producer.producerId === producerId
    );

    if (!transport) {
      throw new Error(`Consumer transport not found for socket ${socket.id}`);
    }

    if (!producerData) {
      throw new Error(`Producer ${producerId} not found`);
    }

    if (!socket.rtpCapabilities) {
      throw new Error(`RTP capabilities not set on socket ${socket.id}`);
    }

    const { producer } = producerData;
    const consumerRtpCapabilities = socket.rtpCapabilities;

    // Check if this router can consume this producer
    const canConsume = router.canConsume({
      producerId: producer.id,
      rtpCapabilities:
        consumerRtpCapabilities as mediasoup.types.RtpCapabilities,
    });

    if (!canConsume) {
      throw new Error(
        `Cannot consume producer ${producerId} - incompatible RTP capabilities`
      );
    }

    console.log(
      `✅ Router can consume producer ${producerId}, creating consumer...`
    );

    // Check transport connection state
    // console.log(`Transport connection state: ${transport.connectionState.}`);

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities:
        consumerRtpCapabilities as mediasoup.types.RtpCapabilities,
    });

    // Store consumer with the actual consumer id
    consumers.set(socket.id, { consumer, consumerId: consumer.id });

    console.log(
      `✅ Consumer created: ${consumer.id} for socket ${socket.id} (producer: ${producerId})`
    );
    console.log(`Consumer paused state: ${consumer.paused}`);

    callback({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  } catch (error) {
    console.error(
      `💥 Error consuming producer ${producerId} for socket ${socket.id}:`,
      error
    );
    callback({ error: `Error consuming: ${error}` });
  }
};

export const resumeConsumer = async (
  consumerId: string,
  callback: any,
  id: string
) => {
  try {
    console.log(
      `⏯️ Attempting to resume consumer ${consumerId} for socket ${id}`
    );

    const consumerData = consumers.get(id);

    if (!consumerData) {
      throw new Error(`Consumer not found for socket ${id}`);
    }

    if (consumerData.consumerId !== consumerId) {
      throw new Error(
        `Consumer ID mismatch. Expected: ${consumerData.consumerId}, Got: ${consumerId}`
      );
    }

    const { consumer } = consumerData;

    if (consumer.paused) {
      await consumer.resume();
      console.log(`✅ Consumer ${consumerId} resumed for socket ${id}`);
    } else {
      console.log(
        `ℹ️ Consumer ${consumerId} was already resumed for socket ${id}`
      );
    }

    callback({ success: true });
  } catch (error) {
    console.error(
      `💥 Error resuming consumer ${consumerId} for socket ${id}:`,
      error
    );
    callback({ error: `Error resuming consumer: ${error}` });
  }
};

export const getProducers = async (callback: any, id: string) => {
  try {
    console.log(`📋 Getting producers list for socket ${id}`);

    const currentProducer = producers.get(id);
    const producerList = Array.from(producers.entries())
      .filter(([socketId, data]) => {
        // Don't include the requesting socket's own producer
        const isOwnProducer = socketId === id;
        const isSameProducer = data.producerId === currentProducer?.producerId;
        return !isOwnProducer && !isSameProducer;
      })
      .map(([socketId, data]) => ({
        producerId: data.producerId,
        socketId: socketId,
      }));

    console.log(
      `📊 Returning ${producerList.length} producers for socket ${id}:`,
      producerList.map((p) => `${p.producerId} (from ${p.socketId})`)
    );

    callback({ producerList });
  } catch (error) {
    console.error(`💥 Error getting producers for socket ${id}:`, error);
    callback({ error: `Error getting producers: ${error}` });
  }
};

export const getHLSStreams = (callback: any) => {
  try {
    console.log("Getting HLS streams...");

    const activeStreams = hlsManager.getAllHLSStreams();

    const producersWithHLS = Array.from(producers.entries())
      .map(([socketId, producerData]) => {
        const hlsStream = activeStreams.find(
          (stream) => stream.producerId === producerData.producer.id
        );
        return {
          producerId: producerData.producer.id,
          socketId: socketId,
          playlist: hlsStream?.playlist || null,
          streamId: hlsStream?.streamId || null,
          hasHLS: !!hlsStream,
        };
      })
      .filter((stream) => stream.hasHLS); 

    console.log(
      `Found ${producersWithHLS.length} active HLS streams:`,
      producersWithHLS
    );

    callback({
      streams: producersWithHLS,
      count: producersWithHLS.length,
    });
  } catch (error) {
    console.error("Error getting HLS streams:", error);
    callback({ error: "Error getting HLS streams", streams: [] });
  }
};

export const getHLSPlaylist = (producerId: string, callback: any) => {
  try {
    const status = hlsManager.getStreamStatus(producerId);
    if (status.isActive && status.playlist) {
      callback({ playlist: status.playlist });
    } else {
      callback({ error: status.error || "HLS stream not ready" });
    }
  } catch (error) {
    console.error("Error getting HLS playlist:", error);
    callback({ error: "Error getting HLS playlist" });
  }
};

export const createPlainRtpTransport = async () => {
  try {
    const rtpTransport = await router.createPlainTransport({
      listenIp: "127.0.0.1",
      rtcpMux: false,
      comedia: false,
    });
    console.log("Created plain rtp transport", rtpTransport);
    return rtpTransport;
  } catch (error) {
    console.log("Error while creating palin rtp transport", error);
  }
};

export const consumeProducer = async (
  rtpTransport: PlainTransport,
  producer: Producer
) => {
  try {
    const consumer = await rtpTransport.consume({
      producerId: producer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });
    return consumer;
  } catch (error) {
    console.log("Error while consuming producer");
  }
};
