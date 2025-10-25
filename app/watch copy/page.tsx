"use client";
import { useContext, useEffect, useRef, useState } from "react";
import { SocketContext } from "@/context/socket-context";

interface HLSStream {
  producerId: string;
  playlist: string;
}

function WatchPage() {
  const { socket } = useContext(SocketContext);
  const [hlsStreams, setHlsStreams] = useState<HLSStream[]>([]);
  const [selectedStream, setSelectedStream] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    const fetchHLSStreams = async () => {
      try {
        const response = await socket.emitWithAck("getHLSStreams");
        if (response.streams) {
          setHlsStreams(response.streams);
        }
      } catch (error) {
        console.error('Error fetching HLS streams:', error);
      }
    };

    fetchHLSStreams();

    // Listen for new producers
    const handleNewProducer = () => {
      fetchHLSStreams();
    };

    const handleClientDisconnected = () => {
      fetchHLSStreams();
    };

    socket.on("newProducer", handleNewProducer);
    socket.on("clientDisconnected", handleClientDisconnected);

    return () => {
      socket.off("newProducer", handleNewProducer);
      socket.off("clientDisconnected", handleClientDisconnected);
    };
  }, [socket]);

  const handleStreamSelect = (playlist: string) => {
    setSelectedStream(playlist);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Watch Live Streams</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Stream List */}
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold mb-4">Available Streams</h2>
          {hlsStreams.length === 0 ? (
            <p className="text-gray-500">No live streams available</p>
          ) : (
            <div className="space-y-2">
              {hlsStreams.map((stream, index) => (
                <button
                  key={stream.producerId}
                  onClick={() => handleStreamSelect(stream.playlist)}
                  className={`w-full p-3 text-left rounded border ${
                    selectedStream === stream.playlist
                      ? 'bg-blue-100 border-blue-500'
                      : 'bg-white border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Stream {index + 1}
                  <div className="text-sm text-gray-500">
                    ID: {stream.producerId.slice(0, 8)}...
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Video Player */}
        <div className="lg:col-span-3">
          {selectedStream ? (
            <HLSPlayer playlist={selectedStream} />
          ) : (
            <div className="bg-gray-100 rounded-lg flex items-center justify-center h-96">
              <p className="text-gray-500">Select a stream to watch</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// HLS Player Component
function HLSPlayer({ playlist }: { playlist: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;

    // Check if HLS.js is supported
    if (typeof window !== 'undefined' && window.Hls?.isSupported()) {
      const hls = new window.Hls({
        enableWorker: false,
        // lowLatencyMode: true,
        liveSyncDurationCount: 3,
      });

      hls.loadSource(playlist);
      hls.attachMedia(video);

      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed');
        video.play().catch(console.error);
      });

      hls.on(window.Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = playlist;
      video.play().catch(console.error);
    }
  }, [playlist]);

  return (
    <div className="bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-96 object-contain"
        controls
        muted
        playsInline
      />
    </div>
  );
}

export default WatchPage;