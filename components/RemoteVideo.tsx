import { RemoteStream } from "@/utils/socket";
import { useEffect, useRef, useState } from "react";

export default function RemoteVideo({
  remoteStream,
}: {
  remoteStream: RemoteStream;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    setIsPlaying(false);
    setError(null);

    if (!video) {
      console.log("No video element found");
      return;
    }

    if (!remoteStream?.consumer) {
      console.log("No consumer found");
      setError("No consumer available");
      return;
    }

    const { track } = remoteStream.consumer;

    if (!track) {
      console.error("No track found in consumer");
      setError("No track available");
      return;
    }
    
    const mediaStream = new MediaStream([track]);

    video.srcObject = mediaStream;


    const handleCanPlay = () => {
      console.log(`🎬 Video can play for ${remoteStream.id}`);
      video
        .play()
        .then(() => {
          console.log(`✅ Playback started for ${remoteStream.id}`);
          setIsPlaying(true);
        })
        .catch((err) => {
          console.error(`❌ Failed to play video for ${remoteStream.id}:`, err);
          setError(`Playback failed: ${err.message}`);
        });
    };

    video.addEventListener("canplay", handleCanPlay);
   


    return () => {
      console.log(`🧹 Cleaning up video for ${remoteStream.id}`);
      video.removeEventListener("canplay", handleCanPlay);

      setIsPlaying(false);
      setError(null);
    };
  }, [remoteStream?.consumer, remoteStream?.id]);

  return (
    <div style={{ textAlign: "center" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "300px",
          height: "200px",
          backgroundColor: "#000",
          border: `2px solid ${
            error ? "#ff4444" : isPlaying ? "#00ff00" : "#007bff"
          }`,
        }}
      />
      <p>Stream from: {remoteStream?.id || "Unknown"}</p>
      <p style={{ fontSize: "12px", color: "#666" }}>
        Producer: {remoteStream?.producerId || "Unknown"}
      </p>
      <p
        style={{
          fontSize: "10px",
          color: isPlaying ? "#00aa00" : error ? "#ff4444" : "#666",
        }}
      >
        Status: {error || (isPlaying ? "Playing" : "Loading...")}
      </p>
    </div>
  );
}