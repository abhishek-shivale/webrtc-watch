"use client";

import {
  createContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";

interface SocketContextType {
  socket: Socket | null;
}

export const SocketContext = createContext<SocketContextType>({
  socket: null,
});

interface SocketProviderProps {
  children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const socketInstance = io("https://localhost:3002", {
      transports: ["websocket"],
    });

    setSocket(socketInstance);

    return () => {
      if (socketInstance) socketInstance.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket }}>
      {children}
    </SocketContext.Provider>
  );
}