// First install ffmpeg-fluent
// npm install fluent-ffmpeg @types/fluent-ffmpeg

// hls-manager.ts - Updated with ffmpeg-fluent
import * as mediasoup from "mediasoup";
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { hlsManager } from "./events";

interface HLSStream {
  id: string;
  ffmpegCommand: ffmpeg.FfmpegCommand;
  rtpPort: number;
  outputPath: string;
  playlist: string;
  plainTransport: mediasoup.types.PlainTransport;
  consumer: mediasoup.types.Consumer;
}

export class HLSManager {
  private streams = new Map<string, HLSStream>();
  private basePort = 20000;
  private hlsOutputDir = './public/hls';
  
  constructor() {
    // Ensure HLS output directory exists
    if (!fs.existsSync(this.hlsOutputDir)) {
      fs.mkdirSync(this.hlsOutputDir, { recursive: true });
    }

    // Set ffmpeg path if needed (uncomment and adjust if ffmpeg is not in PATH)
    // ffmpeg.setFfmpegPath('/usr/local/bin/ffmpeg');
  }

  async startHLSStream(
    producer: mediasoup.types.Producer,
    router: mediasoup.types.Router
  ): Promise<string> {
    try {
      const streamId = `stream_${producer.id}`;
      const rtpPort = this.getNextAvailablePort();
      
      console.log(`Starting HLS stream for producer ${producer.id} on port ${rtpPort}`);
      
      // Create plain transport for RTP
      const plainTransport = await router.createPlainTransport({
        listenIp: { ip: '127.0.0.1', announcedIp: undefined },
        rtcpMux: false,
        comedia: true,
        enableSctp: false,
        appData: { producerId: producer.id }
      });

      console.log(`Plain transport created: ${plainTransport.id}`);

      // Create consumer on plain transport
      const consumer = await plainTransport.consume({
        producerId: producer.id,
        rtpCapabilities: router.rtpCapabilities,
      });

      console.log(`Consumer created on plain transport: ${consumer.id}`);

      // Resume consumer if paused
      if (consumer.paused) {
        await consumer.resume();
        console.log(`Consumer ${consumer.id} resumed`);
      }

      // Connect plain transport
      await plainTransport.connect({
        ip: '127.0.0.1',
        port: rtpPort,
      });

      console.log(`Plain transport connected to port ${rtpPort}`);

      // Create HLS output directory for this stream
      const streamOutputDir = path.join(this.hlsOutputDir, streamId);
      if (!fs.existsSync(streamOutputDir)) {
        fs.mkdirSync(streamOutputDir, { recursive: true });
      }

      const playlistPath = path.join(streamOutputDir, 'playlist.m3u8');
      
      // Start FFmpeg process using fluent-ffmpeg
      const ffmpegCommand = this.createFFmpegCommand(
        rtpPort,
        playlistPath,
        consumer.kind,
        consumer.rtpParameters
      );

      const hlsStream: HLSStream = {
        id: streamId,
        ffmpegCommand,
        rtpPort,
        outputPath: streamOutputDir,
        playlist: `/hls/${streamId}/playlist.m3u8`,
        plainTransport,
        consumer,
      };

      this.streams.set(producer.id, hlsStream);
      
      console.log(`Started HLS stream for producer ${producer.id} at ${hlsStream.playlist}`);
      return hlsStream.playlist;
    } catch (error) {
      console.error('Error starting HLS stream:', error);
      throw error;
    }
  }

