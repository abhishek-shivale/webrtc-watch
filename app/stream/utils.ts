import { RemoteStream } from "@/utils/socket";
import { Device } from "mediasoup-client";
import {
  DtlsParameters,
  MediaKind,
  RtpParameters,
  Transport,
} from "mediasoup-client/types";
import { Socket } from "socket.io-client";

export const getLocalStream = async (
  localVideoRef: React.RefObject<HTMLVideoElement | null>,
  setLocalStream: React.Dispatch<React.SetStateAction<MediaStream | null>>
) => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }

    setLocalStream(stream);
    return stream;
  } catch (error) {
    console.error("Error getting user media:", error);
    throw new Error(`Camera/microphone access denied: ${error}`);
  }
};

export const initializeDevice = async (
  socket: Socket,
  setDevice: React.Dispatch<React.SetStateAction<Device | null>>
) => {
  try {
    if (!socket) throw new Error("Socket not connected");

    const newDevice = new Device();
    const response = await socket.emitWithAck("rtpCapabilities");

    if (!response?.rtpCapabilities) {
      throw new Error("Failed to get RTP capabilities from server");
    }

    await newDevice.load({ routerRtpCapabilities: response.rtpCapabilities });

    // Send RTP capabilities to server - this is crucial!
    socket.emit("setRtpCapabilities", newDevice.rtpCapabilities);
    
    console.log("Device RTP capabilities set on server");

    setDevice(newDevice);
    return newDevice;
  } catch (error) {
    console.error("Error initializing device:", error);
    throw error;
  }
};

export const connectProducer = async (
  socket: Socket,
  dtlsParameters: DtlsParameters,
  callback: any,
  errback: any
) => {
  try {
    console.log("Connecting producer transport...");
    const result = await socket.emitWithAck("connectProducerTransport", {
      dtlsParameters,
    });
    if (result.error) {
      throw new Error(result.error);
    }
    console.log("Producer transport connected successfully");
    callback();
  } catch (error) {
    console.error("Producer transport connection failed:", error);
    errback(error instanceof Error ? error : new Error(String(error)));
  }
};

export const produceProducer = async (
  socket: Socket,
  kind: MediaKind,
  rtpParameters: RtpParameters,
  callback: any,
  errback: any
) => {
  try {
    const result = await socket.emitWithAck("produce", {
      kind,
      rtpParameters,
    });
    if (result.error) {
      throw new Error(result.error);
    }
    callback({ id: result.id });
  } catch (error) {
    errback(error instanceof Error ? error : new Error(String(error)));
  }
};

export const createProducerTransport = async (
  device: Device,
  socket: Socket
) => {
  try {
    if (!socket) throw new Error("Socket not connected");

    const transportOptions = await socket.emitWithAck(
      "createProducerTransport"
    );

    if (transportOptions.error) {
      throw new Error(transportOptions.error);
    }

    const transport = device.createSendTransport(transportOptions);

    transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      connectProducer(socket, dtlsParameters, callback, errback);
    });

    transport.on(
      "produce",
      async ({ kind, rtpParameters }, callback, errback) => {
        produceProducer(socket, kind, rtpParameters, callback, errback);
      }
    );

    transport.on("connectionstatechange", (state) => {
      console.log(`Producer transport connection state: ${state}`);
    });

    return transport;
  } catch (error) {
    console.error("Error creating producer transport:", error);
    throw error;
  }
};

export const connectConsumer = async (
  socket: Socket,
  dtlsParameters: DtlsParameters,
  callback: any,
  errback: any
) => {
  try {
    console.log("Connecting consumer transport with DTLS params...");
    const result = await socket.emitWithAck("connectConsumerTransport", {
      dtlsParameters,
    });
    if (result?.error) {
      throw new Error(result.error);
    }
    if (!result?.success) {
      throw new Error("Consumer transport connection failed - no success response");
    }
    console.log("Consumer transport connected successfully");
    callback();
  } catch (error) {
    console.error("Consumer transport connection failed:", error);
    errback(error instanceof Error ? error : new Error(String(error)));
  }
};

export const createConsumerTransport = async (
  socket: Socket,
  device: Device,
  setConsumerTransport: React.Dispatch<React.SetStateAction<Transport | null>>
) => {
  try {
    if (!socket) throw new Error("Socket not connected");

    console.log("Creating consumer transport...");
    const transportOptions = await socket.emitWithAck(
      "createConsumerTransport"
    );

    if (transportOptions.error) {
      throw new Error(transportOptions.error);
    }

    console.log("Consumer transport options received:", transportOptions);

    const transport = device.createRecvTransport(transportOptions);

    transport.on("connectionstatechange", (state) => {
      console.log(`Consumer transport connection state: ${state}`);
    });

    transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        await connectConsumer(socket, dtlsParameters, callback, errback);
      } catch (error) {
        console.error("Transport connect event error:", error);
        //@ts-ignore
        errback(error);
      }
    });

    setConsumerTransport(transport);
    console.log("Consumer transport created successfully");
    return transport;
  } catch (error) {
    console.error("Error creating consumer transport:", error);
    throw error;
  }
};

