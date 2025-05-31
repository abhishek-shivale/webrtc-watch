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

const key = fs.readFileSync('/Users/abhishekshivale/Developer/webrtc_nextjs/server/certificate/localhost-key.pem');  
const cert = fs.readFileSync('/Users/abhishekshivale/Developer/webrtc_nextjs/server/certificate/localhost.pem'); 

const options = {
  key,
  cert
};

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Helper function to serve HLS files
const serveHLSFile = (req: any, res: any, filePath: string) => {
  try {
    console.log(`Attempting to serve HLS file: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      console.log(`HLS file not found: ${filePath}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }

    const ext = path.extname(filePath);
    let contentType = 'text/plain';
    
    if (ext === '.m3u8') {
      contentType = 'application/vnd.apple.mpegurl';
    } else if (ext === '.ts') {
      contentType = 'video/mp2t';
    }
    
    // Set CORS and caching headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Length', stat.size);
    
    console.log(`Serving HLS file: ${filePath} (${stat.size} bytes, ${contentType})`);
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    
    stream.on('error', (error) => {
      console.error('Error streaming HLS file:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      }
    });
  } catch (error) {
    console.error('Error serving HLS file:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
};

app.prepare().then(() => {
  const httpServer = createServer(options, (req, res) => {
    const parsedUrl = parse(req.url!, true);
    
    // Handle HLS requests
    if (req.url?.startsWith('/hls/')) {
      const hlsPath = req.url.replace('/hls/', '');
      const fullPath = path.join(process.cwd(), 'public', 'hls', hlsPath);
      
      console.log(`HLS request: ${req.url} -> ${fullPath}`);
      
      // Handle OPTIONS requests for CORS
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        res.writeHead(200);
        res.end();
        return;
      }
      
      serveHLSFile(req, res, fullPath);
      return;
    }
    
    // Handle all other requests with Next.js
    handle(req, res, parsedUrl);
  });

  // Initialize Socket.IO
  initSocketIO(httpServer);

  httpServer.on('error', (err: Error) => {
    console.error('Server error:', err);
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on https://${hostname}:${port}`);
    initMediasoup();
  });
});