  private createFFmpegCommand(
    rtpPort: number,
    outputPath: string,
    kind: mediasoup.types.MediaKind,
    rtpParameters: mediasoup.types.RtpParameters
  ): ffmpeg.FfmpegCommand {
    
    const codec = rtpParameters.codecs[0];
    console.log(`Creating FFmpeg command for ${kind} with codec ${codec.mimeType}`);

    const command = ffmpeg()
      .input(`rtp://127.0.0.1:${rtpPort}`)
      .inputOptions([
        '-protocol_whitelist', 'file,udp,rtp',
        '-f', 'rtp'
      ]);

    // Video encoding settings
    if (kind === 'video') {
      command
        .videoCodec('libx264')
        .videoBitrate('1000k')
        .size('640x480')
        .fps(30)
        .addOptions([
          '-preset', 'veryfast',
          '-tune', 'zerolatency',
          '-profile:v', 'baseline',
          '-level', '3.1',
          '-pix_fmt', 'yuv420p'
        ]);
    }

    // Audio encoding settings
    command
      .audioCodec('aac')
      .audioBitrate('128k')
      .audioChannels(2)
      .audioFrequency(48000);

    // HLS output settings
    command
      .format('hls')
      .addOptions([
        '-hls_time', '2',
        '-hls_list_size', '10',
        '-hls_flags', 'delete_segments+append_list',
        '-hls_allow_cache', '0',
        '-hls_segment_filename', path.join(path.dirname(outputPath), 'segment_%03d.ts'),
        '-force_key_frames', 'expr:gte(t,n_forced*2)',
        '-sc_threshold', '0'
      ])
      .output(outputPath);

    // Event handlers
    command
      .on('start', (commandLine) => {
        console.log('FFmpeg started with command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.frames % 100 === 0) { // Log every 100 frames
          console.log(`FFmpeg progress: ${progress.frames} frames, ${progress.currentFps} fps, ${progress.currentKbps} kbps`);
        }
      })
      .on('stderr', (stderrLine) => {
        // Filter out verbose FFmpeg output, only log important messages
        if (stderrLine.includes('error') || stderrLine.includes('Error') || 
            stderrLine.includes('warning') || stderrLine.includes('Warning')) {
          console.log('FFmpeg stderr:', stderrLine);
        }
      })
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg error:', err.message);
        console.error('FFmpeg stdout:', stdout);
        console.error('FFmpeg stderr:', stderr);
      })
      .on('end', () => {
        console.log('FFmpeg encoding finished');
      });

    // Start the encoding
    command.run();

    return command;
  }

  stopHLSStream(producerId: string): void {
    const stream = this.streams.get(producerId);
    if (stream) {
      console.log(`Stopping HLS stream for producer ${producerId}`);
      
      // Kill FFmpeg process gracefully
      try {
        stream.ffmpegCommand.kill('SIGTERM');
        console.log('FFmpeg process terminated');
      } catch (error) {
        console.error('Error terminating FFmpeg:', error);
      }

      // Close MediaSoup resources
      try {
        if (stream.consumer && !stream.consumer.closed) {
          stream.consumer.close();
        }
        if (stream.plainTransport && !stream.plainTransport.closed) {
          stream.plainTransport.close();
        }
        console.log('MediaSoup resources closed');
      } catch (error) {
        console.error('Error closing MediaSoup resources:', error);
      }
      
      // Clean up output directory with delay to ensure FFmpeg has stopped
      setTimeout(() => {
        try {
          if (fs.existsSync(stream.outputPath)) {
            fs.rmSync(stream.outputPath, { recursive: true, force: true });
            console.log(`Cleaned up HLS files for ${producerId}`);
          }
        } catch (error) {
          console.error('Error cleaning up HLS files:', error);
        }
      }, 2000);
      
      this.streams.delete(producerId);
      console.log(`Stopped HLS stream for producer ${producerId}`);
    }
  }

  getHLSPlaylist(producerId: string): string | null {
    const stream = this.streams.get(producerId);
    return stream ? stream.playlist : null;
  }

  getAllHLSStreams(): { producerId: string; playlist: string; streamId: string }[] {
    return Array.from(this.streams.entries()).map(([producerId, stream]) => ({
      producerId,
      playlist: stream.playlist,
      streamId: stream.id,
    }));
  }

  getStreamStatus(producerId: string): { isActive: boolean; playlist?: string; error?: string } {
    const stream = this.streams.get(producerId);
    if (!stream) {
      return { isActive: false, error: 'Stream not found' };
    }

    // Check if playlist file exists
    const playlistFile = path.join(stream.outputPath, 'playlist.m3u8');
    const exists = fs.existsSync(playlistFile);

    return {
      isActive: exists,
      playlist: exists ? stream.playlist : undefined,
      error: !exists ? 'Playlist file not yet created' : undefined
    };
  }

  private getNextAvailablePort(): number {
    return this.basePort + (this.streams.size * 2); // *2 for RTP and RTCP ports
  }

  cleanup(): void {
    console.log('Cleaning up all HLS streams...');
    for (const [producerId] of this.streams) {
      this.stopHLSStream(producerId);
    }
  }
}



// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, cleaning up HLS streams...');
  hlsManager.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, cleaning up HLS streams...');
  hlsManager.cleanup();
  process.exit(0);
});
