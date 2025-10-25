import { spawn } from 'child_process';
import path from 'path';

export const startHLSConverter = (inputStream: any) => {
  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',                   
    '-c:v', 'libx264',                
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-f', 'hls',                     
    '-hls_time', '2',               
    '-hls_list_size', '5',           
    '-hls_flags', 'delete_segments', 
    '-hls_segment_filename', path.join(process.cwd(), 'public/stream/seg_%03d.ts'),
    path.join(process.cwd(), 'public/stream/index.m3u8')
  ]);

  inputStream.pipe(ffmpeg.stdin);
  return ffmpeg;
};