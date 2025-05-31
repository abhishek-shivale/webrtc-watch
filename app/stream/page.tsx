"use client";
import { useContext, useEffect, useRef, useState } from "react";
import { SocketContext } from "@/context/socket-context";
import {
  consumeStream,
  createConsumerTransport,
  createProducerTransport,
  getLocalStream,
  initializeDevice,
  startStreaming,
} from "./utils";
import RemoteVideo from "@/components/RemoteVideo";

function page() {
  const { socket } = useContext(SocketContext);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // const [producerTransport, setProducerTransport] = useState<any>(null);
  const [consumerTransport, setConsumerTransport] = useState<any>(null);
  const [remoteStreams, setRemoteStreams] = useState<any[]>([]);
  const localStreamRef = useRef<HTMLVideoElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [device, setDevice] = useState<any>(null);

  useEffect(() => {
    if (!socket || isInitialized) return;

    const initialize = async () => {
      try {
        // setError(null);
        console.log("Starting initialization...");
        const stream = await getLocalStream(localStreamRef, setLocalStream);
        console.log("Got local stream");

        const device = await initializeDevice(socket, setDevice);
        console.log("Device initialized");

        const prodTransport = await createProducerTransport(device, socket);
        console.log("Producer transport created");

        const consTransport = await createConsumerTransport(
          socket,
          device,
          setConsumerTransport
        );
        console.log("Consumer transport created");

        await startStreaming(
          prodTransport,
          stream,
          consTransport,
          socket,
          setRemoteStreams
        );
        console.log("Streaming started");

        setIsInitialized(true);
      } catch (error) {
        console.error("Initialization error:", error);
        setError(`Initialization failed: ${error}`);
      }
    };

    initialize();
  }, [socket]);

 useEffect(() => {
  if (!socket || !consumerTransport) return;

  const handleNewProducer = ({
    producerId,
    socketId,
  }: {
    producerId: string;
    socketId: string;
  }) => {
    console.log("🔥 NEW PRODUCER EVENT:", { producerId, socketId });
    console.log("Current remote streams count:", remoteStreams.length);
    console.log("Consumer transport ready:", !!consumerTransport);
    
    consumeStream(
      socket,
      producerId,
      socketId,
      consumerTransport,
      setRemoteStreams
    ).catch(console.error);
  };

  socket.on("newProducer", handleNewProducer);
  console.log(remoteStreams)
  console.log("🎧 Listening for new producers...");

  return () => {
    socket.off("newProducer", handleNewProducer);
  };
}, [consumerTransport, remoteStreams.length]);

socket?.on('clientDisconnected', (socketId: string) => {
  console.log(`Client disconnected: ${socketId}`);
  console.log(remoteStreams)
  setRemoteStreams((prevStreams) =>
    prevStreams.filter((stream) => stream.id !== socketId)
  );
})
  

  //   // Cleanup on unmount
  //   useEffect(() => {
  //     return () => {
  //       console.log("Cleaning up...");

  //       if (localStream) {
  //         localStream.getTracks().forEach((track) => track.stop());
  //       }
  //       if (producer) {
  //         producer.close();
  //       }
  //       if (producerTransport) {
  //         producerTransport.close();
  //       }
  //       if (consumerTransport) {
  //         consumerTransport.close();
  //       }
  //       remoteStreams.forEach(({ consumer }) => {
  //         if (consumer) consumer.close();
  //       });
  //     };
  //   }, []);

  return (
    <div>
      <h1>Live Stream</h1>
      <div style={{ marginBottom: "20px" }}>
        <div style={{ marginBottom: "10px" }}>
          {/* Status: {isStreaming ? "🔴 Streaming" : "⚪ Not streaming\n"} */}
          Your ID is: {socket?.id}
        </div>

        <h3>Your Stream</h3>
        <video
          ref={localStreamRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "320px",
            height: "240px",
            backgroundColor: "#000",
            border: "2px solid #ccc",
            borderRadius: "8px",
          }}
        />
      </div>

      <h3>Remote Streams ({remoteStreams.length})</h3>
        {remoteStreams.length === 0 ? (
          <p>No other users streaming</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "15px",
            }}
          >
            {remoteStreams.map((remoteStream) => (
              <RemoteVideo key={remoteStream.id} remoteStream={remoteStream} />
            ))}
          </div>
        )}
    </div>
  );
}

export default page;