export const consumeStream = async (
  socket: Socket,
  producerId: string,
  socketId: string,
  consumerTransport: Transport,
  setRemoteStreams: React.Dispatch<React.SetStateAction<RemoteStream[]>>
) => {
  try {
    if (!socket) {
      throw new Error("Socket not ready");
    }

    if (!consumerTransport) {
      throw new Error("Consumer transport not ready");
    }

    console.log(`🔄 Starting to consume stream from producer ${producerId} (socket: ${socketId})`);

    // Check if we already have this stream
    setRemoteStreams((prev) => {
      const existing = prev.find(s => s.id === socketId);
      if (existing) {
        console.log(`⚠️ Already have stream from socket ${socketId}, skipping`);
        return prev;
      }
      return prev;
    });

    // Small delay to ensure transport is ready
    await new Promise(resolve => setTimeout(resolve, 100));

    // Step 1: Create consumer on server
    console.log(`📡 Requesting server to create consumer for producer ${producerId}`);
    const consumerData = await socket.emitWithAck("consumer", { producerId });

    if (consumerData.error) {
      throw new Error(`Server consumer creation failed: ${consumerData.error}`);
    }

    console.log(`✅ Server created consumer:`, consumerData);

    // Step 2: Create consumer on client with retry logic
    let consumer;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        console.log(`🔧 Creating client consumer (attempt ${retryCount + 1}/${maxRetries})`);
        
        consumer = await consumerTransport.consume({
          id: consumerData.id,
          producerId: consumerData.producerId,
          kind: consumerData.kind,
          rtpParameters: consumerData.rtpParameters,
        });

        console.log(`✅ Client consumer created: ${consumer.id}`);
        break;
      } catch (error) {
        retryCount++;
        console.error(`❌ Client consumer creation failed (attempt ${retryCount}):`, error);
        
        if (retryCount >= maxRetries) {
          throw new Error(`Failed to create client consumer after ${maxRetries} attempts: ${error}`);
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }

    if (!consumer) {
      throw new Error("Failed to create consumer");
    }

    // Step 3: Resume consumer on server
    console.log(`⏯️ Resuming consumer ${consumer.id} on server`);
    const resumeResult = await socket.emitWithAck("resumeConsumer", { 
      consumerId: consumer.id 
    });

    if (resumeResult.error) {
      throw new Error(`Failed to resume consumer on server: ${resumeResult.error}`);
    }

    console.log(`✅ Consumer ${consumer.id} resumed on server`);

    // Step 4: Resume consumer on client
    if (consumer.paused) {
      await consumer.resume();
      console.log(`✅ Consumer ${consumer.id} resumed on client`);
    }

    // Step 5: Add to remote streams
    const newRemoteStream: RemoteStream = {
      id: socketId,
      consumer,
      producerId: consumerData.producerId,
    };

    setRemoteStreams((prev) => {
      const filtered = prev.filter((s) => s.id !== socketId);
      console.log(`📺 Adding remote stream for socket ${socketId}`);
      return [...filtered, newRemoteStream];
    });

    console.log(`🎉 Successfully consuming stream from ${socketId}`);
  } catch (error) {
    console.error(`💥 Error consuming stream from ${socketId}:`, error);
    throw error;
  }
};

const getExistingProducers = async (
  consumerTransport: Transport,
  socket: Socket,
  setRemoteStreams: React.Dispatch<React.SetStateAction<RemoteStream[]>>
) => {
  try {
    if (!socket) return;
    if (!consumerTransport) {
      console.warn("Consumer transport not ready, skipping existing producers");
      return;
    }

    console.log("🔍 Getting existing producers...");
    
    // Wait a bit to ensure transport is fully ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const response = await socket.emitWithAck("getProducers");

    if (response?.producerList && response.producerList.length > 0) {
      console.log(`📋 Found ${response.producerList.length} existing producers`);
      
      // Process producers one by one with delay to prevent overwhelming
      for (let i = 0; i < response.producerList.length; i++) {
        const { producerId, socketId } = response.producerList[i];
        console.log(`🔄 Processing existing producer ${i + 1}/${response.producerList.length}: ${producerId} from socket: ${socketId}`);
        
        try {
          await consumeStream(
            socket,
            producerId,
            socketId,
            consumerTransport,
            setRemoteStreams
          );
          
          // Small delay between consumers
          if (i < response.producerList.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (error) {
          console.error(`❌ Failed to consume existing producer ${producerId}:`, error);
        }
      }
    } else {
      console.log("📭 No existing producers found");
    }
  } catch (error) {
    console.error("💥 Error getting existing producers:", error);
  }
};

export const startStreaming = async (
  producerTransport: Transport,
  localStream: MediaStream,
  consumerTransport: Transport,
  socket: Socket,
  setRemoteStreams: React.Dispatch<React.SetStateAction<RemoteStream[]>>
) => {
  try {
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error("No video track found");
    }

    videoTrack.enabled = true;

    if (videoTrack.muted) {
      console.warn("Video track is muted - this might cause issues");

      const waitForUnmute = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Track remained muted for too long"));
        }, 5000);

        const handleUnmute = () => {
          clearTimeout(timeout);
          videoTrack.removeEventListener("unmute", handleUnmute);
          resolve();
        };

        if (!videoTrack.muted) {
          clearTimeout(timeout);
          resolve();
        } else {
          videoTrack.addEventListener("unmute", handleUnmute);
        }
      });

      try {
        await waitForUnmute;
        console.log("Track is now unmuted");
      } catch (error) {
        console.warn("Track is still muted, proceeding anyway:", error);
      }
    }

    console.log("🎬 Starting to produce video stream...");
    const newProducer = await producerTransport.produce({
      track: videoTrack,
    });

    if (newProducer.paused) {
      await newProducer.resume();
      console.log("Producer resumed");
    }

    console.log("🎉 Started streaming with producer:", newProducer.id);

    // Wait a bit longer for the producer to be fully established
    console.log("⏳ Waiting for producer to be established...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get existing producers to consume
    await getExistingProducers(consumerTransport, socket, setRemoteStreams);
  } catch (error) {
    console.error("💥 Error starting stream:", error);
    throw error;
  }
};