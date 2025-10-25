// Replace the server.ts file with this fixed version:

import { createServer } from 'https';
import { parse } from 'url';
import next from 'next';
import fs from 'fs';
import path from 'path';
import { initSocketIO } from './socket-server';
import { initMediasoup } from './constant';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3002', 10);

const key = fs.readFileSync('/Users/abhishekshivale/Developer/webrtc-watch/certificates/localhost-key.pem');  
const cert = fs.readFileSync('/Users/abhishekshivale/Developer/webrtc-watch/certificates/localhost.pem'); 

const options = {
  key,
  cert
};

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Helper function to serve HLS files with proper headers
const serveHLSFile = (req: any, res: any, filePath: string) => {
  try {
    console.log(`🎬 HLS Request: ${req.url}`);
    console.log(`📁 File path: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      console.log(`❌ HLS file not found: ${filePath}`);
      res.writeHead(404, { 
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      });
      res.end('File not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'text/plain';
    
    if (ext === '.m3u8') {
      contentType = 'application/vnd.apple.mpegurl';
    } else if (ext === '.ts') {
      contentType = 'video/mp2t';
    }
    
    // Set comprehensive CORS and caching headers
    const headers = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    };
    
    const stat = fs.statSync(filePath);
    headers['Content-Type'] = stat.size.toString();
    
    console.log(`✅ Serving HLS file: ${path.basename(filePath)} (${stat.size} bytes, ${contentType})`);
    
    res.writeHead(200, headers);
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    
    stream.on('error', (error) => {
      console.error('❌ Error streaming HLS file:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      }
    });

    stream.on('end', () => {
      console.log(`✅ Successfully served: ${path.basename(filePath)}`);
    });
    
  } catch (error) {
    console.error('❌ Error serving HLS file:', error);
    res.writeHead(500, { 
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });
    res.end('Internal server error');
  }
};

app.prepare().then(() => {
  const httpServer = createServer(options, (req, res) => {
    const parsedUrl = parse(req.url!, true);
    
    // Handle HLS requests
    if (req.url?.startsWith('/hls/')) {
      // Handle OPTIONS preflight requests
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Max-Age': '86400'
        });
        res.end();
        return;
      }
      
      const hlsPath = req.url.replace('/hls/', '');
      const fullPath = path.join(process.cwd(), 'public', 'hls', hlsPath);
      
      console.log(`🎯 HLS route matched: ${req.url}`);
      console.log(`📂 Resolved path: ${fullPath}`);
      
      serveHLSFile(req, res, fullPath);
      return;
    }
    
    // Handle all other requests with Next.js
    handle(req, res, parsedUrl);
  });

  // Initialize Socket.IO
  initSocketIO(httpServer);

  httpServer.on('error', (err: Error) => {
    console.error('❌ Server error:', err);
  });

  httpServer.listen(port, () => {
    console.log(`🚀 Server ready on https://${hostname}:${port}`);
    console.log(`📁 HLS files will be served from: ${path.join(process.cwd(), 'public', 'hls')}`);
    initMediasoup();
  });
});