// hls-manager.ts - Fixed FFmpeg configuration
import * as mediasoup from "mediasoup";
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';

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
            fs.mkdirSync(this.hlsOutputDir, {recursive: true});
        }
        console.log('HLS output directory:', path.resolve(this.hlsOutputDir));
    }

    async startHLSStream(
        producer: mediasoup.types.Producer,
        router: mediasoup.types.Router
    ): Promise<string> {
        try {
            const streamId = `stream_${producer.id}`;
            // const rtpPort = this.getNextAvailablePort();

            // console.log(`Starting HLS stream for producer ${producer.id} on port ${rtpPort}`);

            // Create plain transport for RTP
            const plainTransport = await router.createPlainTransport({
                listenIp: {ip: '127.0.0.1', announcedIp: undefined},
                rtcpMux: true,
                comedia: false,
                enableSctp: false,
                appData: {producerId: producer.id}
            });

            const rtpPort = plainTransport.tuple.localPort + 1;
            console.log(`Plain transport created on port: ${rtpPort}`);

            console.log(`Plain transport created: ${plainTransport.id}`);

            // Create consumer on plain transport
            const consumer = await plainTransport.consume({
                producerId: producer.id,
                rtpCapabilities: router.rtpCapabilities,
                paused: false
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
            if (fs.existsSync(streamOutputDir)) {
                // Clean up old files
                fs.rmSync(streamOutputDir, {recursive: true, force: true});
            }
            fs.mkdirSync(streamOutputDir, {recursive: true});

            const playlistPath = path.join(streamOutputDir, 'playlist.m3u8');

            console.log(`Created stream directory: ${streamOutputDir}`);
            console.log(`Playlist will be at: ${playlistPath}`);

            // Add before starting FFmpeg
            const validatePort = (port: number) => {
                return new Promise((resolve) => {
                    const socket = require('dgram').createSocket('udp4');
                    socket.on('error', () => resolve(false));
                    socket.bind(port, '127.0.0.1', () => {
                        socket.close(() => resolve(true));
                    });
                });
            };

// Usage in startHLSStream
            if (!(await validatePort(rtpPort))) {
                throw new Error(`Port ${rtpPort} is not available`);
            }

            // Start FFmpeg process using fluent-ffmpeg
            const ffmpegCommand = this.createFFmpegCommand(
                rtpPort,
                playlistPath,
                consumer.kind,
                consumer.rtpParameters,
                streamOutputDir
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
        rtpParameters: mediasoup.types.RtpParameters,
        outputDir: string
    ): ffmpeg.FfmpegCommand {

        const codec = rtpParameters.codecs[0];
        console.log(`Creating FFmpeg command for ${kind} with codec ${codec.mimeType}`);
        console.log(`RTP port: ${rtpPort}, Output: ${outputPath}`);

        const inputUrl = `rtp://127.0.0.1:${rtpPort}?localrtcpport=${rtpPort - 1}&pkt_size=1200`;


        const segmentPath = path.join(outputDir, 'segment_%03d.ts');

        const command = ffmpeg()
            .input(inputUrl)
            .inputOptions([
                '-protocol_whitelist', 'file,udp,rtp',
                '-f', 'rtp',
                '-analyzeduration', '1000000',
                '-probesize', '1000000',
                '-timeout', '5000000'
            ]);

        // Always include both video and audio settings for compatibility
        if (kind === 'video') {
            command
                .videoCodec('libx264')
                .videoBitrate('800k')
                .size('640x480')
                .fps(25)
                .addOptions([
                    '-preset', 'ultrafast',
                    '-tune', 'zerolatency',
                    '-profile:v', 'baseline',
                    '-level', '3.1',
                    '-pix_fmt', 'yuv420p',
                    '-g', '50' // keyframe interval
                ]);
        } else {
            // For audio-only, create a black video
            command
                .videoCodec('libx264')
                .addOptions([
                    '-f', 'lavfi',
                    '-i', 'color=c=black:s=320x240:r=25',
                    '-preset', 'ultrafast',
                    '-profile:v', 'baseline',
                    '-pix_fmt', 'yuv420p'
                ]);
        }

        // Audio settings
        command
            .audioCodec('aac')
            .audioBitrate('128k')
            .audioChannels(2)
            .audioFrequency(48000)
            .addOptions(['-ar', '48000']);

        // HLS output settings - more compatible settings
        command
            .format('hls')
            .addOptions([
                '-hls_time', '2',           // Shorter segments
                '-hls_list_size', '4',      // Fewer segments in playlist
                '-hls_flags', 'delete_segments+append_list',
                '-hls_segment_type', 'mpegts',
                '-hls_segment_filename', segmentPath,
                '-start_number', '0',
                '-force_key_frames', 'expr:gte(t,n_forced*2)',
                '-sc_threshold', '0',
                '-fflags', '+genpts'
            ])
            .output(outputPath);

        // Event handlers with better logging
        command
            .on('start', (commandLine) => {
                console.log('FFmpeg started with command:');
                console.log(commandLine);
            })
            .on('progress', (progress) => {
                if (progress.frames && progress.frames % 50 === 0) {
                    console.log(`FFmpeg progress: ${progress.frames} frames, ${progress.currentFps} fps, ${progress.currentKbps} kbps`);
                    // Check if playlist file exists
                    if (fs.existsSync(outputPath)) {
                        console.log(`✅ Playlist file exists: ${outputPath}`);
                    }
                }
            })
            .on('stderr', (stderrLine) => {
                // Log important FFmpeg messages
                if (stderrLine.includes('error') || stderrLine.includes('Error')) {
                    console.error('FFmpeg Error:', stderrLine);
                } else if (stderrLine.includes('warning') || stderrLine.includes('Warning')) {
                    console.warn('FFmpeg Warning:', stderrLine);
                } else if (stderrLine.includes('Opening') || stderrLine.includes('Stream') || stderrLine.includes('Output')) {
                    console.log('FFmpeg Info:', stderrLine);
                }
            })
            .on('error', (err, stdout, stderr) => {
                console.error('FFmpeg error:', err.message);
                if (stdout) console.error('FFmpeg stdout:', stdout);
                if (stderr) console.error('FFmpeg stderr:', stderr);
            })
            .on('end', () => {
                console.log('FFmpeg encoding finished');
            });

        // Start the encoding
        command.run();

        // Create initial playlist file if it doesn't exist after 2 seconds
        setTimeout(() => {
            if (!fs.existsSync(outputPath)) {
                console.log('Creating initial playlist file...');
                const initialPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:EVENT
`;
                try {
                    fs.writeFileSync(outputPath, initialPlaylist);
                    console.log('Initial playlist created');
                } catch (error) {
                    console.error('Failed to create initial playlist:', error);
                }
            }
        }, 2000);

        return command;
    }

    stopHLSStream(producerId: string): void {
        const stream = this.streams.get(producerId);
        if (stream) {
            console.log(`Stopping HLS stream for producer ${producerId}`);

            // Kill FFmpeg process gracefully
            try {
                stream.ffmpegCommand.kill('SIGINT');
                setTimeout(() => {
                    try {
                        stream.ffmpegCommand.kill('SIGTERM');
                    } catch (e) {
                        console.log('FFmpeg already terminated');
                    }
                }, 2000);
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

            // Clean up output directory with delay
            setTimeout(() => {
                try {
                    if (fs.existsSync(stream.outputPath)) {
                        fs.rmSync(stream.outputPath, {recursive: true, force: true});
                        console.log(`Cleaned up HLS files for ${producerId}`);
                    }
                } catch (error) {
                    console.error('Error cleaning up HLS files:', error);
                }
            }, 3000);

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
            return {isActive: false, error: 'Stream not found'};
        }

        const playlistFile = path.join(stream.outputPath, 'playlist.m3u8');
        const exists = fs.existsSync(playlistFile);

        return {
            isActive: exists,
            playlist: exists ? stream.playlist : undefined,
            error: !exists ? 'Playlist file not yet created' : undefined
        };
    }

    private getNextAvailablePort(): number {
        return this.basePort + (this.streams.size * 2);
    }

    cleanup(): void {
        console.log('Cleaning up all HLS streams...');
        for (const [producerId] of this.streams) {
            this.stopHLSStream(producerId);
        }
    }
}

// Create singleton instance
export const hlsManager = new HLSManager();

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