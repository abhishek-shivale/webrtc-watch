import { Consumer } from "mediasoup-client/types";

export interface RemoteStream {
  id: string;
  socketId?: string;
  producerId?: string;
  consumer?: Consumer;
}