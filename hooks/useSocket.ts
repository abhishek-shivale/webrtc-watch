import { SocketContext } from "@/context/socket-context";
import { useContext } from "react";

export function useSocket() {
  const socket = useContext(SocketContext);
  if (socket === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return {socket: socket.socket};
}