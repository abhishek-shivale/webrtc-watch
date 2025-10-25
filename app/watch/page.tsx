"use client";
import { useContext, useEffect, useRef, useState } from "react";
import { SocketContext } from "@/context/socket-context";

interface HLSStream {
  producerId: string;
  socketId: string;
  playlist: string;
  streamId: string;
  hasHLS: boolean;
}

function WatchPage() {
  const { socket } = useContext(SocketContext);
  const [hlsStreams, setHlsStreams] = useState<HLSStream[]>([]);
  const [selectedStream, setSelectedStream] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHLSStreams = async () => {
    if (!socket) return;
    
    try {
      setLoading(true);
      setError(null);
      console.log('Fetching HLS streams...');
      
      const response = await socket.emitWithAck("getHLSStreams");
      console.log('HLS streams response:', response);
      
      if (response.error) {
        setError(response.error);
        setHlsStreams([]);
      } else if (response.streams) {
        setHlsStreams(response.streams);
        console.log(`Found ${response.streams.length} HLS streams`);
      } else {
        setHlsStreams([]);
      }
    } catch (error) {
      console.error('Error fetching HLS streams:', error);
      setError('Failed to fetch streams');
      setHlsStreams([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!socket) return;

    // Initial fetch
    fetchHLSStreams();

    // Listen for new HLS streams
    const handleNewHLSStream = (data: any) => {
      console.log('New HLS stream available:', data);
      fetchHLSStreams(); // Refresh the list
    };

    // Listen for producer events
    const handleNewProducer = (data: any) => {
      console.log('New producer, checking for HLS streams:', data);
      // Wait a bit for HLS to start, then refresh
      setTimeout(fetchHLSStreams, 2000);
    };

    const handleClientDisconnected = (socketId: string) => {
      console.log('Client disconnected, refreshing streams:', socketId);
      fetchHLSStreams();
      
      // If the disconnected client was our selected stream, clear it
      setHlsStreams(prev => {
        const stillExists = prev.some(stream => stream.socketId !== socketId);
        if (!stillExists && selectedStream) {
          setSelectedStream(null);
        }
        return prev;
      });
    };

    socket.on("newHLSStream", handleNewHLSStream);
    socket.on("newProducer", handleNewProducer);
    socket.on("clientDisconnected", handleClientDisconnected);

    // Periodic refresh every 10 seconds
    const interval = setInterval(fetchHLSStreams, 10000);

    return () => {
      socket.off("newHLSStream", handleNewHLSStream);
      socket.off("newProducer", handleNewProducer);
      socket.off("clientDisconnected", handleClientDisconnected);
      clearInterval(interval);
    };
  }, [socket, selectedStream]);

  const handleStreamSelect = (playlist: string) => {
    console.log('Selecting stream:', playlist);
    setSelectedStream(playlist);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Watch Live Streams</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Stream List */}
        <div className="lg:col-span-1">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Available Streams</h2>
            <button
              onClick={fetchHLSStreams}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              disabled={loading}
            >
              {loading ? '...' : '↻'}
            </button>
          </div>
          
          {loading && hlsStreams.length === 0 ? (
            <p className="text-gray-500">Loading streams...</p>
          ) : error ? (
            <div className="text-red-500">
              <p>Error: {error}</p>
              <button 
                onClick={fetchHLSStreams}
                className="mt-2 px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
              >
                Retry
              </button>
            </div>
          ) : hlsStreams.length === 0 ? (
            <div className="text-gray-500">
              <p>No live streams available</p>
              <p className="text-xs mt-1">Streams will appear here when users start broadcasting</p>
            </div>
          ) : (
            <div className="space-y-2">
              {hlsStreams.map((stream, index) => (
                <button
                  key={stream.producerId}
                  onClick={() => handleStreamSelect(stream.playlist)}
                  className={`w-full p-3 text-left rounded border transition-colors ${
                    selectedStream === stream.playlist
                      ? 'bg-blue-100 border-blue-500'
                      : 'bg-white border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium">Stream {index + 1}</div>
                  <div className="text-sm text-gray-500">
                    Socket: {stream.socketId.slice(0, 8)}...
                  </div>
                  <div className="text-xs text-green-600">
                    ● Live HLS
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
              <div className="text-center">
                <p className="text-gray-500 mb-2">Select a stream to watch</p>
                {hlsStreams.length === 0 && !loading && (
                  <p className="text-sm text-gray-400">
                    Visit /stream to start broadcasting
                  </p>
                )}
              </div>
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
  const [playerStatus, setPlayerStatus] = useState<string>('Loading...');
  const hlsRef = useRef<any>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    setPlayerStatus('Initializing player...');

    // Cleanup previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    console.log('Loading HLS stream:', playlist);

    // Check if HLS.js is supported
    if (typeof window !== 'undefined' && window.Hls?.isSupported()) {
      const hls = new window.Hls({
        enableWorker: false,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 5,
        // lowLatencyMode: true,
        // backBufferLength: 30,
      });

      hlsRef.current = hls;

      hls.loadSource(playlist);
      hls.attachMedia(video);

      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed');
        setPlayerStatus('Stream ready');
        video.play().catch((error) => {
          console.error('Autoplay failed:', error);
          setPlayerStatus('Click to play');
        });
      });

      hls.on(window.Hls.Events.FRAG_LOADED, () => {
        setPlayerStatus('Playing');
      });

      hls.on(window.Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              console.log('Network error, trying to recover...');
              setPlayerStatus('Network error, retrying...');
              hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              console.log('Media error, trying to recover...');
              setPlayerStatus('Media error, recovering...');
              hls.recoverMediaError();
              break;
            default:
              console.log('Fatal error, destroying player');
              setPlayerStatus('Playback failed');
              hls.destroy();
              hlsRef.current = null;
              break;
          }
        }
      });

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      console.log('Using native HLS support');
      video.src = playlist;
      setPlayerStatus('Loading...');
      
      video.addEventListener('loadstart', () => setPlayerStatus('Loading stream...'));
      video.addEventListener('loadedmetadata', () => setPlayerStatus('Stream loaded'));
      video.addEventListener('playing', () => setPlayerStatus('Playing'));
      video.addEventListener('error', () => setPlayerStatus('Playback error'));
      
      video.play().catch((error) => {
        console.error('Native HLS playback failed:', error);
        setPlayerStatus('Click to play');
      });
    } else {
      setPlayerStatus('HLS not supported in this browser');
    }
  }, [playlist]);

  return (
    <div className="bg-black rounded-lg overflow-hidden">
      <div className="relative">
        <video
          ref={videoRef}
          className="w-full h-96 object-contain"
          controls
          muted
          playsInline
        />
        <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
          {playerStatus}
        </div>
      </div>
      <div className="p-2 bg-gray-800 text-white text-sm">
        <div>Stream: {playlist}</div>
      </div>
    </div>
  );
}

export default WatchPage;