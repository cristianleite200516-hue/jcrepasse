import { io } from "socket.io-client";
import { API_HOST } from "./api";

export const socket = io(API_HOST, {
  autoConnect: true,
});
