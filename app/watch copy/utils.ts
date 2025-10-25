import { RemoteStream } from "@/utils/socket";
import { Device } from "mediasoup-client";
import {
  DtlsParameters,
  Transport,
} from "mediasoup-client/types";
import { Socket } from "socket.io-client";

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

    // Send RTP capabilities to server
    socket.emit("setRtpCapabilities", newDevice.rtpCapabilities);
    
    console.log("✅ Consumer device RTP capabilities set on server");

    setDevice(newDevice);
    return newDevice;
  } catch (error) {
    console.error("❌ Error initializing consumer device:", error);
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
    console.log("🔗 Connecting consumer transport...");
    const result = await socket.emitWithAck("connectConsumerTransport", {
      dtlsParameters,
    });
    if (result?.error) {
      throw new Error(result.error);
    }
    if (!result?.success) {
      throw new Error("Consumer transport connection failed - no success response");
    }
    console.log("✅ Consumer transport connected successfully");
    callback();
  } catch (error) {
    console.error("❌ Consumer transport connection failed:", error);
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

    console.log("🚛 Creating consumer transport...");
    const transportOptions = await socket.emitWithAck(
      "createConsumerTransport"
    );

    if (transportOptions.error) {
      throw new Error(transportOptions.error);
    }

    console.log("📦 Consumer transport options received");

    const transport = device.createRecvTransport(transportOptions);

    transport.on("connectionstatechange", (state) => {
      console.log(`🔄 Consumer transport state: ${state}`);
    });

    transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        await connectConsumer(socket, dtlsParameters, callback, errback);
      } catch (error) {
        console.error("❌ Transport connect event error:", error);
        //@ts-ignore
        errback(error);
      }
    });

    setConsumerTransport(transport);
    console.log("✅ Consumer transport created successfully");
    return transport;
  } catch (error) {
    console.error("❌ Error creating consumer transport:", error);
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

    console.log(`🎬 Consuming stream from producer ${producerId} (socket: ${socketId})`);

    // Check if we already have this stream
    let alreadyExists = false;
    setRemoteStreams((prev) => {
      const existing = prev.find(s => s.id === socketId);
      if (existing) {
        console.log(`⚠️ Already consuming stream from socket ${socketId}, skipping`);
        alreadyExists = true;
      }
      return prev;
    });

    if (alreadyExists) return;

    // Wait a moment to ensure transport is ready
    await new Promise(resolve => setTimeout(resolve, 100));

    // Step 1: Request server to create consumer
    console.log(`📡 Requesting consumer for producer ${producerId}`);
    const consumerData = await socket.emitWithAck("consumer", { producerId });

    if (consumerData.error) {
      throw new Error(`Server consumer creation failed: ${consumerData.error}`);
    }

    console.log(`✅ Server consumer created:`, consumerData);

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
    console.log(`▶️ Resuming consumer ${consumer.id} on server`);
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

export const getAllExistingProducers = async (
  consumerTransport: Transport,
  socket: Socket,
  setRemoteStreams: React.Dispatch<React.SetStateAction<RemoteStream[]>>,
  setConnectionStatus?: (status: string) => void
) => {
  try {
    if (!socket || !consumerTransport) {
      console.warn("⚠️ Socket or transport not ready, skipping existing producers");
      return;
    }

    console.log("🔍 Discovering existing live streams...");
    setConnectionStatus?.("Discovering streams...");
    
    // Wait to ensure transport is fully ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const response = await socket.emitWithAck("getProducers");

    if (response?.producerList && response.producerList.length > 0) {
      console.log(`📋 Found ${response.producerList.length} live streams`);
      setConnectionStatus?.(`Found ${response.producerList.length} streams, connecting...`);
      
      // Consume all existing producers automatically
      for (let i = 0; i < response.producerList.length; i++) {
        const { producerId, socketId } = response.producerList[i];
        console.log(`🎬 Auto-consuming stream ${i + 1}/${response.producerList.length}: ${producerId} from ${socketId}`);
        
        try {
          await consumeStream(
            socket,
            producerId,
            socketId,
            consumerTransport,
            setRemoteStreams
          );
          
          // Small delay between consumers to prevent overwhelming
          if (i < response.producerList.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (error) {
          console.error(`❌ Failed to consume stream ${producerId}:`, error);
        }
      }
      
      setConnectionStatus?.("Connected to all streams");
      console.log(`✅ Successfully connected to ${response.producerList.length} streams`);
    } else {
      console.log("📭 No live streams found");
      setConnectionStatus?.("No streams available");
    }
  } catch (error) {
    console.error("💥 Error discovering existing streams:", error);
    setConnectionStatus?.("Error discovering streams");
  }
};

export const startConsumerSession = async (
  consumerTransport: Transport,
  socket: Socket,
  setRemoteStreams: React.Dispatch<React.SetStateAction<RemoteStream[]>>,
  setConnectionStatus?: (status: string) => void
) => {
  try {
    console.log("🚀 Starting consumer-only session...");
    setConnectionStatus?.("Starting session...");

    // Wait for transport to be fully established
    console.log("⏳ Waiting for transport to be ready...");
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get and consume all existing producers
    await getAllExistingProducers(consumerTransport, socket, setRemoteStreams, setConnectionStatus);
    
    console.log("🎉 Consumer session started successfully");
    console.log("🎧 Now listening for new streams...");
  } catch (error) {
    console.error("💥 Error starting consumer session:", error);
    setConnectionStatus?.("Session start failed");
    throw error;
  }
};

// Utility function to periodically check for new streams (optional)
export const startPeriodicStreamDiscovery = (
  socket: Socket,
  consumerTransport: Transport,
  setRemoteStreams: React.Dispatch<React.SetStateAction<RemoteStream[]>>,
  intervalMs: number = 30000 // 30 seconds
) => {
  console.log(`🔄 Starting periodic stream discovery (every ${intervalMs/1000}s)`);
  
  const interval = setInterval(async () => {
    try {
      console.log("🔍 Periodic stream discovery...");
      await getAllExistingProducers(consumerTransport, socket, setRemoteStreams);
    } catch (error) {
      console.error("❌ Periodic discovery error:", error);
    }
  }, intervalMs);

  return () => {
    console.log("⏹️ Stopping periodic stream discovery");
    clearInterval(interval);
  };
};